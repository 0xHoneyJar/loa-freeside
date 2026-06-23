/**
 * TrailWriter port — the append-only decision trail. (T1.2 / T1.5)
 *
 * Every gate decision is appended here. The port is the seam that resolves the
 * SKP-001 (single-writer SQLite-WAL) vs SKP-004 (O_APPEND|O_WRONLY) tension: the
 * gate depends on this interface, never on a file or a database. The shipped
 * `AppendOnlyFileTrail` satisfies SKP-004 for the single-writer MVP; a
 * `SqliteWalTrail` drops in for contended/cross-FS deployments without touching
 * the gate. See THREAT-MODEL.md §6.
 */

import type { Tier } from "../domain/tier.js";

export type TrailLevel = "INFO" | "WARN";

export interface TrailEntry {
  /** Logical timestamp (integer, injected — no Date.now in the gate's pure path). */
  readonly at: number;
  readonly domain: string;
  readonly claim_id: string;
  readonly posture: string;
  readonly required: Tier;
  readonly earned: Tier;
  readonly proceed: boolean;
  readonly reason: string;
  readonly level: TrailLevel;
}

export interface TrailWriter {
  /** Append one decision. MUST be atomic per entry (no torn rows across writers). */
  append(entry: TrailEntry): void;
  /** Read all entries in append order (for the detector and tests). */
  readAll(): TrailEntry[];
}
