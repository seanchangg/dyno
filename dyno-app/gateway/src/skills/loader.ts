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

  /** Load skills from a user's workspace skills directory (local mode). */
  loadWorkspaceSkills(workspaceSkillsPath: string): LoadedSkill[] {
    return this.loadFromDir(workspaceSkillsPath, "workspace");
  }

  /**
   * Load workspace skills from Supabase Storage (cloud mode).
   * Fetches skill.md files from the workspace bucket under {userId}/skills/.
   */
  async loadFromSupabase(userId: string): Promise<LoadedSkill[]> {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.warn("[skills] Supabase not configured, skipping cloud skill loading");
      return [];
    }

    const skills: LoadedSkill[] = [];

    try {
      // List files in workspace/{userId}/skills/
      const listUrl = `${supabaseUrl}/storage/v1/object/list/workspace`;
      const listResp = await fetch(listUrl, {
        method: "POST",
        headers: {
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prefix: `${userId}/skills/`,
          limit: 100,
          offset: 0,
          sortBy: { column: "name", order: "asc" },
        }),
      });

      if (!listResp.ok) {
        console.warn(`[skills] Supabase list failed (${listResp.status})`);
        return [];
      }

      const files: Array<{ name: string }> = await listResp.json();
      const mdFiles = files.filter((f) => f.name.endsWith(".md"));

      for (const file of mdFiles) {
        try {
          const fileUrl = `${supabaseUrl}/storage/v1/object/workspace/${userId}/skills/${file.name}`;
          const fileResp = await fetch(fileUrl, {
            headers: {
              "apikey": serviceKey,
              "Authorization": `Bearer ${serviceKey}`,
            },
          });

          if (!fileResp.ok) continue;

          const raw = await fileResp.text();
          const { metadata, content } = parseFrontmatter(raw);

          const id = (metadata.id as string) || file.name.replace(/\.md$/, "");
          skills.push({
            id,
            name: (metadata.name as string) || id,
            description: (metadata.description as string) || "",
            version: (metadata.version as string) || "1.0.0",
            author: (metadata.author as string) || "user",
            tags: Array.isArray(metadata.tags) ? metadata.tags : [],
            tier: "workspace",
            filePath: `supabase://workspace/${userId}/skills/${file.name}`,
            content: content.trim(),
          });
        } catch (err) {
          console.warn(`[skills] Error loading cloud skill ${file.name}: ${err}`);
        }
      }
    } catch (err) {
      console.warn(`[skills] Error listing cloud skills: ${err}`);
    }

    return skills;
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
