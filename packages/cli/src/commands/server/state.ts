/**
 * Server State Commands
 *
 * Sprint 99: Import & State Commands
 *
 * Manage state resources directly.
 * Syntax:
 *   gaib server state list
 *   gaib server state show <address>
 *   gaib server state rm <address>
 *   gaib server state mv <source> <destination>
 *   gaib server state pull
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/state
 */

import chalk from 'chalk';
import * as readline from 'readline';
import {
  getGuildId,
  getDiscordToken,
  formatInfo,
  formatSuccess,
  formatWarning,
  handleError,
  ExitCodes,
} from './utils.js';
import {
  createClientFromEnv,
  readServerState,
} from './iac/index.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';
import { BackendFactory } from './iac/backends/BackendFactory.js';
import { createStateLock, type LockOperation } from './iac/StateLock.js';
import type { GaibState, StateResource } from './iac/backends/types.js';

/**
 * Common options for state commands
 */
export interface StateOptions {
  workspace?: string;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Options for state rm command
 */
export interface StateRmOptions extends StateOptions {
  yes?: boolean;
}

/**
 * Options for state pull command
 */
export interface StatePullOptions extends StateOptions {
  guild?: string;
}

/**
 * Resource address format: discord_<type>.<name>
 */
interface ParsedAddress {
  type: string;
  name: string;
  fullAddress: string;
}

/**
 * Parse resource address string
 *
 * @param address - Resource address (e.g., discord_role.admin)
 * @returns Parsed address components
 * @throws Error if address format is invalid
 */
function parseAddress(address: string): ParsedAddress {
  const match = address.match(/^(discord_(?:role|channel|category))\.(.+)$/);
  if (!match) {
    throw Object.assign(
      new Error(
        `Invalid address format: ${address}\n` +
          'Expected format: discord_<type>.<name>\n' +
          'Examples:\n' +
          '  discord_role.admin\n' +
          '  discord_channel.general\n' +
          '  discord_category.info'
      ),
      { code: 'INVALID_ADDRESS' }
    );
  }

  const [, type, name] = match;
  return {
    type,
    name,
    fullAddress: address,
  };
}

/**
 * Find resource in state by address
 */
function findResource(state: GaibState, address: ParsedAddress): StateResource | undefined {
  return state.resources.find((r) => r.type === address.type && r.name === address.name);
}

/**
 * Format resource for display
 */
function formatResource(resource: StateResource): string {
  const id = resource.instances[0]?.attributes?.id ?? 'unknown';
  const name = resource.instances[0]?.attributes?.name ?? resource.name;
  return `${resource.type}.${resource.name} (id: ${id}, name: ${name})`;
}

/**
 * Executes the state list command
 *
 * Lists all resources in the current workspace state.
 *
 * @param options - Command options
 */
export async function stateListCommand(options: StateOptions): Promise<void> {
  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? (await manager.current());
    await manager.getBackend().close();

    // Get state
    const state = await backend.getState(workspace);

    if (!state || state.resources.length === 0) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              workspace,
              resources: [],
              count: 0,
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        formatInfo(`Workspace: ${workspace}`);
        console.log(chalk.yellow('\nNo resources in state.\n'));
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Group resources by type
    const byType: Record<string, StateResource[]> = {};
    for (const resource of state.resources) {
      if (!byType[resource.type]) {
        byType[resource.type] = [];
      }
      byType[resource.type].push(resource);
    }

    if (options.json) {
      const resources = state.resources.map((r) => ({
        address: `${r.type}.${r.name}`,
        type: r.type,
        name: r.name,
        id: r.instances[0]?.attributes?.id ?? null,
        resourceName: r.instances[0]?.attributes?.name ?? null,
      }));

      console.log(
        JSON.stringify(
          {
            success: true,
            workspace,
            serial: state.serial,
            resources,
            count: resources.length,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      formatInfo(`Workspace: ${workspace}`);
      formatInfo(`State serial: ${state.serial}`);
      console.log('');

      for (const [type, resources] of Object.entries(byType)) {
        console.log(chalk.bold(`${type}:`));
        for (const resource of resources) {
          const id = resource.instances[0]?.attributes?.id ?? 'unknown';
          const name = resource.instances[0]?.attributes?.name ?? resource.name;
          console.log(`  ${chalk.cyan(resource.name)} ${chalk.dim(`(id: ${id}, name: ${name})`)}`);
        }
        console.log('');
      }

      console.log(chalk.dim(`Total: ${state.resources.length} resource(s)`));
      console.log('');
    }

    process.exit(ExitCodes.SUCCESS);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}

/**
 * Executes the state show command
 *
 * Shows detailed information about a specific resource.
 *
 * @param address - Resource address (e.g., discord_role.admin)
 * @param options - Command options
 */
export async function stateShowCommand(address: string, options: StateOptions): Promise<void> {
  // Parse address
  let parsedAddress: ParsedAddress;
  try {
    parsedAddress = parseAddress(address);
  } catch (error) {
    handleError(error, options.json);
    return;
  }

  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? (await manager.current());
    await manager.getBackend().close();

    // Get state
    const state = await backend.getState(workspace);

    if (!state) {
      throw Object.assign(new Error(`No state found for workspace: ${workspace}`), {
        code: 'NO_STATE',
      });
    }

    // Find resource
    const resource = findResource(state, parsedAddress);

    if (!resource) {
      throw Object.assign(
        new Error(
          `Resource not found: ${address}\n` +
            'Use "gaib server state list" to see available resources.'
        ),
        { code: 'RESOURCE_NOT_FOUND' }
      );
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            workspace,
            address,
            resource: {
              type: resource.type,
              name: resource.name,
              provider: resource.provider,
              instances: resource.instances,
            },
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      formatInfo(`Workspace: ${workspace}`);
      console.log('');
      console.log(chalk.bold(`Resource: ${address}`));
      console.log(chalk.dim('─'.repeat(50)));
      console.log(`  Type:     ${resource.type}`);
      console.log(`  Name:     ${resource.name}`);
      console.log(`  Provider: ${resource.provider}`);

      if (resource.instances.length > 0) {
        const instance = resource.instances[0];
        console.log(`  Schema:   v${instance.schema_version}`);
        console.log('');
        console.log(chalk.bold('  Attributes:'));

        for (const [key, value] of Object.entries(instance.attributes)) {
          const displayValue =
            typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);

          if (typeof value === 'object') {
            console.log(`    ${chalk.cyan(key)}:`);
            const lines = displayValue.split('\n');
            for (const line of lines) {
              console.log(`      ${chalk.dim(line)}`);
            }
          } else {
            console.log(`    ${chalk.cyan(key)}: ${chalk.dim(displayValue)}`);
          }
        }
      }
      console.log('');
    }

    process.exit(ExitCodes.SUCCESS);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}

/**
 * Prompts user for confirmation
 */
async function confirmRemove(address: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`\nRemove ${address} from state? `) +
        chalk.dim('Only "yes" will be accepted.\n') +
        chalk.yellow('Enter a value: '),
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      }
    );
  });
}

