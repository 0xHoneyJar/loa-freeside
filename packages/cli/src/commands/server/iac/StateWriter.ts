/**
 * StateWriter - Apply Configuration Changes to Discord
 *
 * Sprint 92: Discord Infrastructure-as-Code - Diff Calculation & State Application
 *
 * Applies changes from a ServerDiff to Discord via the REST API.
 * Handles dependency ordering (categories → roles → channels → permissions),
 * rate limiting, and retry logic.
 *
 * @see SDD grimoires/loa/discord-iac-sdd.md §4.2.4
 * @module packages/cli/commands/server/iac/StateWriter
 */

import { ChannelType as DiscordChannelType, OverwriteType } from 'discord-api-types/v10';
import { DiscordClient } from './DiscordClient.js';
import { RateLimiter } from './RateLimiter.js';
import { RetryHandler } from './RetryHandler.js';
import {
  colorToInt,
  permissionsToBitfield,
  addManagedMarker,
  type ChannelType,
} from './schemas.js';
import type {
  ServerDiff,
  RoleChange,
  CategoryChange,
  ChannelChange,
  PermissionChange,
  ApplyResult,
  ApplyBatchResult,
  Snowflake,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for applying changes
 */
export interface ApplyOptions {
  /** Dry run - don't actually make changes (default: false) */
  dryRun?: boolean;
  /** Continue on error (default: true) */
  continueOnError?: boolean;
  /** Progress callback */
  onProgress?: (result: ApplyResult) => void;
  /** Rate limiter instance (default: creates new one) */
  rateLimiter?: RateLimiter;
  /** Retry handler instance (default: creates new one) */
  retryHandler?: RetryHandler;
}

/**
 * Resource ID mapping built during apply
 * Maps resource names to their Discord IDs
 */
export interface ResourceIdMap {
  roles: Map<string, Snowflake>;
  categories: Map<string, Snowflake>;
  channels: Map<string, Snowflake>;
}

// ============================================================================
// StateWriter Class
// ============================================================================

/**
 * Apply configuration changes to Discord
 *
 * @example
 * ```typescript
 * const writer = new StateWriter(client);
 * const result = await writer.apply(diff, guildId);
 *
 * if (result.success) {
 *   console.log(`Applied ${result.summary.succeeded} changes`);
 * } else {
 *   console.error(`${result.summary.failed} changes failed`);
 * }
 * ```
 */
export class StateWriter {
  private readonly client: DiscordClient;
  private readonly rateLimiter: RateLimiter;
  private readonly retryHandler: RetryHandler;

  constructor(
    client: DiscordClient,
    rateLimiter?: RateLimiter,
    retryHandler?: RetryHandler
  ) {
    this.client = client;
    this.rateLimiter = rateLimiter ?? new RateLimiter();
    this.retryHandler = retryHandler ?? new RetryHandler({
      maxAttempts: 3,
      onRetry: (attempt, error, delay) => {
        // Log retry attempts
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`Retry ${attempt}: ${msg} (waiting ${delay}ms)`);
      },
    });
  }

  /**
   * Apply all changes from a diff to Discord
   *
   * Order of operations:
   * 1. Create categories (needed for channel parent references)
   * 2. Create roles (needed for permission overwrites)
   * 3. Update existing categories
   * 4. Update existing roles
   * 5. Create channels (with category and permission references)
   * 6. Update existing channels
   * 7. Apply permission overwrites
   * 8. Delete channels (reverse order for safety)
   * 9. Delete roles
   * 10. Delete categories
   */
  async apply(
    diff: ServerDiff,
    guildId: Snowflake,
    options: ApplyOptions = {}
  ): Promise<ApplyBatchResult> {
    const {
      dryRun = false,
      continueOnError = true,
      onProgress,
    } = options;

    const startTime = Date.now();
    const results: ApplyResult[] = [];
    const idMap: ResourceIdMap = {
      roles: new Map(),
      categories: new Map(),
      channels: new Map(),
    };

    // Populate ID map with existing resources
    this.populateIdMap(diff, idMap);

    // Helper to handle errors
    const handleResult = (result: ApplyResult): boolean => {
      results.push(result);
      if (onProgress) {
        onProgress(result);
      }
      if (!result.success && !continueOnError) {
        return false; // Stop processing
      }
      return true;
    };

    // Phase 1: Create categories
    const categoryCreates = diff.categories.filter((c) => c.operation === 'create');
    for (const change of categoryCreates) {
      const result = await this.applyCategory(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 2: Create roles
    const roleCreates = diff.roles.filter((r) => r.operation === 'create');
    for (const change of roleCreates) {
      const result = await this.applyRole(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 3: Update categories
    const categoryUpdates = diff.categories.filter((c) => c.operation === 'update');
    for (const change of categoryUpdates) {
      const result = await this.applyCategory(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 4: Update roles
    const roleUpdates = diff.roles.filter((r) => r.operation === 'update');
    for (const change of roleUpdates) {
      const result = await this.applyRole(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 5: Create channels
    const channelCreates = diff.channels.filter((c) => c.operation === 'create');
    for (const change of channelCreates) {
      const result = await this.applyChannel(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 6: Update channels
    const channelUpdates = diff.channels.filter((c) => c.operation === 'update');
    for (const change of channelUpdates) {
      const result = await this.applyChannel(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 7: Apply permission overwrites
    for (const change of diff.permissions) {
      const result = await this.applyPermission(change, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 8: Delete channels
    const channelDeletes = diff.channels.filter((c) => c.operation === 'delete');
    for (const change of channelDeletes) {
      const result = await this.applyChannel(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 9: Delete roles
    const roleDeletes = diff.roles.filter((r) => r.operation === 'delete');
    for (const change of roleDeletes) {
      const result = await this.applyRole(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    // Phase 10: Delete categories
    const categoryDeletes = diff.categories.filter((c) => c.operation === 'delete');
    for (const change of categoryDeletes) {
      const result = await this.applyCategory(change, guildId, idMap, dryRun);
      if (!handleResult(result)) {
        return this.buildResult(results, startTime);
      }
    }

    return this.buildResult(results, startTime);
  }

  // ============================================================================
  // Role Operations
  // ============================================================================

  private async applyRole(
    change: RoleChange,
    guildId: Snowflake,
    idMap: ResourceIdMap,
    dryRun: boolean
  ): Promise<ApplyResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        operation: change.operation,
        resourceType: 'role',
        resourceName: change.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      switch (change.operation) {
        case 'create': {
          const desired = change.desired!;
          await this.rateLimiter.wait('create');

          const result = await this.retryHandler.executeOrThrow(async () => {
            return this.client.createRole(guildId, {
              name: desired.name,
              color: colorToInt(desired.color),
              hoist: desired.hoist,
              mentionable: desired.mentionable,
              permissions: permissionsToBitfield(desired.permissions),
            });
          });

          // Store new ID
          idMap.roles.set(desired.name.toLowerCase(), result.id);

          return {
            success: true,
            operation: 'create',
            resourceType: 'role',
            resourceName: change.name,
            newId: result.id,
            durationMs: Date.now() - startTime,
          };
        }

        case 'update': {
          const current = change.current!;
          const desired = change.desired!;
          await this.rateLimiter.wait('update');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.updateRole(guildId, current.id, {
              name: desired.name,
              color: colorToInt(desired.color),
              hoist: desired.hoist,
              mentionable: desired.mentionable,
              permissions: permissionsToBitfield(desired.permissions),
            });
          });

          return {
            success: true,
            operation: 'update',
            resourceType: 'role',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
        }

        case 'delete': {
          const current = change.current!;
          await this.rateLimiter.wait('delete');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.deleteRole(guildId, current.id);
          });

          return {
            success: true,
            operation: 'delete',
            resourceType: 'role',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
        }

        default:
          return {
            success: true,
            operation: change.operation,
            resourceType: 'role',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        operation: change.operation,
        resourceType: 'role',
        resourceName: change.name,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Category Operations
  // ============================================================================

  private async applyCategory(
    change: CategoryChange,
    guildId: Snowflake,
    idMap: ResourceIdMap,
    dryRun: boolean
  ): Promise<ApplyResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        operation: change.operation,
        resourceType: 'category',
        resourceName: change.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      switch (change.operation) {
        case 'create': {
          const desired = change.desired!;
          await this.rateLimiter.wait('create');

          const result = await this.retryHandler.executeOrThrow(async () => {
            return this.client.createChannel(guildId, {
              name: desired.name,
              type: DiscordChannelType.GuildCategory,
              position: desired.position,
            });
          });

          // Store new ID
          idMap.categories.set(desired.name.toLowerCase(), result.id);

          return {
            success: true,
            operation: 'create',
            resourceType: 'category',
            resourceName: change.name,
            newId: result.id,
            durationMs: Date.now() - startTime,
          };
        }

        case 'update': {
          const current = change.current!;
          const desired = change.desired!;
          await this.rateLimiter.wait('update');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.updateChannel(current.id, {
              name: desired.name,
              position: desired.position,
            });
          });

          return {
            success: true,
            operation: 'update',
            resourceType: 'category',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
        }

        case 'delete': {
          const current = change.current!;
          await this.rateLimiter.wait('delete');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.deleteChannel(current.id);
          });

          return {
            success: true,
            operation: 'delete',
            resourceType: 'category',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
        }

        default:
          return {
            success: true,
            operation: change.operation,
            resourceType: 'category',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        operation: change.operation,
        resourceType: 'category',
        resourceName: change.name,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Channel Operations
  // ============================================================================

  private async applyChannel(
    change: ChannelChange,
    guildId: Snowflake,
    idMap: ResourceIdMap,
    dryRun: boolean
  ): Promise<ApplyResult> {
    const startTime = Date.now();

    if (dryRun) {
      return {
        success: true,
        operation: change.operation,
        resourceType: 'channel',
        resourceName: change.name,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      switch (change.operation) {
        case 'create': {
          const desired = change.desired!;
          await this.rateLimiter.wait('create');

          // Resolve parent category ID
          const parentId = desired.parentName
            ? idMap.categories.get(desired.parentName.toLowerCase())
            : undefined;

          // Add managed marker to topic
          const topic = addManagedMarker(desired.topic);

          const result = await this.retryHandler.executeOrThrow(async () => {
            return this.client.createChannel(guildId, {
              name: desired.name,
              type: this.getDiscordChannelType(desired.type),
              parent_id: parentId,
              topic: desired.type === 'text' || desired.type === 'announcement' ? topic : undefined,
              nsfw: desired.nsfw,
              rate_limit_per_user: desired.slowmode,
              position: desired.position,
              bitrate: desired.bitrate,
              user_limit: desired.userLimit,
            });
          });

          // Store new ID
          idMap.channels.set(desired.name.toLowerCase(), result.id);

          return {
            success: true,
            operation: 'create',
            resourceType: 'channel',
            resourceName: change.name,
            newId: result.id,
            durationMs: Date.now() - startTime,
          };
        }

        case 'update': {
          const current = change.current!;
          const desired = change.desired!;
          await this.rateLimiter.wait('update');

          // Resolve parent category ID
          const parentId = desired.parentName
            ? idMap.categories.get(desired.parentName.toLowerCase())
            : null;

          // Add managed marker to topic
          const topic = addManagedMarker(desired.topic);

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.updateChannel(current.id, {
              name: desired.name,
              parent_id: parentId,
              topic: desired.type === 'text' || desired.type === 'announcement' ? topic : undefined,
              nsfw: desired.nsfw,
              rate_limit_per_user: desired.slowmode,
              position: desired.position,
              bitrate: desired.bitrate,
              user_limit: desired.userLimit,
            });
          });

          return {
            success: true,
            operation: 'update',
            resourceType: 'channel',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
        }

        case 'delete': {
          const current = change.current!;
          await this.rateLimiter.wait('delete');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.deleteChannel(current.id);
          });

          return {
            success: true,
            operation: 'delete',
            resourceType: 'channel',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
        }

        default:
          return {
            success: true,
            operation: change.operation,
            resourceType: 'channel',
            resourceName: change.name,
            durationMs: Date.now() - startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        operation: change.operation,
        resourceType: 'channel',
        resourceName: change.name,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Permission Operations
  // ============================================================================

  private async applyPermission(
    change: PermissionChange,
    idMap: ResourceIdMap,
    dryRun: boolean
  ): Promise<ApplyResult> {
    const startTime = Date.now();
    const resourceName = `${change.targetName}/${change.subjectName}`;

    if (dryRun) {
      return {
        success: true,
        operation: change.operation,
        resourceType: 'permission',
        resourceName,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Resolve target ID (channel or category)
      let targetId = change.targetId;
      if (!targetId) {
        const map = change.targetType === 'category' ? idMap.categories : idMap.channels;
        targetId = map.get(change.targetName.toLowerCase()) ?? change.targetId;
      }

      // Resolve subject ID (role)
      let subjectId = change.subjectId;
      if (!subjectId && change.subjectType === 'role') {
        subjectId = idMap.roles.get(change.subjectName.toLowerCase()) ?? change.subjectId;
      }

      if (!targetId || !subjectId) {
        return {
          success: false,
          operation: change.operation,
          resourceType: 'permission',
          resourceName,
          error: 'Could not resolve target or subject ID',
          durationMs: Date.now() - startTime,
        };
      }

      switch (change.operation) {
        case 'create':
        case 'update': {
          const desired = change.desired!;
          await this.rateLimiter.wait('update');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.setChannelPermission(targetId!, subjectId!, {
              type: change.subjectType === 'role' ? OverwriteType.Role : OverwriteType.Member,
              allow: permissionsToBitfield(desired.allow),
              deny: permissionsToBitfield(desired.deny),
            });
          });

          return {
            success: true,
            operation: change.operation,
            resourceType: 'permission',
            resourceName,
            durationMs: Date.now() - startTime,
          };
        }

        case 'delete': {
          await this.rateLimiter.wait('delete');

          await this.retryHandler.executeOrThrow(async () => {
            return this.client.deleteChannelPermission(targetId!, subjectId!);
          });

          return {
            success: true,
            operation: 'delete',
            resourceType: 'permission',
            resourceName,
            durationMs: Date.now() - startTime,
          };
        }

        default:
          return {
            success: true,
            operation: change.operation,
            resourceType: 'permission',
            resourceName,
            durationMs: Date.now() - startTime,
          };
      }
    } catch (error) {
      return {
        success: false,
        operation: change.operation,
        resourceType: 'permission',
        resourceName,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Populate ID map with existing resource IDs from diff
   */
  private populateIdMap(diff: ServerDiff, idMap: ResourceIdMap): void {
    // Add existing role IDs
    for (const change of diff.roles) {
      if (change.current?.id) {
        idMap.roles.set(change.name.toLowerCase(), change.current.id);
      }
    }

    // Add existing category IDs
    for (const change of diff.categories) {
      if (change.current?.id) {
        idMap.categories.set(change.name.toLowerCase(), change.current.id);
      }
    }

    // Add existing channel IDs
    for (const change of diff.channels) {
      if (change.current?.id) {
        idMap.channels.set(change.name.toLowerCase(), change.current.id);
      }
    }
  }

  /**
   * Build final result from individual results
   */
  private buildResult(results: ApplyResult[], startTime: number): ApplyBatchResult {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      success: failed === 0,
      results,
      summary: {
        total: results.length,
        succeeded,
        failed,
      },
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Convert IaC channel type to Discord channel type
   */
  private getDiscordChannelType(
    type: ChannelType
  ): DiscordChannelType.GuildText | DiscordChannelType.GuildVoice | DiscordChannelType.GuildAnnouncement | DiscordChannelType.GuildStageVoice | DiscordChannelType.GuildForum {
    switch (type) {
      case 'text':
        return DiscordChannelType.GuildText;
      case 'voice':
        return DiscordChannelType.GuildVoice;
      case 'announcement':
        return DiscordChannelType.GuildAnnouncement;
      case 'stage':
        return DiscordChannelType.GuildStageVoice;
      case 'forum':
        return DiscordChannelType.GuildForum;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a StateWriter from environment
 *
 * Accepts either DISCORD_BOT_TOKEN or DISCORD_TOKEN for flexibility
 */
export function createWriterFromEnv(): StateWriter {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error(
      'Discord bot token not found.\n' +
        'Set DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable.'
    );
  }
  const client = new DiscordClient({ token });
  return new StateWriter(client);
}

/**
 * Format apply result for display
 */
export function formatApplyResult(result: ApplyBatchResult): string {
  const lines: string[] = [];

  lines.push(`Apply Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  lines.push(`  Total: ${result.summary.total}`);
  lines.push(`  Succeeded: ${result.summary.succeeded}`);
  lines.push(`  Failed: ${result.summary.failed}`);
  lines.push(`  Duration: ${result.totalDurationMs}ms`);

  if (result.summary.failed > 0) {
    lines.push('');
    lines.push('Failures:');
    for (const res of result.results.filter((r) => !r.success)) {
      lines.push(`  - ${res.resourceType}/${res.resourceName}: ${res.error}`);
    }
  }

  return lines.join('\n');
}
