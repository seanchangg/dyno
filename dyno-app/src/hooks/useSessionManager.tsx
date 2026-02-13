"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ChatMessage, ChatSettings, ThinkingStep, UIAction } from "@/types";
import { DEFAULT_CHAT_SETTINGS } from "@/types";
import { addTokenUsage } from "@/lib/token-usage";
import { useToast } from "@/components/ui/ToastProvider";
import { useAgentStatus } from "@/hooks/useAgentStatus";
import { WS_URL } from "@/lib/agent-config";
import { authFetch } from "@/lib/api";

const RECONNECT_DELAY_MS = 3000;

export interface ChatProposal {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  status: "pending" | "approved" | "denied";
}

export interface SessionState {
  messages: ChatMessage[];
  isLoading: boolean;
  proposals: ChatProposal[];
  tokensIn: number;
  tokensOut: number;
  model?: string;
  status?: "running" | "completed" | "error" | "terminated";
  liveThinking: ThinkingStep[];
}

function createInitialSession(): SessionState {
  return {
    messages: [],
    isLoading: false,
    proposals: [],
    tokensIn: 0,
    tokensOut: 0,
    liveThinking: [],
  };
}

type Listener = () => void;

/**
 * SessionStore is a mutable store that manages N concurrent sessions.
 * Uses useSyncExternalStore so each widget only re-renders on its own session changes.
 */
class SessionStore {
  private sessions = new Map<string, SessionState>();
  private listeners = new Map<string, Set<Listener>>();
  private globalListeners = new Set<Listener>();
  private cachedIds: string[] = [];
  private static readonly EMPTY_SESSION: SessionState = Object.freeze(createInitialSession()) as SessionState;

  constructor() {
    // Master session always exists
    this.sessions.set("master", createInitialSession());
    this.cachedIds = ["master"];
  }

  getSession(sessionId: string): SessionState {
    return this.sessions.get(sessionId) ?? SessionStore.EMPTY_SESSION;
  }

  getAllSessionIds(): string[] {
    return this.cachedIds;
  }

  private refreshCachedIds() {
    this.cachedIds = Array.from(this.sessions.keys());
  }

  updateSession(sessionId: string, updater: (prev: SessionState) => SessionState) {
    const prev = this.sessions.get(sessionId) ?? createInitialSession();
    const next = updater(prev);
    this.sessions.set(sessionId, next);
    this.notify(sessionId);
  }

  createSession(sessionId: string, initial?: Partial<SessionState>) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { ...createInitialSession(), ...initial });
      this.refreshCachedIds();
      this.notifyGlobal();
    }
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set());
    }
    this.listeners.get(sessionId)!.add(listener);
    return () => {
      this.listeners.get(sessionId)?.delete(listener);
    };
  }

  subscribeGlobal(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners.delete(listener);
    };
  }

  private notify(sessionId: string) {
    this.listeners.get(sessionId)?.forEach((l) => l());
    this.globalListeners.forEach((l) => l());
  }

  private notifyGlobal() {
    this.globalListeners.forEach((l) => l());
  }
}

interface SessionManagerContextValue {
  store: SessionStore;
  wsRef: React.RefObject<WebSocket | null>;
  thinkingRefs: React.RefObject<Map<string, ThinkingStep[]>>;
  settingsRef: React.RefObject<ChatSettings>;
  sendMessage: (content: string, apiKey: string, userId?: string, memoryContext?: string, screenshotUrls?: string[]) => void;
  sendChildMessage: (sessionId: string, content: string, apiKey: string) => void;
  clearMessages: () => void;
  approveProposal: (id: string) => void;
  denyProposal: (id: string) => void;
  updateSettings: (s: ChatSettings) => void;
  cancelSession: (sessionId: string) => void;
}

const SessionManagerContext = createContext<SessionManagerContextValue | null>(null);

interface SessionManagerProviderProps {
  children: ReactNode;
  onUIAction?: (action: UIAction) => void;
}

