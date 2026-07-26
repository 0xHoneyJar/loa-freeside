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

import type { Pool, PoolClient } from 'pg';
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

/** Default lot expiry: 90 days from purchase */
export const LOT_EXPIRY_DAYS = 90;

/**
 * Convert a USD float to BigInt micro-USD with minimal floating-point exposure.
 * Converts to integer cents first (2 decimal places), then scales to micro-USD.
 * This reduces the floating-point multiplication range from 1e6 to 1e2.
 */
export function usdToMicroSafe(priceUsd: number): bigint {
  const cents = Math.round(priceUsd * 100);
  return BigInt(cents) * MICRO_PER_CENT;
}

// --------------------------------------------------------------------------
// Redis budget-adjustment outbox (durable, exactly-once)
// --------------------------------------------------------------------------

/** A pending Redis budget-limit increment for a minted lot. */
export interface RedisCreditAdjustment {
  lotId: string;
  communityId: string;
  amountCents: bigint;
}

/**
 * Atomic marker-check + INCRBY in one Redis round-trip.
 *
 * Without atomicity there is a crash window between INCRBY and setting the
 * processed marker: a retry after such a crash would INCRBY a second time and
 * double-credit the community. The Lua script makes "increment only if not yet
 * processed, then mark processed" a single atomic operation, so the adjustment
 * is applied exactly once no matter how many times it is retried.
 *
 *   KEYS[1] = processed:mint:{lotId}   ARGV[1] = amountCents
 *   KEYS[2] = agent:budget:limit:{cid} ARGV[2] = marker TTL seconds
 *   returns 1 if applied now, 0 if already applied earlier (both = credit present)
 */
const APPLY_CREDIT_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 0
end
redis.call('INCRBY', KEYS[2], ARGV[1])
redis.call('SET', KEYS[1], '1', 'EX', ARGV[2])
return 1
`;

/**
 * Durably enqueue a Redis budget adjustment. MUST run inside the same
 * transaction/client as the credit-lot mint so the outbox row is durable iff
 * the lot is. Idempotent per lot_id.
 */
export async function enqueueRedisCreditAdjustment(
  client: PoolClient,
  adj: RedisCreditAdjustment,
): Promise<void> {
  await client.query(
    `INSERT INTO pending_redis_credit_adjustments (lot_id, community_id, amount_cents)
     VALUES ($1, $2, $3)
     ON CONFLICT (lot_id) DO NOTHING`,
    [adj.lotId, adj.communityId, adj.amountCents.toString()],
  );
}

/**
 * Apply a pending Redis budget adjustment exactly once and mark the outbox row
 * resolved. On Redis failure the row is left pending (attempts bumped) for the
 * reconciliation sweep to retry.
 *
 * @returns true if the credit is now present in Redis, false if still pending.
 */
export async function applyRedisCreditAdjustment(
  redis: Redis,
  pool: Pool,
  adj: RedisCreditAdjustment,
): Promise<boolean> {
  const processedKey = `processed:mint:${adj.lotId}`;
  const limitKey = `agent:budget:limit:${adj.communityId}`;

  try {
    // eval returns 1 (applied now) or 0 (already applied) — both mean the
    // INCRBY has landed exactly once, so the outbox row can be resolved.
    await redis.eval(
      APPLY_CREDIT_LUA,
      2,
      processedKey,
      limitKey,
      adj.amountCents.toString(),
      String(REDIS_PROCESSED_TTL),
    );
  } catch {
    // Redis still unavailable — record the failed attempt, leave pending.
    await pool
      .query(
        `UPDATE pending_redis_credit_adjustments
         SET attempts = attempts + 1, last_attempt_at = NOW()
         WHERE lot_id = $1`,
        [adj.lotId],
      )
      .catch(() => {});
    return false;
  }

  await pool.query(
    `UPDATE pending_redis_credit_adjustments
     SET applied_at = NOW(), attempts = attempts + 1, last_attempt_at = NOW()
     WHERE lot_id = $1`,
    [adj.lotId],
  );
  return true;
}

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
  const amountMicro = usdToMicroSafe(event.priceUsd);
  const amountCents = amountMicro / MICRO_PER_CENT;

  // Lot expiry: 90 days from now
  const expiresAt = new Date(Date.now() + LOT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  // Step 1: Mint credit lot AND enqueue the Redis-adjustment outbox row in ONE
  // transaction (idempotent via payment_id). The outbox row is durable iff the
  // lot is, so a Redis INCRBY that fails or is deferred is never lost — the
  // reconciliation sweep drains pending_redis_credit_adjustments until the
  // credit lands exactly once.
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

    if (lotId) {
      await enqueueRedisCreditAdjustment(client, {
        lotId,
        communityId: event.communityId,
        amountCents,
      });
    }

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

  // Step 2: Apply the Redis budget increment exactly once. On failure the
  // durable outbox row stays pending for the sweep to retry.
  const redisAdjusted = await applyRedisCreditAdjustment(redis, pool, {
    lotId,
    communityId: event.communityId,
    amountCents,
  });

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
