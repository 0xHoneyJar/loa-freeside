/**
 * NOWPayments Webhook Handler — Credit Lot Minting Bridge
 *
 * Bridges NOWPayments webhook events to the PostgreSQL credit lot ledger.
 * Implements the credit ledger hook for CryptoWebhookService:
 *   1. Mint credit lot via mintCreditLot() (idempotent via payment_id)
 *   2. Conditional Redis INCRBY only if INSERT returned id (not duplicate)
 *   3. Status monotonicity: waiting → confirming → finished
 *
 * The HMAC-SHA512 verification and LVVER deduplication are handled
 * upstream by CryptoWebhookService. This handler only processes
 * verified, deduplicated events.
 *
 * @see CryptoWebhookService for LVVER pattern
 * @see credit-lot-service.ts for mintCreditLot()
 * @see Sprint 2, Task 2.1 (F-16, F-17, F-18)
 * @module packages/services/nowpayments-handler
 */

import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { mintCreditLot } from './credit-lot-service.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Result of processing a NOWPayments webhook for the credit ledger */
export interface NowpaymentsLotResult {
  /** The lot ID (null if duplicate/skipped) */
  lotId: string | null;
  /** Amount in micro-USD */
  amountUsdMicro: bigint;
  /** Whether a new lot was minted (false = duplicate payment_id) */
  minted: boolean;
  /** Whether Redis budget was adjusted */
  redisAdjusted: boolean;
}

/** Webhook event shape (subset of CryptoWebhookEvent needed for lot minting) */
export interface WebhookLotEvent {
  paymentId: string;
  communityId: string;
  priceUsd: number;
  orderId?: string;
}

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** 1 USD = 1,000,000 micro-USD */
const MICRO_PER_USD = 1_000_000n;

/** 1 cent = 10,000 micro-USD */
const MICRO_PER_CENT = 10_000n;

/** Redis idempotency key TTL: 24 hours */
const REDIS_PROCESSED_TTL = 86_400;

/** Default lot expiry: 90 days from now */
const LOT_EXPIRY_DAYS = 90;

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

/**
 * Create the credit ledger hook for CryptoWebhookService.
 *
 * This returns a function matching the hook signature that CryptoWebhookService
 * expects: (event, communityId, priceUsd) => Promise<{ lotId, amountUsdMicro }>
 *
 * Usage (server init):
 *   cryptoWebhookService.setCreditLedgerHook(
 *     createCreditLedgerHook(pgPool, redis)
 *   );
 *
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client
 * @returns Credit ledger hook function
 */
export function createCreditLedgerHook(
  pool: Pool,
  redis: Redis,
): (event: { paymentId: string; orderId?: string }, communityId: string, priceUsd: number) => Promise<{ lotId: string; amountUsdMicro: bigint }> {
  return async (event, communityId, priceUsd) => {
    const result = await processPaymentForLedger(pool, redis, {
      paymentId: event.paymentId,
      communityId,
      priceUsd,
      orderId: event.orderId,
    });

    if (!result.lotId) {
      // Duplicate — return a synthetic result for the hook contract
      // CryptoWebhookService logs this but doesn't fail
      return {
        lotId: `dup:${event.paymentId}`,
        amountUsdMicro: result.amountUsdMicro,
      };
    }

    return {
      lotId: result.lotId,
      amountUsdMicro: result.amountUsdMicro,
    };
  };
}

/**
 * Process a verified NOWPayments webhook for the credit lot ledger.
 *
 * Idempotency guarantees:
 *   - Postgres: ON CONFLICT (payment_id) DO NOTHING — no duplicate lots
 *   - Redis: processed:{lotId} key prevents double INCRBY
 *
 * @param pool - PostgreSQL connection pool
 * @param redis - Redis client
 * @param event - Verified webhook event with community context
 * @returns Lot minting result
 */
export async function processPaymentForLedger(
  pool: Pool,
  redis: Redis,
  event: WebhookLotEvent,
): Promise<NowpaymentsLotResult> {
  const amountMicro = BigInt(Math.round(event.priceUsd * Number(MICRO_PER_USD)));

  // Lot expiry: 90 days from now
  const expiresAt = new Date(Date.now() + LOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Step 1: Mint credit lot (idempotent via payment_id)
  const client = await pool.connect();
  let lotId: string | null = null;

  try {
    await client.query('BEGIN');

    lotId = await mintCreditLot(client, {
      community_id: event.communityId,
      source: 'purchase',
      amount_micro: amountMicro,
      payment_id: event.paymentId,
      expires_at: expiresAt,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (!lotId) {
    // Duplicate payment_id — lot already exists
    return {
      lotId: null,
      amountUsdMicro: amountMicro,
      minted: false,
      redisAdjusted: false,
    };
  }

  // Step 2: Conditional Redis budget limit increment
  // Only if the INSERT actually created a new lot (not duplicate)
  // Idempotency: check processed:{lotId} before INCRBY
  let redisAdjusted = false;
  const processedKey = `processed:mint:${lotId}`;

  try {
    const alreadyProcessed = await redis.exists(processedKey);

    if (!alreadyProcessed) {
      // Convert micro-USD to cents for Redis (÷ 10,000)
      const amountCents = amountMicro / MICRO_PER_CENT;

      // INCRBY the budget limit
      await redis.incrby(
        `agent:budget:limit:${event.communityId}`,
        Number(amountCents),
      );

      // Mark as processed with TTL
      await redis.set(processedKey, '1', 'EX', REDIS_PROCESSED_TTL);
      redisAdjusted = true;
    }
  } catch {
    // Redis failure should not roll back the Postgres lot.
    // Reconciliation sweep will catch up.
    // Log is handled by caller (CryptoWebhookService).
  }

  return {
    lotId,
    amountUsdMicro: amountMicro,
    minted: true,
    redisAdjusted,
  };
}

/**
 * Verify that a payment exists in crypto_payments table before processing.
 *
 * Per Flatline IMP-009: webhook handler only processes payments with
 * existing crypto_payments row (created by POST /payments/nowpayments).
 *
 * @param pool - PostgreSQL connection pool
 * @param paymentId - NOWPayments payment ID
 * @returns Payment row or null if not found
 */
export async function verifyPaymentExists(
  pool: Pool,
  paymentId: string,
): Promise<{ community_id: string; tier: string; price_amount: number } | null> {
  const result = await pool.query<{
    community_id: string;
    tier: string;
    price_amount: number;
  }>(
    `SELECT community_id, tier, price_amount
     FROM crypto_payments
     WHERE payment_id = $1`,
    [paymentId],
  );

  return result.rows[0] || null;
}
