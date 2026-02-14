"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ChatMessage from "@/components/chat/ChatMessage";
import ThinkingTrace from "@/components/chat/ThinkingTrace";
import { useSession } from "@/hooks/useSessionManager";
import { useAuth } from "@/hooks/useAuth";
import { useServerStatus } from "@/hooks/useServerStatus";
import { getDecryptedApiKey } from "@/lib/crypto";
import { useTokenMetrics } from "@/hooks/useTokenMetrics";
import { DEFAULT_CHAT_SETTINGS } from "@/types";
import type { Memory } from "@/hooks/useMemories";
import { useScreenshotSelection } from "@/hooks/useScreenshotSelection";
import { useVaultSelection } from "@/hooks/useVaultSelection";
import DynoSprite from "@/components/sprite/DynoSprite";

const MODEL_PRICING: Record<string, { inPerM: number; outPerM: number }> = {
  "claude-haiku-4-5-20251001": { inPerM: 0.8, outPerM: 4 },
  "claude-sonnet-4-5-20250929": { inPerM: 3, outPerM: 15 },
  "claude-opus-4-20250514": { inPerM: 15, outPerM: 75 },
};

interface ChatWidgetProps {
  sessionId?: string;
  memories?: Memory[];
  selectedMemoryIds?: Set<string>;
}

