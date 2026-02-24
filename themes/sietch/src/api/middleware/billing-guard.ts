/**
 * BillingMiddleware — Mode-Aware Billing Enforcement
 *
 * Express middleware stack for billing enforcement on /invoke routes.
 * Mode-aware:
 *   shadow: logs hypothetical charges, proceeds regardless of balance
 *   soft:   reserves from lots, allows negative balance on overrun
 *   live:   reserves from lots, rejects if insufficient balance (402)
 *
 * Integrates with ICreditLedgerService.reserve() before inference
 * and ICreditLedgerService.finalize() after inference.
 *
 * SDD refs: §1.4 BillingMiddleware, §1.5.3 Cost Overrun
 * Sprint refs: Task 3.1
 *
 * @module api/middleware/billing-guard
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import type { ICreditLedgerService, ReservationResult } from '../../packages/core/ports/ICreditLedgerService.js';
import type { IdentityTrustConfig } from '../../packages/core/protocol/identity-trust.js';
import type { IPaymentVerifier, PaymentProof } from '../../packages/core/ports/IPaymentVerifier.js';
import { DEFAULT_IDENTITY_TRUST, evaluateIdentityTrust } from '../../packages/core/protocol/identity-trust.js';
import type { X402Config } from '../../packages/core/billing/x402-config.js';
import { DEFAULT_X402_CONFIG, NonceCache } from '../../packages/core/billing/x402-config.js';
import { resolveCreditPack, CREDIT_PACK_TIERS, DEFAULT_MARKUP_FACTOR } from '../../packages/core/billing/credit-packs.js';
import { parseBoundaryMicroUsd } from '../../packages/core/protocol/parse-boundary-micro-usd.js';
import { getBoundaryMetrics } from '../../packages/core/protocol/boundary-metrics.js';
import { createMicroUsdSchema } from '../../packages/core/protocol/micro-usd-schema.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export type BillingMode = 'shadow' | 'soft' | 'live';

export interface BillingGuardConfig {
  /** Credit ledger service instance */
  ledger: ICreditLedgerService;
  /** Billing mode override (defaults to BILLING_MODE env) */
  mode?: BillingMode;
  /** Safety multiplier for cost estimation (default: 1.1) */
  safetyMultiplier?: number;
  /** Overrun alert threshold percentage (default: 5) */
  overrunAlertThresholdPct?: number;
  /** Default reserve TTL in seconds (default: 300) */
  reserveTtlSeconds?: number;
  /** Identity trust configuration (Sprint 247, Task 3.1) */
  identityTrust?: IdentityTrustConfig;
  /** Function to look up stored identity anchor for an account */
  getStoredAnchor?: (accountId: string) => string | null;
  /** Whether this guard is mounted on a purchase route (exempt from anchor check) */
  isPurchaseRoute?: boolean;
  /** x402 payment configuration (Sprint 249, Task 5.1) */
  x402?: X402Config;
  /** Payment verifier for inline payment flow (Sprint 249, Task 5.3) */
  paymentVerifier?: IPaymentVerifier;
  /** Markup factor for inline credit pack purchases */
  markupFactor?: number;
  /** Database for recording inline purchases */
  billingDb?: import('better-sqlite3').Database;
}

export interface BillingContext {
  /** Billing mode for this request */
  mode: BillingMode;
  /** Account ID being billed */
  accountId: string;
  /** Pool ID for billing */
  poolId: string;
  /** Estimated cost in micro-USD */
  estimatedCostMicro: bigint;
  /** Reservation result (null in shadow mode) */
  reservation: ReservationResult | null;
  /** Start time for billing overhead measurement */
  startedAt: number;
}

/** Extend Express Request with billing context */
export interface BillingRequest extends Request {
  billing?: BillingContext;
}

// =============================================================================
// Billing Mode Resolution
// =============================================================================

function resolveBillingMode(override?: BillingMode): BillingMode {
  if (override) return override;
  const envMode = process.env.BILLING_MODE?.toLowerCase();
  if (envMode === 'live' || envMode === 'soft' || envMode === 'shadow') {
    return envMode;
  }
  return 'shadow'; // Default to shadow
}

// =============================================================================
// Cost Estimation
// =============================================================================

/**
 * Estimate cost for an inference request.
 * In production this would use model pricing tables and token estimation.
 * For now, uses a flat estimate that can be refined.
 */
function estimateCostMicro(req: Request, safetyMultiplier: number): bigint {
  // Extract model and token hints from request body
  const body = req.body ?? {};
  const maxTokens = body.max_tokens ?? body.maxTokens ?? 1000;

  // Base cost estimation: $0.01 per 1K tokens (rough GPT-like pricing)
  // This is intentionally conservative — overestimate to avoid overruns
  const baseCostDollars = (maxTokens / 1000) * 0.01;
  const withSafety = baseCostDollars * safetyMultiplier;
  const microUsd = BigInt(Math.ceil(withSafety * 1_000_000));

  return microUsd > 0n ? microUsd : 1000n; // Minimum 0.001 USD
}

