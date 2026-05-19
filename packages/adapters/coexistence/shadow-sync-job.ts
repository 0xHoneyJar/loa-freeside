/**
 * ShadowSyncJob Implementation
 *
 * Sprint S-25: Shadow Sync Job & Verification Tiers
 *
 * Implements IShadowSync for 6-hour periodic comparison between
 * incumbent and Arrakis eligibility without Discord mutations.
 *
 * @see SDD §7.1.4 Shadow Sync Job
 */

import type { Logger } from 'pino';
import type {
  IShadowSync,
  ShadowSyncOptions,
  MemberFetchOptions,
  MemberFetchResult,
  ShadowDigest,
} from '@freeside/core/ports';
import type { IShadowLedger } from '@freeside/core/ports';
import type {
  ShadowSyncResult,
  ShadowMemberState,
  CoexistenceConfig,
  CoexistenceMode,
  IncumbentState,
  ArrakisEligibilityResult,
  DEFAULT_SHADOW_SYNC_INTERVAL_HOURS,
  DEFAULT_MIN_ACCURACY_FOR_PARALLEL,
  DEFAULT_MIN_SHADOW_DAYS_FOR_PARALLEL,
} from '@freeside/core/domain';
import type {
  VerificationTier,
  CommunityVerificationStatus,
  TierUpgradeRequirements,
  DEFAULT_TIER_UPGRADE_REQUIREMENTS,
} from '@freeside/core/domain';

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Discord REST service interface for member fetching.
 */
export interface IDiscordMemberService {
  /**
   * Get guild members with cursor-based pagination.
   */
  getGuildMembers(
    guildId: string,
    options?: { limit?: number; after?: string }
  ): Promise<GuildMemberData[]>;
}

/**
 * Guild member data from Discord API.
 */
export interface GuildMemberData {
  user: { id: string };
  roles: string[];
}

/**
 * Community repository interface for wallet lookups.
 */
export interface ICommunityRepository {
  /**
   * Get community by ID.
   */
  getCommunity(communityId: string): Promise<{
    id: string;
    guildId: string;
    verificationTier: VerificationTier;
    coexistenceMode: CoexistenceMode;
    shadowDays: number;
    digestEnabled: boolean;
    adminChannelId?: string;
  } | null>;

  /**
   * Get verified wallet for a user in a community.
   */
  getVerifiedWallet(communityId: string, userId: string): Promise<string | null>;

  /**
   * Get incumbent role IDs for a community.
   */
  getIncumbentRoleIds(communityId: string, guildId: string): Promise<string[]>;

  /**
   * Get eligibility rules for a community.
   */
  getEligibilityRules(communityId: string): Promise<EligibilityRule[]>;

  /**
   * Get all communities in shadow mode.
   */
  getShadowModeCommunities(): Promise<string[]>;

  /**
   * Update community coexistence config.
   */
  updateCoexistenceConfig(
    communityId: string,
    config: Partial<CoexistenceConfig>
  ): Promise<void>;

  /**
   * Update verification tier for community.
   */
  updateVerificationTier(
    communityId: string,
    tier: VerificationTier
  ): Promise<void>;
}

/**
 * Eligibility rule for checking wallet eligibility.
 */
export interface EligibilityRule {
  ruleType: 'token_balance' | 'nft_ownership' | 'score_threshold';
  chainId: string;
  contractAddress: string;
  minAmount?: bigint;
  minScore?: number;
}

/**
 * Chain provider interface for eligibility checks.
 */
export interface IEligibilityChecker {
  /**
   * Calculate Arrakis eligibility for a wallet.
   */
  checkEligibility(
    rules: EligibilityRule[],
    walletAddress: string
  ): Promise<ArrakisEligibilityResult>;
}

/**
 * NATS client interface for event publishing.
 */
export interface INatsPublisher {
  /**
   * Publish an event.
   */
  publish(subject: string, data: unknown): Promise<void>;
}

/**
 * Metrics client interface for observability.
 */
