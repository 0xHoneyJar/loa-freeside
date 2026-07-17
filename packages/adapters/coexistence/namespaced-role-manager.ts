/**
 * NamespacedRoleManager Implementation
 *
 * Sprint S-26: Namespaced Roles & Parallel Channels
 *
 * Manages Arrakis roles that coexist with incumbent provider roles.
 * All Arrakis roles are prefixed and positioned below incumbent roles.
 *
 * CRITICAL: This manager MUST NEVER touch incumbent roles.
 *
 * @see SDD §7.2.2 Namespaced Role Manager
 */

import type { Logger } from 'pino';
import type {
  INamespacedRoleManager,
  TierRoleConfig,
} from '@freeside/core/ports';
import type {
  NamespacedRoleConfig,
  RoleSyncResult,
  RoleSyncError,
  MemberEligibility,
  DiscordRole,
} from '@freeside/core/domain';
import { DEFAULT_NAMESPACED_ROLE_CONFIG } from '@freeside/core/domain';

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Discord REST service interface for role operations.
 */
export interface IDiscordRoleService {
  /**
   * Get all roles in a guild.
   */
  getGuildRoles(guildId: string): Promise<DiscordRole[]>;

  /**
   * Get member roles.
   */
  getMemberRoles(guildId: string, userId: string): Promise<string[]>;

  /**
   * Add role to member.
   */
  addMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;

  /**
   * Remove role from member.
   */
  removeMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
}

/**
 * Synthesis engine interface for rate-limited Discord operations.
 */
export interface ISynthesisQueue {
  /**
   * Enqueue a synthesis job.
   */
  add(
    jobName: string,
    data: {
      type: string;
      guildId: string;
      communityId: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    }
  ): Promise<void>;
}

/**
 * Community repository for config storage.
 */
export interface IParallelModeConfigStore {
  /**
   * Get role configuration for a community.
   */
  getRoleConfig(communityId: string): Promise<NamespacedRoleConfig | null>;

  /**
   * Save role configuration for a community.
   */
  saveRoleConfig(communityId: string, config: NamespacedRoleConfig): Promise<void>;
}

/**
 * Metrics client for observability.
 */
export interface IParallelModeMetrics {
  /** Role assignments counter */
  roleAssignments: {
    inc(labels: { community_id: string; action: string }): void;
  };
  /** Role sync duration histogram */
  roleSyncDuration: {
    observe(labels: { community_id: string }, value: number): void;
  };
  /** Role sync errors counter */
  roleSyncErrors: {
    inc(labels: { community_id: string; error_type: string }): void;
  };
}

// =============================================================================
// NamespacedRoleManager Implementation
// =============================================================================

/**
 * Options for NamespacedRoleManager.
 */
export interface NamespacedRoleManagerOptions {
  /** Maximum concurrent role operations */
  maxConcurrentOps?: number;
  /** Batch size for role sync */
  batchSize?: number;
}

/**
 * NamespacedRoleManager implements role management for parallel mode.
 *
 * CRITICAL: This class MUST NEVER modify incumbent roles.
 */
export class NamespacedRoleManager implements INamespacedRoleManager {
  private readonly discord: IDiscordRoleService;
  private readonly synthesis: ISynthesisQueue;
  private readonly configStore: IParallelModeConfigStore;
  private readonly metrics: IParallelModeMetrics;
  private readonly log: Logger;
  private readonly options: Required<NamespacedRoleManagerOptions>;

  constructor(
    discord: IDiscordRoleService,
    synthesis: ISynthesisQueue,
    configStore: IParallelModeConfigStore,
    metrics: IParallelModeMetrics,
    logger: Logger,
    options?: NamespacedRoleManagerOptions
  ) {
    this.discord = discord;
    this.synthesis = synthesis;
    this.configStore = configStore;
    this.metrics = metrics;
    this.log = logger.child({ component: 'NamespacedRoleManager' });
    this.options = {
      maxConcurrentOps: options?.maxConcurrentOps ?? 10,
      batchSize: options?.batchSize ?? 100,
    };
  }

