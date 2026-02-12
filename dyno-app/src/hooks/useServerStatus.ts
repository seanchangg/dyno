"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { HEALTH_URL } from "@/lib/agent-config";

const POLL_INTERVAL = 5000; // 5 seconds

export interface TokenOverhead {
  systemChars: number;
  systemWithToolsChars: number;
  toolDefsChars: number;
}

export interface ServerTool {
  name: string;
  description: string;
  mode: "auto" | "manual";
  overridden?: boolean;
}

export interface ServerStatus {
  online: boolean;
  uptime: number | null;
  activeSessions: number;
  lastChecked: number;
  overhead: TokenOverhead | null;
  tools: ServerTool[];
}

export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus>({
    online: false,
    uptime: null,
    activeSessions: 0,
    lastChecked: 0,
    overhead: null,
    tools: [],
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        setStatus({
          online: true,
          uptime: data.uptime ?? null,
          activeSessions: data.activeSessions ?? 0,
          lastChecked: Date.now(),
          overhead: data.overhead ?? null,
          tools: data.tools ?? [],
        });
      } else {
        setStatus((prev) => ({
          ...prev,
          online: false,
          lastChecked: Date.now(),
        }));
      }
    } catch {
      setStatus((prev) => ({
        ...prev,
        online: false,
        lastChecked: Date.now(),
      }));
    }
  }, []);

  useEffect(() => {
    check();
    intervalRef.current = setInterval(check, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [check]);

  return { ...status, refresh: check };
}
