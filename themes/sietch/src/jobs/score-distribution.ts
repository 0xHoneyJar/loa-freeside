/**
 * Score Distribution Cron Job
 *
 * Monthly score-weighted reward distribution.
 * Triggers on the 1st of each month for the previous month's period.
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Task 12.3
 *
 * @module jobs/score-distribution
 */

import type Database from 'better-sqlite3';
import { ScoreRewardsService } from '../packages/adapters/billing/ScoreRewardsService.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ScoreDistributionConfig {
  db: Database.Database;
  /** Pool size in micro-USD. Default: $50,000 */
  poolSizeMicro?: bigint;
  /** Minimum threshold to trigger distribution. Default: $1 */
  minThresholdMicro?: bigint;
}

export interface ScoreDistributionRunResult {
  distributed: boolean;
  period: string;
  participantCount: number;
  error?: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Default foundation score rewards pool: $50,000 */
const DEFAULT_POOL_SIZE_MICRO = 50_000_000_000n;

// =============================================================================
// Helpers
// =============================================================================

/** Get the previous month's period string (YYYY-MM) */
function getPreviousPeriod(): string {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${year}-${month.toString().padStart(2, '0')}`;
}

// =============================================================================
// Score Distribution Job
// =============================================================================

export function createScoreDistribution(config: ScoreDistributionConfig): {
  runOnce: (period?: string) => ScoreDistributionRunResult;
} {
  const {
    db,
    poolSizeMicro = DEFAULT_POOL_SIZE_MICRO,
    minThresholdMicro,
  } = config;

  function runOnce(period?: string): ScoreDistributionRunResult {
    const targetPeriod = period ?? getPreviousPeriod();
    const service = new ScoreRewardsService(db);

    const result = service.distributeRewards(targetPeriod, poolSizeMicro, {
      minThresholdMicro,
    });

    if (!result.success) {
      logger.info({
        event: 'score.distribution.skipped',
        period: targetPeriod,
        reason: result.error,
      }, `Score distribution skipped for ${targetPeriod}: ${result.error}`);

      return {
        distributed: false,
        period: targetPeriod,
        participantCount: 0,
        error: result.error,
      };
    }

    logger.info({
      event: 'score.distribution.completed',
      period: targetPeriod,
      participantCount: result.participantCount,
      poolSizeMicro: poolSizeMicro.toString(),
    }, `Score distribution completed for ${targetPeriod}: ${result.participantCount} participants`);

    return {
      distributed: true,
      period: targetPeriod,
      participantCount: result.participantCount,
    };
  }

  return { runOnce };
}