  // ===========================================================================
  // Role Creation
  // ===========================================================================

  /**
   * Create a namespaced Arrakis role for a tier.
   * CRITICAL: All Arrakis roles MUST be prefixed.
   */
  async createNamespacedRole(
    guildId: string,
    communityId: string,
    tierConfig: TierRoleConfig,
    config?: Partial<NamespacedRoleConfig>
  ): Promise<string> {
    const fullConfig = await this.resolveConfig(communityId, config);
    const roleName = `${fullConfig.prefix}${tierConfig.name}`;

    this.log.info(
      { guildId, communityId, roleName, tierConfig: tierConfig.id },
      'Creating namespaced role'
    );

    // Calculate position based on strategy
    const position = await this.calculateRolePosition(guildId, fullConfig);

    // Determine permissions based on mode
    const permissions =
      fullConfig.permissionsMode === 'none'
        ? BigInt(0)
        : fullConfig.permissionsMode === 'view_only'
          ? BigInt(1024) // VIEW_CHANNEL permission
          : tierConfig.permissions;

    // Enqueue role creation via synthesis (rate-limited)
    await this.synthesis.add(`create-role:${communityId}:${tierConfig.id}`, {
      type: 'create_role',
      guildId,
      communityId,
      payload: {
        name: roleName,
        color: tierConfig.roleColor,
        permissions: permissions.toString(),
        position,
        hoist: false,
        mentionable: false,
      },
      idempotencyKey: `create-role:${communityId}:${tierConfig.id}:${roleName}`,
    });

    this.log.info(
      { guildId, communityId, roleName, position },
      'Namespaced role creation queued'
    );

    return roleName;
  }

  /**
   * Create all Arrakis roles for a community's theme.
   */
  async createAllRoles(
    guildId: string,
    communityId: string,
    tiers: TierRoleConfig[],
    config?: Partial<NamespacedRoleConfig>
  ): Promise<string[]> {
    const roleNames: string[] = [];

    for (const tier of tiers) {
      const roleName = await this.createNamespacedRole(
        guildId,
        communityId,
        tier,
        config
      );
      roleNames.push(roleName);
    }

    this.log.info(
      { guildId, communityId, roleCount: roleNames.length },
      'All namespaced roles created'
    );

    return roleNames;
  }

  // ===========================================================================
  // Role Positioning
  // ===========================================================================

  /**
   * Find the position of incumbent roles in the hierarchy.
   * Looks for common incumbent patterns to position Arrakis roles below.
   */
  async findIncumbentRolePosition(guildId: string): Promise<number> {
    const roles = await this.discord.getGuildRoles(guildId);

    // Known incumbent role patterns
    const incumbentPatterns = [
      /holder/i,
      /verified/i,
      /member/i,
      /collab/i,
      /matrica/i,
      /guild\.xyz/i,
    ];

    // Find highest-positioned incumbent role
    let incumbentPosition = 0;

    for (const role of roles) {
      // Skip managed roles (bots, integrations)
      if (role.managed) continue;

      // Check if role matches incumbent patterns
      const isIncumbent = incumbentPatterns.some((p) => p.test(role.name));
      if (isIncumbent && role.position > incumbentPosition) {
        incumbentPosition = role.position;
      }
    }

    // If no incumbent found, use middle of hierarchy
    if (incumbentPosition === 0) {
      incumbentPosition = Math.floor(roles.length / 2);
    }

    this.log.debug(
      { guildId, incumbentPosition },
      'Found incumbent role position'
    );

    return incumbentPosition;
  }

  /**
   * Calculate target position for Arrakis roles.
   */
  async calculateRolePosition(
    guildId: string,
    config: NamespacedRoleConfig
  ): Promise<number> {
    switch (config.positionStrategy) {
      case 'below_incumbent': {
        const incumbentPos = await this.findIncumbentRolePosition(guildId);
        // Position at least 1 below incumbent, minimum of 1
        return Math.max(incumbentPos - 1, 1);
      }

      case 'bottom':
        return 1; // Lowest position (above @everyone)

      case 'custom':
        return config.customPosition ?? 1;

      default:
        return 1;
    }
  }

