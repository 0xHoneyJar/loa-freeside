/**
 * NOWPayments Reconciliation Sweep — Missed Webhook Recovery
 *
 * Scheduled task (every 5 minutes) that recovers purchases the webhook path
 * could not complete. Three arms share one batch:
 *
 *   1. stuck            — non-terminal payments whose provider status moved on
 *   2. missed_mint      — payments that owe a credit lot (status `finished`,
 *                         or `failed`/`expired` with a signed `finished` IPN
 *                         on record — see migration 0021)
 *   3. redis_adjustment — durable outbox of budget increments whose Redis
 *                         INCRBY has not landed yet (migration 0020)
 *
 * Slots are allocated by least-recently-serviced across all three, so neither a
 * standing backlog nor a permanently-failing row can starve the others — see
 * the SweepCandidate fairness contract.
 *
 * Operates independently of Redis availability — all queries are
 * PostgreSQL-first, and a Postgres-only mint enqueues its Redis adjustment in
 * the same transaction so nothing is lost while Redis is down.
 *
 * @see Sprint 2, Task 2.2 (F-19)
 * @see docs/runbook/nowpayments-webhook-reliability.md
 * @module packages/services/reconciliation-sweep
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import {
  processPaymentForLedger,
  LOT_EXPIRY_DAYS,
  usdToMicroSafe,
  enqueueRedisCreditAdjustment,
  applyRedisCreditAdjustment,
} from './nowpayments-handler.js';
import { mintCreditLot } from './credit-lot-service.js';
import { withCommunityScope } from './community-scope.js';

/** 1 cent = 10,000 micro-USD (mirror of nowpayments-handler). */
const MICRO_PER_CENT = 10_000n;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Result of a reconciliation sweep */
export interface ReconciliationSweepResult {
  /** Number of payments checked */
  paymentsChecked: number;
  /** Number of payments recovered (missed webhooks) */
  recoveredCount: number;
  /** Number of payments marked as failed/expired */
  failedCount: number;
  /** Number of payments still pending (no action taken) */
  pendingCount: number;
  /** Number of errors during processing */
  errorCount: number;
  /** Number of durable Redis budget adjustments drained from the outbox */
  redisAdjustmentsApplied: number;
  /** Individual payment results */
  details: PaymentReconciliationDetail[];
}

/** Detail for a single payment reconciliation */
interface PaymentReconciliationDetail {
  paymentId: string;
  communityId: string;
  previousStatus: string;
  newStatus: string | null;
  action: 'recovered' | 'failed' | 'expired' | 'pending' | 'error';
  lotId?: string | null;
  error?: string;
}

/** Minimal NOWPayments API response for status check */
interface NowpaymentsStatusResponse {
  payment_id: number;
  payment_status: string;
  actually_paid: number;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  updated_at?: string;
}

/** Optional wiring for the reconciliation sweep. */
export interface ReconciliationSweepOptions {
  /**
   * Connection used ONLY for cross-community candidate enumeration (the stuck,
   * missed-mint, and pending-outbox SELECTs). Must have cross-tenant read
   * authority — BYPASSRLS or table ownership — because those tables carry
   * forced tenant RLS and a maintenance sweep has no single community scope.
   *
   * Note the missed-mint enumeration additionally probes `webhook_events`,
   * which has forced RLS with NO policy at all (migration 0010: system-level,
   * `arrakis_admin` only). A merely-cross-tenant role is not enough there — the
   * connection must be able to read that table too.
   *
   * Defaults to the main pool, which is correct only where that pool already
   * holds such authority. Deployments running the sweep under the ordinary
   * tenant role MUST inject a maintenance pool here. All mutations are scoped
   * per community regardless of what is passed.
   */
  maintenancePool?: Pool;
}

