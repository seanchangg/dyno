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
   * + workspace skills.
   */
  getActiveSkills(userId: string, workspaceSkillsPath?: string): LoadedSkill[] {
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

    // Load workspace skills if path provided
    if (workspaceSkillsPath) {
      const workspaceSkills = this.loader.loadWorkspaceSkills(workspaceSkillsPath);
      active.push(...workspaceSkills);
    }

    return active;
  }

  /**
   * Generate the skills XML block for a user's system prompt.
   */
  getSkillsPrompt(userId: string, workspaceSkillsPath?: string): string {
    const active = this.getActiveSkills(userId, workspaceSkillsPath);
    return SkillLoader.formatForSystemPrompt(active);
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