  // ===========================================================================
  // Role Sync
  // ===========================================================================

  /**
   * Sync Arrakis roles for members based on eligibility.
   * CRITICAL: Never touches incumbent roles.
   */
  async syncRoles(
    guildId: string,
    communityId: string,
    members: MemberEligibility[]
  ): Promise<RoleSyncResult> {
    const startTime = Date.now();
    const result: RoleSyncResult = {
      assigned: 0,
      removed: 0,
      unchanged: 0,
      errors: [],
    };

    this.log.info(
      { guildId, communityId, memberCount: members.length },
      'Starting role sync'
    );

    const config = await this.getConfig(communityId);
    if (!config) {
      this.log.warn({ communityId }, 'No role config found, using defaults');
    }
    const prefix = config?.prefix ?? DEFAULT_NAMESPACED_ROLE_CONFIG.prefix;

    // Get Arrakis roles for this guild
    const arrakisRoles = await this.getArrakisRoles(guildId);
    const roleMap = new Map(
      arrakisRoles.map((r) => [r.name.replace(prefix, ''), r])
    );

    // Process members in batches
    for (let i = 0; i < members.length; i += this.options.batchSize) {
      const batch = members.slice(i, i + this.options.batchSize);
      const batchPromises: Promise<void>[] = [];

      for (const member of batch) {
        batchPromises.push(
          this.processMemberSync(
            guildId,
            communityId,
            member,
            prefix,
            roleMap,
            result
          )
        );

        // Limit concurrency
        if (batchPromises.length >= this.options.maxConcurrentOps) {
          await Promise.all(batchPromises);
          batchPromises.length = 0;
        }
      }

      // Process remaining in batch
      if (batchPromises.length > 0) {
        await Promise.all(batchPromises);
      }
    }

    const duration = (Date.now() - startTime) / 1000;

    // Update metrics
    this.metrics.roleSyncDuration.observe({ community_id: communityId }, duration);
    this.metrics.roleAssignments.inc({
      community_id: communityId,
      action: 'assigned',
    });
    this.metrics.roleAssignments.inc({
      community_id: communityId,
      action: 'removed',
    });

    this.log.info(
      { guildId, communityId, result, durationSec: duration },
      'Role sync completed'
    );

    return result;
  }