export function SessionManagerProvider({ children, onUIAction }: SessionManagerProviderProps) {
  const storeRef = useRef(new SessionStore());
  const store = storeRef.current;
  const wsRef = useRef<WebSocket | null>(null);
  const thinkingRefs = useRef(new Map<string, ThinkingStep[]>());
  const settingsRef = useRef<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { setStatus: setAgentStatus } = useAgentStatus();
  const setAgentStatusRef = useRef(setAgentStatus);
  setAgentStatusRef.current = setAgentStatus;
  const onUIActionRef = useRef(onUIAction);
  onUIActionRef.current = onUIAction;
  const [loaded, setLoaded] = React.useState(false);

  const updateSettings = useCallback((s: ChatSettings) => {
    settingsRef.current = s;
  }, []);

  // ── Persistent WS message handler ────────────────────────────────────────

  const handleWsMessage = useCallback((event: MessageEvent) => {
    const data = JSON.parse(event.data);
    const sessionId = data.sessionId || "master";

    switch (data.type) {
      case "pong":
        // Heartbeat response — nothing to do
        break;

      case "thinking": {
        const step: ThinkingStep = { type: "thought", content: data.text, timestamp: Date.now() };
        const steps = thinkingRefs.current.get(sessionId) ?? [];
        steps.push(step);
        thinkingRefs.current.set(sessionId, steps);
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          liveThinking: [...prev.liveThinking, step],
        }));
        break;
      }

      case "tool_call": {
        const step: ThinkingStep = { type: "tool_call", content: `${data.tool}(${JSON.stringify(data.input)})`, timestamp: Date.now() };
        const steps = thinkingRefs.current.get(sessionId) ?? [];
        steps.push(step);
        thinkingRefs.current.set(sessionId, steps);
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          liveThinking: [...prev.liveThinking, step],
        }));
        break;
      }

      case "tool_result": {
        const step: ThinkingStep = { type: "tool_result", content: data.result, timestamp: Date.now() };
        const steps = thinkingRefs.current.get(sessionId) ?? [];
        steps.push(step);
        thinkingRefs.current.set(sessionId, steps);
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          liveThinking: [...prev.liveThinking, step],
        }));
        break;
      }

      case "proposal":
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          proposals: [
            ...prev.proposals,
            {
              id: data.id,
              tool: data.tool,
              input: data.input,
              status: "pending",
            },
          ],
        }));
        break;

      case "execution_result":
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          proposals: prev.proposals.map((p) =>
            p.id === data.id
              ? { ...p, status: data.status === "completed" ? "approved" as const : "denied" as const }
              : p
          ),
        }));
        if (data.result) {
          const steps = thinkingRefs.current.get(sessionId) ?? [];
          steps.push({
            type: "tool_result",
            content: data.result || data.error || "",
            timestamp: Date.now(),
          });
          thinkingRefs.current.set(sessionId, steps);
        }
        break;

      case "token_usage":
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          tokensIn: data.totalIn ?? prev.tokensIn,
          tokensOut: data.totalOut ?? prev.tokensOut,
          model: data.model ?? prev.model,
        }));
        break;

      case "chat_response": {
        if (data.tokensIn || data.tokensOut) {
          addTokenUsage(data.tokensIn || 0, data.tokensOut || 0);
        }

        const thinking: ThinkingStep[] = [
          ...(thinkingRefs.current.get(sessionId) ?? []),
          {
            type: "tool_result",
            content: `Tokens in: ${data.tokensIn || 0} | Tokens out: ${data.tokensOut || 0}`,
            timestamp: Date.now(),
          },
        ];

        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response,
          thinking,
          timestamp: Date.now(),
        };

        store.updateSession(sessionId, (prev) => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
          isLoading: false,
          proposals: [],
          tokensIn: data.tokensIn ?? prev.tokensIn,
          tokensOut: data.tokensOut ?? prev.tokensOut,
          liveThinking: [],
        }));
        thinkingRefs.current.set(sessionId, []);
        if (sessionId === "master") {
          setAgentStatusRef.current("online");
        }
        break;
      }

      case "session_status":
        store.updateSession(data.sessionId, (prev) => ({
          ...prev,
          status: data.status,
          isLoading: data.status === "running",
        }));
        if (data.status === "running") {
          setAgentStatusRef.current("working");
        }
        break;

      case "session_created":
        console.log("[ws] session_created:", data.sessionId, "onUIAction:", !!onUIActionRef.current);
        store.createSession(data.sessionId, {
          isLoading: true,
          model: data.model,
          status: "running",
        });
        // Auto-add chat widget for child
        if (onUIActionRef.current) {
          onUIActionRef.current({
            action: "add",
            widgetId: `chat-${data.sessionId}`,
            widgetType: "chat",
            sessionId: data.sessionId,
            props: { sessionId: data.sessionId },
          });
        } else {
          console.warn("[ws] onUIAction not available — child widget NOT created");
        }
        break;

      case "session_ended": {
        const endSessionId = data.sessionId;
        // Tokens already counted in "done" handler — don't double-count here
        store.updateSession(endSessionId, (prev) => {
          const updated: SessionState = {
            ...prev,
            isLoading: false,
            status: data.status,
            tokensIn: data.tokensIn ?? prev.tokensIn,
            tokensOut: data.tokensOut ?? prev.tokensOut,
            model: data.model ?? prev.model,
          };
          // Only add result as message if session has no messages yet (fallback)
          if (data.result && prev.messages.length === 0) {
            updated.messages = [
              ...prev.messages,
              {
                id: crypto.randomUUID(),
                role: "assistant" as const,
                content: data.result,
                timestamp: Date.now(),
              },
            ];
          }
          return updated;
        });
        break;
      }

      case "ui_mutation":
        onUIActionRef.current?.({
          action: data.action,
          widgetId: data.widgetId,
          widgetType: data.widgetType,
          position: data.position,
          size: data.size,
          props: data.props,
          sessionId: data.sessionId,
          tabId: data.tabId,
          tabLabel: data.tabLabel,
          tabIndex: data.tabIndex,
        });
        break;

      case "done": {
        const doneSessionId = sessionId;
        // Count tokens for all sessions (master and children)
        if (data.tokensIn || data.tokensOut) {
          addTokenUsage(data.tokensIn || 0, data.tokensOut || 0);
        }

        // For child sessions, convert done summary into a chat message
        if (doneSessionId !== "master" && data.summary) {
          const thinking: ThinkingStep[] = [
            ...(thinkingRefs.current.get(doneSessionId) ?? []),
          ];
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.summary,
            thinking: thinking.length > 0 ? thinking : undefined,
            timestamp: Date.now(),
          };
          store.updateSession(doneSessionId, (prev) => ({
            ...prev,
            messages: [...prev.messages, assistantMessage],
            isLoading: false,
            proposals: [],
            tokensIn: data.tokensIn ?? prev.tokensIn,
            tokensOut: data.tokensOut ?? prev.tokensOut,
            liveThinking: [],
          }));
          thinkingRefs.current.set(doneSessionId, []);
        } else {
          store.updateSession(doneSessionId, (prev) => ({
            ...prev,
            isLoading: false,
            proposals: [],
            tokensIn: data.tokensIn ?? prev.tokensIn,
            tokensOut: data.tokensOut ?? prev.tokensOut,
            liveThinking: [],
          }));
        }
        if (doneSessionId === "master") {
          setAgentStatusRef.current("online");
        }
        break;
      }

      case "error":
        toastRef.current(data.message || "An error occurred.", "error");
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          isLoading: false,
          proposals: [],
          status: "error",
        }));
        if (sessionId === "master") {
          setAgentStatusRef.current("online");
        }
        break;
    }
  }, [store]);

  // ── Persistent WebSocket connection ──────────────────────────────────────

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;
    // Don't create a second connection if one is already open/connecting
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[ws] Connected to agent server");
      setAgentStatusRef.current("online");
    };

    ws.onmessage = handleWsMessage;

    ws.onerror = () => {
      // Only toast on first failure, not reconnect attempts
    };

    ws.onclose = () => {
      console.log("[ws] Disconnected from agent server");
      wsRef.current = null;
      setAgentStatusRef.current("offline");

      // Mark any in-flight master loading as done and clear stale proposals
      const masterState = store.getSession("master");
      if (masterState.isLoading || masterState.proposals.length > 0) {
        store.updateSession("master", (prev) => ({
          ...prev,
          isLoading: false,
          proposals: [],
        }));
      }

      // Clear proposals for child sessions but don't change status —
      // children keep running on the gateway and will be restored on reconnect.
      for (const sid of store.getAllSessionIds()) {
        if (sid === "master") continue;
        const s = store.getSession(sid);
        if (s.proposals.length > 0) {
          store.updateSession(sid, (prev) => ({
            ...prev,
            proposals: [],
          }));
        }
      }

      // Auto-reconnect after delay
      if (mountedRef.current) {
        reconnectTimeout.current = setTimeout(connectWs, RECONNECT_DELAY_MS);
      }
    };
  }, [store, handleWsMessage]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    connectWs();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  // Load master chat history on mount
  useEffect(() => {
    authFetch("/api/chat/history")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          store.updateSession("master", (prev) => ({
            ...prev,
            messages: data.messages,
          }));
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [store]);

  // Debounced save whenever master messages change
  const saveMasterMessages = useCallback(() => {
    if (!loaded) return;
    const masterState = store.getSession("master");
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      authFetch("/api/chat/history", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: masterState.messages,
          maxStoredMessages: settingsRef.current.maxStoredMessages,
        }),
      }).catch(() => {});
    }, 500);
  }, [store, loaded]);

  // Subscribe to master session changes for saving
  useEffect(() => {
    return store.subscribe("master", saveMasterMessages);
  }, [store, saveMasterMessages]);

  const approveProposal = useCallback((id: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    for (const sid of store.getAllSessionIds()) {
      store.updateSession(sid, (prev) => ({
        ...prev,
        proposals: prev.proposals.map((p) =>
          p.id === id ? { ...p, status: "approved" as const } : p
        ),
      }));
    }
    wsRef.current.send(JSON.stringify({ type: "approve", id }));
  }, [store]);

  const denyProposal = useCallback((id: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    for (const sid of store.getAllSessionIds()) {
      store.updateSession(sid, (prev) => ({
        ...prev,
        proposals: prev.proposals.map((p) =>
          p.id === id ? { ...p, status: "denied" as const } : p
        ),
      }));
    }
    wsRef.current.send(JSON.stringify({ type: "deny", id }));
  }, [store]);

  const cancelSession = useCallback((sessionId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    if (sessionId === "master") {
      wsRef.current.send(JSON.stringify({ type: "cancel", sessionId: "master" }));
    } else {
      wsRef.current.send(JSON.stringify({ type: "cancel_session", sessionId }));
    }
  }, []);

  const sendMessage = useCallback(
    (content: string, apiKey: string, userId?: string, memoryContext?: string, screenshotUrls?: string[]) => {
      // Add user message to store immediately
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: Date.now(),
      };

      store.updateSession("master", (prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isLoading: true,
        proposals: [],
      }));
      thinkingRefs.current.set("master", []);
      setAgentStatusRef.current("working");

      // Check WS is connected
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        toastRef.current("Not connected to agent server. Reconnecting...", "error");
        store.updateSession("master", (prev) => ({
          ...prev,
          isLoading: false,
        }));
        // Trigger reconnect
        connectWs();
        return;
      }

      const settings = settingsRef.current;
      const masterState = store.getSession("master");
      const history = masterState.messages
        .slice(-settings.maxHistoryMessages)
        .map((m) => ({ role: m.role, content: m.content }));

      // Send chat message through the persistent WS
      wsRef.current.send(
        JSON.stringify({
          type: "chat",
          prompt: content,
          apiKey,
          history,
          includeSystemContext: settings.includeSystemContext,
          ...(userId ? { userId } : {}),
          ...(memoryContext ? { memoryContext } : {}),
          ...(screenshotUrls && screenshotUrls.length > 0 ? { screenshotUrls } : {}),
        })
      );
    },
    [store, connectWs]
  );

  const sendChildMessage = useCallback(
    (sessionId: string, content: string, apiKey: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: Date.now(),
      };

      store.updateSession(sessionId, (prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isLoading: true,
        proposals: [],
      }));
      thinkingRefs.current.set(sessionId, []);

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        toastRef.current("Not connected to agent server.", "error");
        store.updateSession(sessionId, (prev) => ({
          ...prev,
          isLoading: false,
        }));
        return;
      }

      wsRef.current.send(
        JSON.stringify({
          type: "child_chat",
          sessionId,
          message: content,
          apiKey,
        })
      );
    },
    [store]
  );

  const clearMessages = useCallback(() => {
    store.updateSession("master", (prev) => ({
      ...prev,
      messages: [],
      proposals: [],
    }));
    authFetch("/api/chat/history", { method: "DELETE" }).catch(() => {});
  }, [store]);

  return (
    <SessionManagerContext.Provider
      value={{
        store,
        wsRef,
        thinkingRefs,
        settingsRef,
        sendMessage,
        sendChildMessage,
        clearMessages,
        approveProposal,
        denyProposal,
        updateSettings,
        cancelSession,
      }}
    >
      {children}
    </SessionManagerContext.Provider>
  );
}

