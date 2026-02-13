/**
 * Marty Dashboard Channel Plugin
 *
 * Translates between Marty's WebSocket message format and the Gateway's
 * internal agent loop. Handles tool approval flow via a pendingApprovals Map.
 */

import { WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import type { GatewayAgent } from "../agent.js";
import type { ActivityLogger } from "../activity-logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DynoInboundMessage {
  type: string;
  prompt?: string;
  apiKey?: string;
  history?: Array<{ role: string; content: string }>;
  includeSystemContext?: boolean;
  userId?: string;
  memoryContext?: string;
  screenshotUrls?: string[];
  model?: string;
  sessionId?: string;
  message?: string;
  id?: string;
  editedInput?: Record<string, string>;
  attachments?: Array<{ type: string; name: string; url: string }>;
}

export interface PendingApproval {
  resolve: (decision: { approved: boolean; editedInput?: Record<string, string> }) => void;
  timeout: ReturnType<typeof setTimeout>;
  payload: Record<string, unknown>; // original proposal payload for re-delivery
}

// ── Channel Handler ──────────────────────────────────────────────────────────

const APPROVAL_TIMEOUT_MS = 60_000;

export class DynoDashboardChannel {
  private ws: WebSocket;
  private agent: GatewayAgent;
  private pendingApprovals = new Map<string, PendingApproval>();
  private userId: string | null = null;
  private activityLogger: ActivityLogger | null;
  private toolCallTimestamps = new Map<string, { tool: string; input: Record<string, unknown>; time: number }>();

  constructor(ws: WebSocket, agent: GatewayAgent, activityLogger?: ActivityLogger | null) {
    this.ws = ws;
    this.agent = agent;
    this.activityLogger = activityLogger ?? null;
  }

  /** Send a JSON message to the frontend. */
  private send(payload: Record<string, unknown>) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Handle an inbound message from the Marty frontend. */
  async handleMessage(msg: DynoInboundMessage): Promise<void> {
    // Track userId from any message and propagate to agent for tool injection
    if (msg.userId) {
      this.userId = msg.userId;
      this.agent.setUserId(msg.userId);
    }

    switch (msg.type) {
      case "ping":
        this.send({ type: "pong", sessionId: "master" });
        break;

      case "chat":
        await this.handleChat(msg);
        break;

      case "start":
        await this.handleBuild(msg);
        break;

      case "plan":
        await this.handlePlan(msg);
        break;

      case "approve":
        this.handleApproval(msg.id!, true, msg.editedInput);
        break;

      case "deny":
        this.handleApproval(msg.id!, false);
        break;

      case "cancel":
        this.handleCancel(msg.sessionId || "master");
        break;

      case "child_chat":
        await this.handleChildChat(msg);
        break;

      case "cancel_session":
        this.handleCancelSession(msg.sessionId!);
        break;

      default:
        console.warn(`[dyno-dashboard] Unknown message type: ${msg.type}`);
    }
  }

  // ── Inbound: chat → agent ────────────────────────────────────────────────

