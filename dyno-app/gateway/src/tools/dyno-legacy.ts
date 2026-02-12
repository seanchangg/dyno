/**
 * Legacy Tool Bridge — Connects to the Python MCP server
 * and registers all legacy tools with the Gateway.
 *
 * The Python MCP server wraps the existing 18+ Python tools
 * as JSON-RPC endpoints on port 18790.
 */

import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type Anthropic from "@anthropic-ai/sdk";

// ── Types ────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: string;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: string;
}

interface McpToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  mode: "auto" | "manual";
}

interface PendingCall {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ── Legacy Tool Bridge ───────────────────────────────────────────────────────

const CALL_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

export class LegacyToolBridge {
  private url: string;
  private ws: WebSocket | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private toolDefinitions: McpToolDefinition[] = [];
  private readOnlyTools = new Set<string>();
  private connected = false;
  private reconnecting = false;

  constructor(url: string) {
    this.url = url;
  }

  /** Connect to the Python MCP server and discover available tools. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection timeout to ${this.url}`));
      }, 5000);

      ws.on("open", async () => {
        clearTimeout(connectTimeout);
        this.connected = true;
        console.log(`[legacy-bridge] Connected to ${this.url}`);

        try {
          // Discover available tools
          await this.discoverTools();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.on("message", (data: Buffer) => {
        try {
          const response: JsonRpcResponse = JSON.parse(data.toString());
          const pending = this.pendingCalls.get(response.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingCalls.delete(response.id);
            pending.resolve(response);
          }
        } catch (err) {
          console.error("[legacy-bridge] Invalid response:", err);
        }
      });

      ws.on("close", () => {
        this.connected = false;
        console.log("[legacy-bridge] Disconnected");
        // Reject all pending calls
        for (const [id, pending] of this.pendingCalls) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Connection closed"));
          this.pendingCalls.delete(id);
        }
        // Auto-reconnect
        if (!this.reconnecting) {
          this.reconnecting = true;
          setTimeout(() => {
            this.reconnecting = false;
            this.connect().catch(() => {});
          }, RECONNECT_DELAY_MS);
        }
      });

      ws.on("error", (err) => {
        clearTimeout(connectTimeout);
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  /** Send a JSON-RPC call and wait for the response. */
  private async rpcCall(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected to MCP server");
    }

    const id = uuidv4();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`RPC call ${method} timed out`));
      }, CALL_TIMEOUT_MS);

      this.pendingCalls.set(id, {
        resolve: (response) => {
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        },
        reject,
        timeout,
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  /** Discover available tools from the MCP server. */
  private async discoverTools(): Promise<void> {
    const result = (await this.rpcCall("tools/list")) as {
      tools: McpToolDefinition[];
    };

    this.toolDefinitions = result.tools || [];
    this.readOnlyTools.clear();

    for (const tool of this.toolDefinitions) {
      if (tool.mode === "auto") {
        this.readOnlyTools.add(tool.name);
      }
    }

    console.log(
      `[legacy-bridge] Discovered ${this.toolDefinitions.length} tools ` +
      `(${this.readOnlyTools.size} auto-approved)`
    );
  }

  /** Get tool definitions in Anthropic's format. */
  getToolDefinitions(): Anthropic.Tool[] {
    return this.toolDefinitions.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }));
  }

  /** Get the set of auto-approved (read-only) tool names. */
  getReadOnlyTools(): Set<string> {
    return this.readOnlyTools;
  }

  /** Execute a tool via the MCP server.
   *  If userId is provided, it's injected into the tool arguments
   *  so Python tools automatically get user context.
   */
  async executeTool(name: string, input: Record<string, unknown>, userId?: string): Promise<string> {
    try {
      const enrichedInput = userId ? { ...input, userId } : input;
      const result = await this.rpcCall("tools/call", { name, arguments: enrichedInput });
      if (typeof result === "string") return result;
      return JSON.stringify(result);
    } catch (err) {
      return `Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Check if the bridge is connected. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Disconnect from the MCP server. */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
