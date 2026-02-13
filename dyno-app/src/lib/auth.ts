/**
 * Server-side auth utilities for API routes.
 *
 * The middleware (src/middleware.ts) handles authentication and sets
 * x-authenticated-user-id on validated JWT requests.
 *
 * Routes use getAuthUserId() to get the trusted user identity.
 */

import { NextRequest } from "next/server";

/**
 * Get the authenticated user ID from a request.
 *
 * For JWT requests: reads x-authenticated-user-id set by middleware.
 * For service-key requests: falls back to userId query param (trusted by middleware).
 *
 * Returns null if no userId is available.
 */
export function getAuthUserId(req: NextRequest): string | null {
  // Middleware sets this header after validating the JWT
  const fromMiddleware = req.headers.get("x-authenticated-user-id");
  if (fromMiddleware) return fromMiddleware;

  // Service-key requests pass userId in query params (middleware already validated the key)
  return req.nextUrl.searchParams.get("userId");
}
