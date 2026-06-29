/**
 * Webhook Routes — NOWPayments IPN Handler
 *
 * POST /webhooks/nowpayments — HMAC-SHA512 verified webhook
 *
 * Security:
 *   - HMAC-SHA512 signature verification via x-nowpayments-sig header
 *   - 401 on invalid/missing signature (NOT 200 — per acceptance criteria)
 *   - Requires exact raw body; reconstructed JSON is never signed
 *   - Feature flag: FEATURE_BILLING_ENABLED must be true
 *   - Webhook rate limiting: 100 req/min per IP, 1KB max payload
 *
 * Idempotency:
 *   - webhook_events records receipt only; duplicates continue through idempotent processing
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

const MAX_WEBHOOK_AGE_MS = 24 * 60 * 60 * 1000;

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
    const signature = normalizeSingleHeader(req.headers['x-nowpayments-sig']);

    if (!signature || !ipnSecret) {
      logger.warn(
        { hasSignature: !!signature, hasSecret: !!ipnSecret },
        'Missing webhook signature or IPN secret',
      );
      res.status(401).json({ status: 'rejected', reason: 'missing_signature' });
      return;
    }

    // HMAC must use the exact raw body bytes provided to Express raw/text middleware.
    // Reconstructing JSON changes byte order/spacing and can verify a different message.
    let rawBody: string | Buffer;
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      rawBody = req.body;
    } else {
      logger.error(
        { bodyType: typeof req.body, hasBody: req.body !== undefined },
        'NOWPayments webhook raw body missing — refusing reconstructed HMAC',
      );
      res.status(400).json({ status: 'rejected', reason: 'missing_raw_body' });
      return;
    }

    const computedSig = createHmac('sha512', ipnSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison
    if (!timingSafeCompare(computedSig, signature)) {
      logger.warn(
        { rawBodyLength: rawBody.length },
        'Invalid NOWPayments webhook signature',
      );
      res.status(401).json({ status: 'rejected', reason: 'invalid_signature' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 2: Parse and validate payload
    // -------------------------------------------------------------------
    const rawJson = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    let payload: NowpaymentsWebhookPayload;
    try {
      payload = JSON.parse(rawJson) as NowpaymentsWebhookPayload;
    } catch (err) {
      logger.warn({ err }, 'Signed NOWPayments webhook body is not valid JSON');
      res.status(400).json({ status: 'rejected', reason: 'invalid_json' });
      return;
    }

    const paymentId = String(payload.payment_id);

    if (!paymentId || !payload.payment_status) {
      res.status(200).json({ status: 'ignored', reason: 'invalid_payload' });
      return;
    }

    if (payload.updated_at) {
      const updatedAtMs = new Date(payload.updated_at).getTime();
      if (!Number.isFinite(updatedAtMs)) {
        res.status(400).json({ status: 'rejected', reason: 'invalid_updated_at' });
        return;
      }
      const ageMs = Date.now() - updatedAtMs;
      logger.info(
        { paymentId, ageMs, status: payload.payment_status },
        'Webhook timestamp age',
      );
      if (ageMs > MAX_WEBHOOK_AGE_MS) {
        logger.warn({ paymentId, ageMs }, 'Stale NOWPayments webhook rejected');
        res.status(400).json({ status: 'rejected', reason: 'stale_webhook' });
        return;
      }
    }

    // -------------------------------------------------------------------
    // Step 3: Idempotent webhook_events INSERT (receipt dedup only)
    // -------------------------------------------------------------------
    try {
      const eventId = `${paymentId}:${payload.payment_status}:${payload.updated_at ?? 'no-updated-at'}`;
      const dedupResult = await pool.query<{ id: string }>(
        `INSERT INTO webhook_events (provider, event_id, payload, processed_at)
         VALUES ('nowpayments', $1, $2, NOW())
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [eventId, JSON.stringify(payload)],
      );

      if (dedupResult.rows.length === 0) {
        // Duplicate receipt is not a processing terminal. Downstream status and lot
        // writes are idempotent, so continue to allow provider retry after partial failure.
        logger.info({ paymentId, eventId }, 'Duplicate webhook receipt; continuing idempotent processing');
      }
    } catch (err) {
      logger.error({ paymentId, err }, 'Failed to insert webhook_events');
      res.status(503).json({ status: 'error', reason: 'internal' });
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
      const isTerminalCurrent = ['failed', 'refunded', 'expired'].includes(statusResult.rows[0].status);
      const isDuplicateFinished = statusResult.rows[0].status === 'finished' && payload.payment_status === 'finished';

      if (isTerminalCurrent) {
        logger.info({ paymentId, current: statusResult.rows[0].status, incoming: payload.payment_status },
          'Payment already in terminal state');
        res.status(200).json({ status: 'skipped', reason: 'terminal_state' });
        return;
      }

      if (statusResult.rows[0].status === 'finished' && !isDuplicateFinished) {
        logger.info({ paymentId, current: statusResult.rows[0].status, incoming: payload.payment_status },
          'Payment already finished; non-finished transition skipped');
        res.status(200).json({ status: 'skipped', reason: 'terminal_state' });
        return;
      }

      if (!isDuplicateFinished && !isTerminalTransition && currentOrdinal <= existingOrdinal) {
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
           finished_at = CASE WHEN $4 THEN COALESCE(finished_at, NOW()) ELSE finished_at END,
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
        logger.error({ paymentId, err }, 'Credit lot minting failed — returning retryable error');
        res.status(500).json({ status: 'error', reason: 'credit_lot_mint_failed' });
        return;
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
 * Express request headers can be string, string[], or undefined. HMAC input must
 * be one unambiguous signature string; duplicated signature headers are treated
 * as missing rather than guessing which value to verify.
 */
function normalizeSingleHeader(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) return undefined;
  const trimmed = header?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Constant-time string comparison using timingSafeEqual.
 * Returns false for different-length strings without timing leak.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