/**
 * Hook to access a specific session's state with render isolation.
 * Only re-renders when the specified session changes.
 */
export function useSession(sessionId: string) {
  const ctx = useContext(SessionManagerContext);
  if (!ctx) {
    throw new Error("useSession must be used within a <SessionManagerProvider>");
  }

  const { store } = ctx;

  const subscribe = useCallback(
    (callback: () => void) => store.subscribe(sessionId, callback),
    [store, sessionId]
  );

  const getSnapshot = useCallback(
    () => store.getSession(sessionId),
    [store, sessionId]
  );

  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    ...session,
    sendMessage: ctx.sendMessage,
    sendChildMessage: ctx.sendChildMessage,
    clearMessages: ctx.clearMessages,
    approveProposal: ctx.approveProposal,
    denyProposal: ctx.denyProposal,
    cancelSession: ctx.cancelSession,
  };
}

/**
 * Hook to get the list of all session IDs.
 */
export function useSessionIds() {
  const ctx = useContext(SessionManagerContext);
  if (!ctx) {
    throw new Error("useSessionIds must be used within a <SessionManagerProvider>");
  }

  const { store } = ctx;

  const subscribe = useCallback(
    (callback: () => void) => store.subscribeGlobal(callback),
    [store]
  );

  const getSnapshot = useCallback(() => store.getAllSessionIds(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
