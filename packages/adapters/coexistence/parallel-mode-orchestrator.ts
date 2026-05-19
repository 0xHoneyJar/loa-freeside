/**
 * ParallelModeOrchestrator Implementation
 *
 * Sprint S-26: Namespaced Roles & Parallel Channels
 *
 * Orchestrates parallel mode operations by coordinating the
 * NamespacedRoleManager and ChannelStrategyManager.
 *
 * @see SDD §7.2 Parallel Mode Architecture
 */

import type { Logger } from 'pino';
import type {
  IParallelMode,
  INamespacedRoleManager,
  IChannelStrategyManager,
  ParallelModeReadiness,
  ParallelModeSyncResult,
  TierRoleConfig,
} from '@freeside/core/ports';
import type {
  ParallelModeConfig,
  ParallelModeStatus,
  MemberEligibility,
  RoleSyncResult,
} from '@freeside/core/domain';
import {
  DEFAULT_NAMESPACED_ROLE_CONFIG,
  DEFAULT_CHANNEL_STRATEGY_CONFIG,
} from '@freeside/core/domain';

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Community service interface for parallel mode.
 */
export interface IParallelModeCommunityService {
  /**
   * Get parallel mode config for a community.
   */
  getParallelModeConfig(communityId: string): Promise<ParallelModeConfig | null>;

  /**
   * Save parallel mode config.
   */
  saveParallelModeConfig(config: ParallelModeConfig): Promise<void>;

  /**
   * Get community guild ID.
   */
  getGuildId(communityId: string): Promise<string | null>;

  /**
   * Get all tier configurations for a community.
   */
  getTierConfigs(communityId: string): Promise<TierRoleConfig[]>;

  /**
   * Get member eligibility for all members in a community.
   */
  getMemberEligibilities(communityId: string, guildId: string): Promise<MemberEligibility[]>;

  /**
   * Get single member eligibility.
   */
  getMemberEligibility(
    communityId: string,
    guildId: string,
    userId: string
  ): Promise<MemberEligibility | null>;
}

/**
 * Shadow ledger interface for readiness checks.
 */
export interface IShadowLedgerReadiness {
  /**
   * Get shadow mode statistics for a community.
   */
  getStats(guildId: string): Promise<{
    totalMembers: number;
    divergentMembers: number;
    accuracy: number;
    lastSyncAt: Date | null;
  }>;
}

/**
 * Feature gate interface for readiness checks.
 */
export interface IFeatureGateReadiness {
  /**
   * Check if community has access to parallel mode feature.
   */
  checkAccess(context: {
    communityId: string;
    guildId: string;
    feature: 'profile_view' | 'conviction_preview' | 'position_check' | 'threshold_check';
  }): Promise<{ allowed: boolean; currentTier: string }>;
}

/**
 * NATS publisher interface for events.
 */
export interface INatsPublisher {
  /**
   * Publish an event.
   */
  publish(subject: string, data: unknown): Promise<void>;
}

/**
 * Metrics interface.
 */
export interface IParallelModeOrchestratorMetrics {
  /** Parallel mode enablements counter */
  parallelModeEnablements: {
    inc(labels: { community_id: string; result: string }): void;
  };
  /** Sync duration histogram */
  parallelModeSyncDuration: {
    observe(labels: { community_id: string }, value: number): void;
  };
}

// =============================================================================
// ParallelModeOrchestrator Implementation
// =============================================================================

/**
 * Default requirements for parallel mode.
 */
const DEFAULT_READINESS_REQUIREMENTS = {
  minShadowDays: 14,
  minAccuracy: 0.95,
};

/**
 * Options for ParallelModeOrchestrator.
 */
export interface ParallelModeOrchestratorOptions {
  /** Minimum shadow days required */
  minShadowDays?: number;
  /** Minimum accuracy required */
  minAccuracy?: number;
}

/**
 * ParallelModeOrchestrator coordinates parallel mode operations.
 */
export class ParallelModeOrchestrator implements IParallelMode {
  readonly roleManager: INamespacedRoleManager;
  readonly channelManager: IChannelStrategyManager;

  private readonly communityService: IParallelModeCommunityService;
  private readonly shadowLedger: IShadowLedgerReadiness;
  private readonly featureGate: IFeatureGateReadiness;
  private readonly nats: INatsPublisher;
  private readonly metrics: IParallelModeOrchestratorMetrics;
  private readonly log: Logger;
  private readonly options: Required<ParallelModeOrchestratorOptions>;

