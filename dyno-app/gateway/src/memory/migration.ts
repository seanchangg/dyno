/**
 * One-time migration: pull all Supabase memories into local hybrid store.
 *
 * Run this when first setting up a user's workspace to bootstrap
 * their local memory database from existing Supabase data.
 */

import type { HybridStore } from "./hybrid-store.js";
import type { MemorySync } from "./sync.js";

export async function migrateFromSupabase(
  store: HybridStore,
  sync: MemorySync
): Promise<{ imported: number; total: number }> {
  // Initialize the store
  await store.init();

  // Pull all memories from Supabase
  const imported = await sync.pullFromSupabase();
  const all = await store.getAll();

  return {
    imported,
    total: all.length,
  };
}
