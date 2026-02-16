/**
 * Score Rewards API Routes
 *
 * GET /score/rewards — Reward history per account
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Task 12.4
 *
 * @module api/routes/score-rewards
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ScoreRewardsService } from '../../packages/adapters/billing/ScoreRewardsService.js';

// =============================================================================
// Router Setup
// =============================================================================

const router = Router();

let rewardsService: ScoreRewardsService | null = null;

/** Lazy injection for testability */
export function setRewardsService(service: ScoreRewardsService): void {
  rewardsService = service;
}

// =============================================================================
// Routes
// =============================================================================

/**
 * GET /score/rewards
 * Returns reward history for the authenticated account.
 * Shows period, amount, total pool, participant count.
 */
router.get('/rewards', (req: Request, res: Response) => {
  if (!rewardsService) {
    return res.status(503).json({ error: 'Service unavailable' });
  }

  const accountId = (req as any).accountId;
  if (!accountId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const rewards = rewardsService.getRewardsHistory(accountId);

  return res.json({
    accountId,
    rewards: rewards.map(r => ({
      period: r.period,
      rewardMicro: r.rewardMicro,
      poolSizeMicro: r.poolSizeMicro,
      participantCount: r.participantCount,
      totalScore: r.totalScore,
    })),
  });
});

export { router as scoreRewardsRouter };
