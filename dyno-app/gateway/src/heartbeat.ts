/**
 * HeartbeatDaemon — Autonomous agent heartbeat system.
 *
 * Manages per-user heartbeat timers that periodically wake the agent
 * to check for tasks. Uses a two-phase approach:
 *   Phase 1: Triage with Haiku (cheap, no tools) — "anything need attention?"
 *   Phase 2: Action with Sonnet (full tools) — only if triage says yes
 *
 * Budget cap checked before every tick. Auto-pauses when exceeded.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

import type { GatewayAgent, EventCallback } from "./agent.js";
import type { AgentManager } from "./agent-manager.js";
import type { ActivityLogger } from "./activity-logger.js";
import type { DynoDashboardChannel } from "./channels/dyno-dashboard.js";
import type { LegacyToolBridge } from "./tools/dyno-legacy.js";
import type { ToolPermissions } from "./tool-permissions.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HeartbeatConfig {
  userId: string;
  intervalMinutes: number;
  dailyBudgetCapUsd: number | null;
  triageModel: string;
  escalationModel: string;
}

interface HeartbeatEntry {
  config: HeartbeatConfig;
  timer: ReturnType<typeof setInterval>;
  running: boolean;
}

interface TriageResult {
  escalated: boolean;
  reason: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

// ── Cost constants ───────────────────────────────────────────────────────────

const HAIKU_COST_IN = 1 / 1_000_000;
const HAIKU_COST_OUT = 5 / 1_000_000;
const SONNET_COST_IN = 3 / 1_000_000;
const SONNET_COST_OUT = 15 / 1_000_000;

// ── Headless tool allowlist (same philosophy as webhooks.ts) ─────────────────

const HEARTBEAT_ALLOWED_TOOLS = new Set([
  "recall_memories", "save_memory", "list_memory_tags",
  "list_memories", "search_memories",
  "read_file", "list_files",
  "fetch_url", "web_search",
  "get_dashboard_layout", "ui_action",
  "run_script", "list_scripts",
  "spawn_agent", "list_children", "get_session_status",
  "send_to_session",
  "take_screenshot", "get_metrics", "record_metric",
  "list_uploads", "read_upload",
  "list_installed_skills",
  "retrieve_credential",
]);

// ── HeartbeatDaemon ──────────────────────────────────────────────────────────

export interface HeartbeatDeps {
  agentManager: AgentManager;
  userChannels: Map<string, DynoDashboardChannel>;
  legacyBridge: LegacyToolBridge | null;
  activityLogger: ActivityLogger | null;
  toolPermissions: ToolPermissions;
  workspacesPath: string;
}

export class HeartbeatDaemon {
  private heartbeats = new Map<string, HeartbeatEntry>();
  private deps: HeartbeatDeps;
  private supabase: SupabaseClient | null = null;

  constructor(deps: HeartbeatDeps) {
    this.deps = deps;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      this.supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
  }

  /** Start a heartbeat for a user. Replaces existing if already running. */
  startHeartbeat(config: HeartbeatConfig): void {
    this.stopHeartbeat(config.userId);

    const intervalMs = config.intervalMinutes * 60 * 1000;
    const timer = setInterval(() => {
      this.tick(config.userId).catch((err) => {
        console.error(`[heartbeat] Tick error for ${config.userId}:`, err);
      });
    }, intervalMs);

    this.heartbeats.set(config.userId, {
      config,
      timer,
      running: false,
    });

    console.log(
      `[heartbeat] Started for user ${config.userId} ` +
      `(interval: ${config.intervalMinutes}m, budget: ${config.dailyBudgetCapUsd ?? "unlimited"})`
    );

    // Fire first tick after a short delay (don't block startup)
    setTimeout(() => {
      this.tick(config.userId).catch((err) => {
        console.error(`[heartbeat] Initial tick error for ${config.userId}:`, err);
      });
    }, 5000);
  }

  /** Stop a user's heartbeat. */
  stopHeartbeat(userId: string): void {
    const entry = this.heartbeats.get(userId);
    if (entry) {
      clearInterval(entry.timer);
      this.heartbeats.delete(userId);
      console.log(`[heartbeat] Stopped for user ${userId}`);
    }
  }

  /** Check if a user has an active heartbeat. */
  isActive(userId: string): boolean {
    return this.heartbeats.has(userId);
  }

  /** Update config for a running heartbeat. Restarts the timer. */
  updateConfig(config: HeartbeatConfig): void {
    if (this.heartbeats.has(config.userId)) {
      this.startHeartbeat(config);
    }
  }

  /** Shutdown all heartbeats. */
  shutdown(): void {
    for (const [userId] of this.heartbeats) {
      this.stopHeartbeat(userId);
    }
    console.log("[heartbeat] All heartbeats stopped");
  }

  // ── Core tick ──────────────────────────────────────────────────────────────

  private async tick(userId: string): Promise<void> {
    const entry = this.heartbeats.get(userId);
    if (!entry) return;

    // Prevent overlapping ticks
    if (entry.running) {
      console.log(`[heartbeat] ${userId}: Skipping tick (previous still running)`);
      return;
    }
    entry.running = true;

    try {
      // Check API key
      const apiKey = await this.deps.agentManager.getApiKey(userId);
      if (!apiKey) {
        console.log(`[heartbeat] ${userId}: No API key, skipping`);
        return;
      }

      // Check budget cap
      if (entry.config.dailyBudgetCapUsd !== null && this.deps.activityLogger) {
        const dailyCost = await this.deps.activityLogger.getDailyHeartbeatCost(userId);
        if (dailyCost >= entry.config.dailyBudgetCapUsd) {
          console.log(
            `[heartbeat] ${userId}: Daily budget exceeded ($${dailyCost.toFixed(4)}/$${entry.config.dailyBudgetCapUsd})`
          );

          // Log the budget exceeded event
          this.deps.activityLogger.logHeartbeat({
            userId,
            triageModel: entry.config.triageModel,
            triageTokensIn: 0,
            triageTokensOut: 0,
            escalated: false,
            totalCostUsd: 0,
            status: "budget_exceeded",
            summary: `Daily budget cap of $${entry.config.dailyBudgetCapUsd} exceeded (spent: $${dailyCost.toFixed(4)})`,
          });

          // Notify user
          this.notifyUser(userId, "heartbeat_budget_exceeded", {
            dailyCost,
            budgetCap: entry.config.dailyBudgetCapUsd,
          });

          // Auto-pause
          this.stopHeartbeat(userId);
          return;
        }
      }

      // Fetch context + pre-warm agent concurrently (single batch of Supabase queries)
      const [heartbeatContent, soulContent, agent] = await Promise.all([
        this.readContextFile(userId, "heartbeat.md"),
        this.readContextFile(userId, "soul.md"),
        this.deps.agentManager.getOrCreateAgent(userId),
      ]);

      if (!heartbeatContent) {
        console.log(`[heartbeat] ${userId}: No heartbeat.md found, skipping`);
        return;
      }

      // Phase 1: Triage — only soul.md for personality, not the full claude.md
      const triage = await this.runTriage(
        userId,
        apiKey,
        heartbeatContent,
        soulContent || "",
        entry.config.triageModel
      );

      if (!triage.escalated) {
        // Nothing to do — log silently
        console.log(`[heartbeat] ${userId}: HEARTBEAT_OK`);
        if (this.deps.activityLogger) {
          this.deps.activityLogger.logHeartbeat({
            userId,
            triageModel: entry.config.triageModel,
            triageTokensIn: triage.tokensIn,
            triageTokensOut: triage.tokensOut,
            escalated: false,
            totalCostUsd: triage.cost,
            status: "ok",
          });
        }
        return;
      }

      // Phase 2: Escalate — run action with Sonnet
      console.log(`[heartbeat] ${userId}: Escalating — ${triage.reason}`);

      this.notifyUser(userId, "heartbeat_escalated", {
        reason: triage.reason,
      });

      const actionResult = await this.runAction(
        agent,
        userId,
        apiKey,
        heartbeatContent,
        triage.reason,
        entry.config.escalationModel
      );

      const totalCost = triage.cost + actionResult.cost;

      // Log the full tick
      if (this.deps.activityLogger) {
        this.deps.activityLogger.logHeartbeat({
          userId,
          triageModel: entry.config.triageModel,
          triageTokensIn: triage.tokensIn,
          triageTokensOut: triage.tokensOut,
          escalated: true,
          actionModel: entry.config.escalationModel,
          actionTokensIn: actionResult.tokensIn,
          actionTokensOut: actionResult.tokensOut,
          totalCostUsd: totalCost,
          summary: actionResult.summary,
          status: "escalated",
        });
      }

      this.notifyUser(userId, "heartbeat_completed", {
        summary: actionResult.summary,
        totalCost,
        triageCost: triage.cost,
        actionCost: actionResult.cost,
      });

    } catch (err) {
      console.error(`[heartbeat] ${userId}: Tick error:`, err);
      if (this.deps.activityLogger) {
        this.deps.activityLogger.logHeartbeat({
          userId,
          triageModel: entry.config.triageModel,
          triageTokensIn: 0,
          triageTokensOut: 0,
          escalated: false,
          totalCostUsd: 0,
          status: "error",
          summary: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      entry.running = false;
    }
  }

  // ── Phase 1: Triage (Haiku, no tools) ──────────────────────────────────────

  private async runTriage(
    userId: string,
    apiKey: string,
    heartbeatContent: string,
    soulContent: string,
    model: string
  ): Promise<TriageResult> {
    const client = new Anthropic({ apiKey });

    // Triage is a cheap yes/no — only needs soul.md for personality, not the full claude.md
    const systemPrompt =
      (soulContent ? `${soulContent}\n\n---\n\n` : "") +
      `You are running in HEARTBEAT TRIAGE MODE.\n` +
      `Your job is to review the heartbeat task list and decide if anything needs attention right now.\n` +
      `If nothing needs action, respond with exactly: HEARTBEAT_OK\n` +
      `If something needs attention, briefly state what needs doing (1-2 sentences).\n` +
      `Do NOT take any actions — just assess.`;

    const response = await client.messages.create({
      model,
      max_tokens: 256,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Current time: ${new Date().toISOString()}\n\n${heartbeatContent}`,
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    const tokensIn = response.usage?.input_tokens || 0;
    const tokensOut = response.usage?.output_tokens || 0;
    const cost = tokensIn * HAIKU_COST_IN + tokensOut * HAIKU_COST_OUT;

    const escalated = !text.includes("HEARTBEAT_OK");

    return {
      escalated,
      reason: escalated ? text : "",
      tokensIn,
      tokensOut,
      cost,
    };
  }

  // ── Phase 2: Action (Sonnet, full tools via runBuild) ──────────────────────

  private async runAction(
    agent: GatewayAgent,
    userId: string,
    apiKey: string,
    heartbeatContent: string,
    triageReason: string,
    model: string
  ): Promise<{ summary: string; tokensIn: number; tokensOut: number; cost: number }> {
    // Set up agent for headless operation
    if (this.deps.legacyBridge) {
      agent.setToolBridge(this.deps.legacyBridge);
    }
    agent.setUserId(userId);
    agent.setToolPermissions(this.deps.toolPermissions);

    const channel = this.deps.userChannels.get(userId);
    agent.setSendFn((payload) => {
      if (channel) {
        try { channel.sendEvent(payload); } catch { /* disconnected */ }
      }
    });
    agent.initOrchestration();

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let summary = "";

    const prompt =
      `You are running in AUTONOMOUS HEARTBEAT MODE — no user is present.\n\n` +
      `Your triage assessment determined the following needs attention:\n` +
      `"${triageReason}"\n\n` +
      `Current heartbeat tasks:\n${heartbeatContent}\n\n` +
      `Current time: ${new Date().toISOString()}\n\n` +
      `Available tools: ${[...HEARTBEAT_ALLOWED_TOOLS].join(", ")}\n` +
      `Any other tools will be denied.\n\n` +
      `Take the necessary actions to address the identified task(s). ` +
      `Be efficient — this is an autonomous tick, not an interactive session.`;

    const onEvent: EventCallback = async (type, payload) => {
      // Forward events to dashboard if connected
      if (channel) {
        try {
          channel.sendEvent({ type, sessionId: "heartbeat", ...payload });
        } catch { /* disconnected */ }
      }

      // Headless approval: only allow tools in the allowlist
      if (type === "proposal") {
        const toolName = payload.tool as string;
        if (HEARTBEAT_ALLOWED_TOOLS.has(toolName)) {
          return { approved: true };
        }
        console.warn(`[heartbeat] Denied tool "${toolName}" in heartbeat mode for user ${userId}`);
        return { approved: false };
      }

      // Track token usage
      if (type === "token_usage") {
        totalTokensIn = (payload.totalIn as number) || totalTokensIn;
        totalTokensOut = (payload.totalOut as number) || totalTokensOut;
      }

      // Log tool calls
      if (type === "tool_call" && this.deps.activityLogger) {
        this.deps.activityLogger.logToolCall({
          userId,
          sessionId: "heartbeat",
          toolName: payload.tool as string,
          toolParams: payload.input as Record<string, unknown>,
          success: true,
        });
      }

      if (type === "done") {
        summary = (payload.summary as string) || "Heartbeat action completed.";
        totalTokensIn = (payload.tokensIn as number) || totalTokensIn;
        totalTokensOut = (payload.tokensOut as number) || totalTokensOut;
      }

      if (type === "error") {
        summary = `Error: ${payload.message}`;
      }

      return null;
    };

    await agent.runBuild({
      prompt,
      apiKey,
      model,
      userId,
      onEvent,
    });

    const cost = totalTokensIn * SONNET_COST_IN + totalTokensOut * SONNET_COST_OUT;

    // Track tokens in hourly rollup
    if (this.deps.activityLogger && (totalTokensIn > 0 || totalTokensOut > 0)) {
      this.deps.activityLogger.incrementHourlyTokens(userId, totalTokensIn, totalTokensOut);
    }

    return { summary, tokensIn: totalTokensIn, tokensOut: totalTokensOut, cost };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Read a context file from Supabase, with filesystem fallback. */
  private async readContextFile(userId: string, filename: string): Promise<string | null> {
    // Try Supabase first
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from("user_context_files")
          .select("content")
          .eq("user_id", userId)
          .eq("filename", filename)
          .single();
        if (!error && data) return data.content;
      } catch {
        // Fall through to filesystem
      }
    }

    // Filesystem fallback
    try {
      const filePath = resolve(this.deps.workspacesPath, userId, "data", "context", filename);
      return readFileSync(filePath, "utf-8");
    } catch {
      try {
        const sharedPath = resolve(this.deps.workspacesPath, "..", "..", "data", "context", filename);
        return readFileSync(sharedPath, "utf-8");
      } catch {
        return null;
      }
    }
  }

  /** Send a WS event to user's channel if connected. */
  private notifyUser(userId: string, type: string, payload: Record<string, unknown>): void {
    const channel = this.deps.userChannels.get(userId);
    if (channel) {
      try {
        channel.sendEvent({
          type,
          sessionId: "heartbeat",
          timestamp: new Date().toISOString(),
          ...payload,
        });
      } catch { /* disconnected — log is the record */ }
    }
  }
}
