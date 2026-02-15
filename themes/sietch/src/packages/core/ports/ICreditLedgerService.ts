/**
 * ICreditLedgerService - Credit Ledger Service Port
 *
 * Single source of truth for all monetary state. Manages credit accounts,
 * lots, balances, and the append-only ledger.
 *
 * SDD refs: §1.4 CreditLedgerService, §1.5.1 FIFO Algorithm, §1.5.2 Reservation State Machine
 * Sprint refs: Task 1.4
 *
 * @module packages/core/ports/ICreditLedgerService
 */

import type {
  CreditBalance,
  EntityType as ProtocolEntityType,
  SourceType as ProtocolSourceType,
  EntryType as ProtocolEntryType,
  BillingMode as ProtocolBillingMode,
} from '../protocol/index.js';

// Re-export protocol types for backward compatibility
export type { CreditBalance } from '../protocol/index.js';

// =============================================================================
// Pool Types
// =============================================================================

/**
 * Pool identifier for credit isolation.
 *
 * Known pools:
 * - 'general': Default pool. Unrestricted credits usable for any operation.
 *   When poolId is omitted, 'general' is assumed.
 * - 'campaign:{campaignId}': Credits restricted to a specific campaign grant.
 *   Only usable for operations within that campaign's scope.
 *   Created by CampaignEngine when a grant is issued.
 * - 'agent:{agentId}': Future agent wallet isolation.
 *   Reserved for ERC-6551 integration (Sprint 6).
 *
 * Pool ownership: The pool creator (campaign service, agent wallet service)
 * is responsible for pool lifecycle. The ledger service only enforces isolation.
 */
export type PoolId = string;

/** Default pool used when poolId is omitted */
export const DEFAULT_POOL: PoolId = 'general';

// =============================================================================
// Entity Types — Aliased from protocol types
// =============================================================================

/** Entity types — canonical definition in protocol/billing-types.ts */
export type EntityType = ProtocolEntityType;

/** Credit lot source types — canonical definition in protocol/billing-types.ts */
export type SourceType = ProtocolSourceType;

/** Ledger entry types — canonical definition in protocol/billing-types.ts */
export type EntryType = ProtocolEntryType;

export type ReservationStatus = 'pending' | 'finalized' | 'released' | 'expired';

/** Billing enforcement mode — canonical definition in protocol/billing-types.ts */
export type BillingMode = ProtocolBillingMode;

// =============================================================================
// Domain Types
// =============================================================================

export interface CreditAccount {
  id: string;
  entityType: EntityType;
  entityId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLot {
  id: string;
  accountId: string;
  poolId: PoolId | null;
  sourceType: SourceType;
  sourceId: string | null;
  originalMicro: bigint;
  availableMicro: bigint;
  reservedMicro: bigint;
  consumedMicro: bigint;
  expiresAt: string | null;
  createdAt: string;
}

export interface BalanceResult {
  accountId: string;
  poolId: PoolId | null;
  availableMicro: bigint;
  reservedMicro: bigint;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  poolId: PoolId | null;
  lotId: string | null;
  reservationId: string | null;
  entrySeq: number;
  entryType: EntryType;
  amountMicro: bigint;
  idempotencyKey: string | null;
  description: string | null;
  metadata: string | null;
  /** Pre-operation balance (null for rows created before migration 034) */
  preBalanceMicro: bigint | null;
  /** Post-operation balance (null for rows created before migration 034) */
  postBalanceMicro: bigint | null;
  createdAt: string;
}

// =============================================================================
// Operation Options
// =============================================================================

export interface ReserveOptions {
  /** Billing mode for this reservation. Default: 'live' */
  billingMode?: BillingMode;
  /** Reservation TTL in seconds. Default: 300 (5 minutes) */
  ttlSeconds?: number;
  /** Idempotency key to prevent duplicate reservations */
  idempotencyKey?: string;
  /** Description for ledger entry */
  description?: string;
  /** JSON metadata for ledger entry */
  metadata?: string;
}

export interface FinalizeOptions {
  /** Idempotency key (defaults to account_id:finalize:reservation_id) */
  idempotencyKey?: string;
  /** Description for ledger entry */
  description?: string;
  /** JSON metadata for ledger entry */
  metadata?: string;
}

export interface ReleaseOptions {
  /** Description for ledger entry */
  description?: string;
}

export interface MintLotOptions {
  /** Pool to assign the lot to. Default: 'general' */
  poolId?: PoolId;
  /** External source ID (e.g., crypto_payments.id) for dedup */
  sourceId?: string;
  /** Lot expiry time (ISO 8601). Default: no expiry */
  expiresAt?: string;
  /** Idempotency key */
  idempotencyKey?: string;
  /** Description for ledger entry */
  description?: string;
}

export interface HistoryOptions {
  /** Pool filter */
  poolId?: PoolId;
  /** Entry type filter */
  entryType?: EntryType;
  /** Maximum entries to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Operation Results
// =============================================================================

export interface ReservationResult {
  reservationId: string;
  accountId: string;
  poolId: PoolId | null;
  totalReservedMicro: bigint;
  status: ReservationStatus;
  billingMode: BillingMode;
  expiresAt: string;
  lotAllocations: Array<{ lotId: string; reservedMicro: bigint }>;
}

export interface FinalizeResult {
  reservationId: string;
  accountId: string;
  actualCostMicro: bigint;
  surplusReleasedMicro: bigint;
  overrunMicro: bigint;
  finalizedAt: string;
}

export interface ReleaseResult {
  reservationId: string;
  accountId: string;
  releasedMicro: bigint;
}

// =============================================================================
// ICreditLedgerService Interface
// =============================================================================

/**
 * ICreditLedgerService - Credit Ledger Service Port
 *
 * Single source of truth for all monetary state. All methods use BigInt
 * for monetary values. All write operations are idempotent when an
 * idempotencyKey is provided.
 *
 * Implementations:
 * - CreditLedgerAdapter (SQLite/Drizzle + Redis cache)
 */
export interface ICreditLedgerService {
  // ---------------------------------------------------------------------------
  // Account Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new credit account for an entity.
   * Idempotent: returns existing account if (entityType, entityId) already exists.
   */
  createAccount(entityType: EntityType, entityId: string): Promise<CreditAccount>;

