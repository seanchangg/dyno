/**
 * Skills Registry — Per-user skill installation tracking.
 *
 * Tracks which skills are installed for each user.
 * Manages skill dependencies and provides the active skill list
 * for system prompt injection.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { SkillLoader, type LoadedSkill, type SkillMetadata } from "./loader.js";

// ── Cloud mode restrictions (injected into system prompt) ─────────────────────

const CLOUD_MODE_RESTRICTIONS = `<cloud_mode_restrictions>
You are running in CLOUD MODE. The following restrictions apply:

## Unavailable Tools
- \`install_package\` — DOES NOT EXIST. Do not attempt to use it. You cannot install packages.

## Restricted Tools
- \`write_file\` — Can ONLY write to \`workspace/\` paths. Cannot write to \`python/\` (source code is read-only). Cannot write to \`workspace/skills/\` (use skill tools instead).
- \`modify_file\` — Same restrictions as write_file. Cannot modify \`python/\` source code or skill files.

## What To Use Instead
- To manage skills: use \`create_skill\`, \`update_skill\`, \`read_skill\`, \`list_workspace_skills\`, \`delete_skill\`
- To store data files: use \`write_file\` with \`workspace/\` paths (e.g. \`workspace/data/config.json\`)
- To read your own source code: use \`read_file\` with \`python/\` paths (read-only)

Do NOT attempt to write to python/, modify your own source code, or install packages. These operations will fail.
</cloud_mode_restrictions>`;

// ── Types ────────────────────────────────────────────────────────────────────

interface UserSkillState {
  installed: Set<string>; // Skill IDs
  updatedAt: number;
}

// ── SkillRegistry ────────────────────────────────────────────────────────────

export class SkillRegistry {
  private loader: SkillLoader;
  private allSkills: LoadedSkill[] = [];
  private userStates = new Map<string, UserSkillState>();
  private dataDir: string;

  constructor(loader: SkillLoader, dataDir: string) {
    this.loader = loader;
    this.dataDir = resolve(dataDir);
    mkdirSync(this.dataDir, { recursive: true });

    // Initial load
    this.refresh();
  }

  /** Reload all skills from disk. */
  refresh(): void {
    this.allSkills = this.loader.loadAll();
    console.log(`[skills] Loaded ${this.allSkills.length} skills (bundled + managed)`);
  }

  /** Get all available skills (metadata only). */
  listAvailable(): SkillMetadata[] {
    return this.allSkills.map(({ content: _, ...meta }) => meta);
  }

  /** Get full skill detail including content. */
  getSkill(skillId: string): LoadedSkill | null {
    return this.allSkills.find((s) => s.id === skillId) || null;
  }

  /** Get installed skill IDs for a user. */
  getInstalledSkillIds(userId: string): string[] {
    const state = this.getUserState(userId);
    return Array.from(state.installed);
  }

  /** Install a skill for a user. */
  install(userId: string, skillId: string): boolean {
    const skill = this.getSkill(skillId);
    if (!skill) return false;

    const state = this.getUserState(userId);
    state.installed.add(skillId);
    state.updatedAt = Date.now();
    this.saveUserState(userId, state);
    return true;
  }

  /** Uninstall a skill for a user. */
  uninstall(userId: string, skillId: string): boolean {
    const state = this.getUserState(userId);
    const removed = state.installed.delete(skillId);
    if (removed) {
      state.updatedAt = Date.now();
      this.saveUserState(userId, state);
    }
    return removed;
  }

  /** Check if a skill is installed for a user. */
  isInstalled(userId: string, skillId: string): boolean {
    const state = this.getUserState(userId);
    return state.installed.has(skillId);
  }

  /**
   * Get the active skills for a user's system prompt.
   * Includes bundled skills (always active) + user-installed skills
   * + workspace skills (from local dir or Supabase).
   */
  async getActiveSkills(userId: string, workspaceSkillsPath?: string): Promise<LoadedSkill[]> {
    const state = this.getUserState(userId);
    const active: LoadedSkill[] = [];

    // Bundled skills are always active
    for (const skill of this.allSkills) {
      if (skill.tier === "bundled") {
        active.push(skill);
      } else if (state.installed.has(skill.id)) {
        active.push(skill);
      }
    }

    // Load workspace skills from local dir if path provided
    if (workspaceSkillsPath) {
      const workspaceSkills = this.loader.loadWorkspaceSkills(workspaceSkillsPath);
      active.push(...workspaceSkills);
    }

    // Load workspace skills from Supabase (cloud mode)
    const storageMode = process.env.STORAGE_MODE || "local";
    if (storageMode === "cloud") {
      try {
        const cloudSkills = await this.loader.loadFromSupabase(userId);
        if (cloudSkills.length > 0) {
          console.log(`[skills] Loaded ${cloudSkills.length} workspace skills from Supabase for ${userId}`);
          active.push(...cloudSkills);
        }
      } catch (err) {
        console.warn(`[skills] Failed to load cloud skills for ${userId}:`, err);
      }
    }

    return active;
  }

  /**
   * Generate the skills XML block for a user's system prompt.
   * In cloud mode, appends restrictions so the agent knows what's off-limits.
   */
  async getSkillsPrompt(userId: string, workspaceSkillsPath?: string): Promise<string> {
    const active = await this.getActiveSkills(userId, workspaceSkillsPath);
    let prompt = SkillLoader.formatForSystemPrompt(active);

    const storageMode = process.env.STORAGE_MODE || "local";
    if (storageMode === "cloud") {
      prompt += "\n\n" + CLOUD_MODE_RESTRICTIONS;
    }

    return prompt;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private getUserStatePath(userId: string): string {
    return resolve(this.dataDir, `${userId}.json`);
  }

  private getUserState(userId: string): UserSkillState {
    const cached = this.userStates.get(userId);
    if (cached) return cached;

    // Try to load from disk
    const filePath = this.getUserStatePath(userId);
    try {
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, "utf-8"));
        const state: UserSkillState = {
          installed: new Set(data.installed || []),
          updatedAt: data.updatedAt || Date.now(),
        };
        this.userStates.set(userId, state);
        return state;
      }
    } catch {
      // Start fresh
    }

    const fresh: UserSkillState = {
      installed: new Set(),
      updatedAt: Date.now(),
    };
    this.userStates.set(userId, fresh);
    return fresh;
  }

  private saveUserState(userId: string, state: UserSkillState): void {
    const filePath = this.getUserStatePath(userId);
    try {
      writeFileSync(
        filePath,
        JSON.stringify({
          installed: Array.from(state.installed),
          updatedAt: state.updatedAt,
        }),
        "utf-8"
      );
    } catch (err) {
      console.error(`[skills] Failed to save state for ${userId}:`, err);
    }
  }
}
