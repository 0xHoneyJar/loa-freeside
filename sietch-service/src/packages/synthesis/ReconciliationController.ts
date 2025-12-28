/**
 * Reconciliation Controller (v5.0 - Sprint 45)
 *
 * Detects and repairs drift between desired state (manifests) and
 * actual Discord state. Runs periodically (every 6 hours via trigger.dev)
 * or on-demand via `/reconcile` command.
 *
 * Reconciliation Algorithm:
 * 1. Load desired state from PostgreSQL (manifests table)
 * 2. Load shadow state from S3 (last known applied state)
 * 3. Query actual Discord state (roles, channels via Discord API)
 * 4. Compare desired vs shadow vs actual (three-way diff)
 * 5. Detect drift: missing resources, orphaned resources, config changes
 * 6. Enqueue synthesis jobs to repair drift
 * 7. Update shadow state after successful reconciliation
 *
 * Drift Types:
 * - MISSING: Resource in desired but not in actual (create it)
 * - ORPHANED: Resource in actual but not in desired (delete it)
 * - CONFIG_DRIFT: Resource exists but config differs (update it)
 *
 * Part of Phase 4: BullMQ + Global Token Bucket
 *
 * Security Considerations:
 * - HIGH-005: Require Naib Council permission for destructive ops
 * - MED-005: Dry-run mode for testing reconciliation without changes
 * - LOW-001: Rate limit reconciliation to prevent API abuse
 */

import type { Client, Guild, Role, GuildChannel } from 'discord.js';
import type { SynthesisQueue } from './SynthesisQueue.js';
import type {
  CreateRoleJobPayload,
  CreateChannelJobPayload,
  UpdateRoleJobPayload,
  UpdateChannelJobPayload,
  DeleteRoleJobPayload,
  DeleteChannelJobPayload,
} from './types.js';

// =============================================================================
// Logger Interface
// =============================================================================

/**
 * Logger interface for dependency injection
 * Compatible with pino, winston, or console
 */
export interface Logger {
  info(message: string | object, ...args: any[]): void;
  warn(message: string | object, ...args: any[]): void;
  error(message: string | object, ...args: any[]): void;
  debug?(message: string | object, ...args: any[]): void;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Drift detection result
 */
export interface DriftDetectionResult {
  communityId: string;
  guildId: string;
  driftFound: boolean;
  missingResources: {
    roles: string[]; // Role names
    channels: string[]; // Channel names
  };
  orphanedResources: {
    roles: string[]; // Discord role IDs
    channels: string[]; // Discord channel IDs
  };
  configDrift: {
    roles: Array<{ name: string; field: string; expected: any; actual: any }>;
    channels: Array<{ name: string; field: string; expected: any; actual: any }>;
  };
  timestamp: Date;
}

/**
 * Reconciliation plan (jobs to enqueue)
 */
export interface ReconciliationPlan {
  communityId: string;
  guildId: string;
  operations: {
    createRoles: CreateRoleJobPayload[];
    createChannels: CreateChannelJobPayload[];
    updateRoles: UpdateRoleJobPayload[];
    updateChannels: UpdateChannelJobPayload[];
    deleteRoles: DeleteRoleJobPayload[];
    deleteChannels: DeleteChannelJobPayload[];
  };
  totalOperations: number;
  estimatedDuration: number; // Seconds
}

/**
 * Reconciliation result
 */
export interface ReconciliationResult {
  communityId: string;
  guildId: string;
  success: boolean;
  driftDetected: boolean;
  operationsEnqueued: number;
  jobIds: string[];
  error?: {
    code: string;
    message: string;
  };
  startTime: Date;
  endTime: Date;
  duration: number; // Milliseconds
}

/**
 * Manifest resource (simplified for reconciliation)
 */
export interface ManifestResource {
  name: string;
  type: 'role' | 'channel' | 'category';
  config: {
    color?: number;
    permissions?: string;
    hoist?: boolean;
    mentionable?: boolean;
    position?: number;
    topic?: string;
    parent?: string;
  };
}

/**
 * Desired state manifest
 */
export interface DesiredStateManifest {
  communityId: string;
  guildId: string;
  version: number;
  roles: ManifestResource[];
  channels: ManifestResource[];
  categories: ManifestResource[];
}

/**
 * Shadow state (last known applied state)
 */
export interface ShadowState {
  communityId: string;
  guildId: string;
  appliedAt: Date;
  resources: {
    roles: Record<string, string>; // name -> Discord ID
    channels: Record<string, string>; // name -> Discord ID
    categories: Record<string, string>; // name -> Discord ID
  };
}

/**
 * Reconciliation options
 */
export interface ReconciliationOptions {
  /**
   * Dry-run mode (don't enqueue jobs, just report drift)
   */
  dryRun?: boolean;

