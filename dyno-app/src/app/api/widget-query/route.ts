import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

const ALLOWED_TABLES = new Set(["agent_activity", "child_sessions", "token_usage_hourly"]);
const MAX_LIMIT = 200;

/**
 * GET /api/widget-query?table=...&user_id=...&limit=50&tool_name=...&period=24h&status=...
 *
 * Generic read-only query endpoint for the agent-control widget.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const table = searchParams.get("table");
  const userId = getAuthUserId(req);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), MAX_LIMIT);
  const toolName = searchParams.get("tool_name");
  const status = searchParams.get("status");
  const period = searchParams.get("period") || "24h";

  if (!table || !ALLOWED_TABLES.has(table)) {
    return NextResponse.json(
      { error: `Invalid table. Allowed: ${[...ALLOWED_TABLES].join(", ")}` },
      { status: 400 }
    );
  }

  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const cutoff = new Date(Date.now() - parsePeriodMs(period)).toISOString();

  if (table === "agent_activity") {
    let query = supabase
      .from("agent_activity")
      .select("id, session_id, tool_name, params, success, duration_ms, error_message, created_at")
      .eq("user_id", userId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (toolName) {
      query = query.eq("tool_name", toolName);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: data }, cacheHeaders());
  }

  if (table === "child_sessions") {
    let query = supabase
      .from("child_sessions")
      .select("id, session_id, model, prompt, status, tokens_in, tokens_out, created_at, completed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: data }, cacheHeaders());
  }

  if (table === "token_usage_hourly") {
    const { data, error } = await supabase
      .from("token_usage_hourly")
      .select("id, hour, tokens_in, tokens_out, request_count")
      .eq("user_id", userId)
      .gte("hour", cutoff)
      .order("hour", { ascending: true })
      .limit(limit);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ rows: data }, cacheHeaders());
  }

  return NextResponse.json({ error: "Unhandled table" }, { status: 400 });
}

function parsePeriodMs(period: string): number {
  switch (period) {
    case "24h": return 24 * 60 * 60 * 1000;
    case "7d": return 7 * 24 * 60 * 60 * 1000;
    case "30d": return 30 * 24 * 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000;
  }
}

function cacheHeaders(): { headers: Record<string, string> } {
  return {
    headers: {
      "Cache-Control": "s-maxage=3, stale-while-revalidate",
    },
  };
}
