/**
 * Server Plan Command
 *
 * Sprint 93: Discord Infrastructure-as-Code - CLI Commands & Polish
 * Sprint 97: Workspace Management - Added workspace context
 *
 * Shows what changes would be applied without making them.
 * Similar to `terraform plan`.
 *
 * @see SDD §6.0 CLI Commands
 * @see S-93.3 acceptance criteria
 * @module packages/cli/commands/server/plan
 */

import {
  readConfigFile,
  getGuildId,
  getDiscordToken,
  formatPlanOutput,
  formatInfo,
  ExitCodes,
  showNextStep,
} from './utils.js';
import {
  parseConfigWithTheme,
  createClientFromEnv,
  readServerState,
  calculateDiff,
  type DiffOptions,
} from './iac/index.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';

/**
 * Options for the plan command
 */
export interface PlanOptions {
  file: string;
  guild?: string;
  workspace?: string;
  json?: boolean;
  managedOnly?: boolean;
  quiet?: boolean;
}

/**
 * Executes the plan command
 *
 * Reads configuration, fetches current Discord state, calculates diff,
 * and displays what changes would be applied.
 *
 * @param options - Command options
 */
export async function planCommand(options: PlanOptions): Promise<void> {
  // Validate environment
  getDiscordToken();

  // Get current workspace context
  const manager = await createWorkspaceManager();
  const workspace = options.workspace ?? await manager.current();
  await manager.getBackend().close();

  // Read and parse configuration (with theme support)
  const configContent = readConfigFile(options.file);
  const parseResult = await parseConfigWithTheme(configContent);
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
    formatInfo(`Planning changes for guild ${guildId}...`);
  }

  // Fetch current Discord state
  const client = createClientFromEnv();
  const currentState = await readServerState(client, guildId);

  if (!options.quiet) {
    formatInfo(`Server: ${currentState.name}`);
  }

  // Calculate diff
  const diffOptions: DiffOptions = {
    managedOnly: options.managedOnly ?? true,
    includePermissions: true,
  };

  const diff = calculateDiff(config, currentState, guildId, diffOptions);

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
          roles: diff.roles.filter((r) => r.operation !== 'noop'),
          categories: diff.categories.filter((c) => c.operation !== 'noop'),
          channels: diff.channels.filter((c) => c.operation !== 'noop'),
          permissions: diff.permissions.filter((p) => p.operation !== 'noop'),
        },
        null,
        2
      )
    );
  } else {
    console.log(formatPlanOutput(diff));

    // Sprint 148: Next-step suggestion
    if (diff.hasChanges) {
      showNextStep(
        `gaib server apply -f ${options.file}`,
        'Apply the planned changes',
        options
      );
    }
  }

  // Exit with appropriate code
  process.exit(diff.hasChanges ? ExitCodes.SUCCESS : ExitCodes.SUCCESS);
}