export interface IMetricsClient {
  /**
   * Record sync duration.
   */
  shadowSyncDuration: {
    observe(labels: { community_id: string }, value: number): void;
  };
  /**
   * Set accuracy metric.
   */
  shadowSyncAccuracy: {
    set(labels: { community_id: string }, value: number): void;
  };
  /**
   * Increment divergence counter.
   */
  shadowDivergences: {
    inc(labels: { community_id: string; type: string }): void;
  };
}

// =============================================================================
// ShadowSyncJob Implementation
// =============================================================================

/**
 * Shadow sync job options.
 */
export interface ShadowSyncJobOptions {
  /** Default sync interval in hours (default: 6) */
  syncIntervalHours?: number;
  /** Batch size for member fetching (default: 1000) */
  memberBatchSize?: number;
  /** Maximum concurrent eligibility checks (default: 10) */
  maxConcurrentChecks?: number;
}

/**
 * ShadowSyncJob implements periodic shadow comparison.
 *
 * CRITICAL: This job MUST NOT mutate any Discord state.
 */
export class ShadowSyncJob implements IShadowSync {
  private readonly discord: IDiscordMemberService;
  private readonly shadowLedger: IShadowLedger;
  private readonly communities: ICommunityRepository;
  private readonly eligibility: IEligibilityChecker;
  private readonly nats: INatsPublisher;
  private readonly metrics: IMetricsClient;
  private readonly log: Logger;
  private readonly options: Required<ShadowSyncJobOptions>;

  constructor(
    discord: IDiscordMemberService,
    shadowLedger: IShadowLedger,
    communities: ICommunityRepository,
    eligibility: IEligibilityChecker,
    nats: INatsPublisher,
    metrics: IMetricsClient,
    logger: Logger,
    options?: ShadowSyncJobOptions
  ) {
    this.discord = discord;
    this.shadowLedger = shadowLedger;
    this.communities = communities;
    this.eligibility = eligibility;
    this.nats = nats;
    this.metrics = metrics;
    this.log = logger.child({ component: 'ShadowSyncJob' });
    this.options = {
      syncIntervalHours: options?.syncIntervalHours ?? 6,
      memberBatchSize: options?.memberBatchSize ?? 1000,
      maxConcurrentChecks: options?.maxConcurrentChecks ?? 10,
    };
  }

  // ===========================================================================
  // Core Sync Operations
  // ===========================================================================

  /**
   * Run shadow sync for a community.
   * CRITICAL: This job MUST NOT mutate any Discord state.
   */
  async sync(
    communityId: string,
    guildId: string,
    options?: ShadowSyncOptions
  ): Promise<ShadowSyncResult> {
    const startTime = Date.now();
    this.log.info({ communityId, guildId }, 'Starting shadow sync');

    const result: ShadowSyncResult = {
      communityId,
      guildId,
      syncedAt: new Date(),
      membersProcessed: 0,
      divergencesFound: 0,
      predictionsValidated: 0,
      accuracy: 0,
    };

    try {
      // Get eligibility rules
      const rules = await this.communities.getEligibilityRules(communityId);

      // Get incumbent role mappings
      const incumbentRoles = await this.communities.getIncumbentRoleIds(
        communityId,
        guildId
      );

      // Process members in batches using cursor-based pagination
      let processedCount = 0;
      const maxMembers = options?.maxMembers ?? 0;

      for await (const batch of this.fetchMembersIterator<GuildMemberData>(
        guildId,
        this.options.memberBatchSize
      )) {
        // Process batch concurrently with limit
        const batchPromises: Promise<void>[] = [];

        for (const member of batch) {
          if (maxMembers > 0 && processedCount >= maxMembers) break;

          batchPromises.push(
            this.processMember(
              communityId,
              guildId,
              member,
              rules,
              incumbentRoles,
              result
            )
          );

          // Limit concurrency
          if (batchPromises.length >= this.options.maxConcurrentChecks) {
            await Promise.all(batchPromises);
            batchPromises.length = 0;
          }

          processedCount++;
        }

        // Process remaining
        if (batchPromises.length > 0) {
          await Promise.all(batchPromises);
        }

        if (maxMembers > 0 && processedCount >= maxMembers) break;
      }

      // Validate previous predictions
      result.predictionsValidated = await this.validatePredictions(guildId);

      // Calculate accuracy
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      result.accuracy = await this.shadowLedger.calculateAccuracy(
        guildId,
        thirtyDaysAgo
      );

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      this.metrics.shadowSyncDuration.observe(
        { community_id: communityId },
        duration
      );
      this.metrics.shadowSyncAccuracy.set(
        { community_id: communityId },
        result.accuracy
      );

      // Publish sync complete event
      await this.nats.publish('coexist.shadow.sync.complete', {
        communityId,
        guildId,
        result,
      });

      // Send digest notification if enabled and not skipped
      if (!options?.skipNotification) {
        await this.maybeSendDigest(communityId, result);
      }

      this.log.info(
        { communityId, guildId, result, durationSec: duration },
        'Shadow sync completed'
      );

      return result;
    } catch (error) {
      this.log.error({ error, communityId, guildId }, 'Shadow sync failed');
      throw error;
    }
  }

