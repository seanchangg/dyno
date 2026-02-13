/**
 * Widget execution proxy — same-origin route that forwards to the Gateway.
 *
 * Widgets rendered in sandboxed iframes (src mode, allow-same-origin) can
 * fetch this endpoint to execute saved backend scripts via the gateway.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";

const GATEWAY_HTTP_URL = process.env.NEXT_PUBLIC_GATEWAY_URL
  ? process.env.NEXT_PUBLIC_GATEWAY_URL.replace("ws://", "http://").replace("wss://", "https://")
  : "http://localhost:18789";

/** Extract userId from Referer URL query params (widget iframes include it). */
function userIdFromReferer(req: NextRequest): string {
  const referer = req.headers.get("referer") || "";
  try {
    const url = new URL(referer);
    return url.searchParams.get("userId") || "";
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Prefer auth-derived userId, fall back to body/header/referer for widget iframes
    const userId =
      getAuthUserId(req) ||
      body.userId ||
      req.headers.get("x-user-id") ||
      userIdFromReferer(req) ||
      "";
    const payload = { ...body, userId };

    const gatewayRes = await fetch(`${GATEWAY_HTTP_URL}/api/widget-exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(135_000), // slightly above max script timeout (120s)
    });

    const data = await gatewayRes.json();
    if (gatewayRes.status >= 400) {
      console.error(`[widget-exec proxy] ${gatewayRes.status} from gateway. Script: "${body.script}", keys: [${Object.keys(body).join(", ")}], response:`, data);
    }
    return NextResponse.json(data, { status: gatewayRes.status });
  } catch (err) {
    console.error("[widget-exec proxy] Gateway fetch failed:", err);
    return NextResponse.json(
      { error: "Gateway not available" },
      { status: 503 },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-User-Id",
    },
  });
}
