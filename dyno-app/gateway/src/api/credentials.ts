/**
 * Credential vault API — store/retrieve/list/delete user credentials.
 *
 * POST   /api/credentials           — store or update a credential
 * GET    /api/credentials?userId=X  — list credential names
 * DELETE /api/credentials           — remove a credential
 * POST   /api/credentials/retrieve  — decrypt and return value (internal)
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { CredentialStore } from "../auth/credential-store.js";
import type { SupabaseVerifier } from "../auth/supabase-verifier.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface CredentialsDeps {
  credentialStore: CredentialStore;
  verifier: SupabaseVerifier | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 65_536; // 64 KB
const CREDENTIAL_NAME_RE = /^[A-Z0-9_]{1,64}$/;

// ── Auth helper ─────────────────────────────────────────────────────────────

/**
 * Verify the request's Authorization header and return the authenticated userId.
 * Returns null and sends a 401 response if auth fails.
 */
function authenticateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  verifier: SupabaseVerifier | null,
): string | null {
  if (!verifier) {
    // No verifier configured — allow (dev mode). userId comes from body/query.
    return "__skip__";
  }

  const authHeader = req.headers["authorization"] || "";
  if (!authHeader.startsWith("Bearer ")) {
    sendJson(res, 401, { error: "Missing Authorization header" });
    return null;
  }

  const result = verifier.verify(authHeader.slice(7));
  if (!result.valid || !result.userId) {
    sendJson(res, 401, { error: result.error || "Invalid token" });
    return null;
  }

  return result.userId;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleCredentialsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CredentialsDeps,
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "GET";

  if (!url.startsWith("/api/credentials")) return false;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-User-Id, Authorization",
    });
    res.end();
    return true;
  }

  // Authenticate — all credential endpoints require a valid JWT
  const authedUserId = authenticateRequest(req, res, deps.verifier);
  if (authedUserId === null) return true; // 401 already sent

  // POST /api/credentials/retrieve — decrypt and return value
  if (url.startsWith("/api/credentials/retrieve") && method === "POST") {
    return handleRetrieve(req, res, deps, authedUserId);
  }

  // POST /api/credentials — store credential
  if (method === "POST") {
    return handleStore(req, res, deps, authedUserId);
  }

  // GET /api/credentials?userId=X — list credential names
  if (method === "GET") {
    return handleList(req, res, deps, authedUserId);
  }

  // DELETE /api/credentials — remove credential
  if (method === "DELETE") {
    return handleRemove(req, res, deps, authedUserId);
  }

  sendJson(res, 405, { error: "Method not allowed" });
  return true;
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleStore(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CredentialsDeps,
  authedUserId: string,
): Promise<boolean> {
  const body = await parseBody(req, res);
  if (!body) return true;

  const { userId, name, value } = body;
  if (!userId || !name || !value) {
    sendJson(res, 400, { error: "userId, name, and value are required" });
    return true;
  }

  // Enforce: JWT userId must match request userId
  if (authedUserId !== "__skip__" && authedUserId !== userId) {
    sendJson(res, 403, { error: "userId does not match authenticated user" });
    return true;
  }

  if (!CREDENTIAL_NAME_RE.test(name)) {
    sendJson(res, 400, {
      error: `Invalid credential name "${name}" — must match /^[A-Z0-9_]{1,64}$/`,
    });
    return true;
  }

  try {
    await deps.credentialStore.store(userId, name, value);
    sendJson(res, 200, { ok: true, name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Store failed";
    sendJson(res, 500, { error: message });
  }
  return true;
}

async function handleList(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CredentialsDeps,
  authedUserId: string,
): Promise<boolean> {
  const parsed = new URL(req.url || "", "http://localhost");
  const userId = parsed.searchParams.get("userId");

  if (!userId) {
    sendJson(res, 400, { error: "userId query parameter required" });
    return true;
  }

  if (authedUserId !== "__skip__" && authedUserId !== userId) {
    sendJson(res, 403, { error: "userId does not match authenticated user" });
    return true;
  }

  try {
    const credentials = await deps.credentialStore.list(userId);
    sendJson(res, 200, { credentials });
  } catch (err) {
    const message = err instanceof Error ? err.message : "List failed";
    sendJson(res, 500, { error: message });
  }
  return true;
}

async function handleRemove(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CredentialsDeps,
  authedUserId: string,
): Promise<boolean> {
  const body = await parseBody(req, res);
  if (!body) return true;

  const { userId, name } = body;
  if (!userId || !name) {
    sendJson(res, 400, { error: "userId and name are required" });
    return true;
  }

  if (authedUserId !== "__skip__" && authedUserId !== userId) {
    sendJson(res, 403, { error: "userId does not match authenticated user" });
    return true;
  }

  try {
    const removed = await deps.credentialStore.remove(userId, name);
    sendJson(res, 200, { ok: true, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Remove failed";
    sendJson(res, 500, { error: message });
  }
  return true;
}

async function handleRetrieve(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CredentialsDeps,
  authedUserId: string,
): Promise<boolean> {
  const body = await parseBody(req, res);
  if (!body) return true;

  const { userId, name } = body;
  if (!userId || !name) {
    sendJson(res, 400, { error: "userId and name are required" });
    return true;
  }

  if (authedUserId !== "__skip__" && authedUserId !== userId) {
    sendJson(res, 403, { error: "userId does not match authenticated user" });
    return true;
  }

  try {
    const value = await deps.credentialStore.retrieve(userId, name);
    if (value === null) {
      sendJson(res, 404, { error: `Credential "${name}" not found` });
    } else {
      sendJson(res, 200, { name, value });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Retrieve failed";
    sendJson(res, 500, { error: message });
  }
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function parseBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Record<string, string> | null> {
  let rawBody: string;
  try {
    rawBody = await readBody(req, MAX_BODY_BYTES);
  } catch {
    sendJson(res, 413, { error: "Payload too large" });
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON" });
    return null;
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}