/**
 * Executes the state rm command
 *
 * Removes a resource from state (does not delete from Discord).
 *
 * @param address - Resource address (e.g., discord_role.admin)
 * @param options - Command options
 */
export async function stateRmCommand(address: string, options: StateRmOptions): Promise<void> {
  // Parse address
  let parsedAddress: ParsedAddress;
  try {
    parsedAddress = parseAddress(address);
  } catch (error) {
    handleError(error, options.json);
    return;
  }

  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? (await manager.current());
    await manager.getBackend().close();

    if (!options.quiet && !options.json) {
      formatInfo(`Workspace: ${workspace}`);
    }

    // Create state lock
    const stateLock = createStateLock(backend);

    // Acquire lock and perform removal
    const lockResult = await stateLock.withLock(
      workspace,
      { operation: 'state' as LockOperation, info: `rm: Removing ${address}` },
      async () => {
        // Get state
        const state = await backend.getState(workspace);

        if (!state) {
          throw Object.assign(new Error(`No state found for workspace: ${workspace}`), {
            code: 'NO_STATE',
          });
        }

        // Find resource
        const resourceIndex = state.resources.findIndex(
          (r) => r.type === parsedAddress.type && r.name === parsedAddress.name
        );

        if (resourceIndex === -1) {
          throw Object.assign(
            new Error(
              `Resource not found: ${address}\n` +
                'Use "gaib server state list" to see available resources.'
            ),
            { code: 'RESOURCE_NOT_FOUND' }
          );
        }

        const resource = state.resources[resourceIndex];

        // Confirm unless --yes
        if (!options.yes && !options.json) {
          console.log('');
          console.log(chalk.bold('Resource to remove:'));
          console.log(`  ${formatResource(resource)}`);

          const confirmed = await confirmRemove(address);
          if (!confirmed) {
            console.log(chalk.yellow('\nRemoval cancelled.\n'));
            process.exit(ExitCodes.SUCCESS);
          }
        }

        // Remove from state
        state.resources.splice(resourceIndex, 1);
        state.serial += 1;
        state.lastModified = new Date().toISOString();

        // Save state
        await backend.setState(workspace, state);

        return { resource, state };
      }
    );

    if (!lockResult.success) {
      throw Object.assign(new Error(`Failed to acquire lock: ${lockResult.error}`), {
        code: 'LOCK_ERROR',
      });
    }

    const { resource, state } = lockResult.result!;

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            workspace,
            removed: address,
            resourceId: resource.instances[0]?.attributes?.id,
            newSerial: state.serial,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');
      formatSuccess(`Removed ${address} from state`, {
        id: resource.instances[0]?.attributes?.id,
        newSerial: state.serial,
      });
      console.log(
        chalk.dim('\nResource was removed from state but still exists in Discord.')
      );
      console.log(chalk.dim('Use "gaib server import" to re-import it if needed.\n'));
    }

    process.exit(ExitCodes.SUCCESS);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}

