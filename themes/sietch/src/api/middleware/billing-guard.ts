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
import type { ICreditLedgerService, ReservationResult, FinalizeResult } from '../../packages/core/ports/ICreditLedgerService.js';
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

/**
 * Create pre-inference billing middleware.
 * Runs BEFORE the inference handler to reserve credits.
 */
export function createBillingReserveMiddleware(config: BillingGuardConfig) {
  const mode = resolveBillingMode(config.mode);
  const safetyMultiplier = config.safetyMultiplier ?? 1.1;
  const reserveTtl = config.reserveTtlSeconds ?? 300;

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
        // Live mode: reject with 402
        logger.warn({
          event: 'billing.live.insufficient',
          accountId,
          estimatedCostMicro: estimatedCost.toString(),
        }, 'Insufficient credits — request blocked');

        res.status(402).json({
          error: 'Insufficient Credits',
          message: 'Your account does not have enough credits for this request.',
          estimatedCostMicro: estimatedCost.toString(),
        });
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
