/**
 * Hot-Path Service
 * Sprint S-9: Hot-Path Migration
 *
 * Service layer that bridges command handlers with ScyllaDB repositories.
 * Replaces PostgreSQL for score/leaderboard hot-path queries while maintaining
 * compatibility with existing handler interfaces.
 *
 * Strategy:
 * - Scores/Leaderboards: ScyllaDB (fast, multi-tenant)
 * - Profile metadata: PostgreSQL (source of truth for profile data)
 * - Eligibility: ScyllaDB with multi-level caching (Redis L1 + ScyllaDB L2)
 */

import type { Logger } from 'pino';
import type { TenantRequestContext } from './TenantContext.js';
import type { ScoreRepository } from '../repositories/ScoreRepository.js';
import type { LeaderboardRepository, LeaderboardPage } from '../repositories/LeaderboardRepository.js';
import type { EligibilityRepository, EligibilityCheckResult, EligibilityRule, EligibilityChecker, EligibilityCheckRequest } from '../repositories/EligibilityRepository.js';
import type { Score, LeaderboardEntry } from '../infrastructure/scylla/types.js';
import { recordCommand } from './TenantMetrics.js';

// --------------------------------------------------------------------------
// Types - Handler-compatible interfaces
// --------------------------------------------------------------------------

/**
 * Position data for /position command
 * Compatible with existing handler expectations
 */
export interface PositionData {
  position: number;
  convictionScore: number;
  distanceToAbove: number | null;
  distanceToBelow: number | null;
  distanceToEntry: number | null;
  isNaib: boolean;
  isFedaykin: boolean;
  isAtRisk: boolean;
}

/**
 * Threshold data for /threshold command
 */
export interface ThresholdData {
  entryThreshold: number;
  eligibleCount: number;
  waitlistCount: number;
  gapToEntry: number | null;
  updatedAt: Date;
}

/**
 * Waitlist position data
 */
export interface WaitlistPositionData {
  position: number;
  profileId: string;
  convictionScore: number;
  distanceToEntry: number;
}

/**
 * Member rank data for display
 */
export interface MemberRankData {
  rank: number;
  score: string;
  tier: string;
  profileId: string;
}

/**
 * Leaderboard entry for handler display
 * Maps from ScyllaDB LeaderboardEntry to handler-compatible format
 */
export interface HandlerLeaderboardEntry {
  rank: number;
  profileId: string;
  displayName: string;
  score: string;
  tier: string;
}

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

export interface HotPathConfig {
  /** Top N positions for Fedaykin eligibility */
  fedaykinThreshold: number;
  /** Top N positions for Naib eligibility */
  naibThreshold: number;
  /** Positions considered "at risk" of losing Fedaykin status */
  atRiskThreshold: number;
  /** Default page size for leaderboard queries */
  defaultPageSize: number;
}

const DEFAULT_CONFIG: HotPathConfig = {
  fedaykinThreshold: 69,
  naibThreshold: 7,
  atRiskThreshold: 63,
  defaultPageSize: 100,
};

// --------------------------------------------------------------------------
// Hot-Path Service
// --------------------------------------------------------------------------

export class HotPathService {
  private readonly log: Logger;
  private readonly scores: ScoreRepository;
  private readonly leaderboards: LeaderboardRepository;
  private readonly eligibility: EligibilityRepository;
  private readonly config: HotPathConfig;

  constructor(
    scoreRepository: ScoreRepository,
    leaderboardRepository: LeaderboardRepository,
    eligibilityRepository: EligibilityRepository,
    logger: Logger,
    config: Partial<HotPathConfig> = {}
  ) {
    this.scores = scoreRepository;
    this.leaderboards = leaderboardRepository;
    this.eligibility = eligibilityRepository;
    this.log = logger.child({ component: 'HotPathService' });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // Score Operations
  // --------------------------------------------------------------------------

  /**
   * Get score for a profile
   */
  async getScore(ctx: TenantRequestContext, profileId: string): Promise<Score | null> {
    const start = Date.now();
    try {
      const score = await this.scores.getScore(ctx, profileId);
      recordCommand(ctx.communityId, ctx.tier, 'hotpath_score_get', 'success', Date.now() - start);
      return score;
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'hotpath_score_get', 'error', Date.now() - start);
      this.log.error({ error, profileId }, 'Failed to get score from hot path');
      throw error;
    }
  }

  /**
   * Get scores for multiple profiles
   */
  async getScores(ctx: TenantRequestContext, profileIds: string[]): Promise<Map<string, Score>> {
    return this.scores.getScores(ctx, profileIds);
  }

  // --------------------------------------------------------------------------
  // Position Operations (replaces getPositionData from database.ts)
  // --------------------------------------------------------------------------

