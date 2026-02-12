/**
 * Browser MCP Server — Web search, browsing, and URL fetching.
 *
 * Provides: web_search, fetch_url, take_screenshot
 * Delegates to external APIs or headless browser.
 */

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "web_search",
    description: "Search the web for information",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        num_results: { type: "number", description: "Number of results to return (default: 5)" },
      },
      required: ["query"],
    },
    mode: "auto" as const,
  },
  {
    name: "fetch_url",
    description: "Fetch and read the content of a URL",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        max_length: { type: "number", description: "Max characters to return" },
      },
      required: ["url"],
    },
    mode: "auto" as const,
  },
  {
    name: "take_screenshot",
    description: "Capture a screenshot of a webpage",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to screenshot" },
        full_page: { type: "boolean", description: "Capture full page or viewport only" },
      },
      required: ["url"],
    },
    mode: "auto" as const,
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export function createHandlers() {
  return {
    async web_search(input: Record<string, unknown>): Promise<string> {
      // Stub — will be implemented with a search API integration
      return JSON.stringify({
        query: input.query,
        results: [],
        note: "Web search not yet implemented in Gateway. Use legacy Python backend.",
      });
    },

    async fetch_url(input: Record<string, unknown>): Promise<string> {
      const url = input.url as string;
      const maxLength = (input.max_length as number) || 10000;

      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: {
            "User-Agent": "Dyno-Agent/1.0",
          },
        });

        if (!res.ok) {
          return `Error: HTTP ${res.status} ${res.statusText}`;
        }

        const text = await res.text();
        return text.slice(0, maxLength);
      } catch (err) {
        return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
      }
    },

    async take_screenshot(input: Record<string, unknown>): Promise<string> {
      // Stub — requires headless browser integration
      return JSON.stringify({
        url: input.url,
        note: "Screenshot not yet implemented in Gateway. Use legacy Python backend.",
      });
    },
  };
}
