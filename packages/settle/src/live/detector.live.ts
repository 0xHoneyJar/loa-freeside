/**
 * TrailDetector — the post-hoc safety net. (T2.3, FR-6)
 *
 * Windowed scan of the decision trail; flags any record that PROCEEDED while its
 * `earned` tier was below `required` — a claimed-as-settled slip that the
 * synchronous gate should have abstained on. Such a record only exists if the
 * gate was bypassed or broken, so the detector is the second eye. It SURFACES a
 * `STATUS|SIGNAL|MISMATCH` tile (estate-coherence-compatible) and NEVER gates.
 */

import type { Detector, MismatchTile, MismatchRecord } from "../ports/detector.port.js";
import type { TrailEntry } from "../ports/trail.port.js";
import { tierGte } from "../domain/tier.js";

export class TrailDetector implements Detector {
  scan(entries: readonly TrailEntry[], fromCursor: number): MismatchTile {
    const start = fromCursor > 0 ? fromCursor : 0;
    const mismatches: MismatchRecord[] = [];
    for (let i = start; i < entries.length; i++) {
      const e = entries[i];
      if (e === undefined) continue;
      // proceeded AND earned < required → a slip a correct gate never writes.
      if (e.proceed && !tierGte(e.earned, e.required)) {
        mismatches.push({
          claim_id: e.claim_id,
          domain: e.domain,
          required: e.required,
          earned: e.earned,
          at: e.at,
        });
      }
    }
    const status = mismatches.length > 0 ? "MISMATCH" : "ok";
    const tile = `STATUS=${status}|SIGNAL=settle-drift|MISMATCH=${mismatches.length}`;
    return { status, tile, mismatches, cursor: entries.length };
  }
}