  /**
   * Get position data for a profile within the conviction leaderboard
   * This replaces the PostgreSQL getPositionData function
   */
  async getPositionData(
    ctx: TenantRequestContext,
    profileId: string
  ): Promise<PositionData | null> {
    const start = Date.now();

    try {
      // Get the profile's rank in the conviction leaderboard
      const profileRank = await this.leaderboards.getProfileRank(ctx, profileId, 'conviction');

      if (!profileRank) {
        this.log.debug({ profileId }, 'Profile not found in leaderboard');
        recordCommand(ctx.communityId, ctx.tier, 'hotpath_position_get', 'not_found', Date.now() - start);
        return null;
      }

      const position = profileRank.rank;
      const convictionScore = parseFloat(profileRank.score);

      // Get surrounding entries for distance calculations
      const nearbyEntries = await this.leaderboards.getProfilesAroundRank(
        ctx,
        'conviction',
        position,
        2 // Get 2 above and 2 below
      );

      // Calculate distances
      let distanceToAbove: number | null = null;
      let distanceToBelow: number | null = null;
      let distanceToEntry: number | null = null;

      // Find entry above (position - 1)
      const aboveEntry = nearbyEntries.find(e => e.rank === position - 1);
      if (aboveEntry) {
        distanceToAbove = parseFloat(aboveEntry.score) - convictionScore;
      }

      // Find entry below (position + 1)
      const belowEntry = nearbyEntries.find(e => e.rank === position + 1);
      if (belowEntry) {
        distanceToBelow = convictionScore - parseFloat(belowEntry.score);
      }

      // If not in top fedaykinThreshold, calculate distance to entry
      if (position > this.config.fedaykinThreshold) {
        const entryRank = await this.leaderboards.getProfilesAroundRank(
          ctx,
          'conviction',
          this.config.fedaykinThreshold,
          0
        );
        const entryEntry = entryRank.find(e => e.rank === this.config.fedaykinThreshold);
        if (entryEntry) {
          distanceToEntry = parseFloat(entryEntry.score) - convictionScore;
        }
      }

      const result: PositionData = {
        position,
        convictionScore,
        distanceToAbove,
        distanceToBelow,
        distanceToEntry,
        isNaib: position <= this.config.naibThreshold,
        isFedaykin: position <= this.config.fedaykinThreshold,
        isAtRisk: position > this.config.atRiskThreshold && position <= this.config.fedaykinThreshold,
      };

      recordCommand(ctx.communityId, ctx.tier, 'hotpath_position_get', 'success', Date.now() - start);
      return result;
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'hotpath_position_get', 'error', Date.now() - start);
      this.log.error({ error, profileId }, 'Failed to get position data');
      throw error;
    }
  }

  /**
   * Get threshold data for /threshold command
   * This replaces the PostgreSQL getThresholdData function
   */
  async getThresholdData(ctx: TenantRequestContext): Promise<ThresholdData> {
    const start = Date.now();

    try {
      // Get top entries up to fedaykinThreshold + a few more for waitlist
      const topEntries = await this.leaderboards.getTopEntries(
        ctx,
        'conviction',
        this.config.fedaykinThreshold + 31 // Get up to position 100
      );

      const eligibleCount = Math.min(topEntries.length, this.config.fedaykinThreshold);
      const waitlistCount = Math.max(0, Math.min(topEntries.length - this.config.fedaykinThreshold, 31));

      let entryThreshold = 0;
      let gapToEntry: number | null = null;

      // Get the score at the fedaykin threshold position
      const entryEntry = topEntries.find(e => e.rank === this.config.fedaykinThreshold);
      if (entryEntry) {
        entryThreshold = parseFloat(entryEntry.score);
      }

      // Calculate gap to first waitlist position
      const firstWaitlist = topEntries.find(e => e.rank === this.config.fedaykinThreshold + 1);
      if (firstWaitlist) {
        gapToEntry = entryThreshold - parseFloat(firstWaitlist.score);
      }

      const result: ThresholdData = {
        entryThreshold,
        eligibleCount,
        waitlistCount,
        gapToEntry,
        updatedAt: new Date(),
      };

      recordCommand(ctx.communityId, ctx.tier, 'hotpath_threshold_get', 'success', Date.now() - start);
      return result;
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'hotpath_threshold_get', 'error', Date.now() - start);
      this.log.error({ error }, 'Failed to get threshold data');
      throw error;
    }
  }

  /**
   * Get top waitlist positions (positions just outside fedaykin threshold)
   */
  async getTopWaitlistPositions(
    ctx: TenantRequestContext,
    limit: number = 5
  ): Promise<WaitlistPositionData[]> {
    const start = Date.now();

    try {
      // Get entries starting from position fedaykinThreshold + 1
      const topEntries = await this.leaderboards.getTopEntries(
        ctx,
        'conviction',
        this.config.fedaykinThreshold + limit + 1
      );

      // Get the entry threshold score
      const entryEntry = topEntries.find(e => e.rank === this.config.fedaykinThreshold);
      const entryThreshold = entryEntry ? parseFloat(entryEntry.score) : 0;

      // Filter to waitlist positions
      const waitlistEntries = topEntries
        .filter(e => e.rank > this.config.fedaykinThreshold)
        .slice(0, limit)
        .map(entry => ({
          position: entry.rank,
          profileId: entry.profileId,
          convictionScore: parseFloat(entry.score),
          distanceToEntry: entryThreshold - parseFloat(entry.score),
        }));

      recordCommand(ctx.communityId, ctx.tier, 'hotpath_waitlist_get', 'success', Date.now() - start);
      return waitlistEntries;
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'hotpath_waitlist_get', 'error', Date.now() - start);
      this.log.error({ error }, 'Failed to get waitlist positions');
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Leaderboard Operations
  // --------------------------------------------------------------------------

  /**
   * Get conviction leaderboard page
   */
  async getConvictionLeaderboard(
    ctx: TenantRequestContext,
    page: number = 0,
    pageSize: number = this.config.defaultPageSize
  ): Promise<LeaderboardPage> {
    return this.leaderboards.getLeaderboard(ctx, 'conviction', page, pageSize);
  }

  /**
   * Get activity leaderboard page
   */
  async getActivityLeaderboard(
    ctx: TenantRequestContext,
    page: number = 0,
    pageSize: number = this.config.defaultPageSize
  ): Promise<LeaderboardPage> {
    return this.leaderboards.getLeaderboard(ctx, 'activity', page, pageSize);
  }

  /**
   * Get top entries for a leaderboard type
   */
  async getTopEntries(
    ctx: TenantRequestContext,
    type: 'conviction' | 'activity',
    limit: number = 10
  ): Promise<HandlerLeaderboardEntry[]> {
    const entries = await this.leaderboards.getTopEntries(ctx, type, limit);

    return entries.map(entry => ({
      rank: entry.rank,
      profileId: entry.profileId,
      displayName: entry.displayName,
      score: entry.score,
      tier: entry.tier,
    }));
  }

  /**
   * Get a profile's rank in a leaderboard
   */
  async getProfileRank(
    ctx: TenantRequestContext,
    profileId: string,
    type: 'conviction' | 'activity' = 'conviction'
  ): Promise<MemberRankData | null> {
    const rank = await this.leaderboards.getProfileRank(ctx, profileId, type);

    if (!rank) return null;

    return {
      rank: rank.rank,
      score: rank.score,
      tier: rank.tier,
      profileId: rank.profileId,
    };
  }

  // --------------------------------------------------------------------------
  // Eligibility Operations
  // --------------------------------------------------------------------------

  /**
   * Check eligibility for a single request
   */
  async checkEligibility(
    ctx: TenantRequestContext,
    request: EligibilityCheckRequest,
    rule: EligibilityRule,
    checker: EligibilityChecker
  ): Promise<EligibilityCheckResult> {
    return this.eligibility.checkEligibility(ctx, request, rule, checker);
  }

  /**
   * Batch check eligibility
   */
  async batchCheckEligibility(
    ctx: TenantRequestContext,
    requests: EligibilityCheckRequest[],
    rule: EligibilityRule,
    checker: EligibilityChecker
  ): Promise<EligibilityCheckResult[]> {
    return this.eligibility.batchCheckEligibility(ctx, requests, rule, checker);
  }

  /**
   * Invalidate eligibility cache for a profile
   */
  async invalidateEligibilityCache(
    ctx: TenantRequestContext,
    profileId: string,
    ruleId?: string
  ): Promise<void> {
    return this.eligibility.invalidateCache(ctx, profileId, ruleId);
  }

  // --------------------------------------------------------------------------
  // Bulk Operations (for sync/migration)
  // --------------------------------------------------------------------------

  /**
   * Recalculate leaderboard from scores
   * Used for periodic leaderboard refresh
   */
  async recalculateLeaderboard(
    ctx: TenantRequestContext,
    scores: Score[],
    type: 'conviction' | 'activity',
    limit: number = 1000
  ): Promise<number> {
    const start = Date.now();

    try {
      const updated = await this.leaderboards.recalculateLeaderboard(ctx, scores, {
        type,
        limit,
      });

      recordCommand(ctx.communityId, ctx.tier, 'hotpath_leaderboard_recalculate', 'success', Date.now() - start);
      this.log.info({ communityId: ctx.communityId, type, updated }, 'Leaderboard recalculated');

      return updated;
    } catch (error) {
      recordCommand(ctx.communityId, ctx.tier, 'hotpath_leaderboard_recalculate', 'error', Date.now() - start);
      this.log.error({ error, type }, 'Failed to recalculate leaderboard');
      throw error;
    }
  }
}
