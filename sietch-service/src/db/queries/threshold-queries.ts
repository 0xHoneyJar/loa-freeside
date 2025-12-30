// =============================================================================
// Threshold Snapshot Queries (Sprint 12: Cave Entrance)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { ThresholdSnapshot } from '../../types/index.js';

/**
 * Database row type for threshold_snapshots
 */
interface ThresholdSnapshotRow {
  id: number;
  entry_threshold_bgt: string;
  eligible_count: number;
  waitlist_count: number;
  waitlist_top_bgt: string | null;
  waitlist_bottom_bgt: string | null;
  gap_to_entry: string | null;
  snapshot_at: string;
}

/**
 * Convert database row to ThresholdSnapshot type
 */
function rowToThresholdSnapshot(row: ThresholdSnapshotRow): ThresholdSnapshot {
  return {
    id: row.id,
    entryThresholdBgt: row.entry_threshold_bgt,
    eligibleCount: row.eligible_count,
    waitlistCount: row.waitlist_count,
    waitlistTopBgt: row.waitlist_top_bgt,
    waitlistBottomBgt: row.waitlist_bottom_bgt,
    gapToEntry: row.gap_to_entry,
    snapshotAt: new Date(row.snapshot_at),
  };
}

/**
 * Insert a new threshold snapshot
 */
export function insertThresholdSnapshot(data: {
  entryThresholdBgt: string;
  eligibleCount: number;
  waitlistCount: number;
  waitlistTopBgt: string | null;
  waitlistBottomBgt: string | null;
  gapToEntry: string | null;
}): ThresholdSnapshot {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO threshold_snapshots (
      entry_threshold_bgt,
      eligible_count,
      waitlist_count,
      waitlist_top_bgt,
      waitlist_bottom_bgt,
      gap_to_entry
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.entryThresholdBgt,
    data.eligibleCount,
    data.waitlistCount,
    data.waitlistTopBgt,
    data.waitlistBottomBgt,
    data.gapToEntry
  );

  const row = database.prepare(`
    SELECT * FROM threshold_snapshots WHERE id = ?
  `).get(result.lastInsertRowid) as ThresholdSnapshotRow;

  return rowToThresholdSnapshot(row);
}

/**
 * Get the most recent threshold snapshot
 */
export function getLatestThresholdSnapshot(): ThresholdSnapshot | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM threshold_snapshots
    ORDER BY snapshot_at DESC
    LIMIT 1
  `).get() as ThresholdSnapshotRow | undefined;

  return row ? rowToThresholdSnapshot(row) : null;
}

/**
 * Get threshold snapshots with pagination
 */
export function getThresholdSnapshots(options: {
  limit?: number;
  since?: Date;
} = {}): ThresholdSnapshot[] {
  const database = getDatabase();

  const limit = options.limit ?? 24; // Default to 24 hours of snapshots (hourly)

  if (options.since) {
    const rows = database.prepare(`
      SELECT * FROM threshold_snapshots
      WHERE snapshot_at >= ?
      ORDER BY snapshot_at DESC
      LIMIT ?
    `).all(options.since.toISOString(), limit) as ThresholdSnapshotRow[];

    return rows.map(rowToThresholdSnapshot);
  }

  const rows = database.prepare(`
    SELECT * FROM threshold_snapshots
    ORDER BY snapshot_at DESC
    LIMIT ?
  `).all(limit) as ThresholdSnapshotRow[];

  return rows.map(rowToThresholdSnapshot);
}

/**
 * Get positions 70-100 from current_eligibility for waitlist display
 * Returns wallets ranked 70-100 with their BGT holdings
 */
export function getWaitlistPositions(): Array<{
  address: string;
  position: number;
  bgt: string;
}> {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT address, rank as position, bgt_held as bgt
    FROM current_eligibility
    WHERE rank >= 70 AND rank <= 100
    ORDER BY rank ASC
  `).all() as Array<{ address: string; position: number; bgt: string }>;

  return rows;
}

/**
 * Get position 69's BGT (entry threshold)
 */
export function getEntryThresholdBgt(): string | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT bgt_held FROM current_eligibility
    WHERE rank = 69
    LIMIT 1
  `).get() as { bgt_held: string } | undefined;

  return row?.bgt_held ?? null;
}

/**
 * Get a wallet's current position and BGT from eligibility
 */
export function getWalletPosition(walletAddress: string): {
  position: number;
  bgt: string;
} | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT rank as position, bgt_held as bgt
    FROM current_eligibility
    WHERE address = ?
  `).get(walletAddress.toLowerCase()) as { position: number; bgt: string } | undefined;

  return row ?? null;
}
