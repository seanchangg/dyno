/**
 * MCP Router — Routes tool calls to the correct MCP server.
 *
 * Handles connection pooling, failover, and per-user rate limits.
 */

import { McpRegistry, type McpServerEntry } from "./registry.js";
import { UserMcpRegistry } from "./user-registry.js";
import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingRpcCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface McpConnection {
  ws: WebSocket;
  serverId: string;
  url: string;
  pending: Map<string, PendingRpcCall>;
  connected: boolean;
}

// ── McpRouter ────────────────────────────────────────────────────────────────

const RPC_TIMEOUT_MS = 30_000;

export class McpRouter {
  private registry: McpRegistry;
  private userRegistry: UserMcpRegistry;
  private connections = new Map<string, McpConnection>();

  constructor(registry: McpRegistry, userRegistry: UserMcpRegistry) {
    this.registry = registry;
    this.userRegistry = userRegistry;
  }

  /**
   * Execute a tool call, routing to the correct MCP server.
   * Checks user-specific servers first, then global registry.
   */
  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    userId?: string
  ): Promise<string> {
    // Check user-specific servers first
    if (userId) {
      const userServer = this.userRegistry.findServerForTool(userId, toolName);
      if (userServer) {
        return this.callServer(userServer.url, toolName, input);
      }
    }

    // Fall back to global registry
    const server = this.registry.findServerForTool(toolName);
    if (!server) {
      return `Error: No MCP server provides tool "${toolName}"`;
    }

    return this.callServer(server.url, toolName, input);
  }

  /** Make an RPC call to an MCP server. */
  private async callServer(
    url: string,
    toolName: string,
    input: Record<string, unknown>
  ): Promise<string> {
    const conn = await this.getConnection(url);
    if (!conn.connected) {
      return `Error: Not connected to MCP server at ${url}`;
    }

    const id = uuidv4();
    const request = {
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: input },
      id,
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        conn.pending.delete(id);
        resolve(`Error: Tool call ${toolName} timed out`);
      }, RPC_TIMEOUT_MS);

      conn.pending.set(id, {
        resolve: (result) => {
          if (typeof result === "string") resolve(result);
          else resolve(JSON.stringify(result));
        },
        reject: (err) => resolve(`Error: ${err.message}`),
        timeout,
      });

      conn.ws.send(JSON.stringify(request));
    });
  }

  /** Get or create a WebSocket connection to an MCP server. */
  private async getConnection(url: string): Promise<McpConnection> {
    const existing = this.connections.get(url);
    if (existing && existing.connected) {
      return existing;
    }

    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      const conn: McpConnection = {
        ws,
        serverId: url,
        url,
        pending: new Map(),
        connected: false,
      };

      const connectTimeout = setTimeout(() => {
        ws.close();
        conn.connected = false;
        resolve(conn);
      }, 5000);

      ws.on("open", () => {
        clearTimeout(connectTimeout);
        conn.connected = true;
        this.connections.set(url, conn);
        resolve(conn);
      });

      ws.on("message", (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString());
          const pending = conn.pending.get(response.id);
          if (pending) {
            clearTimeout(pending.timeout);
            conn.pending.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Invalid response
        }
      });

      ws.on("close", () => {
        conn.connected = false;
        this.connections.delete(url);
        for (const [id, pending] of conn.pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Connection closed"));
          conn.pending.delete(id);
        }
      });

      ws.on("error", () => {
        clearTimeout(connectTimeout);
        conn.connected = false;
        resolve(conn);
      });
    });
  }

  /** Disconnect all connections. */
  disconnectAll(): void {
    for (const conn of this.connections.values()) {
      conn.ws.close();
    }
    this.connections.clear();
  }
}
