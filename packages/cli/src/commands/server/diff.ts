/**
 * Server Diff Command
 *
 * Sprint 93: Discord Infrastructure-as-Code - CLI Commands & Polish
 * Sprint 97: Workspace Management - Added workspace context
 *
 * Shows detailed diff between configuration and current Discord state.
 *
 * @see SDD §6.0 CLI Commands
 * @see S-93.4 acceptance criteria
 * @module packages/cli/commands/server/diff
 */

import {
  readConfigFile,
  getGuildId,
  getDiscordToken,
  formatDiffOutput,
  formatInfo,
  ExitCodes,
  showNextStep,
} from './utils.js';
import {
  parseConfigString,
  createClientFromEnv,
  readServerState,
  calculateDiff,
} from './iac/index.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';

/**
 * Options for the diff command
 */
export interface DiffCommandOptions {
  file: string;
  guild?: string;
  workspace?: string;
  json?: boolean;
  permissions?: boolean;
  managedOnly?: boolean;
  quiet?: boolean;
}

/**
 * Executes the diff command
 *
 * Reads configuration, fetches current Discord state, and shows
 * a detailed diff of all changes.
 *
 * @param options - Command options
 */
export async function diffCommand(options: DiffCommandOptions): Promise<void> {
  // Validate environment
  getDiscordToken();

  // Get current workspace context
  const manager = await createWorkspaceManager();
  const workspace = options.workspace ?? await manager.current();
  await manager.getBackend().close();

  // Read and parse configuration
  const configContent = readConfigFile(options.file);
  const parseResult = parseConfigString(configContent);
  const config = parseResult.config;

  // Get guild ID from options or config
  const guildId = getGuildId(options) || config.server?.id;
  if (!guildId) {
    throw Object.assign(
      new Error(
        'Guild ID is required. Either:\n' +
          '  - Add "id" to the server section in your config file\n' +
          '  - Pass --guild <id> option\n' +
          '  - Set DISCORD_GUILD_ID environment variable'
      ),
      { code: 'MISSING_GUILD_ID' }
    );
  }

  if (!options.quiet) {
    formatInfo(`Workspace: ${workspace}`);
    formatInfo(`Calculating diff for guild ${guildId}...`);
  }

  // Fetch current Discord state
  const client = createClientFromEnv();
  const currentState = await readServerState(client, guildId);

  if (!options.quiet) {
    formatInfo(`Server: ${currentState.name}`);
  }

  // Calculate diff
  const diffOpts: import('./iac/index.js').DiffOptions = {
    managedOnly: options.managedOnly ?? true,
    includePermissions: options.permissions ?? true,
  };

  const diff = calculateDiff(config, currentState, guildId, diffOpts);

  // Output result
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          workspace,
          guildId,
          serverName: currentState.name,
          hasChanges: diff.hasChanges,
          summary: diff.summary,
          diff: {
            roles: diff.roles,
            categories: diff.categories,
            channels: diff.channels,
            permissions: diff.permissions,
          },
        },
        null,
        2
      )
    );
  } else {
    console.log(formatDiffOutput(diff));

    // Sprint 148: Next-step suggestion
    if (diff.hasChanges) {
      showNextStep(
        `gaib server apply -f ${options.file}`,
        'Apply the detected changes',
        options
      );
    }
  }

  // Exit with appropriate code
  process.exit(diff.hasChanges ? ExitCodes.SUCCESS : ExitCodes.SUCCESS);
}
