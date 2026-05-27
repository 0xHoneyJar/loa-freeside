import canonicalizeMod from "canonicalize";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
// canonicalize@2 is a CJS module whose `module.exports = function`. Under
// `module: NodeNext` TS reads its .d.ts as `export default function` — but
// at runtime the default-import IS the function directly. The interop cast
// here reconciles the two without pulling in createRequire boilerplate.
const canonicalize = canonicalizeMod;
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
export function jcsCanonicalize(value) {
    const out = canonicalize(value);
    if (typeof out !== "string") {
        throw new Error("jcsCanonicalize: input is not JSON-representable (functions, symbols, Infinity, NaN, BigInt without toJSON, or undefined at root)");
    }
    return out;
}
/**
 * SHA-256 over a string, returned as 64-char lowercase hex.
 *
 * Used for payload_hash (over JCS-canonical payload) and prev_hash
 * (over JCS-canonical envelope of the prior message).
 */
export function sha256Hex(input) {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    return bytesToHex(sha256(bytes));
}
//# sourceMappingURL=jcs.js.map