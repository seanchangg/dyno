/**
 * Per-user agent lifecycle manager.
 *
 * Manages GatewayAgent instances per user with lazy initialization.
 * Agent configs are persisted so they survive gateway restarts.
 */

import { GatewayAgent } from "./agent.js";
import { WorkspaceManager } from "./workspace.js";
import { KeyStore } from "./auth/key-store.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentEntry {
  agent: GatewayAgent;
  userId: string;
  createdAt: number;
  lastActiveAt: number;
}

interface AgentManagerConfig {
  defaultModel: string;
  maxTokens: number;
  maxIterations: number;
  idleTimeoutMs: number; // Auto-cleanup after inactivity
}

// ── AgentManager ─────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AgentManagerConfig = {
  defaultModel: "claude-sonnet-4-5-20250929",
  maxTokens: 8192,
  maxIterations: 15,
  idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
};

export class AgentManager {
  private agents = new Map<string, AgentEntry>();
  private workspace: WorkspaceManager;
  private keyStore: KeyStore;
  private config: AgentManagerConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private systemPrompt: string = "You are a helpful AI agent managed through Marty.";
  private toolDescriptions: string = "";

  constructor(
    workspace: WorkspaceManager,
    keyStore: KeyStore,
    config?: Partial<AgentManagerConfig>
  ) {
    this.workspace = workspace;
    this.keyStore = keyStore;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Periodic cleanup of idle agents
    this.cleanupInterval = setInterval(() => this.cleanupIdleAgents(), 60_000);
  }

  /** Set the shared system prompt for all agents. */
  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
    // Update all existing agents
    for (const entry of this.agents.values()) {
      entry.agent.setSystemPrompt(prompt);
    }
  }

  /** Set tool descriptions appendix for all agents. */
  setToolDescriptions(descriptions: string) {
    this.toolDescriptions = descriptions;
    for (const entry of this.agents.values()) {
      entry.agent.setToolDescriptions(descriptions);
    }
  }

  /**
   * Get or create an agent for a user.
   * Lazy init: first access provisions workspace and creates the agent.
   */
  getOrCreateAgent(userId: string): GatewayAgent {
    const existing = this.agents.get(userId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      return existing.agent;
    }

    return this.createAgentForUser(userId);
  }

  /** Create a new agent for a user. */
  createAgentForUser(userId: string): GatewayAgent {
    // Provision workspace if needed
    this.workspace.provision(userId);

    // Try to load per-user system prompt
    let userSystemPrompt = this.systemPrompt;
    try {
      const userContextPath = resolve(
        this.workspace.getUserWorkspacePath(userId),
        "data",
        "context",
        "claude.md"
      );
      const userContext = readFileSync(userContextPath, "utf-8");
      userSystemPrompt = userContext;
    } catch {
      // No per-user context file, use shared prompt
    }

    const agent = new GatewayAgent({
      model: this.config.defaultModel,
      maxTokens: this.config.maxTokens,
      maxIterations: this.config.maxIterations,
    });

    agent.setSystemPrompt(userSystemPrompt);
    agent.setToolDescriptions(this.toolDescriptions);

    const entry: AgentEntry = {
      agent,
      userId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.agents.set(userId, entry);
    console.log(`[agent-manager] Created agent for user ${userId}`);

    return agent;
  }

  /** Store an API key for a user. */
  storeApiKey(userId: string, apiKey: string) {
    this.keyStore.store(userId, apiKey);
  }

  /** Retrieve a stored API key for a user. */
  getApiKey(userId: string): string | null {
    return this.keyStore.retrieve(userId);
  }

  /** Check if a user has a stored API key. */
  hasApiKey(userId: string): boolean {
    return this.keyStore.has(userId);
  }

  /** Get count of active agents. */
  getActiveCount(): number {
    return this.agents.size;
  }

  /** List all active user IDs. */
  getActiveUsers(): string[] {
    return Array.from(this.agents.keys());
  }

  /** Remove an agent for a user. */
  removeAgent(userId: string): boolean {
    return this.agents.delete(userId);
  }

  /** Cleanup idle agents that haven't been used within the timeout. */
  private cleanupIdleAgents() {
    const now = Date.now();
    for (const [userId, entry] of this.agents) {
      if (now - entry.lastActiveAt > this.config.idleTimeoutMs) {
        this.agents.delete(userId);
        console.log(`[agent-manager] Cleaned up idle agent for user ${userId}`);
      }
    }
  }

  /** Shutdown: cleanup all agents and intervals. */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.agents.clear();
  }
}