  /**
   * Process a single member for shadow comparison.
   */
  private async processMember(
    communityId: string,
    guildId: string,
    member: GuildMemberData,
    rules: EligibilityRule[],
    incumbentRoles: string[],
    result: ShadowSyncResult
  ): Promise<void> {
    const userId = member.user.id;

    try {
      // Get verified wallet
      const walletAddress = await this.communities.getVerifiedWallet(
        communityId,
        userId
      );

      if (!walletAddress) {
        // No wallet - skip but don't count as processed
        return;
      }

      result.membersProcessed++;

      // Calculate Arrakis eligibility
      const arrakisResult = await this.eligibility.checkEligibility(
        rules,
        walletAddress
      );

      // Snapshot incumbent state
      const incumbentState: IncumbentState = {
        hasRole: member.roles.some((r) => incumbentRoles.includes(r)),
        roles: member.roles,
      };

      // Compare and check for divergence
      const divergent = incumbentState.hasRole !== arrakisResult.eligible;

      // Save shadow member state
      const state: ShadowMemberState = {
        guildId,
        userId,
        incumbentRoles: new Set(member.roles),
        arrakisEligible: arrakisResult.eligible,
        arrakisTier: arrakisResult.tier,
        convictionScore: arrakisResult.score,
        divergenceFlag: divergent,
        lastSyncAt: new Date(),
      };

      await this.shadowLedger.saveMemberState(state);

      // Record divergence if found
      if (divergent) {
        result.divergencesFound++;
        await this.shadowLedger.recordDivergence(
          guildId,
          userId,
          incumbentState,
          arrakisResult
        );

        const divergenceType = incumbentState.hasRole && !arrakisResult.eligible
          ? 'false_positive'
          : 'false_negative';

        this.metrics.shadowDivergences.inc({
          community_id: communityId,
          type: divergenceType,
        });
      }
    } catch (error) {
      this.log.warn(
        { error, communityId, userId },
        'Failed to process member for shadow sync'
      );
      // Continue with other members
    }
  }

  /**
   * Validate previous predictions.
   */
  private async validatePredictions(guildId: string): Promise<number> {
    const unverified = await this.shadowLedger.getUnverifiedPredictions(guildId);
    let validated = 0;

    for (const prediction of unverified) {
      // Get current state to verify prediction
      const state = await this.shadowLedger.getMemberState(
        guildId,
        prediction.userId
      );

      if (!state) continue;

      // Determine actual value based on prediction type
      let actualValue: string;
      switch (prediction.predictionType) {
        case 'role_grant':
        case 'role_revoke':
          actualValue = state.arrakisEligible ? 'eligible' : 'ineligible';
          break;
        case 'tier_change':
          actualValue = state.arrakisTier ?? 'none';
          break;
        default:
          continue;
      }

      await this.shadowLedger.verifyPrediction(prediction.predictionId, actualValue);
      validated++;
    }

    return validated;
  }