/** Configuration for the reconciliation sweep */
export interface ReconciliationConfig {
  /** NOWPayments API key */
  apiKey: string;
  /** API base URL */
  apiUrl: string;
  /** Minimum age before checking (prevents racing with webhooks) */
  minAgeMins: number;
  /**
   * Maximum work items processed per sweep, across ALL arms (non-terminal
   * poll, missed-mint recovery, Redis-adjustment drain). Honored exactly —
   * `batchSize: 1` means one item per sweep, never two.
   *
   * Slots are allocated by least-recently-serviced across arms, so a small
   * batch cannot let one arm monopolise the sweep (see SweepCandidate).
   */
  batchSize: number;
  /** Request timeout in ms */
  timeoutMs: number;
}

/**
 * One unit of work competing for a slot in the sweep's batch.
 *
 * FAIRNESS CONTRACT. Every arm exposes the same `fairnessKey`: the instant the
 * sweep last serviced that item (its creation time if never serviced). Slots go
 * to the globally-least-recently-serviced items, and servicing an item stamps
 * its key to NOW() *before* the work runs. Two properties follow:
 *
 *   1. No arm starves another. A standing backlog in one arm cannot consume
 *      every slot forever, because its rows rotate to the back of the global
 *      order as soon as they are serviced — including at `batchSize: 1`, where
 *      the single slot alternates instead of being permanently captured.
 *   2. No item starves within its arm. A permanently-failing "poison" row is
 *      stamped even when its processing throws, so it cannot re-win the head
 *      slot every sweep and block the rows behind it. It is still retried, just
 *      at the back of the rotation.
 *
 * Ties break on a stable secondary key so a given DB state always yields the
 * same batch — sweeps are deterministic and reproducible in tests.
 */
type SweepCandidate =
  | { kind: 'stuck'; fairnessKey: number; row: StuckRow }
  | { kind: 'missed_mint'; fairnessKey: number; row: MissedMintRow }
  | { kind: 'redis_adjustment'; fairnessKey: number; row: PendingAdjustmentRow };

interface StuckRow {
  payment_id: string;
  community_id: string;
  status: string;
  price_amount: number;
  order_id: string;
  fairness_key: string | Date;
}

interface MissedMintRow {
  payment_id: string;
  community_id: string;
  price_amount: number;
  order_id: string;
  status: string;
  fairness_key: string | Date;
}

interface PendingAdjustmentRow {
  lot_id: string;
  community_id: string;
  amount_cents: string;
  fairness_key: string | Date;
}

/** Arm precedence for the sweep's stable tie-break. */
const KIND_ORDER = { stuck: 0, missed_mint: 1, redis_adjustment: 2 } as const;

/** Stable secondary sort key for a candidate. */
function candidateId(c: SweepCandidate): string {
  return c.kind === 'redis_adjustment' ? c.row.lot_id : c.row.payment_id;
}

