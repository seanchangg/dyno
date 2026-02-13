"use client";

import { useCallback } from "react";
import Card from "@/components/ui/Card";
import { useServerStatus } from "@/hooks/useServerStatus";
import { useAuth } from "@/hooks/useAuth";
import { getDecryptedApiKey } from "@/lib/crypto";
import { useToast } from "@/components/ui/ToastProvider";
import { useState, useEffect } from "react";
import type { PermissionMode } from "@/types";
import { authFetch } from "@/lib/api";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function AgentLabPage() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const server = useServerStatus();

  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(true);

  // Decrypt API key on mount
  useEffect(() => {
    async function loadKey() {
      if (profile?.encrypted_api_key) {
        const key = await getDecryptedApiKey(profile.encrypted_api_key);
        setApiKey(key);
      }
      setApiKeyLoading(false);
    }
    loadKey();
  }, [profile]);

  // Toggle a tool's permission and persist to Gateway
  const toggleToolMode = useCallback(
    async (toolName: string, currentMode: "auto" | "manual") => {
      const newMode: PermissionMode = currentMode === "auto" ? "manual" : "auto";
      try {
        await authFetch("/api/tool-permissions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: toolName, mode: newMode }),
        });
        server.refresh();
      } catch {
        toast("Failed to update tool permission", "error");
      }
    },
    [server, toast]
  );

  // Reset all overrides
  const resetToolOverrides = useCallback(async () => {
    try {
      await authFetch("/api/tool-permissions", { method: "DELETE" });
      server.refresh();
    } catch {
      toast("Failed to reset permissions", "error");
    }
  }, [server, toast]);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-highlight">Agent Lab</h1>
          <button
            onClick={server.refresh}
            className="flex items-center gap-1.5 text-xs cursor-pointer hover:opacity-80 transition-opacity"
            title={
              server.online
                ? `Uptime: ${server.uptime ? formatUptime(server.uptime) : "—"} · ${server.activeSessions} active session${server.activeSessions !== 1 ? "s" : ""}`
                : "Gateway offline — click to retry"
            }
          >
            <span
              className={`inline-block w-2 h-2 ${server.online ? "bg-highlight" : "bg-danger"}`}
              style={
                server.online
                  ? { animation: "pulse-glow 3s ease-in-out infinite" }
                  : undefined
              }
            />
            <span
              className={server.online ? "text-text/50" : "text-danger/70"}
            >
              {server.online ? "Gateway Online" : "Gateway Offline"}
            </span>
          </button>
        </div>
      </div>

      {/* Warnings */}
      {!server.online && (
        <Card className="mb-4 border-danger/30">
          <p className="text-sm text-danger">
            Gateway is offline. Start it with:{" "}
            <code className="text-xs bg-background px-1.5 py-0.5">
              cd gateway && npm start
            </code>
          </p>
        </Card>
      )}
      {!apiKeyLoading && !apiKey && (
        <Card className="mb-4 border-danger/30">
          <p className="text-sm text-danger">
            No API key found. Go to Settings to configure your Anthropic API
            key.
          </p>
        </Card>
      )}

      {/* Tool permissions */}
      <div className="bg-surface border border-primary/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-text/70">
            Tool Permissions
          </h2>
          <div className="flex items-center gap-3">
            {server.tools.some((t) => t.overridden) && (
              <button
                onClick={resetToolOverrides}
                className="text-xs text-text/30 hover:text-text/60 transition-colors cursor-pointer"
              >
                Reset to defaults
              </button>
            )}
            <span className="text-xs text-text/30">
              {server.tools.length} tools
            </span>
          </div>
        </div>
        {server.tools.length === 0 && (
          <p className="text-xs text-text/30">
            {server.online ? "No tools loaded." : "Gateway offline."}
          </p>
        )}
        <div className="grid grid-cols-1 gap-1.5">
          {server.tools.map((tool) => (
            <div
              key={tool.name}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs bg-primary/30 text-highlight px-1.5 py-0.5 shrink-0">
                  {tool.name}
                </span>
                <span className="text-text/50 text-xs truncate">
                  {tool.description}
                </span>
              </div>
              <button
                onClick={() => toggleToolMode(tool.name, tool.mode)}
                className={`text-xs font-medium px-2.5 py-0.5 shrink-0 ml-3 cursor-pointer transition-colors ${
                  tool.mode === "auto"
                    ? "bg-highlight/15 text-highlight/70 hover:bg-highlight/25"
                    : "bg-primary/20 text-text/50 hover:bg-primary/30"
                } ${tool.overridden ? "ring-1 ring-secondary/40" : ""}`}
              >
                {tool.mode}
              </button>
            </div>
          ))}
        </div>
        {server.tools.length > 0 && (
          <p className="text-xs text-text/25 mt-3">
            Click a tool&apos;s mode to toggle between auto and manual.
            Auto tools run without approval.
          </p>
        )}
      </div>
    </div>
  );
}
