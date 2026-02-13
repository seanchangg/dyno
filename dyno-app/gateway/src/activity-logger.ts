/**
 * ActivityLogger — fire-and-forget Supabase inserts for agent activity tracking.
 *
 * Logs tool calls, child session lifecycle, and token usage hourly rollups.
 * All writes are non-blocking with error warnings.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class ActivityLogger {
  private supabase: SupabaseClient;

  constructor() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error("ActivityLogger requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }

    this.supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  /** Log a tool call to agent_activity. */
  logToolCall(params: {
    userId: string;
    sessionId: string;
    toolName: string;
    toolParams?: Record<string, unknown>;
    success: boolean;
    durationMs?: number;
    errorMessage?: string;
  }): void {
    this.supabase
      .from("agent_activity")
      .insert({
        user_id: params.userId,
        session_id: params.sessionId,
        tool_name: params.toolName,
        params: params.toolParams || {},
        success: params.success,
        duration_ms: params.durationMs ?? null,
        error_message: params.errorMessage ?? null,
      })
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] logToolCall error:", error.message);
      });
  }

  /** Upsert a child session record. */
  upsertChildSession(params: {
    userId: string;
    sessionId: string;
    model?: string;
    prompt?: string;
    status: string;
    tokensIn?: number;
    tokensOut?: number;
    completedAt?: string;
  }): void {
    this.supabase
      .from("child_sessions")
      .upsert(
        {
          user_id: params.userId,
          session_id: params.sessionId,
          model: params.model ?? null,
          prompt: params.prompt ? params.prompt.slice(0, 2000) : null,
          status: params.status,
          tokens_in: params.tokensIn ?? 0,
          tokens_out: params.tokensOut ?? 0,
          completed_at: params.completedAt ?? null,
        },
        { onConflict: "session_id" }
      )
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] upsertChildSession error:", error.message);
      });
  }

  /** Increment hourly token usage via RPC. */
  incrementHourlyTokens(userId: string, tokensIn: number, tokensOut: number): void {
    this.supabase
      .rpc("increment_hourly_token_usage", {
        p_user_id: userId,
        p_tokens_in: tokensIn,
        p_tokens_out: tokensOut,
      })
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] incrementHourlyTokens error:", error.message);
      });
  }

  /** Log a heartbeat tick to heartbeat_log. */
  logHeartbeat(params: {
    userId: string;
    triageModel: string;
    triageTokensIn: number;
    triageTokensOut: number;
    escalated: boolean;
    actionModel?: string;
    actionTokensIn?: number;
    actionTokensOut?: number;
    totalCostUsd: number;
    summary?: string;
    status: string;
  }): void {
    this.supabase
      .from("heartbeat_log")
      .insert({
        user_id: params.userId,
        triage_model: params.triageModel,
        triage_tokens_in: params.triageTokensIn,
        triage_tokens_out: params.triageTokensOut,
        escalated: params.escalated,
        action_model: params.actionModel ?? null,
        action_tokens_in: params.actionTokensIn ?? 0,
        action_tokens_out: params.actionTokensOut ?? 0,
        total_cost_usd: params.totalCostUsd,
        summary: params.summary ?? null,
        status: params.status,
      })
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] logHeartbeat error:", error.message);
      });
  }

  /** Get today's heartbeat cost for a user via RPC. */
  async getDailyHeartbeatCost(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .rpc("get_daily_heartbeat_cost", { p_user_id: userId });
    if (error) {
      console.warn("[activity-logger] getDailyHeartbeatCost error:", error.message);
      return 0;
    }
    return Number(data) || 0;
  }

  /** Run cleanup on old activity and child sessions. */
  runCleanup(): void {
    this.supabase
      .rpc("cleanup_old_activity")
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] cleanup_old_activity error:", error.message);
      });

    this.supabase
      .rpc("cleanup_old_child_sessions")
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] cleanup_old_child_sessions error:", error.message);
      });

    this.supabase
      .rpc("cleanup_old_webhooks")
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] cleanup_old_webhooks error:", error.message);
      });

    this.supabase
      .rpc("cleanup_old_heartbeat_logs")
      .then(({ error }) => {
        if (error) console.warn("[activity-logger] cleanup_old_heartbeat_logs error:", error.message);
      });
  }
}
