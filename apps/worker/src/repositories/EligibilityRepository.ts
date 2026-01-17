/**
 * Eligibility Repository
 * Sprint S-8: ScyllaDB Integration
 *
 * Repository pattern for eligibility checks with ScyllaDB caching.
 * Integrates with tenant context for multi-tenancy.
 */

import type { Logger } from 'pino';
import type { ScyllaClient } from '../infrastructure/scylla/scylla-client.js';
import type { EligibilitySnapshot } from '../infrastructure/scylla/types.js';
import type { TenantRequestContext } from '../services/TenantContext.js';
import type { StateManager } from '../services/StateManager.js';
import { recordEligibilityCheck, recordCommand } from '../services/TenantMetrics.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface EligibilityCheckRequest {
  profileId: string;
  walletAddress: string;
  ruleId: string;
}

export interface EligibilityCheckResult {
  profileId: string;
  ruleId: string;
  isEligible: boolean;
  tokenBalance: string;
  checkedAt: Date;
  blockNumber: bigint;
  fromCache: boolean;
}

export interface EligibilityRule {
  ruleId: string;
  contractAddress: string;
  minBalance: string;
  chainId: number;
}

export type EligibilityChecker = (
  walletAddress: string,
  rule: EligibilityRule
) => Promise<{ isEligible: boolean; balance: string; blockNumber: bigint }>;

// --------------------------------------------------------------------------
// Eligibility Repository
// --------------------------------------------------------------------------

export class EligibilityRepository {
  private readonly log: Logger;
  private readonly scylla: ScyllaClient;
  private readonly stateManager: StateManager;
  private readonly cacheTtlMs: number;

  constructor(
    scyllaClient: ScyllaClient,
    stateManager: StateManager,
    logger: Logger,
    cacheTtlMs = 300_000 // 5 minutes
  ) {
    this.scylla = scyllaClient;
    this.stateManager = stateManager;
    this.log = logger.child({ component: 'EligibilityRepository' });
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Check eligibility with multi-level caching
   * L1: Redis (fast, shared)
   * L2: ScyllaDB (persistent)
   */
  async checkEligibility(
    ctx: TenantRequestContext,
    request: EligibilityCheckRequest,
    rule: EligibilityRule,
    checker: EligibilityChecker
  ): Promise<EligibilityCheckResult> {
    const startTime = Date.now();
    const { profileId, walletAddress, ruleId } = request;

    try {
      // L1: Check Redis cache
      const redisKey = this.getRedisKey(ctx.communityId, profileId, ruleId);
      const cached = await this.stateManager.get(redisKey);

      if (cached) {
        const snapshot = JSON.parse(cached) as EligibilitySnapshot;
        const age = Date.now() - new Date(snapshot.checkedAt).getTime();

        if (age < this.cacheTtlMs) {
          const duration = (Date.now() - startTime) / 1000;
          recordCommand(ctx.communityId, ctx.tier, 'eligibility_check', 'success', duration);
          recordEligibilityCheck(ctx.communityId, ctx.tier, 'single', snapshot.isEligible ? 'eligible' : 'ineligible');

          this.log.debug({ communityId: ctx.communityId, profileId, ruleId, cache: 'redis' }, 'Eligibility cache hit');

          return {
            profileId,
            ruleId,
            isEligible: snapshot.isEligible,
            tokenBalance: snapshot.tokenBalance,
            checkedAt: new Date(snapshot.checkedAt),
            blockNumber: BigInt(snapshot.blockNumber),
            fromCache: true,
          };
        }
      }

      // L2: Check ScyllaDB cache
      const scyllaSnapshot = await this.scylla.getEligibilitySnapshot(ctx.communityId, profileId, ruleId);

      if (scyllaSnapshot) {
        const age = Date.now() - scyllaSnapshot.checkedAt.getTime();

        if (age < this.cacheTtlMs) {
          // Warm Redis cache
          await this.warmRedisCache(redisKey, scyllaSnapshot);

          const duration = (Date.now() - startTime) / 1000;
          recordCommand(ctx.communityId, ctx.tier, 'eligibility_check', 'success', duration);
          recordEligibilityCheck(ctx.communityId, ctx.tier, 'single', scyllaSnapshot.isEligible ? 'eligible' : 'ineligible');

          this.log.debug({ communityId: ctx.communityId, profileId, ruleId, cache: 'scylla' }, 'Eligibility cache hit');

          return {
            profileId,
            ruleId,
            isEligible: scyllaSnapshot.isEligible,
            tokenBalance: scyllaSnapshot.tokenBalance,
            checkedAt: scyllaSnapshot.checkedAt,
            blockNumber: scyllaSnapshot.blockNumber,
            fromCache: true,
          };
        }
      }

      // Cache miss - perform fresh check
      const checkResult = await checker(walletAddress, rule);

      const snapshot: EligibilitySnapshot = {
        communityId: ctx.communityId,
        profileId,
        walletAddress,
        ruleId,
        isEligible: checkResult.isEligible,
        tokenBalance: checkResult.balance,
        checkedAt: new Date(),
        blockNumber: checkResult.blockNumber,
      };

      // Save to both caches
      await this.saveSnapshot(ctx, snapshot);

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'eligibility_check', 'success', duration);
      recordEligibilityCheck(ctx.communityId, ctx.tier, 'single', snapshot.isEligible ? 'eligible' : 'ineligible');

      this.log.debug({ communityId: ctx.communityId, profileId, ruleId, cache: 'miss' }, 'Eligibility check performed');

      return {
        profileId,
        ruleId,
        isEligible: snapshot.isEligible,
        tokenBalance: snapshot.tokenBalance,
        checkedAt: snapshot.checkedAt,
        blockNumber: snapshot.blockNumber,
        fromCache: false,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'eligibility_check', 'error', duration);
      recordEligibilityCheck(ctx.communityId, ctx.tier, 'single', 'error');

      this.log.error({ error, communityId: ctx.communityId, request }, 'Eligibility check failed');
      throw error;
    }
  }

