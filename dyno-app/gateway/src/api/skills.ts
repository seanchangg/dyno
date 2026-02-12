/**
 * Skills API endpoints for the Gateway.
 *
 * Handles skill listing, installation, and detail retrieval.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { SkillRegistry } from "../skills/registry.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface SkillsApiDeps {
  registry: SkillRegistry;
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function handleSkillsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SkillsApiDeps
): Promise<boolean> {
  const url = req.url || "";
  const method = req.method || "GET";

  // CORS preflight
  if (method === "OPTIONS" && url.startsWith("/api/skills")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return true;
  }

  // GET /api/skills — list all available skills
  if (method === "GET" && url === "/api/skills") {
    const skills = deps.registry.listAvailable();
    sendJson(res, 200, { skills, count: skills.length });
    return true;
  }

  // GET /api/skills/:id — get skill detail
  const detailMatch = url.match(/^\/api\/skills\/([^/]+)$/);
  if (method === "GET" && detailMatch) {
    const skillId = decodeURIComponent(detailMatch[1]);
    const skill = deps.registry.getSkill(skillId);
    if (skill) {
      sendJson(res, 200, skill);
    } else {
      sendJson(res, 404, { error: `Skill ${skillId} not found` });
    }
    return true;
  }

  // POST /api/skills/:id/install — install a skill for a user
  const installMatch = url.match(/^\/api\/skills\/([^/]+)\/install$/);
  if (method === "POST" && installMatch) {
    const skillId = decodeURIComponent(installMatch[1]);
    const body = await readBody(req);
    const { userId } = JSON.parse(body);

    if (!userId) {
      sendJson(res, 400, { error: "userId is required" });
      return true;
    }

    const success = deps.registry.install(userId, skillId);
    if (success) {
      sendJson(res, 200, { status: "installed", skillId, userId });
    } else {
      sendJson(res, 404, { error: `Skill ${skillId} not found` });
    }
    return true;
  }

  // POST /api/skills/:id/uninstall — uninstall a skill for a user
  const uninstallMatch = url.match(/^\/api\/skills\/([^/]+)\/uninstall$/);
  if (method === "POST" && uninstallMatch) {
    const skillId = decodeURIComponent(uninstallMatch[1]);
    const body = await readBody(req);
    const { userId } = JSON.parse(body);

    if (!userId) {
      sendJson(res, 400, { error: "userId is required" });
      return true;
    }

    const success = deps.registry.uninstall(userId, skillId);
    sendJson(res, 200, { status: success ? "uninstalled" : "not_installed", skillId, userId });
    return true;
  }

  // GET /api/skills/user/:userId — get installed skills for a user
  const userMatch = url.match(/^\/api\/skills\/user\/([^/]+)$/);
  if (method === "GET" && userMatch) {
    const userId = decodeURIComponent(userMatch[1]);
    const installed = deps.registry.getInstalledSkillIds(userId);
    sendJson(res, 200, { userId, installed, count: installed.length });
    return true;
  }

  // POST /api/skills/refresh — reload skills from disk
  if (method === "POST" && url === "/api/skills/refresh") {
    deps.registry.refresh();
    const skills = deps.registry.listAvailable();
    sendJson(res, 200, { status: "refreshed", count: skills.length });
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
