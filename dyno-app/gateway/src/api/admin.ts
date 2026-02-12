/**
 * Admin API endpoints for workspace management.
 *
 * These are HTTP endpoints served alongside the WebSocket server
 * for administrative operations like workspace provisioning.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { WorkspaceManager } from "../workspace.js";
import type { AgentManager } from "../agent-manager.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface AdminApiDeps {
  workspace: WorkspaceManager;
  agentManager: AgentManager;
}

// ── Route handler ────────────────────────────────────────────────────────────

/**
 * Handle admin HTTP requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminApiDeps
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "GET";

  // CORS preflight
  if (method === "OPTIONS" && url.startsWith("/admin/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  // POST /admin/workspace/provision
  if (method === "POST" && url === "/admin/workspace/provision") {
    const body = await readBody(req);
    const { userId } = JSON.parse(body);

    if (!userId) {
      sendJson(res, 400, { error: "userId is required" });
      return true;
    }

    const path = deps.workspace.provision(userId);
    sendJson(res, 200, { status: "provisioned", userId, path });
    return true;
  }

  // GET /admin/workspace/:userId/status
  const statusMatch = url.match(/^\/admin\/workspace\/([^/]+)\/status$/);
  if (method === "GET" && statusMatch) {
    const userId = decodeURIComponent(statusMatch[1]);
    const status = deps.workspace.getStatus(userId);
    sendJson(res, 200, { userId, ...status });
    return true;
  }

  // DELETE /admin/workspace/:userId
  const deleteMatch = url.match(/^\/admin\/workspace\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const userId = decodeURIComponent(deleteMatch[1]);

    // Remove agent first
    deps.agentManager.removeAgent(userId);

    const deleted = deps.workspace.teardown(userId);
    if (deleted) {
      sendJson(res, 200, { status: "deleted", userId });
    } else {
      sendJson(res, 404, { error: "Workspace not found", userId });
    }
    return true;
  }

  // GET /admin/agents — list active agents
  if (method === "GET" && url === "/admin/agents") {
    const users = deps.agentManager.getActiveUsers();
    sendJson(res, 200, {
      activeAgents: users.length,
      users,
    });
    return true;
  }

  // GET /admin/workspaces — list all provisioned workspaces
  if (method === "GET" && url === "/admin/workspaces") {
    const users = deps.workspace.listUsers();
    sendJson(res, 200, {
      count: users.length,
      users,
    });
    return true;
  }

  return false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
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
