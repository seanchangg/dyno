"use client";

import { useState, useCallback, useRef } from "react";

interface DropZoneProps {
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
}

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

export default function DropZone({ onUpload, disabled }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_FILE_SIZE) {
        setError("File too large (max 200MB)");
        return;
      }
      setUploading(true);
      try {
        await onUpload(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [onUpload],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled || uploading) return;
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [disabled, uploading, handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleClick = () => {
    if (!disabled && !uploading) {
      fileInputRef.current?.click();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-uploaded
    e.target.value = "";
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={`border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
        dragging
          ? "border-highlight bg-highlight/5"
          : "border-primary/30 hover:border-secondary"
      } ${disabled || uploading ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleInputChange}
      />
      {uploading ? (
        <p className="text-sm text-text/60">Uploading...</p>
      ) : (
        <>
          <p className="text-sm text-text/60">
            Drop a file here or click to browse
          </p>
          <p className="text-xs text-text/30 mt-1">Max 200MB per file</p>
        </>
      )}
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
