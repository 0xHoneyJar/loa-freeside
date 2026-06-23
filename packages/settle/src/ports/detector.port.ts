/**
 * Detector port — the post-hoc safety net. (T2.3, FR-6)
 *
 * Scans the append-only trail, independently recomputes whether each proceeded
 * decision was earned, and flags records where `earned < required` yet the action
 * proceeded (a claimed-as-settled slip — evidence of a bypassed or broken gate).
 * Emits a `STATUS|SIGNAL|MISMATCH` tile byte-compatible with estate-coherence.
 * Cursor/windowed (no full rescan). It SURFACES — it never gates.
 */

import type { TrailEntry } from "./trail.port.js";
import type { Tier } from "../domain/tier.js";

export interface MismatchRecord {
  readonly claim_id: string;
  readonly domain: string;
  readonly required: Tier;
  readonly earned: Tier;
  readonly at: number;
}

export interface MismatchTile {
  readonly status: "ok" | "MISMATCH";
  /** Pipe-delimited tile, e.g. `STATUS=MISMATCH|SIGNAL=settle-drift|MISMATCH=2`. */
  readonly tile: string;
  readonly mismatches: MismatchRecord[];
  /** Scan position after this pass (feed back as `fromCursor` next time). */
  readonly cursor: number;
}

export interface Detector {
  scan(entries: readonly TrailEntry[], fromCursor: number): MismatchTile;
}
