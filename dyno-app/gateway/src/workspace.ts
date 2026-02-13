/**
 * Per-user workspace provisioning.
 *
 * Each Supabase user gets an isolated directory structure under
 * gateway/workspaces/{userId}/ with predefined subdirectories.
 */

import { mkdirSync, existsSync, rmSync, readdirSync, statSync, writeFileSync } from "fs";
import { resolve } from "path";

// ── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_SUBDIRS = [
  "data/context",
  "data/config",
  "data/scripts",
  "data/screenshots",
  "data/uploads",
  "data/widgets",
  "sessions",
  "skills",
] as const;

// ── Default context file contents ────────────────────────────────────────────

export const DEFAULT_CLAUDE_MD = `# Agent System Prompt

You are a helpful personal AI agent managed through Marty.

## Instructions
- Be concise and helpful
- Use tools when appropriate
- Log your thinking process
`;

export const DEFAULT_SOUL_MD = `# Soul

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

export const DEFAULT_HEARTBEAT_MD = `# Heartbeat Tasks

This file is read every time your heartbeat fires. Review the tasks below
and decide if any need attention right now. If nothing needs action,
respond with HEARTBEAT_OK.

## Tasks
- [ ] Check if core-state memory needs updating
`;

// ── WorkspaceManager ─────────────────────────────────────────────────────────

export class WorkspaceManager {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = resolve(basePath);
    // Ensure base directory exists
    mkdirSync(this.basePath, { recursive: true });
  }

  /** Get the root path for a user's workspace. */
  getUserWorkspacePath(userId: string): string {
    return resolve(this.basePath, userId);
  }

  /** Provision a new workspace for a user. No-op if already exists. */
  provision(userId: string): string {
    const workspacePath = this.getUserWorkspacePath(userId);

    if (existsSync(workspacePath)) {
      // Already provisioned — ensure all subdirs exist
      for (const subdir of WORKSPACE_SUBDIRS) {
        mkdirSync(resolve(workspacePath, subdir), { recursive: true });
      }
      return workspacePath;
    }

    // Create all subdirectories
    for (const subdir of WORKSPACE_SUBDIRS) {
      mkdirSync(resolve(workspacePath, subdir), { recursive: true });
    }

    // Seed default context files
    this.seedDefaultContextFiles(workspacePath);

    console.log(`[workspace] Provisioned workspace for user ${userId}`);
    return workspacePath;
  }

  /** Seed default context files (claude.md, soul.md, heartbeat.md) if they don't exist. */
  seedDefaultContextFiles(workspacePath: string, userName?: string): void {
    const contextDir = resolve(workspacePath, "data", "context");
    mkdirSync(contextDir, { recursive: true });

    const claudePath = resolve(contextDir, "claude.md");
    if (!existsSync(claudePath)) {
      let content = DEFAULT_CLAUDE_MD;
      if (userName) {
        content = content.replace(
          "# Agent System Prompt",
          `# Agent System Prompt\n\nUser: ${userName}`
        );
      }
      writeFileSync(claudePath, content, "utf-8");
    }

    const soulPath = resolve(contextDir, "soul.md");
    if (!existsSync(soulPath)) {
      writeFileSync(soulPath, DEFAULT_SOUL_MD, "utf-8");
    }

    const heartbeatPath = resolve(contextDir, "heartbeat.md");
    if (!existsSync(heartbeatPath)) {
      writeFileSync(heartbeatPath, DEFAULT_HEARTBEAT_MD, "utf-8");
    }
  }

  /** Check if a workspace exists for a user. */
  exists(userId: string): boolean {
    return existsSync(this.getUserWorkspacePath(userId));
  }

  /** Get workspace status info. */
  getStatus(userId: string): {
    exists: boolean;
    path: string;
    subdirs: string[];
    sizeBytes: number;
  } {
    const workspacePath = this.getUserWorkspacePath(userId);
    const wsExists = existsSync(workspacePath);

    if (!wsExists) {
      return { exists: false, path: workspacePath, subdirs: [], sizeBytes: 0 };
    }

    const subdirs: string[] = [];
    let totalSize = 0;

    function walkDir(dir: string, prefix: string) {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name);
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            subdirs.push(relPath);
            walkDir(fullPath, relPath);
          } else {
            try {
              totalSize += statSync(fullPath).size;
            } catch {
              // Skip files we can't stat
            }
          }
        }
      } catch {
        // Skip dirs we can't read
      }
    }

    walkDir(workspacePath, "");

    return { exists: true, path: workspacePath, subdirs, sizeBytes: totalSize };
  }

  /** Teardown a user's workspace (destructive). */
  teardown(userId: string): boolean {
    const workspacePath = this.getUserWorkspacePath(userId);
    if (!existsSync(workspacePath)) {
      return false;
    }

    rmSync(workspacePath, { recursive: true, force: true });
    console.log(`[workspace] Torn down workspace for user ${userId}`);
    return true;
  }

  /** List all provisioned user IDs. */
  listUsers(): string[] {
    try {
      return readdirSync(this.basePath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}
