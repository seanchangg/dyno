import fs from "fs/promises";
import path from "path";

const DEFAULT_CLAUDE_MD = `# Agent System Prompt

You are a helpful personal AI agent managed through Dyno.

## Instructions
- Be concise and helpful
- Use tools when appropriate
- Log your thinking process
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