  /**
   * Batch check eligibility (for sync operations)
   */
  async batchCheckEligibility(
    ctx: TenantRequestContext,
    requests: EligibilityCheckRequest[],
    rule: EligibilityRule,
    checker: EligibilityChecker
  ): Promise<EligibilityCheckResult[]> {
    const startTime = Date.now();
    const results: EligibilityCheckResult[] = [];

    try {
      // Check cache for all requests
      const cached: Map<string, EligibilitySnapshot> = new Map();
      const uncached: EligibilityCheckRequest[] = [];

      for (const req of requests) {
        const redisKey = this.getRedisKey(ctx.communityId, req.profileId, req.ruleId);
        const data = await this.stateManager.get(redisKey);

        if (data) {
          const snapshot = JSON.parse(data) as EligibilitySnapshot;
          const age = Date.now() - new Date(snapshot.checkedAt).getTime();

          if (age < this.cacheTtlMs) {
            cached.set(req.profileId, snapshot);
            continue;
          }
        }

        uncached.push(req);
      }

      // Return cached results
      for (const [profileId, snapshot] of cached) {
        results.push({
          profileId,
          ruleId: snapshot.ruleId,
          isEligible: snapshot.isEligible,
          tokenBalance: snapshot.tokenBalance,
          checkedAt: new Date(snapshot.checkedAt),
          blockNumber: BigInt(snapshot.blockNumber),
          fromCache: true,
        });
      }

      // Perform fresh checks for uncached
      for (const req of uncached) {
        try {
          const checkResult = await checker(req.walletAddress, rule);

          const snapshot: EligibilitySnapshot = {
            communityId: ctx.communityId,
            profileId: req.profileId,
            walletAddress: req.walletAddress,
            ruleId: req.ruleId,
            isEligible: checkResult.isEligible,
            tokenBalance: checkResult.balance,
            checkedAt: new Date(),
            blockNumber: checkResult.blockNumber,
          };

          await this.saveSnapshot(ctx, snapshot);

          results.push({
            profileId: req.profileId,
            ruleId: req.ruleId,
            isEligible: snapshot.isEligible,
            tokenBalance: snapshot.tokenBalance,
            checkedAt: snapshot.checkedAt,
            blockNumber: snapshot.blockNumber,
            fromCache: false,
          });
        } catch (error) {
          this.log.warn({ error, profileId: req.profileId }, 'Individual eligibility check failed in batch');
          // Continue with other checks
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'eligibility_batch', 'success', duration);
      recordEligibilityCheck(ctx.communityId, ctx.tier, 'batch', 'eligible');

      this.log.info(
        {
          communityId: ctx.communityId,
          total: requests.length,
          cached: cached.size,
          checked: uncached.length,
        },
        'Batch eligibility check completed'
      );

      return results;
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      recordCommand(ctx.communityId, ctx.tier, 'eligibility_batch', 'error', duration);
      recordEligibilityCheck(ctx.communityId, ctx.tier, 'batch', 'error');

      this.log.error({ error, communityId: ctx.communityId }, 'Batch eligibility check failed');
      throw error;
    }
  }

  /**
   * Invalidate eligibility cache for a profile
   */
  async invalidateCache(ctx: TenantRequestContext, profileId: string, ruleId?: string): Promise<void> {
    try {
      if (ruleId) {
        const redisKey = this.getRedisKey(ctx.communityId, profileId, ruleId);
        await this.stateManager.delete(redisKey);
      } else {
        // Invalidate all rules for profile - would need pattern match
        // For now, log as partial invalidation
        this.log.debug({ communityId: ctx.communityId, profileId }, 'Cache invalidation requested (partial)');
      }

      this.log.debug({ communityId: ctx.communityId, profileId, ruleId }, 'Eligibility cache invalidated');
    } catch (error) {
      this.log.warn({ error, communityId: ctx.communityId, profileId }, 'Cache invalidation failed');
    }
  }

  /**
   * Get cached snapshot without performing check
   */
  async getCachedSnapshot(
    ctx: TenantRequestContext,
    profileId: string,
    ruleId: string
  ): Promise<EligibilitySnapshot | null> {
    const redisKey = this.getRedisKey(ctx.communityId, profileId, ruleId);
    const data = await this.stateManager.get(redisKey);

    if (data) {
      return JSON.parse(data) as EligibilitySnapshot;
    }

    return this.scylla.getEligibilitySnapshot(ctx.communityId, profileId, ruleId);
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  private getRedisKey(communityId: string, profileId: string, ruleId: string): string {
    return `eligibility:${communityId}:${profileId}:${ruleId}`;
  }

  private async saveSnapshot(ctx: TenantRequestContext, snapshot: EligibilitySnapshot): Promise<void> {
    // Save to Redis (L1)
    const redisKey = this.getRedisKey(ctx.communityId, snapshot.profileId, snapshot.ruleId);
    const data = JSON.stringify({
      ...snapshot,
      blockNumber: snapshot.blockNumber.toString(),
    });
    await this.stateManager.set(redisKey, data, this.cacheTtlMs);

    // Save to ScyllaDB (L2)
    await this.scylla.saveEligibilitySnapshot(snapshot);
  }

  private async warmRedisCache(redisKey: string, snapshot: EligibilitySnapshot): Promise<void> {
    const data = JSON.stringify({
      ...snapshot,
      blockNumber: snapshot.blockNumber.toString(),
    });
    await this.stateManager.set(redisKey, data, this.cacheTtlMs);
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createEligibilityRepository(
  scyllaClient: ScyllaClient,
  stateManager: StateManager,
  logger: Logger
): EligibilityRepository {
  return new EligibilityRepository(scyllaClient, stateManager, logger);
}
