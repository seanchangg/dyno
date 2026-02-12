/**
 * Encrypted API key storage per user.
 *
 * Frontend sends the API key once, Gateway encrypts and stores it.
 * Subsequent connections use JWT only — key is retrieved from the store.
 *
 * Keys are encrypted with AES-256-GCM using a server-side secret.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

// ── Constants ────────────────────────────────────────────────────────────────

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// ── KeyStore ─────────────────────────────────────────────────────────────────

export class KeyStore {
  private encryptionKey: Buffer;
  private storePath: string;
  private keys: Map<string, string>; // userId -> encrypted key (hex)

  constructor(secret: string, storePath: string) {
    // Derive a 256-bit key from the secret
    this.encryptionKey = scryptSync(secret, "dyno-key-store-salt", KEY_LENGTH);
    this.storePath = resolve(storePath);
    this.keys = new Map();
    this.load();
  }

  /** Store an API key for a user (encrypted). */
  store(userId: string, apiKey: string): void {
    const encrypted = this.encrypt(apiKey);
    this.keys.set(userId, encrypted);
    this.save();
  }

  /** Retrieve a stored API key for a user. */
  retrieve(userId: string): string | null {
    const encrypted = this.keys.get(userId);
    if (!encrypted) return null;
    try {
      return this.decrypt(encrypted);
    } catch {
      // Corrupted entry — remove it
      this.keys.delete(userId);
      this.save();
      return null;
    }
  }

  /** Check if a user has a stored key. */
  has(userId: string): boolean {
    return this.keys.has(userId);
  }

  /** Remove a user's stored key. */
  remove(userId: string): boolean {
    const deleted = this.keys.delete(userId);
    if (deleted) this.save();
    return deleted;
  }

  /** Encrypt a plaintext string. Returns hex-encoded iv:tag:ciphertext. */
  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, "utf-8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
  }

  /** Decrypt a hex-encoded iv:tag:ciphertext string. */
  private decrypt(encrypted: string): string {
    const [ivHex, tagHex, ciphertext] = encrypted.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  }

  /** Load stored keys from disk. */
  private load(): void {
    try {
      if (existsSync(this.storePath)) {
        const data = JSON.parse(readFileSync(this.storePath, "utf-8"));
        if (data && typeof data === "object") {
          for (const [userId, encrypted] of Object.entries(data)) {
            if (typeof encrypted === "string") {
              this.keys.set(userId, encrypted);
            }
          }
        }
      }
    } catch {
      // Fresh start if file is corrupted
      this.keys.clear();
    }
  }

  /** Persist keys to disk. */
  private save(): void {
    try {
      const dir = dirname(this.storePath);
      mkdirSync(dir, { recursive: true });
      const data: Record<string, string> = {};
      for (const [userId, encrypted] of this.keys) {
        data[userId] = encrypted;
      }
      writeFileSync(this.storePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[key-store] Failed to save:", err);
    }
  }
}
