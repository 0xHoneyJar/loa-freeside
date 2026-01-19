/**
 * Apply Engine
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Orchestrates the apply operation with proper state locking.
 * Wraps StateWriter with lock acquisition/release and state persistence.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.6
 * @module packages/cli/commands/server/iac/ApplyEngine
 */

import type { StateBackend, GaibState } from './backends/types.js';
import type { ServerDiff, ApplyBatchResult, Snowflake } from './types.js';
import { StateWriter, type ApplyOptions } from './StateWriter.js';
import { StateLock, type AcquireLockOptions } from './StateLock.js';
import { DiscordClient } from './DiscordClient.js';
import { createEmptyState } from './backends/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for the apply operation
 */
export interface ApplyEngineOptions extends ApplyOptions {
  /** Skip confirmation prompts (default: false) */
  autoApprove?: boolean;
  /** Skip state locking (default: false) */
  skipLock?: boolean;
  /** Additional lock info */
  lockInfo?: string;
}

/**
 * Result of an apply operation
 */
export interface ApplyEngineResult {
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
}

// ============================================================================
// ApplyEngine
// ============================================================================

/**
 * Apply Engine
 *
 * Orchestrates the apply operation:
 * 1. Acquire state lock
 * 2. Apply changes via StateWriter
 * 3. Update state with new resource IDs
 * 4. Release state lock
 *
 * @example
 * ```typescript
 * const engine = new ApplyEngine(backend, client);
 *
 * const result = await engine.apply(
 *   diff,
 *   guildId,
 *   'staging',
 *   { dryRun: false }
 * );
 *
 * if (result.success) {
 *   console.log(`Applied changes, new serial: ${result.newSerial}`);
 * }
 * ```
 */
export class ApplyEngine {
  private readonly backend: StateBackend;
  private readonly writer: StateWriter;
  private readonly stateLock: StateLock;

  constructor(backend: StateBackend, client: DiscordClient, writer?: StateWriter) {
    this.backend = backend;
    this.writer = writer ?? new StateWriter(client);
    this.stateLock = new StateLock(backend);
  }

  /**
   * Apply changes from a diff to Discord
   *
   * @param diff - Server diff to apply
   * @param guildId - Discord guild ID
   * @param workspace - Workspace name
   * @param options - Apply options
   */
  async apply(
    diff: ServerDiff,
    guildId: Snowflake,
    workspace: string,
    options: ApplyEngineOptions = {}
  ): Promise<ApplyEngineResult> {
    const {
      dryRun = false,
      skipLock = false,
      lockInfo,
      ...applyOptions
    } = options;

    // If dry run, just run the writer without locking
    if (dryRun) {
      const applyResult = await this.writer.apply(diff, guildId, { ...applyOptions, dryRun: true });
      return {
        success: applyResult.success,
        applyResult,
        stateUpdated: false,
      };
    }

    // Define the apply operation
    const applyOperation = async (): Promise<ApplyEngineResult> => {
      // Apply changes to Discord
      const applyResult = await this.writer.apply(diff, guildId, applyOptions);

      // If apply failed completely, don't update state
      if (applyResult.summary.succeeded === 0 && applyResult.summary.failed > 0) {
        return {
          success: false,
          applyResult,
          error: 'All changes failed to apply',
          stateUpdated: false,
        };
      }

      // Update state with results
      const newSerial = await this.updateState(workspace, guildId, diff, applyResult);

      return {
        success: applyResult.success,
        applyResult,
        stateUpdated: true,
        newSerial,
      };
    };

    // Execute with or without locking
    if (skipLock) {
      return applyOperation();
    }

    // Execute with lock
    const lockOptions: AcquireLockOptions = {
      operation: 'apply',
      info: lockInfo ?? `Applying ${diff.summary.total} changes`,
    };

    const lockedResult = await this.stateLock.withLock(workspace, lockOptions, applyOperation);

    if (!lockedResult.success) {
      return {
        success: false,
        error: lockedResult.error ?? 'Failed to acquire lock',
        stateUpdated: false,
      };
    }

    return lockedResult.result!;
  }

  /**
   * Update state after successful apply
   */
  private async updateState(
    workspace: string,
    _guildId: Snowflake,
    diff: ServerDiff,
    applyResult: ApplyBatchResult
  ): Promise<number> {
    // Get current state or create empty
    let state = await this.backend.getState(workspace);
    if (!state) {
      state = createEmptyState({ workspace });
    }

    // Update state with new resource information
    state = this.applyDiffToState(state, diff, applyResult);

    // Update metadata
    state.serial += 1;
    state.lastModified = new Date().toISOString();

    // Persist state
    await this.backend.setState(workspace, state);

    return state.serial;
  }