/**
 * Executes the state mv command
 *
 * Moves/renames a resource address in state.
 *
 * @param source - Source address (e.g., discord_role.old_name)
 * @param destination - Destination address (e.g., discord_role.new_name)
 * @param options - Command options
 */
export async function stateMvCommand(
  source: string,
  destination: string,
  options: StateOptions
): Promise<void> {
  // Parse addresses
  let sourceAddr: ParsedAddress;
  let destAddr: ParsedAddress;
  try {
    sourceAddr = parseAddress(source);
    destAddr = parseAddress(destination);
  } catch (error) {
    handleError(error, options.json);
    return;
  }

  // Validate types match
  if (sourceAddr.type !== destAddr.type) {
    handleError(
      Object.assign(
        new Error(
          `Cannot move between different resource types.\n` +
            `Source type: ${sourceAddr.type}\n` +
            `Destination type: ${destAddr.type}`
        ),
        { code: 'TYPE_MISMATCH' }
      ),
      options.json
    );
    return;
  }

  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? (await manager.current());
    await manager.getBackend().close();

    if (!options.quiet && !options.json) {
      formatInfo(`Workspace: ${workspace}`);
      formatInfo(`Moving ${source} -> ${destination}...`);
    }

    // Create state lock
    const stateLock = createStateLock(backend);

    // Acquire lock and perform move
    const lockResult = await stateLock.withLock(
      workspace,
      { operation: 'state' as LockOperation, info: `mv: Moving ${source} to ${destination}` },
      async () => {
        // Get state
        const state = await backend.getState(workspace);

        if (!state) {
          throw Object.assign(new Error(`No state found for workspace: ${workspace}`), {
            code: 'NO_STATE',
          });
        }

        // Find source resource
        const resource = findResource(state, sourceAddr);
        if (!resource) {
          throw Object.assign(
            new Error(
              `Source resource not found: ${source}\n` +
                'Use "gaib server state list" to see available resources.'
            ),
            { code: 'RESOURCE_NOT_FOUND' }
          );
        }

        // Check destination doesn't exist
        const existingDest = findResource(state, destAddr);
        if (existingDest) {
          throw Object.assign(
            new Error(
              `Destination already exists: ${destination}\n` +
                'Use "gaib server state rm" to remove it first, or choose a different name.'
            ),
            { code: 'RESOURCE_EXISTS' }
          );
        }

        // Update resource name
        resource.name = destAddr.name;
        state.serial += 1;
        state.lastModified = new Date().toISOString();

        // Save state
        await backend.setState(workspace, state);

        return { resource, state };
      }
    );

    if (!lockResult.success) {
      throw Object.assign(new Error(`Failed to acquire lock: ${lockResult.error}`), {
        code: 'LOCK_ERROR',
      });
    }

    const { resource, state } = lockResult.result!;

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            workspace,
            source,
            destination,
            resourceId: resource.instances[0]?.attributes?.id,
            newSerial: state.serial,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');
      formatSuccess(`Moved ${source} to ${destination}`, {
        id: resource.instances[0]?.attributes?.id,
        newSerial: state.serial,
      });
      console.log('');
    }

    process.exit(ExitCodes.SUCCESS);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}

/**
 * Executes the state pull command
 *
 * Refreshes state from Discord by re-reading current resource attributes.
 *
 * @param options - Command options
 */