/** Normalize a Postgres timestamptz (Date or ISO string) to epoch millis. */
function toEpochMs(value: string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  // Unknown/absent cursor sorts oldest — never-serviced work wins the slot.
  return 0;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const DEFAULT_CONFIG: Omit<ReconciliationConfig, 'apiKey' | 'apiUrl'> = {
  minAgeMins: 10,
  batchSize: 50,
  timeoutMs: 15_000,
};

/** Terminal statuses that mean payment is done (success) */
const TERMINAL_SUCCESS = ['finished'];

/** Terminal statuses that mean payment failed */
const TERMINAL_FAILED = ['failed', 'expired', 'refunded'];

/**
 * Status rank — mirrors the Postgres crypto_payments_status_monotonicity
 * trigger (migration 0010). status_rank must strictly increase, so a
 * partially_paid row (rank 4) whose provider status is still confirming/
 * confirmed/sending (ranks 1-3) must NOT be written back: the trigger would
 * reject the backward UPDATE and the sweep would error every pass.
 */
const STATUS_RANK: Record<string, number> = {
  waiting: 0,
  confirming: 1,
  confirmed: 2,
  sending: 3,
  partially_paid: 4,
  finished: 5,
  expired: 6,
  failed: 7,
  refunded: 8,
};

// LOT_EXPIRY_DAYS imported from nowpayments-handler (single source of truth)

// --------------------------------------------------------------------------
// Sweep
// --------------------------------------------------------------------------

/**
 * Run the NOWPayments reconciliation sweep.
 *
 * Enumerates each arm's candidates (oldest cursor first, capped at batchSize),
 * merges them into one batch of exactly batchSize least-recently-serviced
 * items, stamps every selected item's rotation cursor, then processes them:
 *   - stuck            → poll the provider, persist only forward transitions,
 *                        mint if the provider now reports `finished`
 *   - missed_mint      → idempotent mint for a purchase that owes a lot
 *   - redis_adjustment → exactly-once Redis budget increment + acknowledgement
 *
 * @param pool - PostgreSQL connection pool used for all per-tenant mutations
 * @param redis - Redis client (null disables the outbox drain; mints still work)
 * @param config - Reconciliation configuration
 * @param options - Cross-tenant read authority for candidate enumeration
 * @returns Sweep result with metrics
 */
export async function runReconciliationSweep(
  pool: Pool,
  redis: Redis | null,
  config: ReconciliationConfig,
  options: ReconciliationSweepOptions = {},
): Promise<ReconciliationSweepResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Candidate ENUMERATION is inherently cross-community and therefore requires
  // a connection with cross-tenant read authority (BYPASSRLS or table owner).
  // That authority is an explicit, injectable input — NOT something inferred
  // from `pool`: a deployment running the sweep under the ordinary tenant role
  // must pass a maintenance pool here, and wiring it wrong fails loudly at the
  // enumeration query instead of silently returning zero rows.
  //
  // Every WRITE the enumeration leads to is separately re-scoped per community
  // via withCommunityScope, so this authority is read-only in effect.
  const maintenancePool = options.maintenancePool ?? pool;

  // batchSize is honored EXACTLY: it is the total across all arms, never a
  // per-arm allowance and never silently raised. Each arm offers up to
  // batchSize candidates; the merge below keeps only the batchSize
  // least-recently-serviced of them (see SweepCandidate for the fairness
  // contract that makes this starvation-free even at batchSize 1).
  const batchSize = Math.max(1, Math.floor(mergedConfig.batchSize));

  // Arm 1 — non-terminal payments whose provider status may have moved on.
  const stuckResult = await maintenancePool.query<StuckRow>(
    `SELECT p.payment_id, p.community_id, p.status, p.price_amount, p.order_id,
            COALESCE(c.last_checked_at, p.created_at) AS fairness_key
     FROM crypto_payments p
     LEFT JOIN crypto_payment_checks c ON c.payment_id = p.payment_id
     WHERE p.status IN ('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid')
       AND p.created_at < NOW() - $1 * INTERVAL '1 minute'
     ORDER BY COALESCE(c.last_checked_at, p.created_at) ASC, p.payment_id ASC
     LIMIT $2`,
    [mergedConfig.minAgeMins, batchSize],
  );

  // Arm 2 — purchases that owe a credit lot but will never be revisited by
  // arm 1 because the row is already terminal. Two sources:
  //   (a) status = 'finished' but the mint threw after the webhook acked.
  //   (b) status = 'failed'/'expired' while a SIGNED `finished` IPN is on
  //       record in webhook_events. A concurrent or late failure transition
  //       wins the status column (monotonicity ranks finished 5 below expired
  //       6 / failed 7, so it can never be corrected), but the customer paid
  //       and the credit is owed. The webhook_events row is durable proof:
  //       it is written only after HMAC verification.
  // The mint is idempotent on payment_id, so re-running either source is safe.
  const missedMintResult = await maintenancePool.query<MissedMintRow>(
    `SELECT p.payment_id, p.community_id, p.price_amount, p.order_id, p.status,
            COALESCE(c.last_checked_at, p.updated_at) AS fairness_key
     FROM crypto_payments p
     LEFT JOIN credit_lots l ON l.payment_id = p.payment_id
     LEFT JOIN crypto_payment_checks c ON c.payment_id = p.payment_id
     WHERE l.id IS NULL
       AND p.updated_at < NOW() - $1 * INTERVAL '1 minute'
       AND (
         p.status = 'finished'
         OR (
           p.status IN ('failed', 'expired')
           AND EXISTS (
             SELECT 1 FROM webhook_events w
             WHERE w.provider = 'nowpayments'
               AND w.event_id = p.payment_id || ':finished'
           )
         )
       )
     ORDER BY COALESCE(c.last_checked_at, p.updated_at) ASC, p.payment_id ASC
     LIMIT $2`,
    [mergedConfig.minAgeMins, batchSize],
  );

  // Arm 3 — durable Redis-adjustment outbox: mints whose budget INCRBY failed
  // (or was deferred because Redis was down) are retried until the credit
  // lands exactly once. The apply is idempotent (atomic marker+INCRBY), so a
  // race with the inline webhook apply is safe. Only runs when Redis is up.
  const pendingAdjResult = redis
    ? await maintenancePool.query<PendingAdjustmentRow>(
        `SELECT lot_id, community_id, amount_cents,
                COALESCE(last_attempt_at, created_at) AS fairness_key
         FROM pending_redis_credit_adjustments
         WHERE applied_at IS NULL
         ORDER BY COALESCE(last_attempt_at, created_at) ASC, lot_id ASC
         LIMIT $1`,
        [batchSize],
      )
    : { rows: [] as PendingAdjustmentRow[] };

  // Merge the arms and keep the batchSize least-recently-serviced items.
  // Ties break on kind then id so an identical DB state always produces an
  // identical batch.
  const batch: SweepCandidate[] = [
    ...stuckResult.rows.map((row: StuckRow): SweepCandidate => ({
      kind: 'stuck', fairnessKey: toEpochMs(row.fairness_key), row,
    })),
    ...missedMintResult.rows.map((row: MissedMintRow): SweepCandidate => ({
      kind: 'missed_mint', fairnessKey: toEpochMs(row.fairness_key), row,
    })),
    ...pendingAdjResult.rows.map((row: PendingAdjustmentRow): SweepCandidate => ({
      kind: 'redis_adjustment', fairnessKey: toEpochMs(row.fairness_key), row,
    })),
  ]
    .sort(
      (a: SweepCandidate, b: SweepCandidate) =>
        a.fairnessKey - b.fairnessKey ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        candidateId(a).localeCompare(candidateId(b)),
    )
    .slice(0, batchSize);

  // Stamp every selected item's rotation cursor to NOW() BEFORE doing the work,
  // so an item that errors (or stays pending) still rotates to the back of the
  // global order. Without the pre-stamp, one permanently-failing row would
  // re-win the head slot every sweep and block everything behind it.
  //
  // Both cursor tables carry forced tenant RLS, so writes are grouped by
  // community and each group runs inside withCommunityScope. A single
  // cross-community write would either trip the strict
  // app.current_community_id() guard or silently write nothing.
  const { stamped, errors: stampErrors } = await stampRotationCursors(pool, batch);

  const result: ReconciliationSweepResult = {
    paymentsChecked: 0,
    recoveredCount: 0,
    failedCount: 0,
    pendingCount: 0,
    errorCount: stampErrors.length,
    redisAdjustmentsApplied: 0,
    details: [...stampErrors],
  };

  for (const candidate of stamped) {
    if (candidate.kind === 'stuck') {
      const payment = candidate.row;
      result.paymentsChecked++;
      try {
        const detail = await reconcilePayment(pool, redis, payment, mergedConfig);
        result.details.push(detail);

        switch (detail.action) {
          case 'recovered': result.recoveredCount++; break;
          case 'failed':
          case 'expired': result.failedCount++; break;
          case 'pending': result.pendingCount++; break;
          case 'error': result.errorCount++; break;
        }
      } catch (err) {
        result.errorCount++;
        result.details.push({
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          previousStatus: payment.status,
          newStatus: null,
          action: 'error',
          error: (err as Error).message,
        });
      }
      continue;
    }

    if (candidate.kind === 'missed_mint') {
      const payment = candidate.row;
      result.paymentsChecked++;
      try {
        const lotId = await mintMissedLot(pool, redis, payment);
        result.recoveredCount++;
        result.details.push({
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          previousStatus: payment.status,
          newStatus: payment.status,
          action: 'recovered',
          lotId,
        });
      } catch (err) {
        result.errorCount++;
        result.details.push({
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          previousStatus: payment.status,
          newStatus: null,
          action: 'error',
          error: (err as Error).message,
        });
      }
      continue;
    }

    const adj = candidate.row;
    try {
      // Apply + acknowledge inside the adjustment's own tenant scope: the
      // outbox table has forced RLS, and scoping per row also makes a
      // cross-tenant acknowledgement impossible.
      const applied = await withCommunityScope(adj.community_id, pool, (client) =>
        applyRedisCreditAdjustment(redis as Redis, client, {
          lotId: adj.lot_id,
          communityId: adj.community_id,
          amountCents: BigInt(adj.amount_cents),
        }),
      );
      if (applied) result.redisAdjustmentsApplied++;
    } catch (err) {
      result.errorCount++;
      result.details.push({
        paymentId: adj.lot_id,
        communityId: adj.community_id,
        previousStatus: 'finished',
        newStatus: null,
        action: 'error',
        error: (err as Error).message,
      });
    }
  }

  return result;
}