  /**
   * Include destructive operations (delete orphaned resources)
   */
  destructive?: boolean;

  /**
   * Force reconciliation even if no drift detected
   */
  force?: boolean;

  /**
   * User ID requesting reconciliation (for audit)
   */
  userId?: string;
}

// =============================================================================
// Reconciliation Controller
// =============================================================================

/**
 * ReconciliationController
 *
 * Detects drift between desired state and actual Discord state,
 * then enqueues synthesis jobs to repair drift.
 */
export class ReconciliationController {
  constructor(
    private discordClient: Client,
    private synthesisQueue: SynthesisQueue,
    private storageAdapter: {
      getManifest: (communityId: string) => Promise<DesiredStateManifest | null>;
      getShadowState: (communityId: string) => Promise<ShadowState | null>;
      updateShadowState: (communityId: string, state: ShadowState) => Promise<void>;
    },
    private logger: Logger = console
  ) {}

  /**
   * Reconcile a single community
   *
   * Main entry point for reconciliation.
   */
  async reconcileCommunity(
    communityId: string,
    options: ReconciliationOptions = {}
  ): Promise<ReconciliationResult> {
    const startTime = new Date();

    try {
      // 1. Load desired state from manifest
      const manifest = await this.storageAdapter.getManifest(communityId);
      if (!manifest) {
        return {
          communityId,
          guildId: '',
          success: false,
          driftDetected: false,
          operationsEnqueued: 0,
          jobIds: [],
          error: {
            code: 'MANIFEST_NOT_FOUND',
            message: `No manifest found for community ${communityId}`,
          },
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        };
      }

      const { guildId } = manifest;

      // 2. Load shadow state
      const shadowState = await this.storageAdapter.getShadowState(communityId);

      // 3. Load actual Discord state
      const guild = await this.discordClient.guilds.fetch(guildId);
      if (!guild) {
        return {
          communityId,
          guildId,
          success: false,
          driftDetected: false,
          operationsEnqueued: 0,
          jobIds: [],
          error: {
            code: 'GUILD_NOT_FOUND',
            message: `Guild ${guildId} not found`,
          },
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        };
      }

      // 4. Detect drift
      const drift = await this.detectDrift(manifest, shadowState, guild);

      if (!drift.driftFound && !options.force) {
        this.logger.info({
          communityId,
          driftFound: false,
        }, 'No drift detected for community');
        return {
          communityId,
          guildId,
          success: true,
          driftDetected: false,
          operationsEnqueued: 0,
          jobIds: [],
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        };
      }

      this.logger.info({
        communityId,
        guildId,
        drift: {
          missingRoles: drift.missingResources.roles.length,
          missingChannels: drift.missingResources.channels.length,
          orphanedRoles: drift.orphanedResources.roles.length,
          orphanedChannels: drift.orphanedResources.channels.length,
          configDriftRoles: drift.configDrift.roles.length,
          configDriftChannels: drift.configDrift.channels.length,
        },
      }, 'Drift detected for community');

      // 5. Generate reconciliation plan
      const plan = await this.generateReconciliationPlan(
        manifest,
        shadowState,
        guild,
        drift,
        options
      );

      // 6. Execute plan (enqueue jobs)
      if (options.dryRun) {
        this.logger.info({
          communityId,
          guildId,
          dryRun: true,
          totalOperations: plan.totalOperations,
        }, 'DRY-RUN: Would enqueue operations');
        return {
          communityId,
          guildId,
          success: true,
          driftDetected: true,
          operationsEnqueued: 0,
          jobIds: [],
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        };
      }

      const jobIds = await this.executePlan(plan);

      // Build new shadow state from successful reconciliation
      // This updates our record of what's actually applied to Discord
      const actualRoles = await guild.roles.fetch();
      const actualChannels = await guild.channels.fetch();

      const newShadowState: ShadowState = {
        communityId,
        guildId,
        appliedAt: new Date(),
        resources: {
          roles: Object.fromEntries(
            Array.from(actualRoles.values())
              .filter((r) => manifest.roles.some((mr) => mr.name === r.name))
              .map((r) => [r.name, r.id])
          ),
          channels: Object.fromEntries(
            Array.from(actualChannels.values())
              .filter((c) => manifest.channels.some((mc) => mc.name === c.name))
              .map((c) => [c.name, c.id])
          ),
          categories: shadowState?.resources.categories || {},
        },
      };

      // Update shadow state to prevent re-detecting the same drift
      await this.storageAdapter.updateShadowState(communityId, newShadowState);

      this.logger.info({
        communityId,
        guildId,
        operationsEnqueued: jobIds.length,
        shadowStateUpdated: true,
      }, 'Reconciliation completed and shadow state updated');

      return {
        communityId,
        guildId,
        success: true,
        driftDetected: true,
        operationsEnqueued: jobIds.length,
        jobIds,
        startTime,
        endTime: new Date(),
        duration: Date.now() - startTime.getTime(),
      };
    } catch (error) {
      this.logger.error({
        communityId,
        error: (error as Error).message,
        stack: (error as Error).stack,
      }, 'Reconciliation failed for community');

      return {
        communityId,
        guildId: '',
        success: false,
        driftDetected: false,
        operationsEnqueued: 0,
        jobIds: [],
        error: {
          code: 'RECONCILIATION_FAILED',
          message: (error as Error).message,
        },
        startTime,
        endTime: new Date(),
        duration: Date.now() - startTime.getTime(),
      };
    }
  }

