/**
 * Server Destroy Command
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Destroys all managed resources in a workspace.
 * Similar to `terraform destroy`.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/destroy
 */

import chalk from 'chalk';
import * as readline from 'readline';
import {
  getGuildId,
  getDiscordToken,
  formatWarning,
  formatSuccess,
  formatInfo,
  handleError,
  ExitCodes,
} from './utils.js';
import { createClientFromEnv } from './iac/index.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';
import { DestroyEngine } from './iac/DestroyEngine.js';
import { BackendFactory } from './iac/backends/BackendFactory.js';
import type { ApplyResult } from './iac/types.js';

/**
 * Options for the destroy command
 */
export interface DestroyOptions {
  guild?: string;
  workspace?: string;
  json?: boolean;
  quiet?: boolean;
  autoApprove?: boolean;
  dryRun?: boolean;
  targetTypes?: string[];
}

/**
 * Prompts user for two-stage confirmation for destroy operations
 *
 * Stage 1: Type the workspace name exactly
 * Stage 2: Answer "Are you ABSOLUTELY sure?" with "yes"
 *
 * @param workspace - The workspace name that must be typed to confirm
 * @param resourceCount - Number of resources that will be destroyed
 * @returns Promise resolving to true only if both confirmations pass
 */
async function confirmDestroy(workspace: string, resourceCount: number): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Stage 1: Type workspace name
  const workspaceConfirmed = await new Promise<boolean>((resolve) => {
    console.log(
      chalk.red.bold('\n⚠️  WARNING: This will permanently delete all managed resources!\n')
    );
    console.log(chalk.yellow(`  Workspace: ${workspace}`));
    console.log(chalk.yellow(`  Resources to destroy: ${resourceCount}\n`));

    rl.question(
      chalk.red(`To confirm, type the workspace name "${workspace}": `),
      (answer) => {
        resolve(answer === workspace);
      }
    );
  });

  if (!workspaceConfirmed) {
    rl.close();
    return false;
  }

  // Stage 2: Are you ABSOLUTELY sure?
  const absolutelySure = await new Promise<boolean>((resolve) => {
    console.log(
      chalk.red.bold('\n🚨 This action is IRREVERSIBLE. All resources will be permanently deleted.\n')
    );
    rl.question(
      chalk.red.bold('Are you ABSOLUTELY sure? ') + chalk.dim('Only "yes" will be accepted: '),
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      }
    );
  });

  return absolutelySure;
}

/**
 * Creates a progress callback for destroy operations
 */
function createDestroyProgressCallback(
  quiet: boolean,
  json: boolean
): (result: ApplyResult) => void {
  if (quiet || json) {
    return () => {};
  }

  return (result: ApplyResult) => {
    const symbol = result.success ? chalk.green('✓') : chalk.red('✗');
    const type = result.resourceType.padEnd(10);
    const name = result.resourceName;

    let line = `  ${symbol} destroy   ${type} ${name}`;

    if (!result.success && result.error) {
      line += chalk.red(` (${result.error})`);
    }

    console.log(line);
  };
}

/**
 * Executes the destroy command
 *
 * Destroys all managed resources in the current workspace.
 *
 * @param options - Command options
 */
export async function destroyCommand(options: DestroyOptions): Promise<void> {
  // Validate environment
  getDiscordToken();

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

    // Parse target types if provided
    const targetTypes = options.targetTypes?.map((t) => {
      const type = t.toLowerCase();
      if (!['role', 'category', 'channel'].includes(type)) {
        throw Object.assign(
          new Error(`Invalid target type: ${t}. Must be one of: role, category, channel`),
          { code: 'INVALID_TARGET_TYPE' }
        );
      }
      return type as 'role' | 'category' | 'channel';
    });

    // Create destroy engine
    const client = createClientFromEnv();
    const destroyEngine = new DestroyEngine(backend, client);

    // Get preview of what will be destroyed
    const preview = await destroyEngine.preview(workspace, targetTypes);

    if (preview.resources.length === 0) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              workspace,
              guildId,
              hasResources: false,
              message: 'No managed resources to destroy.',
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        console.log(chalk.green('\n✓ No managed resources to destroy.\n'));
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Show what will be destroyed
    if (!options.json && !options.quiet) {
      formatInfo(`Workspace: ${workspace}`);
      formatInfo(`Guild: ${guildId}`);
      console.log(chalk.bold('\n🗑️  Resources to destroy:\n'));

      for (const resource of preview.resources) {
        console.log(`  ${chalk.red('-')} ${resource.type.padEnd(10)} ${resource.name}`);
      }

      console.log(
        chalk.dim(`\n  Total: ${preview.resources.length} resource(s) will be destroyed\n`)
      );
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
              dryRun: true,
              resourceCount: preview.resources.length,
              resources: preview.resources.map((r) => ({
                type: r.type,
                name: r.name,
                id: r.id,
              })),
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        formatInfo('Dry run complete. No resources were destroyed.');
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Confirm unless auto-approve
    if (!options.autoApprove && !options.json) {
      const confirmed = await confirmDestroy(workspace, preview.resources.length);
      if (!confirmed) {
        console.log(chalk.yellow('\nDestroy cancelled.\n'));
        process.exit(ExitCodes.SUCCESS);
      }
    }

    // Execute destroy
    if (!options.quiet && !options.json) {
      console.log(chalk.bold('\n🔥 Destroying resources...\n'));
    }

    const destroyResult = await destroyEngine.destroy(guildId, workspace, {
      targetTypes,
      onProgress: createDestroyProgressCallback(options.quiet ?? false, options.json ?? false),
      continueOnError: true,
    });

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: destroyResult.success,
            workspace,
            guildId,
            stateUpdated: destroyResult.stateUpdated,
            newSerial: destroyResult.newSerial,
            resourcesDestroyed: destroyResult.resourcesDestroyed,
            summary: destroyResult.applyResult?.summary,
            results: destroyResult.applyResult?.results,
            totalDurationMs: destroyResult.applyResult?.totalDurationMs,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');

      if (destroyResult.success) {
        formatSuccess('Destroy complete!', {
          resourcesDestroyed: destroyResult.resourcesDestroyed,
          duration: `${destroyResult.applyResult?.totalDurationMs}ms`,
          newSerial: destroyResult.newSerial,
        });
      } else {
        formatWarning('Destroy completed with errors.');
        console.log(
          chalk.dim(
            `  Succeeded: ${destroyResult.applyResult?.summary.succeeded}\n` +
              `  Failed: ${destroyResult.applyResult?.summary.failed}\n` +
              `  Duration: ${destroyResult.applyResult?.totalDurationMs}ms`
          )
        );

        // Show failed operations
        const failures = destroyResult.applyResult?.results.filter((r) => !r.success) ?? [];
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

    process.exit(destroyResult.success ? ExitCodes.SUCCESS : ExitCodes.PARTIAL_FAILURE);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}