  /**
   * Run shadow sync for all eligible communities.
   */
  async syncAll(): Promise<ShadowSyncResult[]> {
    const communities = await this.communities.getShadowModeCommunities();
    const results: ShadowSyncResult[] = [];

    this.log.info(
      { communityCount: communities.length },
      'Starting shadow sync for all communities'
    );

    for (const communityId of communities) {
      try {
        const isDue = await this.isSyncDue(communityId);
        if (!isDue) {
          this.log.debug({ communityId }, 'Sync not due, skipping');
          continue;
        }

        const community = await this.communities.getCommunity(communityId);
        if (!community) continue;

        const result = await this.sync(communityId, community.guildId);
        results.push(result);
      } catch (error) {
        this.log.error(
          { error, communityId },
          'Failed to sync community, continuing with others'
        );
      }
    }

    this.log.info(
      { syncedCount: results.length },
      'Completed shadow sync for all communities'
    );

    return results;
  }

  /**
   * Check if sync is due based on interval.
   */
  async isSyncDue(communityId: string): Promise<boolean> {
    const lastResult = await this.getLastSyncResult(communityId);
    if (!lastResult) return true;

    const intervalMs = this.options.syncIntervalHours * 60 * 60 * 1000;
    const elapsed = Date.now() - lastResult.syncedAt.getTime();

    return elapsed >= intervalMs;
  }

  /**
   * Get last sync result for a community.
   */
  async getLastSyncResult(communityId: string): Promise<ShadowSyncResult | null> {
    const community = await this.communities.getCommunity(communityId);
    if (!community) return null;

    const stats = await this.shadowLedger.getStats(community.guildId);
    if (!stats.lastSyncAt) return null;

    // Reconstruct result from stats
    return {
      communityId,
      guildId: community.guildId,
      syncedAt: stats.lastSyncAt,
      membersProcessed: stats.totalMembers,
      divergencesFound: stats.divergentMembers,
      predictionsValidated: stats.verifiedPredictions,
      accuracy: stats.accuracy,
    };
  }

  // ===========================================================================
  // Member Fetch Operations
  // ===========================================================================

  /**
   * Fetch guild members with cursor-based pagination.
   */
  async fetchMembers<T>(
    guildId: string,
    options?: MemberFetchOptions
  ): Promise<MemberFetchResult<T>> {
    const batchSize = Math.min(options?.batchSize ?? 1000, 1000);

    const batch = await this.discord.getGuildMembers(guildId, {
      limit: batchSize,
      after: options?.after,
    });

    const members = batch as unknown as T[];
    const nextCursor = batch.length > 0 ? batch[batch.length - 1]!.user.id : null;
    const hasMore = batch.length === batchSize;

    return {
      members,
      nextCursor,
      totalFetched: members.length,
      hasMore,
    };
  }

  /**
   * Fetch all members using async iteration.
   */
  async *fetchMembersIterator<T>(
    guildId: string,
    batchSize = 1000
  ): AsyncGenerator<T[], void, unknown> {
    let after: string | undefined;

    do {
      const batch = await this.discord.getGuildMembers(guildId, {
        limit: Math.min(batchSize, 1000),
        after,
      });

      if (batch.length === 0) break;

      yield batch as unknown as T[];

      after = batch[batch.length - 1]!.user.id;
    } while (after);
  }

  // ===========================================================================
  // Verification Tier Operations
  // ===========================================================================

