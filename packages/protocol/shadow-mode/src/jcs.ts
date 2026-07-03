/**
 * RFC 8785 (JCS) canonical JSON serialization — the byte layout every chain
 * hash is computed over (SDD sandwich-line §6a). Deterministic forever: same
 * value → same bytes, in any compliant runtime.
 *
 * Why a local implementation instead of a dependency: ECMAScript is the
 * reference semantics for RFC 8785 — native `String(number)` IS the required
 * number serialization and `JSON.stringify` string escaping IS the required
 * escaping — so the whole algorithm is property ordering + recursion. Cross-
 * checked against the RFC Appendix A vectors in __tests__/jcs.test.ts (which
 * also mirror the estate's python `loa_cheval.jcs` wrapper output).
 */

export class JcsError extends Error {}

function serialize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new JcsError('JCS: non-finite number');
      // ECMAScript Number::toString(10) — the RFC 8785 number serialization.
      return JSON.stringify(value);
    case 'string':
      // JSON.stringify escaping matches RFC 8785 §3.2.2.2.
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        // undefined array elements serialize as null (JSON semantics).
        return `[${value.map((v) => (v === undefined ? 'null' : serialize(v))).join(',')}]`;
      }
      // Property names sorted by UTF-16 code units — the JS default sort.
      const obj = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(obj).sort()) {
        const v = obj[key];
        if (v === undefined) continue; // JSON.stringify drops undefined props
        parts.push(`${JSON.stringify(key)}:${serialize(v)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      // undefined / function / symbol / bigint have no JCS representation.
      throw new JcsError(`JCS: unsupported type ${typeof value}`);
  }
}

/** Canonical JSON string per RFC 8785. */
export function jcsCanonicalize(value: unknown): string {
  if (value === undefined) throw new JcsError('JCS: top-level undefined');
  return serialize(value);
}

/** Canonical UTF-8 bytes per RFC 8785 — the hashing input. */
export function jcsBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(jcsCanonicalize(value));
}
