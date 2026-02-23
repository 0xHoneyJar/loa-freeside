/**
 * Credit Lot Service — Lot Debit Selection & Balance Queries
 *
 * Implements the double-entry append-only ledger operations:
 * - Lot debit selection (earliest-expiry-first, Flatline IMP-003)
 * - Multi-lot split debit (Flatline IMP-005: deterministic lock ordering)
 * - Idempotent credit lot minting
 * - Balance queries via lot_balances view
 *
 * All monetary values use BigInt micro-USD (1 USD = 1,000,000 micro).
 * No floating-point in the economic path.
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 * @see Sprint 0A, Task 0A.2 / Sprint 0B, Task 0B.2
 * @module packages/services/credit-lot-service
 */

import type { Pool, PoolClient } from 'pg';

/**
 * Lot balance row from lot_balances view
 */
export interface LotBalance {
  lot_id: string;
  community_id: string;
  source: string;
  original_micro: bigint;
  status: string;
  expires_at: Date | null;
  created_at: Date;
  credited_micro: bigint;
  debited_micro: bigint;
  remaining_micro: bigint;
}

/**
 * Result of a lot debit operation
 */
export interface DebitResult {
  entries: Array<{
    lot_id: string;
    entry_id: string;
    amount_micro: bigint;
  }>;
  total_debited: bigint;
}

/**
 * Credit lot minting parameters
 */
export interface MintParams {
  community_id: string;
  source: 'purchase' | 'grant' | 'seed' | 'x402' | 'transfer_in' | 'tba_deposit';
  amount_micro: bigint;
  payment_id?: string;
  expires_at?: Date;
}

/**
 * Select lots for debit using earliest-expiry-first policy.
 *
 * Implements Flatline IMP-003:
 *   ORDER BY COALESCE(expires_at, 'infinity') ASC, created_at ASC
 *
 * Implements Flatline IMP-005:
 *   SELECT ... FOR UPDATE on credit_lots in lot_id ASC order
 *   to prevent deadlocks with deterministic lock ordering.
 *
 * @param client - PostgreSQL client (within transaction)
 * @param communityId - Tenant community UUID
 * @param amountMicro - Total amount to debit (BigInt micro-USD)
 * @param reservationId - Budget reservation ID for idempotency
 * @returns DebitResult with entries and total debited
 */
export async function debitLots(
  client: PoolClient,
  communityId: string,
  amountMicro: bigint,
  reservationId: string,
  usageEventId?: string,
): Promise<DebitResult> {
  // Step 1: Select available lots (earliest-expiry-first)
  // FOR UPDATE locks rows in deterministic order (lot_id ASC) per IMP-005
  const lotsResult = await client.query<{
    lot_id: string;
    remaining_micro: string;
  }>(
    `SELECT lb.lot_id, lb.remaining_micro
     FROM lot_balances lb
     JOIN credit_lots cl ON cl.id = lb.lot_id
     WHERE lb.community_id = $1
       AND cl.status = 'active'
       AND lb.remaining_micro > 0
     ORDER BY COALESCE(cl.expires_at, 'infinity'::timestamptz) ASC,
              cl.created_at ASC
     FOR UPDATE OF cl`,
    [communityId]
  );

  if (lotsResult.rows.length === 0) {
    throw new Error('BUDGET_EXCEEDED: No available credit lots');
  }

  // Step 2: Split debit across lots
  let remaining = amountMicro;
  const entries: DebitResult['entries'] = [];

  for (const lot of lotsResult.rows) {
    if (remaining <= 0n) break;

    const lotRemaining = BigInt(lot.remaining_micro);
    const debitAmount = remaining < lotRemaining ? remaining : lotRemaining;

    // Insert debit entry (idempotent via UNIQUE(lot_id, reservation_id))
    const entryResult = await client.query<{ id: string }>(
      `INSERT INTO lot_entries (lot_id, community_id, entry_type, amount_micro, reservation_id, usage_event_id)
       VALUES ($1, $2, 'debit', $3, $4, $5)
       ON CONFLICT (lot_id, reservation_id)
         WHERE reservation_id IS NOT NULL AND entry_type = 'debit'
       DO NOTHING
       RETURNING id`,
      [lot.lot_id, communityId, debitAmount.toString(), reservationId, usageEventId]
    );

    if (entryResult.rows.length > 0) {
      entries.push({
        lot_id: lot.lot_id,
        entry_id: entryResult.rows[0].id,
        amount_micro: debitAmount,
      });

      // Mark lot as depleted if fully consumed
      if (debitAmount >= lotRemaining) {
        await client.query(
          `SELECT app.update_lot_status($1, 'depleted')`,
          [lot.lot_id]
        );
      }
    }

    remaining -= debitAmount;
  }

  if (remaining > 0n) {
    throw new Error(
      `BUDGET_EXCEEDED: Insufficient lot balance. Needed ${amountMicro}, ` +
      `debited ${amountMicro - remaining}, shortfall ${remaining}`
    );
  }

  return {
    entries,
    total_debited: amountMicro - remaining,
  };
}

/**
 * Mint a new credit lot (idempotent via payment_id).
 *
 * Creates the credit_lots header row and an initial 'credit' lot_entries row.
 * If payment_id is provided, ON CONFLICT (payment_id) DO NOTHING prevents
 * duplicate minting from retried webhooks.
 *
 * @param client - PostgreSQL client (within transaction)
 * @param params - Minting parameters
 * @returns The lot ID (or null if duplicate)
 */
export async function mintCreditLot(
  client: PoolClient,
  params: MintParams,
): Promise<string | null> {
  // Step 1: Insert credit lot header (idempotent via payment_id)
  const lotResult = await client.query<{ id: string }>(
    `INSERT INTO credit_lots (community_id, source, payment_id, amount_micro, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      params.community_id,
      params.source,
      params.payment_id || null,
      params.amount_micro.toString(),
      params.expires_at || null,
    ]
  );

  if (lotResult.rows.length === 0) {
    // Duplicate — already minted for this payment_id
    return null;
  }

  const lotId = lotResult.rows[0].id;

  // Step 2: Insert initial credit entry
  await client.query(
    `INSERT INTO lot_entries (lot_id, community_id, entry_type, amount_micro, reference_id)
     VALUES ($1, $2, 'credit', $3, $4)`,
    [lotId, params.community_id, params.amount_micro.toString(), params.payment_id || lotId]
  );

  return lotId;
}

/**
 * Get lot balances for a community.
 *
 * @param client - PostgreSQL client
 * @param communityId - Tenant community UUID
 * @returns Array of lot balances
 */
export async function getLotBalances(
  client: PoolClient | Pool,
  communityId: string,
): Promise<LotBalance[]> {
  const result = await client.query<LotBalance>(
    `SELECT * FROM lot_balances
     WHERE community_id = $1
     ORDER BY COALESCE(expires_at, 'infinity'::timestamptz) ASC, created_at ASC`,
    [communityId]
  );
  return result.rows;
}

/**
 * Get total available balance for a community.
 *
 * @param client - PostgreSQL client
 * @param communityId - Tenant community UUID
 * @returns Total remaining micro-USD across all active lots
 */
export async function getTotalBalance(
  client: PoolClient | Pool,
  communityId: string,
): Promise<bigint> {
  const result = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(remaining_micro), 0) AS total
     FROM lot_balances
     WHERE community_id = $1 AND status = 'active'`,
    [communityId]
  );
  return BigInt(result.rows[0].total);
}
