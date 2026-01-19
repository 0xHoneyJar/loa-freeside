/**
 * Destroy Engine
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Destroys all managed resources in a workspace.
 * Generates delete operations for all resources and applies them.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.6
 * @module packages/cli/commands/server/iac/DestroyEngine
 */

import type { StateBackend, GaibState } from './backends/types.js';
import type {
  ServerDiff,
  ApplyBatchResult,
  Snowflake,
  RoleChange,
  CategoryChange,
  ChannelChange,
  PermissionChange,
} from './types.js';
import { StateWriter, type ApplyOptions } from './StateWriter.js';
import { StateLock, type AcquireLockOptions } from './StateLock.js';
import { DiscordClient } from './DiscordClient.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the destroy operation
 */
export interface DestroyEngineOptions extends ApplyOptions {
  /** Skip state locking (default: false) */
  skipLock?: boolean;
  /** Additional lock info */
  lockInfo?: string;
  /** Target specific resource types (default: all) */
  targetTypes?: ('role' | 'category' | 'channel')[];
}

/**
 * Result of a destroy operation
 */
export interface DestroyEngineResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Batch result from StateWriter */
  applyResult?: ApplyBatchResult;
  /** Error message if failed */
  error?: string;
  /** Whether state was updated */
  stateUpdated: boolean;
  /** New state serial number */
  newSerial?: number;
  /** Number of resources destroyed */
  resourcesDestroyed: number;
}

/**
 * Resource info extracted from state
 */
interface StateResource {
  type: 'role' | 'category' | 'channel';
  name: string;
  id: string;
  attributes: Record<string, unknown>;
}

// ============================================================================
// DestroyEngine
// ============================================================================

/**
 * Destroy Engine
 *
 * Destroys all managed resources in a workspace:
 * 1. Read current state to find managed resources
 * 2. Generate delete operations for all resources
 * 3. Apply deletions in reverse dependency order
 * 4. Clear state
 *
 * @example
 * ```typescript
 * const engine = new DestroyEngine(backend, client);
 *
 * const result = await engine.destroy(
 *   guildId,
 *   'staging',
 *   { dryRun: false }
 * );
 *
 * if (result.success) {
 *   console.log(`Destroyed ${result.resourcesDestroyed} resources`);
 * }
 * ```
 */
export class DestroyEngine {
  private readonly backend: StateBackend;
  private readonly writer: StateWriter;
  private readonly stateLock: StateLock;

  constructor(backend: StateBackend, client: DiscordClient, writer?: StateWriter) {
    this.backend = backend;
    this.writer = writer ?? new StateWriter(client);
    this.stateLock = new StateLock(backend);
  }

  /**
   * Destroy all managed resources in a workspace
   *
   * @param guildId - Discord guild ID
   * @param workspace - Workspace name
   * @param options - Destroy options
   */
  async destroy(
    guildId: Snowflake,
    workspace: string,
    options: DestroyEngineOptions = {}
  ): Promise<DestroyEngineResult> {
    const {
      dryRun = false,
      skipLock = false,
      lockInfo,
      targetTypes,
      ...applyOptions
    } = options;

    // Get current state
    const state = await this.backend.getState(workspace);
    if (!state || state.resources.length === 0) {
      return {
        success: true,
        stateUpdated: false,
        resourcesDestroyed: 0,
      };
    }

    // Extract resources from state
    const resources = this.extractResources(state, targetTypes);
    if (resources.length === 0) {
      return {
        success: true,
        stateUpdated: false,
        resourcesDestroyed: 0,
      };
    }

    // Generate destroy diff
    const diff = this.generateDestroyDiff(resources);

    // If dry run, just run the writer without locking
    if (dryRun) {
      const applyResult = await this.writer.apply(diff, guildId, { ...applyOptions, dryRun: true });
      return {
        success: applyResult.success,
        applyResult,
        stateUpdated: false,
        resourcesDestroyed: resources.length,
      };
    }

    // Define the destroy operation
    const destroyOperation = async (): Promise<DestroyEngineResult> => {
      // Apply destroy diff to Discord
      const applyResult = await this.writer.apply(diff, guildId, applyOptions);

      // Clear state (or remove destroyed resources)
      const newSerial = await this.updateState(workspace, state, resources, applyResult);

      return {
        success: applyResult.success,
        applyResult,
        stateUpdated: true,
        newSerial,
        resourcesDestroyed: applyResult.summary.succeeded,
      };
    };

    // Execute with or without locking
    if (skipLock) {
      return destroyOperation();
    }

    // Execute with lock
    const lockOptions: AcquireLockOptions = {
      operation: 'destroy',
      info: lockInfo ?? `Destroying ${resources.length} resources`,
    };

    const lockedResult = await this.stateLock.withLock(workspace, lockOptions, destroyOperation);

    if (!lockedResult.success) {
      return {
        success: false,
        error: lockedResult.error ?? 'Failed to acquire lock',
        stateUpdated: false,
        resourcesDestroyed: 0,
      };
    }

    return lockedResult.result!;
  }

  /**
   * Get a preview of what would be destroyed
   *
   * @param workspace - Workspace name
   * @param targetTypes - Optional filter for resource types
   */
  async preview(
    workspace: string,
    targetTypes?: ('role' | 'category' | 'channel')[]
  ): Promise<{ resources: StateResource[]; diff: ServerDiff }> {
    const state = await this.backend.getState(workspace);
    if (!state) {
      return {
        resources: [],
        diff: this.createEmptyDiff(),
      };
    }

    const resources = this.extractResources(state, targetTypes);
    const diff = this.generateDestroyDiff(resources);

    return { resources, diff };
  }

