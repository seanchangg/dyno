"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/api";

export interface Screenshot {
  id: string;
  filename: string;
  publicUrl: string;
  size: number;
  created_at: string;
}

interface UseScreenshotsOptions {
  onError?: (message: string) => void;
}

export function useScreenshots(userId: string | undefined, options?: UseScreenshotsOptions) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await authFetch(`/api/screenshots?userId=${userId}`);
      const data = await res.json();
      const raw = data.screenshots ?? [];
      setScreenshots(
        raw.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          filename: s.filename as string,
          publicUrl: (s.public_url ?? s.publicUrl) as string,
          size: s.size as number,
          created_at: s.created_at as string,
        }))
      );
    } catch {
      onErrorRef.current?.("Failed to load screenshots");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteScreenshot = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await authFetch(`/api/screenshots?userId=${userId}&id=${id}`, {
          method: "DELETE",
        });
        refresh();
      } catch {
        onErrorRef.current?.("Failed to delete screenshot");
      }
    },
    [userId, refresh]
  );

  return { screenshots, loading, refresh, deleteScreenshot };
}
