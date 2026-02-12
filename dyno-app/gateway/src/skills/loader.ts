/**
 * Skill Loader — Discovers and parses SKILL.md files.
 *
 * Skills are markdown files loaded into the agent's system prompt as XML blocks.
 * Three tiers: bundled (ships with Dyno), managed (platform-curated),
 * and workspace (per-user, highest priority).
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { resolve, basename } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  tier: "bundled" | "managed" | "workspace";
  filePath: string;
}

export interface LoadedSkill extends SkillMetadata {
  content: string; // Raw markdown content (without frontmatter)
}

// ── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { metadata: Record<string, string | string[]>; content: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, content: raw };
  }

  const frontmatter = match[1];
  const content = match[2];
  const metadata: Record<string, string | string[]> = {};

  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Handle array values like tags: [tag1, tag2]
    if (value.startsWith("[") && value.endsWith("]")) {
      metadata[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""));
    } else {
      // Strip quotes
      value = value.replace(/^["']|["']$/g, "");
      metadata[key] = value;
    }
  }

  return { metadata, content };
}

// ── Loader ───────────────────────────────────────────────────────────────────

export class SkillLoader {
  private bundledPath: string;
  private managedPath: string;

  constructor(bundledPath: string, managedPath: string) {
    this.bundledPath = resolve(bundledPath);
    this.managedPath = resolve(managedPath);
  }

  /** Discover and load all skills from a directory. */
  private loadFromDir(dir: string, tier: "bundled" | "managed" | "workspace"): LoadedSkill[] {
    if (!existsSync(dir)) return [];

    const skills: LoadedSkill[] = [];

    try {
      const files = readdirSync(dir).filter(
        (f) => f.endsWith(".md") && f !== "README.md"
      );

      for (const file of files) {
        try {
          const filePath = resolve(dir, file);
          const raw = readFileSync(filePath, "utf-8");
          const { metadata, content } = parseFrontmatter(raw);

          const id = (metadata.id as string) || basename(file, ".md");
          const skill: LoadedSkill = {
            id,
            name: (metadata.name as string) || id,
            description: (metadata.description as string) || "",
            version: (metadata.version as string) || "1.0.0",
            author: (metadata.author as string) || "unknown",
            tags: Array.isArray(metadata.tags) ? metadata.tags : [],
            tier,
            filePath,
            content: content.trim(),
          };

          skills.push(skill);
        } catch (err) {
          console.warn(`[skills] Error loading ${file}: ${err}`);
        }
      }
    } catch (err) {
      console.warn(`[skills] Error reading directory ${dir}: ${err}`);
    }

    return skills;
  }

  /** Load all skills (bundled + managed). */
  loadAll(): LoadedSkill[] {
    const bundled = this.loadFromDir(this.bundledPath, "bundled");
    const managed = this.loadFromDir(this.managedPath, "managed");
    return [...bundled, ...managed];
  }

  /** Load skills from a user's workspace skills directory. */
  loadWorkspaceSkills(workspaceSkillsPath: string): LoadedSkill[] {
    return this.loadFromDir(workspaceSkillsPath, "workspace");
  }

  /**
   * Format skills into XML for system prompt injection.
   * Higher-tier skills (workspace) override lower-tier ones with the same id.
   */
  static formatForSystemPrompt(skills: LoadedSkill[], maxTotalChars: number = 50000): string {
    if (skills.length === 0) return "";

    // Deduplicate by id, workspace overrides managed overrides bundled
    const tierPriority = { workspace: 3, managed: 2, bundled: 1 };
    const deduped = new Map<string, LoadedSkill>();
    for (const skill of skills) {
      const existing = deduped.get(skill.id);
      if (!existing || tierPriority[skill.tier] > tierPriority[existing.tier]) {
        deduped.set(skill.id, skill);
      }
    }

    const lines: string[] = ["<available_skills>"];
    let totalChars = lines[0].length;

    for (const skill of deduped.values()) {
      const block = [
        `<skill id="${skill.id}" name="${skill.name}" tier="${skill.tier}">`,
        skill.content,
        "</skill>",
      ].join("\n");

      if (totalChars + block.length > maxTotalChars) {
        lines.push(`<!-- Truncated: ${deduped.size - lines.length + 1} more skills -->`);
        break;
      }

      lines.push(block);
      totalChars += block.length;
    }

    lines.push("</available_skills>");
    return lines.join("\n\n");
  }
}
