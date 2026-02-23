/**
 * Credit Lot Expiry Sweep — Scheduled Lot Lifecycle Management
 *
 * Runs every 5 minutes via EventBridge → ECS task. Finds expired lots
 * without expiry entries, creates lot_entries with entry_type='expiry',
 * and adjusts Redis budget limits downward.
 *
 * Flow:
 *   1. SELECT expired lots WHERE status='active' AND expires_at < NOW()
 *   2. For each lot without an expiry entry:
 *      a. INSERT lot_entries (entry_type='expiry', amount_micro=remaining)
 *      b. UPDATE lot status → 'expired' via app.update_lot_status()
 *      c. Redis DECRBY budget limit (idempotent via lot_id key)
 *   3. Emit lot_expiry_count metric
 *
 * Idempotency:
 *   - lot_entries INSERT uses ON CONFLICT (lot_id, reservation_id) for entry_type='expiry'
 *   - Redis adjustment keyed by processed:expiry:{lot_id} with 24h TTL
 *   - Running sweep twice produces identical state
 *
 * @see SDD §4.2 Lot Lifecycle
 * @see Sprint 0B, Task 0B.5
 * @module packages/services/lot-expiry-sweep
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { withCommunityScope } from './community-scope.js';
import { insertLotEntry } from '../adapters/storage/lot-entry-repository.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Result of an expiry sweep */
export interface ExpirySweepResult {
  /** Number of lots processed */
  lotsProcessed: number;
  /** Number of lots that were actually expired (new expiry entries created) */
  lotsExpired: number;
  /** Number already expired (idempotent skip) */
  lotsAlreadyExpired: number;
  /** Total micro-USD expired across all lots */
  totalExpiredMicro: bigint;
  /** Errors encountered (non-fatal, per-lot) */
  errors: Array<{ lotId: string; error: string }>;
}

/** Expired lot row from database */
interface ExpiredLotRow {
  lot_id: string;
  community_id: string;
  remaining_micro: string;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Batch size for expired lot queries */
const SWEEP_BATCH_SIZE = 100;

// --------------------------------------------------------------------------
// Expiry Sweep
// --------------------------------------------------------------------------

/**
 * Execute the lot expiry sweep.
 *
 * Finds all active lots past their expiry date and creates expiry entries.
 * Each lot is processed in its own transaction for fault isolation.
 *
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client (for budget limit adjustment)
 * @returns Sweep result
 */
export async function runExpirySweep(
  pool: Pool,
  redis: Redis,
): Promise<ExpirySweepResult> {
  const result: ExpirySweepResult = {
    lotsProcessed: 0,
    lotsExpired: 0,
    lotsAlreadyExpired: 0,
    totalExpiredMicro: 0n,
    errors: [],
  };

  // Step 1: Find expired lots with remaining balance
  // Using lot_balances view for accurate remaining calculation
  const expiredLots = await pool.query<ExpiredLotRow>(
    `SELECT lb.lot_id, lb.community_id, lb.remaining_micro
     FROM lot_balances lb
     JOIN credit_lots cl ON cl.id = lb.lot_id
     WHERE cl.status = 'active'
       AND cl.expires_at IS NOT NULL
       AND cl.expires_at < NOW()
       AND lb.remaining_micro > 0
     ORDER BY cl.expires_at ASC
     LIMIT $1`,
    [SWEEP_BATCH_SIZE],
  );

  // Step 2: Process each expired lot
  for (const lot of expiredLots.rows) {
    result.lotsProcessed++;

    try {
      const expired = await expireSingleLot(pool, redis, lot);
      if (expired) {
        result.lotsExpired++;
        result.totalExpiredMicro += BigInt(lot.remaining_micro);
      } else {
        result.lotsAlreadyExpired++;
      }
    } catch (error) {
      result.errors.push({
        lotId: lot.lot_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Expire a single lot in its own transaction.
 *
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client
 * @param lot - The expired lot row
 * @returns true if a new expiry entry was created, false if already expired
 */
async function expireSingleLot(
  pool: Pool,
  redis: Redis,
  lot: ExpiredLotRow,
): Promise<boolean> {
  // Use withCommunityScope for standardized BEGIN/SET LOCAL/COMMIT (Sprint 1, Task 1.1)
  const inserted = await withCommunityScope(lot.community_id, pool, async (client) => {
    // Insert expiry entry via SECURITY DEFINER function (idempotent)
    const expiryReservationId = `expiry:${lot.lot_id}`;
    const entryResult = await insertLotEntry(client, {
      lotId: lot.lot_id,
      communityId: lot.community_id,
      entryType: 'expiry',
      amountMicro: BigInt(lot.remaining_micro),
      reservationId: expiryReservationId,
      referenceId: lot.lot_id,
      idempotent: true,
    });

    if (!entryResult.inserted) {
      // Already expired — idempotent skip. Transaction will commit cleanly.
      return false;
    }

    // Update lot status to 'expired'
    await client.query(
      `SELECT app.update_lot_status($1, 'expired')`,
      [lot.lot_id],
    );

    return true;
  });

  if (inserted) {
    // Adjust Redis budget limit (idempotent via processed key)
    await adjustRedisBudgetLimit(redis, lot);
  }

  return inserted;
}

/**
 * Adjust Redis budget limit downward for an expired lot.
 *
 * Idempotent: uses processed:expiry:{lot_id} key to prevent double-adjustment.
 *
 * @param redis - Redis client
 * @param lot - The expired lot row
 */
async function adjustRedisBudgetLimit(
  redis: Redis,
  lot: ExpiredLotRow,
): Promise<void> {
  const processedKey = `processed:expiry:${lot.lot_id}`;
  const alreadyProcessed = await redis.exists(processedKey);

  if (alreadyProcessed) {
    return; // Already adjusted — idempotent
  }

  // Convert micro-USD to cents (1 cent = 10,000 micro-USD)
  const remainingCents = BigInt(lot.remaining_micro) / 10000n;

  if (remainingCents > 0n) {
    const limitKey = `agent:budget:limit:${lot.community_id}`;
    await redis.decrby(limitKey, Number(remainingCents));
  }

  // Mark as processed (24h TTL — much longer than sweep interval)
  await redis.set(processedKey, '1', 'EX', 86400);
}

// --------------------------------------------------------------------------
// Exports for configuration
// --------------------------------------------------------------------------

export const EXPIRY_SWEEP_CONFIG = {
  SWEEP_BATCH_SIZE,
} as const;
