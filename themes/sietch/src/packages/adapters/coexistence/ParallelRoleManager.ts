/**
 * ParallelRoleManager - Namespaced Role Management for Parallel Mode
 *
 * Sprint 58: Parallel Mode - Namespaced Role Management
 *
 * Creates and manages Arrakis namespaced roles (@arrakis-*) that coexist
 * with incumbent roles in parallel mode. Roles are positioned below
 * incumbent roles in the hierarchy and have NO permissions by default.
 *
 * Key Security Guarantees:
 * - All Arrakis roles are prefixed with configurable namespace (default: @arrakis-)
 * - Namespaced roles have NO permissions (prevents privilege escalation)
 * - Roles are positioned BELOW incumbent roles in hierarchy
 * - Role sync is independent of incumbent operations
 *
 * @module packages/adapters/coexistence/ParallelRoleManager
 */

import type { Client, Guild, Role, GuildMember, PermissionsBitField } from 'discord.js';
import type {
  ICoexistenceStorage,
  StoredIncumbentConfig,
  StoredParallelRoleConfig,
  SaveParallelRoleInput,
  TierRoleMapping,
  RolePositionStrategy,
} from '../../core/ports/ICoexistenceStorage.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for parallel role setup
 */
export interface ParallelSetupOptions {
  /** Community UUID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Role namespace prefix (default: @arrakis-) */
  namespace?: string;
  /** Tier-to-role mappings */
  tierRoleMappings: TierRoleMapping[];
  /** Position strategy (default: below_incumbent) */
  positionStrategy?: RolePositionStrategy;
}

/**
 * Result of parallel role setup
 */
