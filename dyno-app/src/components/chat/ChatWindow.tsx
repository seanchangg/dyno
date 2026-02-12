"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import TokenEstimator from "./TokenEstimator";
import ChatMessage from "./ChatMessage";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import { useServerStatus } from "@/hooks/useServerStatus";
import { getDecryptedApiKey } from "@/lib/crypto";
import { DEFAULT_CHAT_SETTINGS } from "@/types";
import type { Memory } from "@/hooks/useMemories";

interface ChatWindowProps {
  memories: Memory[];
  selectedMemoryIds: Set<string>;
}

export default function ChatWindow({ memories, selectedMemoryIds }: ChatWindowProps) {
  const { profile } = useAuth();
  const settings = profile?.chat_settings ?? DEFAULT_CHAT_SETTINGS;
  const { messages, isLoading, proposals, sendMessage, clearMessages, approveProposal, denyProposal } = useChat({
    chatSettings: settings,
  });
  const { overhead } = useServerStatus();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showKeyPopup, setShowKeyPopup] = useState(false);
  const [keyMissing, setKeyMissing] = useState<"api_key" | "private_key" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, proposals, isLoading]);

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
    if (!input.trim() || isLoading) return;

    const apiKey = await getApiKey();
    if (!apiKey) return;

    // Build memory context from selected memories
    let memoryContext = "";
    if (selectedMemoryIds.size > 0) {
      const selected = memories.filter((m) => selectedMemoryIds.has(m.id));
      memoryContext = selected
        .map((m) => `[${m.tag}] ${m.content}`)
        .join("\n");
    }

    const msg = input.trim();
    setInput("");
    sendMessage(msg, apiKey, profile?.id, memoryContext || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface border border-primary/20">
      <div className="border-b border-primary/20 px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-highlight">Agent Chat</h2>
        <div className="flex items-center gap-3">
          {selectedMemoryIds.size > 0 && (
            <span className="text-xs text-highlight/50">
              {selectedMemoryIds.size} memor{selectedMemoryIds.size === 1 ? "y" : "ies"} attached
            </span>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="text-xs text-text/40 hover:text-highlight transition-colors cursor-pointer"
            >
              Clear chat
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 flex flex-col gap-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-text/30 text-center mt-8">
            Send a message to start a conversation with your agent.
          </p>
        )}
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-text/40">
            <img
              src="/logo.svg"
              alt=""
              className="h-4 w-4 animate-[spin_2s_linear_infinite]"
            />
            Agent is thinking...
          </div>
        )}
        {proposals.filter((p) => p.status === "pending").map((p) => (
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
                onClick={() => approveProposal(p.id)}
                className="text-xs px-3 py-1.5 bg-highlight/20 text-highlight border border-highlight/30 hover:bg-highlight/30 transition-colors cursor-pointer"
              >
                Approve
              </button>
              <button
                onClick={() => denyProposal(p.id)}
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
        <TokenEstimator
          input={input}
          messages={messages}
          maxHistoryMessages={settings.maxHistoryMessages}
          includeSystemContext={settings.includeSystemContext}
          overhead={overhead}
        />
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={2}
            className="flex-1 resize-none bg-background border border-primary/30 px-3 py-2 text-sm text-text placeholder:text-text/40 focus:outline-none focus:border-highlight transition-colors"
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
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