/**
 * Stamp the rotation cursor of every selected item, grouped by community and
 * written inside that community's RLS scope. Runs before any processing so a
 * failing item still rotates.
 *
 * A community whose stamp fails is DROPPED from the batch rather than
 * processed. Two reasons, both about blast radius: a failure here means that
 * tenant's scope is unusable (RLS misconfiguration, connection loss), so its
 * work would fail anyway; and processing without a stamp would let those items
 * re-win the head slot next sweep — exactly the starvation the pre-stamp
 * exists to prevent. One broken tenant must never stop every other tenant's
 * recovery, so the failure is isolated per community, not thrown.
 *
 * @returns the batch minus any items whose cursor could not be stamped, plus
 *   one error detail per failed community.
 */
async function stampRotationCursors(
  pool: Pool,
  batch: SweepCandidate[],
): Promise<{ stamped: SweepCandidate[]; errors: PaymentReconciliationDetail[] }> {
  const paymentsByCommunity = new Map<string, string[]>();
  const lotsByCommunity = new Map<string, string[]>();

  for (const candidate of batch) {
    const target = candidate.kind === 'redis_adjustment' ? lotsByCommunity : paymentsByCommunity;
    const key = candidate.row.community_id;
    const ids = target.get(key) ?? [];
    ids.push(candidate.kind === 'redis_adjustment' ? candidate.row.lot_id : candidate.row.payment_id);
    target.set(key, ids);
  }

  const errors: PaymentReconciliationDetail[] = [];
  /** `${kind === 'redis_adjustment' ? 'adj' : 'pay'}:${communityId}` */
  const failedGroups = new Set<string>();

  const stamp = async (
    group: 'pay' | 'adj',
    communityId: string,
    sql: string,
    params: unknown[],
  ): Promise<void> => {
    try {
      await withCommunityScope(communityId, pool, (client) => client.query(sql, params));
    } catch (err) {
      failedGroups.add(`${group}:${communityId}`);
      errors.push({
        paymentId: '',
        communityId,
        previousStatus: '',
        newStatus: null,
        action: 'error',
        error: `rotation cursor stamp failed, work skipped this sweep: ${(err as Error).message}`,
      });
    }
  };

  for (const [communityId, paymentIds] of paymentsByCommunity) {
    await stamp(
      'pay',
      communityId,
      `INSERT INTO crypto_payment_checks (payment_id, community_id)
       SELECT unnest($1::text[]), $2::uuid
       ON CONFLICT (payment_id) DO UPDATE SET last_checked_at = NOW()`,
      [paymentIds, communityId],
    );
  }

  for (const [communityId, lotIds] of lotsByCommunity) {
    // attempts is bumped by applyRedisCreditAdjustment (which also runs on the
    // inline webhook path); this write only advances the rotation cursor.
    await stamp(
      'adj',
      communityId,
      `UPDATE pending_redis_credit_adjustments
       SET last_attempt_at = NOW()
       WHERE lot_id = ANY($1::uuid[]) AND applied_at IS NULL`,
      [lotIds],
    );
  }

  const stamped = failedGroups.size === 0
    ? batch
    : batch.filter((c) => !failedGroups.has(
        `${c.kind === 'redis_adjustment' ? 'adj' : 'pay'}:${c.row.community_id}`,
      ));

  return { stamped, errors };
}