  /**
   * Detect drift between desired, shadow, and actual state
   */
  private async detectDrift(
    manifest: DesiredStateManifest,
    shadowState: ShadowState | null,
    guild: Guild
  ): Promise<DriftDetectionResult> {
    const missingResources = {
      roles: [] as string[],
      channels: [] as string[],
    };

    const orphanedResources = {
      roles: [] as string[],
      channels: [] as string[],
    };

    const configDrift = {
      roles: [] as Array<{ name: string; field: string; expected: any; actual: any }>,
      channels: [] as Array<{ name: string; field: string; expected: any; actual: any }>,
    };

    // Fetch actual Discord resources
    const actualRoles = await guild.roles.fetch();
    const actualChannels = await guild.channels.fetch();

    // Build maps for quick lookup
    const actualRolesMap = new Map(
      Array.from(actualRoles.values()).map((r) => [r.name, r])
    );
    const actualChannelsMap = new Map(
      Array.from(actualChannels.values()).map((c) => [c.name, c])
    );

    // Check for missing resources (in manifest but not in actual)
    for (const role of manifest.roles) {
      if (!actualRolesMap.has(role.name)) {
        missingResources.roles.push(role.name);
      } else {
        // Check for config drift
        const actualRole = actualRolesMap.get(role.name)!;
        if (role.config.color && actualRole.color !== role.config.color) {
          configDrift.roles.push({
            name: role.name,
            field: 'color',
            expected: role.config.color,
            actual: actualRole.color,
          });
        }
        // Add more config checks as needed
      }
    }

    for (const channel of manifest.channels) {
      if (!actualChannelsMap.has(channel.name)) {
        missingResources.channels.push(channel.name);
      } else {
        // Check for config drift
        const actualChannel = actualChannelsMap.get(channel.name)!;

        // Type-safe check for text channels with topic field
        if (
          channel.config.topic &&
          'topic' in actualChannel &&
          actualChannel.isTextBased()
        ) {
          // Type narrowing: we know it's a text-based channel with topic
          const channelTopic = (actualChannel as { topic: string | null }).topic;
          if (channelTopic !== channel.config.topic) {
            configDrift.channels.push({
              name: channel.name,
              field: 'topic',
              expected: channel.config.topic,
              actual: channelTopic,
            });
          }
        }
        // Add more config checks as needed
      }
    }

    // Check for orphaned resources (in actual but not in manifest)
    // Only check if we have shadow state (otherwise we don't know what we created)
    if (shadowState) {
      const desiredRoleNames = new Set(manifest.roles.map((r) => r.name));
      const desiredChannelNames = new Set(manifest.channels.map((c) => c.name));

      for (const [name, roleId] of Object.entries(shadowState.resources.roles)) {
        if (!desiredRoleNames.has(name)) {
          orphanedResources.roles.push(roleId);
        }
      }

      for (const [name, channelId] of Object.entries(shadowState.resources.channels)) {
        if (!desiredChannelNames.has(name)) {
          orphanedResources.channels.push(channelId);
        }
      }
    }

    const driftFound =
      missingResources.roles.length > 0 ||
      missingResources.channels.length > 0 ||
      orphanedResources.roles.length > 0 ||
      orphanedResources.channels.length > 0 ||
      configDrift.roles.length > 0 ||
      configDrift.channels.length > 0;

    return {
      communityId: manifest.communityId,
      guildId: manifest.guildId,
      driftFound,
      missingResources,
      orphanedResources,
      configDrift,
      timestamp: new Date(),
    };
  }