export async function statePullCommand(options: StatePullOptions): Promise<void> {
  // Validate environment
  getDiscordToken();

  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? (await manager.current());
    await manager.getBackend().close();

    // Get guild ID
    const guildId = getGuildId(options);
    if (!guildId) {
      throw Object.assign(
        new Error(
          'Guild ID is required. Either:\n' +
            '  - Pass --guild <id> option\n' +
            '  - Set DISCORD_GUILD_ID environment variable'
        ),
        { code: 'MISSING_GUILD_ID' }
      );
    }

    if (!options.quiet && !options.json) {
      formatInfo(`Workspace: ${workspace}`);
      formatInfo(`Pulling state from guild ${guildId}...`);
    }

    // Create state lock
    const stateLock = createStateLock(backend);

    // Acquire lock and perform pull
    const lockResult = await stateLock.withLock(
      workspace,
      { operation: 'state' as LockOperation, info: `pull: Refreshing state from Discord` },
      async () => {
        // Get current state
        const state = await backend.getState(workspace);

        if (!state || state.resources.length === 0) {
          return { updated: 0, failed: 0, state };
        }

        // Create Discord client
        const client = createClientFromEnv();

        // Read current Discord state
        const discordState = await readServerState(client, guildId);

        // Build lookup maps
        const roleMap = new Map(discordState.roles.map((r) => [r.id, r]));
        const categoryMap = new Map(discordState.categories.map((c) => [c.id, c]));
        const channelMap = new Map(discordState.channels.map((c) => [c.id, c]));

        let updated = 0;
        let failed = 0;
        const failures: Array<{ address: string; error: string }> = [];

        // Update each resource
        for (const resource of state.resources) {
          const id = resource.instances[0]?.attributes?.id as string;
          if (!id) {
            failed++;
            failures.push({
              address: `${resource.type}.${resource.name}`,
              error: 'No ID in state',
            });
            continue;
          }

          let newAttributes: Record<string, unknown> | null = null;

          switch (resource.type) {
            case 'discord_role': {
              const role = roleMap.get(id);
              if (role) {
                newAttributes = {
                  id: role.id,
                  name: role.name,
                  color: role.color,
                  hoist: role.hoist,
                  position: role.position,
                  permissions: role.permissions,
                  mentionable: role.mentionable,
                };
              }
              break;
            }
            case 'discord_category': {
              const category = categoryMap.get(id);
              if (category) {
                newAttributes = {
                  id: category.id,
                  name: category.name,
                  position: category.position,
                  permission_overwrites: category.permissionOverwrites,
                };
              }
              break;
            }
            case 'discord_channel': {
              const channel = channelMap.get(id);
              if (channel) {
                newAttributes = {
                  id: channel.id,
                  name: channel.name,
                  type: channel.type,
                  position: channel.position,
                  topic: channel.topic,
                  nsfw: channel.nsfw,
                  slowmode: channel.slowmode,
                  bitrate: channel.bitrate,
                  user_limit: channel.userLimit,
                  parent_id: channel.parentId,
                  permission_overwrites: channel.permissionOverwrites,
                };
              }
              break;
            }
          }

          if (newAttributes) {
            resource.instances[0].attributes = newAttributes;
            updated++;
          } else {
            failed++;
            failures.push({
              address: `${resource.type}.${resource.name}`,
              error: 'Resource not found in Discord (may have been deleted)',
            });
          }
        }

        // Update state metadata
        if (updated > 0) {
          state.serial += 1;
          state.lastModified = new Date().toISOString();
          await backend.setState(workspace, state);
        }

        return { updated, failed, failures, state };
      }
    );

    if (!lockResult.success) {
      throw Object.assign(new Error(`Failed to acquire lock: ${lockResult.error}`), {
        code: 'LOCK_ERROR',
      });
    }

    const { updated, failed, failures, state } = lockResult.result!;

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: failed === 0,
            workspace,
            guildId,
            updated,
            failed,
            failures: failures ?? [],
            newSerial: state?.serial ?? 0,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');

      if (updated === 0 && failed === 0) {
        console.log(chalk.yellow('No resources in state to pull.\n'));
      } else if (failed === 0) {
        formatSuccess('State pulled successfully', {
          updated,
          newSerial: state?.serial,
        });
      } else {
        formatWarning('State pull completed with errors.');
        console.log(chalk.dim(`  Updated: ${updated}`));
        console.log(chalk.dim(`  Failed: ${failed}`));

        if (failures && failures.length > 0) {
          console.log(chalk.red('\nFailed resources:'));
          for (const f of failures) {
            console.log(chalk.red(`  - ${f.address}: ${f.error}`));
          }
        }
      }

      console.log('');
    }

    process.exit(failed === 0 ? ExitCodes.SUCCESS : ExitCodes.PARTIAL_FAILURE);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}
