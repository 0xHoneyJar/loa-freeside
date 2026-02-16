/**
 * Creator Dashboard API Routes
 *
 * GET /api/creator/earnings  — Total earned, pending, settled
 * GET /api/creator/referrals — Referral stats, active referees
 * GET /api/creator/payouts   — Payout history (empty for Phase 1A)
 *
 * Phase 1A: Settled earnings are non-withdrawable.
 * Phase 1B (Sprint 9): Payout infrastructure enables withdrawals.
 *
 * SDD refs: §4.3 Creator Dashboard
 * Sprint refs: Tasks 6.3, 6.4
 *
 * @module api/routes/creator-dashboard.routes
 */

import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import type { SettlementService } from '../../packages/adapters/billing/SettlementService.js';
import type { IReferralService } from '../../packages/core/ports/IReferralService.js';
import type { CreatorPayoutService } from '../../packages/adapters/billing/CreatorPayoutService.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Router Setup
// =============================================================================

export const creatorDashboardRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let settlementService: SettlementService | null = null;
let referralService: IReferralService | null = null;
let payoutService: CreatorPayoutService | null = null;
let dashboardDb: Database.Database | null = null;

export function setCreatorDashboardServices(services: {
  settlement: SettlementService;
  referral: IReferralService;
  payout?: CreatorPayoutService;
  db: Database.Database;
}): void {
  settlementService = services.settlement;
  referralService = services.referral;
  payoutService = services.payout ?? null;
  dashboardDb = services.db;
}

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /creator/earnings — Earnings breakdown
 */
creatorDashboardRouter.get(
  '/earnings',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    if (!settlementService || !dashboardDb) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const accountId = req.caller!.userId;

    try {
      const totalEarned = getTotalEarned(accountId);
      const pendingSettlement = settlementService.getPendingBalance(accountId);
      const settledAvailable = settlementService.getSettledBalance(accountId);

      res.json({
        total_earned_micro: totalEarned.toString(),
        pending_settlement_micro: pendingSettlement.toString(),
        settled_available_micro: settledAvailable.toString(),
        withdrawn_micro: '0', // Phase 1B
        phase: '1A',
        note: 'Settled earnings are non-withdrawable until Phase 1B',
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to get creator earnings');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /creator/referrals — Referral stats
 */
creatorDashboardRouter.get(
  '/referrals',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    if (!referralService) {
      res.status(503).json({ error: 'Service not initialized' });
      return;
    }

    const accountId = req.caller!.userId;

    try {
      const stats = await referralService.getReferralStats(accountId);

      res.json({
        total_referees: stats.totalReferees,
        active_referees: stats.activeReferees,
        total_earnings_micro: stats.totalEarningsMicro.toString(),
        pending_bonuses: stats.pendingBonuses,
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to get creator referrals');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /creator/payouts — Payout history (empty for Phase 1A)
 */
creatorDashboardRouter.get(
  '/payouts',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    res.json({
      payouts: [],
      total_withdrawn_micro: '0',
      phase: '1A',
      note: 'Payout functionality available in Phase 1B',
    });
  }
);

/**
 * GET /creator/kyc-status — KYC progressive disclosure status
 */
creatorDashboardRouter.get(
  '/kyc-status',
  requireAuth,
  (req: AuthenticatedRequest, res: Response) => {
    if (!payoutService) {
      res.status(503).json({ error: 'Payout service not initialized' });
      return;
    }

    const accountId = req.caller!.userId;

    try {
      const status = payoutService.getKycStatus(accountId);

      res.json({
        current_level: status.currentLevel,
        cumulative_payouts_micro: status.cumulativePayoutsMicro.toString(),
        next_threshold_micro: status.nextThreshold?.toString() ?? null,
        next_threshold_level: status.nextThresholdLevel,
        percent_to_next_threshold: status.percentToNextThreshold,
        warning: status.warning,
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Failed to get KYC status');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// =============================================================================
// Helpers
// =============================================================================

function getTotalEarned(accountId: string): bigint {
  if (!dashboardDb) return 0n;

  try {
    const row = dashboardDb.prepare(`
      SELECT COALESCE(SUM(amount_micro), 0) as total
      FROM referrer_earnings
      WHERE referrer_account_id = ?
    `).get(accountId) as { total: number };

    return BigInt(row.total);
  } catch {
    return 0n;
  }
}
