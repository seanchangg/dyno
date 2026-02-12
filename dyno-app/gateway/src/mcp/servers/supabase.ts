/**
 * Supabase MCP Server — Database access tools.
 *
 * Provides: db_query, db_insert, db_update, db_delete
 * Uses Supabase REST API for direct database access.
 */

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "db_query",
    description: "SELECT from a Supabase table with PostgREST filters",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        select: { type: "string", description: "Columns to select (default: *)" },
        filters: {
          type: "object",
          description: "Key-value filter pairs (e.g. {user_id: 'abc', tag: 'work'})",
          additionalProperties: { type: "string" },
        },
        limit: { type: "number", description: "Max rows to return" },
        order: { type: "string", description: "Order by column (e.g. 'created_at.desc')" },
      },
      required: ["table"],
    },
    mode: "auto" as const,
  },
  {
    name: "db_insert",
    description: "INSERT rows into a Supabase table",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        rows: {
          type: "array",
          items: { type: "object" },
          description: "Array of row objects to insert",
        },
      },
      required: ["table", "rows"],
    },
    mode: "auto" as const,
  },
  {
    name: "db_update",
    description: "UPDATE rows in a Supabase table",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        filters: {
          type: "object",
          description: "Filters to match rows (required)",
          additionalProperties: { type: "string" },
        },
        values: {
          type: "object",
          description: "Column values to update",
        },
      },
      required: ["table", "filters", "values"],
    },
    mode: "auto" as const,
  },
  {
    name: "db_delete",
    description: "DELETE rows from a Supabase table (requires approval)",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "Table name" },
        filters: {
          type: "object",
          description: "Filters to match rows to delete (required)",
          additionalProperties: { type: "string" },
        },
      },
      required: ["table", "filters"],
    },
    mode: "manual" as const,
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export function createHandlers(config: SupabaseConfig) {
  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  async function supabaseRequest(
    path: string,
    method: string,
    body?: unknown
  ): Promise<unknown> {
    const res = await fetch(`${config.url}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Supabase error ${res.status}: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return {
    async db_query(input: Record<string, unknown>): Promise<string> {
      const table = input.table as string;
      const select = (input.select as string) || "*";
      const filters = (input.filters as Record<string, string>) || {};
      const limit = input.limit as number;
      const order = input.order as string;

      let path = `${table}?select=${encodeURIComponent(select)}`;
      for (const [key, value] of Object.entries(filters)) {
        path += `&${key}=eq.${encodeURIComponent(value)}`;
      }
      if (limit) path += `&limit=${limit}`;
      if (order) path += `&order=${order}`;

      const result = await supabaseRequest(path, "GET");
      return JSON.stringify(result, null, 2);
    },

    async db_insert(input: Record<string, unknown>): Promise<string> {
      const table = input.table as string;
      const rows = input.rows as Record<string, unknown>[];
      const result = await supabaseRequest(table, "POST", rows);
      return JSON.stringify(result, null, 2);
    },

    async db_update(input: Record<string, unknown>): Promise<string> {
      const table = input.table as string;
      const filters = input.filters as Record<string, string>;
      const values = input.values as Record<string, unknown>;

      let path = table + "?";
      for (const [key, value] of Object.entries(filters)) {
        path += `${key}=eq.${encodeURIComponent(value)}&`;
      }

      const result = await supabaseRequest(path, "PATCH", values);
      return JSON.stringify(result, null, 2);
    },

    async db_delete(input: Record<string, unknown>): Promise<string> {
      const table = input.table as string;
      const filters = input.filters as Record<string, string>;

      let path = table + "?";
      for (const [key, value] of Object.entries(filters)) {
        path += `${key}=eq.${encodeURIComponent(value)}&`;
      }

      const result = await supabaseRequest(path, "DELETE");
      return JSON.stringify(result, null, 2);
    },
  };
}
