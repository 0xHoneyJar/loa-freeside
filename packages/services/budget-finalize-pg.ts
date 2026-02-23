/**
 * Budget Finalize (Postgres-First) — Lot-Aware Finalization
 *
 * Implements the Postgres-first finalize flow from SDD §4.2:
 *   BEGIN
 *     → Acquire fence token
 *     → Verify fence in Postgres
 *     → INSERT usage_events
 *     → SELECT lots (earliest-expiry-first) FOR UPDATE
 *     → INSERT lot_entries (debit)
 *     → Mark depleted lots
 *   COMMIT
 *   → Redis Lua adjust (committed counter)
 *
 * This service wraps the existing BudgetManager.finalize() with a
 * Postgres transaction that records the usage event and debits lots
 * BEFORE adjusting the Redis committed counter.
 *
 * If Postgres commits but Redis fails, the reconciliation sweep
 * (conservation-guard.ts) will catch the drift on next run.
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 * @see SDD §4.3 Budget Finalization Flow
 * @see Sprint 0B, Task 0B.2
 * @module packages/services/budget-finalize-pg
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { debitLots } from './credit-lot-service.js';
import { verifyAndAdvanceFence, acquireFenceToken } from './conservation-guard.js';
import { resolvePurpose } from './purpose-service.js';
import { emitPurposeSpend } from '../adapters/telemetry/economic-metrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Parameters for Postgres-first finalization */
export interface PgFinalizeParams {
  communityId: string;
  userId: string;
  nftId: string;
  poolId: string;
  idempotencyKey: string;
  reservationId: string;
  tokensInput: number;
  tokensOutput: number;
  amountMicro: bigint;
  traceId?: string;
}

/** Result of Postgres-first finalization */
export interface PgFinalizeResult {
  status: 'FINALIZED' | 'STALE_FENCE' | 'BUDGET_EXCEEDED' | 'DUPLICATE';
  eventId: string | null;
  fenceToken: bigint;
  lotEntries: Array<{
    lot_id: string;
    entry_id: string;
    amount_micro: bigint;
  }>;
}

// --------------------------------------------------------------------------
// Postgres-First Finalize
// --------------------------------------------------------------------------

/**
 * Execute Postgres-first finalization with lot debit.
 *
 * This is the "write path" — the authoritative record of economic activity.
 * Redis is updated after Postgres commits (eventually consistent).
 *
 * Flow:
 *   1. Acquire monotonic fence token from Redis
 *   2. BEGIN transaction
 *   3. Verify fence token in Postgres (stale → ROLLBACK)
 *   4. INSERT usage_event (idempotent via finalization_id)
 *   5. Debit lots (earliest-expiry-first, FOR UPDATE with lock ordering)
 *   6. COMMIT
 *   7. Return result (caller updates Redis committed counter)
 *
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client (for fence token)
 * @param params - Finalization parameters
 * @returns Finalization result
 */
export async function finalizePg(
  pool: Pool,
  redis: Redis,
  params: PgFinalizeParams,
): Promise<PgFinalizeResult> {
  // Step 1: Acquire fence token
  const fenceToken = await acquireFenceToken(redis, params.communityId);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 2: Set tenant context for RLS (standardized SET LOCAL per Sprint 1, Task 1.1)
    await client.query('SET LOCAL app.community_id = $1', [params.communityId]);

    // Step 3: Verify fence token (stale → ROLLBACK)
    const fenceValid = await verifyAndAdvanceFence(
      client,
      params.communityId,
      fenceToken,
    );

    if (!fenceValid) {
      await client.query('ROLLBACK');
      return {
        status: 'STALE_FENCE',
        eventId: null,
        fenceToken,
        lotEntries: [],
      };
    }

    // Step 4: INSERT usage_event (idempotent via finalization_id UNIQUE)
    const eventResult = await client.query<{ event_id: string }>(
      `INSERT INTO usage_events (
         community_id, nft_id, pool_id,
         tokens_input, tokens_output, amount_micro,
         reservation_id, finalization_id, fence_token,
         conservation_guard_result
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       ON CONFLICT (finalization_id) DO NOTHING
       RETURNING event_id`,
      [
        params.communityId,
        params.nftId,
        params.poolId,
        params.tokensInput,
        params.tokensOutput,
        params.amountMicro.toString(),
        params.reservationId,
        params.idempotencyKey,
        fenceToken.toString(),
      ]
    );

    if (eventResult.rows.length === 0) {
      // Already finalized — idempotent duplicate
      await client.query('ROLLBACK');
      return {
        status: 'DUPLICATE',
        eventId: null,
        fenceToken,
        lotEntries: [],
      };
    }

    const eventId = eventResult.rows[0].event_id;

    // Step 5: Resolve economic purpose from pool (AC-2.3.1)
    const purpose = resolvePurpose(params.poolId);

    // Step 6: Debit lots (earliest-expiry-first)
    const debitResult = await debitLots(
      client,
      params.communityId,
      params.amountMicro,
      params.reservationId,
      eventId,
      purpose,
    );

    // Step 7: COMMIT
    await client.query('COMMIT');

    // Step 8: Emit purpose spend metric (AC-2.5.1, after commit — fire-and-forget)
    try {
      emitPurposeSpend(params.communityId, purpose, params.amountMicro);
    } catch {
      // Metric emission must never fail the finalize result
    }

    return {
      status: 'FINALIZED',
      eventId,
      fenceToken,
      lotEntries: debitResult.entries,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
