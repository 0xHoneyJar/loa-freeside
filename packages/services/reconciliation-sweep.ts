/**
 * NOWPayments Reconciliation Sweep — Missed Webhook Recovery
 *
 * EventBridge scheduled task (every 5 minutes) that polls NOWPayments API
 * for stuck payments and triggers idempotent credit lot minting for
 * missed webhooks.
 *
 * Operates independently of Redis availability — all queries are
 * PostgreSQL-first with Redis adjustment as best-effort.
 *
 * @see Sprint 2, Task 2.2 (F-19)
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

/** Configuration for the reconciliation sweep */
export interface ReconciliationConfig {
  /** NOWPayments API key */
  apiKey: string;
  /** API base URL */
  apiUrl: string;
  /** Minimum age before checking (prevents racing with webhooks) */
  minAgeMins: number;
  /**
   * Maximum payments to process per sweep, across both the non-terminal and
   * missed-mint arms. Effective floor is 2: the two arms each need a slot, so a
   * value of 1 is treated as 2 (one per arm) to keep either arm from starving
   * the other. Set >= 2 for the cap to apply exactly.
   */
  batchSize: number;
  /** Request timeout in ms */
  timeoutMs: number;
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
 * Queries crypto_payments for every non-terminal status — including
 * partially_paid, which can still receive a delayed `finished` webhook that
 * the freshness gate quarantines — AND created_at < now() - minAgeMins.
 * For each:
 *   1. Poll NOWPayments API for current status
 *   2. If finished + no credit_lots row: trigger idempotent mint
 *   3. If failed/expired: update crypto_payments status
 *
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client (best-effort for budget adjustment)
 * @param config - Reconciliation configuration
 * @returns Sweep result with metrics
 */
export async function runReconciliationSweep(
  pool: Pool,
  redis: Redis | null,
  config: ReconciliationConfig,
): Promise<ReconciliationSweepResult> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Split the batch between the two arms so a persistent backlog of stuck
  // non-terminal payments can NEVER starve the missed-mint recovery arm below.
  // The stuck arm is capped to ceil(batch/2); the missed-mint arm then always
  // has >= floor(batch/2) capacity. The effective batch floors at 2 so that
  // even batchSize:1 gives each arm one slot — a single shared slot would
  // otherwise be consumed entirely by whichever arm has a standing backlog,
  // starving the other on every sweep.
  const effectiveBatch = Math.max(2, mergedConfig.batchSize);
  const stuckLimit = Math.max(1, Math.ceil(effectiveBatch / 2));

  // Query stuck payments from PostgreSQL, least-recently-checked first.
  // The crypto_payment_checks sidecar (migration 0020) records when each row
  // was last polled; ordering by it (NULLS FIRST = never-checked wins) rotates
  // the capped half-batch through the whole backlog instead of refilling it
  // with the same oldest rows every sweep, which would starve newer payments.
  const stuckResult = await pool.query<{
    payment_id: string;
    community_id: string;
    status: string;
    price_amount: number;
    order_id: string;
  }>(
    `SELECT p.payment_id, p.community_id, p.status, p.price_amount, p.order_id
     FROM crypto_payments p
     LEFT JOIN crypto_payment_checks c ON c.payment_id = p.payment_id
     WHERE p.status IN ('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid')
       AND p.created_at < NOW() - $1 * INTERVAL '1 minute'
     ORDER BY c.last_checked_at ASC NULLS FIRST, p.created_at ASC
     LIMIT $2`,
    [mergedConfig.minAgeMins, stuckLimit],
  );

  // Stamp every fetched row's check cursor to NOW() so it rotates to the back
  // of the queue next sweep — even if the poll below errors or leaves it
  // pending. Trigger-free sidecar write; the monotonicity guard is untouched.
  if (stuckResult.rows.length > 0) {
    await pool.query(
      `INSERT INTO crypto_payment_checks (payment_id, community_id)
       SELECT unnest($1::text[]), unnest($2::uuid[])
       ON CONFLICT (payment_id) DO UPDATE SET last_checked_at = NOW()`,
      [
        stuckResult.rows.map((r) => r.payment_id),
        stuckResult.rows.map((r) => r.community_id),
      ],
    );
  }

  const result: ReconciliationSweepResult = {
    paymentsChecked: stuckResult.rows.length,
    recoveredCount: 0,
    failedCount: 0,
    pendingCount: 0,
    errorCount: 0,
    redisAdjustmentsApplied: 0,
    details: [],
  };

