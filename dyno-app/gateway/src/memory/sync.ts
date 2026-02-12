/**
 * Supabase Memory Sync — Bidirectional sync between local SQLite and Supabase.
 *
 * Write to local store immediately, async push to Supabase.
 * On startup, pull latest from Supabase, merge with local.
 */

import type { HybridStore, Memory } from "./hybrid-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface SyncConfig {
  supabaseUrl: string;
  supabaseKey: string;
}

// ── MemorySync ───────────────────────────────────────────────────────────────

export class MemorySync {
  private store: HybridStore;
  private config: SyncConfig;
  private userId: string;
  private syncQueue: Array<{ action: string; memory: Memory }> = [];
  private syncing = false;

  constructor(store: HybridStore, config: SyncConfig, userId: string) {
    this.store = store;
    this.config = config;
    this.userId = userId;
  }

  /** Pull memories from Supabase and merge with local store. */
  async pullFromSupabase(): Promise<number> {
    const headers = {
      apikey: this.config.supabaseKey,
      Authorization: `Bearer ${this.config.supabaseKey}`,
      "Content-Type": "application/json",
    };

    try {
      const res = await fetch(
        `${this.config.supabaseUrl}/rest/v1/agent_memories?user_id=eq.${this.userId}&order=created_at.asc`,
        { headers, signal: AbortSignal.timeout(10000) }
      );

      if (!res.ok) {
        console.warn(`[sync] Failed to pull from Supabase: ${res.status}`);
        return 0;
      }

      const rows = await res.json() as Record<string, unknown>[];
      const memories: Memory[] = rows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        content: row.content as string,
        tag: (row.tag as string) || "general",
        title: (row.title as string) || null,
        created_at: row.created_at as string,
        updated_at: (row.updated_at as string) || (row.created_at as string),
      }));

      const imported = await this.store.bulkImport(memories);
      if (imported > 0) {
        console.log(`[sync] Imported ${imported} memories from Supabase for user ${this.userId}`);
      }
      return imported;
    } catch (err) {
      console.warn(`[sync] Supabase pull error: ${err}`);
      return 0;
    }
  }

  /** Push a local memory to Supabase. */
  async pushToSupabase(memory: Memory): Promise<boolean> {
    const headers = {
      apikey: this.config.supabaseKey,
      Authorization: `Bearer ${this.config.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    };

    try {
      const res = await fetch(
        `${this.config.supabaseUrl}/rest/v1/agent_memories`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: memory.id,
            user_id: this.userId,
            content: memory.content,
            tag: memory.tag,
            title: memory.title,
            created_at: memory.created_at,
            updated_at: memory.updated_at,
          }),
          signal: AbortSignal.timeout(5000),
        }
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Queue a sync action (non-blocking). */
  queueSync(action: string, memory: Memory): void {
    this.syncQueue.push({ action, memory });
    this.processSyncQueue();
  }

  /** Process queued sync actions. */
  private async processSyncQueue(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;

    while (this.syncQueue.length > 0) {
      const item = this.syncQueue.shift()!;
      try {
        if (item.action === "save" || item.action === "update") {
          await this.pushToSupabase(item.memory);
        }
        // Delete sync could be added here
      } catch {
        // Re-queue on failure (with backoff in production)
      }
    }

    this.syncing = false;
  }
}
