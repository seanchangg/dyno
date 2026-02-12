"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { AgentStatus } from "@/types";

const HEALTH_URL = "http://localhost:8765/health";
const POLL_INTERVAL = 5000;

interface AgentStatusContextValue {
  status: AgentStatus;
  setStatus: (status: AgentStatus) => void;
}

const AgentStatusContext = createContext<AgentStatusContextValue>({
  status: "active",
  setStatus: () => {},
});

export function useAgentStatus() {
  return useContext(AgentStatusContext);
}

export default function AgentStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatusState] = useState<AgentStatus>("active");
  const manualOverrideRef = useRef<AgentStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Manual override: lets useBuildSession set "working" immediately without
  // waiting for the next health poll.
  const setStatus = useCallback((s: AgentStatus) => {
    manualOverrideRef.current = s;
    setStatusState(s);
  }, []);

  // Poll the bot server to derive status from its live state.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(HEALTH_URL, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error("not ok");
        const data = await res.json();
        if (cancelled) return;

        // If there are active tasks (master processing a request), the agent is working.
        const derived: AgentStatus =
          (data.activeTasks ?? 0) > 0 ? "working" : "active";

        // Only override the manual value once the server confirms the change.
        manualOverrideRef.current = null;
        setStatusState(derived);
      } catch {
        if (cancelled) return;
        manualOverrideRef.current = null;
        setStatusState("offline");
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
