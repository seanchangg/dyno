/**
 * Memory MCP Server — Hybrid vector + BM25 memory system.
 *
 * Provides: save_memory, recall_memories, delete_memory, append_memory,
 *           edit_memory, list_memory_tags
 *
 * Phase 5 will add SQLite+sqlite-vec hybrid search.
 * For now, delegates to Supabase (matching current Python behavior).
 */

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "save_memory",
    description: "Save a tagged memory note",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory content" },
        tag: { type: "string", description: "Tag for organization (e.g. 'work', 'preferences')" },
        title: { type: "string", description: "Short title for the memory" },
      },
      required: ["content", "tag"],
    },
    mode: "auto" as const,
  },
  {
    name: "recall_memories",
    description: "Search/list memories by tag or keyword",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (keyword or semantic)" },
        tag: { type: "string", description: "Filter by tag" },
        limit: { type: "number", description: "Max results (default: 10)" },
      },
    },
    mode: "auto" as const,
  },
  {
    name: "delete_memory",
    description: "Delete a memory by ID",
    input_schema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "Memory ID to delete" },
      },
      required: ["memory_id"],
    },
    mode: "manual" as const,
  },
  {
    name: "append_memory",
    description: "Append content to an existing memory",
    input_schema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "Memory ID to append to" },
        content: { type: "string", description: "Content to append" },
      },
      required: ["memory_id", "content"],
    },
    mode: "auto" as const,
  },
  {
    name: "edit_memory",
    description: "Find and replace within a memory",
    input_schema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "Memory ID to edit" },
        old_text: { type: "string", description: "Text to find" },
        new_text: { type: "string", description: "Text to replace with" },
      },
      required: ["memory_id", "old_text", "new_text"],
    },
    mode: "auto" as const,
  },
  {
    name: "list_memory_tags",
    description: "List all memory tags for the current user",
    input_schema: {
      type: "object",
      properties: {},
    },
    mode: "auto" as const,
  },
];

// ── Handlers (Supabase-backed, Phase 5 will add SQLite hybrid) ───────────────

export interface MemoryConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

export function createHandlers(config: MemoryConfig, userId?: string) {
  const headers = {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const baseUrl = `${config.supabaseUrl}/rest/v1/agent_memories`;

  return {
    async save_memory(input: Record<string, unknown>): Promise<string> {
      if (!userId) return "Error: userId not set";

      const body = {
        user_id: userId,
        content: input.content,
        tag: input.tag || "general",
        title: input.title || null,
      };

      const res = await fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) return `Error: ${await res.text()}`;
      const data = await res.json() as Record<string, unknown>[];
      return JSON.stringify(data);
    },

    async recall_memories(input: Record<string, unknown>): Promise<string> {
      if (!userId) return "Error: userId not set";

      let url = `${baseUrl}?user_id=eq.${userId}&order=created_at.desc`;
      if (input.tag) url += `&tag=eq.${encodeURIComponent(input.tag as string)}`;
      if (input.limit) url += `&limit=${input.limit}`;
      else url += "&limit=10";

      const res = await fetch(url, { headers });
      if (!res.ok) return `Error: ${await res.text()}`;
      const data = await res.json() as Record<string, string>[];

      // Client-side keyword filtering if query provided
      let results = data;
      if (input.query) {
        const query = (input.query as string).toLowerCase();
        results = data.filter(
          (m: Record<string, string>) =>
            m.content?.toLowerCase().includes(query) ||
            m.title?.toLowerCase().includes(query) ||
            m.tag?.toLowerCase().includes(query)
        );
      }

      return JSON.stringify(results, null, 2);
    },

    async delete_memory(input: Record<string, unknown>): Promise<string> {
      if (!userId) return "Error: userId not set";

      const res = await fetch(
        `${baseUrl}?id=eq.${input.memory_id}&user_id=eq.${userId}`,
        { method: "DELETE", headers }
      );
      if (!res.ok) return `Error: ${await res.text()}`;
      return `Deleted memory ${input.memory_id}`;
    },

    async append_memory(input: Record<string, unknown>): Promise<string> {
      if (!userId) return "Error: userId not set";

      // Fetch current memory
      const getRes = await fetch(
        `${baseUrl}?id=eq.${input.memory_id}&user_id=eq.${userId}`,
        { headers }
      );
      if (!getRes.ok) return `Error: ${await getRes.text()}`;
      const memories = await getRes.json() as Record<string, unknown>[];
      if (memories.length === 0) return `Error: Memory ${input.memory_id} not found`;

      const current = memories[0].content;
      const updated = `${current}\n\n${input.content}`;

      const patchRes = await fetch(
        `${baseUrl}?id=eq.${input.memory_id}&user_id=eq.${userId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ content: updated }),
        }
      );
      if (!patchRes.ok) return `Error: ${await patchRes.text()}`;
      return `Appended to memory ${input.memory_id}`;
    },

    async edit_memory(input: Record<string, unknown>): Promise<string> {
      if (!userId) return "Error: userId not set";

      const getRes = await fetch(
        `${baseUrl}?id=eq.${input.memory_id}&user_id=eq.${userId}`,
        { headers }
      );
      if (!getRes.ok) return `Error: ${await getRes.text()}`;
      const memories = await getRes.json() as Record<string, unknown>[];
      if (memories.length === 0) return `Error: Memory ${input.memory_id} not found`;

      const current = memories[0].content as string;
      const oldText = input.old_text as string;
      if (!current.includes(oldText)) {
        return `Error: Text not found in memory ${input.memory_id}`;
      }

      const updated = current.replace(oldText, input.new_text as string);
      const patchRes = await fetch(
        `${baseUrl}?id=eq.${input.memory_id}&user_id=eq.${userId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ content: updated }),
        }
      );
      if (!patchRes.ok) return `Error: ${await patchRes.text()}`;
      return `Edited memory ${input.memory_id}`;
    },

    async list_memory_tags(): Promise<string> {
      if (!userId) return "Error: userId not set";

      const res = await fetch(
        `${baseUrl}?user_id=eq.${userId}&select=tag`,
        { headers }
      );
      if (!res.ok) return `Error: ${await res.text()}`;
      const data = await res.json() as Record<string, string>[];
      const tags = [...new Set(data.map((m: Record<string, string>) => m.tag))];
      return JSON.stringify(tags);
    },
  };
}
