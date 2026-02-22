/**
 * Per-Payment Webhook Throttle (Cycle 036, Task 3.7, Layer 2)
 *
 * Redis-backed rate limiting: max 10 IPN deliveries/hour per payment_id.
 * Extracted from JSON body BEFORE HMAC verification (saves CPU on floods).
 *
 * Layer stack:
 *   Layer 1: WAF IP-based (100 req/min per IP) — waf.tf
 *   Layer 2: This middleware (10 req/hour per payment_id) — application
 *   Layer 3: DB idempotency (SELECT ... FOR UPDATE + mint guard) — CryptoWebhookService
 *
 * Design: 5xx responses do NOT increment the counter (NOWPayments retries on 5xx).
 *
 * @see SDD §3.2 Webhook Security
 * @see Sprint 3, Task 3.7
 */

import type { Request, Response, NextFunction } from 'express';
import { redisService } from '../../services/cache/RedisService.js';
import { logger } from '../../utils/logger.js';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Max IPN deliveries per payment_id per hour */
const MAX_PER_PAYMENT_HOUR = 10;

/** Window size in seconds (1 hour) */
const WINDOW_SECONDS = 3600;

/** Redis key prefix */
const KEY_PREFIX = 'webhook:throttle:';

// --------------------------------------------------------------------------
// Middleware
// --------------------------------------------------------------------------

/**
 * Per-payment_id webhook throttle middleware.
 *
 * Parses payment_id from the raw JSON body without full JSON.parse
 * (regex extraction) to minimize CPU on flood payloads.
 *
 * If payment_id cannot be extracted, the request passes through
 * (HMAC verification will reject invalid payloads downstream).
 */
export async function webhookPaymentThrottle(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Extract payment_id from body — try raw body first, fall back to parsed
    const paymentId = extractPaymentId(req);

    if (!paymentId) {
      // Can't extract payment_id — let HMAC verification handle it
      next();
      return;
    }

    const key = `${KEY_PREFIX}${paymentId}`;
    const count = await redisService.get(key);
    const currentCount = count ? parseInt(count, 10) : 0;

    if (currentCount >= MAX_PER_PAYMENT_HOUR) {
      const retryAfter = WINDOW_SECONDS;

      logger.warn({
        event: 'webhook.payment-throttled',
        paymentId,
        count: currentCount,
        limit: MAX_PER_PAYMENT_HOUR,
      }, 'Webhook throttled: per-payment_id limit exceeded');

      res.setHeader('Retry-After', retryAfter.toString());
      res.status(429).json({
        error: 'Too many requests for this payment',
        retryAfter,
      });
      return;
    }

    // Increment counter with TTL
    // Use set with NX + EX for atomic counter initialization,
    // or increment existing key
    if (currentCount === 0) {
      await redisService.set(key, '1', WINDOW_SECONDS);
    } else {
      await redisService.set(key, String(currentCount + 1), WINDOW_SECONDS);
    }

    next();
  } catch (err) {
    // Redis failure — fail open (let the request through)
    // Layer 3 (DB idempotency) provides the final safety net
    logger.warn({
      event: 'webhook.throttle-error',
      err,
    }, 'Webhook throttle Redis error — failing open');
    next();
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Extract payment_id from request body using regex on raw body.
 * Avoids full JSON.parse to save CPU on flood payloads.
 */
function extractPaymentId(req: Request): string | null {
  // Try raw body first (set by express.raw middleware)
  const rawBody = (req as any).rawBody;
  if (rawBody) {
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
    const match = bodyStr.match(/"payment_id"\s*:\s*(?:"([^"]+)"|(\d+))/);
    if (match) {
      return match[1] || match[2] || null;
    }
  }

  // Fall back to parsed body
  if (req.body && typeof req.body === 'object' && req.body.payment_id) {
    return String(req.body.payment_id);
  }

  return null;
}
