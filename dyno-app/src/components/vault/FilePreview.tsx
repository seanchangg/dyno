"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { VaultFile } from "@/hooks/useVaultFiles";
import type { BucketName } from "@/hooks/useStorageFiles";

interface FilePreviewProps {
  file: VaultFile;
  userId: string;
  onClose: () => void;
  bucket?: BucketName;
}

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "csv", "py", "js", "ts", "tsx", "jsx",
  "html", "css", "xml", "yaml", "yml", "toml", "ini", "cfg",
  "sh", "bash", "zsh", "sql", "r", "rb", "go", "rs", "java",
  "c", "cpp", "h", "hpp", "swift", "kt", "lua", "env", "log",
]);

function isTextFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return TEXT_EXTENSIONS.has(ext);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; content: string }
  | { status: "error"; message: string };

export default function FilePreview({ file, userId, onClose, bucket = "uploads" }: FilePreviewProps) {
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const canPreview = isTextFile(file.filename);

  const loadPreview = useCallback(async (filename: string, uid: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPreview({ status: "loading" });
    try {
      const url =
        bucket === "uploads"
          ? `/api/uploads/preview?filename=${encodeURIComponent(filename)}&userId=${encodeURIComponent(uid)}`
          : `/api/storage/preview?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(filename)}&userId=${encodeURIComponent(uid)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Preview failed");
      }
      const text = await res.text();
      if (!controller.signal.aborted) {
        setPreview({ status: "loaded", content: text });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setPreview({ status: "error", message: err instanceof Error ? err.message : "Preview failed" });
      }
    }
  }, [bucket]);

  useEffect(() => {
    if (!canPreview) return;
    loadPreview(file.filename, userId);
    return () => { abortRef.current?.abort(); };
  }, [file.filename, userId, canPreview, loadPreview]);

  return (
    <div className="bg-surface border border-primary/20 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-text/80 truncate">
            {file.filename}
          </h3>
          <p className="text-xs text-text/40">{formatSize(file.size)}</p>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-text/40 hover:text-highlight transition-colors ml-3 shrink-0"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!canPreview && (
          <p className="text-sm text-text/40">
            Preview not available for this file type.
          </p>
        )}

        {preview.status === "loading" && (
          <p className="text-sm text-text/40">Loading preview...</p>
        )}

        {preview.status === "error" && (
          <p className="text-sm text-red-400">{preview.message}</p>
        )}

        {preview.status === "loaded" && (
          <pre className="text-xs text-text/70 font-mono whitespace-pre-wrap break-words">
            {preview.content}
          </pre>
        )}
      </div>
    </div>
  );
}
