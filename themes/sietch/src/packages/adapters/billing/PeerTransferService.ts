/**
 * PeerTransferService — Agent-to-Agent Credit Transfers
 *
 * Implements the lot-split transfer algorithm with conservation guarantees
 * and policy enforcement (budget caps, provenance verification, governance limits).
 *
 * Transfer algorithm:
 *   pre-tx: provenance check → budget check →
 *   tx: idempotency check → governance limits → FIFO lot selection → lot-split →
 *       paired ledger entries → budget finalization → event emission → status update
 *
 * Conservation invariants enforced:
 * - Per-lot: available_micro + reserved_micro + consumed_micro = original_micro
 * - Global: SUM(original_micro) is preserved (sender reduction = recipient creation)
 * - reserved_micro and consumed_micro are NEVER modified by transfers
 * - available_micro must never go negative
 *
 * SDD refs: §4.1 PeerTransferService, §4.1.2 Transfer Algorithm, §4.1.3 Lot Selection, §4.1.4 Constructor DI
 * PRD refs: FR-1.1, FR-1.2, FR-1.3, FR-1.4, FR-1.5, FR-1.6, FR-1.7, FR-1.8, FR-1.9, G-1, G-5
 *
 * @module adapters/billing/PeerTransferService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps.js';
import { assertMicroUSD } from '../../core/protocol/arrakis-arithmetic.js';
import type { MicroUSD } from '../../core/protocol/arrakis-arithmetic.js';
import { DEFAULT_POOL } from '../../core/ports/ICreditLedgerService.js';
import type { IEconomicEventEmitter } from '../../core/ports/IEconomicEventEmitter.js';
import type { IAgentBudgetService } from '../../core/ports/IAgentBudgetService.js';
import type { IAgentProvenanceVerifier } from '../../core/ports/IAgentProvenanceVerifier.js';
import type { IConstitutionalGovernanceService } from '../../core/ports/IConstitutionalGovernanceService.js';
import type { EntityType } from '../../core/protocol/billing-types.js';
import { CONFIG_FALLBACKS } from '../../core/protocol/config-schema.js';
import type {
  IPeerTransferService,
  TransferOptions,
  TransferResult,
  ListTransfersOptions,
} from '../../core/ports/IPeerTransferService.js';

// =============================================================================
// Constants
// =============================================================================

/** SQLite BUSY retry backoff schedule (ms) */
const BUSY_RETRY_DELAYS = [10, 50, 200];

/** Maximum limit for list queries */
const MAX_LIST_LIMIT = 100;

/** Default limit for list queries */
const DEFAULT_LIST_LIMIT = 20;

// =============================================================================
// Internal Types
// =============================================================================

interface LotRow {
  id: string;
  pool_id: string | null;
  original_micro: bigint;
  available_micro: bigint;
  reserved_micro: bigint;
  consumed_micro: bigint;
  expires_at: string | null;
}

interface TransferRow {
  id: string;
  idempotency_key: string;
  from_account_id: string;
  to_account_id: string;
  amount_micro: number | bigint;
  correlation_id: string | null;
  status: string;
  rejection_reason: string | null;
  metadata: string | null;
  created_at: string;
  completed_at: string | null;
}

// =============================================================================
// PeerTransferService
// =============================================================================

export class PeerTransferService implements IPeerTransferService {
  private db: Database.Database;
  private eventEmitter: IEconomicEventEmitter | null;
  private budgetService: IAgentBudgetService | null;
  private provenanceVerifier: IAgentProvenanceVerifier | null;
  private governance: IConstitutionalGovernanceService | null;

  constructor(
    db: Database.Database,
    eventEmitter?: IEconomicEventEmitter,
    budgetService?: IAgentBudgetService,
    provenanceVerifier?: IAgentProvenanceVerifier,
    governance?: IConstitutionalGovernanceService,
  ) {
    this.db = db;
    this.eventEmitter = eventEmitter ?? null;
    this.budgetService = budgetService ?? null;
    this.provenanceVerifier = provenanceVerifier ?? null;
    this.governance = governance ?? null;

    // Enable WAL mode and busy timeout
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
  }

  // ---------------------------------------------------------------------------
  // Transfer (Core Algorithm + Policy Layer)
  // ---------------------------------------------------------------------------

