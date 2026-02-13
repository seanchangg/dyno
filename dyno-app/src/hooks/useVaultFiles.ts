"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/api";

export interface VaultFile {
  filename: string;
  size: number;
  createdAt: number;
}

interface UseVaultFilesOptions {
  onError?: (message: string) => void;
}

export function useVaultFiles(userId: string | undefined, options?: UseVaultFilesOptions) {
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await authFetch(`/api/uploads?userId=${userId}`);
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch {
      onErrorRef.current?.("Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!userId) return;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);

      const res = await authFetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      await refresh();
    },
    [userId, refresh],
  );

  const deleteFile = useCallback(
    async (filename: string) => {
      if (!userId) return;
      const res = await authFetch("/api/uploads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, userId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }

      await refresh();
    },
    [userId, refresh],
  );

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return { files, loading, totalSize, refresh, uploadFile, deleteFile };
}
