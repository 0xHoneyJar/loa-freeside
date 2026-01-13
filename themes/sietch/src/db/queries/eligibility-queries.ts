/**
 * Eligibility Snapshot Queries
 *
 * Handles eligibility snapshots and current eligibility state.
 * Extracted from queries.ts as part of Sprint 54 code organization refactor.
 *
 * @module db/queries/eligibility-queries
 */

import { getDatabase } from '../connection.js';
import { logger } from '../../utils/logger.js';
import type { EligibilityEntry, SerializedEligibilityEntry } from '../../types/index.js';

/**
 * Update current_eligibility table with latest entries
 */
function updateCurrentEligibility(entries: EligibilityEntry[]): void {
  const database = getDatabase();

  // Use a transaction for atomicity
  const transaction = database.transaction((eligibleEntries: EligibilityEntry[]) => {
    // Clear existing entries
    database.prepare('DELETE FROM current_eligibility').run();

    // Insert new entries
    const insertStmt = database.prepare(`
      INSERT INTO current_eligibility (address, rank, bgt_held, role, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    for (const entry of eligibleEntries) {
      if (entry.rank !== undefined && entry.rank <= 69) {
        insertStmt.run(
          entry.address.toLowerCase(),
          entry.rank,
          entry.bgtHeld.toString(),
          entry.role
        );
      }
    }
  });

  transaction(entries);
}

/**
 * Save a new eligibility snapshot
 */
export function saveEligibilitySnapshot(entries: EligibilityEntry[]): number {
  const database = getDatabase();

  // Serialize entries for JSON storage
  const serialized: SerializedEligibilityEntry[] = entries.map((entry) => ({
    address: entry.address.toLowerCase(),
    bgtClaimed: entry.bgtClaimed.toString(),
    bgtBurned: entry.bgtBurned.toString(),
    bgtHeld: entry.bgtHeld.toString(),
    rank: entry.rank,
    role: entry.role,
  }));

  const stmt = database.prepare(`
    INSERT INTO eligibility_snapshots (data)
    VALUES (?)
  `);

  const result = stmt.run(JSON.stringify(serialized));

  // Also update current_eligibility table
  updateCurrentEligibility(entries);

  logger.info({ snapshotId: result.lastInsertRowid, count: entries.length }, 'Saved eligibility snapshot');

  return result.lastInsertRowid as number;
}

/**
 * Get the latest eligibility snapshot
 */
export function getLatestEligibilitySnapshot(): EligibilityEntry[] {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT data FROM eligibility_snapshots
    ORDER BY created_at DESC
    LIMIT 1
  `).get() as { data: string } | undefined;

  if (!row) {
    return [];
  }

  const serialized = JSON.parse(row.data) as SerializedEligibilityEntry[];

  return serialized.map((entry) => ({
    address: entry.address as `0x${string}`,
    bgtClaimed: BigInt(entry.bgtClaimed),
    bgtBurned: BigInt(entry.bgtBurned),
    bgtHeld: BigInt(entry.bgtHeld),
    rank: entry.rank,
    role: entry.role,
  }));
}

/**
 * Get current eligibility for a specific address
 */
export function getEligibilityByAddress(address: string): EligibilityEntry | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT address, rank, bgt_held, role
    FROM current_eligibility
    WHERE address = ?
  `).get(address.toLowerCase()) as {
    address: string;
    rank: number;
    bgt_held: string;
    role: 'naib' | 'fedaykin' | 'none';
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    address: row.address as `0x${string}`,
    bgtClaimed: 0n, // Not stored in current_eligibility
    bgtBurned: 0n, // Not stored in current_eligibility
    bgtHeld: BigInt(row.bgt_held),
    rank: row.rank,
    role: row.role,
  };
}

/**
 * Get all current eligible entries (top 69)
 */
export function getCurrentEligibility(): EligibilityEntry[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT address, rank, bgt_held, role
    FROM current_eligibility
    ORDER BY rank ASC
  `).all() as Array<{
    address: string;
    rank: number;
    bgt_held: string;
    role: 'naib' | 'fedaykin' | 'none';
  }>;

  return rows.map((row) => ({
    address: row.address as `0x${string}`,
    bgtClaimed: 0n,
    bgtBurned: 0n,
    bgtHeld: BigInt(row.bgt_held),
    rank: row.rank,
    role: row.role,
  }));
}
