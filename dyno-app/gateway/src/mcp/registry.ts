/**
 * MCP Server Registry — Tracks available MCP servers.
 *
 * Maintains a registry of MCP server connections with health tracking.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface McpServerEntry {
  id: string;
  name: string;
  url: string;
  description: string;
  tools: string[];     // Tool names provided by this server
  healthy: boolean;
  lastHealthCheck: number;
  type: "builtin" | "legacy" | "user";
}

// ── McpRegistry ──────────────────────────────────────────────────────────────

export class McpRegistry {
  private servers = new Map<string, McpServerEntry>();

  /** Register an MCP server. */
  register(entry: Omit<McpServerEntry, "healthy" | "lastHealthCheck">): void {
    this.servers.set(entry.id, {
      ...entry,
      healthy: true,
      lastHealthCheck: Date.now(),
    });
    console.log(`[mcp-registry] Registered server: ${entry.id} (${entry.tools.length} tools)`);
  }

  /** Unregister an MCP server. */
  unregister(id: string): boolean {
    return this.servers.delete(id);
  }

  /** Get a server by ID. */
  get(id: string): McpServerEntry | null {
    return this.servers.get(id) || null;
  }

  /** Find which server provides a given tool. */
  findServerForTool(toolName: string): McpServerEntry | null {
    for (const server of this.servers.values()) {
      if (server.healthy && server.tools.includes(toolName)) {
        return server;
      }
    }
    return null;
  }

  /** List all registered servers. */
  listAll(): McpServerEntry[] {
    return Array.from(this.servers.values());
  }

  /** List healthy servers only. */
  listHealthy(): McpServerEntry[] {
    return Array.from(this.servers.values()).filter((s) => s.healthy);
  }

  /** Update server health status. */
  setHealth(id: string, healthy: boolean): void {
    const entry = this.servers.get(id);
    if (entry) {
      entry.healthy = healthy;
      entry.lastHealthCheck = Date.now();
    }
  }

  /** Get all available tool names across all healthy servers. */
  getAllToolNames(): string[] {
    const tools: string[] = [];
    for (const server of this.servers.values()) {
      if (server.healthy) {
        tools.push(...server.tools);
      }
    }
    return tools;
  }
}
