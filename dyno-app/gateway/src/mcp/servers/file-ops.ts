/**
 * File Operations MCP Server — Scoped to user workspace.
 *
 * Provides: read_file, write_file, modify_file, list_files
 * All paths are scoped to the user's workspace directory.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from "fs";
import { resolve, relative, join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FileOpsConfig {
  workspacePath: string;
  allowedPrefixes: string[]; // e.g. ["data/", "python/"]
}

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "read_file",
    description: "Read the contents of a file in the workspace",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Path relative to workspace root" },
      },
      required: ["filename"],
    },
    mode: "auto" as const,
  },
  {
    name: "write_file",
    description: "Create or overwrite a file in the workspace",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Path relative to workspace root" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["filename", "content"],
    },
    mode: "auto" as const,
  },
  {
    name: "modify_file",
    description: "Replace a string in a file",
    input_schema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Path relative to workspace root" },
        old_string: { type: "string", description: "String to find" },
        new_string: { type: "string", description: "String to replace with" },
      },
      required: ["filename", "old_string", "new_string"],
    },
    mode: "auto" as const,
  },
  {
    name: "list_files",
    description: "List files in a directory",
    input_schema: {
      type: "object",
      properties: {
        directory: { type: "string", description: "Directory path relative to workspace root" },
        recursive: { type: "boolean", description: "Whether to list recursively" },
      },
      required: ["directory"],
    },
    mode: "auto" as const,
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export function createHandlers(config: FileOpsConfig) {
  function safePath(filename: string): string {
    const resolved = resolve(config.workspacePath, filename);
    // Ensure the path is within the workspace
    const rel = relative(config.workspacePath, resolved);
    if (rel.startsWith("..") || resolve(resolved) !== resolved.replace(/\/$/, "")) {
      throw new Error(`Path "${filename}" escapes workspace`);
    }
    return resolved;
  }

  return {
    async read_file(input: Record<string, unknown>): Promise<string> {
      const path = safePath(input.filename as string);
      if (!existsSync(path)) return `Error: File not found: ${input.filename}`;
      return readFileSync(path, "utf-8");
    },

    async write_file(input: Record<string, unknown>): Promise<string> {
      const path = safePath(input.filename as string);
      const dir = resolve(path, "..");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, input.content as string, "utf-8");
      return `Wrote ${(input.content as string).length} bytes to ${input.filename}`;
    },

    async modify_file(input: Record<string, unknown>): Promise<string> {
      const path = safePath(input.filename as string);
      if (!existsSync(path)) return `Error: File not found: ${input.filename}`;
      let content = readFileSync(path, "utf-8");
      const oldStr = input.old_string as string;
      if (!content.includes(oldStr)) {
        return `Error: String not found in ${input.filename}`;
      }
      content = content.replace(oldStr, input.new_string as string);
      writeFileSync(path, content, "utf-8");
      return `Modified ${input.filename}`;
    },

    async list_files(input: Record<string, unknown>): Promise<string> {
      const path = safePath(input.directory as string);
      if (!existsSync(path)) return `Error: Directory not found: ${input.directory}`;

      const entries: string[] = [];
      function walk(dir: string, prefix: string) {
        const items = readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          const relPath = prefix ? `${prefix}/${item.name}` : item.name;
          if (item.isDirectory()) {
            entries.push(`${relPath}/`);
            if (input.recursive) walk(join(dir, item.name), relPath);
          } else {
            const stat = statSync(join(dir, item.name));
            entries.push(`${relPath} (${stat.size} bytes)`);
          }
        }
      }
      walk(path, "");
      return entries.join("\n") || "(empty directory)";
    },
  };
}
