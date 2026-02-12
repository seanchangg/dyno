"use client";

/**
 * Backward-compatible wrapper around useSessionManager.
 *
 * useChat() → useSession("master")
 * ChatProvider → SessionManagerProvider
 */

import type { ChatSettings } from "@/types";
import { DEFAULT_CHAT_SETTINGS } from "@/types";
import {
  SessionManagerProvider,
  useSession,
  type ChatProposal,
} from "./useSessionManager";

export { SessionManagerProvider as ChatProvider };
export type { ChatProposal };

interface UseChatOptions {
  chatSettings?: ChatSettings | null;
}

export function useChat(_options?: UseChatOptions) {
  const session = useSession("master");

  return {
    messages: session.messages,
    isLoading: session.isLoading,
    proposals: session.proposals,
    sendMessage: session.sendMessage,
    clearMessages: session.clearMessages,
    approveProposal: session.approveProposal,
    denyProposal: session.denyProposal,
  };
}
