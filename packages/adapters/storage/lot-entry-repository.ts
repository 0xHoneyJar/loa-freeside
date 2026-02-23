/**
 * Lot Entry Repository — Canonical Insert Path for lot_entries
 *
 * ALL lot_entries writes MUST go through this repository.
 * Direct INSERT is revoked from arrakis_app (migration 0012).
 * The repository calls app.insert_lot_entry_fn() which runs as
 * SECURITY DEFINER (table owner) to bypass the REVOKE.
 *
 * Idempotent mode (debit/expiry):
 *   Uses ON CONFLICT DO NOTHING with partial unique indexes.
 *   Returns { id: null, inserted: false } when entry already exists.
 *
 * Standard mode (credit, credit_back, governance_*):
 *   Plain INSERT, always returns the new entry ID.
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 * @see Sprint 1, Task 1.2 (AC-1.2.8)
 * @module packages/adapters/storage/lot-entry-repository
 */

import type { PoolClient } from 'pg';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Valid lot_entries entry types */
export type LotEntryType =
  | 'credit'
  | 'debit'
  | 'expiry'
  | 'credit_back'
  | 'governance_debit'
  | 'governance_credit';

/** Parameters for inserting a lot entry */
export interface InsertLotEntryParams {
  /** Lot ID (required for non-governance types) */
  lotId: string | null;
  /** Tenant community UUID */
  communityId: string;
  /** Entry type */
  entryType: LotEntryType;
  /** Amount in micro-USD (must be positive) */
  amountMicro: bigint;
  /** Budget reservation ID (used for idempotency on debit/expiry) */
  reservationId?: string;
  /** Usage event reference */
  usageEventId?: string;
  /** External reference ID */
  referenceId?: string;
  /** Correlation UUID (defaults to gen_random_uuid() in DB) */
  correlationId?: string;
  /** Economic purpose classification (Sprint 2 F-1, null when feature disabled) */
  purpose?: string;
  /** Monotonic sequence number (Sprint 4 F-3, null when feature disabled) */
  sequenceNumber?: bigint;
  /** Causation UUID (Sprint 4 F-3, null when feature disabled) */
  causationId?: string;
  /** Use ON CONFLICT DO NOTHING for debit/expiry (requires reservationId) */
  idempotent?: boolean;
}

/** Result of a lot entry insert */
export interface InsertLotEntryResult {
  /** Entry UUID (null if idempotent conflict — entry already existed) */
  id: string | null;
  /** Whether a new row was inserted */
  inserted: boolean;
}

// --------------------------------------------------------------------------
// Repository Function
// --------------------------------------------------------------------------

/**
 * Insert a lot entry via the SECURITY DEFINER function.
 *
 * This is the ONLY way to insert into lot_entries after migration 0012
 * revokes INSERT from arrakis_app.
 *
 * AC-1.2.8: All inserts go through insert_lot_entry_fn()
 *
 * @param client - PostgreSQL client (must be within a transaction with community scope set)
 * @param params - Entry parameters
 * @returns Insert result with entry ID and inserted flag
 */
export async function insertLotEntry(
  client: PoolClient,
  params: InsertLotEntryParams,
): Promise<InsertLotEntryResult> {
  const result = await client.query<{ id: string | null }>(
    `SELECT app.insert_lot_entry_fn($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) AS id`,
    [
      params.lotId,
      params.communityId,
      params.entryType,
      params.amountMicro.toString(),
      params.reservationId ?? null,
      params.usageEventId ?? null,
      params.referenceId ?? null,
      params.correlationId ?? null,
      params.purpose ?? null,
      params.sequenceNumber?.toString() ?? null,
      params.causationId ?? null,
      params.idempotent ?? false,
    ],
  );

  const id = result.rows[0]?.id ?? null;
  return {
    id,
    inserted: id !== null,
  };
}
