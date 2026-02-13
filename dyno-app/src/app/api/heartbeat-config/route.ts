import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";

/**
 * Thin proxy: forwards heartbeat config from frontend to gateway's
 * internal HTTP endpoint POST /internal/heartbeat-config.
 */

const GATEWAY_HTTP_URL =
  (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://localhost:18789")
    .replace("ws://", "http://")
    .replace("wss://", "https://");

const INTERNAL_SECRET =
  process.env.WEBHOOK_INTERNAL_SECRET ||
  process.env.GATEWAY_KEY_STORE_SECRET ||
  "dyno-dev-secret-change-in-production";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const userId = getAuthUserId(req) || body.userId;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { action, config, apiKey } = body;

  if (!action || !["start", "stop", "status"].includes(action)) {
    return NextResponse.json(
      { error: "action must be start, stop, or status" },
      { status: 400 }
    );
  }

  try {
    // Forward to gateway — include apiKey only on start (server-side persistence for autonomous mode)
    const payload: Record<string, unknown> = { action, userId, config };
    if (action === "start" && apiKey) {
      payload.apiKey = apiKey;
    }

    const res = await fetch(`${GATEWAY_HTTP_URL}/internal/heartbeat-config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: `Gateway returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: `Gateway unreachable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}
