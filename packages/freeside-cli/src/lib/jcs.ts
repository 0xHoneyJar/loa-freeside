/**
 * RFC 8785 JSON Canonicalization + SHA-256 — COPIED VERBATIM (sprint-400 T3,
 * SDD §3.1 / correction 2) from packages/events/src/jcs.ts:23-42.
 *
 * Why copied, not imported: G-4 keeps the contract-plane dependency graph light —
 * freeside-cli MUST NOT import @freeside/events (runtime). The recipe is 3 lines
 * + the CJS-interop cast; a cross-impl identity test (jcs.test.ts) freezes a
 * known input→hash so this copy can never silently diverge from events/jcs.ts.
 */
import canonicalizeMod from "canonicalize";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

// canonicalize@2 is a CJS module whose `module.exports = function`. Under
// `module: NodeNext` TS reads its .d.ts as `export default function` — but at
// runtime the default-import IS the function directly. The interop cast here
// reconciles the two without pulling in createRequire boilerplate.
const canonicalize = canonicalizeMod as unknown as (value: unknown) => string | undefined;

/**
 * RFC 8785 JSON Canonicalization Scheme. Wraps the `canonicalize` npm package
 * (small, zero-dep, audited). Byte-identical to events/jcs.ts by construction.
 *
 * Throws if input contains values JSON cannot represent (functions, symbols,
 * Infinity, NaN, BigInt without toJSON). Callers should validate payloads
 * against a schema BEFORE canonicalizing.
 */
export function jcsCanonicalize(value: unknown): string {
  const out = canonicalize(value);
  if (typeof out !== "string") {
    throw new Error(
      "jcsCanonicalize: input is not JSON-representable (functions, symbols, Infinity, NaN, BigInt without toJSON, or undefined at root)",
    );
  }
  return out;
}

/**
 * SHA-256 over a string (or bytes), returned as 64-char lowercase hex.
 * Used by doctor's sealed-schema recompute: sha256Hex(jcsCanonicalize(schema)).
 */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256(bytes));
}
