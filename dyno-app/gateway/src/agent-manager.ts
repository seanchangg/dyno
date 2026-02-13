/**
 * Per-user agent lifecycle manager.
 *
 * Manages GatewayAgent instances per user with lazy initialization.
 * Agent configs are persisted so they survive gateway restarts.
 * Context files (claude.md, soul.md) are fetched from Supabase.
 */

import { GatewayAgent } from "./agent.js";
import { WorkspaceManager, DEFAULT_CLAUDE_MD, DEFAULT_SOUL_MD, DEFAULT_HEARTBEAT_MD } from "./workspace.js";
import { KeyStore } from "./auth/key-store.js";
import { CredentialStore } from "./auth/credential-store.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ANTHROPIC_KEY_CREDENTIAL = "ANTHROPIC_API_KEY";

const DEFAULT_CONTEXT_FILES: Record<string, string> = {
  "claude.md": DEFAULT_CLAUDE_MD,
  "soul.md": DEFAULT_SOUL_MD,
  "heartbeat.md": DEFAULT_HEARTBEAT_MD,
};

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
  /** In-flight creation promises — prevents duplicate concurrent creates for the same user. */
  private creating = new Map<string, Promise<GatewayAgent>>();
  private workspace: WorkspaceManager;
  private keyStore: KeyStore;
  private credentialStore: CredentialStore | null = null;
  private config: AgentManagerConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private systemPrompt: string = "You are a helpful AI agent managed through Marty.";
  private toolDescriptions: string = "";
  private supabase: SupabaseClient | null = null;

  constructor(
    workspace: WorkspaceManager,
    keyStore: KeyStore,
    config?: Partial<AgentManagerConfig>,
    credentialStore?: CredentialStore
  ) {
    this.workspace = workspace;
    this.keyStore = keyStore;
    this.credentialStore = credentialStore ?? null;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize Supabase client if env vars are available
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

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
   * Concurrent calls for the same user coalesce on a single creation promise
   * so every caller receives the same fully-initialized agent.
   */
  async getOrCreateAgent(userId: string): Promise<GatewayAgent> {
    // Fast path: agent already exists
    const existing = this.agents.get(userId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      // Hot-reload soul.md so edits via the context page take effect immediately
      await this.reloadSoulPrompt(existing.agent, userId);
      return existing.agent;
    }

    // If a creation is already in flight for this user, coalesce on it
    const inflight = this.creating.get(userId);
    if (inflight) {
      return inflight;
    }

    // Start creation and store the promise so concurrent callers share it
    const promise = this.createAgentForUser(userId).finally(() => {
      this.creating.delete(userId);
    });
    this.creating.set(userId, promise);
    return promise;
  }

  /** Create a new agent for a user. Callers should go through getOrCreateAgent. */
  private async createAgentForUser(userId: string): Promise<GatewayAgent> {
    // Provision workspace if needed
    this.workspace.provision(userId);

    // Seed default context files if none exist in Supabase
    await this.ensureUserContextFiles(userId);

    // Fetch both context files concurrently
    const [claudeContent, soulContent] = await Promise.all([
      this.fetchContextFile(userId, "claude.md"),
      this.fetchContextFile(userId, "soul.md"),
    ]);

    const agent = new GatewayAgent({
      model: this.config.defaultModel,
      maxTokens: this.config.maxTokens,
      maxIterations: this.config.maxIterations,
    });

    agent.setSystemPrompt(claudeContent ?? this.systemPrompt);
    agent.setToolDescriptions(this.toolDescriptions);
    agent.setSoulPrompt(soulContent ?? "");

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

  /** Fetch a context file from Supabase for a user. Returns null if not found. */
  private async fetchContextFile(userId: string, filename: string): Promise<string | null> {
    if (!this.supabase) return null;
    try {
      const { data, error } = await this.supabase
        .from("user_context_files")
        .select("content")
        .eq("user_id", userId)
        .eq("filename", filename)
        .single();
      if (error || !data) return null;
      return data.content;
    } catch {
      return null;
    }
  }

  /** Re-read soul.md from Supabase and update the agent. */
  private async reloadSoulPrompt(agent: GatewayAgent, userId: string): Promise<void> {
    const soulContent = await this.fetchContextFile(userId, "soul.md");
    agent.setSoulPrompt(soulContent ?? "");
  }

  /** Seed default context files in Supabase if the user has none. */
  private async ensureUserContextFiles(userId: string): Promise<void> {
    if (!this.supabase) return;
    try {
      const { data: existing } = await this.supabase
        .from("user_context_files")
        .select("filename")
        .eq("user_id", userId);

      const existingNames = new Set((existing ?? []).map((r: { filename: string }) => r.filename));
      const toInsert: { user_id: string; filename: string; content: string }[] = [];

      for (const [filename, content] of Object.entries(DEFAULT_CONTEXT_FILES)) {
        if (!existingNames.has(filename)) {
          toInsert.push({ user_id: userId, filename, content });
        }
      }

      if (toInsert.length > 0) {
        await this.supabase.from("user_context_files").insert(toInsert);
        console.log(`[agent-manager] Seeded ${toInsert.length} default context files for user ${userId}`);
      }
    } catch (err) {
      console.warn("[agent-manager] Failed to seed context files:", err);
    }
  }

  /** Store an API key for a user (local file cache only — ephemeral). */
  storeApiKey(userId: string, apiKey: string) {
    this.keyStore.store(userId, apiKey);
  }

  /**
   * Persist an API key to Supabase CredentialStore (durable, survives restarts).
   * Called only when user explicitly enables autonomous mode.
   */
  async persistApiKey(userId: string, apiKey: string): Promise<void> {
    this.keyStore.store(userId, apiKey);
    if (this.credentialStore) {
      await this.credentialStore.store(userId, ANTHROPIC_KEY_CREDENTIAL, apiKey);
    }
  }

  /**
   * Remove the persisted API key from Supabase CredentialStore.
   * Called when user disables autonomous mode.
   */
  async clearPersistedApiKey(userId: string): Promise<void> {
    if (this.credentialStore) {
      await this.credentialStore.remove(userId, ANTHROPIC_KEY_CREDENTIAL);
    }
  }

  /**
   * Retrieve a stored API key for a user.
   * Checks local file-based KeyStore first (fast), then falls back
   * to the Supabase CredentialStore (for autonomous mode after restart).
   */
  async getApiKey(userId: string): Promise<string | null> {
    // Fast path: local file store
    const local = this.keyStore.retrieve(userId);
    if (local) return local;

    // Fallback: Supabase credential store (only populated if autonomous mode was enabled)
    if (this.credentialStore) {
      try {
        const remote = await this.credentialStore.retrieve(userId, ANTHROPIC_KEY_CREDENTIAL);
        if (remote) {
          // Backfill local store so future lookups are fast
          this.keyStore.store(userId, remote);
          return remote;
        }
      } catch (err) {
        console.warn("[agent-manager] CredentialStore fallback failed:", err);
      }
    }

    return null;
  }

  /** Check if a user has a stored API key (local only, sync). */
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
    this.creating.delete(userId);
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
    this.creating.clear();
  }
}
