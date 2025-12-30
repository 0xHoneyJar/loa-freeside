// =============================================================================
// Maintenance Queries
// =============================================================================

import { getDatabase } from '../connection.js';
import { CLEANUP_OLD_SNAPSHOTS_SQL } from '../schema.js';
import { logger } from '../../utils/logger.js';

/**
 * Clean up old snapshots (keep last 30 days)
 */
export function cleanupOldSnapshots(): number {
  const database = getDatabase();

  const result = database.prepare(CLEANUP_OLD_SNAPSHOTS_SQL.trim()).run();

  if (result.changes > 0) {
    logger.info({ deleted: result.changes }, 'Cleaned up old eligibility snapshots');
  }

  return result.changes;
}

// =============================================================================
// Event Cache Queries
// =============================================================================

/**
 * Cached claim event for storage
 */
export interface CachedClaimEvent {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  address: string;
  amount: bigint;
  vaultAddress: string;
}

/**
 * Cached burn event for storage
 */
export interface CachedBurnEvent {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  fromAddress: string;
  amount: bigint;
}

/**
 * Get the last synced block number
 */
export function getLastSyncedBlock(): bigint | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT last_synced_block FROM health_status WHERE id = 1
  `).get() as { last_synced_block: string | null };

  return row.last_synced_block ? BigInt(row.last_synced_block) : null;
}

/**
 * Update the last synced block number
 */
export function updateLastSyncedBlock(blockNumber: bigint): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET last_synced_block = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(blockNumber.toString());
}

/**
 * Save cached claim events (batch insert)
 */
export function saveCachedClaimEvents(events: CachedClaimEvent[]): number {
  if (events.length === 0) return 0;

  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO cached_claim_events
    (tx_hash, log_index, block_number, address, amount, vault_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((evts: CachedClaimEvent[]) => {
    let inserted = 0;
    for (const evt of evts) {
      const result = stmt.run(
        evt.txHash,
        evt.logIndex,
        evt.blockNumber.toString(),
        evt.address.toLowerCase(),
        evt.amount.toString(),
        evt.vaultAddress.toLowerCase()
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const count = insertMany(events);
  if (count > 0) {
    logger.debug({ count }, 'Cached new claim events');
  }
  return count;
}

/**
 * Save cached burn events (batch insert)
 */
export function saveCachedBurnEvents(events: CachedBurnEvent[]): number {
  if (events.length === 0) return 0;

  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO cached_burn_events
    (tx_hash, log_index, block_number, from_address, amount)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((evts: CachedBurnEvent[]) => {
    let inserted = 0;
    for (const evt of evts) {
      const result = stmt.run(
        evt.txHash,
        evt.logIndex,
        evt.blockNumber.toString(),
        evt.fromAddress.toLowerCase(),
        evt.amount.toString()
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const count = insertMany(events);
  if (count > 0) {
    logger.debug({ count }, 'Cached new burn events');
  }
  return count;
}

/**
 * Get all cached claim events
 */
export function getCachedClaimEvents(): CachedClaimEvent[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tx_hash, log_index, block_number, address, amount, vault_address
    FROM cached_claim_events
  `).all() as Array<{
    tx_hash: string;
    log_index: number;
    block_number: string;
    address: string;
    amount: string;
    vault_address: string;
  }>;

  return rows.map((row) => ({
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: BigInt(row.block_number),
    address: row.address,
    amount: BigInt(row.amount),
    vaultAddress: row.vault_address,
  }));
}

/**
 * Get all cached burn events
 */
export function getCachedBurnEvents(): CachedBurnEvent[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tx_hash, log_index, block_number, from_address, amount
    FROM cached_burn_events
  `).all() as Array<{
    tx_hash: string;
    log_index: number;
    block_number: string;
    from_address: string;
    amount: string;
  }>;

  return rows.map((row) => ({
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: BigInt(row.block_number),
    fromAddress: row.from_address,
    amount: BigInt(row.amount),
  }));
}

/**
 * Clear all cached events (for full resync)
 */
export function clearEventCache(): void {
  const database = getDatabase();

  database.transaction(() => {
    database.prepare('DELETE FROM cached_claim_events').run();
    database.prepare('DELETE FROM cached_burn_events').run();
    database.prepare(`
      UPDATE health_status SET last_synced_block = NULL WHERE id = 1
    `).run();
  })();

  logger.info('Cleared event cache for full resync');
}
