// DEPRECATED: All execution flows through Python MCP server. See python/tools/execution.py.

/**
 * Code Execution MCP Server — Sandboxed code execution.
 *
 * Provides: execute_code, save_script, run_script, list_scripts
 * Code runs in a sandboxed subprocess.
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { resolve } from "path";

// ── Environment sanitization ────────────────────────────────────────────────
// Allowlist approach: only expose env vars that code execution legitimately needs.
const ALLOWED_ENV_KEYS = new Set([
  "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR",
  "HOME", "USER", "SHELL", "PYTHONDONTWRITEBYTECODE",
  "VIRTUAL_ENV",
]);

function getSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }
  return env;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: "execute_code",
    description: "Execute code in a sandboxed environment. Supports Python, JavaScript, TypeScript, Bash.",
    input_schema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript", "typescript", "bash"], description: "Programming language" },
        code: { type: "string", description: "Code to execute" },
        timeout: { type: "number", description: "Timeout in seconds (default: 30)" },
      },
      required: ["language", "code"],
    },
    mode: "auto" as const,
  },
  {
    name: "save_script",
    description: "Save a reusable script",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Script name (without extension)" },
        language: { type: "string", enum: ["python", "javascript", "typescript", "bash"] },
        code: { type: "string", description: "Script content" },
      },
      required: ["name", "language", "code"],
    },
    mode: "auto" as const,
  },
  {
    name: "run_script",
    description: "Run a saved script by name",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Script name" },
        args: { type: "string", description: "Arguments to pass" },
      },
      required: ["name"],
    },
    mode: "auto" as const,
  },
  {
    name: "list_scripts",
    description: "List all saved scripts",
    input_schema: {
      type: "object",
      properties: {},
    },
    mode: "auto" as const,
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

export function createHandlers(scriptsDir: string) {
  mkdirSync(scriptsDir, { recursive: true });

  const langExt: Record<string, string> = {
    python: ".py",
    javascript: ".js",
    typescript: ".ts",
    bash: ".sh",
  };

  const pythonCmd = process.env.PYTHON_EXECUTABLE || "python3";
  const langCmd: Record<string, string> = {
    python: pythonCmd,
    javascript: "node",
    typescript: "npx tsx",
    bash: "bash",
  };

  return {
    async execute_code(input: Record<string, unknown>): Promise<string> {
      const language = input.language as string;
      const code = input.code as string;
      const timeout = ((input.timeout as number) || 30) * 1000;
      const ext = langExt[language];
      const cmd = langCmd[language];

      if (!ext || !cmd) {
        return `Error: Unsupported language: ${language}`;
      }

      const tmpFile = resolve(scriptsDir, `_tmp_exec${ext}`);
      try {
        writeFileSync(tmpFile, code, "utf-8");
        const result = execSync(`${cmd} "${tmpFile}"`, {
          timeout,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
          cwd: scriptsDir,
          env: getSafeEnv(),
        });
        return result || "(no output)";
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        return `Error: ${execErr.stderr || execErr.message || String(err)}`;
      } finally {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    },

    async save_script(input: Record<string, unknown>): Promise<string> {
      const name = input.name as string;
      const language = input.language as string;
      const code = input.code as string;
      const ext = langExt[language] || ".txt";
      const filePath = resolve(scriptsDir, `${name}${ext}`);
      writeFileSync(filePath, code, "utf-8");
      return `Saved script: ${name}${ext}`;
    },

    async run_script(input: Record<string, unknown>): Promise<string> {
      const name = input.name as string;
      const args = (input.args as string) || "";

      // Find the script file
      for (const [lang, ext] of Object.entries(langExt)) {
        const filePath = resolve(scriptsDir, `${name}${ext}`);
        if (existsSync(filePath)) {
          const cmd = langCmd[lang];
          try {
            const result = execSync(`${cmd} "${filePath}" ${args}`, {
              timeout: 30000,
              maxBuffer: 1024 * 1024,
              encoding: "utf-8",
              cwd: scriptsDir,
              env: getSafeEnv(),
            });
            return result || "(no output)";
          } catch (err: unknown) {
            const execErr = err as { stderr?: string; message?: string };
            return `Error: ${execErr.stderr || execErr.message || String(err)}`;
          }
        }
      }
      return `Error: Script "${name}" not found`;
    },

    async list_scripts(): Promise<string> {
      const files = readdirSync(scriptsDir).filter(
        (f) => !f.startsWith("_tmp_") && !f.startsWith(".")
      );
      if (files.length === 0) return "No saved scripts.";
      return files.join("\n");
    },
  };
}
