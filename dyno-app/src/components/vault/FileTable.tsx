"use client";

import { useState } from "react";
import type { VaultFile } from "@/hooks/useVaultFiles";

interface FileTableProps {
  files: VaultFile[];
  selectedFile: string | null;
  onSelect: (filename: string) => void;
  onDelete?: (filename: string) => Promise<void>;
  emptyMessage?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getTypeBadge(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "PDF",
    json: "JSON",
    csv: "CSV",
    txt: "TXT",
    md: "MD",
    py: "Python",
    js: "JS",
    ts: "TS",
    html: "HTML",
    css: "CSS",
    xml: "XML",
    yaml: "YAML",
    yml: "YAML",
    png: "PNG",
    jpg: "JPG",
    jpeg: "JPG",
    gif: "GIF",
    svg: "SVG",
    zip: "ZIP",
  };
  return map[ext] || ext.toUpperCase() || "FILE";
}

export default function FileTable({ files, selectedFile, onSelect, onDelete, emptyMessage }: FileTableProps) {
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const handleDeleteClick = async (filename: string) => {
    if (!onDelete) return;
    if (confirmingDelete === filename) {
      setConfirmingDelete(null);
      await onDelete(filename);
    } else {
      setConfirmingDelete(filename);
    }
  };

  if (files.length === 0) {
    return (
      <div className="text-sm text-text/40 py-8 text-center">
        {emptyMessage || "No files yet"}
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-primary/20 text-text/50">
          <th className="text-left py-2 px-3 font-medium">Name</th>
          <th className="text-left py-2 px-3 font-medium w-20">Type</th>
          <th className="text-right py-2 px-3 font-medium w-24">Size</th>
          <th className="text-right py-2 px-3 font-medium w-28">Date</th>
          {onDelete && <th className="text-right py-2 px-3 font-medium w-20"></th>}
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr
            key={file.filename}
            onClick={() => onSelect(file.filename)}
            className={`border-b border-primary/10 cursor-pointer transition-colors ${
              selectedFile === file.filename
                ? "bg-primary/20"
                : "hover:bg-surface"
            }`}
          >
            <td className="py-2 px-3 text-text/80 truncate max-w-[200px]">
              {file.filename}
            </td>
            <td className="py-2 px-3">
              <span className="text-xs text-secondary bg-primary/20 px-1.5 py-0.5">
                {getTypeBadge(file.filename)}
              </span>
            </td>
            <td className="py-2 px-3 text-right text-text/50 font-mono text-xs">
              {formatSize(file.size)}
            </td>
            <td className="py-2 px-3 text-right text-text/50 text-xs">
              {formatDate(file.createdAt)}
            </td>
            {onDelete && (
              <td className="py-2 px-3 text-right">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(file.filename);
                  }}
                  onBlur={() => setConfirmingDelete(null)}
                  className={`text-xs transition-colors ${
                    confirmingDelete === file.filename
                      ? "text-red-400"
                      : "text-text/30 hover:text-text/60"
                  }`}
                >
                  {confirmingDelete === file.filename ? "Confirm" : "Delete"}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
