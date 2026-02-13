/**
 * Semver-Lite — Minimal semver range checking
 * Cycle 019 Sprint 2, Task 2.2: Compatibility matrix dependency
 *
 * Supports only the subset of semver ranges used in the compatibility matrix:
 *   - Exact: "1.2.3"
 *   - >=: ">=1.0.0"
 *   - Combined: ">=1.0.0 <2.0.0"
 *
 * NOT a full semver implementation. Use `semver` package if ranges grow complex.
 *
 * @see Bridgebuilder Round 6, Finding #2 — Contract Protocol Nucleus
 */

/** Parse a semver string into [major, minor, patch] */
function parse(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return parts as [number, number, number];
}

/** Compare two parsed semver tuples: -1 (a<b), 0 (a==b), 1 (a>b) */
function compare(a: [number, number, number], b: [number, number, number]): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

/**
 * Check if a version satisfies a semver range.
 *
 * Supported range formats:
 *   - "1.2.3" → exact match
 *   - ">=1.0.0" → greater than or equal
 *   - "<2.0.0" → less than
 *   - ">=1.0.0 <2.0.0" → combined (space-separated, all must match)
 */
export function satisfies(version: string, range: string): boolean {
  const ver = parse(version);
  const conditions = range.split(/\s+/);

  return conditions.every((cond) => {
    if (cond.startsWith('>=')) {
      return compare(ver, parse(cond.slice(2))) >= 0;
    }
    if (cond.startsWith('<=')) {
      return compare(ver, parse(cond.slice(2))) <= 0;
    }
    if (cond.startsWith('>')) {
      return compare(ver, parse(cond.slice(1))) > 0;
    }
    if (cond.startsWith('<')) {
      return compare(ver, parse(cond.slice(1))) < 0;
    }
    // Exact match
    return compare(ver, parse(cond)) === 0;
  });
}
