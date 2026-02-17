/**
 * CreditLedgerAdapter - Credit Ledger Implementation
 *
 * Core financial logic implementing ICreditLedgerService with:
 * - SQLite writes (better-sqlite3) via BEGIN IMMEDIATE transactions
 * - Redis balance cache (best-effort, SQLite is sole source of truth)
 * - FIFO lot selection per SDD §1.5.1
 * - Reservation state machine per SDD §1.5.2
 * - Idempotent operations via billing_idempotency_keys
 * - SQLite BUSY retry with exponential backoff
 *
 * SDD refs: §1.4, §1.5.1, §1.5.2, §1.5.3, §3.2
 * Sprint refs: Task 1.5
 *
 * @module packages/adapters/billing/CreditLedgerAdapter
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  ICreditLedgerService,
  CreditAccount,
  CreditLot,
  BalanceResult,
  LedgerEntry,
  ReservationResult,
  FinalizeResult,
  ReleaseResult,
  EntityType,
  SourceType,
  BillingMode,
  PoolId,
  ReserveOptions,
  FinalizeOptions,
  ReleaseOptions,
  MintLotOptions,
  HistoryOptions,
} from '../../core/ports/ICreditLedgerService.js';
import { DEFAULT_POOL } from '../../core/ports/ICreditLedgerService.js';
import { assertMicroUSD } from '../../core/protocol/arithmetic.js';
import type { MicroUSD } from '../../core/protocol/arithmetic.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

/** Default reservation TTL: 5 minutes */
const DEFAULT_TTL_SECONDS = 300;

/** SQLite BUSY retry backoff schedule (ms) */
const BUSY_RETRY_DELAYS = [10, 50, 200];

/** Redis command timeout (ms) */
const REDIS_COMMAND_TIMEOUT_MS = 200;

/** Redis key prefix for balance cache */
const REDIS_BALANCE_PREFIX = 'billing:balance:';

import { sqliteTimestamp, sqliteFutureTimestamp } from './protocol/timestamps';

/** @deprecated Use sqliteTimestamp() from protocol/timestamps.ts */
const sqliteNow = sqliteTimestamp;
/** @deprecated Use sqliteFutureTimestamp() from protocol/timestamps.ts */
const sqliteFuture = (offsetSeconds: number) => sqliteFutureTimestamp(offsetSeconds);

// =============================================================================
// Error Classes
// =============================================================================

