import fs from "fs/promises";
import path from "path";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const DEFAULT_CLAUDE_MD = `# Agent System Prompt

You are a helpful personal AI agent managed through Marty.

## Instructions
- Be concise and helpful
- Use tools when appropriate
- Log your thinking process
`;

const DEFAULT_SOUL_MD = `# Soul

## Identity
You are a helpful personal AI agent.

## Values
- Be proactive and anticipate user needs
- Be concise and direct
- Protect user data and privacy

## Personality
- Professional but friendly
- Take initiative when tasks are clear
`;

const DEFAULT_HEARTBEAT_MD = `# Heartbeat Tasks

This file is read every time your heartbeat fires. Review the tasks below
and decide if any need attention right now. If nothing needs action,
respond with HEARTBEAT_OK.

## Tasks
- [ ] Check if core-state memory needs updating
`;

/** All local data lives inside the project: dyno-app/data/ */
function getDataDir(): string {
  return path.resolve(process.cwd(), "data");
}

export async function ensureDynoDir(): Promise<string> {
  const dataDir = getDataDir();
  await fs.mkdir(path.join(dataDir, "context"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "logs"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "config"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "screenshots"), { recursive: true });
  await fs.mkdir(path.join(dataDir, "uploads"), { recursive: true });
  return dataDir;
}

export { getDataDir };

export async function initializeDefaultContext(userName?: string): Promise<void> {
  const dataDir = await ensureDynoDir();

  // claude.md
  const contextPath = path.join(dataDir, "context", "claude.md");
  try {
    await fs.access(contextPath);
  } catch {
    let content = DEFAULT_CLAUDE_MD;
    if (userName) {
      content = content.replace(
        "# Agent System Prompt",
        `# Agent System Prompt\n\nUser: ${userName}`
      );
    }
    await fs.writeFile(contextPath, content, "utf-8");
  }

  // soul.md
  const soulPath = path.join(dataDir, "context", "soul.md");
  try {
    await fs.access(soulPath);
  } catch {
    await fs.writeFile(soulPath, DEFAULT_SOUL_MD, "utf-8");
  }

  // heartbeat.md
  const heartbeatPath = path.join(dataDir, "context", "heartbeat.md");
  try {
    await fs.access(heartbeatPath);
  } catch {
    await fs.writeFile(heartbeatPath, DEFAULT_HEARTBEAT_MD, "utf-8");
  }
}

export async function readContextFile(filename: string): Promise<string> {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, "context", filename);
  return fs.readFile(filePath, "utf-8");
}

export async function writeContextFile(
  filename: string,
  content: string
): Promise<void> {
  const dataDir = await ensureDynoDir();
  const filePath = path.join(dataDir, "context", filename);
  await fs.writeFile(filePath, content, "utf-8");
}

export async function listContextFiles(): Promise<string[]> {
  const dataDir = getDataDir();
  const contextDir = path.join(dataDir, "context");
  try {
    return await fs.readdir(contextDir);
  } catch {
    return [];
  }
}

// ── Per-user context functions (Supabase-backed) ────────────────────────────

const DEFAULT_CONTEXT_FILES: Record<string, string> = {
  "claude.md": DEFAULT_CLAUDE_MD,
  "soul.md": DEFAULT_SOUL_MD,
  "heartbeat.md": DEFAULT_HEARTBEAT_MD,
};

/** Seed default context files for a new user (no-op for files that already exist). */
export async function initializeUserContext(userId: string, userName?: string): Promise<void> {
  const supabase = createServerSupabaseClient();

  // Check which files already exist
  const { data: existing } = await supabase
    .from("user_context_files")
    .select("filename")
    .eq("user_id", userId);

  const existingNames = new Set((existing ?? []).map((r: { filename: string }) => r.filename));

  const toInsert: { user_id: string; filename: string; content: string }[] = [];
  for (const [filename, defaultContent] of Object.entries(DEFAULT_CONTEXT_FILES)) {
    if (!existingNames.has(filename)) {
      let content = defaultContent;
      if (filename === "claude.md" && userName) {
        content = content.replace(
          "# Agent System Prompt",
          `# Agent System Prompt\n\nUser: ${userName}`
        );
      }
      toInsert.push({ user_id: userId, filename, content });
    }
  }

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("user_context_files")
      .insert(toInsert);
    if (error) console.warn("[dyno-fs] initializeUserContext insert error:", error.message);
  }
}

export async function readUserContextFile(userId: string, filename: string): Promise<string> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_context_files")
    .select("content")
    .eq("user_id", userId)
    .eq("filename", filename)
    .single();

  if (error || !data) throw new Error(`Context file not found: ${filename}`);
  return data.content;
}

export async function writeUserContextFile(
  userId: string,
  filename: string,
  content: string
): Promise<void> {
  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("user_context_files")
    .upsert(
      { user_id: userId, filename, content, updated_at: new Date().toISOString() },
      { onConflict: "user_id,filename" }
    );
  if (error) throw new Error(`Failed to write context file: ${error.message}`);
}

export async function listUserContextFiles(userId: string): Promise<string[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("user_context_files")
    .select("filename")
    .eq("user_id", userId)
    .order("filename");

  if (error) return [];
  return (data ?? []).map((r: { filename: string }) => r.filename);
}

export async function appendTelemetry(entry: Record<string, unknown>): Promise<void> {
  const dataDir = await ensureDynoDir();
  const logPath = path.join(dataDir, "logs", "telemetry.json");
  let entries: Record<string, unknown>[] = [];
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    entries = JSON.parse(raw);
  } catch {
    entries = [];
  }
  entries.push(entry);
  await fs.writeFile(logPath, JSON.stringify(entries, null, 2), "utf-8");
}

export async function readTelemetry(): Promise<Record<string, unknown>[]> {
  const dataDir = getDataDir();
  const logPath = path.join(dataDir, "logs", "telemetry.json");
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

const DEFAULT_MAX_STORED_MESSAGES = 200;

export async function readChatHistory(): Promise<Record<string, unknown>[]> {
  const dataDir = getDataDir();
  const historyPath = path.join(dataDir, "logs", "chat-history.json");
  try {
    const raw = await fs.readFile(historyPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeChatHistory(
  messages: Record<string, unknown>[],
  maxStoredMessages?: number
): Promise<void> {
  const dataDir = await ensureDynoDir();
  const historyPath = path.join(dataDir, "logs", "chat-history.json");
  const limit = maxStoredMessages ?? DEFAULT_MAX_STORED_MESSAGES;
  const trimmed = messages.slice(-limit);
  await fs.writeFile(historyPath, JSON.stringify(trimmed, null, 2), "utf-8");
}

export async function clearChatHistory(): Promise<void> {
  const dataDir = getDataDir();
  const historyPath = path.join(dataDir, "logs", "chat-history.json");
  await fs.writeFile(historyPath, "[]", "utf-8");
}

export async function readLayout(): Promise<unknown> {
  const dataDir = getDataDir();
  const layoutPath = path.join(dataDir, "layout.json");
  try {
    const raw = await fs.readFile(layoutPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeLayout(layout: unknown): Promise<void> {
  const dataDir = await ensureDynoDir();
  const layoutPath = path.join(dataDir, "layout.json");
  await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2), "utf-8");
}
