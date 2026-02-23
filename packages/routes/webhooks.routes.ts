/**
 * Webhook Routes — NOWPayments IPN Handler
 *
 * POST /webhooks/nowpayments — HMAC-SHA512 verified webhook
 *
 * Security:
 *   - HMAC-SHA512 signature verification via x-nowpayments-sig header
 *   - 401 on invalid/missing signature (NOT 200 — per acceptance criteria)
 *   - 200 for all valid signatures (including duplicates)
 *   - Feature flag: FEATURE_BILLING_ENABLED must be true
 *   - Webhook rate limiting: 100 req/min per IP, 1KB max payload
 *
 * Idempotency:
 *   - INSERT INTO webhook_events ON CONFLICT DO NOTHING (dedup)
 *   - INSERT INTO credit_lots ON CONFLICT (payment_id) DO NOTHING
 *   - Redis INCRBY only if credit_lots INSERT returned id
 *
 * @see nowpayments-handler.ts for credit lot minting
 * @see Sprint 2, Task 2.1 (F-16, F-17, F-18)
 * @module packages/routes/webhooks.routes
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { processPaymentForLedger, verifyPaymentExists } from '../services/nowpayments-handler.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Minimal logger interface (avoids hard dependency on project logger) */
interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** NOWPayments IPN webhook payload */
interface NowpaymentsWebhookPayload {
  payment_id: number | string;
  payment_status: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  order_description?: string;
  actually_paid: number;
  created_at?: string;
  updated_at?: string;
}

/** Status ordinal for monotonicity enforcement */
const STATUS_ORDINAL: Record<string, number> = {
  waiting: 0,
  confirming: 1,
  confirmed: 2,
  sending: 3,
  partially_paid: 1, // Same level as confirming
  finished: 4,
  failed: 5,
  refunded: 5,
  expired: 5,
};

/** Dependencies injected at server init */
interface WebhookDeps {
  pool: Pool;
  redis: Redis;
  ipnSecret: string;
  logger: Logger;
  featureBillingEnabled: boolean;
}

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------

