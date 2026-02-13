"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Card from "@/components/ui/Card";
import { useAuth } from "@/hooks/useAuth";
import { authFetch } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface ActivityRow {
  id: string;
  session_id: string;
  tool_name: string;
  params: Record<string, unknown>;
  success: boolean;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

interface SessionRow {
  id: string;
  session_id: string;
  model: string | null;
  prompt: string | null;
  status: string;
  tokens_in: number;
  tokens_out: number;
  created_at: string;
  completed_at: string | null;
}

interface TokenRow {
  id: string;
  hour: string;
  tokens_in: number;
  tokens_out: number;
  request_count: number;
}

interface HeartbeatRow {
  id: string;
  triggered_at: string;
  triage_model: string;
  triage_tokens_in: number;
  triage_tokens_out: number;
  escalated: boolean;
  action_model: string | null;
  action_tokens_in: number;
  action_tokens_out: number;
  total_cost_usd: number;
  summary: string | null;
  status: string;
}

type Tab = "activity" | "sessions" | "tokens" | "heartbeat";

// ── Hook: useWidgetQuery ─────────────────────────────────────────────────────

function useWidgetQuery<T>(
  table: string,
  params: Record<string, string>,
  intervalMs: number
): { data: T[]; loading: boolean } {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    const qs = new URLSearchParams({ table, ...params }).toString();
    try {
      const res = await authFetch(`/api/widget-query?${qs}`);
      if (!res.ok) return;
      const json = await res.json();
      if (mountedRef.current && json.rows) {
        setData(json.rows);
      }
    } catch {
      // silently ignore fetch errors
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [table, JSON.stringify(params)]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [fetchData, intervalMs]);

  return { data, loading };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "claude-haiku-4-5-20251001": { inPerM: 0.8, outPerM: 4 },
  "claude-sonnet-4-5-20250929": { inPerM: 3, outPerM: 15 },
  "claude-opus-4-20250514": { inPerM: 15, outPerM: 75 },
  "claude-opus-4-6": { inPerM: 15, outPerM: 75 },
};

const DEFAULT_PRICING = MODEL_PRICING["claude-sonnet-4-5-20250929"];

function estimateCost(tokensIn: number, tokensOut: number, model?: string | null): string {
  const pricing = (model && MODEL_PRICING[model]) || DEFAULT_PRICING;
  const cost = (tokensIn * pricing.inPerM + tokensOut * pricing.outPerM) / 1_000_000;
  return `$${cost.toFixed(4)}`;
}

function hourLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

// ── ActivityTab ──────────────────────────────────────────────────────────────

function ActivityTab({ userId }: { userId: string }) {
  const { data, loading } = useWidgetQuery<ActivityRow>(
    "agent_activity",
    { user_id: userId, limit: "100", period: "24h" },
    15_000
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading && data.length === 0) {
    return <div className="text-text/30 text-xs p-4">Loading activity...</div>;
  }

  if (data.length === 0) {
    return <div className="text-text/30 text-xs p-4">No tool activity in the last 24h.</div>;
  }

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-text/40 border-b border-primary/10">
            <th className="text-left py-1.5 px-2 font-medium">Time</th>
            <th className="text-left py-1.5 px-2 font-medium">Tool</th>
            <th className="text-left py-1.5 px-2 font-medium">Session</th>
            <th className="text-center py-1.5 px-2 font-medium">Status</th>
            <th className="text-right py-1.5 px-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <React.Fragment key={row.id}>
              <tr
                className="border-b border-primary/5 hover:bg-primary/5 cursor-pointer transition-colors"
                onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
              >
                <td className="py-1.5 px-2 text-text/50">{relativeTime(row.created_at)}</td>
                <td className="py-1.5 px-2 text-highlight">{row.tool_name}</td>
                <td className="py-1.5 px-2 text-text/40">{row.session_id.slice(0, 12)}</td>
                <td className="py-1.5 px-2 text-center">
                  {row.success ? (
                    <span className="text-highlight">ok</span>
                  ) : (
                    <span className="text-red-400">err</span>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right text-text/50">
                  {row.duration_ms != null ? `${row.duration_ms}ms` : "-"}
                </td>
              </tr>
              {expandedId === row.id && (
                <tr>
                  <td colSpan={5} className="px-2 py-2 bg-background/50">
                    <pre className="text-[10px] text-text/40 whitespace-pre-wrap break-all max-h-32 overflow-auto">
                      {JSON.stringify(row.params, null, 2)}
                    </pre>
                    {row.error_message && (
                      <p className="text-red-400 text-[10px] mt-1">{row.error_message}</p>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SessionsTab ──────────────────────────────────────────────────────────────

function SessionsTab({ userId }: { userId: string }) {
  const { data, loading } = useWidgetQuery<SessionRow>(
    "child_sessions",
    { user_id: userId, limit: "50" },
    15_000
  );

  if (loading && data.length === 0) {
    return <div className="text-text/30 text-xs p-4">Loading sessions...</div>;
  }

  if (data.length === 0) {
    return <div className="text-text/30 text-xs p-4">No child sessions recorded.</div>;
  }

  const statusColor = (s: string) => {
    switch (s) {
      case "running": return "text-secondary";
      case "completed": return "text-highlight";
      case "error": return "text-red-400";
      case "terminated": return "text-text/40";
      default: return "text-text/50";
    }
  };

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-text/40 border-b border-primary/10">
            <th className="text-left py-1.5 px-2 font-medium">Session</th>
            <th className="text-left py-1.5 px-2 font-medium">Model</th>
            <th className="text-center py-1.5 px-2 font-medium">Status</th>
            <th className="text-right py-1.5 px-2 font-medium">Tokens In</th>
            <th className="text-right py-1.5 px-2 font-medium">Tokens Out</th>
            <th className="text-right py-1.5 px-2 font-medium">Cost</th>
            <th className="text-left py-1.5 px-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.id} className="border-b border-primary/5 hover:bg-primary/5 transition-colors">
              <td className="py-1.5 px-2 text-highlight">{row.session_id.slice(0, 14)}</td>
              <td className="py-1.5 px-2 text-text/50">
                {row.model?.replace("claude-", "").replace("-20250929", "").replace("-20251001", "") || "-"}
              </td>
              <td className={`py-1.5 px-2 text-center ${statusColor(row.status)}`}>
                {row.status}
              </td>
              <td className="py-1.5 px-2 text-right text-text/50">{formatTokens(row.tokens_in)}</td>
              <td className="py-1.5 px-2 text-right text-text/50">{formatTokens(row.tokens_out)}</td>
              <td className="py-1.5 px-2 text-right text-text/50">{estimateCost(row.tokens_in, row.tokens_out, row.model)}</td>
              <td className="py-1.5 px-2 text-text/40">{relativeTime(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── TokensTab ────────────────────────────────────────────────────────────────

function TokensTab({ userId }: { userId: string }) {
  const { data, loading } = useWidgetQuery<TokenRow>(
    "token_usage_hourly",
    { user_id: userId, period: "24h", limit: "24" },
    15_000
  );
  const { data: childData } = useWidgetQuery<SessionRow>(
    "child_sessions",
    { user_id: userId, period: "24h", limit: "200" },
    15_000
  );

  // Parent tokens (assumes sonnet default)
  const parentIn = data.reduce((s, r) => s + r.tokens_in, 0);
  const parentOut = data.reduce((s, r) => s + r.tokens_out, 0);
  const parentCost = (parentIn * DEFAULT_PRICING.inPerM + parentOut * DEFAULT_PRICING.outPerM) / 1_000_000;

  // Child tokens with model-weighted cost
  const childIn = childData.reduce((s, r) => s + r.tokens_in, 0);
  const childOut = childData.reduce((s, r) => s + r.tokens_out, 0);
  const childCost = childData.reduce((s, r) => {
    const pricing = (r.model && MODEL_PRICING[r.model]) || DEFAULT_PRICING;
    return s + (r.tokens_in * pricing.inPerM + r.tokens_out * pricing.outPerM) / 1_000_000;
  }, 0);

  const totalIn = parentIn + childIn;
  const totalOut = parentOut + childOut;
  const totalCost = parentCost + childCost;
  const totalRequests = data.reduce((s, r) => s + r.request_count, 0);
  const maxTokens = Math.max(...data.map((r) => r.tokens_in + r.tokens_out), 1);

  if (loading && data.length === 0) {
    return <div className="text-text/30 text-xs p-4">Loading token usage...</div>;
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-auto">
      {/* Summary row */}
      <div className="grid grid-cols-4 gap-2 px-1">
        <div>
          <div className="text-text/40 text-[10px] font-medium">Tokens In</div>
          <div className="text-highlight text-sm font-semibold">{formatTokens(totalIn)}</div>
        </div>
        <div>
          <div className="text-text/40 text-[10px] font-medium">Tokens Out</div>
          <div className="text-highlight text-sm font-semibold">{formatTokens(totalOut)}</div>
        </div>
        <div>
          <div className="text-text/40 text-[10px] font-medium">Est. Cost</div>
          <div className="text-highlight text-sm font-semibold">${totalCost.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-text/40 text-[10px] font-medium">Requests</div>
          <div className="text-highlight text-sm font-semibold">{totalRequests}</div>
        </div>
      </div>

      {/* Cost breakdown if there are children */}
      {childData.length > 0 && (
        <div className="grid grid-cols-2 gap-2 px-1 text-[10px] font-mono">
          <div className="text-text/40">Parent: ${parentCost.toFixed(4)}</div>
          <div className="text-text/40">Children ({childData.length}): ${childCost.toFixed(4)}</div>
        </div>
      )}

      {/* Hourly bar chart */}
      {data.length === 0 ? (
        <div className="text-text/30 text-xs px-1">No hourly data yet.</div>
      ) : (
        <div className="flex flex-col gap-1 px-1 flex-1 min-h-0 overflow-auto">
          <div className="text-text/40 text-[10px] font-medium mb-1">Last 24h (hourly)</div>
          {data.map((row) => {
            const total = row.tokens_in + row.tokens_out;
            const pct = (total / maxTokens) * 100;
            return (
              <div key={row.id} className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-text/40 w-10 shrink-0">{hourLabel(row.hour)}</span>
                <div className="flex-1 h-3 bg-primary/10 relative">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-text/50 w-12 text-right shrink-0">{formatTokens(total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── HeartbeatTab ─────────────────────────────────────────────────────────────

function HeartbeatTab({ userId }: { userId: string }) {
  const { data, loading } = useWidgetQuery<HeartbeatRow>(
    "heartbeat_log",
    { user_id: userId, limit: "50", period: "24h" },
    15_000
  );

  const todayCost = data.reduce((s, r) => s + Number(r.total_cost_usd), 0);
  const totalTicks = data.length;
  const escalations = data.filter((r) => r.escalated).length;

  const statusColor = (s: string) => {
    switch (s) {
      case "ok": return "text-highlight";
      case "escalated": return "text-secondary";
      case "error": return "text-red-400";
      case "budget_exceeded": return "text-red-400";
      default: return "text-text/50";
    }
  };

  if (loading && data.length === 0) {
    return <div className="text-text/30 text-xs p-4">Loading heartbeat log...</div>;
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-auto">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 px-1">
        <div>
          <div className="text-text/40 text-[10px] font-medium">Today&apos;s Cost</div>
          <div className="text-highlight text-sm font-semibold">${todayCost.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-text/40 text-[10px] font-medium">Ticks (24h)</div>
          <div className="text-highlight text-sm font-semibold">{totalTicks}</div>
        </div>
        <div>
          <div className="text-text/40 text-[10px] font-medium">Escalations</div>
          <div className="text-secondary text-sm font-semibold">{escalations}</div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-text/30 text-xs px-1">No heartbeat ticks in the last 24h.</div>
      ) : (
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-text/40 border-b border-primary/10">
              <th className="text-left py-1.5 px-2 font-medium">Time</th>
              <th className="text-center py-1.5 px-2 font-medium">Status</th>
              <th className="text-right py-1.5 px-2 font-medium">Cost</th>
              <th className="text-left py-1.5 px-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.id} className="border-b border-primary/5 hover:bg-primary/5 transition-colors">
                <td className="py-1.5 px-2 text-text/50">{relativeTime(row.triggered_at)}</td>
                <td className={`py-1.5 px-2 text-center ${statusColor(row.status)}`}>
                  {row.status}
                </td>
                <td className="py-1.5 px-2 text-right text-text/50">
                  ${Number(row.total_cost_usd).toFixed(4)}
                </td>
                <td className="py-1.5 px-2 text-text/40 truncate max-w-[200px]">
                  {row.summary || (row.status === "ok" ? "HEARTBEAT_OK" : "-")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main Widget ──────────────────────────────────────────────────────────────

function AgentControlWidget() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("activity");

  if (!user) {
    return (
      <Card className="h-full flex items-center justify-center">
        <span className="text-text/30 text-xs">Sign in to view agent control</span>
      </Card>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "activity", label: "Activity" },
    { key: "sessions", label: "Sessions" },
    { key: "tokens", label: "Tokens" },
    { key: "heartbeat", label: "Heartbeat" },
  ];

  return (
    <Card className="h-full flex flex-col gap-0 p-0 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-primary/20 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.key
                ? "text-highlight border-b-2 border-highlight"
                : "text-text/40 hover:text-text/60"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden p-2">
        {activeTab === "activity" && <ActivityTab userId={user.id} />}
        {activeTab === "sessions" && <SessionsTab userId={user.id} />}
        {activeTab === "tokens" && <TokensTab userId={user.id} />}
        {activeTab === "heartbeat" && <HeartbeatTab userId={user.id} />}
      </div>
    </Card>
  );
}

export default React.memo(AgentControlWidget);