  /**
   * Get or create an account — convenience wrapper for auto-provisioning.
   * Always returns an account, creating one if it doesn't exist.
   */
  getOrCreateAccount(entityType: EntityType, entityId: string): Promise<CreditAccount>;

  // ---------------------------------------------------------------------------
  // Lot Management
  // ---------------------------------------------------------------------------

  /**
   * Mint a new credit lot (add credits to an account).
   * Creates the lot record and a 'deposit' or 'grant' ledger entry.
   * The sourceId field prevents double-crediting for the same external event.
   */
  mintLot(
    accountId: string,
    amountMicro: bigint,
    sourceType: SourceType,
    options?: MintLotOptions,
  ): Promise<CreditLot>;

  // ---------------------------------------------------------------------------
  // Reserve / Finalize / Release Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Reserve credits using FIFO lot selection.
   * Order: pool-restricted first → expiring first → oldest first.
   * Executes within BEGIN IMMEDIATE transaction.
   *
   * @throws {InsufficientBalanceError} if available balance < amountMicro
   */
  reserve(
    accountId: string,
    poolId: PoolId | null,
    amountMicro: bigint,
    options?: ReserveOptions,
  ): Promise<ReservationResult>;

  /**
   * Finalize a reservation with actual cost.
   * Converts reserved → consumed on lots. Releases surplus if Y < X.
   * Handles overrun per billing mode (shadow=log, soft=negative, live=cap).
   *
   * Idempotent: duplicate finalize with same reservation_id returns existing result.
   * @throws {ConflictError} if finalize with different actualCostMicro (409)
   * @throws {InvalidStateError} if reservation is not 'pending'
   */
  finalize(
    reservationId: string,
    actualCostMicro: bigint,
    options?: FinalizeOptions,
  ): Promise<FinalizeResult>;

  /**
   * Release a pending reservation, returning credits to lots.
   * Only allowed on 'pending' reservations.
   *
   * @throws {InvalidStateError} if reservation is not 'pending'
   */
  release(reservationId: string, options?: ReleaseOptions): Promise<ReleaseResult>;

  // ---------------------------------------------------------------------------
  // Balance & History
  // ---------------------------------------------------------------------------

  /**
   * Get current balance for an account (optionally filtered by pool).
   * Reads from Redis cache with SQLite fallback.
   */
  getBalance(accountId: string, poolId?: PoolId): Promise<BalanceResult>;

  /**
   * Get ledger history for an account.
   * Returns entries in reverse chronological order.
   */
  getHistory(accountId: string, options?: HistoryOptions): Promise<LedgerEntry[]>;
}
