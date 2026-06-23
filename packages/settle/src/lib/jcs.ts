/**
 * JCS — RFC 8785 JSON Canonicalization Scheme (settle-local twin).
 *
 * Zero-dependency canonicalizer over Node built-ins only (`node:crypto` for the
 * hash). It is a SPEC-PINNED TWIN of `@0xhoneyjar/events/jcs` (which wraps the
 * `canonicalize` npm package) — the same RFC 8785 byte-output, kept here to give
 * the substrate a minimal trusted computing base (threat A-8: no transitive deps
 * in the canonicalize/hash/sign path). This mirrors the codebase's existing
 * cross-runtime JCS precedent: `events/jcs.ts` already maintains a bash twin
 * (`.claude/scripts/lib/jcs.sh`) verified byte-identical by an identity test.
 * `lib/__tests__/jcs.test.ts` is this twin's identity test (RFC 8785 vectors).
 *
 * Scope: the substrate only ever canonicalizes its own typed envelopes —
 * objects, arrays, strings, INTEGERS (no floats, by design: Tetlock is integer
 * ppm), booleans, null. A non-integer number throws: that simultaneously
 * enforces the no-floats invariant AND keeps number serialization trivial
 * (the hard part of RFC 8785 is float shortest-round-trip, which we never hit).
 */

import { createHash } from "node:crypto";

/** RFC 8785 string escaping. JSON.stringify already emits RFC-8785-compatible
 * escaping for strings: short escapes (\b \t \n \f \r \" \\) and lowercase
 * \u00xx for the remaining C0 control characters. */
function canonString(s: string): string {
  return JSON.stringify(s);
}

function canonValue(value: unknown): string {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "string") return canonString(value as string);

  if (t === "boolean") return value ? "true" : "false";

  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new TypeError(`jcs: non-finite number is not JSON-representable: ${n}`);
    }
    if (!Number.isInteger(n)) {
      // By design the substrate carries no floats (integer ppm only). A float
      // here is a bug at the type layer; fail loud rather than guess a rounding.
      throw new TypeError(`jcs: non-integer number rejected (no floats in the substrate): ${n}`);
    }
    // Number.isInteger(-0) is true and String(-0) === "0" — RFC 8785 agrees.
    return String(n);
  }

  if (t === "bigint") {
    // bigint serializes as its decimal digits with no suffix.
    return (value as bigint).toString();
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonValue).join(",") + "]";
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    // RFC 8785: object keys sorted by UTF-16 code units. JS string sort and
    // Array.prototype.sort default comparator both order by UTF-16 code unit.
    const keys = Object.keys(obj).sort();
    const members: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // undefined members are omitted (not representable)
      members.push(canonString(k) + ":" + canonValue(v));
    }
    return "{" + members.join(",") + "}";
  }

  throw new TypeError(`jcs: value of type ${t} is not JSON-representable`);
}

/**
 * Canonicalize a value to its RFC 8785 byte-string form.
 * Throws on functions, symbols, undefined-at-root, non-finite or non-integer numbers.
 */
export function jcsCanonicalize(value: unknown): string {
  if (value === undefined) {
    throw new TypeError("jcs: undefined at root is not JSON-representable");
  }
  return canonValue(value);
}

/** SHA-256 over a string or bytes → 64-char lowercase hex. */
export function sha256Hex(input: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(typeof input === "string" ? Buffer.from(input, "utf8") : input);
  return h.digest("hex");
}

/** SHA-256 of the JCS-canonical form of a value → 64-char lowercase hex. */
export function jcsHash(value: unknown): string {
  return sha256Hex(jcsCanonicalize(value));
}
