/**
 * RFC 8785 JSON Canonicalization Scheme.
 *
 * Wraps the `canonicalize` npm package — small (zero-dep), audited, widely used.
 * The cycle-098 prior art (`.claude/scripts/lib/jcs.sh`) is a bash port of the
 * same spec; a cross-runtime identity test (TypeScript ↔ bash) ensures both
 * produce byte-identical output for the same input (R15 invariant).
 *
 * Throws if input contains values JSON cannot represent (functions, symbols,
 * Infinity, NaN, BigInt without toJSON). Callers should validate payloads
 * against a Zod schema BEFORE canonicalizing.
 */
export declare function jcsCanonicalize(value: unknown): string;
/**
 * SHA-256 over a string, returned as 64-char lowercase hex.
 *
 * Used for payload_hash (over JCS-canonical payload) and prev_hash
 * (over JCS-canonical envelope of the prior message).
 */
export declare function sha256Hex(input: string | Uint8Array): string;
//# sourceMappingURL=jcs.d.ts.map