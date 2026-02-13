/**
 * GatewayAgent — TypeScript agent loop that mirrors Python's AgentCore.
 *
 * Manages the Claude API agentic loop with tool execution, approval flow,
 * and child session management. Delegates tool execution to registered
 * tool providers (MCP servers, legacy bridge, etc.)
 */

import Anthropic from "@anthropic-ai/sdk";

import type { LegacyToolBridge } from "./tools/dyno-legacy.js";
import type { ToolPermissions } from "./tool-permissions.js";
import type { ActivityLogger } from "./activity-logger.js";
import {
  OrchestrationHandler,
  ORCHESTRATION_TOOL_DEFS,
  ORCHESTRATION_TOOL_NAMES,
  ORCHESTRATION_AUTO_APPROVED,
  type SendFn,
} from "./orchestration.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type EventCallback = (
  type: string,
  payload: Record<string, unknown>
) => Promise<{ approved: boolean; editedInput?: Record<string, string> } | null>;

export interface ChatRequest {
  prompt: string;
  apiKey: string;
  history?: Array<{ role: string; content: string }>;
  includeSystemContext?: boolean;
  userId?: string;
  memoryContext?: string;
  screenshotUrls?: string[];
  model?: string;
  onEvent: EventCallback;
}

export interface BuildRequest {
  prompt: string;
  apiKey: string;
  model?: string;
  userId?: string;
  attachments?: Array<{ type: string; name: string; url: string }>;
  onEvent: EventCallback;
}

export interface PlanRequest {
  prompt: string;
  apiKey: string;
  model?: string;
  userId?: string;
  attachments?: Array<{ type: string; name: string; url: string }>;
  onEvent: EventCallback;
}

export interface ChildChatRequest {
  sessionId: string;
  message: string;
  apiKey: string;
  onEvent: EventCallback;
}

