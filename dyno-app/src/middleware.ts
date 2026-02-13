/**
 * Next.js middleware — authenticates all /api/* requests.
 *
 * Public routes (auth, webhook ingestion) are exempt.
 * Two auth methods:
 *  1. Supabase JWT in Authorization: Bearer <token> (browser)
 *  2. Internal service key in X-Service-Key header (Python tools / Gateway)
 *
 * For JWT-authenticated requests, sets x-authenticated-user-id header
 * so route handlers can trust the user identity.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Routes that handle their own auth
const PUBLIC_API_PREFIXES = [
  "/api/auth/",          // Login / signup
  "/api/webhook/",       // Public webhook ingestion (HMAC auth)
];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Only protect /api/* routes
  if (!path.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip public routes
  if (PUBLIC_API_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return NextResponse.next();
  }

  // ── Method 1: Internal service key ──────────────────────────────────────
  const serviceKey = req.headers.get("x-service-key");
  const expectedKey =
    process.env.INTERNAL_API_KEY ||
    process.env.GATEWAY_KEY_STORE_SECRET ||
    "dyno-dev-secret-change-in-production";

  if (serviceKey) {
    if (serviceKey === expectedKey) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Invalid service key" }, { status: 403 });
  }

  // ── Method 2: Supabase JWT ──────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  if (!token) {
    return NextResponse.json({ error: "Empty token" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // Inject the validated userId into the request headers
    // so route handlers can trust it instead of query params
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-authenticated-user-id", user.id);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  } catch {
    return NextResponse.json({ error: "Token validation failed" }, { status: 401 });
  }
}

export const config = {
  matcher: "/api/:path*",
};
