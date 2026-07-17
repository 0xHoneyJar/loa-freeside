/**
 * RFC 8785 JSON Canonicalization + SHA-256.
 *
 * Mirrored from `packages/events/src/jcs.ts` — the repo's canonical
 * content-addressing helper. Kept as a thin local copy: the shared substrate is
 * the audited `canonicalize` npm package + `@noble/hashes`, not this
 * two-function wrapper (the same wrapper is intentionally duplicated across
 * events, freeside-cli, and the bash `lib/jcs.sh`, with a cross-runtime byte
 * identity invariant).
 */

import canonicalizeMod from 'canonicalize';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

// canonicalize@2 is a CJS module whose `module.exports = function`. Under
// bundler/NodeNext resolution TS reads its .d.ts as `export default function` —
// but at runtime the default import IS the function directly. The interop cast
// reconciles the two without createRequire boilerplate.
const canonicalize = canonicalizeMod as unknown as (value: unknown) => string | undefined;

/**
 * RFC 8785 canonical JSON string for `value`.
 *
 * Throws if input contains values JSON cannot represent (functions, symbols,
 * Infinity, NaN, BigInt without toJSON, or undefined at root). Callers should
 * validate payloads against a Zod schema BEFORE canonicalizing.
 */
export function jcsCanonicalize(value: unknown): string {
  const out = canonicalize(value);
  if (typeof out !== 'string') {
    throw new Error(
      'jcsCanonicalize: input is not JSON-representable (functions, symbols, Infinity, NaN, BigInt without toJSON, or undefined at root)',
    );
  }
  return out;
}

/** SHA-256 over a string or bytes, returned as 64-char lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256(bytes));
}