/**
 * Idempotently mint the credit lot a terminal payment still owes.
 *
 * With Redis: processPaymentForLedger mints and applies the budget increment,
 * enqueuing the durable outbox row in the mint transaction so a failed INCRBY
 * is retried by arm 3. Without Redis: Postgres-only mint with the same
 * outbox row enqueued in the same transaction — no lost purchased credit.
 */
async function mintMissedLot(
  pool: Pool,
  redis: Redis | null,
  payment: MissedMintRow,
): Promise<string | null> {
  if (redis) {
    const lotResult = await processPaymentForLedger(pool, redis, {
      paymentId: payment.payment_id,
      communityId: payment.community_id,
      priceUsd: payment.price_amount,
      orderId: payment.order_id,
    });
    return lotResult.lotId;
  }

  const amountMicro = usdToMicroSafe(payment.price_amount);
  const expiresAt = new Date(Date.now() + LOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return withCommunityScope(payment.community_id, pool, async (client) => {
    const id = await mintCreditLot(client, {
      community_id: payment.community_id,
      source: 'purchase',
      amount_micro: amountMicro,
      payment_id: payment.payment_id,
      expires_at: expiresAt,
    });
    if (id) {
      await enqueueRedisCreditAdjustment(client, {
        lotId: id,
        communityId: payment.community_id,
        amountCents: amountMicro / MICRO_PER_CENT,
      });
    }
    return id;
  });
}

/**
 * Reconcile a single stuck payment.
 */
async function reconcilePayment(
  pool: Pool,
  redis: Redis | null,
  payment: {
    payment_id: string;
    community_id: string;
    status: string;
    price_amount: number;
    order_id: string;
  },
  config: ReconciliationConfig,
): Promise<PaymentReconciliationDetail> {
  // Step 1: Poll NOWPayments API
  const apiStatus = await pollNowpaymentsStatus(
    payment.payment_id,
    config,
  );

  if (!apiStatus) {
    return {
      paymentId: payment.payment_id,
      communityId: payment.community_id,
      previousStatus: payment.status,
      newStatus: null,
      action: 'error',
      error: 'NOWPayments API returned null',
    };
  }

  const providerStatus = apiStatus.payment_status;

  // credit_lots and crypto_payments both carry forced tenant RLS (migrations
  // 0009/0010). This payment belongs to exactly one community, so every read
  // and write below runs inside that community's scope — required whenever the
  // sweep's main pool is the ordinary tenant role (the case maintenancePool
  // exists to support), and harmless when it is privileged.
  const scoped = <T extends import('pg').QueryResultRow>(
    sql: string,
    params: unknown[],
  ): Promise<import('pg').QueryResult<T>> =>
    withCommunityScope(payment.community_id, pool, (client) => client.query<T>(sql, params));

  // Step 2: Check if status has changed
  if (providerStatus === payment.status) {
    return {
      paymentId: payment.payment_id,
      communityId: payment.community_id,
      previousStatus: payment.status,
      newStatus: null,
      action: 'pending',
    };
  }

  // Step 3: Handle terminal success (finished) — check for missed lot
  if (TERMINAL_SUCCESS.includes(providerStatus)) {
    // Check if credit lot already exists for this payment
    const existingLot = await scoped<{ id: string }>(
      `SELECT id FROM credit_lots WHERE payment_id = $1`,
      [payment.payment_id],
    );

    let lotId: string | null = null;

    if (existingLot.rows.length === 0) {
      if (redis) {
        // Missed webhook — full mint with Redis budget adjustment
        const lotResult = await processPaymentForLedger(pool, redis, {
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          priceUsd: apiStatus.price_amount,
          orderId: apiStatus.order_id,
        });
        lotId = lotResult.lotId;
      } else {
        // Redis unavailable — Postgres-only mint with the budget adjustment
        // durably enqueued in the same transaction; the outbox drain applies it
        // once Redis returns (no lost purchased credit).
        const amountMicro = usdToMicroSafe(apiStatus.price_amount);
        const expiresAt = new Date(Date.now() + LOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        // Use withCommunityScope for standardized BEGIN/SET LOCAL/COMMIT (Sprint 1, Task 1.1)
        lotId = await withCommunityScope(payment.community_id, pool, async (client) => {
          const id = await mintCreditLot(client, {
            community_id: payment.community_id,
            source: 'purchase',
            amount_micro: amountMicro,
            payment_id: payment.payment_id,
            expires_at: expiresAt,
          });
          if (id) {
            await enqueueRedisCreditAdjustment(client, {
              lotId: id,
              communityId: payment.community_id,
              amountCents: amountMicro / MICRO_PER_CENT,
            });
          }
          return id;
        });
      }
    }

    // Update payment status
    await scoped(
      `UPDATE crypto_payments
       SET status = $2, actually_paid = $3, finished_at = NOW(), updated_at = NOW()
       WHERE payment_id = $1`,
      [payment.payment_id, providerStatus, apiStatus.actually_paid],
    );

    return {
      paymentId: payment.payment_id,
      communityId: payment.community_id,
      previousStatus: payment.status,
      newStatus: providerStatus,
      action: 'recovered',
      lotId,
    };
  }

  // Step 4: Handle terminal failure
  if (TERMINAL_FAILED.includes(providerStatus)) {
    await scoped(
      `UPDATE crypto_payments SET status = $2, updated_at = NOW() WHERE payment_id = $1`,
      [payment.payment_id, providerStatus],
    );

    return {
      paymentId: payment.payment_id,
      communityId: payment.community_id,
      previousStatus: payment.status,
      newStatus: providerStatus,
      action: providerStatus === 'expired' ? 'expired' : 'failed',
    };
  }

  // Step 5: Non-terminal status update (e.g. confirming → confirmed).
  // Only persist a FORWARD transition — mirror the DB monotonicity trigger.
  // A partially_paid row (rank 4) whose provider status is still confirming/
  // confirmed/sending (ranks 1-3) is a backward rank; skip it (leave pending)
  // so the trigger never rejects the UPDATE and the sweep never errors on it.
  // A terminal provider status is already handled by Steps 3-4 above.
  if ((STATUS_RANK[providerStatus] ?? -1) <= (STATUS_RANK[payment.status] ?? -1)) {
    return {
      paymentId: payment.payment_id,
      communityId: payment.community_id,
      previousStatus: payment.status,
      newStatus: null,
      action: 'pending',
    };
  }

  await scoped(
    `UPDATE crypto_payments SET status = $2, updated_at = NOW() WHERE payment_id = $1`,
    [payment.payment_id, providerStatus],
  );

  return {
    paymentId: payment.payment_id,
    communityId: payment.community_id,
    previousStatus: payment.status,
    newStatus: providerStatus,
    action: 'pending',
  };
}

/**
 * Poll NOWPayments API for payment status.
 *
 * @param paymentId - NOWPayments payment ID
 * @param config - API configuration
 * @returns Payment status response or null on error
 */
async function pollNowpaymentsStatus(
  paymentId: string,
  config: ReconciliationConfig,
): Promise<NowpaymentsStatusResponse | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.apiUrl}/payment/${paymentId}`, {
      method: 'GET',
      headers: {
        'x-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as NowpaymentsStatusResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
