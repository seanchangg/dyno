/**
 * Credential vault proxy — forwards to the Gateway credentials API.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthUserId } from "@/lib/auth";

const GATEWAY_HTTP_URL = process.env.NEXT_PUBLIC_GATEWAY_URL
  ? process.env.NEXT_PUBLIC_GATEWAY_URL.replace("ws://", "http://").replace("wss://", "https://")
  : "http://localhost:18789";

export async function GET(req: NextRequest) {
  try {
    const userId = getAuthUserId(req) || "";
    const gatewayRes = await fetch(
      `${GATEWAY_HTTP_URL}/api/credentials?userId=${encodeURIComponent(userId)}`,
      { headers: { "Content-Type": "application/json" } },
    );
    const data = await gatewayRes.json();
    return NextResponse.json(data, { status: gatewayRes.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const gatewayRes = await fetch(`${GATEWAY_HTTP_URL}/api/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await gatewayRes.json();
    return NextResponse.json(data, { status: gatewayRes.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const gatewayRes = await fetch(`${GATEWAY_HTTP_URL}/api/credentials`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await gatewayRes.json();
    return NextResponse.json(data, { status: gatewayRes.status });
  } catch {
    return NextResponse.json({ error: "Gateway not available" }, { status: 503 });
  }
}