  /**
   * Get verification status for a community.
   */
  async getVerificationStatus(
    communityId: string
  ): Promise<CommunityVerificationStatus | null> {
    const community = await this.communities.getCommunity(communityId);
    if (!community) return null;

    const stats = await this.shadowLedger.getStats(community.guildId);

    // Calculate next tier requirements
    let nextTierRequirements: TierUpgradeRequirements | null = null;

    if (community.verificationTier === 'incumbent_only') {
      nextTierRequirements = {
        targetTier: 'arrakis_basic',
        minShadowDays: 14,
        currentShadowDays: community.shadowDays,
        minAccuracy: 0.95,
        currentAccuracy: stats.accuracy,
        requirementsMet:
          community.shadowDays >= 14 && stats.accuracy >= 0.95,
      };
    } else if (community.verificationTier === 'arrakis_basic') {
      nextTierRequirements = {
        targetTier: 'arrakis_full',
        minShadowDays: 30,
        currentShadowDays: community.shadowDays,
        minAccuracy: 0.98,
        currentAccuracy: stats.accuracy,
        requirementsMet:
          community.shadowDays >= 30 && stats.accuracy >= 0.98,
      };
    }

    return {
      communityId,
      guildId: community.guildId,
      tier: community.verificationTier,
      daysInTier: community.shadowDays,
      shadowAccuracy: stats.accuracy,
      tierUpdatedAt: stats.lastSyncAt ?? new Date(),
      nextTierRequirements,
    };
  }

  /**
   * Check if community meets requirements for next tier.
   */
  async checkTierUpgradeEligibility(communityId: string): Promise<boolean> {
    const status = await this.getVerificationStatus(communityId);
    return status?.nextTierRequirements?.requirementsMet ?? false;
  }

  /**
   * Upgrade community to next tier if eligible.
   */
  async upgradeTier(communityId: string): Promise<VerificationTier | null> {
    const status = await this.getVerificationStatus(communityId);
    if (!status?.nextTierRequirements?.requirementsMet) return null;

    const newTier = status.nextTierRequirements.targetTier;
    await this.communities.updateVerificationTier(communityId, newTier);

    this.log.info(
      { communityId, oldTier: status.tier, newTier },
      'Upgraded community verification tier'
    );

    await this.nats.publish('coexist.tier.upgraded', {
      communityId,
      guildId: status.guildId,
      oldTier: status.tier,
      newTier,
    });

    return newTier;
  }

  // ===========================================================================
  // Notification Operations
  // ===========================================================================

  /**
   * Generate shadow digest for a community.
   */
  async generateDigest(communityId: string): Promise<ShadowDigest | null> {
    const community = await this.communities.getCommunity(communityId);
    if (!community) return null;

    const stats = await this.shadowLedger.getStats(community.guildId);
    const divergenceCounts = await this.shadowLedger.getDivergenceCounts(
      community.guildId,
      new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
    );

    const accuracyTrend = await this.shadowLedger.getAccuracyTrend(
      community.guildId,
      7, // 7 days per bucket
      4 // Last 4 weeks
    );

    const status = await this.getVerificationStatus(communityId);

    return {
      communityId,
      guildId: community.guildId,
      syncResult: {
        communityId,
        guildId: community.guildId,
        syncedAt: stats.lastSyncAt ?? new Date(),
        membersProcessed: stats.totalMembers,
        divergencesFound: stats.divergentMembers,
        predictionsValidated: stats.verifiedPredictions,
        accuracy: stats.accuracy,
      },
      divergenceSummary: {
        falsePositives: divergenceCounts.false_positive,
        falseNegatives: divergenceCounts.false_negative,
        newDivergences:
          divergenceCounts.false_positive + divergenceCounts.false_negative,
      },
      accuracyTrend,
      tierStatus: {
        currentTier: community.verificationTier,
        daysUntilUpgradeEligible:
          status?.nextTierRequirements
            ? Math.max(
                0,
                status.nextTierRequirements.minShadowDays -
                  status.nextTierRequirements.currentShadowDays
              )
            : null,
        accuracyNeeded:
          status?.nextTierRequirements
            ? status.nextTierRequirements.minAccuracy -
              status.nextTierRequirements.currentAccuracy
            : null,
      },
      generatedAt: new Date(),
    };
  }

