/**
 * Skills API proxy — forwards requests to the Gateway's skills API.
 */

import { NextRequest, NextResponse } from "next/server";

const GATEWAY_HTTP_URL = process.env.NEXT_PUBLIC_GATEWAY_URL
  ? process.env.NEXT_PUBLIC_GATEWAY_URL.replace("ws://", "http://").replace("wss://", "https://")
  : "http://localhost:18789";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    // Translate ?path=/user/{id} into the Gateway's /api/skills/user/{id} route
    const pathParam = url.searchParams.get("path");
    const gatewayPath = pathParam
      ? `/api/skills${pathParam}`
      : "/api/skills";
    const gatewayUrl = `${GATEWAY_HTTP_URL}${gatewayPath}`;
    const res = await fetch(gatewayUrl, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Translate action-based format to Gateway's path-based routes
    // Frontend sends: { skillId, userId, action: "install"|"uninstall" }
    // Gateway expects: POST /api/skills/{id}/install with { userId }
    let gatewayUrl: string;
    let gatewayBody: string;

    if (body.skillId && body.action) {
      const action = body.action === "uninstall" ? "uninstall" : "install";
      gatewayUrl = `${GATEWAY_HTTP_URL}/api/skills/${encodeURIComponent(body.skillId)}/${action}`;
      gatewayBody = JSON.stringify({ userId: body.userId });
    } else if (body.action === "refresh") {
      gatewayUrl = `${GATEWAY_HTTP_URL}/api/skills/refresh`;
      gatewayBody = "{}";
    } else {
      gatewayUrl = `${GATEWAY_HTTP_URL}/api/skills`;
      gatewayBody = JSON.stringify(body);
    }

    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: gatewayBody,
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}