// =============================================================================
// Pre-Inference Middleware (Reserve)
// =============================================================================

// Shared nonce cache for x402 replay prevention (singleton per process)
let sharedNonceCache: NonceCache | null = null;

function getNonceCache(ttlSeconds: number): NonceCache {
  if (!sharedNonceCache) {
    sharedNonceCache = new NonceCache(ttlSeconds);
  }
  return sharedNonceCache;
}

/**
 * Format micro-USD as USDC display string.
 * 1 USDC = 1,000,000 micro-USD (exact mapping per FR-1).
 */
function formatAmountUsdc(amountMicro: bigint): string {
  const dollars = amountMicro / 1_000_000n;
  const remainder = amountMicro % 1_000_000n;
  return `${dollars}.${remainder.toString().padStart(6, '0')}`;
}

/**
 * Build x402 payment response body.
 */
function buildX402Response(
  accountId: string,
  estimatedCostMicro: bigint,
  x402Config: X402Config,
  nonceCache: NonceCache,
): Record<string, unknown> {
  const nonce = randomUUID();
  nonceCache.set(nonce, accountId);

  return {
    error: 'insufficient_credits',
    paymentRequired: true,
    x402: {
      amount_micro: estimatedCostMicro.toString(),
      amount_usdc: formatAmountUsdc(estimatedCostMicro),
      currency: 'USDC',
      network: 'base',
      recipient: x402Config.recipient_address,
      memo: `${accountId}:${nonce}`,
      instructions: 'Send USDC to recipient address with memo to continue',
    },
  };
}

/**
 * Try to process an inline X-Payment-Proof header.
 * Returns true if payment was processed and credits reserved, false otherwise.
 */
