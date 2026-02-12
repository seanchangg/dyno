/**
 * Supabase JWT verifier for Gateway WebSocket authentication.
 *
 * Validates JWTs from the Dyno frontend to resolve the userId
 * and route to the correct per-user agent.
 */

import { createHmac } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────────

interface JwtPayload {
  sub: string;       // Supabase user ID
  aud: string;       // Audience
  exp: number;       // Expiration timestamp
  iat: number;       // Issued at
  email?: string;
  role?: string;
}

export interface VerifyResult {
  valid: boolean;
  userId: string | null;
  email: string | null;
  error: string | null;
}

// ── SupabaseVerifier ─────────────────────────────────────────────────────────

export class SupabaseVerifier {
  private jwtSecret: string;

  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }

  /**
   * Verify a Supabase JWT token.
   * Returns the userId (sub claim) if valid.
   */
  verify(token: string): VerifyResult {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return { valid: false, userId: null, email: null, error: "Invalid JWT format" };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Verify signature using HMAC-SHA256
      const data = `${headerB64}.${payloadB64}`;
      const expectedSig = createHmac("sha256", this.jwtSecret)
        .update(data)
        .digest("base64url");

      if (expectedSig !== signatureB64) {
        return { valid: false, userId: null, email: null, error: "Invalid signature" };
      }

      // Decode payload
      const payload: JwtPayload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf-8")
      );

      // Check expiration
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return { valid: false, userId: null, email: null, error: "Token expired" };
      }

      return {
        valid: true,
        userId: payload.sub,
        email: payload.email || null,
        error: null,
      };
    } catch (err) {
      return {
        valid: false,
        userId: null,
        email: null,
        error: `Verification error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Extract token from WebSocket connection URL query params.
   * Expected format: ws://host:port?token=JWT_TOKEN
   */
  static extractTokenFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url, "http://localhost");
      return parsed.searchParams.get("token");
    } catch {
      return null;
    }
  }

  /**
   * Extract token from WebSocket upgrade headers.
   * Checks Authorization: Bearer TOKEN header.
   */
  static extractTokenFromHeaders(headers: Record<string, string>): string | null {
    const auth = headers["authorization"] || headers["Authorization"];
    if (auth && auth.startsWith("Bearer ")) {
      return auth.slice(7);
    }
    return null;
  }
}