  async transfer(
    fromAccountId: string,
    toAccountId: string,
    amountMicro: bigint,
    options: TransferOptions,
  ): Promise<TransferResult> {
    assertMicroUSD(amountMicro);

    if (amountMicro <= 0n) {
      throw new Error('Transfer amount must be positive');
    }

    // Validation: self-transfer prohibited
    if (fromAccountId === toAccountId) {
      return this.createRejection(
        fromAccountId, toAccountId, amountMicro, options,
        'self_transfer',
      );
    }

    // =========================================================================
    // Pre-transaction policy checks (async — Redis, provenance queries)
    // =========================================================================

    const senderIsAgent = this.isAgent(fromAccountId);

    // Provenance check: agent senders must have verified provenance chain
    if (senderIsAgent && this.provenanceVerifier) {
      try {
        const provenance = await this.provenanceVerifier.verifyProvenance(fromAccountId);
        if (!provenance.verified) {
          return this.createRejection(
            fromAccountId, toAccountId, amountMicro, options,
            'provenance_failed',
          );
        }
      } catch (err: unknown) {
        // No identity record → provenance failed
        if (err instanceof Error && (err as any).code === 'NOT_FOUND') {
          return this.createRejection(
            fromAccountId, toAccountId, amountMicro, options,
            'provenance_failed',
          );
        }
        throw err;
      }
    }

    // Budget check: agent senders must have sufficient daily budget
    if (senderIsAgent && this.budgetService) {
      const budgetCheck = await this.budgetService.checkBudget(fromAccountId, amountMicro);
      if (!budgetCheck.allowed) {
        return this.createRejection(
          fromAccountId, toAccountId, amountMicro, options,
          'budget_exceeded',
        );
      }
    }

    // =========================================================================
    // Transaction: idempotency → governance → lot-split → finalization
    // =========================================================================

    return this.withBusyRetry(() => {
      return this.db.transaction(() => {
        const now = sqliteTimestamp();
        const transferId = randomUUID();
        const correlationId = options.correlationId ?? `transfer:${transferId}`;

        // Step 1: Idempotency check
        const existing = this.db.prepare(
          `SELECT * FROM transfers WHERE idempotency_key = ?`
        ).get(options.idempotencyKey) as TransferRow | undefined;

        if (existing) {
          return this.rowToResult(existing);
        }

        // Step 2: Insert pending transfer record
        this.db.prepare(
          `INSERT INTO transfers
           (id, idempotency_key, from_account_id, to_account_id, amount_micro,
            correlation_id, status, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
        ).run(
          transferId,
          options.idempotencyKey,
          fromAccountId,
          toAccountId,
          amountMicro.toString(),
          correlationId,
          options.metadata ? JSON.stringify(options.metadata) : null,
          now,
        );

        // Step 3: Governance transfer limits (resolved within tx for consistency)
        const governanceRejection = this.checkGovernanceLimits(
          fromAccountId, amountMicro, transferId, now,
        );
        if (governanceRejection) {
          this.emitTransferEventInTx(
            this.db, 'PeerTransferRejected', transferId,
            fromAccountId, toAccountId, amountMicro, correlationId, now,
            { reason: governanceRejection },
          );
          return this.getTransferRow(transferId);
        }

        // Step 4: Emit PeerTransferInitiated (observability — after validation, before lot selection)
        this.emitTransferEventInTx(
          this.db, 'PeerTransferInitiated', transferId,
          fromAccountId, toAccountId, amountMicro, correlationId, now, {},
        );

        // Step 5: FIFO lot selection
        // Order: pool-restricted first, expiring first, oldest first
        const lots = this.db.prepare(`
          SELECT id, pool_id, original_micro, available_micro, reserved_micro, consumed_micro, expires_at
          FROM credit_lots
          WHERE account_id = ?
            AND available_micro > 0
            AND (expires_at IS NULL OR expires_at > datetime('now'))
          ORDER BY
            CASE WHEN pool_id IS NOT NULL AND pool_id != 'general' THEN 0 ELSE 1 END,
            CASE WHEN expires_at IS NOT NULL THEN 0 ELSE 1 END,
            expires_at ASC,
            created_at ASC
        `).safeIntegers(true).all(fromAccountId) as LotRow[];

        // Step 6: Calculate total available
        let totalAvailable = 0n;
        for (const lot of lots) {
          totalAvailable += BigInt(lot.available_micro);
        }

        // Insufficient balance check
        if (totalAvailable < amountMicro) {
          this.db.prepare(
            `UPDATE transfers SET status = 'rejected', rejection_reason = ? WHERE id = ?`
          ).run('insufficient_balance', transferId);

          this.emitTransferEventInTx(
            this.db, 'PeerTransferRejected', transferId,
            fromAccountId, toAccountId, amountMicro, correlationId, now,
            { reason: 'insufficient_balance' },
          );

          return this.getTransferRow(transferId);
        }

        // Step 7: Lot-split — reduce sender lots, track split amounts per pool
        let remaining = amountMicro;
        const splitDetails: Array<{ lotId: string; poolId: string | null; splitAmount: bigint }> = [];

        for (const lot of lots) {
          if (remaining <= 0n) break;

          const available = BigInt(lot.available_micro);
          const splitAmount = available < remaining ? available : remaining;

          // Reduce sender lot: original_micro and available_micro decrease by splitAmount
          // reserved_micro and consumed_micro remain UNCHANGED
          const newOriginal = BigInt(lot.original_micro) - splitAmount;
          const newAvailable = available - splitAmount;

          this.db.prepare(
            `UPDATE credit_lots
             SET original_micro = ?, available_micro = ?
             WHERE id = ?`
          ).run(newOriginal.toString(), newAvailable.toString(), lot.id);

          splitDetails.push({ lotId: lot.id, poolId: lot.pool_id, splitAmount });
          remaining -= splitAmount;
        }

        // Step 8: Create recipient lot
        // Aggregate split into a single recipient lot with source_type='transfer_in'
        const recipientLotId = randomUUID();
        this.db.prepare(
          `INSERT INTO credit_lots
           (id, account_id, pool_id, source_type, source_id,
            original_micro, available_micro, reserved_micro, consumed_micro, created_at)
           VALUES (?, ?, ?, 'transfer_in', ?, ?, ?, 0, 0, ?)`
        ).run(
          recipientLotId,
          toAccountId,
          DEFAULT_POOL, // recipient lot goes to default pool
          transferId,   // source_id = transfer ID for traceability
          amountMicro.toString(),
          amountMicro.toString(),
          now,
        );

        // Step 9: Paired ledger entries
        // Sender: transfer_out (negative)
        const senderEntrySeq = this.allocateSeq(fromAccountId, DEFAULT_POOL);
        const senderPreBalance = this.snapshotBalance(fromAccountId, DEFAULT_POOL);

        this.db.prepare(
          `INSERT INTO credit_ledger
           (id, account_id, pool_id, lot_id, entry_seq, entry_type,
            amount_micro, idempotency_key, description,
            pre_balance_micro, post_balance_micro, created_at)
           VALUES (?, ?, ?, NULL, ?, 'transfer_out', ?, ?, ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          fromAccountId,
          DEFAULT_POOL,
          senderEntrySeq,
          (-amountMicro).toString(),
          `${transferId}_out`,
          `Transfer to ${toAccountId}`,
          (senderPreBalance + amountMicro).toString(), // pre is before lot-split
          senderPreBalance.toString(),                  // post is after lot-split
          now,
        );

        // Recipient: transfer_in (positive) — credit entry for received transfer
        const recipientEntrySeq = this.allocateSeq(toAccountId, DEFAULT_POOL);
        const recipientPreBalance = this.snapshotBalance(toAccountId, DEFAULT_POOL) - amountMicro;

        this.db.prepare(
          `INSERT INTO credit_ledger
           (id, account_id, pool_id, lot_id, entry_seq, entry_type,
            amount_micro, idempotency_key, description,
            pre_balance_micro, post_balance_micro, created_at)
           VALUES (?, ?, ?, ?, ?, 'transfer_in', ?, ?, ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          toAccountId,
          DEFAULT_POOL,
          recipientLotId,
          recipientEntrySeq,
          amountMicro.toString(),
          `${transferId}_in`,
          `Transfer from ${fromAccountId}`,
          recipientPreBalance.toString(),
          (recipientPreBalance + amountMicro).toString(),
          now,
        );

        // Step 10: Update balance caches
        this.upsertBalance(fromAccountId, DEFAULT_POOL);
        this.upsertBalance(toAccountId, DEFAULT_POOL);

        // Step 11: Budget finalization (inside tx for atomic spend recording)
        if (senderIsAgent && this.budgetService) {
          this.budgetService.recordFinalizationInTransaction(
            this.db, fromAccountId, transferId, amountMicro,
          );
          // Note: Redis budget cache expires naturally (60s TTL).
          // Advisory cache is non-authoritative per SDD §4.1.2.
        }

        // Step 12: Complete the transfer
        this.db.prepare(
          `UPDATE transfers SET status = 'completed', completed_at = ? WHERE id = ?`
        ).run(now, transferId);

        // Step 13: Emit PeerTransferCompleted (within tx for dual-write atomicity)
        this.emitTransferEventInTx(
          this.db, 'PeerTransferCompleted', transferId,
          fromAccountId, toAccountId, amountMicro, correlationId, now,
          { recipientLotId, splitLots: splitDetails.length },
        );

        logger.info({
          event: 'peer_transfer.completed',
          transferId,
          fromAccountId,
          toAccountId,
          amountMicro: amountMicro.toString(),
          splitLots: splitDetails.length,
          senderIsAgent,
        }, 'Peer transfer completed');

        return this.getTransferRow(transferId);
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Queries (Task 2.4)
  // ---------------------------------------------------------------------------

  async getTransfer(transferId: string): Promise<TransferResult | null> {
    const row = this.db.prepare(
      `SELECT * FROM transfers WHERE id = ?`
    ).get(transferId) as TransferRow | undefined;

    return row ? this.rowToResult(row) : null;
  }

  async getTransferByIdempotencyKey(idempotencyKey: string): Promise<TransferResult | null> {
    const row = this.db.prepare(
      `SELECT * FROM transfers WHERE idempotency_key = ?`
    ).get(idempotencyKey) as TransferRow | undefined;

    return row ? this.rowToResult(row) : null;
  }

  async listTransfers(
    accountId: string,
    options?: ListTransfersOptions,
  ): Promise<TransferResult[]> {
    const direction = options?.direction ?? 'all';
    const limit = Math.min(options?.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const offset = options?.offset ?? 0;

    let sql: string;
    const params: unknown[] = [];

    switch (direction) {
      case 'sent':
        sql = `SELECT * FROM transfers WHERE from_account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(accountId, limit, offset);
        break;
      case 'received':
        sql = `SELECT * FROM transfers WHERE to_account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(accountId, limit, offset);
        break;
      case 'all':
      default:
        sql = `SELECT * FROM transfers WHERE from_account_id = ? OR to_account_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(accountId, accountId, limit, offset);
        break;
    }

    const rows = this.db.prepare(sql).all(...params) as TransferRow[];
    return rows.map(row => this.rowToResult(row));
  }

  // ---------------------------------------------------------------------------
  // Internal: Governance Limit Checks
  // ---------------------------------------------------------------------------

  /**
   * Check governance transfer limits within the transaction.
   * Returns rejection reason string if limits exceeded, null if within limits.
   *
   * Two limits checked:
   * - transfer.max_single_micro: maximum amount per single transfer
   * - transfer.daily_limit_micro: maximum aggregate daily volume per sender
   *
   * When governance service is unavailable, falls back to CONFIG_FALLBACKS
   * (compile-time defaults: $100 single, $500 daily).
   */
  private checkGovernanceLimits(
    fromAccountId: string,
    amountMicro: bigint,
    transferId: string,
    now: string,
  ): string | null {
    // Resolve entity type for entity-specific overrides
    const entityType = this.getEntityType(fromAccountId);

    // Max single transfer
    let maxSingleMicro: bigint;
    if (this.governance) {
      const resolved = this.governance.resolveInTransaction<number>(
        this.db, 'transfer.max_single_micro', entityType,
      );
      maxSingleMicro = BigInt(resolved.value);
    } else {
      maxSingleMicro = BigInt(CONFIG_FALLBACKS['transfer.max_single_micro']);
    }

    if (amountMicro > maxSingleMicro) {
      this.db.prepare(
        `UPDATE transfers SET status = 'rejected', rejection_reason = ? WHERE id = ?`
      ).run('governance_limit_exceeded', transferId);
      return 'governance_limit_exceeded: max_single_micro';
    }

    // Daily aggregate limit
    let dailyLimitMicro: bigint;
    if (this.governance) {
      const resolved = this.governance.resolveInTransaction<number>(
        this.db, 'transfer.daily_limit_micro', entityType,
      );
      dailyLimitMicro = BigInt(resolved.value);
    } else {
      dailyLimitMicro = BigInt(CONFIG_FALLBACKS['transfer.daily_limit_micro']);
    }

    const dailyTotal = this.getDailyTransferTotal(fromAccountId);
    if (dailyTotal + amountMicro > dailyLimitMicro) {
      this.db.prepare(
        `UPDATE transfers SET status = 'rejected', rejection_reason = ? WHERE id = ?`
      ).run('governance_limit_exceeded', transferId);
      return 'governance_limit_exceeded: daily_limit_micro';
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Internal: Helpers
  // ---------------------------------------------------------------------------

  private createRejection(
    fromAccountId: string,
    toAccountId: string,
    amountMicro: bigint,
    options: TransferOptions,
    reason: string,
  ): TransferResult {
    const now = sqliteTimestamp();
    const transferId = randomUUID();

    // Check idempotency first
    const existing = this.db.prepare(
      `SELECT * FROM transfers WHERE idempotency_key = ?`
    ).get(options.idempotencyKey) as TransferRow | undefined;

    if (existing) {
      return this.rowToResult(existing);
    }

    this.db.prepare(
      `INSERT INTO transfers
       (id, idempotency_key, from_account_id, to_account_id, amount_micro,
        correlation_id, status, rejection_reason, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, ?, ?)`
    ).run(
      transferId,
      options.idempotencyKey,
      fromAccountId,
      toAccountId,
      amountMicro.toString(),
      options.correlationId ?? null,
      reason,
      options.metadata ? JSON.stringify(options.metadata) : null,
      now,
    );

    this.emitTransferEvent('PeerTransferRejected', transferId, fromAccountId, toAccountId, amountMicro, options.correlationId ?? null, now, { reason });

    return {
      transferId,
      fromAccountId,
      toAccountId,
      amountMicro,
      status: 'rejected',
      rejectionReason: reason,
      correlationId: options.correlationId ?? null,
      completedAt: null,
    };
  }

  private getTransferRow(transferId: string): TransferResult {
    const row = this.db.prepare(
      `SELECT * FROM transfers WHERE id = ?`
    ).get(transferId) as TransferRow;

    return this.rowToResult(row);
  }

  private rowToResult(row: TransferRow): TransferResult {
    return {
      transferId: row.id,
      fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id,
      amountMicro: BigInt(row.amount_micro),
      status: row.status as 'completed' | 'rejected',
      rejectionReason: row.rejection_reason ?? undefined,
      correlationId: row.correlation_id,
      completedAt: row.completed_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: Agent & Entity Resolution
  // ---------------------------------------------------------------------------

  /**
   * Check if an account belongs to a registered agent (has agent_identity row).
   * Used to gate budget and provenance checks — non-agents skip these.
   */
  private isAgent(accountId: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM agent_identity WHERE account_id = ?`
    ).get(accountId);
    return row !== undefined;
  }

  /**
   * Resolve entity type for governance parameter overrides.
   * Returns 'agent', 'person', etc. from credit_accounts.entity_type.
   */
  private getEntityType(accountId: string): EntityType | undefined {
    const row = this.db.prepare(
      `SELECT entity_type FROM credit_accounts WHERE id = ?`
    ).get(accountId) as { entity_type: string } | undefined;
    return row?.entity_type as EntityType | undefined;
  }

  /**
   * Sum completed transfer volume for a sender in the last 24 hours.
   * Used for daily aggregate limit enforcement within the transaction.
   */
  private getDailyTransferTotal(fromAccountId: string): MicroUSD {
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(amount_micro), 0) as daily_total
      FROM transfers
      WHERE from_account_id = ?
        AND status = 'completed'
        AND created_at >= datetime('now', '-1 day')
    `).safeIntegers(true).get(fromAccountId) as { daily_total: bigint };
    return BigInt(row.daily_total) as MicroUSD;
  }

  // ---------------------------------------------------------------------------
  // Internal: Sequence Allocation (mirrors CreditLedgerAdapter)
  // ---------------------------------------------------------------------------

  private allocateSeq(accountId: string, poolId: string): number {
    const updated = this.db.prepare(
      `UPDATE credit_account_seq SET next_seq = next_seq + 1
       WHERE account_id = ? AND pool_id = ?`
    ).run(accountId, poolId);

    if (updated.changes === 0) {
      this.db.prepare(
        `INSERT INTO credit_account_seq (account_id, pool_id, next_seq)
         VALUES (?, ?, 2)`
      ).run(accountId, poolId);
      return 1;
    }

    const row = this.db.prepare(
      `SELECT next_seq FROM credit_account_seq
       WHERE account_id = ? AND pool_id = ?`
    ).get(accountId, poolId) as { next_seq: number };

    return row.next_seq - 1;
  }

  private snapshotBalance(accountId: string, poolId: string): bigint {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(available_micro), 0) as balance
       FROM credit_lots
       WHERE account_id = ?
         AND (pool_id = ? OR pool_id IS NULL OR pool_id = 'general')
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).safeIntegers(true).get(accountId, poolId) as { balance: bigint };
    return BigInt(row.balance);
  }

  private upsertBalance(accountId: string, poolId: string): void {
    const row = this.db.prepare(
      `SELECT
         COALESCE(SUM(available_micro), 0) as available_micro,
         COALESCE(SUM(reserved_micro), 0) as reserved_micro
       FROM credit_lots
       WHERE account_id = ?
         AND (pool_id = ? OR pool_id IS NULL OR pool_id = 'general')
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).safeIntegers(true).get(accountId, poolId) as { available_micro: bigint; reserved_micro: bigint };

    const now = sqliteTimestamp();
    this.db.prepare(
      `INSERT INTO credit_balances (account_id, pool_id, available_micro, reserved_micro, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, pool_id)
       DO UPDATE SET available_micro = excluded.available_micro,
                     reserved_micro = excluded.reserved_micro,
                     updated_at = excluded.updated_at`
    ).run(accountId, poolId, row.available_micro.toString(), row.reserved_micro.toString(), now);
  }

  // ---------------------------------------------------------------------------
  // Internal: Event Emission
  // ---------------------------------------------------------------------------

  /**
   * Emit transfer event within an existing transaction (dual-write via EventConsolidationAdapter).
   * Used for all events inside the main transfer transaction.
   */
  private emitTransferEventInTx(
    tx: { prepare(sql: string): any },
    eventType: 'PeerTransferInitiated' | 'PeerTransferCompleted' | 'PeerTransferRejected',
    transferId: string,
    fromAccountId: string,
    toAccountId: string,
    amountMicro: bigint,
    correlationId: string | null,
    timestamp: string,
    extra: Record<string, unknown>,
  ): void {
    if (!this.eventEmitter) return;

    try {
      this.eventEmitter.emitInTransaction(tx, {
        eventType,
        entityType: 'account',
        entityId: fromAccountId,
        correlationId: correlationId ?? `transfer:${transferId}`,
        idempotencyKey: `${transferId}:${eventType}`,
        payload: {
          transferId,
          fromAccountId,
          toAccountId,
          amountMicro: amountMicro.toString(),
          timestamp,
          ...extra,
        },
      });
    } catch {
      // Event emission failure is non-fatal — transfer integrity > observability
      logger.warn({ event: 'peer_transfer.event_emission_failed', eventType, transferId }, 'Transfer event emission failed');
    }
  }

  /**
   * Emit transfer event standalone (for pre-transaction rejections via createRejection).
   * Uses emit() which creates its own transaction.
   */
  private emitTransferEvent(
    eventType: 'PeerTransferInitiated' | 'PeerTransferCompleted' | 'PeerTransferRejected',
    transferId: string,
    fromAccountId: string,
    toAccountId: string,
    amountMicro: bigint,
    correlationId: string | null,
    timestamp: string,
    extra: Record<string, unknown>,
  ): void {
    if (!this.eventEmitter) return;

    try {
      this.eventEmitter.emit({
        eventType,
        entityType: 'account',
        entityId: fromAccountId,
        correlationId: correlationId ?? `transfer:${transferId}`,
        idempotencyKey: `${transferId}:${eventType}`,
        payload: {
          transferId,
          fromAccountId,
          toAccountId,
          amountMicro: amountMicro.toString(),
          timestamp,
          ...extra,
        },
      });
    } catch {
      // Event emission failure is non-fatal
      logger.warn({ event: 'peer_transfer.event_emission_failed', eventType, transferId }, 'Transfer event emission failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Busy Retry
  // ---------------------------------------------------------------------------

  private async withBusyRetry<T>(fn: () => T): Promise<T> {
    for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS.length; attempt++) {
      try {
        return fn();
      } catch (err: unknown) {
        const isBusy = err instanceof Error &&
          (err.message.includes('SQLITE_BUSY') || err.message.includes('database is locked'));

        if (!isBusy || attempt >= BUSY_RETRY_DELAYS.length) {
          throw err;
        }

        const delay = BUSY_RETRY_DELAYS[attempt];
        logger.warn({
          event: 'peer_transfer.sqlite.busy_retry',
          attempt: attempt + 1,
          delayMs: delay,
        }, 'SQLite BUSY — retrying');

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error('Unreachable');
  }
}