  /**
   * Apply diff changes to state
   */
  private applyDiffToState(
    state: GaibState,
    diff: ServerDiff,
    applyResult: ApplyBatchResult
  ): GaibState {
    // Build a map of successful operations for ID lookup
    const successfulOps = new Map<string, string>();
    for (const result of applyResult.results) {
      if (result.success && result.newId) {
        const key = `${result.resourceType}:${result.resourceName}`;
        successfulOps.set(key, result.newId);
      }
    }

    // Process role changes
    for (const change of diff.roles) {
      if (change.operation === 'create' && change.desired) {
        const newId = successfulOps.get(`role:${change.name}`);
        if (newId) {
          // Add new role to state
          state.resources = state.resources.filter(
            (r) => !(r.type === 'discord_role' && r.name === change.name)
          );
          state.resources.push({
            type: 'discord_role',
            name: change.name,
            provider: 'discord',
            instances: [{
              schema_version: 1,
              attributes: {
                id: newId,
                name: change.desired.name,
                color: change.desired.color,
                hoist: change.desired.hoist,
                mentionable: change.desired.mentionable,
                permissions: change.desired.permissions,
              },
            }],
          });
        }
      } else if (change.operation === 'update' && change.current && change.desired) {
        // Update existing role in state
        const resource = state.resources.find(
          (r) => r.type === 'discord_role' && r.name === change.name
        );
        if (resource && resource.instances[0]) {
          resource.instances[0].attributes = {
            ...resource.instances[0].attributes,
            name: change.desired.name,
            color: change.desired.color,
            hoist: change.desired.hoist,
            mentionable: change.desired.mentionable,
            permissions: change.desired.permissions,
          };
        }
      } else if (change.operation === 'delete') {
        // Remove role from state
        state.resources = state.resources.filter(
          (r) => !(r.type === 'discord_role' && r.name === change.name)
        );
      }
    }

    // Process category changes
    for (const change of diff.categories) {
      if (change.operation === 'create' && change.desired) {
        const newId = successfulOps.get(`category:${change.name}`);
        if (newId) {
          state.resources = state.resources.filter(
            (r) => !(r.type === 'discord_category' && r.name === change.name)
          );
          state.resources.push({
            type: 'discord_category',
            name: change.name,
            provider: 'discord',
            instances: [{
              schema_version: 1,
              attributes: {
                id: newId,
                name: change.desired.name,
                position: change.desired.position,
              },
            }],
          });
        }
      } else if (change.operation === 'update' && change.desired) {
        const resource = state.resources.find(
          (r) => r.type === 'discord_category' && r.name === change.name
        );
        if (resource && resource.instances[0]) {
          resource.instances[0].attributes = {
            ...resource.instances[0].attributes,
            name: change.desired.name,
            position: change.desired.position,
          };
        }
      } else if (change.operation === 'delete') {
        state.resources = state.resources.filter(
          (r) => !(r.type === 'discord_category' && r.name === change.name)
        );
      }
    }

    // Process channel changes
    for (const change of diff.channels) {
      if (change.operation === 'create' && change.desired) {
        const newId = successfulOps.get(`channel:${change.name}`);
        if (newId) {
          state.resources = state.resources.filter(
            (r) => !(r.type === 'discord_channel' && r.name === change.name)
          );
          state.resources.push({
            type: 'discord_channel',
            name: change.name,
            provider: 'discord',
            instances: [{
              schema_version: 1,
              attributes: {
                id: newId,
                name: change.desired.name,
                type: change.desired.type,
                parent_name: change.desired.parentName,
                topic: change.desired.topic,
                nsfw: change.desired.nsfw,
                slowmode: change.desired.slowmode,
                position: change.desired.position,
                bitrate: change.desired.bitrate,
                user_limit: change.desired.userLimit,
              },
            }],
          });
        }
      } else if (change.operation === 'update' && change.desired) {
        const resource = state.resources.find(
          (r) => r.type === 'discord_channel' && r.name === change.name
        );
        if (resource && resource.instances[0]) {
          resource.instances[0].attributes = {
            ...resource.instances[0].attributes,
            name: change.desired.name,
            type: change.desired.type,
            parent_name: change.desired.parentName,
            topic: change.desired.topic,
            nsfw: change.desired.nsfw,
            slowmode: change.desired.slowmode,
            position: change.desired.position,
            bitrate: change.desired.bitrate,
            user_limit: change.desired.userLimit,
          };
        }
      } else if (change.operation === 'delete') {
        state.resources = state.resources.filter(
          (r) => !(r.type === 'discord_channel' && r.name === change.name)
        );
      }
    }

    return state;
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
 * Create an ApplyEngine from a backend and Discord client
 */
export function createApplyEngine(
  backend: StateBackend,
  client: DiscordClient
): ApplyEngine {
  return new ApplyEngine(backend, client);
}

/**
 * Create an ApplyEngine from environment variables
 *
 * Accepts either DISCORD_BOT_TOKEN or DISCORD_TOKEN for flexibility
 */
export function createApplyEngineFromEnv(backend: StateBackend): ApplyEngine {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error(
      'Discord bot token not found.\n' +
        'Set DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable.'
    );
  }
  const client = new DiscordClient({ token });
  return new ApplyEngine(backend, client);
}