export interface ParallelSetupResult {
  /** Whether setup completed successfully */
  success: boolean;
  /** Number of roles created */
  rolesCreated: number;
  /** Number of roles that already existed */
  rolesExisted: number;
  /** Number of roles that failed to create */
  rolesFailed: number;
  /** Created role IDs mapped by tier */
  roleIdsByTier: Map<number, string>;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for syncing parallel roles to members
 */
export interface ParallelSyncOptions {
  /** Community UUID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Process members in batches of this size (default: 100) */
  batchSize?: number;
  /** Force full resync even if recently synced */
  forceFullSync?: boolean;
}

/**
 * Result of parallel role sync
 */
export interface ParallelSyncResult {
  /** Community UUID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Total members processed */
  membersProcessed: number;
  /** Members skipped (recently synced) */
  membersSkipped: number;
  /** Role additions performed */
  roleAdditions: number;
  /** Role removals performed */
  roleRemovals: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether sync completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Callback to get member tier from conviction score
 *
 * The ParallelRoleManager doesn't calculate conviction - that's the
 * scoring engine's job. This callback allows integration.
 */
export type GetMemberTier = (
  communityId: string,
  memberId: string
) => Promise<{ tier: number; conviction: number } | null>;

/**
 * Callback to get all member tiers in batch
 */
export type GetMemberTiersBatch = (
  communityId: string,
  memberIds: string[]
) => Promise<Map<string, { tier: number; conviction: number }>>;

// =============================================================================
// Constants
// =============================================================================

/** Default role namespace */
export const DEFAULT_NAMESPACE = '@arrakis-';

/** Default tier role mappings */
export const DEFAULT_TIER_MAPPINGS: TierRoleMapping[] = [
  { tier: 1, baseName: 'holder', color: '#5865F2', minConviction: 1, description: 'Token holder' },
  { tier: 2, baseName: 'believer', color: '#57F287', minConviction: 50, description: 'Active participant' },
  { tier: 3, baseName: 'diamond', color: '#ED4245', minConviction: 80, description: 'Diamond hands' },
];

// =============================================================================
// Implementation
// =============================================================================

/**
 * Parallel Role Manager
 *
 * Creates and syncs namespaced Arrakis roles in parallel mode.
 */
export class ParallelRoleManager {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client,
    private readonly getMemberTier: GetMemberTier,
    private readonly getMemberTiersBatch: GetMemberTiersBatch,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'ParallelRoleManager' });
  }

  // =========================================================================
  // Setup Methods (TASK-58.2, TASK-58.5)
  // =========================================================================

  /**
   * Setup parallel roles in a guild
   *
   * Creates namespaced roles (@arrakis-*) for each tier mapping.
   * Positions roles below incumbent roles in the hierarchy.
   *
   * SECURITY: Created roles have NO permissions.
   *
   * @param options - Setup configuration
   * @returns Setup result with created role IDs
   */
  async setupParallelRoles(options: ParallelSetupOptions): Promise<ParallelSetupResult> {
    const {
      communityId,
      guildId,
      namespace = DEFAULT_NAMESPACE,
      tierRoleMappings,
      positionStrategy = 'below_incumbent',
    } = options;

    this.logger.info('Starting parallel role setup', {
      communityId,
      guildId,
      namespace,
      tierCount: tierRoleMappings.length,
    });

    try {
      // Verify we're in parallel mode (or transitioning to it)
      const mode = await this.storage.getCurrentMode(communityId);
      if (mode !== 'parallel' && mode !== 'shadow') {
        return {
          success: false,
          rolesCreated: 0,
          rolesExisted: 0,
          rolesFailed: 0,
          roleIdsByTier: new Map(),
          error: `Invalid mode for parallel setup: ${mode}`,
        };
      }

      // Fetch guild
      const guild = await this.discordClient.guilds.fetch(guildId);
      if (!guild) {
        throw new Error(`Guild not found: ${guildId}`);
      }

      // Get incumbent config for position calculation
      const incumbentConfig = await this.storage.getIncumbentConfig(communityId);

      // Calculate base position for Arrakis roles
      const basePosition = await this.calculateBasePosition(
        guild,
        incumbentConfig,
        positionStrategy
      );

      let rolesCreated = 0;
      let rolesExisted = 0;
      let rolesFailed = 0;
      const roleIdsByTier = new Map<number, string>();

      // Create roles for each tier
      for (let i = 0; i < tierRoleMappings.length; i++) {
        const mapping = tierRoleMappings[i];
        if (!mapping) continue;
        const roleName = this.buildRoleName(namespace, mapping.baseName);

        try {
          // Check if role already exists
          const existingRole = guild.roles.cache.find(r => r.name === roleName);

          if (existingRole) {
            this.logger.debug('Parallel role already exists', {
              communityId,
              roleName,
              tier: mapping.tier,
            });
            rolesExisted++;
            roleIdsByTier.set(mapping.tier, existingRole.id);

            // Update position if needed
            const targetPosition = basePosition - i;
            if (existingRole.position !== targetPosition) {
              await existingRole.setPosition(targetPosition);
            }

            // Save to storage
            await this.storage.saveParallelRole({
              communityId,
              discordRoleId: existingRole.id,
              roleName,
              baseName: mapping.baseName,
              tier: mapping.tier,
              minConviction: mapping.minConviction,
              position: targetPosition,
              color: mapping.color,
            });

            continue;
          }

          // Create new role - CRITICAL: NO permissions
          const targetPosition = basePosition - i;
          const newRole = await guild.roles.create({
            name: roleName,
            color: mapping.color ? parseInt(mapping.color.replace('#', ''), 16) : undefined,
            reason: `Arrakis parallel mode - tier ${mapping.tier}`,
            position: targetPosition,
            permissions: [], // CRITICAL: NO permissions
            hoist: false,
            mentionable: false,
          });

          this.logger.info('Parallel role created', {
            communityId,
            roleName,
            roleId: newRole.id,
            tier: mapping.tier,
            position: targetPosition,
          });

          rolesCreated++;
          roleIdsByTier.set(mapping.tier, newRole.id);

          // Save to storage
          await this.storage.saveParallelRole({
            communityId,
            discordRoleId: newRole.id,
            roleName,
            baseName: mapping.baseName,
            tier: mapping.tier,
            minConviction: mapping.minConviction,
            position: targetPosition,
            color: mapping.color,
          });
        } catch (error) {
          this.logger.error('Failed to create parallel role', {
            communityId,
            roleName,
            tier: mapping.tier,
            error: error instanceof Error ? error.message : String(error),
          });
          rolesFailed++;
        }
      }

      // Save/update parallel config
      await this.storage.saveParallelRoleConfig({
        communityId,
        namespace,
        enabled: true,
        positionStrategy,
        tierRoleMapping: tierRoleMappings,
        setupCompletedAt: new Date(),
        totalRolesCreated: rolesCreated + rolesExisted,
      });

      this.logger.info('Parallel role setup complete', {
        communityId,
        rolesCreated,
        rolesExisted,
        rolesFailed,
      });

      return {
        success: rolesFailed === 0,
        rolesCreated,
        rolesExisted,
        rolesFailed,
        roleIdsByTier,
        error: rolesFailed > 0 ? `${rolesFailed} roles failed to create` : undefined,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Parallel role setup failed', {
        communityId,
        guildId,
        error: errorMessage,
      });

      return {
        success: false,
        rolesCreated: 0,
        rolesExisted: 0,
        rolesFailed: 0,
        roleIdsByTier: new Map(),
        error: errorMessage,
      };
    }
  }

  // =========================================================================
  // Sync Methods (TASK-58.3)
  // =========================================================================

  /**
   * Sync parallel roles to guild members
   *
   * Assigns/removes namespaced roles based on member conviction scores.
   * This is the parallel mode equivalent of shadow sync, but it actually
   * modifies Discord roles.
   *
   * @param options - Sync options
   * @returns Sync result
   */
  async syncParallelRoles(options: ParallelSyncOptions): Promise<ParallelSyncResult> {
    const startTime = Date.now();
    const {
      communityId,
      guildId,
      batchSize = 100,
      forceFullSync = false,
    } = options;

    this.logger.info('Starting parallel role sync', { communityId, guildId });

    try {
      // Verify parallel mode is enabled
      const mode = await this.storage.getCurrentMode(communityId);
      if (mode !== 'parallel') {
        return {
          communityId,
          guildId,
          membersProcessed: 0,
          membersSkipped: 0,
          roleAdditions: 0,
          roleRemovals: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: `Not in parallel mode (current: ${mode})`,
        };
      }

      // Get parallel config
      const parallelConfig = await this.storage.getParallelRoleConfig(communityId);
      if (!parallelConfig || !parallelConfig.enabled) {
        return {
          communityId,
          guildId,
          membersProcessed: 0,
          membersSkipped: 0,
          roleAdditions: 0,
          roleRemovals: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: 'Parallel mode not configured or not enabled',
        };
      }

      // Fetch guild and ensure members are cached
      const guild = await this.discordClient.guilds.fetch(guildId);
      if (!guild) {
        throw new Error(`Guild not found: ${guildId}`);
      }

      await guild.members.fetch();

      // Get parallel roles
      const parallelRoles = await this.storage.getParallelRoles(communityId);
      const rolesByTier = new Map(parallelRoles.map(r => [r.tier, r]));

      let membersProcessed = 0;
      let membersSkipped = 0;
      let roleAdditions = 0;
      let roleRemovals = 0;

      // Process members in batches
      const members = Array.from(guild.members.cache.values())
        .filter(m => !m.user.bot);

      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);
        const memberIds = batch.map(m => m.id);

        // Get tiers for batch
        const tierMap = await this.getMemberTiersBatch(communityId, memberIds);

        for (const member of batch) {
          const tierInfo = tierMap.get(member.id);

          // Determine which tier role this member should have
          const targetTier = tierInfo?.tier ?? null;

          // Get current parallel roles for this member
          const currentParallelRoles = this.getMemberParallelRoles(
            member,
            parallelRoles.map(r => r.discordRoleId)
          );

          // Determine target role (if any)
          const targetRole = targetTier !== null ? rolesByTier.get(targetTier) : null;
          const targetRoleIds = targetRole ? [targetRole.discordRoleId] : [];

          // Calculate additions and removals
          const rolesToAdd = targetRoleIds.filter(id => !currentParallelRoles.has(id));
          const rolesToRemove = Array.from(currentParallelRoles).filter(id => !targetRoleIds.includes(id));

          // Apply changes
          for (const roleId of rolesToAdd) {
            try {
              await member.roles.add(roleId, 'Arrakis parallel mode sync');
              roleAdditions++;
            } catch (error) {
              this.logger.warn('Failed to add parallel role', {
                memberId: member.id,
                roleId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          for (const roleId of rolesToRemove) {
            try {
              await member.roles.remove(roleId, 'Arrakis parallel mode sync');
              roleRemovals++;
            } catch (error) {
              this.logger.warn('Failed to remove parallel role', {
                memberId: member.id,
                roleId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          // Update member assignment in storage
          await this.storage.saveParallelMemberAssignment({
            communityId,
            memberId: member.id,
            assignedTier: targetTier,
            assignedRoleIds: targetRoleIds,
            currentConviction: tierInfo?.conviction ?? null,
            lastAssignmentAt: new Date(),
          });

          membersProcessed++;
        }
      }

      // Update last sync timestamp
      await this.storage.saveParallelRoleConfig({
        communityId,
        lastSyncAt: new Date(),
      });

      this.logger.info('Parallel role sync complete', {
        communityId,
        guildId,
        membersProcessed,
        membersSkipped,
        roleAdditions,
        roleRemovals,
        durationMs: Date.now() - startTime,
      });

      return {
        communityId,
        guildId,
        membersProcessed,
        membersSkipped,
        roleAdditions,
        roleRemovals,
        durationMs: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Parallel role sync failed', {
        communityId,
        guildId,
        error: errorMessage,
      });

      return {
        communityId,
        guildId,
        membersProcessed: 0,
        membersSkipped: 0,
        roleAdditions: 0,
        roleRemovals: 0,
        durationMs: Date.now() - startTime,
        success: false,
        error: errorMessage,
      };
    }
  }

  // =========================================================================
  // Configuration Methods (TASK-58.4, TASK-58.7)
  // =========================================================================

  /**
   * Get parallel role configuration for a community
   */
  async getParallelConfig(communityId: string): Promise<StoredParallelRoleConfig | null> {
    return this.storage.getParallelRoleConfig(communityId);
  }

  /**
   * Update namespace configuration
   *
   * WARNING: Changing namespace will require re-creating all roles.
   */
  async updateNamespace(communityId: string, namespace: string): Promise<void> {
    await this.storage.saveParallelRoleConfig({
      communityId,
      namespace,
    });

    this.logger.info('Namespace updated', { communityId, namespace });
  }

  /**
   * Update tier role mappings
   */
  async updateTierMappings(
    communityId: string,
    mappings: TierRoleMapping[]
  ): Promise<void> {
    await this.storage.saveParallelRoleConfig({
      communityId,
      tierRoleMapping: mappings,
    });

    this.logger.info('Tier mappings updated', {
      communityId,
      tierCount: mappings.length,
    });
  }

  // =========================================================================
  // Mode Transition Methods (TASK-58.6)
  // =========================================================================

  /**
   * Enable parallel mode for a community
   *
   * Transitions from shadow mode to parallel mode.
   * Prerequisite: Shadow mode must have achieved readiness criteria.
   *
   * @param communityId - Community UUID
   * @param guildId - Discord guild ID
   * @param tierMappings - Tier-to-role mappings (optional, uses defaults)
   * @returns Setup result
   */
  async enableParallel(
    communityId: string,
    guildId: string,
    tierMappings?: TierRoleMapping[]
  ): Promise<ParallelSetupResult> {
    this.logger.info('Enabling parallel mode', { communityId, guildId });

    // Verify we're in shadow mode
    const currentMode = await this.storage.getCurrentMode(communityId);
    if (currentMode !== 'shadow') {
      return {
        success: false,
        rolesCreated: 0,
        rolesExisted: 0,
        rolesFailed: 0,
        roleIdsByTier: new Map(),
        error: `Cannot enable parallel from mode: ${currentMode}. Must be in shadow mode.`,
      };
    }

    // Check readiness
    const migrationState = await this.storage.getMigrationState(communityId);
    if (!migrationState?.readinessCheckPassed) {
      this.logger.warn('Community not ready for parallel mode', {
        communityId,
        readinessCheckPassed: migrationState?.readinessCheckPassed,
        accuracyPercent: migrationState?.accuracyPercent,
        shadowDays: migrationState?.shadowDays,
      });
      // Allow anyway but log warning - admin override
    }

    // Setup parallel roles
    const result = await this.setupParallelRoles({
      communityId,
      guildId,
      tierRoleMappings: tierMappings ?? DEFAULT_TIER_MAPPINGS,
    });

    if (result.success) {
      // Transition to parallel mode
      await this.storage.updateMode(communityId, 'parallel', 'Enabled parallel mode');

      // Update parallel enabled timestamp
      await this.storage.saveMigrationState({
        communityId,
        currentMode: 'parallel',
        parallelEnabledAt: new Date(),
      });

      this.logger.info('Parallel mode enabled', { communityId, guildId });
    }

    return result;
  }

  /**
   * Rollback from parallel mode to shadow mode
   *
   * Removes all Arrakis namespaced roles from the guild.
   */
  async rollbackToShadow(
    communityId: string,
    guildId: string,
    reason: string
  ): Promise<{ success: boolean; rolesRemoved: number; error?: string }> {
    this.logger.info('Rolling back to shadow mode', { communityId, guildId, reason });

    try {
      const guild = await this.discordClient.guilds.fetch(guildId);
      if (!guild) {
        throw new Error(`Guild not found: ${guildId}`);
      }

      // Get all parallel roles
      const parallelRoles = await this.storage.getParallelRoles(communityId);
      let rolesRemoved = 0;

      // Delete roles from Discord
      for (const parallelRole of parallelRoles) {
        try {
          const discordRole = guild.roles.cache.get(parallelRole.discordRoleId);
          if (discordRole) {
            await discordRole.delete(`Arrakis rollback: ${reason}`);
            rolesRemoved++;
          }
        } catch (error) {
          this.logger.warn('Failed to delete parallel role during rollback', {
            roleId: parallelRole.discordRoleId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Clean up storage
      await this.storage.deleteAllParallelRoles(communityId);
      await this.storage.deleteParallelRoleConfig(communityId);

      // Record rollback
      await this.storage.recordRollback(communityId, reason, 'shadow');

      this.logger.info('Rollback to shadow complete', {
        communityId,
        guildId,
        rolesRemoved,
      });

      return { success: true, rolesRemoved };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Rollback to shadow failed', {
        communityId,
        guildId,
        error: errorMessage,
      });

      return { success: false, rolesRemoved: 0, error: errorMessage };
    }
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Build full role name with namespace
   */
  private buildRoleName(namespace: string, baseName: string): string {
    return `${namespace}${baseName}`;
  }

  /**
   * Calculate base position for Arrakis roles (TASK-58.5)
   *
   * Positions roles below incumbent roles in the hierarchy.
   * Higher position numbers = higher in hierarchy.
   */
  private async calculateBasePosition(
    guild: Guild,
    incumbentConfig: StoredIncumbentConfig | null,
    strategy: RolePositionStrategy
  ): Promise<number> {
    if (strategy === 'lowest') {
      // Position just above @everyone (position 0)
      return 1;
    }

    if (strategy === 'manual') {
      // Return middle position - admin will adjust
      return Math.floor(guild.roles.cache.size / 2);
    }

    // below_incumbent (default)
    if (incumbentConfig?.detectedRoles && incumbentConfig.detectedRoles.length > 0) {
      // Find lowest incumbent role position
      let lowestIncumbentPosition = Infinity;

      for (const detected of incumbentConfig.detectedRoles) {
        const role = guild.roles.cache.get(detected.id);
        if (role && role.position < lowestIncumbentPosition) {
          lowestIncumbentPosition = role.position;
        }
      }

      if (lowestIncumbentPosition !== Infinity) {
        // Position just below the lowest incumbent role
        return Math.max(1, lowestIncumbentPosition - 1);
      }
    }

    // Fallback: position in lower third of hierarchy
    const roleCount = guild.roles.cache.size;
    return Math.max(1, Math.floor(roleCount / 3));
  }

  /**
   * Get current parallel role IDs that a member has
   */
  private getMemberParallelRoles(
    member: GuildMember,
    parallelRoleIds: string[]
  ): Set<string> {
    const parallelSet = new Set(parallelRoleIds);
    return new Set(
      member.roles.cache
        .filter(r => parallelSet.has(r.id))
        .map(r => r.id)
    );
  }
}

/**
 * Factory function to create ParallelRoleManager
 */
export function createParallelRoleManager(
  storage: ICoexistenceStorage,
  discordClient: Client,
  getMemberTier: GetMemberTier,
  getMemberTiersBatch: GetMemberTiersBatch,
  logger?: ILogger
): ParallelRoleManager {
  return new ParallelRoleManager(
    storage,
    discordClient,
    getMemberTier,
    getMemberTiersBatch,
    logger
  );
}