  /**
   * Extract resources from state
   */
  private extractResources(
    state: GaibState,
    targetTypes?: ('role' | 'category' | 'channel')[]
  ): StateResource[] {
    const resources: StateResource[] = [];

    for (const resource of state.resources) {
      let type: 'role' | 'category' | 'channel' | null = null;

      if (resource.type === 'discord_role') {
        type = 'role';
      } else if (resource.type === 'discord_category') {
        type = 'category';
      } else if (resource.type === 'discord_channel') {
        type = 'channel';
      }

      if (!type) continue;
      if (targetTypes && !targetTypes.includes(type)) continue;

      const instance = resource.instances[0];
      if (!instance?.attributes?.id) continue;

      resources.push({
        type,
        name: resource.name,
        id: instance.attributes.id as string,
        attributes: instance.attributes,
      });
    }

    return resources;
  }

  /**
   * Generate a diff that deletes all resources
   */
  private generateDestroyDiff(resources: StateResource[]): ServerDiff {
    const roles: RoleChange[] = [];
    const categories: CategoryChange[] = [];
    const channels: ChannelChange[] = [];
    const permissions: PermissionChange[] = [];

    for (const resource of resources) {
      if (resource.type === 'role') {
        roles.push({
          operation: 'delete',
          name: resource.name,
          current: {
            id: resource.id,
            name: resource.attributes.name as string,
            color: (resource.attributes.color as string) ?? '#000000',
            hoist: (resource.attributes.hoist as boolean) ?? false,
            mentionable: (resource.attributes.mentionable as boolean) ?? false,
            permissions: (resource.attributes.permissions ?? []) as import('./types.js').RoleState['permissions'],
            position: (resource.attributes.position as number) ?? 0,
            managed: false,
            isEveryone: false,
            isIacManaged: true,
          },
        });
      } else if (resource.type === 'category') {
        categories.push({
          operation: 'delete',
          name: resource.name,
          current: {
            id: resource.id,
            name: resource.attributes.name as string,
            position: (resource.attributes.position as number) ?? 0,
            permissionOverwrites: [],
            isIacManaged: true,
          },
        });
      } else if (resource.type === 'channel') {
        channels.push({
          operation: 'delete',
          name: resource.name,
          current: {
            id: resource.id,
            name: resource.attributes.name as string,
            type: resource.attributes.type as 'text' | 'voice' | 'announcement' | 'stage' | 'forum',
            parentId: resource.attributes.parent_id as string | undefined,
            parentName: resource.attributes.parent_name as string | undefined,
            topic: resource.attributes.topic as string | undefined,
            nsfw: (resource.attributes.nsfw as boolean) ?? false,
            slowmode: (resource.attributes.slowmode as number) ?? 0,
            position: (resource.attributes.position as number) ?? 0,
            bitrate: resource.attributes.bitrate as number | undefined,
            userLimit: resource.attributes.user_limit as number | undefined,
            permissionOverwrites: [],
            isIacManaged: true,
          },
        });
      }
    }

    const total = roles.length + categories.length + channels.length;

    return {
      guildId: '', // Will be set during apply
      roles,
      categories,
      channels,
      permissions,
      hasChanges: total > 0,
      summary: {
        create: 0,
        update: 0,
        delete: total,
        noop: 0,
        total,
      },
    };
  }

  /**
   * Create an empty diff
   */
  private createEmptyDiff(): ServerDiff {
    return {
      guildId: '',
      roles: [],
      categories: [],
      channels: [],
      permissions: [],
      hasChanges: false,
      summary: {
        create: 0,
        update: 0,
        delete: 0,
        noop: 0,
        total: 0,
      },
    };
  }

  /**
   * Update state after destroy
   */
  private async updateState(
    workspace: string,
    state: GaibState,
    _destroyedResources: StateResource[],
    applyResult: ApplyBatchResult
  ): Promise<number> {
    // Build set of successfully destroyed resources
    const destroyed = new Set<string>();
    for (const result of applyResult.results) {
      if (result.success && result.operation === 'delete') {
        destroyed.add(`${result.resourceType}:${result.resourceName}`);
      }
    }

    // Remove destroyed resources from state
    const typeMap: Record<string, string> = {
      role: 'discord_role',
      category: 'discord_category',
      channel: 'discord_channel',
    };

    state.resources = state.resources.filter((resource) => {
      for (const [type, stateType] of Object.entries(typeMap)) {
        if (resource.type === stateType && destroyed.has(`${type}:${resource.name}`)) {
          return false;
        }
      }
      return true;
    });

    // Update metadata
    state.serial += 1;
    state.lastModified = new Date().toISOString();

    // Persist state
    await this.backend.setState(workspace, state);

    return state.serial;
  }

  /**
   * Get state lock instance for external use
   */
  getStateLock(): StateLock {
    return this.stateLock;
  }

  /**
   * Get the backend instance
   */
  getBackend(): StateBackend {
    return this.backend;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a DestroyEngine from a backend and Discord client
 */
export function createDestroyEngine(
  backend: StateBackend,
  client: DiscordClient
): DestroyEngine {
  return new DestroyEngine(backend, client);
}

/**
 * Create a DestroyEngine from environment variables
 *
 * Accepts either DISCORD_BOT_TOKEN or DISCORD_TOKEN for flexibility
 */
export function createDestroyEngineFromEnv(backend: StateBackend): DestroyEngine {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error(
      'Discord bot token not found.\n' +
        'Set DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable.'
    );
  }
  const client = new DiscordClient({ token });
  return new DestroyEngine(backend, client);
}
