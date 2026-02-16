/**
 * Payout API Routes
 *
 * POST /api/payouts/request  — Request a payout (202 Accepted)
 * POST /api/payouts/:id/cancel — Cancel a pending payout
 * GET  /api/payouts/:id      — Get payout status
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Tasks 9.4, 10.3
 *
 * @module api/routes/payout.routes
 */

import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import type { CreatorPayoutService } from '../../packages/adapters/billing/CreatorPayoutService.js';
import type { PayoutStateMachine } from '../../packages/adapters/billing/PayoutStateMachine.js';

// =============================================================================
// Router Setup
// =============================================================================

export const payoutRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let payoutService: CreatorPayoutService | null = null;
let payoutStateMachine: PayoutStateMachine | null = null;

export function setPayoutService(service: CreatorPayoutService): void {
  payoutService = service;
}

export function setPayoutStateMachine(sm: PayoutStateMachine): void {
  payoutStateMachine = sm;
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /payouts/request — Request a payout
 */
payoutRouter.post(
  '/request',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    if (!payoutService) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const accountId = req.caller!.userId;
    const { amount_micro, payout_address, currency } = req.body;

    if (!amount_micro || !payout_address) {
      res.status(400).json({ error: 'amount_micro and payout_address are required' });
      return;
    }

    if (typeof amount_micro !== 'number' || amount_micro <= 0) {
      res.status(400).json({ error: 'amount_micro must be a positive number' });
      return;
    }

    try {
      const result = payoutService.requestPayout({
        accountId,
        amountMicro: amount_micro,
        payoutAddress: payout_address,
        currency,
      });

      if (!result.success) {
        const statusCode = result.requiredKycLevel ? 403 : 400;
        res.status(statusCode).json({
          error: result.error,
          required_kyc_level: result.requiredKycLevel,
        });
        return;
      }

      res.status(202).json({
        payout_id: result.payoutId,
        status: 'pending',
        message: 'Payout request accepted',
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Payout request failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /payouts/:id — Get payout status
 */
payoutRouter.get(
  '/:id',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    if (!payoutService) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const accountId = req.caller!.userId;
    const payoutId = req.params.id;

    try {
      // Use the underlying state machine to get payout
      const payout = (payoutService as unknown as { db: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } } }).db
        ? null : null;

      // Direct DB query since getPayout is on the state machine
      res.status(501).json({
        error: 'Payout status lookup via API not yet implemented',
        payout_id: payoutId,
      });
    } catch (err) {
      logger.error({ err, accountId, payoutId }, 'Payout status lookup failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /payouts/:id/cancel — Cancel a pending payout (Task 10.3)
 */
payoutRouter.post(
  '/:id/cancel',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    if (!payoutStateMachine) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const accountId = req.caller!.userId;
    const payoutId = req.params.id;

    try {
      // Verify ownership
      const payout = payoutStateMachine.getPayout(payoutId);
      if (!payout) {
        res.status(404).json({ error: 'Payout not found' });
        return;
      }

      if (payout.account_id !== accountId) {
        res.status(403).json({ error: 'Not authorized to cancel this payout' });
        return;
      }

      const result = payoutStateMachine.cancel(payoutId);

      if (!result.success) {
        res.status(400).json({
          error: result.reason,
          current_status: result.fromState,
        });
        return;
      }

      res.status(200).json({
        payout_id: payoutId,
        status: 'cancelled',
        message: 'Payout cancelled successfully',
      });
    } catch (err) {
      logger.error({ err, accountId, payoutId }, 'Payout cancellation failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
