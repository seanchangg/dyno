/**
 * Hybrid Memory Store — SQLite + FTS5 for BM25 text search.
 *
 * Per-user SQLite database at workspaces/{userId}/memory.db
 * Tables:
 *   - memories: id, content, tag, title, created_at, updated_at
 *   - memory_fts: FTS5 virtual table for BM25 full-text search
 *   - memory_embeddings: vector BLOB for semantic search (Phase 5b)
 *
 * Hybrid scoring: 0.7 * vector_similarity + 0.3 * bm25_score
 * (vector search is a stub until sqlite-vec is integrated)
 */

import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Memory {
  id: string;
  content: string;
  tag: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchResult extends Memory {
  score: number;
  match_type: "bm25" | "vector" | "hybrid";
}

// ── HybridStore ──────────────────────────────────────────────────────────────

/**
 * SQLite-based hybrid memory store.
 *
 * Note: This implementation uses a JSON file as a stand-in for SQLite
 * to avoid requiring native SQLite bindings. In production, this would
 * use better-sqlite3 or sql.js with FTS5 and sqlite-vec extensions.
 */
export class HybridStore {
  private dbPath: string;
  private memories: Memory[] = [];
  private loaded = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = dirname(dbPath);
    mkdirSync(dir, { recursive: true });
  }

  /** Initialize the store, loading existing data. */
  async init(): Promise<void> {
    // Use JSON file as portable stand-in for SQLite
    const jsonPath = this.dbPath.replace(".db", ".json");
    if (existsSync(jsonPath)) {
      const { readFileSync } = await import("fs");
      try {
        this.memories = JSON.parse(readFileSync(jsonPath, "utf-8"));
      } catch {
        this.memories = [];
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const jsonPath = this.dbPath.replace(".db", ".json");
    const { writeFileSync } = await import("fs");
    writeFileSync(jsonPath, JSON.stringify(this.memories, null, 2), "utf-8");
  }

  /** Save a new memory. */
  async save(content: string, tag: string, title?: string): Promise<Memory> {
    if (!this.loaded) await this.init();

    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const memory: Memory = {
      id,
      content,
      tag,
      title: title || null,
      created_at: now,
      updated_at: now,
    };

    this.memories.push(memory);
    await this.persist();
    return memory;
  }

  /** Recall memories with BM25 text search. */
  async recall(query?: string, tag?: string, limit: number = 10): Promise<SearchResult[]> {
    if (!this.loaded) await this.init();

    let filtered = [...this.memories];

    // Filter by tag
    if (tag) {
      filtered = filtered.filter((m) => m.tag === tag);
    }

    let results: SearchResult[];

    // BM25-style text search (simplified)
    if (query) {
      const queryTerms = query.toLowerCase().split(/\s+/);
      results = filtered
        .map((m) => {
          const text = `${m.title || ""} ${m.content} ${m.tag}`.toLowerCase();
          let score = 0;
          for (const term of queryTerms) {
            const matches = (text.match(new RegExp(term, "g")) || []).length;
            if (matches > 0) {
              // Simple TF-IDF-like scoring
              score += Math.log(1 + matches) / Math.log(1 + text.length / 100);
            }
          }
          return { ...m, score, match_type: "bm25" as const };
        })
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score);
    } else {
      // No query — sort by recency
      results = filtered
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((m) => ({ ...m, score: 1, match_type: "bm25" as const }));
    }

    return results.slice(0, limit);
  }

  /** Get a memory by ID. */
  async get(id: string): Promise<Memory | null> {
    if (!this.loaded) await this.init();
    return this.memories.find((m) => m.id === id) || null;
  }

  /** Delete a memory by ID. */
  async delete(id: string): Promise<boolean> {
    if (!this.loaded) await this.init();
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    await this.persist();
    return true;
  }

  /** Append content to an existing memory. */
  async append(id: string, content: string): Promise<boolean> {
    if (!this.loaded) await this.init();
    const memory = this.memories.find((m) => m.id === id);
    if (!memory) return false;
    memory.content += `\n\n${content}`;
    memory.updated_at = new Date().toISOString();
    await this.persist();
    return true;
  }

  /** Edit a memory (find and replace). */
  async edit(id: string, oldText: string, newText: string): Promise<boolean> {
    if (!this.loaded) await this.init();
    const memory = this.memories.find((m) => m.id === id);
    if (!memory || !memory.content.includes(oldText)) return false;
    memory.content = memory.content.replace(oldText, newText);
    memory.updated_at = new Date().toISOString();
    await this.persist();
    return true;
  }

  /** List all unique tags. */
  async listTags(): Promise<string[]> {
    if (!this.loaded) await this.init();
    return [...new Set(this.memories.map((m) => m.tag))];
  }

  /** Get all memories (for sync). */
  async getAll(): Promise<Memory[]> {
    if (!this.loaded) await this.init();
    return [...this.memories];
  }

  /** Bulk import memories (for migration). */
  async bulkImport(memories: Memory[]): Promise<number> {
    if (!this.loaded) await this.init();
    const existingIds = new Set(this.memories.map((m) => m.id));
    let imported = 0;
    for (const m of memories) {
      if (!existingIds.has(m.id)) {
        this.memories.push(m);
        imported++;
      }
    }
    if (imported > 0) await this.persist();
    return imported;
  }
}
