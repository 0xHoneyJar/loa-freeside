/**
 * GlobClassifier — domain → posture, fail-closed by default. (T1.3)
 *
 * - Glob path-classifier (run-mode-ice shape): segment matching with string ops
 *   only, NO regex, NO LLM.
 * - The determinism-map's JCS sha is pinned as a CONSTANT here (SKP-003): the
 *   classifier refuses to construct if the bundled map's hash != PINNED_MAP_SHA.
 *   Tampering with the map (e.g. demoting `money/**` to FREE) is caught at init.
 * - Unknown / unmatched domain → FAIL_CLOSED (SKP-006): absence of a rule is not
 *   permission.
 */

import rawMap from "../config/determinism-map.json" with { type: "json" };
import type { Classifier } from "../ports/classifier.port.js";
import type { PostureLevel } from "../domain/posture.js";
import { sha256Hex, jcsCanonicalize } from "../lib/jcs.js";

/** JCS-sha256 of `config/determinism-map.json`. Regenerate when the map changes:
 *  node -e '...' (see scripts) — and a mismatch must be a DELIBERATE, reviewed bump. */
export const PINNED_MAP_SHA =
  "a13591a358d4bfd31ae7cae73b2f1fee666242a01e6c5c9464975cfe71116266";

interface DeterminismRule {
  readonly glob: string;
  readonly posture: PostureLevel;
}
interface DeterminismMap {
  readonly version: number;
  readonly description?: string;
  readonly rules: readonly DeterminismRule[];
}

/** Match one pattern segment against one path segment. Supports `*` (whole-segment
 *  wildcard) and embedded `*` (prefix/suffix/infix), with plain string ops. */
function segMatch(seg: string, val: string): boolean {
  if (seg === "*") return true;
  if (!seg.includes("*")) return seg === val;
  const parts = seg.split("*");
  const prefix = parts[0] ?? "";
  if (prefix && !val.startsWith(prefix)) return false;
  let idx = prefix.length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part === "") continue; // a trailing/leading `*`
    const found = val.indexOf(part, idx);
    if (found === -1) return false;
    idx = found + part.length;
  }
  const last = parts[parts.length - 1] ?? "";
  if (last && !val.endsWith(last)) return false;
  return true;
}

/** Match a glob pattern (segments split on `/`) against a path. `**` matches zero
 *  or more whole segments. */
function globMatch(pattern: string, path: string): boolean {
  const p = pattern.split("/");
  const s = path.split("/");
  const walk = (pi: number, si: number): boolean => {
    let pIdx = pi;
    let sIdx = si;
    while (pIdx < p.length) {
      const seg = p[pIdx];
      if (seg === undefined) return false;
      if (seg === "**") {
        if (pIdx === p.length - 1) return true; // trailing ** matches the rest
        for (let k = sIdx; k <= s.length; k++) {
          if (walk(pIdx + 1, k)) return true;
        }
        return false;
      }
      const val = s[sIdx];
      if (val === undefined) return false;
      if (!segMatch(seg, val)) return false;
      pIdx++;
      sIdx++;
    }
    return sIdx === s.length;
  };
  return walk(0, 0);
}

export class GlobClassifier implements Classifier {
  private readonly rules: readonly DeterminismRule[];

  /**
   * @param mapOverride  test-only seam: supply a tampered map to prove the sha
   *                     guard fires. Defaults to the bundled, pinned map.
   * @param expectedSha  test-only seam: defaults to PINNED_MAP_SHA.
   */
  constructor(mapOverride?: unknown, expectedSha: string = PINNED_MAP_SHA) {
    const map = (mapOverride ?? rawMap) as DeterminismMap;
    const actualSha = sha256Hex(jcsCanonicalize(map));
    if (actualSha !== expectedSha) {
      throw new Error(
        `GlobClassifier: determinism-map sha mismatch — refusing to start (SKP-003). ` +
          `expected ${expectedSha}, got ${actualSha}. A change to the map must be a deliberate, reviewed sha bump.`,
      );
    }
    this.rules = map.rules;
  }

  classify(domain: string): PostureLevel {
    for (const rule of this.rules) {
      if (globMatch(rule.glob, domain)) return rule.posture;
    }
    return "FAIL_CLOSED"; // SKP-006: unmatched domain is never FREE
  }
}