interface AgentConfig {
  model: string;
  maxTokens: number;
  maxIterations: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_MAX_ITERATIONS = 15;
const TOOL_RESULT_HISTORY_LIMIT = 30000;
const COST_PER_INPUT_TOKEN = 3 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 15 / 1_000_000;

// ── Activate tools gate (Phase 1 of chat) ────────────────────────────────────

const ACTIVATE_TOOLS_DEF: Anthropic.Tool = {
  name: "activate_tools",
  description:
    "Call this tool when you need to perform actions such as reading/writing files, " +
    "querying or modifying the database, installing packages, taking screenshots, " +
    "fetching URLs, managing memories, spawning child agents, or controlling the " +
    "dashboard layout. Do NOT call this for simple conversation.",
  input_schema: {
    type: "object" as const,
    properties: {
      reason: {
        type: "string",
        description: "Brief reason why tools are needed for this task",
      },
    },
    required: ["reason"],
  },
};

// ── Plan system prompt ───────────────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are a build planner for Marty, an autonomous AI agent.
Given a user's build request, analyze it and return a JSON build plan.
Respond with ONLY valid JSON matching this schema:
{
  "summary": "One-sentence description",
  "steps": [{"tool": "tool_name", "target": "filename", "description": "what this step does"}],
  "files": ["files that will be created or modified"],
  "packages": ["npm packages to install, if any"],
  "estimatedIterations": 0,
  "estimatedInputTokens": 0,
  "estimatedOutputTokens": 0,
  "complexity": "trivial | simple | moderate | complex | ambitious",
  "reasoning": "Brief explanation"
}`;

// ── GatewayAgent ─────────────────────────────────────────────────────────────

export class GatewayAgent {
  private config: AgentConfig;
  private toolBridge: LegacyToolBridge | null = null;
  private masterCancelled = false;
  private systemPrompt: string;
  private toolDescriptionsAppendix: string;
  private skillsPrompt: string;
  private soulPrompt: string;
  private orchestration: OrchestrationHandler | null = null;
  private sendFn: SendFn | null = null;
  private userId: string | null = null;
  private toolPerms: ToolPermissions | null = null;
  private activityLogger: ActivityLogger | null = null;

  constructor(config?: Partial<AgentConfig>) {
    this.config = {
      model: config?.model || DEFAULT_MODEL,
      maxTokens: config?.maxTokens || DEFAULT_MAX_TOKENS,
      maxIterations: config?.maxIterations || DEFAULT_MAX_ITERATIONS,
    };
    this.systemPrompt = "You are a helpful AI agent managed through Marty.";
    this.toolDescriptionsAppendix = "";
    this.skillsPrompt = "";
    this.soulPrompt = "";
  }

  /** Connect to the legacy Python tool bridge. */
  setToolBridge(bridge: LegacyToolBridge) {
    this.toolBridge = bridge;
  }

  /** Set the WebSocket send function for orchestration tools. */
  setSendFn(fn: SendFn) {
    this.sendFn = fn;
  }

  /** Set the user ID for this agent. Also propagates to orchestration handler. */
  setUserId(userId: string) {
    this.userId = userId;
    if (this.orchestration) {
      this.orchestration.setUserId(userId);
    }
  }

  /** Set the system prompt loaded from context. */
  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }

  /** Get the current system prompt. */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /** Set tool descriptions appendix for full tool mode. */
  setToolDescriptions(appendix: string) {
    this.toolDescriptionsAppendix = appendix;
  }

  /** Set skills prompt (only injected in Phase 2 / build, not Phase 1). */
  setSkillsPrompt(prompt: string) {
    this.skillsPrompt = prompt;
  }

  /** Set soul prompt — prepended to system prompt for persistent identity. */
  setSoulPrompt(prompt: string) {
    this.soulPrompt = prompt;
  }

  /** Set tool permission overrides. */
  setToolPermissions(perms: ToolPermissions) {
    this.toolPerms = perms;
  }

  /** Set the activity logger. Propagates to orchestration handler. */
  setActivityLogger(logger: ActivityLogger | null) {
    this.activityLogger = logger;
    if (this.orchestration) {
      this.orchestration.setActivityLogger(logger);
    }
  }

  /** Get the orchestration handler (for session state access). */
  getOrchestration(): OrchestrationHandler | null {
    return this.orchestration;
  }

  /** Initialize orchestration handler (call after setting bridge, send, userId). */
  initOrchestration() {
    if (!this.sendFn) return;

    // On reconnect, just update the send function to preserve running children
    if (this.orchestration) {
      this.orchestration.updateSendFn(this.sendFn);
      return;
    }

    this.orchestration = new OrchestrationHandler({
      send: this.sendFn,
      systemPrompt: this.systemPrompt,
      toolDescriptionsAppendix: this.toolDescriptionsAppendix,
      skillsPrompt: this.skillsPrompt,
      userId: this.userId,
      activityLogger: this.activityLogger,
      getAgentTools: () => this.getLegacyTools(),
      getAutoApproved: () => this.getLegacyReadOnlyTools(),
      executeLegacyTool: (name, input) => this.executeLegacyTool(name, input),
    });
  }

  /** Get tools from the legacy bridge only (no orchestration). */
  private getLegacyTools(): Anthropic.Tool[] {
    if (!this.toolBridge) return [];
    return this.toolBridge.getToolDefinitions();
  }

  /** Get all tools: legacy (minus orchestration dupes) + orchestration. */
  private getTools(): Anthropic.Tool[] {
    const legacy = this.getLegacyTools().filter(
      (t) => !ORCHESTRATION_TOOL_NAMES.has(t.name)
    );
    return [...legacy, ...ORCHESTRATION_TOOL_DEFS];
  }

  /** Get read-only tool names from legacy bridge. */
  private getLegacyReadOnlyTools(): Set<string> {
    if (!this.toolBridge) return new Set();
    return this.toolBridge.getReadOnlyTools();
  }

  /** Get all read-only tool names: legacy + orchestration. */
  private getReadOnlyTools(): Set<string> {
    const legacy = this.getLegacyReadOnlyTools();
    return new Set([...legacy, ...ORCHESTRATION_AUTO_APPROVED]);
  }

  /** Execute a tool — routes to orchestration or legacy bridge. */
  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    apiKey?: string,
    onEvent?: EventCallback
  ): Promise<string> {
    // Orchestration tools handled natively
    if (this.orchestration && ORCHESTRATION_TOOL_NAMES.has(name)) {
      return this.orchestration.execute(name, input, apiKey || "", onEvent || (async () => null));
    }
    // Everything else goes through legacy bridge
    return this.executeLegacyTool(name, input);
  }

  /** Execute via legacy bridge only. Injects userId for user-scoped operations. */
  private async executeLegacyTool(name: string, input: Record<string, unknown>): Promise<string> {
    if (!this.toolBridge) return `Error: No tool bridge connected`;
    return this.toolBridge.executeTool(name, input, this.userId || undefined);
  }

  private isAutoApproved(toolName: string): boolean {
    const defaultAuto = this.getReadOnlyTools().has(toolName);
    if (this.toolPerms) {
      return this.toolPerms.isAutoApproved(toolName, defaultAuto);
    }
    return defaultAuto;
  }

  /** Build a dynamic tool permissions block reflecting actual auto/manual settings. */
  private buildToolPermissionsBlock(): string {
    const tools = this.getTools();
    if (tools.length === 0) return "";

    const autoTools: string[] = [];
    const manualTools: string[] = [];
    for (const t of tools) {
      if (this.isAutoApproved(t.name)) {
        autoTools.push(t.name);
      } else {
        manualTools.push(t.name);
      }
    }

    const lines = ["<tool_permissions>"];
    if (manualTools.length > 0) {
      lines.push(`Tools that REQUIRE user approval before execution: ${manualTools.join(", ")}`);
    }
    if (autoTools.length > 0) {
      lines.push(`Tools that run automatically (no approval needed): ${autoTools.join(", ")}`);
    }
    lines.push("</tool_permissions>");
    return lines.join("\n");
  }

  // ── Core state auto-injection ───────────────────────────────────────────────

  /**
   * Fetch the "core-state" memory tag for this user. Returns the content
   * string or empty string on failure. Best-effort — never blocks chat.
   */
  private async fetchCoreState(userId: string): Promise<string> {
    if (!this.toolBridge || !userId) return "";
    try {
      const raw = await this.toolBridge.executeTool(
        "recall_memories",
        { userId, tag: "core-state" },
        userId,
      );
      // The tool returns "[core-state] <content>" or "No memory found..."
      if (raw.startsWith("No memory") || raw.startsWith("Error")) return "";
      // Strip the "[core-state] " prefix if present
      const content = raw.replace(/^\[core-state\]\s*/, "");
      return content.trim();
    } catch {
      return "";
    }
  }

  // ── Chat (Phase 1 lightweight → Phase 2 full) ─────────────────────────────

  async runChat(req: ChatRequest): Promise<void> {
    this.masterCancelled = false;
    const { prompt, apiKey, history, includeSystemContext, userId, memoryContext, screenshotUrls, model, onEvent } = req;

    let fullPrompt = prompt;
    if (memoryContext) {
      fullPrompt = `## User's Selected Memories\n${memoryContext}\n\n---\n\n${prompt}`;
    }

    let systemPrompt = "";
    if (includeSystemContext !== false) {
      systemPrompt = this.soulPrompt
        ? `${this.soulPrompt}\n\n---\n\n${this.systemPrompt}`
        : this.systemPrompt;
    }
    if (userId) {
      systemPrompt += `\n\nThe current user's ID is: ${userId}`;

      // Auto-inject core-state memory (best-effort, non-blocking on failure)
      const coreState = await this.fetchCoreState(userId);
      if (coreState) {
        systemPrompt += `\n\n## Core State\nThis is your persistent awareness from previous sessions. Use it to stay consistent.\nIMPORTANT: When you learn something new about the user (preferences, projects, context, corrections) or complete significant work, proactively update your core-state by calling save_memory with tag "core-state". You do not need to be asked — maintaining your own memory is part of being an autonomous agent.\n${coreState}`;
      } else {
        systemPrompt += `\n\n## Core State\nYou have no core-state memory yet. After this conversation, use save_memory with tag "core-state" to record key facts about the user and any important context. This persists across sessions and is how you maintain continuity.`;
      }
    }

    const chatHistory: Anthropic.MessageParam[] = (history || []).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Build user message content with optional screenshots
    let userContent: Anthropic.ContentBlockParam[] | string;
    if (screenshotUrls && screenshotUrls.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = [
        { type: "text", text: "## User's Selected Screenshots\nThe following screenshots are attached:\n" },
      ];
      for (const url of screenshotUrls) {
        blocks.push({ type: "image", source: { type: "url", url } } as Anthropic.ContentBlockParam);
      }
      blocks.push({ type: "text", text: fullPrompt });
      userContent = blocks;
    } else {
      userContent = fullPrompt;
    }

    const messages: Anthropic.MessageParam[] = [
      ...chatHistory,
      { role: "user", content: userContent },
    ];

    console.log(`[gateway] Chat Phase 1: ${prompt.slice(0, 80)}...`);

    const client = new Anthropic({ apiKey });

    // Phase 1: Lightweight check with activate_tools gate
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: model || this.config.model,
        max_tokens: this.config.maxTokens,
        messages,
        tools: [ACTIVATE_TOOLS_DEF],
        ...(systemPrompt ? { system: systemPrompt } : {}),
      });
    } catch (err) {
      await onEvent("error", { message: err instanceof Error ? err.message : String(err) });
      return;
    }

    const phase1In = response.usage?.input_tokens || 0;
    const phase1Out = response.usage?.output_tokens || 0;

    // Check if Claude called activate_tools
    let toolUseBlock: Anthropic.ToolUseBlock | null = null;
    const textParts: string[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "activate_tools") {
        toolUseBlock = block;
      } else if (block.type === "text") {
        textParts.push(block.text);
      }
    }

    if (!toolUseBlock) {
      // Simple response — no tools needed
      const text = textParts.join("") || "No response.";
      await onEvent("chat_response", {
        response: text,
        tokensIn: phase1In,
        tokensOut: phase1Out,
      });
      return;
    }

    // Phase 2: Full agentic loop
    const reason = (toolUseBlock.input as Record<string, string>).reason || "";
    console.log(`[gateway] Chat Phase 2 activated: ${reason}`);

    await onEvent("thinking", { text: `Activating tools: ${reason}` });

    const skillsBlock = this.skillsPrompt ? `\n\n${this.skillsPrompt}` : "";
    const permsBlock = `\n\n${this.buildToolPermissionsBlock()}`;
    const fullSystem = systemPrompt
      ? `${systemPrompt}\n\n${this.toolDescriptionsAppendix}${skillsBlock}${permsBlock}`
      : `${this.systemPrompt}\n\n${this.toolDescriptionsAppendix}${skillsBlock}${permsBlock}`;

    // Build Phase 2 history with Phase 1's tool call
    const phase2History: Anthropic.MessageParam[] = [...chatHistory];
    const p1Content: Anthropic.ContentBlockParam[] = response.content
      .filter((block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock =>
        block.type === "text" || block.type === "tool_use"
      )
      .map((block) => {
        if (block.type === "text") {
          return { type: "text" as const, text: block.text };
        }
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        } as Anthropic.ContentBlockParam;
      });
    phase2History.push({ role: "assistant", content: p1Content });
    phase2History.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: `Tools activated. Reason: ${reason}`,
        },
      ],
    });

    await this.runAgentLoop(client, model || this.config.model, fullSystem, phase2History, prompt, onEvent, phase1In, phase1Out, apiKey);
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  async runBuild(req: BuildRequest): Promise<void> {
    this.masterCancelled = false;
    const { prompt, apiKey, model, userId, attachments, onEvent } = req;

    let fullPrompt = prompt;
    if (attachments && attachments.length > 0) {
      const lines = ["\n\n## Attached Context"];
      for (const att of attachments) {
        if (att.type === "file") {
          lines.push(`- Uploaded file: \`${att.name}\` (use read_upload tool to read it)`);
        } else if (att.type === "url") {
          lines.push(`- URL: ${att.url} (use fetch_url tool to fetch it)`);
        }
      }
      fullPrompt = prompt + lines.join("\n");
    }

    const skillsBlock = this.skillsPrompt ? `\n\n${this.skillsPrompt}` : "";
    const permsBlock = `\n\n${this.buildToolPermissionsBlock()}`;
    const basePrompt = this.soulPrompt
      ? `${this.soulPrompt}\n\n---\n\n${this.systemPrompt}`
      : this.systemPrompt;
    let systemPrompt = `${basePrompt}\n\n${this.toolDescriptionsAppendix}${skillsBlock}${permsBlock}`;
    if (userId) {
      systemPrompt += `\n\nThe current user's ID is: ${userId}`;
    }

    const client = new Anthropic({ apiKey });
    console.log(`[gateway] Starting build: ${prompt.slice(0, 80)}...`);

    await this.runAgentLoop(client, model || this.config.model, systemPrompt, [], fullPrompt, onEvent, 0, 0, apiKey);
  }

  // ── Plan ───────────────────────────────────────────────────────────────────

  async runPlan(req: PlanRequest): Promise<void> {
    const { prompt, apiKey, model, attachments, onEvent } = req;

    let fullPrompt = prompt;
    if (attachments && attachments.length > 0) {
      const lines = ["\n\n## Attached Context"];
      for (const att of attachments) {
        if (att.type === "file") {
          lines.push(`- Uploaded file: \`${att.name}\``);
        } else if (att.type === "url") {
          lines.push(`- URL: ${att.url}`);
        }
      }
      fullPrompt = prompt + lines.join("\n");
    }

    const client = new Anthropic({ apiKey });
    console.log(`[gateway] Planning: ${prompt.slice(0, 80)}...`);

    try {
      const response = await client.messages.create({
        model: model || this.config.model,
        max_tokens: 1024,
        system: PLAN_SYSTEM_PROMPT,
        messages: [{ role: "user", content: fullPrompt }],
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      const planTokensIn = response.usage?.input_tokens || 0;
      const planTokensOut = response.usage?.output_tokens || 0;

      let plan: Record<string, unknown>;
      try {
        plan = JSON.parse(text);
      } catch {
        const match = text.match(/```(?:json)?\s*(\{.*?\})\s*```/s);
        if (match) {
          plan = JSON.parse(match[1]);
        } else {
          plan = { error: "Failed to parse plan", raw: text.slice(0, 500) };
        }
      }

      const estInput = Number(plan.estimatedInputTokens || 0);
      const estOutput = Number(plan.estimatedOutputTokens || 0);
      plan.estimatedCost = String(
        Math.round((estInput * COST_PER_INPUT_TOKEN + estOutput * COST_PER_OUTPUT_TOKEN) * 100000) / 100000
      );

      const planCost =
        Math.round((planTokensIn * COST_PER_INPUT_TOKEN + planTokensOut * COST_PER_OUTPUT_TOKEN) * 100000) / 100000;

      await onEvent("plan_result", {
        plan,
        planTokensIn,
        planTokensOut,
        planCost,
      });
    } catch (err) {
      await onEvent("error", { message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Child session management ───────────────────────────────────────────────

  async sendToChild(req: ChildChatRequest): Promise<void> {
    if (!this.orchestration) throw new Error("Orchestration not initialized");
    const children = this.orchestration.getChildren();
    const child = children.get(req.sessionId);
    if (!child) throw new Error(`Session ${req.sessionId} not found`);
    if (child.status !== "completed") throw new Error(`Session ${req.sessionId} is ${child.status}, wait for it to finish`);

    // Delegate to orchestration handler which manages the child loop
    await this.orchestration.execute(
      "send_to_session",
      { session_id: req.sessionId, message: req.message },
      req.apiKey,
      req.onEvent
    );
  }

  cancelMaster() {
    this.masterCancelled = true;
  }

  cancelChild(sessionId: string) {
    if (this.orchestration) {
      this.orchestration.execute("terminate_child", { session_id: sessionId }, "", async () => null);
    }
  }

  // ── Core agent loop ────────────────────────────────────────────────────────

  private async runAgentLoop(
    client: Anthropic,
    model: string,
    systemPrompt: string,
    history: Anthropic.MessageParam[],
    prompt: string,
    onEvent: EventCallback,
    initialTokensIn: number,
    initialTokensOut: number,
    apiKey?: string
  ): Promise<void> {
    let totalTokensIn = initialTokensIn;
    let totalTokensOut = initialTokensOut;
    const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: prompt }];
    const tools = this.getTools();

    // Enable prompt caching: system prompt and tools are identical every iteration
    const cachedSystem: Anthropic.TextBlockParam[] = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ];
    if (tools.length > 0) {
      (tools[tools.length - 1] as Anthropic.Tool & { cache_control?: { type: string } }).cache_control = { type: "ephemeral" };
    }

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      if (this.masterCancelled) {
        await onEvent("done", {
          summary: "Cancelled.",
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
        });
        return;
      }

      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: this.config.maxTokens,
          system: cachedSystem,
          tools,
          messages,
        });
      } catch (err) {
        await onEvent("error", { message: `API error: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      // Track tokens
      if (response.usage) {
        totalTokensIn += response.usage.input_tokens;
        totalTokensOut += response.usage.output_tokens;
        await onEvent("token_usage", {
          deltaIn: response.usage.input_tokens,
          deltaOut: response.usage.output_tokens,
          totalIn: totalTokensIn,
          totalOut: totalTokensOut,
          iteration: iteration + 1,
        });
      }

      // Stream text blocks as thinking
      for (const block of response.content) {
        if (block.type === "text") {
          await onEvent("thinking", { text: block.text });
        }
      }

      // If no tool use, we're done
      if (response.stop_reason !== "tool_use") {
        const finalText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        await onEvent("done", {
          summary: finalText || "Build complete.",
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
        });
        return;
      }

      // Process tool calls
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const autoBlocks = toolBlocks.filter((b) => this.isAutoApproved(b.name));
      const approvalBlocks = toolBlocks.filter((b) => !this.isAutoApproved(b.name));
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      // Execute auto-approved tools in parallel
      if (autoBlocks.length > 0) {
        const autoResults = await Promise.all(
          autoBlocks.map(async (block) => {
            await onEvent("tool_call", { id: block.id, tool: block.name, input: block.input as Record<string, unknown> });
            const result = await this.executeTool(block.name, block.input as Record<string, unknown>, apiKey, onEvent);
            const isError = result.startsWith("Error");
            await onEvent("tool_result", { id: block.id, tool: block.name, result: result.slice(0, 4000), isError });
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: result.slice(0, TOOL_RESULT_HISTORY_LIMIT),
              ...(isError ? { is_error: true } : {}),
            };
          })
        );
        toolResults.push(...autoResults);
      }

      // Process approval-required tools sequentially
      for (const block of approvalBlocks) {
        let displayTitle = block.name;
        const input = block.input as Record<string, string>;
        if (input.filename) displayTitle = `${block.name}: ${input.filename}`;
        else if (input.package_name) displayTitle = `${block.name}: ${input.package_name}`;
        else if (input.table) displayTitle = `${block.name}: ${input.table}`;

        const costSoFar = totalTokensIn * COST_PER_INPUT_TOKEN + totalTokensOut * COST_PER_OUTPUT_TOKEN;

        const decision = await onEvent("proposal", {
          id: block.id,
          tool: block.name,
          input: block.input as Record<string, unknown>,
          displayTitle,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          costSoFar: Math.round(costSoFar * 1000000) / 1000000,
          iteration: iteration + 1,
        });

        if (decision && decision.approved) {
          const actualInput = decision.editedInput || (block.input as Record<string, unknown>);
          const result = await this.executeTool(block.name, actualInput, apiKey, onEvent);
          await onEvent("execution_result", { id: block.id, status: "completed", result });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.slice(0, TOOL_RESULT_HISTORY_LIMIT),
          });
        } else {
          await onEvent("execution_result", { id: block.id, status: "denied", error: "User denied this action." });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "User denied this action. Do not retry. Move on.",
            is_error: true,
          });
        }
      }

      // Add messages to history
      const serializedContent: Anthropic.ContentBlockParam[] = response.content
        .filter((block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock =>
          block.type === "text" || block.type === "tool_use"
        )
        .map((block) => {
          if (block.type === "text") {
            return { type: "text" as const, text: block.text };
          }
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          } as Anthropic.ContentBlockParam;
        });

      messages.push({ role: "assistant", content: serializedContent });
      messages.push({ role: "user", content: toolResults });
    }

    // Hit max iterations
    await onEvent("done", {
      summary: `Reached maximum iterations (${this.config.maxIterations}).`,
      tokensIn: totalTokensIn,
      tokensOut: totalTokensOut,
    });
  }

}
