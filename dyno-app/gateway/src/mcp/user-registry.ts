/**
 * Per-user MCP server registry.
 *
 * Each user can configure custom MCP servers via their workspace config at
 * workspaces/{userId}/data/config/mcp-servers.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface UserMcpServer {
  id: string;
  name: string;
  url: string;
  description: string;
  tools: string[];
  enabled: boolean;
}

interface UserMcpConfig {
  servers: UserMcpServer[];
}

// ── UserMcpRegistry ──────────────────────────────────────────────────────────

export class UserMcpRegistry {
  private workspacesPath: string;
  private cache = new Map<string, UserMcpConfig>();

  constructor(workspacesPath: string) {
    this.workspacesPath = resolve(workspacesPath);
  }

  /** Get the config file path for a user. */
  private getConfigPath(userId: string): string {
    return resolve(this.workspacesPath, userId, "data", "config", "mcp-servers.json");
  }

  /** Load user's MCP config. */
  private loadConfig(userId: string): UserMcpConfig {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const configPath = this.getConfigPath(userId);
    try {
      if (existsSync(configPath)) {
        const data = JSON.parse(readFileSync(configPath, "utf-8"));
        const config: UserMcpConfig = { servers: data.servers || [] };
        this.cache.set(userId, config);
        return config;
      }
    } catch {
      // Start fresh
    }

    const fresh: UserMcpConfig = { servers: [] };
    this.cache.set(userId, fresh);
    return fresh;
  }

  /** Save user's MCP config. */
  private saveConfig(userId: string, config: UserMcpConfig): void {
    const configPath = this.getConfigPath(userId);
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      this.cache.set(userId, config);
    } catch (err) {
      console.error(`[user-mcp] Failed to save config for ${userId}:`, err);
    }
  }

  /** Get all MCP servers for a user. */
  getServers(userId: string): UserMcpServer[] {
    return this.loadConfig(userId).servers;
  }

  /** Add an MCP server for a user. */
  addServer(userId: string, server: Omit<UserMcpServer, "id">): string {
    const config = this.loadConfig(userId);
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    config.servers.push({ ...server, id });
    this.saveConfig(userId, config);
    return id;
  }

  /** Remove an MCP server for a user. */
  removeServer(userId: string, serverId: string): boolean {
    const config = this.loadConfig(userId);
    const idx = config.servers.findIndex((s) => s.id === serverId);
    if (idx === -1) return false;
    config.servers.splice(idx, 1);
    this.saveConfig(userId, config);
    return true;
  }

  /** Find which user server provides a tool. */
  findServerForTool(userId: string, toolName: string): UserMcpServer | null {
    const config = this.loadConfig(userId);
    return config.servers.find((s) => s.enabled && s.tools.includes(toolName)) || null;
  }

  /** Invalidate cache for a user. */
  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }
}