export class InsufficientBalanceError extends Error {
  constructor(accountId: string, requested: bigint, available: bigint) {
    super(
      `Insufficient balance for account ${accountId}: ` +
      `requested ${requested}, available ${available}`
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class InvalidStateError extends Error {
  constructor(reservationId: string, currentStatus: string, attemptedAction: string) {
    super(
      `Cannot ${attemptedAction} reservation ${reservationId}: ` +
      `current status is '${currentStatus}', expected 'pending'`
    );
    this.name = 'InvalidStateError';
  }
}

export class ConflictError extends Error {
  constructor(reservationId: string) {
    super(
      `Conflicting finalize for reservation ${reservationId}: ` +
      `already finalized with different actual_cost_micro`
    );
    this.name = 'ConflictError';
  }
}

export class FourEyesViolationError extends Error {
  constructor(ruleId: string, actor: string) {
    super(
      `Four-eyes violation on rule ${ruleId}: ` +
      `actor '${actor}' cannot approve their own proposal`
    );
    this.name = 'FourEyesViolationError';
  }
}

// =============================================================================
// Redis Interface (minimal for balance cache)
// =============================================================================

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  del(key: string): Promise<number>;
  quit(): Promise<string>;
}

// =============================================================================
// CreditLedgerAdapter
// =============================================================================

export class CreditLedgerAdapter implements ICreditLedgerService {
  private db: Database.Database;
  private redis: RedisClient | null;
  private economicEmitter: { emitInTransaction(tx: { prepare(sql: string): any }, event: any): void } | null = null;

  constructor(db: Database.Database, redis?: RedisClient | null) {
    this.db = db;
    this.redis = redis ?? null;

    // Enable WAL mode and busy timeout for write concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
  }

  /**
   * Set the economic event emitter for outbox-backed event emission.
   * Optional: when not set, no economic events are emitted (backward-compatible).
   */
  setEconomicEmitter(emitter: { emitInTransaction(tx: { prepare(sql: string): any }, event: any): void }): void {
    this.economicEmitter = emitter;
  }

  // ---------------------------------------------------------------------------
  // Account Management
  // ---------------------------------------------------------------------------

  async createAccount(entityType: EntityType, entityId: string): Promise<CreditAccount> {
    return this.withBusyRetry(() => {
      const id = randomUUID();
      const now = sqliteNow();

      // Idempotent: try insert, return existing if conflict
      const existing = this.db.prepare(
        `SELECT id, entity_type, entity_id, version, created_at, updated_at
         FROM credit_accounts
         WHERE entity_type = ? AND entity_id = ?`
      ).get(entityType, entityId) as CreditAccountRow | undefined;

      if (existing) {
        return rowToAccount(existing);
      }

      this.db.prepare(
        `INSERT INTO credit_accounts (id, entity_type, entity_id, version, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`
      ).run(id, entityType, entityId, now, now);

      return { id, entityType, entityId, version: 0, createdAt: now, updatedAt: now };
    });
  }

  async getOrCreateAccount(entityType: EntityType, entityId: string): Promise<CreditAccount> {
    return this.createAccount(entityType, entityId);
  }

  // ---------------------------------------------------------------------------
  // Lot Management
  // ---------------------------------------------------------------------------

  async mintLot(
    accountId: string,
    amountMicro: bigint,
    sourceType: SourceType,
    options?: MintLotOptions,
  ): Promise<CreditLot> {
    assertMicroUSD(amountMicro);

    const poolId = options?.poolId ?? DEFAULT_POOL;
    const sourceId = options?.sourceId ?? null;
    const expiresAt = options?.expiresAt ?? null;
    const idempotencyKey = options?.idempotencyKey ?? null;
    const description = options?.description ?? `${sourceType} lot`;

    return this.withBusyRetry(() => {
      return this.db.transaction(() => {
        // Check idempotency
        if (idempotencyKey) {
          const existing = this.checkIdempotency('mint', idempotencyKey);
          if (existing) {
            const lot = this.db.prepare(
              `SELECT * FROM credit_lots WHERE id = ?`
            ).get(existing) as CreditLotRow;
            return rowToLot(lot);
          }
        }

        const lotId = randomUUID();
        const now = sqliteNow();

        // Create the lot
        this.db.prepare(
          `INSERT INTO credit_lots
           (id, account_id, pool_id, source_type, source_id,
            original_micro, available_micro, reserved_micro, consumed_micro,
            expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
        ).run(lotId, accountId, poolId, sourceType, sourceId,
          amountMicro.toString(), amountMicro.toString(), expiresAt, now);

        // Allocate entry_seq
        const entrySeq = this.allocateSeq(accountId, poolId);

        // Audit trail: snapshot balance before and after lot creation
        // Pre-balance is computed AFTER the lot INSERT (lot exists but hasn't been counted yet in prior balance)
        // Since we just inserted the lot, the current available_micro includes the new lot
        const postBalance = this.snapshotBalance(accountId, poolId);
        const preBalance = postBalance - amountMicro;

        // Create ledger entry
        const entryId = randomUUID();
        const entryType = sourceType === 'grant' ? 'grant' : 'deposit';
        this.db.prepare(
          `INSERT INTO credit_ledger
           (id, account_id, pool_id, lot_id, entry_seq, entry_type,
            amount_micro, idempotency_key, description,
            pre_balance_micro, post_balance_micro, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(entryId, accountId, poolId, lotId, entrySeq, entryType,
          amountMicro.toString(), idempotencyKey, description,
          preBalance.toString(), postBalance.toString(), now);

        // Update balance cache
        this.upsertBalance(accountId, poolId);

        // Record idempotency
        if (idempotencyKey) {
          this.recordIdempotency('mint', idempotencyKey, lotId);
        }

        return {
          id: lotId,
          accountId,
          poolId,
          sourceType,
          sourceId,
          originalMicro: amountMicro,
          availableMicro: amountMicro,
          reservedMicro: 0n,
          consumedMicro: 0n,
          expiresAt,
          createdAt: now,
        };
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Reserve
  // ---------------------------------------------------------------------------

  async reserve(
    accountId: string,
    poolId: PoolId | null,
    amountMicro: bigint,
    options?: ReserveOptions,
  ): Promise<ReservationResult> {
    assertMicroUSD(amountMicro);

    const effectivePool = poolId ?? DEFAULT_POOL;
    const billingMode: BillingMode = options?.billingMode ?? 'live';
    const ttlSeconds = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const idempotencyKey = options?.idempotencyKey ?? null;
    const description = options?.description ?? 'reserve';
    const metadata = options?.metadata ?? null;

    return this.withBusyRetry(() => {
      return this.db.transaction(() => {
        // Check idempotency
        if (idempotencyKey) {
          const existing = this.checkIdempotency('reserve', idempotencyKey);
          if (existing) {
            return this.getReservationResult(existing);
          }
        }

        const nowStr = sqliteNow();
        const expiresAt = sqliteFuture(ttlSeconds);

        // FIFO lot selection: pool-restricted first, expiring first, oldest first
        // safeIntegers(true) ensures monetary columns return BigInt (no silent truncation above 2^53)
        const lots = this.db.prepare(`
          SELECT id, available_micro
          FROM credit_lots
          WHERE account_id = ?
            AND (pool_id = ? OR pool_id IS NULL OR pool_id = 'general')
            AND available_micro > 0
            AND (expires_at IS NULL OR expires_at > datetime('now'))
          ORDER BY
            CASE WHEN pool_id = ? THEN 0 ELSE 1 END ASC,
            CASE WHEN expires_at IS NOT NULL THEN 0 ELSE 1 END ASC,
            expires_at ASC,
            created_at ASC
        `).safeIntegers(true).all(accountId, effectivePool, effectivePool) as Array<{ id: string; available_micro: bigint }>;

        // Iterate lots, allocating until requested amount is fulfilled
        let remaining = amountMicro;
        const allocations: Array<{ lotId: string; reservedMicro: bigint }> = [];

        for (const lot of lots) {
          if (remaining <= 0n) break;

          const available = BigInt(lot.available_micro); // no-op when already BigInt via safeIntegers
          const take = remaining < available ? remaining : available;

          // Update lot: move from available to reserved
          this.db.prepare(
            `UPDATE credit_lots
             SET available_micro = available_micro - ?,
                 reserved_micro = reserved_micro + ?
             WHERE id = ?`
          ).run(take.toString(), take.toString(), lot.id);

          allocations.push({ lotId: lot.id, reservedMicro: take });
          remaining -= take;
        }

        if (remaining > 0n) {
          throw new InsufficientBalanceError(
            accountId, amountMicro, amountMicro - remaining
          );
        }

        // Create reservation record
        const reservationId = randomUUID();
        this.db.prepare(
          `INSERT INTO credit_reservations
           (id, account_id, pool_id, total_reserved_micro, status, billing_mode,
            expires_at, created_at, idempotency_key)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
        ).run(reservationId, accountId, effectivePool,
          amountMicro.toString(), billingMode, expiresAt, nowStr, idempotencyKey);

        // Create reservation_lots records
        const insertLot = this.db.prepare(
          `INSERT INTO reservation_lots (reservation_id, lot_id, reserved_micro, created_at)
           VALUES (?, ?, ?, ?)`
        );
        for (const alloc of allocations) {
          insertLot.run(reservationId, alloc.lotId, alloc.reservedMicro.toString(), nowStr);
        }

        // Audit trail: balance after lots have been debited
        const postBalance = this.snapshotBalance(accountId, effectivePool);
        const preBalance = postBalance + amountMicro; // lots were already debited above

        // Create ledger entry
        const entrySeq = this.allocateSeq(accountId, effectivePool);
        this.db.prepare(
          `INSERT INTO credit_ledger
           (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
            amount_micro, idempotency_key, description, metadata,
            pre_balance_micro, post_balance_micro, created_at)
           VALUES (?, ?, ?, ?, ?, 'reserve', ?, ?, ?, ?, ?, ?, ?)`
        ).run(randomUUID(), accountId, effectivePool, reservationId, entrySeq,
          (-amountMicro).toString(), idempotencyKey, description, metadata,
          preBalance.toString(), postBalance.toString(), nowStr);

        // Update balance cache
        this.upsertBalance(accountId, effectivePool);

        // Record idempotency
        if (idempotencyKey) {
          this.recordIdempotency('reserve', idempotencyKey, reservationId);
        }

        const result: ReservationResult = {
          reservationId,
          accountId,
          poolId: effectivePool,
          totalReservedMicro: amountMicro,
          status: 'pending',
          billingMode,
          expiresAt,
          lotAllocations: allocations,
        };

        return result;
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Finalize
  // ---------------------------------------------------------------------------

  async finalize(
    reservationId: string,
    actualCostMicro: bigint,
    options?: FinalizeOptions,
  ): Promise<FinalizeResult> {
    assertMicroUSD(actualCostMicro);

    return this.withBusyRetry(() => {
      return this.db.transaction(() => {
        // Load reservation
        const reservation = this.db.prepare(
          `SELECT id, account_id, pool_id, total_reserved_micro, status, billing_mode
           FROM credit_reservations WHERE id = ?`
        ).get(reservationId) as CreditReservationRow | undefined;

        if (!reservation) {
          throw new Error(`Reservation ${reservationId} not found`);
        }

        const accountId = reservation.account_id;
        const poolId = reservation.pool_id ?? DEFAULT_POOL;
        const totalReserved = BigInt(reservation.total_reserved_micro);
        const billingMode = reservation.billing_mode as BillingMode;

        // Check idempotency for finalize
        const idempotencyKey = options?.idempotencyKey ??
          `${accountId}:finalize:${reservationId}`;

        const existingResult = this.checkIdempotency('finalize', idempotencyKey);
        if (existingResult) {
          // Verify same amount — conflicting finalize returns 409
          const existingEntry = this.db.prepare(
            `SELECT amount_micro FROM credit_ledger
             WHERE reservation_id = ? AND entry_type = 'finalize'
             LIMIT 1`
          ).get(reservationId) as { amount_micro: string } | undefined;

          if (existingEntry) {
            const existingCost = -BigInt(existingEntry.amount_micro);
            if (existingCost !== actualCostMicro) {
              throw new ConflictError(reservationId);
            }
          }

          // Same amount — return existing result
          return this.getFinalizeResult(reservationId);
        }

        if (reservation.status !== 'pending') {
          throw new InvalidStateError(reservationId, reservation.status, 'finalize');
        }

        const now = sqliteNow();
        let surplusReleasedMicro = 0n;
        let overrunMicro = 0n;
        let effectiveCost = actualCostMicro;

        // Handle overrun/surplus
        if (actualCostMicro > totalReserved) {
          overrunMicro = actualCostMicro - totalReserved;
          switch (billingMode) {
            case 'shadow':
              // Log only, cap at reserved
              logger.warn({
                event: 'billing.overrun.shadow',
                reservationId, overrunMicro: overrunMicro.toString(),
              }, 'Shadow mode overrun — logging without impact');
              effectiveCost = totalReserved;
              break;
            case 'soft':
              // Allow negative balance — consume full amount
              effectiveCost = actualCostMicro;
              break;
            case 'live':
              // Cap at reserved amount
              effectiveCost = totalReserved;
              overrunMicro = 0n; // Capped, no actual overrun
              break;
          }
        } else if (actualCostMicro < totalReserved) {
          surplusReleasedMicro = totalReserved - actualCostMicro;
        }

        // Process reservation_lots: convert reserved → consumed
        const resLots = this.db.prepare(
          `SELECT lot_id, reserved_micro FROM reservation_lots
           WHERE reservation_id = ?`
        ).safeIntegers(true).all(reservationId) as Array<{ lot_id: string; reserved_micro: bigint }>;

        let costRemaining = effectiveCost;
        for (const rl of resLots) {
          const lotReserved = BigInt(rl.reserved_micro); // no-op when already BigInt via safeIntegers
          const consume = costRemaining < lotReserved ? costRemaining : lotReserved;
          const release = lotReserved - consume;

          // Move from reserved to consumed (and release surplus to available)
          this.db.prepare(
            `UPDATE credit_lots
             SET reserved_micro = reserved_micro - ?,
                 consumed_micro = consumed_micro + ?,
                 available_micro = available_micro + ?
             WHERE id = ?`
          ).run(lotReserved.toString(), consume.toString(), release.toString(), rl.lot_id);

          costRemaining -= consume;
        }

        // Update reservation status
        this.db.prepare(
          `UPDATE credit_reservations
           SET status = 'finalized', finalized_at = ?
           WHERE id = ?`
        ).run(now, reservationId);

        // Audit trail: balance after lots consumed/surplus released
        const postBalance = this.snapshotBalance(accountId, poolId);
        // Pre-balance: before finalize, the surplus was still reserved (not available)
        // and the consumed portion was also reserved. So pre = post - surplusReleased
        const preBalance = postBalance - surplusReleasedMicro;

        // Create ledger entry for finalize
        const entrySeq = this.allocateSeq(accountId, poolId);
        this.db.prepare(
          `INSERT INTO credit_ledger
           (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
            amount_micro, idempotency_key, description, metadata,
            pre_balance_micro, post_balance_micro, created_at)
           VALUES (?, ?, ?, ?, ?, 'finalize', ?, ?, ?, ?, ?, ?, ?)`
        ).run(randomUUID(), accountId, poolId, reservationId, entrySeq,
          (-effectiveCost).toString(), idempotencyKey,
          options?.description ?? 'finalize',
          options?.metadata ?? null,
          preBalance.toString(), postBalance.toString(), now);

        // Update balance cache
        this.upsertBalance(accountId, poolId);

        // Record idempotency
        this.recordIdempotency('finalize', idempotencyKey, reservationId);

        return {
          reservationId,
          accountId,
          actualCostMicro: effectiveCost,
          surplusReleasedMicro,
          overrunMicro,
          finalizedAt: now,
        };
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Finalize (Transaction-threaded)
  // ---------------------------------------------------------------------------

  finalizeInTransaction(
    tx: { prepare(sql: string): any },
    reservationId: string,
    actualCostMicro: bigint,
    options?: FinalizeOptions,
  ): FinalizeResult {
    // Delegate to the same finalize logic but using the caller's transaction handle.
    // The caller is responsible for wrapping this in db.transaction().
    assertMicroUSD(actualCostMicro);

    const reservation = tx.prepare(
      `SELECT id, account_id, pool_id, total_reserved_micro, status, billing_mode
       FROM credit_reservations WHERE id = ?`
    ).get(reservationId) as CreditReservationRow | undefined;

    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    if (reservation.status !== 'pending') {
      throw new InvalidStateError(reservationId, reservation.status, 'finalize');
    }

    const accountId = reservation.account_id;
    const poolId = reservation.pool_id ?? DEFAULT_POOL;
    const totalReserved = BigInt(reservation.total_reserved_micro);
    const now = sqliteNow();
    let effectiveCost = actualCostMicro;
    let surplusReleasedMicro = 0n;
    let overrunMicro = 0n;

    if (actualCostMicro > totalReserved) {
      overrunMicro = actualCostMicro - totalReserved;
      effectiveCost = totalReserved; // Cap at reserved for transaction-threaded path
    } else if (actualCostMicro < totalReserved) {
      surplusReleasedMicro = totalReserved - actualCostMicro;
    }

    // Update reservation status
    tx.prepare(
      `UPDATE credit_reservations SET status = 'finalized', updated_at = ? WHERE id = ?`
    ).run(now, reservationId);

    // Write finalize ledger entry
    const seqRow = tx.prepare(
      `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
       FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
    ).get(accountId, poolId) as { next_seq: number };

    tx.prepare(`
      INSERT INTO credit_ledger
        (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
         amount_micro, description, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, 'finalize', ?, ?, ?, ?)
    `).run(
      randomUUID(),
      accountId,
      poolId,
      reservationId,
      seqRow.next_seq,
      (-effectiveCost).toString(),
      `Finalization of ${reservationId}`,
      `finalize:${reservationId}`,
      now,
    );

    return {
      reservationId,
      accountId,
      actualCostMicro: effectiveCost,
      surplusReleasedMicro,
      overrunMicro,
      finalizedAt: now,
    };
  }

  // ---------------------------------------------------------------------------
  // Release
  // ---------------------------------------------------------------------------

  async release(reservationId: string, options?: ReleaseOptions): Promise<ReleaseResult> {
    return this.withBusyRetry(() => {
      return this.db.transaction(() => {
        const reservation = this.db.prepare(
          `SELECT id, account_id, pool_id, total_reserved_micro, status
           FROM credit_reservations WHERE id = ?`
        ).get(reservationId) as CreditReservationRow | undefined;

        if (!reservation) {
          throw new Error(`Reservation ${reservationId} not found`);
        }

        if (reservation.status !== 'pending') {
          throw new InvalidStateError(reservationId, reservation.status, 'release');
        }

        const accountId = reservation.account_id;
        const poolId = reservation.pool_id ?? DEFAULT_POOL;
        const totalReserved = BigInt(reservation.total_reserved_micro);

        // Return reserved amounts to lots
        const resLots = this.db.prepare(
          `SELECT lot_id, reserved_micro FROM reservation_lots
           WHERE reservation_id = ?`
        ).safeIntegers(true).all(reservationId) as Array<{ lot_id: string; reserved_micro: bigint }>;

        for (const rl of resLots) {
          this.db.prepare(
            `UPDATE credit_lots
             SET reserved_micro = reserved_micro - ?,
                 available_micro = available_micro + ?
             WHERE id = ?`
          ).run(rl.reserved_micro, rl.reserved_micro, rl.lot_id);
        }

        // Update reservation status
        this.db.prepare(
          `UPDATE credit_reservations SET status = 'released' WHERE id = ?`
        ).run(reservationId);

        // Audit trail: balance after reserved amounts returned to lots
        const now = sqliteNow();
        const postBalance = this.snapshotBalance(accountId, poolId);
        const preBalance = postBalance - totalReserved; // lots were just credited above

        // Create ledger entry
        const entrySeq = this.allocateSeq(accountId, poolId);
        this.db.prepare(
          `INSERT INTO credit_ledger
           (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
            amount_micro, description,
            pre_balance_micro, post_balance_micro, created_at)
           VALUES (?, ?, ?, ?, ?, 'release', ?, ?, ?, ?, ?)`
        ).run(randomUUID(), accountId, poolId, reservationId, entrySeq,
          totalReserved.toString(), options?.description ?? 'release',
          preBalance.toString(), postBalance.toString(), now);

        // Update balance cache
        this.upsertBalance(accountId, poolId);

        return { reservationId, accountId, releasedMicro: totalReserved };
      })();
    });
  }

  // ---------------------------------------------------------------------------
  // Balance & History
  // ---------------------------------------------------------------------------

  async getBalance(accountId: string, poolId?: PoolId): Promise<BalanceResult> {
    const effectivePool = poolId ?? DEFAULT_POOL;

    // Try Redis first (best-effort)
    if (this.redis) {
      try {
        const cached = await Promise.race([
          this.redis.get(`${REDIS_BALANCE_PREFIX}${accountId}:${effectivePool}`),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Redis timeout')), REDIS_COMMAND_TIMEOUT_MS)
          ),
        ]);

        if (cached) {
          const parsed = JSON.parse(cached);
          return {
            accountId,
            poolId: effectivePool,
            availableMicro: BigInt(parsed.availableMicro),
            reservedMicro: BigInt(parsed.reservedMicro),
          };
        }
      } catch (err) {
        logger.warn({ err, event: 'billing.redis.fallback' },
          'Redis unavailable for balance read, falling back to SQLite');
      }
    }

    // SQLite fallback — compute from lots
    return this.getBalanceFromSQLite(accountId, effectivePool);
  }

  async getHistory(accountId: string, options?: HistoryOptions): Promise<LedgerEntry[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let sql = `SELECT * FROM credit_ledger WHERE account_id = ?`;
    const params: unknown[] = [accountId];

    if (options?.poolId) {
      sql += ` AND pool_id = ?`;
      params.push(options.poolId);
    }
    if (options?.entryType) {
      sql += ` AND entry_type = ?`;
      params.push(options.entryType);
    }

    sql += ` ORDER BY created_at DESC, entry_seq DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as CreditLedgerRow[];
    return rows.map(rowToLedgerEntry);
  }

  // ---------------------------------------------------------------------------
  // Internal: Balance Snapshot (Task 7.5 Audit Trail)
  // ---------------------------------------------------------------------------

  /**
   * Compute available balance from credit_lots within the current transaction.
   * Used for pre/post balance audit trail on ledger entries.
   * MUST be called within a BEGIN IMMEDIATE transaction for snapshot consistency.
   */
  private snapshotBalance(accountId: string, poolId: string): MicroUSD {
    const row = this.db.prepare(
      `SELECT COALESCE(SUM(available_micro), 0) as balance
       FROM credit_lots
       WHERE account_id = ?
         AND (pool_id = ? OR pool_id IS NULL OR pool_id = 'general')
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).safeIntegers(true).get(accountId, poolId) as { balance: bigint };
    return BigInt(row.balance) as MicroUSD;
  }

  // ---------------------------------------------------------------------------
  // Internal: Sequence Allocation
  // ---------------------------------------------------------------------------

  /**
   * Allocate next entry_seq for (account_id, pool_id).
   * Uses UPDATE + SELECT within the same transaction (no RETURNING for SQLite compat).
   */
  private allocateSeq(accountId: string, poolId: string): number {
    const updated = this.db.prepare(
      `UPDATE credit_account_seq SET next_seq = next_seq + 1
       WHERE account_id = ? AND pool_id = ?`
    ).run(accountId, poolId);

    if (updated.changes === 0) {
      // First entry — insert with next_seq = 2, use seq = 1
      this.db.prepare(
        `INSERT INTO credit_account_seq (account_id, pool_id, next_seq)
         VALUES (?, ?, 2)`
      ).run(accountId, poolId);
      return 1;
    }

    // Read the updated seq (which is now next_seq - 1)
    const row = this.db.prepare(
      `SELECT next_seq FROM credit_account_seq
       WHERE account_id = ? AND pool_id = ?`
    ).get(accountId, poolId) as { next_seq: number };

    return row.next_seq - 1;
  }

  // ---------------------------------------------------------------------------
  // Internal: Balance Cache
  // ---------------------------------------------------------------------------

  /**
   * Recompute and upsert balance from lots (SQLite source of truth).
   * Also writes to Redis (best-effort).
   */
  private upsertBalance(accountId: string, poolId: string): void {
    const balance = this.computeBalanceFromLots(accountId, poolId);
    const now = sqliteNow();

    this.db.prepare(
      `INSERT INTO credit_balances (account_id, pool_id, available_micro, reserved_micro, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, pool_id)
       DO UPDATE SET available_micro = excluded.available_micro,
                     reserved_micro = excluded.reserved_micro,
                     updated_at = excluded.updated_at`
    ).run(accountId, poolId, balance.availableMicro.toString(),
      balance.reservedMicro.toString(), now);

    // Write-through to Redis (fire-and-forget)
    this.writeRedisBalance(accountId, poolId, balance).catch((err) => {
      logger.warn({ err, event: 'billing.redis.write_fail' },
        'Failed to write balance to Redis');
    });
  }

  private computeBalanceFromLots(accountId: string, poolId: string): {
    availableMicro: MicroUSD;
    reservedMicro: MicroUSD;
  } {
    const row = this.db.prepare(
      `SELECT
         COALESCE(SUM(available_micro), 0) as available_micro,
         COALESCE(SUM(reserved_micro), 0) as reserved_micro
       FROM credit_lots
       WHERE account_id = ?
         AND (pool_id = ? OR pool_id IS NULL OR pool_id = 'general')
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    ).safeIntegers(true).get(accountId, poolId) as { available_micro: bigint; reserved_micro: bigint };

    return {
      availableMicro: BigInt(row.available_micro) as MicroUSD,
      reservedMicro: BigInt(row.reserved_micro) as MicroUSD,
    };
  }

  private getBalanceFromSQLite(accountId: string, poolId: string): BalanceResult {
    const balance = this.computeBalanceFromLots(accountId, poolId);
    return { accountId, poolId, ...balance };
  }

  private async writeRedisBalance(
    accountId: string,
    poolId: string,
    balance: { availableMicro: bigint; reservedMicro: bigint },
  ): Promise<void> {
    if (!this.redis) return;

    try {
      await Promise.race([
        this.redis.set(
          `${REDIS_BALANCE_PREFIX}${accountId}:${poolId}`,
          JSON.stringify({
            availableMicro: balance.availableMicro.toString(),
            reservedMicro: balance.reservedMicro.toString(),
          }),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Redis timeout')), REDIS_COMMAND_TIMEOUT_MS)
        ),
      ]);
    } catch {
      // Best-effort — SQLite is source of truth
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Idempotency
  // ---------------------------------------------------------------------------

  private checkIdempotency(scope: string, key: string): string | null {
    const row = this.db.prepare(
      `SELECT response_hash FROM billing_idempotency_keys
       WHERE scope = ? AND idempotency_key = ?
         AND expires_at > datetime('now')`
    ).get(scope, key) as { response_hash: string } | undefined;

    return row?.response_hash ?? null;
  }

  private recordIdempotency(scope: string, key: string, responseHash: string): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO billing_idempotency_keys
       (scope, idempotency_key, response_hash, created_at, expires_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now', '+24 hours'))`
    ).run(scope, key, responseHash);
  }

  // ---------------------------------------------------------------------------
  // Internal: Result Helpers
  // ---------------------------------------------------------------------------

  private getReservationResult(reservationId: string): ReservationResult {
    const res = this.db.prepare(
      `SELECT * FROM credit_reservations WHERE id = ?`
    ).get(reservationId) as CreditReservationRow;

    const lots = this.db.prepare(
      `SELECT lot_id, reserved_micro FROM reservation_lots WHERE reservation_id = ?`
    ).all(reservationId) as Array<{ lot_id: string; reserved_micro: string }>;

    return {
      reservationId: res.id,
      accountId: res.account_id,
      poolId: res.pool_id,
      totalReservedMicro: BigInt(res.total_reserved_micro),
      status: res.status as 'pending' | 'finalized' | 'released' | 'expired',
      billingMode: res.billing_mode as BillingMode,
      expiresAt: res.expires_at,
      lotAllocations: lots.map(l => ({
        lotId: l.lot_id,
        reservedMicro: BigInt(l.reserved_micro),
      })),
    };
  }

  private getFinalizeResult(reservationId: string): FinalizeResult {
    const res = this.db.prepare(
      `SELECT * FROM credit_reservations WHERE id = ?`
    ).get(reservationId) as CreditReservationRow;

    const entry = this.db.prepare(
      `SELECT amount_micro FROM credit_ledger
       WHERE reservation_id = ? AND entry_type = 'finalize'
       LIMIT 1`
    ).get(reservationId) as { amount_micro: string };

    return {
      reservationId,
      accountId: res.account_id,
      actualCostMicro: -BigInt(entry.amount_micro),
      surplusReleasedMicro: 0n, // Already applied
      overrunMicro: 0n,
      finalizedAt: res.finalized_at ?? sqliteNow(),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal: SQLite BUSY Retry
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
          event: 'billing.sqlite.busy_retry',
          attempt: attempt + 1,
          delayMs: delay,
        }, 'SQLite BUSY — retrying');

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Unreachable but TypeScript needs it
    throw new Error('SQLite BUSY retry exhausted');
  }
}

// =============================================================================
// Row Types (SQLite result mapping)
// =============================================================================

interface CreditAccountRow {
  id: string;
  entity_type: string;
  entity_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CreditLotRow {
  id: string;
  account_id: string;
  pool_id: string | null;
  source_type: string;
  source_id: string | null;
  original_micro: string;
  available_micro: string;
  reserved_micro: string;
  consumed_micro: string;
  expires_at: string | null;
  created_at: string;
}

interface CreditReservationRow {
  id: string;
  account_id: string;
  pool_id: string | null;
  total_reserved_micro: string;
  status: string;
  billing_mode: string;
  expires_at: string;
  created_at: string;
  finalized_at: string | null;
  idempotency_key: string | null;
}

interface CreditLedgerRow {
  id: string;
  account_id: string;
  pool_id: string | null;
  lot_id: string | null;
  reservation_id: string | null;
  entry_seq: number;
  entry_type: string;
  amount_micro: string;
  idempotency_key: string | null;
  description: string | null;
  metadata: string | null;
  pre_balance_micro: string | null;
  post_balance_micro: string | null;
  created_at: string;
}

// =============================================================================
// Row Mappers
// =============================================================================

function rowToAccount(row: CreditAccountRow): CreditAccount {
  return {
    id: row.id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLot(row: CreditLotRow): CreditLot {
  return {
    id: row.id,
    accountId: row.account_id,
    poolId: row.pool_id,
    sourceType: row.source_type as SourceType,
    sourceId: row.source_id,
    originalMicro: BigInt(row.original_micro),
    availableMicro: BigInt(row.available_micro),
    reservedMicro: BigInt(row.reserved_micro),
    consumedMicro: BigInt(row.consumed_micro),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function rowToLedgerEntry(row: CreditLedgerRow): LedgerEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    poolId: row.pool_id,
    lotId: row.lot_id,
    reservationId: row.reservation_id,
    entrySeq: row.entry_seq,
    entryType: row.entry_type as LedgerEntry['entryType'],
    amountMicro: BigInt(row.amount_micro),
    idempotencyKey: row.idempotency_key,
    description: row.description,
    metadata: row.metadata,
    preBalanceMicro: row.pre_balance_micro != null ? BigInt(row.pre_balance_micro) : null,
    postBalanceMicro: row.post_balance_micro != null ? BigInt(row.post_balance_micro) : null,
    createdAt: row.created_at,
  };
}
