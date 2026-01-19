/**
 * Server Import Command
 *
 * Sprint 99: Import & State Commands
 *
 * Import existing Discord resources into state management.
 * Syntax: gaib server import <address> <id>
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/import
 */

import chalk from 'chalk';
import {
  getGuildId,
  getDiscordToken,
  formatInfo,
  formatSuccess,
  handleError,
  ExitCodes,
} from './utils.js';
import {
  createClientFromEnv,
  type ResourceType,
  type FetchedResource,
} from './iac/index.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';
import { BackendFactory } from './iac/backends/BackendFactory.js';
import { createStateLock } from './iac/StateLock.js';
import { createEmptyState, type StateResource } from './iac/backends/types.js';

/**
 * Options for the import command
 */
export interface ImportOptions {
  guild?: string;
  workspace?: string;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Resource address format: discord_<type>.<name>
 * Examples: discord_role.admin, discord_channel.general, discord_category.info
 */
interface ParsedAddress {
  type: ResourceType;
  stateType: string;
  name: string;
}

/**
 * Parse resource address string
 *
 * @param address - Resource address (e.g., discord_role.admin)
 * @returns Parsed address components
 * @throws Error if address format is invalid
 */
function parseAddress(address: string): ParsedAddress {
  const match = address.match(/^discord_(role|channel|category)\.(.+)$/);
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
    type: type as ResourceType,
    stateType: `discord_${type}`,
    name,
  };
}

/**
 * Convert fetched resource to state resource format
 */
function toStateResource(fetched: FetchedResource, name: string): StateResource {
  return {
    type: `discord_${fetched.type}`,
    name,
    provider: 'discord',
    instances: [
      {
        schema_version: 1,
        attributes: fetched.attributes,
      },
    ],
  };
}

/**
 * Executes the import command
 *
 * Import an existing Discord resource into state management.
 *
 * @param address - Resource address (e.g., discord_role.admin)
 * @param resourceId - Discord resource ID (snowflake)
 * @param options - Command options
 */
export async function importCommand(
  address: string,
  resourceId: string,
  options: ImportOptions
): Promise<void> {
  // Validate environment
  getDiscordToken();

  // Parse address
  let parsedAddress: ParsedAddress;
  try {
    parsedAddress = parseAddress(address);
  } catch (error) {
    handleError(error, options.json);
    return;
  }

  // Initialize backend
  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? await manager.current();
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
      formatInfo(`Importing ${address} from guild ${guildId}...`);
    }

    // Create state lock
    const stateLock = createStateLock(backend);

    // Acquire lock
    const lockResult = await stateLock.withLock(
      workspace,
      { operation: 'import', info: `Importing ${address}` },
      async () => {
        // Get current state
        let state = await backend.getState(workspace);
        if (!state) {
          state = createEmptyState({ workspace });
        }

        // Check if resource already exists in state
        const existingResource = state.resources.find(
          (r) => r.type === parsedAddress.stateType && r.name === parsedAddress.name
        );
        if (existingResource) {
          throw Object.assign(
            new Error(
              `Resource ${address} already exists in state.\n` +
                'Use "gaib server state rm" to remove it first, or choose a different name.'
            ),
            { code: 'RESOURCE_EXISTS' }
          );
        }

        // Fetch resource from Discord
        const client = createClientFromEnv();
        const fetched = await client.fetchResource(guildId, parsedAddress.type, resourceId);

        // Add to state
        const stateResource = toStateResource(fetched, parsedAddress.name);
        state.resources.push(stateResource);
        state.serial += 1;
        state.lastModified = new Date().toISOString();

        // Save state
        await backend.setState(workspace, state);

        return { fetched, state };
      }
    );

    if (!lockResult.success) {
      throw Object.assign(
        new Error(`Failed to acquire lock: ${lockResult.error}`),
        { code: 'LOCK_ERROR' }
      );
    }

    const { fetched, state } = lockResult.result!;

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            workspace,
            guildId,
            address,
            resourceId,
            resourceType: fetched.type,
            resourceName: fetched.name,
            newSerial: state.serial,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');
      formatSuccess(`Imported ${address}`, {
        type: fetched.type,
        id: resourceId,
        name: fetched.name,
        newSerial: state.serial,
      });
      console.log(
        chalk.dim(
          '\nResource is now managed by Gaib. Future applies will track this resource.'
        )
      );
      console.log('');
    }

    process.exit(ExitCodes.SUCCESS);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}
