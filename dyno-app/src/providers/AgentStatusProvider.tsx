"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { AgentStatus } from "@/types";
import { HEALTH_URL } from "@/lib/agent-config";

const POLL_INTERVAL = 5000;
const IDLE_TIMEOUT = 60 * 1000; // 1 minute

interface AgentStatusContextValue {
  status: AgentStatus;
  setStatus: (status: AgentStatus) => void;
}

const AgentStatusContext = createContext<AgentStatusContextValue>({
  status: "offline",
  setStatus: () => {},
});

export function useAgentStatus() {
  return useContext(AgentStatusContext);
}

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"] as const;

export default function AgentStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [baseStatus, setBaseStatus] = useState<AgentStatus>("offline");
  const [idle, setIdle] = useState(false);
  const manualOverrideRef = useRef<AgentStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manual override: lets the gateway WS or useBuildSession push status
  // immediately without waiting for the next health poll.
  // Setting "working" holds the override; setting "online"/"offline" clears it
  // so the health poll can take over again.
  const setStatus = useCallback((s: AgentStatus) => {
    if (s === "sleeping") return; // sleeping is derived, not set externally
    manualOverrideRef.current = s === "working" ? s : null;
    setBaseStatus(s);
    // Any explicit status change wakes the user up
    if (s === "working") setIdle(false);
  }, []);

  // Derive the effective status: idle + online = sleeping
  const status: AgentStatus = idle && baseStatus === "online" ? "sleeping" : baseStatus;

  // ── Idle detection ──────────────────────────────────────────────────────

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    setIdle(false);
    idleTimerRef.current = setTimeout(() => setIdle(true), IDLE_TIMEOUT);
  }, []);

  useEffect(() => {
    // Start the idle timer
    resetIdleTimer();

    const handler = () => resetIdleTimer();
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, handler, { passive: true });
    }

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, handler);
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  // ── Health polling ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(HEALTH_URL, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error("not ok");
        if (cancelled) return;

        // Don't clobber the WebSocket-driven "working" status —
        // the WS session manager sets/clears it with better timing.
        if (manualOverrideRef.current === null) {
          setBaseStatus("online");
        }
      } catch {
        if (cancelled) return;
        manualOverrideRef.current = null;
        setBaseStatus("offline");
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <AgentStatusContext.Provider value={{ status, setStatus }}>
      {children}
    </AgentStatusContext.Provider>
  );
}
