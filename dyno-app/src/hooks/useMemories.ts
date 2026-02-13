"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/api";

export interface Memory {
  id: string;
  tag: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface UseMemoriesOptions {
  onError?: (message: string) => void;
}

export function useMemories(userId: string | undefined, options?: UseMemoriesOptions) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await authFetch(`/api/memories?userId=${userId}`);
      const data = await res.json();
      setMemories(data.memories ?? []);
    } catch {
      onErrorRef.current?.("Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveMemory = useCallback(
    async (tag: string, content: string) => {
      if (!userId) return;
      try {
        await authFetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, tag, content }),
        });
        refresh();
      } catch {
        onErrorRef.current?.("Failed to save memory");
      }
    },
    [userId, refresh]
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await authFetch(`/api/memories?userId=${userId}&id=${id}`, {
          method: "DELETE",
        });
        refresh();
      } catch {
        onErrorRef.current?.("Failed to delete memory");
      }
    },
    [userId, refresh]
  );

  return { memories, loading, refresh, saveMemory, deleteMemory };
}