export function createWebhookRouter(deps: WebhookDeps): Router {
  const router = Router();
  const { pool, redis, ipnSecret, logger, featureBillingEnabled } = deps;

  /**
   * POST /webhooks/nowpayments — NOWPayments IPN callback
   *
   * Expects raw JSON body and x-nowpayments-sig HMAC-SHA512 header.
   * Raw body middleware must be configured upstream.
   */
  router.post('/nowpayments', async (req: Request, res: Response) => {
    // Feature flag gate
    if (!featureBillingEnabled) {
      res.status(503).json({ status: 'disabled', reason: 'billing_not_enabled' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 1: HMAC-SHA512 signature verification
    // -------------------------------------------------------------------
    const signature = req.headers['x-nowpayments-sig'] as string | undefined;

    if (!signature || !ipnSecret) {
      logger.warn(
        { hasSignature: !!signature, hasSecret: !!ipnSecret },
        'Missing webhook signature or IPN secret',
      );
      res.status(401).json({ status: 'rejected', reason: 'missing_signature' });
      return;
    }

    // Use raw body for HMAC computation (must be configured via middleware)
    const rawBody = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(sortKeys(req.body));

    const computedSig = createHmac('sha512', ipnSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison
    if (!timingSafeCompare(computedSig, signature)) {
      logger.warn(
        { paymentId: req.body?.payment_id },
        'Invalid NOWPayments webhook signature',
      );
      res.status(401).json({ status: 'rejected', reason: 'invalid_signature' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 2: Parse and validate payload
    // -------------------------------------------------------------------
    const payload = req.body as NowpaymentsWebhookPayload;
    const paymentId = String(payload.payment_id);

    if (!paymentId || !payload.payment_status) {
      res.status(200).json({ status: 'ignored', reason: 'invalid_payload' });
      return;
    }

    // Log timestamp age as metric only (NOT used for rejection per AC)
    if (payload.updated_at) {
      const ageMs = Date.now() - new Date(payload.updated_at).getTime();
      logger.info(
        { paymentId, ageMs, status: payload.payment_status },
        'Webhook timestamp age (metric only)',
      );
    }

    // -------------------------------------------------------------------
    // Step 3: Idempotent webhook_events INSERT (dedup)
    // -------------------------------------------------------------------
    try {
      const dedupResult = await pool.query<{ id: string }>(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload, processed_at)
         VALUES ('nowpayments', $1, $2, $3, NOW())
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [paymentId, payload.payment_status, JSON.stringify(payload)],
      );

      if (dedupResult.rows.length === 0) {
        // Duplicate webhook — already processed
        logger.info({ paymentId }, 'Duplicate webhook (already in webhook_events)');
        res.status(200).json({ status: 'duplicate' });
        return;
      }
    } catch (err) {
      logger.error({ paymentId, err }, 'Failed to insert webhook_events');
      // Return 200 so NOWPayments doesn't retry on our DB errors
      res.status(200).json({ status: 'error', reason: 'internal' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 4: Verify payment exists (Flatline IMP-009)
    // -------------------------------------------------------------------
    const existingPayment = await verifyPaymentExists(pool, paymentId);

    if (!existingPayment) {
      logger.warn({ paymentId }, 'Webhook for unknown payment (no crypto_payments row)');
      res.status(200).json({ status: 'ignored', reason: 'unknown_payment' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 5: Status monotonicity check
    // -------------------------------------------------------------------
    const currentOrdinal = STATUS_ORDINAL[payload.payment_status] ?? -1;

    // Query current status from crypto_payments
    const statusResult = await pool.query<{ status: string }>(
      `SELECT status FROM crypto_payments WHERE payment_id = $1`,
      [paymentId],
    );

    if (statusResult.rows.length > 0) {
      const existingOrdinal = STATUS_ORDINAL[statusResult.rows[0].status] ?? -1;

      // Allow failed/refunded/expired from any non-terminal state
      const isTerminalTransition = ['failed', 'refunded', 'expired'].includes(payload.payment_status);
      const isTerminalCurrent = ['finished', 'failed', 'refunded', 'expired'].includes(statusResult.rows[0].status);

      if (isTerminalCurrent) {
        logger.info({ paymentId, current: statusResult.rows[0].status, incoming: payload.payment_status },
          'Payment already in terminal state');
        res.status(200).json({ status: 'skipped', reason: 'terminal_state' });
        return;
      }

      if (!isTerminalTransition && currentOrdinal <= existingOrdinal) {
        logger.info(
          { paymentId, current: statusResult.rows[0].status, incoming: payload.payment_status },
          'Backward status transition rejected (monotonicity)',
        );
        res.status(200).json({ status: 'skipped', reason: 'backward_transition' });
        return;
      }
    }

    // -------------------------------------------------------------------
    // Step 6: Update crypto_payments status
    // -------------------------------------------------------------------
    const isFinished = payload.payment_status === 'finished';

    await pool.query(
      `UPDATE crypto_payments
       SET status = $2,
           actually_paid = COALESCE($3, actually_paid),
           finished_at = CASE WHEN $4 THEN NOW() ELSE finished_at END,
           updated_at = NOW()
       WHERE payment_id = $1`,
      [paymentId, payload.payment_status, payload.actually_paid, isFinished],
    );

    // -------------------------------------------------------------------
    // Step 7: Mint credit lot if finished (idempotent)
    // -------------------------------------------------------------------
    if (isFinished) {
      try {
        const lotResult = await processPaymentForLedger(pool, redis, {
          paymentId,
          communityId: existingPayment.community_id,
          priceUsd: existingPayment.price_amount,
          orderId: payload.order_id,
        });

        logger.info({
          paymentId,
          lotId: lotResult.lotId,
          minted: lotResult.minted,
          redisAdjusted: lotResult.redisAdjusted,
          amountMicro: lotResult.amountUsdMicro.toString(),
        }, 'NOWPayments webhook: credit lot processing complete');
      } catch (err) {
        // Lot minting failure should not fail the webhook response.
        // Reconciliation sweep will catch missed mints.
        logger.error({ paymentId, err }, 'Credit lot minting failed — will retry via reconciliation');
      }
    }

    // -------------------------------------------------------------------
    // Step 8: Audit log
    // -------------------------------------------------------------------
    try {
      await pool.query(
        `INSERT INTO billing_audit_log (event_type, payload, community_id, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [
          isFinished ? 'nowpayments_payment_completed' : `nowpayments_status_${payload.payment_status}`,
          JSON.stringify({
            payment_id: paymentId,
            status: payload.payment_status,
            actually_paid: payload.actually_paid,
            pay_currency: payload.pay_currency,
            price_amount: payload.price_amount,
          }),
          existingPayment.community_id,
        ],
      );
    } catch {
      // Audit log failure is non-blocking
    }

    res.status(200).json({ status: 'processed' });
  });

  return router;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Sort object keys recursively for canonical HMAC computation.
 * NOWPayments signs over JSON with sorted keys.
 */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Constant-time string comparison using timingSafeEqual.
 * Returns false for different-length strings without timing leak.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