  for (const payment of stuckResult.rows) {
    try {
      const detail = await reconcilePayment(
        pool,
        redis,
        payment,
        mergedConfig,
      );
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
  }

  // -------------------------------------------------------------------------
  // Missed mints on already-terminal rows: when the webhook marked the
  // payment 'finished' but processPaymentForLedger threw afterwards, the
  // handler acked 200 and the row is terminal — the non-terminal sweep above
  // never sees it again. Recover: finished payments with no credit_lots row
  // get an idempotent mint (no API poll needed; the status is known).
  // -------------------------------------------------------------------------
  // batchSize is the max payments per sweep across BOTH arms — cap this arm to
  // the capacity the non-terminal arm left, so a backlog can't double the
  // configured DB/Redis/mint workload in one run.
  const missedMintLimit = Math.max(0, effectiveBatch - stuckResult.rows.length);
  const missedMintResult = missedMintLimit === 0
    ? { rows: [] as Array<{ payment_id: string; community_id: string; price_amount: number; order_id: string }> }
    : await pool.query<{
        payment_id: string;
        community_id: string;
        price_amount: number;
        order_id: string;
      }>(
        `SELECT p.payment_id, p.community_id, p.price_amount, p.order_id
         FROM crypto_payments p
         LEFT JOIN credit_lots l ON l.payment_id = p.payment_id
         WHERE p.status = 'finished'
           AND l.id IS NULL
           AND p.updated_at < NOW() - $1 * INTERVAL '1 minute'
         ORDER BY p.updated_at ASC
         LIMIT $2`,
        [mergedConfig.minAgeMins, missedMintLimit],
      );

  for (const payment of missedMintResult.rows) {
    result.paymentsChecked++;
    try {
      if (redis) {
        const lotResult = await processPaymentForLedger(pool, redis, {
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          priceUsd: payment.price_amount,
          orderId: payment.order_id,
        });
        result.recoveredCount++;
        result.details.push({
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          previousStatus: 'finished',
          newStatus: 'finished',
          action: 'recovered',
          lotId: lotResult.lotId,
        });
      } else {
        // Redis unavailable — Postgres-only mint, with the Redis adjustment
        // durably enqueued in the SAME transaction so the outbox drain below
        // applies it once Redis returns (no lost purchased credit).
        const amountMicro = usdToMicroSafe(payment.price_amount);
        const expiresAt = new Date(Date.now() + LOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const lotId = await withCommunityScope(payment.community_id, pool, async (client) => {
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
        result.recoveredCount++;
        result.details.push({
          paymentId: payment.payment_id,
          communityId: payment.community_id,
          previousStatus: 'finished',
          newStatus: 'finished',
          action: 'recovered',
          lotId,
        });
      }
    } catch (err) {
      result.errorCount++;
      result.details.push({
        paymentId: payment.payment_id,
        communityId: payment.community_id,
        previousStatus: 'finished',
        newStatus: null,
        action: 'error',
        error: (err as Error).message,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Drain the durable Redis-adjustment outbox: mints whose INCRBY failed (or
  // was deferred because Redis was down) are retried here until the credit
  // lands exactly once. The apply is idempotent (atomic marker+INCRBY), so a
  // race with the inline webhook apply is safe. Only runs when Redis is up.
  //
  // Order oldest-created first (NOT least-recently-attempted): a NULLS-FIRST
  // last_attempt_at order would let a sustained stream of fresh never-attempted
  // rows perpetually jump ahead of older failed rows and starve them. FIFO by
  // created_at guarantees every purchase is eventually credited.
  // -------------------------------------------------------------------------
  if (redis) {
    const pendingAdj = await pool.query<{
      lot_id: string;
      community_id: string;
      amount_cents: string;
    }>(
      `SELECT lot_id, community_id, amount_cents
       FROM pending_redis_credit_adjustments
       WHERE applied_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1`,
      [mergedConfig.batchSize],
    );

    for (const adj of pendingAdj.rows) {
      try {
        const applied = await applyRedisCreditAdjustment(redis, pool, {
          lotId: adj.lot_id,
          communityId: adj.community_id,
          amountCents: BigInt(adj.amount_cents),
        });
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
  }

  return result;
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
    const existingLot = await pool.query<{ id: string }>(
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
    await pool.query(
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
    await pool.query(
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

  await pool.query(
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
