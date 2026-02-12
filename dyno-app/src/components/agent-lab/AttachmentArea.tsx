"use client";

import { useRef, useState } from "react";
import type { Attachment } from "@/types";

interface AttachmentAreaProps {
  attachments: Attachment[];
  onAdd: (attachment: Attachment) => void;
  onRemove: (id: string) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

export default function AttachmentArea({
  attachments,
  onAdd,
  onRemove,
  onError,
  disabled,
}: AttachmentAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        onError?.(`Upload failed: ${err.error || "Unknown error"}`);
        return;
      }

      const data = await res.json();
      onAdd({
        id: `file-${Date.now()}`,
        type: "file",
        name: data.filename,
      });
    } catch {
      onError?.("Failed to upload file");
    } finally {
      setUploading(false);
      // Reset input so re-selecting the same file works
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddUrl = () => {
    const url = urlInput.trim();
    if (!url) return;

    onAdd({
      id: `url-${Date.now()}`,
      type: "url",
      name: url,
      url,
    });
    setUrlInput("");
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddUrl();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Controls row */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled || uploading}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          className="text-xs px-2.5 py-1.5 border border-primary/30 text-text/60 hover:text-text hover:border-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-transparent cursor-pointer"
        >
          {uploading ? "Uploading..." : "Attach File"}
        </button>

        <div className="flex items-center gap-1.5 flex-1">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            placeholder="Paste URL..."
            disabled={disabled}
            className="flex-1 text-xs bg-background border border-primary/30 px-2 py-1.5 text-text placeholder:text-text/30 focus:outline-none focus:border-highlight transition-colors disabled:opacity-40"
          />
          <button
            type="button"
            onClick={handleAddUrl}
            disabled={disabled || !urlInput.trim()}
            className="text-xs px-2.5 py-1.5 border border-primary/30 text-text/60 hover:text-text hover:border-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-transparent cursor-pointer"
          >
            Add
          </button>
        </div>
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att) => (
            <span
              key={att.id}
              className="inline-flex items-center gap-1.5 text-xs bg-primary/20 text-text/70 px-2 py-1"
            >
              <span className="text-text/40">
                {att.type === "file" ? "FILE" : "URL"}
              </span>
              <span className="max-w-[200px] truncate">{att.name}</span>
              <button
                type="button"
                onClick={() => onRemove(att.id)}
                disabled={disabled}
                className="text-text/40 hover:text-danger transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
