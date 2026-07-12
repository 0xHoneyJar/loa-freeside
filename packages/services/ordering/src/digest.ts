import { createHash } from 'node:crypto';

/**
 * Deterministic content digests for lifecycle events (inputs_digest, output_digest).
 *
 * Canonical JSON with recursively sorted object keys so the same logical value always
 * hashes identically regardless of property order. This is a digest helper, NOT the
 * signing envelope — lifecycle-event signing (ed25519 + JCS, @freeside/events) is
 * sequenced after the first useful order (SDD §13 M-10), and swaps in at the publisher.
 */

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize(obj[key]);
  }
  return sorted;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** sha256 hex of the canonical JSON of `value`. 64-char lowercase hex. */
export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