  /**
   * Generate reconciliation plan from drift detection
   */
  private async generateReconciliationPlan(
    manifest: DesiredStateManifest,
    shadowState: ShadowState | null,
    guild: Guild,
    drift: DriftDetectionResult,
    options: ReconciliationOptions
  ): Promise<ReconciliationPlan> {
    const plan: ReconciliationPlan = {
      communityId: manifest.communityId,
      guildId: manifest.guildId,
      operations: {
        createRoles: [],
        createChannels: [],
        updateRoles: [],
        updateChannels: [],
        deleteRoles: [],
        deleteChannels: [],
      },
      totalOperations: 0,
      estimatedDuration: 0,
    };

    // Create missing roles
    for (const roleName of drift.missingResources.roles) {
      const role = manifest.roles.find((r) => r.name === roleName);
      if (role) {
        plan.operations.createRoles.push({
          guildId: manifest.guildId,
          name: role.name,
          color: role.config.color,
          permissions: role.config.permissions,
          hoist: role.config.hoist,
          mentionable: role.config.mentionable,
          position: role.config.position,
          reason: 'Reconciliation: Missing resource',
        });
      }
    }

    // Create missing channels
    for (const channelName of drift.missingResources.channels) {
      const channel = manifest.channels.find((c) => c.name === channelName);
      if (channel) {
        plan.operations.createChannels.push({
          guildId: manifest.guildId,
          name: channel.name,
          topic: channel.config.topic,
          parent: channel.config.parent,
          reason: 'Reconciliation: Missing resource',
        });
      }
    }

    // Update roles with config drift
    for (const driftItem of drift.configDrift.roles) {
      const role = manifest.roles.find((r) => r.name === driftItem.name);
      const actualRoles = await guild.roles.fetch();
      const actualRole = Array.from(actualRoles.values()).find(
        (r) => r.name === driftItem.name
      );

      if (role && actualRole) {
        plan.operations.updateRoles.push({
          guildId: manifest.guildId,
          roleId: actualRole.id,
          name: role.name,
          color: role.config.color,
          permissions: role.config.permissions,
          hoist: role.config.hoist,
          mentionable: role.config.mentionable,
          position: role.config.position,
          reason: `Reconciliation: Config drift in ${driftItem.field}`,
        });
      }
    }

    // Update channels with config drift
    for (const driftItem of drift.configDrift.channels) {
      const channel = manifest.channels.find((c) => c.name === driftItem.name);
      const actualChannels = await guild.channels.fetch();
      const actualChannel = Array.from(actualChannels.values()).find(
        (c) => c.name === driftItem.name
      );

      if (channel && actualChannel) {
        plan.operations.updateChannels.push({
          guildId: manifest.guildId,
          channelId: actualChannel.id,
          name: channel.name,
          topic: channel.config.topic,
          parent: channel.config.parent,
          reason: `Reconciliation: Config drift in ${driftItem.field}`,
        });
      }
    }

    // Delete orphaned resources (only if destructive mode enabled)
    if (options.destructive) {
      for (const roleId of drift.orphanedResources.roles) {
        plan.operations.deleteRoles.push({
          guildId: manifest.guildId,
          roleId,
          reason: 'Reconciliation: Orphaned resource',
        });
      }

      for (const channelId of drift.orphanedResources.channels) {
        plan.operations.deleteChannels.push({
          guildId: manifest.guildId,
          channelId,
          reason: 'Reconciliation: Orphaned resource',
        });
      }
    }

    // Calculate total operations and estimated duration
    plan.totalOperations =
      plan.operations.createRoles.length +
      plan.operations.createChannels.length +
      plan.operations.updateRoles.length +
      plan.operations.updateChannels.length +
      plan.operations.deleteRoles.length +
      plan.operations.deleteChannels.length;

    // Estimate 2 seconds per operation (conservative)
    plan.estimatedDuration = plan.totalOperations * 2;

    return plan;
  }