  /**
   * Send shadow digest notification to community admins.
   */
  async sendDigestNotification(
    communityId: string,
    digest: ShadowDigest
  ): Promise<boolean> {
    const community = await this.communities.getCommunity(communityId);
    if (!community?.adminChannelId) return false;

    // Publish to NATS for the notification worker to handle
    await this.nats.publish('coexist.shadow.digest.send', {
      communityId,
      channelId: community.adminChannelId,
      digest,
    });

    this.log.info(
      { communityId, channelId: community.adminChannelId },
      'Shadow digest notification queued'
    );

    return true;
  }

  /**
   * Maybe send digest if enabled and divergences found.
   */
  private async maybeSendDigest(
    communityId: string,
    result: ShadowSyncResult
  ): Promise<void> {
    const enabled = await this.isDigestEnabled(communityId);
    if (!enabled) return;

    if (result.divergencesFound === 0 && result.accuracy >= 0.95) {
      // No need to notify if everything is good
      return;
    }

    const digest = await this.generateDigest(communityId);
    if (digest) {
      await this.sendDigestNotification(communityId, digest);
    }
  }

  /**
   * Check if community has opted into digest notifications.
   */
  async isDigestEnabled(communityId: string): Promise<boolean> {
    const community = await this.communities.getCommunity(communityId);
    return community?.digestEnabled ?? false;
  }

  /**
   * Enable or disable digest notifications for a community.
   */
  async setDigestEnabled(communityId: string, enabled: boolean): Promise<void> {
    await this.communities.updateCoexistenceConfig(communityId, {
      communityId,
      guildId: '', // Will be filled by repository
      mode: 'shadow',
      incumbentInfo: null,
      syncIntervalHours: this.options.syncIntervalHours,
      lastSyncAt: null,
      shadowAccuracy: null,
      shadowDays: 0,
      minAccuracyForParallel: 0.95,
      minShadowDaysForParallel: 14,
    });

    this.log.info(
      { communityId, enabled },
      'Updated digest notification setting'
    );
  }

  // ===========================================================================
  // Configuration Operations
  // ===========================================================================

  /**
   * Get coexistence configuration for a community.
   */
  async getConfig(communityId: string): Promise<CoexistenceConfig | null> {
    const community = await this.communities.getCommunity(communityId);
    if (!community) return null;

    const stats = await this.shadowLedger.getStats(community.guildId);

    return {
      communityId,
      guildId: community.guildId,
      mode: community.coexistenceMode,
      incumbentInfo: null, // Would need separate lookup
      syncIntervalHours: this.options.syncIntervalHours,
      lastSyncAt: stats.lastSyncAt,
      shadowAccuracy: stats.accuracy,
      shadowDays: community.shadowDays,
      minAccuracyForParallel: 0.95,
      minShadowDaysForParallel: 14,
    };
  }

  /**
   * Update coexistence configuration.
   */
  async updateConfig(
    config: Partial<CoexistenceConfig> & { communityId: string }
  ): Promise<CoexistenceConfig> {
    await this.communities.updateCoexistenceConfig(config.communityId, config);
    const updated = await this.getConfig(config.communityId);
    if (!updated) throw new Error(`Community ${config.communityId} not found`);
    return updated;
  }

  /**
   * Get all communities in shadow mode.
   */
  async getShadowModeCommunities(): Promise<string[]> {
    return this.communities.getShadowModeCommunities();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ShadowSyncJob instance.
 */
export function createShadowSyncJob(
  discord: IDiscordMemberService,
  shadowLedger: IShadowLedger,
  communities: ICommunityRepository,
  eligibility: IEligibilityChecker,
  nats: INatsPublisher,
  metrics: IMetricsClient,
  logger: Logger,
  options?: ShadowSyncJobOptions
): ShadowSyncJob {
  return new ShadowSyncJob(
    discord,
    shadowLedger,
    communities,
    eligibility,
    nats,
    metrics,
    logger,
    options
  );
}
