/**
 * Orchestration tools — child agent spawning, dashboard layout, UI control.
 *
 * These tools need live WebSocket + session state, so they run natively
 * in the Gateway rather than going through the legacy Python MCP bridge.
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChildSession {
  id: string;
  model: string;
  prompt: string;
  status: "running" | "completed" | "error" | "terminated";
  messages: Anthropic.MessageParam[];
  tokensIn: number;
  tokensOut: number;
  result: string | null;
  createdAt: number;
  cancelled: boolean;
}

export type SendFn = (payload: Record<string, unknown>) => void;

export type EventCallback = (
  type: string,
  payload: Record<string, unknown>
) => Promise<{ approved: boolean; editedInput?: Record<string, string> } | null>;

// ── Tool definitions ─────────────────────────────────────────────────────────

export const ORCHESTRATION_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "spawn_agent",
    description:
      "Spawn a child agent to handle a sub-task independently. " +
      "Choose model based on task complexity: " +
      "claude-haiku-4-5-20251001 for simple/fast tasks, " +
      "claude-sonnet-4-5-20250929 for moderate tasks, " +
      "claude-opus-4-6 for complex reasoning. " +
      "Returns immediately with a session ID. The child runs in the background.",
    input_schema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "The task/prompt for the child agent" },
        model: {
          type: "string",
          description: "Model to use (default: claude-sonnet-4-5-20250929)",
          default: "claude-sonnet-4-5-20250929",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "send_to_session",
    description:
      "Send a follow-up message to a completed child session, continuing " +
      "its conversation. The child must be in 'completed' status.",
    input_schema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "The child session ID to message" },
        message: { type: "string", description: "Follow-up message/prompt for the child" },
      },
      required: ["session_id", "message"],
    },
  },
  {
    name: "list_children",
    description:
      "List all child agent sessions with their status, model, token usage, " +
      "and a preview of their prompt. Useful for monitoring progress.",
    input_schema: {
      type: "object" as const,
      properties: {
        status_filter: {
          type: "string",
          enum: ["all", "running", "completed", "error", "terminated"],
          description: "Filter by status (default: all)",
          default: "all",
        },
      },
    },
  },
  {
    name: "get_session_status",
    description:
      "Get detailed status of a specific child session including its result, " +
      "token usage, and model.",
    input_schema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session ID to check" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_child_details",
    description:
      "Get full details of a child session including its result text. " +
      "Use after a child completes to read what it produced.",
    input_schema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session ID to inspect" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "terminate_child",
    description:
      "Force-terminate a running child session. Use when a child is stuck, " +
      "taking too long, or no longer needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        session_id: { type: "string", description: "Session ID to terminate" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_dashboard_layout",
    description:
      "Get the current dashboard layout — returns all widgets with their IDs, " +
      "types, grid positions (x, y), sizes (w, h), and props. Use this before " +
      "moving, removing, or rearranging widgets so you know what exists and " +
      "where everything is. The dashboard is a 12-column grid with 60px row height.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "ui_action",
    description:
      "Mutate the dashboard layout. Use get_dashboard_layout first to see " +
      "current widgets and their IDs.\n\n" +
      "Actions:\n" +
      "- add: Create a new widget. Requires widgetType. Optional: position, size, props, sessionId.\n" +
      "- remove: Delete a widget by its widgetId.\n" +
      "- update: Change a widget's props (e.g. title, dataSource). Merges with existing props.\n" +
      "- move: Reposition a widget on the grid. Requires position {x, y}.\n" +
      "- resize: Change a widget's dimensions. Requires size {w, h}.\n" +
      "- reset: Restore the default layout (widgetId can be 'default').\n\n" +
      "Grid: 12 columns, rows are 60px tall, 16px gaps.\n\n" +
      "Widget types and their default/min sizes:\n" +
      "- chat: 7x8 (min 4x4, max 12x20) — agent conversation\n" +
      "- stat-card: 3x2 (min 2x2, max 6x4) — metrics display. Props: {title, dataSource}. " +
      "dataSource options: 'agent-status', 'sessions', 'token-usage', 'cost'\n" +
      "- memory-table: 7x5 (min 4x3, max 12x12) — memory viewer\n" +
      "- screenshot-gallery: 5x5 (min 3x3, max 12x12) — screenshot browser\n" +
      "- markdown: 4x4 (min 2x2, max 12x20) — render markdown. Props: {content}\n" +
      "- code-block: 6x4 (min 3x2, max 12x16) — display code. Props: {code, language}\n" +
      "- image: 4x4 (min 2x2, max 12x12) — display image. Props: {src, alt}\n" +
      "- table: 6x4 (min 3x2, max 12x16) — tabular data. Props: {columns, rows}\n" +
      "- html: 6x5 (min 2x2, max 12x20) — render arbitrary HTML/JS in sandboxed iframe. " +
      "Props: {html} for inline HTML, or {src} for a URL. " +
      "Bot can write HTML files to data/widgets/ then reference them here.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["add", "remove", "update", "move", "resize", "reset"],
          description: "Action to perform on the dashboard",
        },
        widgetId: {
          type: "string",
          description: "Target widget ID. For 'add', use a unique descriptive ID.",
        },
        widgetType: {
          type: "string",
          enum: ["chat", "stat-card", "memory-table", "screenshot-gallery", "markdown", "code-block", "image", "table", "html"],
          description: "Widget type (required for 'add')",
        },
        position: {
          type: "object",
          properties: {
            x: { type: "integer", description: "Column (0-11)" },
            y: { type: "integer", description: "Row" },
          },
          description: "Grid position (for 'add' and 'move')",
        },
        size: {
          type: "object",
          properties: {
            w: { type: "integer", description: "Width in columns (1-12)" },
            h: { type: "integer", description: "Height in rows" },
          },
          description: "Grid size (for 'add' and 'resize')",
        },
        props: {
          type: "object",
          description: "Widget-specific properties (for 'add' and 'update')",
        },
        sessionId: {
          type: "string",
          description: "Session ID to link to (for chat widgets)",
        },
      },
      required: ["action", "widgetId"],
    },
  },
];

export const ORCHESTRATION_AUTO_APPROVED = new Set([
  "list_children",
  "get_session_status",
  "get_child_details",
  "get_dashboard_layout",
]);

export const ORCHESTRATION_TOOL_NAMES = new Set(
  ORCHESTRATION_TOOL_DEFS.map((t) => t.name)
);

// ── Orchestration handler ────────────────────────────────────────────────────

export class OrchestrationHandler {
  private children = new Map<string, ChildSession>();
  private send: SendFn;
  private systemPrompt: string;
  private toolDescriptionsAppendix: string;
  private skillsPrompt: string;
  private userId: string | null;
  private getAgentTools: () => Anthropic.Tool[];
  private getAutoApproved: () => Set<string>;
  private executeLegacyTool: (name: string, input: Record<string, unknown>) => Promise<string>;

  constructor(opts: {
    send: SendFn;
    systemPrompt: string;
    toolDescriptionsAppendix: string;
    skillsPrompt: string;
    userId: string | null;
    getAgentTools: () => Anthropic.Tool[];
    getAutoApproved: () => Set<string>;
    executeLegacyTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  }) {
    this.send = opts.send;
    this.systemPrompt = opts.systemPrompt;
    this.toolDescriptionsAppendix = opts.toolDescriptionsAppendix;
    this.skillsPrompt = opts.skillsPrompt;
    this.userId = opts.userId;
    this.getAgentTools = opts.getAgentTools;
    this.getAutoApproved = opts.getAutoApproved;
    this.executeLegacyTool = opts.executeLegacyTool;
  }

  /** Check if a tool name is an orchestration tool. */
  isOrchestrationTool(name: string): boolean {
    return ORCHESTRATION_TOOL_NAMES.has(name);
  }

  /** Get all children (for external access). */
  getChildren(): Map<string, ChildSession> {
    return this.children;
  }

  /** Execute an orchestration tool. Returns the tool result string. */
  async execute(
    name: string,
    input: Record<string, unknown>,
    apiKey: string,
    onEvent: EventCallback
  ): Promise<string> {
    switch (name) {
      case "spawn_agent":
        return this.handleSpawnAgent(input, apiKey, onEvent);
      case "send_to_session":
        return this.handleSendToSession(input, apiKey, onEvent);
      case "list_children":
        return this.handleListChildren(input);
      case "get_session_status":
        return this.handleGetSessionStatus(input);
      case "get_child_details":
        return this.handleGetChildDetails(input);
      case "terminate_child":
        return this.handleTerminateChild(input);
      case "get_dashboard_layout":
        return this.handleGetDashboardLayout();
      case "ui_action":
        return this.handleUIAction(input);
      default:
        return `Error: Unknown orchestration tool ${name}`;
    }
  }

  // ── spawn_agent ─────────────────────────────────────────────────────────

  private async handleSpawnAgent(
    input: Record<string, unknown>,
    apiKey: string,
    onEvent: EventCallback
  ): Promise<string> {
    const model = (input.model as string) || "claude-sonnet-4-5-20250929";
    const prompt = input.prompt as string;
    if (!prompt) return "Error: prompt is required";

    const sessionId = `child-${uuidv4().slice(0, 8)}`;
    console.log(`[orchestration] Spawning child ${sessionId} (model=${model}): ${prompt.slice(0, 80)}...`);

    const child: ChildSession = {
      id: sessionId,
      model,
      prompt,
      status: "running",
      messages: [{ role: "user", content: prompt }],
      tokensIn: 0,
      tokensOut: 0,
      result: null,
      createdAt: Date.now(),
      cancelled: false,
    };
    this.children.set(sessionId, child);

    // Notify frontend about new session
    this.send({
      type: "session_created",
      sessionId,
      model,
      prompt: prompt.slice(0, 200),
    });

    // Run child in background
    this.runChildLoop(child, apiKey, onEvent).catch((err) => {
      console.error(`[orchestration] Child ${sessionId} error:`, err);
      child.status = "error";
      child.result = err instanceof Error ? err.message : String(err);
    });

    return JSON.stringify({ sessionId, status: "running", model });
  }

  private async runChildLoop(
    child: ChildSession,
    apiKey: string,
    parentOnEvent: EventCallback
  ): Promise<void> {
    const client = new Anthropic({ apiKey });

    // Child gets standard tools (no orchestration — no recursive spawning)
    const childTools = this.getAgentTools();
    const skillsBlock = this.skillsPrompt ? `\n\n${this.skillsPrompt}` : "";
    const childSystemText = this.userId
      ? `${this.systemPrompt}\n\n${this.toolDescriptionsAppendix}${skillsBlock}\n\nThe current user's ID is: ${this.userId}`
      : `${this.systemPrompt}\n\n${this.toolDescriptionsAppendix}${skillsBlock}`;

    // Enable prompt caching for child loops
    const cachedSystem: Anthropic.TextBlockParam[] = [
      { type: "text", text: childSystemText, cache_control: { type: "ephemeral" } },
    ];
    if (childTools.length > 0) {
      (childTools[childTools.length - 1] as Anthropic.Tool & { cache_control?: { type: string } }).cache_control = { type: "ephemeral" };
    }

    const childOnEvent: EventCallback = async (type, payload) => {
      payload.sessionId = child.id;
      payload.model = child.model;
      this.send({ type, ...payload });
      return null;
    };

    for (let iteration = 0; iteration < 15; iteration++) {
      if (child.cancelled) {
        child.status = "terminated";
        return;
      }

      const response = await client.messages.create({
        model: child.model,
        max_tokens: 8192,
        system: cachedSystem,
        tools: childTools,
        messages: child.messages,
      });

      if (response.usage) {
        child.tokensIn += response.usage.input_tokens;
        child.tokensOut += response.usage.output_tokens;
      }

      for (const block of response.content) {
        if (block.type === "text") {
          await childOnEvent("thinking", { text: block.text });
        }
      }

      if (response.stop_reason !== "tool_use") {
        const finalText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        child.result = finalText.slice(0, 500);
        child.status = "completed";

        await childOnEvent("done", {
          summary: finalText || "Done.",
          tokensIn: child.tokensIn,
          tokensOut: child.tokensOut,
        });

        // Send session_ended
        this.send({
          type: "session_ended",
          sessionId: child.id,
          status: "completed",
          result: child.result,
          tokensIn: child.tokensIn,
          tokensOut: child.tokensOut,
          model: child.model,
        });
        return;
      }

      // Execute tools (all auto for children)
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolBlocks) {
        await childOnEvent("tool_call", { id: block.id, tool: block.name, input: block.input as Record<string, unknown> });
        const result = await this.executeLegacyTool(block.name, block.input as Record<string, unknown>);
        await childOnEvent("tool_result", { id: block.id, tool: block.name, result: result.slice(0, 2000) });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.slice(0, 4000),
        });
      }

      const serializedContent: Anthropic.ContentBlockParam[] = response.content
        .filter((block): block is Anthropic.TextBlock | Anthropic.ToolUseBlock =>
          block.type === "text" || block.type === "tool_use"
        )
        .map((block) => {
          if (block.type === "text") return { type: "text" as const, text: block.text };
          return {
            type: "tool_use" as const,
            id: block.id,
            name: block.name,
            input: block.input,
          } as Anthropic.ContentBlockParam;
        });

      child.messages.push({ role: "assistant", content: serializedContent });
      child.messages.push({ role: "user", content: toolResults });
    }

    // Max iterations
    child.status = "completed";
    child.result = "Reached maximum iterations.";
    this.send({
      type: "session_ended",
      sessionId: child.id,
      status: "completed",
      result: child.result,
      tokensIn: child.tokensIn,
      tokensOut: child.tokensOut,
      model: child.model,
    });
  }

  // ── send_to_session ─────────────────────────────────────────────────────

  private async handleSendToSession(
    input: Record<string, unknown>,
    apiKey: string,
    onEvent: EventCallback
  ): Promise<string> {
    const sessionId = input.session_id as string;
    const message = input.message as string;
    if (!sessionId || !message) return "Error: session_id and message are required";

    const child = this.children.get(sessionId);
    if (!child) return `Error: session ${sessionId} not found`;
    if (child.status !== "completed") return `Error: session ${sessionId} is ${child.status}, not completed`;

    child.status = "running";
    child.messages.push({ role: "user", content: message });

    this.send({ type: "session_status", sessionId, status: "running" });

    // Run continuation in background
    this.runChildLoop(child, apiKey, onEvent).catch((err) => {
      child.status = "error";
      child.result = err instanceof Error ? err.message : String(err);
    });

    return JSON.stringify({ sessionId, status: "running" });
  }

  // ── list_children ───────────────────────────────────────────────────────

  private handleListChildren(input: Record<string, unknown>): string {
    const filter = (input.status_filter as string) || "all";
    const sessions: Record<string, unknown>[] = [];

    for (const child of this.children.values()) {
      if (filter !== "all" && child.status !== filter) continue;
      sessions.push({
        sessionId: child.id,
        status: child.status,
        model: child.model,
        prompt: child.prompt.slice(0, 200),
        tokensIn: child.tokensIn,
        tokensOut: child.tokensOut,
        createdAt: child.createdAt,
      });
    }

    return JSON.stringify({ sessions, count: sessions.length, filter });
  }

  // ── get_session_status ──────────────────────────────────────────────────

  private handleGetSessionStatus(input: Record<string, unknown>): string {
    const sessionId = input.session_id as string;
    if (!sessionId) return "Error: session_id is required";

    const child = this.children.get(sessionId);
    if (!child) return JSON.stringify({ error: `session ${sessionId} not found` });

    return JSON.stringify({
      sessionId: child.id,
      status: child.status,
      model: child.model,
      tokensIn: child.tokensIn,
      tokensOut: child.tokensOut,
      result: child.result,
      prompt: child.prompt.slice(0, 200),
    });
  }

  // ── get_child_details ───────────────────────────────────────────────────

  private handleGetChildDetails(input: Record<string, unknown>): string {
    const sessionId = input.session_id as string;
    if (!sessionId) return "Error: session_id is required";

    const child = this.children.get(sessionId);
    if (!child) return JSON.stringify({ error: `Session ${sessionId} not found` });

    return JSON.stringify({
      sessionId: child.id,
      status: child.status,
      model: child.model,
      prompt: child.prompt,
      result: child.result,
      tokensIn: child.tokensIn,
      tokensOut: child.tokensOut,
      createdAt: child.createdAt,
    });
  }

  // ── terminate_child ─────────────────────────────────────────────────────

  private handleTerminateChild(input: Record<string, unknown>): string {
    const sessionId = input.session_id as string;
    if (!sessionId) return "Error: session_id is required";

    const child = this.children.get(sessionId);
    if (!child) return JSON.stringify({ error: `Session ${sessionId} not found` });
    if (child.status === "completed" || child.status === "terminated" || child.status === "error") {
      return JSON.stringify({ error: `Session ${sessionId} is already ${child.status}` });
    }

    child.cancelled = true;
    child.status = "terminated";

    this.send({
      type: "session_ended",
      sessionId,
      status: "terminated",
      result: null,
      tokensIn: child.tokensIn,
      tokensOut: child.tokensOut,
      model: child.model,
    });

    return JSON.stringify({ sessionId, status: "terminated" });
  }

  // ── get_dashboard_layout ────────────────────────────────────────────────

  private async handleGetDashboardLayout(): Promise<string> {
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const res = await fetch(`${frontendUrl}/api/layout`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json() as Record<string, unknown>;
      const widgets = (data.widgets || []) as Record<string, unknown>[];

      if (widgets.length === 0) {
        return JSON.stringify({
          widgets: [],
          count: 0,
          note: "Dashboard is empty. Use ui_action with action='reset' to restore defaults.",
        });
      }

      const summary = widgets.map((w) => ({
        id: w.id,
        type: w.type,
        position: { x: w.x || 0, y: w.y || 0 },
        size: { w: w.w || 4, h: w.h || 4 },
        ...(w.props ? { props: w.props } : {}),
        ...(w.sessionId ? { sessionId: w.sessionId } : {}),
      }));

      return JSON.stringify({
        widgets: summary,
        count: summary.length,
        grid: { columns: 12, rowHeight: 60, gap: 16 },
      });
    } catch (err) {
      return JSON.stringify({ error: `Could not reach dashboard API: ${err}` });
    }
  }

  // ── ui_action ───────────────────────────────────────────────────────────

  private handleUIAction(input: Record<string, unknown>): string {
    const action = input.action as string;
    const widgetId = input.widgetId as string;

    if (!action || !widgetId) return "Error: action and widgetId are required";

    this.send({
      type: "ui_mutation",
      action,
      widgetId,
      widgetType: input.widgetType,
      position: input.position,
      size: input.size,
      props: input.props,
      sessionId: input.sessionId,
    });

    return JSON.stringify({ status: "ok", action, widgetId });
  }
}