function ChatWidget({ sessionId = "master", memories, selectedMemoryIds }: ChatWidgetProps) {
  const { profile } = useAuth();
  const settings = profile?.chat_settings ?? DEFAULT_CHAT_SETTINGS;
  const session = useSession(sessionId);
  const { overhead } = useServerStatus();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showKeyPopup, setShowKeyPopup] = useState(false);
  const [keyMissing, setKeyMissing] = useState<"api_key" | "private_key" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const screenshotCtx = useScreenshotSelection();
  const vaultCtx = useVaultSelection();

  const { estimatedTokens, estimatedCost, withToolsTokens, withToolsCost } =
    useTokenMetrics({
      input,
      messages: session.messages,
      maxHistoryMessages: settings.maxHistoryMessages,
      includeSystemContext: settings.includeSystemContext,
      overhead,
    });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [session.messages, session.proposals, session.isLoading]);

  const getApiKey = async (): Promise<string | null> => {
    if (!profile?.encrypted_api_key) {
      setKeyMissing("api_key");
      setShowKeyPopup(true);
      return null;
    }
    const privateKey = localStorage.getItem("dyno_encryption_key");
    if (!privateKey) {
      setKeyMissing("private_key");
      setShowKeyPopup(true);
      return null;
    }
    const decrypted = await getDecryptedApiKey(profile.encrypted_api_key);
    if (!decrypted) {
      setKeyMissing("private_key");
      setShowKeyPopup(true);
      return null;
    }
    return decrypted;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || session.isLoading) return;

    const apiKey = await getApiKey();
    if (!apiKey) return;

    const msg = input.trim();
    setInput("");

    if (sessionId !== "master") {
      // Child session: send follow-up via sendChildMessage
      session.sendChildMessage(sessionId, msg, apiKey);
      return;
    }

    let memoryContext = "";
    if (selectedMemoryIds && selectedMemoryIds.size > 0 && memories) {
      const selected = memories.filter((m) => selectedMemoryIds.has(m.id));
      memoryContext = selected
        .map((m) => `[${m.tag}] ${m.content}`)
        .join("\n");
    }

    // Collect selected vault file contents
    if (vaultCtx && vaultCtx.selectedFiles.size > 0) {
      const vaultContext = await vaultCtx.getSelectedContext();
      if (vaultContext) {
        memoryContext = memoryContext
          ? memoryContext + "\n\n---\n\n" + vaultContext
          : vaultContext;
      }
    }

    // Collect selected screenshot URLs
    let screenshotUrls: string[] | undefined;
    if (screenshotCtx && screenshotCtx.selectedIds.size > 0) {
      screenshotUrls = screenshotCtx.screenshots
        .filter((s) => screenshotCtx.selectedIds.has(s.id))
        .map((s) => s.publicUrl);
    }

    session.sendMessage(msg, apiKey, profile?.id, memoryContext || undefined, screenshotUrls);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Compute token cost for this session
  const pricing = MODEL_PRICING[session.model || "claude-sonnet-4-5-20250929"] ?? MODEL_PRICING["claude-sonnet-4-5-20250929"];
  const cost = (session.tokensIn * pricing.inPerM + session.tokensOut * pricing.outPerM) / 1_000_000;

  const isChild = sessionId !== "master";

  return (
    <div className="flex h-full flex-col bg-surface border border-primary/20">
      <div className="border-b border-primary/20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isChild && (
            <DynoSprite
              status={session.isLoading ? "working" : (session.status === "completed" ? "offline" : "online")}
              size={18}
              noTrack
            />
          )}
          <h2 className="text-sm font-semibold text-highlight">
            {isChild ? `Child: ${sessionId}` : "Agent Chat"}
          </h2>
          {isChild && session.model && (
            <span className="text-[10px] font-mono text-text/30">
              {session.model.split("-").slice(1, 3).join("-")}
            </span>
          )}
          {isChild && session.status && (
            <span className={`text-[10px] px-1.5 py-0.5 border ${
              session.status === "completed" ? "border-highlight/30 text-highlight/60" :
              session.status === "running" ? "border-secondary/30 text-secondary" :
              "border-danger/30 text-danger/60"
            }`}>
              {session.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(session.tokensIn > 0 || session.tokensOut > 0) && (
            <span className="text-[10px] text-text/30 font-mono">
              {session.tokensIn.toLocaleString()} in / {session.tokensOut.toLocaleString()} out
              {cost > 0 && ` ($${cost.toFixed(4)})`}
            </span>
          )}
          {sessionId === "master" && selectedMemoryIds && selectedMemoryIds.size > 0 && (
            <span className="text-xs text-highlight/50">
              {selectedMemoryIds.size} memor{selectedMemoryIds.size === 1 ? "y" : "ies"} attached
            </span>
          )}
          {sessionId === "master" && screenshotCtx && screenshotCtx.selectedIds.size > 0 && (
            <span className="text-xs text-highlight/50">
              {screenshotCtx.selectedIds.size} screenshot{screenshotCtx.selectedIds.size === 1 ? "" : "s"} attached
            </span>
          )}
          {sessionId === "master" && vaultCtx && vaultCtx.selectedFiles.size > 0 && (
            <span className="text-xs text-highlight/50">
              {vaultCtx.selectedFiles.size} vault file{vaultCtx.selectedFiles.size !== 1 ? "s" : ""} attached
            </span>
          )}
          {sessionId === "master" && session.messages.length > 0 && (
            <button
              onClick={session.clearMessages}
              className="text-xs text-text/40 hover:text-highlight transition-colors cursor-pointer"
            >
              Clear chat
            </button>
          )}
          {isChild && session.isLoading && (
            <button
              onClick={() => session.cancelSession(sessionId)}
              className="text-xs text-danger/60 hover:text-danger transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
      >
        {session.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            {!isChild && <DynoSprite status="online" size={48} />}
            <p className="text-sm text-text/30 text-center">
              {isChild
                ? "Waiting for child agent..."
                : "Send a message to start chatting with Marty."}
            </p>
          </div>
        )}
        {session.messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {session.isLoading && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-text/40">
              <img
                src="/logo.svg"
                alt=""
                className="h-4 w-4 animate-[spin_2s_linear_infinite]"
              />
              {isChild ? "Child agent working..." : "Agent is thinking..."}
            </div>
            {session.liveThinking.length > 0 && (
              <ThinkingTrace steps={session.liveThinking} defaultOpen />
            )}
          </div>
        )}
        {session.proposals.filter((p) => p.status === "pending").map((p) => (
          <div key={p.id} className="w-full bg-surface border border-secondary/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono bg-primary/30 text-highlight px-1.5 py-0.5">
                {p.tool}
              </span>
              <span className="text-xs text-text/50">requires approval</span>
            </div>
            <pre className="text-xs text-text/60 bg-background p-2 mb-3 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
              {JSON.stringify(p.input, null, 2)}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => session.approveProposal(p.id)}
                className="text-xs px-3 py-1.5 bg-highlight/20 text-highlight border border-highlight/30 hover:bg-highlight/30 transition-colors cursor-pointer"
              >
                Approve
              </button>
              <button
                onClick={() => session.denyProposal(p.id)}
                className="text-xs px-3 py-1.5 bg-danger/10 text-danger/80 border border-danger/20 hover:bg-danger/20 transition-colors cursor-pointer"
              >
                Deny
              </button>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-primary/20 p-4 flex flex-col gap-2"
      >
        {(input || session.messages.length > 0) && sessionId === "master" && (
          <div className="flex gap-4 text-xs text-text/40">
            <span>
              Est. Input: {estimatedTokens.toLocaleString()}
              {withToolsTokens > estimatedTokens && (
                <span className="text-text/25"> / {withToolsTokens.toLocaleString()} w/ tools</span>
              )}
            </span>
            <span>
              Est. Cost: ${estimatedCost.toFixed(6)}
              {withToolsCost > estimatedCost && (
                <span className="text-text/25"> / ${withToolsCost.toFixed(6)}</span>
              )}
            </span>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isChild ? "Send a follow-up..." : "Type a message..."}
            rows={isChild ? 1 : 2}
            className="flex-1 resize-none bg-background border border-primary/30 px-3 py-2 text-sm text-text placeholder:text-text/40 focus:outline-none focus:border-highlight transition-colors"
          />
          <Button type="submit" disabled={session.isLoading || !input.trim()}>
            <Send size={16} />
          </Button>
        </div>
      </form>

      {showKeyPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <Card className="w-full max-w-sm mx-4">
            <h2 className="text-base font-bold text-highlight mb-2">
              {keyMissing === "api_key"
                ? "API Key Required"
                : "Private Key Missing"}
            </h2>
            <p className="text-sm text-text/60 mb-4">
              {keyMissing === "api_key"
                ? "You need to configure an API key before chatting. Go to Settings to encrypt and save your Anthropic API key."
                : "Your private decryption key is not in this browser. Go to Settings and paste your private key to unlock your API key."}
            </p>
            <div className="flex gap-3">
              <Button onClick={() => router.push("/settings")}>
                Go to Settings
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowKeyPopup(false)}
              >
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default React.memo(ChatWidget);