  /**
   * Process a single member for role sync.
   */
  private async processMemberSync(
    guildId: string,
    communityId: string,
    member: MemberEligibility,
    prefix: string,
    roleMap: Map<string, DiscordRole>,
    result: RoleSyncResult
  ): Promise<void> {
    try {
      // Get current Arrakis roles for member
      const memberRoles = member.roles;
      const currentArrakisRoles = memberRoles.filter((roleId) => {
        for (const [, role] of roleMap) {
          if (role.id === roleId) return true;
        }
        return false;
      });

      // Determine target role
      const targetRole = member.tier ? roleMap.get(member.tier) : null;

      if (member.eligible && member.tier && targetRole) {
        // Should have role
        const hasRole = currentArrakisRoles.includes(targetRole.id);

        if (!hasRole) {
          // Assign via synthesis (rate-limited)
          await this.synthesis.add(`assign:${member.userId}:${targetRole.id}`, {
            type: 'assign_role',
            guildId,
            communityId,
            payload: {
              userId: member.userId,
              roleId: targetRole.id,
            },
            idempotencyKey: `assign:${communityId}:${member.userId}:${targetRole.id}`,
          });
          result.assigned++;
          this.metrics.roleAssignments.inc({
            community_id: communityId,
            action: 'assigned',
          });
        } else {
          result.unchanged++;
        }

        // Remove any other Arrakis roles (tier change)
        for (const otherRoleId of currentArrakisRoles) {
          if (otherRoleId !== targetRole.id) {
            await this.synthesis.add(`remove:${member.userId}:${otherRoleId}`, {
              type: 'remove_role',
              guildId,
              communityId,
              payload: {
                userId: member.userId,
                roleId: otherRoleId,
              },
              idempotencyKey: `remove:${communityId}:${member.userId}:${otherRoleId}`,
            });
            result.removed++;
          }
        }
      } else {
        // Should not have any Arrakis roles
        for (const roleId of currentArrakisRoles) {
          await this.synthesis.add(`remove:${member.userId}:${roleId}`, {
            type: 'remove_role',
            guildId,
            communityId,
            payload: {
              userId: member.userId,
              roleId,
            },
            idempotencyKey: `remove:${communityId}:${member.userId}:${roleId}`,
          });
          result.removed++;
          this.metrics.roleAssignments.inc({
            community_id: communityId,
            action: 'removed',
          });
        }

        if (currentArrakisRoles.length === 0) {
          result.unchanged++;
        }
      }
    } catch (error) {
      const syncError: RoleSyncError = {
        userId: member.userId,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
      result.errors = result.errors ?? [];
      result.errors.push(syncError);

      this.metrics.roleSyncErrors.inc({
        community_id: communityId,
        error_type: 'member_sync_failed',
      });

      this.log.warn(
        { error, userId: member.userId, communityId },
        'Failed to sync member role'
      );
    }
  }

  /**
   * Sync Arrakis role for a single member.
   */
  async syncMemberRole(
    guildId: string,
    communityId: string,
    member: MemberEligibility
  ): Promise<boolean> {
    const result = await this.syncRoles(guildId, communityId, [member]);
    return result.assigned > 0 || result.removed > 0;
  }

  // ===========================================================================
  // Role Queries
  // ===========================================================================

  /**
   * Get all Arrakis roles in a guild.
   */
  async getArrakisRoles(guildId: string): Promise<DiscordRole[]> {
    const roles = await this.discord.getGuildRoles(guildId);
    return roles.filter((r) => this.isArrakisRole(r.name));
  }

  /**
   * Check if a role is an Arrakis role (has prefix).
   */
  isArrakisRole(roleName: string): boolean {
    return roleName.startsWith(DEFAULT_NAMESPACED_ROLE_CONFIG.prefix);
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Get current role configuration for a community.
   */
  async getConfig(communityId: string): Promise<NamespacedRoleConfig | null> {
    return this.configStore.getRoleConfig(communityId);
  }

  /**
   * Update role configuration for a community.
   */
  async updateConfig(
    communityId: string,
    config: Partial<NamespacedRoleConfig>
  ): Promise<void> {
    const existing = await this.getConfig(communityId);
    const fullConfig: NamespacedRoleConfig = {
      ...DEFAULT_NAMESPACED_ROLE_CONFIG,
      ...existing,
      ...config,
    };
    await this.configStore.saveRoleConfig(communityId, fullConfig);

    this.log.info({ communityId, config: fullConfig }, 'Role config updated');
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Resolve configuration with defaults and overrides.
   */
  private async resolveConfig(
    communityId: string,
    override?: Partial<NamespacedRoleConfig>
  ): Promise<NamespacedRoleConfig> {
    const stored = await this.getConfig(communityId);
    return {
      ...DEFAULT_NAMESPACED_ROLE_CONFIG,
      ...stored,
      ...override,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a NamespacedRoleManager instance.
 */
export function createNamespacedRoleManager(
  discord: IDiscordRoleService,
  synthesis: ISynthesisQueue,
  configStore: IParallelModeConfigStore,
  metrics: IParallelModeMetrics,
  logger: Logger,
  options?: NamespacedRoleManagerOptions
): NamespacedRoleManager {
  return new NamespacedRoleManager(
    discord,
    synthesis,
    configStore,
    metrics,
    logger,
    options
  );
}
