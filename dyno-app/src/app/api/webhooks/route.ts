/**
 * Webhook management API — CRUD for webhook_endpoints and polling webhook_queue.
 *
 * Used by the agent's Python tools to register, list, poll, and delete webhooks.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthUserId } from "@/lib/auth";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/**
 * GET /api/webhooks?userId=...&action=poll&endpointName=...
 *
 * action=list (default): List all webhook endpoints for a user.
 * action=poll: Fetch unprocessed webhook payloads, optionally filtered by endpointName.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = getAuthUserId(req);
  const action = searchParams.get("action") || "list";

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  if (action === "config") {
    const { data, error } = await supabase
      .from("webhook_config")
      .select("hourly_token_cap, rate_limit_per_hour, updated_at")
      .eq("user_id", userId)
      .single();

    if (error && error.code !== "PGRST116") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      config: data || { hourly_token_cap: null, rate_limit_per_hour: 100 },
    });
  }

  if (action === "poll") {
    const endpointName = searchParams.get("endpointName");

    let query = supabase
      .from("webhook_queue")
      .select("id, endpoint_name, payload, headers, received_at")
      .eq("user_id", userId)
      .eq("processed", false)
      .order("received_at", { ascending: true })
      .limit(50);

    if (endpointName) {
      query = query.eq("endpoint_name", endpointName);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Mark polled items as processed
    if (data && data.length > 0) {
      const ids = data.map((row) => row.id);
      await supabase
        .from("webhook_queue")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .in("id", ids);
    }

    return NextResponse.json({ webhooks: data });
  }

  // Default: list endpoints
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("id, endpoint_name, enabled, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Attach public URLs
  const endpoints = (data || []).map((ep) => ({
    ...ep,
    url: `${FRONTEND_URL}/api/webhook/${userId}/${ep.endpoint_name}`,
  }));

  return NextResponse.json({ endpoints });
}

/**
 * POST /api/webhooks
 * Register a new webhook endpoint.
 * Body: { userId, endpointName, secret }
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = getAuthUserId(req) || body.userId;
  const { endpointName, secret } = body;

  if (!userId || !endpointName || !secret) {
    return NextResponse.json(
      { error: "userId, endpointName, and secret are required" },
      { status: 400 }
    );
  }

  // Validate endpointName: alphanumeric, hyphens, underscores only
  if (!/^[a-zA-Z0-9_-]+$/.test(endpointName)) {
    return NextResponse.json(
      { error: "endpointName must contain only alphanumeric characters, hyphens, and underscores" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // Upsert: update secret if endpoint already exists
  const { data: existing } = await supabase
    .from("webhook_endpoints")
    .select("id")
    .eq("user_id", userId)
    .eq("endpoint_name", endpointName)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("webhook_endpoints")
      .update({ secret, enabled: true })
      .eq("id", existing.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      action: "updated",
      url: `${FRONTEND_URL}/api/webhook/${userId}/${endpointName}`,
    });
  }

  const { error } = await supabase
    .from("webhook_endpoints")
    .insert({ user_id: userId, endpoint_name: endpointName, secret });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    action: "created",
    url: `${FRONTEND_URL}/api/webhook/${userId}/${endpointName}`,
  });
}

/**
 * PATCH /api/webhooks
 * Update webhook config (token cap, rate limit).
 * Body: { userId, hourlyTokenCap?, rateLimitPerHour? }
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const userId = getAuthUserId(req) || body.userId;
  const { hourlyTokenCap, rateLimitPerHour } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (hourlyTokenCap !== undefined) {
    updates.hourly_token_cap = hourlyTokenCap === null ? null : Number(hourlyTokenCap);
  }
  if (rateLimitPerHour !== undefined) {
    updates.rate_limit_per_hour = Math.max(1, Math.min(10000, Number(rateLimitPerHour)));
  }

  const { error } = await supabase
    .from("webhook_config")
    .upsert(
      { user_id: userId, ...updates },
      { onConflict: "user_id" }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/webhooks?userId=...&endpointName=...
 * Delete a webhook endpoint and its queued payloads.
 */
export async function DELETE(req: NextRequest) {
  const userId = getAuthUserId(req);
  const endpointName = req.nextUrl.searchParams.get("endpointName");

  if (!userId || !endpointName) {
    return NextResponse.json(
      { error: "userId and endpointName are required" },
      { status: 400 }
    );
  }

  const supabase = createServerSupabaseClient();

  // Delete queued payloads first
  await supabase
    .from("webhook_queue")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint_name", endpointName);

  // Delete the endpoint
  const { error } = await supabase
    .from("webhook_endpoints")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint_name", endpointName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
