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
import { processPaymentForLedger } from './nowpayments-handler.js';
import { mintCreditLot } from './credit-lot-service.js';

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
  /** Maximum payments to process per sweep */
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

/** Credit lot expiry for recovered payments (matches nowpayments-handler) */
const LOT_EXPIRY_DAYS = 90;

// --------------------------------------------------------------------------
// Sweep
// --------------------------------------------------------------------------

/**
 * Run the NOWPayments reconciliation sweep.
 *
 * Queries crypto_payments WHERE status IN ('waiting', 'confirming')
 * AND created_at < now() - minAgeMins. For each:
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

  // Query stuck payments from PostgreSQL
  const stuckResult = await pool.query<{
    payment_id: string;
    community_id: string;
    status: string;
    price_amount: number;
    order_id: string;
  }>(
    `SELECT payment_id, community_id, status, price_amount, order_id
     FROM crypto_payments
     WHERE status IN ('waiting', 'confirming', 'confirmed', 'sending')
       AND created_at < NOW() - $1 * INTERVAL '1 minute'
     ORDER BY created_at ASC
     LIMIT $2`,
    [mergedConfig.minAgeMins, mergedConfig.batchSize],
  );

  const result: ReconciliationSweepResult = {
    paymentsChecked: stuckResult.rows.length,
    recoveredCount: 0,
    failedCount: 0,
    pendingCount: 0,
    errorCount: 0,
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
        // Redis unavailable — Postgres-only mint, budget adjustment deferred
        // Conservation guard reconciliation will correct Redis on recovery
        const amountMicro = BigInt(Math.round(apiStatus.price_amount * 1_000_000));
        const expiresAt = new Date(Date.now() + LOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SET LOCAL app.community_id = $1', [payment.community_id]);
          lotId = await mintCreditLot(client, {
            community_id: payment.community_id,
            source: 'purchase',
            amount_micro: amountMicro,
            payment_id: payment.payment_id,
            expires_at: expiresAt,
          });
          await client.query('COMMIT');
        } catch (mintErr) {
          await client.query('ROLLBACK');
          throw mintErr;
        } finally {
          client.release();
        }
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

  // Step 5: Non-terminal status update (e.g. confirming → confirmed)
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