  constructor(
    roleManager: INamespacedRoleManager,
    channelManager: IChannelStrategyManager,
    communityService: IParallelModeCommunityService,
    shadowLedger: IShadowLedgerReadiness,
    featureGate: IFeatureGateReadiness,
    nats: INatsPublisher,
    metrics: IParallelModeOrchestratorMetrics,
    logger: Logger,
    options?: ParallelModeOrchestratorOptions
  ) {
    this.roleManager = roleManager;
    this.channelManager = channelManager;
    this.communityService = communityService;
    this.shadowLedger = shadowLedger;
    this.featureGate = featureGate;
    this.nats = nats;
    this.metrics = metrics;
    this.log = logger.child({ component: 'ParallelModeOrchestrator' });
    this.options = {
      minShadowDays: options?.minShadowDays ?? DEFAULT_READINESS_REQUIREMENTS.minShadowDays,
      minAccuracy: options?.minAccuracy ?? DEFAULT_READINESS_REQUIREMENTS.minAccuracy,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Enable parallel mode for a community.
   */
  async enable(
    communityId: string,
    guildId: string,
    config: Partial<ParallelModeConfig>
  ): Promise<boolean> {
    this.log.info({ communityId, guildId }, 'Enabling parallel mode');

    try {
      // Check readiness
      const readiness = await this.checkReadiness(communityId);
      if (!readiness.ready) {
        this.log.warn(
          { communityId, blockers: readiness.blockers },
          'Community not ready for parallel mode'
        );
        this.metrics.parallelModeEnablements.inc({
          community_id: communityId,
          result: 'not_ready',
        });
        return false;
      }

      // Get tier configurations
      const tiers = await this.communityService.getTierConfigs(communityId);
      if (tiers.length === 0) {
        this.log.error({ communityId }, 'No tier configurations found');
        return false;
      }

      // Build full config
      const fullConfig: ParallelModeConfig = {
        communityId,
        guildId,
        enabled: true,
        roleConfig: {
          ...DEFAULT_NAMESPACED_ROLE_CONFIG,
          ...config.roleConfig,
        },
        channelConfig: {
          ...DEFAULT_CHANNEL_STRATEGY_CONFIG,
          ...config.channelConfig,
        },
        enabledAt: new Date(),
        entryAccuracy: readiness.checks.accuracy.current,
        entryShadowDays: readiness.checks.shadowDays.current,
      };

      // Create namespaced roles
      await this.roleManager.createAllRoles(
        guildId,
        communityId,
        tiers,
        fullConfig.roleConfig
      );

      // Create channels based on strategy
      if (fullConfig.channelConfig.strategy !== 'none') {
        await this.channelManager.createChannels(
          guildId,
          communityId,
          fullConfig.channelConfig
        );
      }

      // Save configuration
      await this.communityService.saveParallelModeConfig(fullConfig);

      // Publish event
      await this.nats.publish('parallel.mode.enabled', {
        communityId,
        guildId,
        config: fullConfig,
        timestamp: new Date().toISOString(),
      });

      this.metrics.parallelModeEnablements.inc({
        community_id: communityId,
        result: 'success',
      });

      this.log.info({ communityId, guildId }, 'Parallel mode enabled successfully');
      return true;
    } catch (error) {
      this.log.error(
        { error, communityId, guildId },
        'Failed to enable parallel mode'
      );
      this.metrics.parallelModeEnablements.inc({
        community_id: communityId,
        result: 'error',
      });
      return false;
    }
  }

  /**
   * Disable parallel mode for a community.
   */
  async disable(communityId: string, removeArtifacts = false): Promise<boolean> {
    this.log.info({ communityId, removeArtifacts }, 'Disabling parallel mode');

    try {
      const config = await this.getConfig(communityId);
      if (!config || !config.enabled) {
        this.log.warn({ communityId }, 'Parallel mode not enabled');
        return false;
      }

      // Update config to disabled
      const updatedConfig: ParallelModeConfig = {
        ...config,
        enabled: false,
      };
      await this.communityService.saveParallelModeConfig(updatedConfig);

      // Optionally remove roles and channels
      if (removeArtifacts) {
        this.log.info({ communityId }, 'Artifact removal would occur here');
        // Note: Role/channel removal would be implemented via synthesis queue
        // to ensure rate limiting and proper cleanup
      }

      // Publish event
      await this.nats.publish('parallel.mode.disabled', {
        communityId,
        guildId: config.guildId,
        removeArtifacts,
        timestamp: new Date().toISOString(),
      });

      this.log.info({ communityId }, 'Parallel mode disabled');
      return true;
    } catch (error) {
      this.log.error({ error, communityId }, 'Failed to disable parallel mode');
      return false;
    }
  }

  /**
   * Check if community meets requirements for parallel mode.
   */
  async checkReadiness(communityId: string): Promise<ParallelModeReadiness> {
    const blockers: string[] = [];

    // Get guild ID
    const guildId = await this.communityService.getGuildId(communityId);
    if (!guildId) {
      return {
        ready: false,
        checks: {
          shadowDays: { current: 0, required: this.options.minShadowDays, passed: false },
          accuracy: { current: 0, required: this.options.minAccuracy, passed: false },
          featureGate: { tier: 'unknown', hasAccess: false, passed: false },
        },
        blockers: ['Community not found'],
      };
    }

    // Get shadow stats
    const stats = await this.shadowLedger.getStats(guildId);

    // Calculate shadow days (based on last sync)
    const shadowDays = stats.lastSyncAt
      ? Math.floor(
          (Date.now() - stats.lastSyncAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;

    // Check shadow days
    const shadowDaysCheck = {
      current: shadowDays,
      required: this.options.minShadowDays,
      passed: shadowDays >= this.options.minShadowDays,
    };
    if (!shadowDaysCheck.passed) {
      blockers.push(
        `Insufficient shadow days: ${shadowDays}/${this.options.minShadowDays}`
      );
    }

    // Check accuracy
    const accuracyCheck = {
      current: stats.accuracy,
      required: this.options.minAccuracy,
      passed: stats.accuracy >= this.options.minAccuracy,
    };
    if (!accuracyCheck.passed) {
      blockers.push(
        `Insufficient accuracy: ${(stats.accuracy * 100).toFixed(1)}%/${(this.options.minAccuracy * 100).toFixed(1)}%`
      );
    }

    // Check feature gate
    const featureAccess = await this.featureGate.checkAccess({
      communityId,
      guildId,
      feature: 'profile_view', // Basic parallel mode feature
    });
    const featureGateCheck = {
      tier: featureAccess.currentTier,
      hasAccess: featureAccess.allowed,
      passed: featureAccess.allowed,
    };
    if (!featureGateCheck.passed) {
      blockers.push(
        `Feature gate denied: current tier is ${featureAccess.currentTier}`
      );
    }

    return {
      ready: blockers.length === 0,
      checks: {
        shadowDays: shadowDaysCheck,
        accuracy: accuracyCheck,
        featureGate: featureGateCheck,
      },
      blockers,
    };
  }

  // ===========================================================================
  // Sync Operations
  // ===========================================================================

  /**
   * Run full parallel mode sync for a community.
   */
  async sync(communityId: string): Promise<ParallelModeSyncResult> {
    const startTime = Date.now();

    this.log.info({ communityId }, 'Starting parallel mode sync');

    const config = await this.getConfig(communityId);
    if (!config || !config.enabled) {
      throw new Error(`Parallel mode not enabled for community ${communityId}`);
    }

    // Get member eligibilities
    const members = await this.communityService.getMemberEligibilities(
      communityId,
      config.guildId
    );

    // Sync roles
    const roleSync = await this.roleManager.syncRoles(
      config.guildId,
      communityId,
      members
    );

    // Sync channel permissions for additive channels
    let channelsSynced = 0;
    if (config.channelConfig.strategy !== 'none') {
      const arrakisChannels = await this.channelManager.getArrakisChannels(
        config.guildId
      );

      for (const channel of arrakisChannels) {
        await this.channelManager.syncChannelPermissions(
          config.guildId,
          communityId,
          channel.id,
          members
        );
        channelsSynced++;
      }
    }

    const durationMs = Date.now() - startTime;

    this.metrics.parallelModeSyncDuration.observe(
      { community_id: communityId },
      durationMs / 1000
    );

    const result: ParallelModeSyncResult = {
      communityId,
      guildId: config.guildId,
      syncedAt: new Date(),
      roleSync,
      channelsSynced,
      durationMs,
      errors: roleSync.errors?.map((e) => e.message) ?? [],
    };

    // Publish event
    await this.nats.publish('parallel.mode.sync.completed', {
      ...result,
      timestamp: new Date().toISOString(),
    });

    this.log.info(
      { communityId, result, durationMs },
      'Parallel mode sync completed'
    );

    return result;
  }

  /**
   * Sync a single member in parallel mode.
   */
  async syncMember(communityId: string, userId: string): Promise<boolean> {
    const config = await this.getConfig(communityId);
    if (!config || !config.enabled) {
      return false;
    }

    const member = await this.communityService.getMemberEligibility(
      communityId,
      config.guildId,
      userId
    );

    if (!member) {
      return false;
    }

    return this.roleManager.syncMemberRole(config.guildId, communityId, member);
  }

  // ===========================================================================
  // Status & Monitoring
  // ===========================================================================

  /**
   * Get parallel mode status for a community.
   */
  async getStatus(communityId: string): Promise<ParallelModeStatus | null> {
    const config = await this.getConfig(communityId);
    if (!config) {
      return null;
    }

    const arrakisRoles = await this.roleManager.getArrakisRoles(config.guildId);
    const arrakisChannels = await this.channelManager.getArrakisChannels(
      config.guildId
    );

    // Get members with Arrakis roles
    const members = await this.communityService.getMemberEligibilities(
      communityId,
      config.guildId
    );
    const membersWithRoles = members.filter((m) =>
      m.roles.some((r) => arrakisRoles.some((ar) => ar.id === r))
    ).length;

    // Get shadow stats for sync health
    const stats = await this.shadowLedger.getStats(config.guildId);
    const hoursSinceSync = stats.lastSyncAt
      ? (Date.now() - stats.lastSyncAt.getTime()) / (1000 * 60 * 60)
      : null;

    let syncHealth: 'healthy' | 'degraded' | 'failed' = 'healthy';
    const errors: string[] = [];

    if (hoursSinceSync === null) {
      syncHealth = 'failed';
      errors.push('No sync has occurred');
    } else if (hoursSinceSync > 24) {
      syncHealth = 'failed';
      errors.push(`Last sync was ${Math.floor(hoursSinceSync)} hours ago`);
    } else if (hoursSinceSync > 12) {
      syncHealth = 'degraded';
      errors.push(`Last sync was ${Math.floor(hoursSinceSync)} hours ago`);
    }

    return {
      communityId,
      active: config.enabled,
      arrakisRolesCount: arrakisRoles.length,
      arrakisChannelsCount: arrakisChannels.length,
      membersWithArrakisRoles: membersWithRoles,
      syncHealth,
      lastSyncAt: stats.lastSyncAt,
      errors,
    };
  }

  /**
   * Get parallel mode configuration for a community.
   */
  async getConfig(communityId: string): Promise<ParallelModeConfig | null> {
    return this.communityService.getParallelModeConfig(communityId);
  }

  /**
   * Update parallel mode configuration.
   */
  async updateConfig(
    communityId: string,
    config: Partial<ParallelModeConfig>
  ): Promise<void> {
    const existing = await this.getConfig(communityId);
    if (!existing) {
      throw new Error(`Parallel mode not configured for community ${communityId}`);
    }

    const updated: ParallelModeConfig = {
      ...existing,
      ...config,
      roleConfig: {
        ...existing.roleConfig,
        ...config.roleConfig,
      },
      channelConfig: {
        ...existing.channelConfig,
        ...config.channelConfig,
      },
    };

    await this.communityService.saveParallelModeConfig(updated);

    this.log.info({ communityId }, 'Parallel mode config updated');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ParallelModeOrchestrator instance.
 */
export function createParallelModeOrchestrator(
  roleManager: INamespacedRoleManager,
  channelManager: IChannelStrategyManager,
  communityService: IParallelModeCommunityService,
  shadowLedger: IShadowLedgerReadiness,
  featureGate: IFeatureGateReadiness,
  nats: INatsPublisher,
  metrics: IParallelModeOrchestratorMetrics,
  logger: Logger,
  options?: ParallelModeOrchestratorOptions
): ParallelModeOrchestrator {
  return new ParallelModeOrchestrator(
    roleManager,
    channelManager,
    communityService,
    shadowLedger,
    featureGate,
    nats,
    metrics,
    logger,
    options
  );
}
