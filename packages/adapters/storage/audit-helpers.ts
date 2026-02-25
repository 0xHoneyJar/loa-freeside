/**
 * Audit Trail Helpers — Shared utilities for audit chain services (cycle-043)
 *
 * Extracted from audit-trail-service.ts and governed-mutation-service.ts
 * to prevent divergence of advisory lock hashing and retry utilities.
 *
 * Bridge finding: low-1 (hashCode duplication), medium-1 (hash space collision)
 */

/**
 * Compute a 32-bit advisory lock key from a domain tag string.
 *
 * Uses FNV-1a hash for better distribution than Java-style hashCode.
 * The 32-bit space (~4B values) is sufficient for advisory locks where
 * collision means over-locking (safe) not under-locking (unsafe).
 */
export function advisoryLockKey(str: string): number {
  // FNV-1a 32-bit
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash | 0);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
