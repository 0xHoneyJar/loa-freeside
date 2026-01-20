/**
 * Destroy Command - gaib sandbox destroy
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 90: CLI Rename (bd → gaib)
 *
 * Destroys a sandbox and all associated resources.
 *
 * @see SDD §6.3 Destroy Command
 * @module packages/cli/commands/sandbox/destroy
 */

import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import {
  getSandboxManager,
  getCurrentUser,
  handleError,
  createSilentLogger,
  isInteractive,
  canPrompt,
} from './utils.js';

/**
 * Options for destroy command
 */
export interface DestroyCommandOptions {
  yes?: boolean;
  json?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
}

/**
 * Prompts for confirmation
 *
 * @param message - Confirmation message
 * @returns True if confirmed
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Executes the destroy command
 *
 * @param name - Sandbox name to destroy
 * @param options - Command options
 */
export async function destroyCommand(
  name: string,
  options: DestroyCommandOptions
): Promise<void> {
  // Only show spinner in interactive TTY mode, not in quiet mode (Sprint 88: clig.dev compliance)
  const spinner = isInteractive() && !options.json && !options.quiet ? ora() : null;

  try {
    const logger = createSilentLogger();
    const manager = getSandboxManager(logger);
    const actor = getCurrentUser();

    // Find sandbox by name
    const sandbox = await manager.getByName(name);

    if (!sandbox) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Sandbox '${name}' not found`,
                code: 'NOT_FOUND',
              },
            },
            null,
            2
          )
        );
      } else {
        console.error(chalk.red(`Error: Sandbox '${name}' not found.`));
      }
      process.exit(1);
    }

    // Check if already destroyed
    if (sandbox.status === 'destroyed') {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Sandbox '${name}' is already destroyed`,
                code: 'ALREADY_DESTROYED',
              },
            },
            null,
            2
          )
        );
      } else {
        console.log(chalk.yellow(`Sandbox '${name}' is already destroyed.`));
      }
      process.exit(0);
    }

    // Sprint 88: Dry-run mode - show what would be destroyed without doing it
    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({
          dryRun: true,
          wouldDestroy: {
            id: sandbox.id,
            name: sandbox.name,
            owner: sandbox.owner,
            schemaName: sandbox.schemaName,
            guildIds: sandbox.guildIds,
          },
        }, null, 2));
      } else {
        console.log(chalk.yellow('DRY RUN - No changes will be made'));
        console.log();
        console.log('Would destroy sandbox:');
        console.log(`  Name:   ${chalk.cyan(sandbox.name)}`);
        console.log(`  ID:     ${sandbox.id}`);
        console.log(`  Schema: ${sandbox.schemaName}`);
        console.log(`  Guilds: ${sandbox.guildIds.length}`);
      }
      process.exit(0);
    }

    // Confirm destruction
    if (!options.yes && !options.json) {
      // Sprint 88: Check for TTY before prompting (clig.dev compliance)
      if (!canPrompt()) {
        console.error(chalk.red('Error: Cannot prompt for confirmation in non-interactive mode.'));
        console.error(chalk.yellow('Use --yes to skip confirmation.'));
        process.exit(1);
      }

      console.log(chalk.bold('\nSandbox to destroy:'));
      console.log(`  Name:   ${chalk.cyan(sandbox.name)}`);
      console.log(`  Owner:  ${sandbox.owner}`);
      console.log(`  Schema: ${sandbox.schemaName}`);
      if (sandbox.guildIds.length > 0) {
        console.log(`  Guilds: ${sandbox.guildIds.join(', ')}`);
      }
      console.log();

      const confirmed = await confirm(
        chalk.red('Are you sure you want to destroy this sandbox?')
      );

      if (!confirmed) {
        console.log(chalk.yellow('Aborted.'));
        process.exit(0);
      }
    }

    spinner?.start('Destroying sandbox...');

    // Destroy sandbox
    await manager.destroy(sandbox.id, actor);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            message: `Sandbox '${name}' destroyed`,
            sandbox: {
              id: sandbox.id,
              name: sandbox.name,
              schemaName: sandbox.schemaName,
            },
          },
          null,
          2
        )
      );
    } else if (options.quiet) {
      // Sprint 88: Quiet mode - minimal output
      console.log(`destroyed: ${name}`);
    } else {
      spinner?.succeed(chalk.green(`Sandbox '${name}' destroyed successfully.`));
    }
  } catch (error) {
    spinner?.fail(chalk.red('Failed to destroy sandbox'));
    handleError(error, options.json);
  }
}
