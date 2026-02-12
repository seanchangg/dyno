/**
 * Tool permissions API — proxies to the Gateway's tool-permissions endpoint.
 */

import { NextRequest, NextResponse } from "next/server";

const GATEWAY_HTTP_URL = process.env.NEXT_PUBLIC_GATEWAY_URL
  ? process.env.NEXT_PUBLIC_GATEWAY_URL.replace("ws://", "http://").replace("wss://", "https://")
  : "http://localhost:18789";

const GATEWAY_PERMS_URL = `${GATEWAY_HTTP_URL}/api/tool-permissions`;

export async function GET() {
  try {
    const res = await fetch(GATEWAY_PERMS_URL, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(GATEWAY_PERMS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}

export async function DELETE() {
  try {
    const res = await fetch(GATEWAY_PERMS_URL, {
      method: "DELETE",
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}