  private async handleChat(msg: DynoInboundMessage) {
    const { prompt, apiKey, history, includeSystemContext, memoryContext, screenshotUrls, model } = msg;

    if (!prompt || !apiKey) {
      this.send({ type: "error", sessionId: "master", message: "prompt and apiKey are required" });
      return;
    }

    try {
      await this.agent.runChat({
        prompt,
        apiKey,
        history: history || [],
        includeSystemContext: includeSystemContext ?? true,
        userId: this.userId || undefined,
        memoryContext,
        screenshotUrls,
        model,
        onEvent: (type, payload) => this.handleAgentEvent("master", type, payload),
      });
    } catch (err) {
      this.send({
        type: "error",
        sessionId: "master",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Inbound: start → agent build ─────────────────────────────────────────

  private async handleBuild(msg: DynoInboundMessage) {
    const { prompt, apiKey, model, attachments } = msg;

    if (!prompt || !apiKey) {
      this.send({ type: "error", sessionId: "master", message: "prompt and apiKey are required" });
      return;
    }

    try {
      await this.agent.runBuild({
        prompt,
        apiKey,
        model,
        userId: this.userId || undefined,
        attachments,
        onEvent: (type, payload) => this.handleAgentEvent("master", type, payload),
      });
    } catch (err) {
      this.send({
        type: "error",
        sessionId: "master",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Inbound: plan → agent plan ───────────────────────────────────────────

  private async handlePlan(msg: DynoInboundMessage) {
    const { prompt, apiKey, model, attachments } = msg;

    if (!prompt || !apiKey) {
      this.send({ type: "error", sessionId: "master", message: "prompt and apiKey are required" });
      return;
    }

    try {
      await this.agent.runPlan({
        prompt,
        apiKey,
        model,
        userId: this.userId || undefined,
        attachments,
        onEvent: (type, payload) => this.handleAgentEvent("master", type, payload),
      });
    } catch (err) {
      this.send({
        type: "error",
        sessionId: "master",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Inbound: child_chat ──────────────────────────────────────────────────

  private async handleChildChat(msg: DynoInboundMessage) {
    const { sessionId, message, apiKey } = msg;

    if (!sessionId || !message) {
      this.send({
        type: "error",
        sessionId: sessionId || "master",
        message: "sessionId and message are required",
      });
      return;
    }

    try {
      await this.agent.sendToChild({
        sessionId,
        message,
        apiKey: apiKey || "",
        onEvent: (type, payload) => this.handleAgentEvent(sessionId, type, payload),
      });
    } catch (err) {
      this.send({
        type: "error",
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Approval flow ────────────────────────────────────────────────────────

  private handleApproval(id: string, approved: boolean, editedInput?: Record<string, string>) {
    const pending = this.pendingApprovals.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingApprovals.delete(id);
    pending.resolve({ approved, editedInput });
  }

  private handleCancel(sessionId: string) {
    if (sessionId === "master") {
      // Deny all pending approvals
      for (const [id, pending] of this.pendingApprovals) {
        clearTimeout(pending.timeout);
        pending.resolve({ approved: false });
        this.pendingApprovals.delete(id);
      }
      this.agent.cancelMaster();
    }
  }

  private handleCancelSession(sessionId: string) {
    this.agent.cancelChild(sessionId);
    this.send({
      type: "session_ended",
      sessionId,
      status: "terminated",
      result: null,
      tokensIn: 0,
      tokensOut: 0,
    });
  }

  // ── Outbound: agent events → frontend ────────────────────────────────────

  private async handleAgentEvent(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>
  ): Promise<{ approved: boolean; editedInput?: Record<string, string> } | null> {
    const outPayload = { ...payload, sessionId };

    switch (type) {
      case "thinking":
        this.send({ type: "thinking", ...outPayload });
        return null;

      case "tool_call":
        this.send({ type: "tool_call", ...outPayload });
        // Track start time for duration calculation
        if (payload.id) {
          this.toolCallTimestamps.set(payload.id as string, {
            tool: payload.tool as string,
            input: (payload.input as Record<string, unknown>) || {},
            time: Date.now(),
          });
        }
        return null;

      case "tool_result":
        this.send({ type: "tool_result", ...outPayload });
        // Surface tool errors as visible errors so the user knows something failed
        if (payload.isError) {
          this.send({
            type: "error",
            sessionId,
            message: `Tool "${payload.tool}" failed: ${String(payload.result).slice(0, 200)}`,
          });
        }
        // Log tool call to activity logger
        if (this.activityLogger && this.userId && payload.id) {
          const start = this.toolCallTimestamps.get(payload.id as string);
          const durationMs = start ? Date.now() - start.time : undefined;
          this.activityLogger.logToolCall({
            userId: this.userId,
            sessionId,
            toolName: (start?.tool || payload.tool || "unknown") as string,
            toolParams: start?.input,
            success: !payload.isError,
            durationMs,
            errorMessage: payload.isError ? String(payload.result).slice(0, 500) : undefined,
          });
          this.toolCallTimestamps.delete(payload.id as string);
        }
        return null;

      case "proposal": {
        // Send proposal to frontend and wait for approval
        this.send({ type: "proposal", ...outPayload });

        return new Promise((resolve) => {
          const proposalId = payload.id as string;
          const timeout = setTimeout(() => {
            this.pendingApprovals.delete(proposalId);
            resolve({ approved: false });
            this.send({
              type: "execution_result",
              sessionId,
              id: proposalId,
              status: "denied",
              error: "Approval timed out (60s).",
            });
          }, APPROVAL_TIMEOUT_MS);

          this.pendingApprovals.set(proposalId, { resolve, timeout, payload: { type: "proposal", ...outPayload } });
        });
      }

      case "execution_result":
        this.send({ type: "execution_result", ...outPayload });
        return null;

      case "token_usage":
        this.send({ type: "token_usage", ...outPayload });
        // Log token usage to hourly rollup
        if (this.activityLogger && this.userId) {
          const deltaIn = (payload.deltaIn as number) || (payload.tokensIn as number) || 0;
          const deltaOut = (payload.deltaOut as number) || (payload.tokensOut as number) || 0;
          if (deltaIn > 0 || deltaOut > 0) {
            this.activityLogger.incrementHourlyTokens(this.userId, deltaIn, deltaOut);
          }
        }
        return null;

      case "done":
        // For master sessions, convert "done" to "chat_response" so the frontend
        // adds the response as a visible message (matching Python backend behavior)
        if (sessionId === "master") {
          this.send({
            type: "chat_response",
            sessionId: "master",
            response: payload.summary || "Done.",
            tokensIn: payload.tokensIn || 0,
            tokensOut: payload.tokensOut || 0,
          });
        } else {
          this.send({ type: "done", ...outPayload });
        }
        return null;

      case "chat_response":
        this.send({ type: "chat_response", ...outPayload });
        return null;

      case "plan_result":
        this.send({ type: "plan_result", ...outPayload });
        return null;

      case "session_created":
        this.send({ type: "session_created", ...outPayload });
        return null;

      case "session_ended":
        this.send({ type: "session_ended", ...outPayload });
        return null;

      case "session_status":
        this.send({ type: "session_status", ...outPayload });
        return null;

      case "ui_mutation":
        this.send({ type: "ui_mutation", ...outPayload });
        return null;

      case "error":
        this.send({ type: "error", ...outPayload });
        return null;

      default:
        // Pass through unknown event types
        this.send({ type, ...outPayload });
        return null;
    }
  }

  /** Cleanup pending approvals on disconnect. */
  /** Send an event to the connected frontend (used by internal services). */
  sendEvent(payload: Record<string, unknown>) {
    this.send(payload);
  }

  /**
   * Swap the underlying WebSocket (e.g. after a page reload reconnects).
   * In-flight work keeps running — sends now go to the new socket.
   * Re-sends active child sessions and pending proposals so the frontend
   * can rebuild its state.
   */
  replaceWebSocket(ws: WebSocket) {
    this.ws = ws;

    // Re-send active child sessions so frontend recreates widgets
    const orch = this.agent.getOrchestration?.();
    if (orch) {
      for (const [id, child] of orch.getChildren()) {
        this.send({
          type: "session_created",
          sessionId: id,
          model: child.model,
          prompt: child.prompt,
        });
        // If child is already done, also send session_ended
        if (child.status !== "running") {
          this.send({
            type: "session_ended",
            sessionId: id,
            status: child.status,
            result: child.result,
            tokensIn: child.tokensIn,
            tokensOut: child.tokensOut,
            model: child.model,
          });
        }
      }
    }

    // Re-send pending proposals to the new frontend so user can approve/deny
    for (const [, pending] of this.pendingApprovals) {
      this.send(pending.payload);
    }
  }

  /** Whether the agent has in-flight work (pending approvals or the loop is running). */
  hasPendingWork(): boolean {
    return this.pendingApprovals.size > 0;
  }

  cleanup() {
    for (const [id, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      pending.resolve({ approved: false });
    }
    this.pendingApprovals.clear();
  }
}
