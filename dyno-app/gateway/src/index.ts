/**
 * Dyno Gateway — WebSocket server entry point.
 *
 * Starts on port 18789 (configurable via openclaw.json or env).
 * Handles HTTP health checks, admin API, and WebSocket connections.
 * Each connection gets a DynoDashboardChannel that bridges
 * between the frontend message format and the GatewayAgent.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { GatewayAgent } from "./agent.js";
import { DynoDashboardChannel } from "./channels/dyno-dashboard.js";
import { LegacyToolBridge } from "./tools/dyno-legacy.js";
import { WorkspaceManager } from "./workspace.js";
import { AgentManager } from "./agent-manager.js";
import { KeyStore } from "./auth/key-store.js";
import { SupabaseVerifier } from "./auth/supabase-verifier.js";
import { handleAdminRequest } from "./api/admin.js";
import { handleSkillsRequest } from "./api/skills.js";
import { SkillRegistry } from "./skills/registry.js";
import { SkillLoader } from "./skills/loader.js";
import { ToolPermissions } from "./tool-permissions.js";
import { ORCHESTRATION_TOOL_DEFS, ORCHESTRATION_TOOL_NAMES, ORCHESTRATION_AUTO_APPROVED } from "./orchestration.js";

// ── Config ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "..", "openclaw.json");

interface GatewayConfig {
  agent: { model: string; maxTokens: number; maxIterations: number };
  server: { port: number; host: string };
  mcpServers: Record<string, { url: string; description: string }>;
  workspacePath?: string;
}

function loadConfig(): GatewayConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      agent: { model: "claude-sonnet-4-5-20250929", maxTokens: 8192, maxIterations: 15 },
      server: { port: 18789, host: "localhost" },
      mcpServers: {},
    };
  }
}

// ── State ────────────────────────────────────────────────────────────────────

let activeConnections = 0;
const serverStartTime = Date.now();

// ── Health check handler ─────────────────────────────────────────────────────

interface HealthContext {
  agentManager: AgentManager;
  legacyBridge: LegacyToolBridge | null;
  toolPermissions: ToolPermissions;
}

function handleHealthCheck(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: HealthContext
): boolean {
  if (req.url !== "/health") return false;

  // Build tool list from legacy bridge + orchestration
  const defaultAutoApproved = new Set<string>();
  const legacyTools = ctx.legacyBridge?.getToolDefinitions() ?? [];
  const legacyReadOnly = ctx.legacyBridge?.getReadOnlyTools() ?? new Set<string>();

  // Merge read-only sets
  for (const name of legacyReadOnly) defaultAutoApproved.add(name);
  for (const name of ORCHESTRATION_AUTO_APPROVED) defaultAutoApproved.add(name);

  // Deduplicate: filter orchestration tools from legacy
  const filteredLegacy = legacyTools.filter((t) => !ORCHESTRATION_TOOL_NAMES.has(t.name));
  const allTools = [...filteredLegacy, ...ORCHESTRATION_TOOL_DEFS];

  const overrides = ctx.toolPermissions.getOverrides();
  const tools = allTools.map((t) => {
    const isDefault = defaultAutoApproved.has(t.name);
    const override = overrides[t.name] as "auto" | "manual" | undefined;
    return {
      name: t.name,
      description: (t.description || "").slice(0, 120),
      mode: override ?? (isDefault ? "auto" : "manual"),
      overridden: override !== undefined,
    };
  });

  const body = JSON.stringify({
    status: "ok",
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    activeConnections,
    activeAgents: ctx.agentManager.getActiveCount(),
    backend: "openclaw-gateway",
    tools,
  });

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    Connection: "close",
  });
  res.end(body);
  return true;
}

// ── Tool permissions API ──────────────────────────────────────────────────────

function handleToolPermissions(
  req: IncomingMessage,
  res: ServerResponse,
  toolPermissions: ToolPermissions
): boolean {
  if (!req.url?.startsWith("/api/tool-permissions")) return false;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return true;
  }

  if (req.method === "GET") {
    const body = JSON.stringify({ overrides: toolPermissions.getOverrides() });
    res.writeHead(200, { ...headers, "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return true;
  }

  if (req.method === "DELETE") {
    toolPermissions.reset();
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, { ...headers, "Content-Length": Buffer.byteLength(body) });
    res.end(body);
    return true;
  }

  if (req.method === "POST") {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.overrides && typeof parsed.overrides === "object") {
          for (const [name, mode] of Object.entries(parsed.overrides)) {
            if (mode === "auto" || mode === "manual") {
              toolPermissions.set(name, mode);
            }
          }
        } else if (parsed.tool && parsed.mode) {
          toolPermissions.set(parsed.tool, parsed.mode);
        }
        const body = JSON.stringify({ ok: true, overrides: toolPermissions.getOverrides() });
        res.writeHead(200, { ...headers, "Content-Length": Buffer.byteLength(body) });
        res.end(body);
      } catch {
        const body = JSON.stringify({ error: "Invalid JSON" });
        res.writeHead(400, { ...headers, "Content-Length": Buffer.byteLength(body) });
        res.end(body);
      }
    });
    return true;
  }

  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = loadConfig();
  const { port, host } = config.server;

  // Initialize workspace manager
  const workspacesPath = resolve(__dirname, "..", config.workspacePath || "./workspaces");
  const workspace = new WorkspaceManager(workspacesPath);
  console.log(`[gateway] Workspaces directory: ${workspacesPath}`);

  // Initialize key store
  const keyStoreSecret = process.env.GATEWAY_KEY_STORE_SECRET || "dyno-dev-secret-change-in-production";
  const keyStorePath = resolve(__dirname, "..", "data", "keys.enc.json");
  const keyStore = new KeyStore(keyStoreSecret, keyStorePath);

  // Initialize agent manager
  const agentManager = new AgentManager(workspace, keyStore, {
    defaultModel: config.agent.model,
    maxTokens: config.agent.maxTokens,
    maxIterations: config.agent.maxIterations,
  });

  // Initialize Supabase verifier (optional — falls back to userId from messages)
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || "";
  const verifier = jwtSecret ? new SupabaseVerifier(jwtSecret) : null;
  if (verifier) {
    console.log("[gateway] Supabase JWT verification enabled");
  } else {
    console.log("[gateway] Supabase JWT verification disabled (no SUPABASE_JWT_SECRET)");
  }

  // Load shared system prompt
  let sharedSystemPrompt = "You are a helpful AI agent managed through Dyno.";
  try {
    const contextPath = resolve(__dirname, "..", "..", "data", "context", "claude.md");
    sharedSystemPrompt = readFileSync(contextPath, "utf-8");
    console.log("[gateway] Loaded system prompt from data/context/claude.md");
  } catch {
    console.log("[gateway] Using default system prompt");
  }
  agentManager.setSystemPrompt(sharedSystemPrompt);

  // Initialize skills registry
  const bundledSkillsPath = resolve(__dirname, "..", "skills", "bundled");
  const managedSkillsPath = resolve(__dirname, "..", "skills", "managed");
  const skillLoader = new SkillLoader(bundledSkillsPath, managedSkillsPath);
  const skillsDataDir = resolve(__dirname, "..", "data", "skills-state");
  const skillRegistry = new SkillRegistry(skillLoader, skillsDataDir);

  // Initialize tool permissions
  const toolPermissionsDataDir = resolve(__dirname, "..", "data");
  const toolPermissions = new ToolPermissions(toolPermissionsDataDir);

  // Connect to legacy Python MCP server
  let legacyBridge: LegacyToolBridge | null = null;
  const legacyConfig = config.mcpServers["dyno-legacy"];
  if (legacyConfig) {
    legacyBridge = new LegacyToolBridge(legacyConfig.url);

    // Try to connect (non-blocking)
    legacyBridge.connect().then(() => {
      console.log(`[gateway] Connected to legacy tool bridge at ${legacyConfig.url}`);
      const tools = legacyBridge!.getToolDefinitions();
      if (tools.length > 0) {
        console.log(`[gateway] Loaded ${tools.length} tools from legacy bridge`);
      }
    }).catch((err) => {
      console.warn(`[gateway] Legacy tool bridge not available: ${err instanceof Error ? err.message : err}`);
      console.warn("[gateway] Tools will be unavailable until the Python MCP server starts");
    });
  }

  // HTTP server for health checks, admin API, and WebSocket upgrade
  const healthCtx: HealthContext = { agentManager, legacyBridge, toolPermissions };

  const httpServer = createServer(async (req, res) => {
    // Health check (includes tool list)
    if (handleHealthCheck(req, res, healthCtx)) return;

    // Tool permissions API
    if (handleToolPermissions(req, res, toolPermissions)) return;

    // Skills API
    const skillsHandled = await handleSkillsRequest(req, res, { registry: skillRegistry });
    if (skillsHandled) return;

    // Admin API
    const handled = await handleAdminRequest(req, res, { workspace, agentManager });
    if (handled) return;

    res.writeHead(404);
    res.end("Not Found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    activeConnections++;

    // Try to authenticate via JWT
    let authenticatedUserId: string | null = null;
    if (verifier && req.url) {
      const token = SupabaseVerifier.extractTokenFromUrl(req.url);
      if (token) {
        const result = verifier.verify(token);
        if (result.valid && result.userId) {
          authenticatedUserId = result.userId;
        }
      }
    }

    // Get or create agent for this connection
    // If authenticated, use per-user agent; otherwise use a shared agent
    const agent = authenticatedUserId
      ? agentManager.getOrCreateAgent(authenticatedUserId)
      : new GatewayAgent(config.agent);

    // Set up tool bridge on the agent
    if (legacyBridge) {
      agent.setToolBridge(legacyBridge);
    }
    if (!authenticatedUserId) {
      agent.setSystemPrompt(sharedSystemPrompt);
    }

    // Set skills prompt (only injected in Phase 2 / build, not Phase 1)
    const effectiveUserId = authenticatedUserId || "default";
    const skillsPrompt = skillRegistry.getSkillsPrompt(effectiveUserId);
    if (skillsPrompt) {
      agent.setSkillsPrompt(skillsPrompt);
    }

    // Wire tool permission overrides into agent
    agent.setToolPermissions(toolPermissions);

    // Wire up orchestration: send function + userId + init
    agent.setSendFn((payload) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    });
    if (authenticatedUserId) {
      agent.setUserId(authenticatedUserId);
    }
    agent.initOrchestration();

    console.log(
      `[gateway] New connection (total: ${activeConnections})` +
      (authenticatedUserId ? ` user: ${authenticatedUserId}` : " (unauthenticated)")
    );

    const channel = new DynoDashboardChannel(ws, agent);

    ws.on("message", async (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // If user sends apiKey in a message and we have their userId, store it
        if (authenticatedUserId && msg.apiKey) {
          agentManager.storeApiKey(authenticatedUserId, msg.apiKey);
        }

        await channel.handleMessage(msg);
      } catch (err) {
        console.error("[gateway] Message handling error:", err);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "error",
            sessionId: "master",
            message: err instanceof Error ? err.message : "Internal gateway error",
          }));
        }
      }
    });

    ws.on("close", () => {
      channel.cleanup();
      activeConnections--;
      console.log(`[gateway] Connection closed (total: ${activeConnections})`);
    });

    ws.on("error", (err) => {
      console.error("[gateway] WebSocket error:", err);
    });
  });

  httpServer.listen(port, host, () => {
    console.log(`\nDyno Gateway running on ws://${host}:${port}`);
    console.log(`Health check at http://${host}:${port}/health`);
    console.log(`Admin API at http://${host}:${port}/admin/`);
    console.log();
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[gateway] Shutting down...");
    agentManager.shutdown();
    if (legacyBridge) legacyBridge.disconnect();
    httpServer.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error starting gateway:", err);
  process.exit(1);
});