  /**
   * Execute reconciliation plan (enqueue jobs)
   */
  private async executePlan(plan: ReconciliationPlan): Promise<string[]> {
    const jobIds: string[] = [];

    // Enqueue create role jobs
    for (const payload of plan.operations.createRoles) {
      const jobId = await this.synthesisQueue.enqueue('CREATE_ROLE', payload, {
        communityId: plan.communityId,
        metadata: { reconciliation: true },
      });
      jobIds.push(jobId);
    }

    // Enqueue create channel jobs
    for (const payload of plan.operations.createChannels) {
      const jobId = await this.synthesisQueue.enqueue('CREATE_CHANNEL', payload, {
        communityId: plan.communityId,
        metadata: { reconciliation: true },
      });
      jobIds.push(jobId);
    }

    // Enqueue update role jobs
    for (const payload of plan.operations.updateRoles) {
      const jobId = await this.synthesisQueue.enqueue('UPDATE_ROLE', payload, {
        communityId: plan.communityId,
        metadata: { reconciliation: true },
      });
      jobIds.push(jobId);
    }

    // Enqueue update channel jobs
    for (const payload of plan.operations.updateChannels) {
      const jobId = await this.synthesisQueue.enqueue('UPDATE_CHANNEL', payload, {
        communityId: plan.communityId,
        metadata: { reconciliation: true },
      });
      jobIds.push(jobId);
    }

    // Enqueue delete role jobs
    for (const payload of plan.operations.deleteRoles) {
      const jobId = await this.synthesisQueue.enqueue('DELETE_ROLE', payload, {
        communityId: plan.communityId,
        metadata: { reconciliation: true, destructive: true },
      });
      jobIds.push(jobId);
    }

    // Enqueue delete channel jobs
    for (const payload of plan.operations.deleteChannels) {
      const jobId = await this.synthesisQueue.enqueue('DELETE_CHANNEL', payload, {
        communityId: plan.communityId,
        metadata: { reconciliation: true, destructive: true },
      });
      jobIds.push(jobId);
    }

    return jobIds;
  }

  /**
   * Reconcile all communities (batch reconciliation)
   */
  async reconcileAll(
    communityIds: string[],
    options: ReconciliationOptions = {}
  ): Promise<ReconciliationResult[]> {
    const results: ReconciliationResult[] = [];

    for (const communityId of communityIds) {
      const result = await this.reconcileCommunity(communityId, options);
      results.push(result);
    }

    return results;
  }
}
