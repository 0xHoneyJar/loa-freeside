/**
 * IPeerTransferService — Peer Transfer Service Port
 *
 * Defines the contract for agent-to-agent credit transfers.
 * The core algorithm (lot-split with conservation guarantees) is
 * implemented behind this port.
 *
 * SDD refs: §4.1.1 IPeerTransferService
 * PRD refs: FR-1.1, FR-1.2, FR-1.5, G-1
 *
 * @module core/ports/IPeerTransferService
 */

// =============================================================================
// Transfer Types
// =============================================================================

/**
 * Options for initiating a peer transfer.
 */
export interface TransferOptions {
  /** Client-provided idempotency key (REQUIRED — enforced by transfers table UNIQUE constraint) */
  idempotencyKey: string;
  /** Optional metadata stored with the transfer (JSON-serializable) */
  metadata?: Record<string, unknown>;
  /** Optional correlation ID for tracing across systems */
  correlationId?: string;
}

/**
 * Result of a transfer operation.
 */
export interface TransferResult {
  /** Transfer record ID */
  transferId: string;
  /** Sender account ID */
  fromAccountId: string;
  /** Recipient account ID */
  toAccountId: string;
  /** Transfer amount in micro-USD */
  amountMicro: bigint;
  /** Transfer status */
  status: 'completed' | 'rejected';
  /** Rejection reason (only if status === 'rejected') */
  rejectionReason?: string;
  /** Correlation ID for cross-system tracing */
  correlationId: string | null;
  /** Completion timestamp (only if status === 'completed') */
  completedAt: string | null;
}

/**
 * Direction filter for listing transfers.
 */
export type TransferDirection = 'sent' | 'received' | 'all';

/**
 * Options for listing transfers.
 */
export interface ListTransfersOptions {
  /** Filter by direction relative to the queried account */
  direction?: TransferDirection;
  /** Maximum results (default 20, max 100) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Port Interface
// =============================================================================

export interface IPeerTransferService {
  /**
   * Execute a peer-to-peer credit transfer.
   *
   * The entire operation runs within a single BEGIN IMMEDIATE transaction:
   * idempotency check → validation → lot selection (FIFO) → lot-split →
   * paired ledger entries → status update.
   *
   * @param fromAccountId - Sender's credit account ID
   * @param toAccountId - Recipient's credit account ID
   * @param amountMicro - Amount to transfer in micro-USD (must be > 0)
   * @param options - Transfer options including required idempotency key
   * @returns Transfer result with status and details
   */
  transfer(
    fromAccountId: string,
    toAccountId: string,
    amountMicro: bigint,
    options: TransferOptions,
  ): Promise<TransferResult>;

  /**
   * Get a transfer by its ID.
   */
  getTransfer(transferId: string): Promise<TransferResult | null>;

  /**
   * Get a transfer by its idempotency key.
   */
  getTransferByIdempotencyKey(idempotencyKey: string): Promise<TransferResult | null>;

  /**
   * List transfers for an account with optional direction filtering.
   */
  listTransfers(
    accountId: string,
    options?: ListTransfersOptions,
  ): Promise<TransferResult[]>;
}
