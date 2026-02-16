/**
 * ScoreRewardsService — Score-Weighted Reward Distribution
 *
 * Distributes rewards proportionally based on score snapshots.
 * Uses floor division with largest-remainder assigned to last participant
 * by stable sort order (same policy as revenue distribution, Sprint 3.3).
 *
 * Conservation invariant: sum of all rewards === poolSizeMicro (guaranteed)
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Tasks 12.1, 12.2
 *
 * @module packages/adapters/billing/ScoreRewardsService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface DistributionEntry {
  accountId: string;
  score: number;
  rewardMicro: bigint;
}

export interface DistributionResult {
  success: boolean;
  period: string;
  poolSizeMicro: bigint;
  participantCount: number;
  totalScore: number;
  entries: DistributionEntry[];
  distributionId?: string;
  error?: string;
}

export interface RewardHistoryEntry {
  period: string;
  rewardMicro: number;
  poolSizeMicro: number;
  participantCount: number;
  totalScore: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Default minimum pool size: $1 */
const MIN_POOL_SIZE_DEFAULT = 1_000_000n;

/** Pool ID for score rewards (non-withdrawable) */
export const SCORE_REWARDS_POOL = 'score:rewards';

// =============================================================================
// ScoreRewardsService
// =============================================================================

export class ScoreRewardsService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Distribute rewards proportionally based on scores for a period.
   *
   * Algorithm:
   * 1. Aggregate scores via wallet_links JOIN score_snapshots
   * 2. Abort if below minimum threshold
   * 3. Proportional shares: floor(account_score / total_score * pool_size)
   * 4. Remainder assigned to last participant by stable sort order
   *
   * Conservation: sum of all rewards === poolSizeMicro (guaranteed)
   */
  distributeRewards(
    period: string,
    poolSizeMicro: bigint,
    options?: { minThresholdMicro?: bigint },
  ): DistributionResult {
    const minThreshold = options?.minThresholdMicro ?? MIN_POOL_SIZE_DEFAULT;

    // Enforce minimum pool size
    if (poolSizeMicro < minThreshold) {
      return {
        success: false, period, poolSizeMicro,
        participantCount: 0, totalScore: 0, entries: [],
        error: 'BELOW_THRESHOLD',
      };
    }

    // Idempotent: reject duplicate distribution for same period
    const existing = this.db.prepare(
      `SELECT id FROM score_distributions WHERE period = ?`
    ).get(period) as { id: string } | undefined;

    if (existing) {
      return {
        success: false, period, poolSizeMicro,
        participantCount: 0, totalScore: 0, entries: [],
        error: 'ALREADY_DISTRIBUTED',
      };
    }

    // Aggregate scores: wallet_links -> score_snapshots -> per-account totals
    // Stable sort: score DESC, account_id ASC
    const scores = this.db.prepare(`
      SELECT wl.account_id, CAST(SUM(ss.score) AS INTEGER) as total_score
      FROM wallet_links wl
      JOIN score_snapshots ss
        ON ss.wallet_address = wl.wallet_address
        AND ss.chain_id = wl.chain_id
        AND ss.snapshot_period = ?
      WHERE wl.unlinked_at IS NULL
      GROUP BY wl.account_id
      HAVING total_score > 0
      ORDER BY total_score DESC, wl.account_id ASC
    `).all(period) as { account_id: string; total_score: number }[];

    if (scores.length === 0) {
      return {
        success: false, period, poolSizeMicro,
        participantCount: 0, totalScore: 0, entries: [],
        error: 'NO_PARTICIPANTS',
      };
    }

    const totalScore = scores.reduce((sum, s) => sum + s.total_score, 0);

    // Proportional shares with floor division (BigInt truncation)
    const entries: DistributionEntry[] = [];
    let distributed = 0n;

    for (const s of scores) {
      const share = (poolSizeMicro * BigInt(s.total_score)) / BigInt(totalScore);
      entries.push({
        accountId: s.account_id,
        score: s.total_score,
        rewardMicro: share,
      });
      distributed += share;
    }

    // Largest-remainder: assign residual to last participant by stable sort
    const remainder = poolSizeMicro - distributed;
    if (remainder > 0n && entries.length > 0) {
      entries[entries.length - 1].rewardMicro += remainder;
    }

    // Record distribution atomically
    const distributionId = randomUUID();

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO score_distributions (id, period, pool_size_micro, participant_count, total_score)
        VALUES (?, ?, ?, ?, ?)
      `).run(distributionId, period, Number(poolSizeMicro), entries.length, totalScore);
    })();

    logger.info({
      event: 'score.distribution',
      period,
      distributionId,
      poolSizeMicro: poolSizeMicro.toString(),
      participantCount: entries.length,
      totalScore,
      remainder: remainder.toString(),
    }, `Score distribution: ${entries.length} participants, pool ${poolSizeMicro}`);

    return {
      success: true,
      period,
      poolSizeMicro,
      participantCount: entries.length,
      totalScore,
      entries,
      distributionId,
    };
  }

  /**
   * Get reward history for an account.
   * Calculates per-account reward from distribution data + scores.
   */
  getRewardsHistory(accountId: string): RewardHistoryEntry[] {
    return this.db.prepare(`
      SELECT
        sd.period,
        CAST(sd.pool_size_micro * SUM(ss.score) / sd.total_score AS INTEGER) as rewardMicro,
        sd.pool_size_micro as poolSizeMicro,
        sd.participant_count as participantCount,
        sd.total_score as totalScore
      FROM score_distributions sd
      JOIN wallet_links wl ON wl.account_id = ?
        AND wl.unlinked_at IS NULL
      JOIN score_snapshots ss
        ON ss.wallet_address = wl.wallet_address
        AND ss.chain_id = wl.chain_id
        AND ss.snapshot_period = sd.period
      GROUP BY sd.period
      ORDER BY sd.period DESC
    `).all(accountId) as RewardHistoryEntry[];
  }
}
