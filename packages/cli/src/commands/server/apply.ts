/**
 * Server Apply Command
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Applies configuration changes to Discord with proper state locking.
 * Similar to `terraform apply`.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/apply
 */

import chalk from 'chalk';
import * as readline from 'readline';
import {
  readConfigFile,
  getGuildId,
  getDiscordToken,
  formatDiffOutput,
  formatInfo,
  formatWarning,
  formatSuccess,
  handleError,
  ExitCodes,
} from './utils.js';
import {
  parseConfigWithTheme,
  createClientFromEnv,
  readServerState,
  calculateDiff,
  type DiffOptions,
} from './iac/index.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';
import { ApplyEngine } from './iac/ApplyEngine.js';
import { BackendFactory } from './iac/backends/BackendFactory.js';
import type { ApplyResult } from './iac/types.js';

/**
 * Options for the apply command
 */
export interface ApplyOptions {
  file: string;
  guild?: string;
  workspace?: string;
  json?: boolean;
  managedOnly?: boolean;
  quiet?: boolean;
  autoApprove?: boolean;
  dryRun?: boolean;
}

/**
 * Prompts user for confirmation
 */
async function confirmApply(changeCount: number): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`\nDo you want to apply these ${changeCount} change(s)? `) +
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
 * Creates a progress callback for apply operations
 */
function createApplyProgressCallback(quiet: boolean, json: boolean): (result: ApplyResult) => void {
  if (quiet || json) {
    return () => {};
  }

  return (result: ApplyResult) => {
    const symbol = result.success ? chalk.green('✓') : chalk.red('✗');
    const operation = result.operation.padEnd(6);
    const type = result.resourceType.padEnd(10);
    const name = result.resourceName;

    let line = `  ${symbol} ${operation} ${type} ${name}`;

    if (!result.success && result.error) {
      line += chalk.red(` (${result.error})`);
    }

    console.log(line);
  };
}

/**
 * Executes the apply command
 *
 * Reads configuration, calculates diff, prompts for confirmation,
 * and applies changes to Discord with state locking.
 *
 * @param options - Command options
 */
export async function applyCommand(options: ApplyOptions): Promise<void> {
  // Validate environment
  getDiscordToken();

  // Initialize backend
  const backend = await BackendFactory.auto(process.cwd());

  try {
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

    if (!options.quiet && !options.json) {
      formatInfo(`Workspace: ${workspace}`);
      formatInfo(`Planning changes for guild ${guildId}...`);
    }

    // Fetch current Discord state
    const client = createClientFromEnv();
    const currentState = await readServerState(client, guildId);

    if (!options.quiet && !options.json) {
      formatInfo(`Server: ${currentState.name}`);
    }

    // Calculate diff
    const diffOptions: DiffOptions = {
      managedOnly: options.managedOnly ?? true,
      includePermissions: true,
    };

    const diff = calculateDiff(config, currentState, guildId, diffOptions);

    // Check if there are changes to apply
    if (!diff.hasChanges) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              workspace,
              guildId,
              serverName: currentState.name,
              hasChanges: false,
              message: 'No changes to apply. Server is in sync with configuration.',
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        console.log(chalk.green('\n✓ No changes to apply. Server is in sync with configuration.\n'));
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Show diff
    if (!options.json && !options.quiet) {
      console.log(formatDiffOutput(diff));
    }

    // Dry run - just show what would happen
    if (options.dryRun) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              workspace,
              guildId,
              serverName: currentState.name,
              dryRun: true,
              hasChanges: diff.hasChanges,
              summary: diff.summary,
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        formatInfo('Dry run complete. No changes were applied.');
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Confirm unless auto-approve
    if (!options.autoApprove && !options.json) {
      const confirmed = await confirmApply(diff.summary.total);
      if (!confirmed) {
        console.log(chalk.yellow('\nApply cancelled.\n'));
        process.exit(ExitCodes.SUCCESS);
      }
    }

    // Create ApplyEngine and apply changes
    const applyEngine = new ApplyEngine(backend, client);

    if (!options.quiet && !options.json) {
      console.log(chalk.bold('\n📦 Applying changes...\n'));
    }

    const applyResult = await applyEngine.apply(diff, guildId, workspace, {
      onProgress: createApplyProgressCallback(options.quiet ?? false, options.json ?? false),
      continueOnError: true,
    });

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: applyResult.success,
            workspace,
            guildId,
            serverName: currentState.name,
            stateUpdated: applyResult.stateUpdated,
            newSerial: applyResult.newSerial,
            summary: applyResult.applyResult?.summary,
            results: applyResult.applyResult?.results,
            totalDurationMs: applyResult.applyResult?.totalDurationMs,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');

      if (applyResult.success) {
        formatSuccess('Apply complete!', {
          succeeded: applyResult.applyResult?.summary.succeeded,
          failed: applyResult.applyResult?.summary.failed,
          duration: `${applyResult.applyResult?.totalDurationMs}ms`,
          newSerial: applyResult.newSerial,
        });
      } else {
        formatWarning('Apply completed with errors.');
        console.log(
          chalk.dim(
            `  Succeeded: ${applyResult.applyResult?.summary.succeeded}\n` +
              `  Failed: ${applyResult.applyResult?.summary.failed}\n` +
              `  Duration: ${applyResult.applyResult?.totalDurationMs}ms`
          )
        );

        // Show failed operations
        const failures = applyResult.applyResult?.results.filter((r) => !r.success) ?? [];
        if (failures.length > 0) {
          console.log(chalk.red('\nFailed operations:'));
          for (const failure of failures) {
            console.log(
              chalk.red(`  - ${failure.resourceType}/${failure.resourceName}: ${failure.error}`)
            );
          }
        }
      }

      console.log('');
    }

    process.exit(applyResult.success ? ExitCodes.SUCCESS : ExitCodes.PARTIAL_FAILURE);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}
