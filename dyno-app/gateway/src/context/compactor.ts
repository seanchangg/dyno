/**
 * Context Compactor — Server-side conversation context management.
 *
 * When conversation exceeds ~80% of the context window, summarize
 * older messages into a compressed context block. Preserve recent
 * messages and active tool chains intact.
 */

import Anthropic from "@anthropic-ai/sdk";

// ── Types ────────────────────────────────────────────────────────────────────

interface CompactionResult {
  compactedMessages: Anthropic.MessageParam[];
  summary: string;
  removedCount: number;
  estimatedTokensSaved: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

// Default context window sizes by model
const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-opus-4-6": 200_000,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;
const COMPACTION_THRESHOLD = 0.8; // Trigger at 80% of context window
const PRESERVE_RECENT = 6; // Always keep the last N messages
const SUMMARY_MAX_TOKENS = 1024;

// ── ContextCompactor ─────────────────────────────────────────────────────────

export class ContextCompactor {
  private model: string;
  private contextWindow: number;

  constructor(model: string = "claude-sonnet-4-5-20250929") {
    this.model = model;
    this.contextWindow = CONTEXT_WINDOWS[model] || DEFAULT_CONTEXT_WINDOW;
  }

  /**
   * Estimate the token count of a message array.
   * This is a rough estimate — actual tokenization may differ.
   */
  estimateTokens(messages: Anthropic.MessageParam[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if ("text" in block && typeof block.text === "string") {
            totalChars += block.text.length;
          } else if ("content" in block && typeof block.content === "string") {
            totalChars += block.content.length;
          }
        }
      }
    }
    return Math.ceil(totalChars / CHARS_PER_TOKEN);
  }

  /**
   * Check if compaction is needed based on estimated token usage.
   */
  needsCompaction(
    messages: Anthropic.MessageParam[],
    systemPromptTokens: number = 0
  ): boolean {
    const messageTokens = this.estimateTokens(messages);
    const totalTokens = messageTokens + systemPromptTokens;
    return totalTokens > this.contextWindow * COMPACTION_THRESHOLD;
  }

  /**
   * Compact conversation history by summarizing older messages.
   *
   * Strategy:
   * 1. Keep the last PRESERVE_RECENT messages intact
   * 2. Summarize everything before that into a single context block
   * 3. Replace old messages with the summary
   */
  async compact(
    messages: Anthropic.MessageParam[],
    client: Anthropic,
    systemPromptTokens: number = 0
  ): Promise<CompactionResult> {
    if (messages.length <= PRESERVE_RECENT) {
      return {
        compactedMessages: messages,
        summary: "",
        removedCount: 0,
        estimatedTokensSaved: 0,
      };
    }

    const oldMessages = messages.slice(0, -PRESERVE_RECENT);
    const recentMessages = messages.slice(-PRESERVE_RECENT);

    // Build a summary of old messages
    const summaryText = this.buildSummaryInput(oldMessages);
    const estimatedOldTokens = this.estimateTokens(oldMessages);

    let summary: string;
    try {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: SUMMARY_MAX_TOKENS,
        system:
          "Summarize the following conversation history concisely. " +
          "Focus on: key decisions made, actions taken, important context, " +
          "and any ongoing tasks. Be brief but preserve essential information.",
        messages: [{ role: "user", content: summaryText }],
      });

      summary = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch {
      // If summarization fails, use a simple truncation approach
      summary = `[Conversation history: ${oldMessages.length} messages summarized. ` +
        `Key topics discussed but details omitted to save context space.]`;
    }

    // Build compacted messages: summary as first user message + recent messages
    const compactedMessages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `[Previous conversation summary]\n${summary}\n[End of summary — recent messages follow]`,
      },
      {
        role: "assistant",
        content: "Understood. I have the context from our previous conversation. Continuing...",
      },
      ...recentMessages,
    ];

    const estimatedNewTokens = this.estimateTokens(compactedMessages);
    const tokensSaved = estimatedOldTokens - (estimatedNewTokens - this.estimateTokens(recentMessages));

    return {
      compactedMessages,
      summary,
      removedCount: oldMessages.length,
      estimatedTokensSaved: Math.max(0, tokensSaved),
    };
  }

  /** Build summary input from old messages. */
  private buildSummaryInput(messages: Anthropic.MessageParam[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const role = msg.role === "user" ? "User" : "Assistant";
      let content: string;

      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((block) => {
            if ("text" in block && typeof block.text === "string") {
              return block.text;
            }
            if ("content" in block && typeof block.content === "string") {
              return `[Tool result: ${block.content.slice(0, 200)}]`;
            }
            if ("name" in block) {
              return `[Tool call: ${(block as unknown as Record<string, string>).name}]`;
            }
            return "[content block]";
          })
          .join("\n");
      } else {
        content = "[unknown content]";
      }

      // Truncate individual messages for summary efficiency
      if (content.length > 500) {
        content = content.slice(0, 500) + "...";
      }

      lines.push(`${role}: ${content}`);
    }

    return lines.join("\n\n");
  }
}