async function tryInlinePayment(
  req: BillingRequest,
  config: BillingGuardConfig,
  accountId: string,
  estimatedCost: bigint,
  nonceCache: NonceCache,
): Promise<boolean> {
  const paymentHeader = req.headers['x-payment-proof'];
  if (!paymentHeader || typeof paymentHeader !== 'string') return false;
  if (!config.paymentVerifier || !config.x402) return false;

  let proof: PaymentProof;
  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf-8'));
    proof = {
      reference: decoded.reference,
      recipient_address: decoded.recipient_address,
      amount_micro: (() => {
        const rawAmountMicro = String(decoded.amount_micro ?? '');
        // Gateway schema pre-validation (cycle-040, FR-3 AC-3.3)
        const schemaResult = createMicroUsdSchema().safeParse(rawAmountMicro);
        if (!schemaResult.success) {
          throw new Error(`Invalid amount_micro in payment proof: ${schemaResult.error.issues[0].message}`);
        }
        // Sprint 4, Task 4.3: boundary-hardened parsing for x402 payment proof
        const parseResult = parseBoundaryMicroUsd(
          rawAmountMicro,
          'http',
          logger,
          getBoundaryMetrics(),
        );
        if (!parseResult.ok) {
          throw new Error(`Invalid amount_micro in payment proof: ${parseResult.reason}`);
        }
        return parseResult.value;
      })(),
      payer: decoded.payer,
      chain_id: decoded.chain_id,
    };
  } catch {
    logger.warn({ event: 'billing.x402.parse_error', accountId }, 'Invalid X-Payment-Proof header');
    return false;
  }

  // Validate nonce from memo (format: "accountId:nonce")
  const memo = `${accountId}:`;
  const memoField = (req.body?.memo || proof.reference.split(':').slice(1).join(':') || '');
  // Extract nonce from the payment — check if reference contains the nonce
  const noncePart = proof.reference.includes(':')
    ? proof.reference.split(':').pop()!
    : null;

  // Try to extract nonce from memo in request body or from the proof reference
  let nonceValid = false;
  if (noncePart && nonceCache.consume(noncePart, accountId)) {
    nonceValid = true;
  }

  if (!nonceValid) {
    logger.warn({ event: 'billing.x402.nonce_invalid', accountId }, 'Nonce validation failed');
    return false;
  }

  // Verify payment proof
  const verification = await config.paymentVerifier.verify(proof);
  if (!verification.valid) {
    logger.warn({
      event: 'billing.x402.verify_failed',
      accountId,
      reason: verification.reason,
    }, 'Inline payment verification failed');
    return false;
  }

  // Find matching tier or use inline custom lot
  const markup = config.markupFactor ?? DEFAULT_MARKUP_FACTOR;
  let packId = 'inline';
  for (const tier of [...CREDIT_PACK_TIERS].reverse()) {
    if (tier.priceMicro <= proof.amount_micro) {
      packId = tier.id;
      break;
    }
  }

  const resolved = resolveCreditPack(packId, markup);
  const creditsMicro = resolved
    ? resolved.creditsMicro
    : proof.amount_micro; // Custom lot: credits = payment amount at 1:1

  try {
    // Mint credits via ledger
    await config.ledger.mintLot(
      accountId,
      creditsMicro,
      'purchase',
      {
        poolId: 'general',
        description: `Inline x402 payment: ${packId}`,
      },
    );

    // Record in credit_lot_purchases if DB available
    if (config.billingDb) {
      const { createHash } = await import('crypto');
      const idempotencyKey = createHash('sha256')
        .update(`${proof.reference}:${proof.recipient_address}:${proof.amount_micro.toString()}:${accountId}`)
        .digest('hex');

      try {
        config.billingDb.prepare(`
          INSERT OR IGNORE INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          `pur_inline_${idempotencyKey.substring(0, 16)}`,
          accountId,
          packId,
          proof.reference,
          idempotencyKey,
          'inline', // lot_id set to inline — actual lot ID from mintLot is internal
          creditsMicro.toString(),
        );
      } catch {
        // Idempotency: if UNIQUE constraint fires, this is a duplicate — that's fine
      }
    }

    logger.info({
      event: 'billing.x402.inline_purchase',
      accountId,
      packId,
      creditsMicro: creditsMicro.toString(),
    }, 'Inline x402 payment processed');

    return true;
  } catch (err) {
    logger.error({ event: 'billing.x402.mint_error', accountId, err }, 'Failed to mint inline credits');
    return false;
  }
}

/**
 * Create pre-inference billing middleware.
 * Runs BEFORE the inference handler to reserve credits.
 */
export function createBillingReserveMiddleware(config: BillingGuardConfig) {
  const mode = resolveBillingMode(config.mode);
  const safetyMultiplier = config.safetyMultiplier ?? 1.1;
  const reserveTtl = config.reserveTtlSeconds ?? 300;
  const x402Config = config.x402 ?? DEFAULT_X402_CONFIG;
  const nonceCache = getNonceCache(x402Config.nonce_ttl_seconds);

  return async function billingReserve(
    req: BillingRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const startedAt = Date.now();

    // Get account ID from auth context
    const accountId = (req as any).accountId;
    if (!accountId) {
      // No account — skip billing (unauthenticated routes)
      next();
      return;
    }

    const poolId = 'general';
    const estimatedCost = estimateCostMicro(req, safetyMultiplier);

    // Identity trust check (Sprint 247, Task 3.2)
    const trustConfig = config.identityTrust ?? DEFAULT_IDENTITY_TRUST;
    if (trustConfig.enabled && config.getStoredAnchor) {
      const hasAnchor = config.getStoredAnchor(accountId) !== null;
      const check = evaluateIdentityTrust(
        trustConfig,
        estimatedCost,
        hasAnchor,
        config.isPurchaseRoute ?? false,
      );

      if (!check.allowed) {
        logger.warn({
          event: 'billing.identity.denied',
          accountId,
          reason: check.reason,
          estimatedCostMicro: estimatedCost.toString(),
        }, 'Identity anchor required for high-value operation');

        res.status(403).json({
          error: 'Identity Anchor Required',
          code: check.reason,
          message: 'An identity anchor is required for high-value operations.',
        });
        return;
      }
    }

    // Shadow mode: log and proceed
    if (mode === 'shadow') {
      req.billing = {
        mode,
        accountId,
        poolId,
        estimatedCostMicro: estimatedCost,
        reservation: null,
        startedAt,
      };

      logger.info({
        event: 'billing.shadow.reserve',
        accountId,
        estimatedCostMicro: estimatedCost.toString(),
      }, 'Shadow billing: hypothetical reserve');

      next();
      return;
    }

    // Soft/Live mode: actually reserve
    try {
      const reservation = await config.ledger.reserve(
        accountId,
        poolId,
        estimatedCost,
        { ttlSeconds: reserveTtl, billingMode: mode },
      );

      req.billing = {
        mode,
        accountId,
        poolId,
        estimatedCostMicro: estimatedCost,
        reservation,
        startedAt,
      };

      next();
    } catch (err) {
      const errorMessage = (err as Error).message;

      if (mode === 'live' && errorMessage.includes('insufficient')) {
        // Sprint 249, Task 5.3: Try inline payment if X-Payment-Proof header present
        if (config.paymentVerifier && x402Config.enabled) {
          const inlineSuccess = await tryInlinePayment(req, config, accountId, estimatedCost, nonceCache);
          if (inlineSuccess) {
            // Re-attempt reservation after inline payment
            try {
              const reservation = await config.ledger.reserve(
                accountId,
                poolId,
                estimatedCost,
                { ttlSeconds: reserveTtl, billingMode: mode },
              );

              req.billing = {
                mode,
                accountId,
                poolId,
                estimatedCostMicro: estimatedCost,
                reservation,
                startedAt,
              };

              next();
              return;
            } catch {
              // Still insufficient after inline payment — fall through to 402
            }
          }
        }

        // Live mode: reject with 402
        logger.warn({
          event: 'billing.live.insufficient',
          accountId,
          estimatedCostMicro: estimatedCost.toString(),
        }, 'Insufficient credits — request blocked');

        if (x402Config.enabled) {
          // Sprint 249, Task 5.1: x402 Payment Required response
          res.status(402).json(buildX402Response(accountId, estimatedCost, x402Config, nonceCache));
        } else {
          // Generic 402 without x402 payment instructions
          const balance = await config.ledger.getBalance(accountId).catch(() => null);
          res.status(402).json({
            error: 'insufficient_credits',
            balance_micro: balance ? balance.availableMicro.toString() : '0',
          });
        }
        return;
      }

      // Soft mode or unexpected error: log and proceed
      logger.warn({
        event: 'billing.reserve.error',
        accountId,
        mode,
        err: errorMessage,
      }, 'Billing reserve failed — proceeding in degraded mode');

      req.billing = {
        mode,
        accountId,
        poolId,
        estimatedCostMicro: estimatedCost,
        reservation: null,
        startedAt,
      };

      next();
    }
  };
}

// =============================================================================
// Post-Inference Middleware (Finalize)
// =============================================================================

/**
 * Create post-inference billing middleware.
 * Runs AFTER the inference handler to finalize charges.
 */
export function createBillingFinalizeMiddleware(config: BillingGuardConfig) {
  const overrunThreshold = config.overrunAlertThresholdPct ?? 5;

  return async function billingFinalize(
    req: BillingRequest,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    const billing = req.billing;
    if (!billing) {
      next();
      return;
    }

    // Extract actual cost from response (set by inference handler)
    const actualCostMicro = (req as any).actualCostMicro as bigint | undefined;
    if (!actualCostMicro) {
      // No cost reported — release reservation if present
      if (billing.reservation) {
        try {
          await config.ledger.release(billing.reservation.reservationId);
        } catch (err) {
          logger.error({
            event: 'billing.release.error',
            reservationId: billing.reservation.reservationId,
            err,
          }, 'Failed to release reservation');
        }
      }
      next();
      return;
    }

    const overheadMs = Date.now() - billing.startedAt;

    // Shadow mode: log hypothetical finalize
    if (billing.mode === 'shadow') {
      // Create shadow ledger entries
      try {
        await config.ledger.reserve(
          billing.accountId,
          billing.poolId,
          actualCostMicro,
          { billingMode: 'shadow' },
        );
      } catch {
        // Shadow mode never fails
      }

      logger.info({
        event: 'billing.shadow.finalize',
        accountId: billing.accountId,
        actualCostMicro: actualCostMicro.toString(),
        estimatedCostMicro: billing.estimatedCostMicro.toString(),
        overheadMs,
      }, 'Shadow billing: hypothetical finalize');

      next();
      return;
    }

    // Soft/Live mode: finalize reservation
    if (!billing.reservation) {
      next();
      return;
    }

    try {
      const result = await config.ledger.finalize(
        billing.reservation.reservationId,
        actualCostMicro,
      );

      // Check for overrun alert
      if (result.overrunMicro > 0n) {
        const overrunPct = Number(result.overrunMicro * 100n / billing.estimatedCostMicro);
        if (overrunPct > overrunThreshold) {
          logger.warn({
            event: 'billing.overrun.alert',
            accountId: billing.accountId,
            reservationId: billing.reservation.reservationId,
            overrunMicro: result.overrunMicro.toString(),
            overrunPct,
            mode: billing.mode,
          }, `Cost overrun alert: ${overrunPct}% over estimate`);
        }
      }

      logger.info({
        event: 'billing.finalize',
        accountId: billing.accountId,
        actualCostMicro: actualCostMicro.toString(),
        overrunMicro: result.overrunMicro.toString(),
        overheadMs,
        mode: billing.mode,
      }, 'Billing finalized');
    } catch (err) {
      logger.error({
        event: 'billing.finalize.error',
        accountId: billing.accountId,
        reservationId: billing.reservation.reservationId,
        err,
      }, 'Billing finalize failed');
    }

    next();
  };
}
