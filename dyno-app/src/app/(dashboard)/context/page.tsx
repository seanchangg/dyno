"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useToast } from "@/components/ui/ToastProvider";

interface ContextFile {
  filename: string;
  content: string;
}

export default function ContextPage() {
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/context")
      .then((r) => r.json())
      .then((data) => {
        const contextFiles = data.files || [];
        setFiles(contextFiles);
        if (contextFiles.length > 0) {
          setSelectedFile(contextFiles[0].filename);
          setContent(contextFiles[0].content);
        }
      })
      .catch(() => toast("Failed to load context files", "error"));
  }, [toast]);

  const handleFileSelect = (filename: string) => {
    const file = files.find((f) => f.filename === filename);
    if (file) {
      setSelectedFile(filename);
      setContent(file.content);
      setSaved(false);
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await fetch("/api/context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: selectedFile, content }),
      });
      setFiles((prev) =>
        prev.map((f) =>
          f.filename === selectedFile ? { ...f, content } : f
        )
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast("Failed to save context file", "error");
    }
    setSaving(false);
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold text-highlight mb-6">Agent Context</h1>

      <div className="flex gap-6">
        <div className="w-48 flex flex-col gap-1">
          {files.map((f) => (
            <button
              key={f.filename}
              onClick={() => handleFileSelect(f.filename)}
              className={`text-left px-3 py-2 text-sm transition-colors ${
                selectedFile === f.filename
                  ? "bg-primary/30 text-highlight"
                  : "text-text/60 hover:bg-surface"
              }`}
            >
              {f.filename}
            </button>
          ))}
          {files.length === 0 && (
            <p className="text-xs text-text/30 px-3">No context files yet.</p>
          )}
        </div>

        <Card className="flex-1">
          {selectedFile ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-text/70">
                  {selectedFile}
                </h2>
                <div className="flex items-center gap-2">
                  {saved && (
                    <span className="text-xs text-highlight">Saved</span>
                  )}
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setSaved(false);
                }}
                className="w-full min-h-[400px] resize-y bg-background border border-primary/30 px-3 py-2 text-sm text-text font-mono placeholder:text-text/40 focus:outline-none focus:border-highlight transition-colors"
              />
            </>
          ) : (
            <p className="text-sm text-text/40">Select a context file to edit.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
