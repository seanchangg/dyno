/**
 * Tool permission overrides — stores per-tool auto/manual modes.
 *
 * Persisted to gateway/data/tool-overrides.json.
 * When a tool has an override, it takes priority over the default mode.
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

export class ToolPermissions {
  private overrides = new Map<string, "auto" | "manual">();
  private filePath: string;

  constructor(dataDir: string) {
    this.filePath = resolve(dataDir, "tool-overrides.json");
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.load();
  }

  private load() {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [name, mode] of Object.entries(data)) {
        if (mode === "auto" || mode === "manual") {
          this.overrides.set(name, mode);
        }
      }
    } catch {
      // No file or invalid — start empty
    }
  }

  private save() {
    const obj: Record<string, string> = {};
    for (const [name, mode] of this.overrides) {
      obj[name] = mode;
    }
    writeFileSync(this.filePath, JSON.stringify(obj, null, 2), "utf-8");
  }

  /** Get the override for a tool, or null if using default. */
  getMode(toolName: string): "auto" | "manual" | null {
    return this.overrides.get(toolName) ?? null;
  }

  /** Check if a tool is auto-approved (considering overrides). */
  isAutoApproved(toolName: string, defaultAutoApproved: boolean): boolean {
    const override = this.overrides.get(toolName);
    if (override) return override === "auto";
    return defaultAutoApproved;
  }

  /** Set a tool's mode. */
  set(toolName: string, mode: "auto" | "manual") {
    this.overrides.set(toolName, mode);
    this.save();
  }

  /** Remove an override (revert to default). */
  remove(toolName: string) {
    this.overrides.delete(toolName);
    this.save();
  }

  /** Reset all overrides. */
  reset() {
    this.overrides.clear();
    this.save();
  }

  /** Get all overrides as a plain object. */
  getOverrides(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [name, mode] of this.overrides) {
      obj[name] = mode;
    }
    return obj;
  }
}
