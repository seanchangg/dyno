"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { BuildEvent, ProposedAction, PlanResult, Attachment } from "@/types";
import { addTokenUsage } from "@/lib/token-usage";

const WS_URL = "ws://localhost:8765";

const SS_KEY = "dyno_build_session";

interface PersistedBuildState {
  events: BuildEvent[];
  proposals: ProposedAction[];
  planResult: PlanResult | null;
  buildTokens: { totalIn: number; totalOut: number; iteration: number };
  summary: { text: string; tokensIn: number; tokensOut: number } | null;
  wasRunning: boolean;
}

function loadPersistedState(): PersistedBuildState | null {
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedBuildState;
  } catch {
    return null;
  }
}

function persistState(state: PersistedBuildState) {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage full or unavailable — ignore
  }
}

function clearPersistedState() {
  try {
    sessionStorage.removeItem(SS_KEY);
  } catch {
    // ignore
  }
}

export function useBuildSession() {
  // Restore from sessionStorage on first mount
  const didRestore = useRef(false);
  const initRef = useRef<PersistedBuildState | null>(null);
  if (!didRestore.current && typeof window !== "undefined") {
    initRef.current = loadPersistedState();
    didRestore.current = true;
  }
  const init = initRef.current;

  const [events, setEvents] = useState<BuildEvent[]>(init?.events ?? []);
  const [proposals, setProposals] = useState<ProposedAction[]>(init?.proposals ?? []);
  const [isConnected, setIsConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planResult, setPlanResult] = useState<PlanResult | null>(init?.planResult ?? null);
  const [buildTokens, setBuildTokens] = useState<{
    totalIn: number;
    totalOut: number;
    iteration: number;
  }>(init?.buildTokens ?? { totalIn: 0, totalOut: 0, iteration: 0 });
  const [summary, setSummary] = useState<{
    text: string;
    tokensIn: number;
    tokensOut: number;
  } | null>(init?.summary ?? null);
  const wsRef = useRef<WebSocket | null>(null);
  // Track whether we've already persisted tokens for this build
  const tokensPersisted = useRef(false);
  // Track accumulated tokens in a ref so the onclose handler always has latest values
  const accumulatedTokens = useRef({ totalIn: 0, totalOut: 0 });

  // If the previous session was mid-build when navigated away, add a notice
  useEffect(() => {
    if (init?.wasRunning && init.events.length > 0) {
      // Check if we already appended a disconnect notice (avoid duplicates on re-mount)
      const lastEvent = init.events[init.events.length - 1];
      if (lastEvent?.type !== "error" || !lastEvent.message?.includes("connection lost")) {
        setEvents((prev) => [
          ...prev,
          {
            type: "error",
            message: "Build connection lost — the build was interrupted when you navigated away. Results above are from before disconnection.",
            timestamp: Date.now(),
          },
        ]);
      }
    }
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist build state to sessionStorage on every meaningful change
  useEffect(() => {
    persistState({
      events,
      proposals,
      planResult,
      buildTokens,
      summary,
      wasRunning: isRunning,
    });
  }, [events, proposals, planResult, buildTokens, summary, isRunning]);

  const addEvent = useCallback((event: BuildEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  const requestPlan = useCallback(
    (prompt: string, apiKey: string, model?: string, attachments?: Attachment[], userId?: string) => {
      setIsPlanning(true);
      setPlanResult(null);

      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "plan",
            prompt,
            apiKey,
            ...(model ? { model } : {}),
            ...(userId ? { userId } : {}),
            ...(attachments?.length ? { attachments: attachments.map(a => ({ type: a.type, name: a.name, url: a.url })) } : {}),
          })
        );
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "plan_result") {
          setPlanResult({
            plan: data.plan,
            planTokensIn: data.planTokensIn,
            planTokensOut: data.planTokensOut,
            planCost: data.planCost,
          });
          // Track plan tokens in Supabase
          if (data.planTokensIn || data.planTokensOut) {
            addTokenUsage(data.planTokensIn || 0, data.planTokensOut || 0);
          }
        } else if (data.type === "error") {
          addEvent({
            type: "error",
            message: data.message,
            timestamp: Date.now(),
          });
        }
        setIsPlanning(false);
        ws.close();
      };

      ws.onerror = () => {
        addEvent({
          type: "error",
          message: "Failed to connect to agent server. Is it running?",
          timestamp: Date.now(),
        });
        setIsPlanning(false);
      };
    },
    [addEvent]
  );

  const clearPlan = useCallback(() => {
    setPlanResult(null);
  }, []);

  const startBuild = useCallback(
    (prompt: string, apiKey: string, model?: string, attachments?: Attachment[], userId?: string) => {
      // Reset build state but keep plan visible
      setEvents([]);
      setProposals([]);
      setSummary(null);
      setBuildTokens({ totalIn: 0, totalOut: 0, iteration: 0 });
      tokensPersisted.current = false;
      accumulatedTokens.current = { totalIn: 0, totalOut: 0 };
      setIsRunning(true);

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        ws.send(
          JSON.stringify({
            type: "start",
            prompt,
            apiKey,
            ...(model ? { model } : {}),
            ...(userId ? { userId } : {}),
            ...(attachments?.length ? { attachments: attachments.map(a => ({ type: a.type, name: a.name, url: a.url })) } : {}),
          })
        );
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const timestamp = Date.now();

        // Don't add token_usage events to the visible event stream
        if (data.type !== "token_usage") {
          addEvent({ ...data, timestamp });
        }

        switch (data.type) {
          case "token_usage":
            setBuildTokens({
              totalIn: data.totalIn || 0,
              totalOut: data.totalOut || 0,
              iteration: data.iteration || 0,
            });
            accumulatedTokens.current = {
              totalIn: data.totalIn || 0,
              totalOut: data.totalOut || 0,
            };
            break;

          case "proposal":
            setProposals((prev) => [
              ...prev,
              {
                id: data.id,
                tool: data.tool,
                input: data.input,
                displayTitle: data.displayTitle,
                status: "pending",
                tokensIn: data.tokensIn,
                tokensOut: data.tokensOut,
                costSoFar: data.costSoFar,
                iteration: data.iteration,
              },
            ]);
            break;

          case "execution_result":
            setProposals((prev) =>
              prev.map((p) =>
                p.id === data.id
                  ? {
                      ...p,
                      status:
                        data.status === "completed" ? "completed" : "failed",
                      result: data.result,
                      error: data.error,
                    }
                  : p
              )
            );
            break;

          case "done":
            setSummary({
              text: data.summary || "Build complete.",
              tokensIn: data.tokensIn || 0,
              tokensOut: data.tokensOut || 0,
            });
            // Use authoritative totals from done event
            if (data.tokensIn || data.tokensOut) {
              addTokenUsage(data.tokensIn || 0, data.tokensOut || 0);
              tokensPersisted.current = true;
            }
            setIsRunning(false);
            break;

          case "error":
            setIsRunning(false);
            break;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsRunning(false);
        wsRef.current = null;
        // If build disconnected before "done", persist whatever tokens we accumulated
        const acc = accumulatedTokens.current;
        if (!tokensPersisted.current && (acc.totalIn > 0 || acc.totalOut > 0)) {
          addTokenUsage(acc.totalIn, acc.totalOut);
          tokensPersisted.current = true;
        }
      };

      ws.onerror = () => {
        addEvent({
          type: "error",
          message: "Failed to connect to agent server. Is it running?",
          timestamp: Date.now(),
        });
        setIsRunning(false);
      };
    },
    [addEvent]
  );

  const approve = useCallback(
    (id: string, editedInput?: Record<string, string>) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      setProposals((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: "executing" as const } : p
        )
      );

      wsRef.current.send(
        JSON.stringify({
          type: "approve",
          id,
          ...(editedInput ? { editedInput } : {}),
        })
      );
    },
    []
  );

  const deny = useCallback((id: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    setProposals((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: "denied" as const } : p
      )
    );

    wsRef.current.send(JSON.stringify({ type: "deny", id }));
  }, []);

  const cancel = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "cancel" }));
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setEvents([]);
    setProposals([]);
    setSummary(null);
    setPlanResult(null);
    setBuildTokens({ totalIn: 0, totalOut: 0, iteration: 0 });
    setIsRunning(false);
    setIsPlanning(false);
    setIsConnected(false);
    clearPersistedState();
  }, []);

  return {
    events,
    proposals,
    isConnected,
    isRunning,
    isPlanning,
    planResult,
    buildTokens,
    summary,
    requestPlan,
    clearPlan,
    startBuild,
    approve,
    deny,
    cancel,
    reset,
  };
}
