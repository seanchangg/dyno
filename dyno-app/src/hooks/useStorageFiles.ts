"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { authFetch } from "@/lib/api";

export type BucketName = "workspace" | "scripts" | "widgets" | "uploads";

export interface StorageFile {
  filename: string;
  size: number;
  createdAt: number;
}

interface UseStorageFilesOptions {
  onError?: (message: string) => void;
}

export function useStorageFiles(
  userId: string | undefined,
  bucket: BucketName,
  options?: UseStorageFilesOptions,
) {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/storage?bucket=${encodeURIComponent(bucket)}&userId=${encodeURIComponent(userId)}`,
      );
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch {
      onErrorRef.current?.("Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [userId, bucket]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return { files, loading, totalSize, refresh };
}
