/**
 * Register Guild Command - gaib sandbox register-guild
 *
 * Sprint 86: Discord Server Sandboxes - Event Routing
 * Sprint 90: CLI Rename (bd → gaib)
 *
 * Registers a Discord guild to route events to a sandbox.
 *
 * @module packages/cli/commands/sandbox/register
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getSandboxManager,
  getCurrentUser,
  handleError,
  isInteractive,
  showNextStep,
} from './utils.js';

/**
 * Options for register command
 */
interface RegisterOptions {
  json?: boolean;
  quiet?: boolean;
}

/**
 * Register a guild to a sandbox
 */
export async function registerCommand(
  sandboxName: string,
  guildId: string,
  options: RegisterOptions
): Promise<void> {
  // Only show spinner in interactive TTY mode, not in quiet mode (Sprint 88: clig.dev compliance)
  const spinner = isInteractive() && !options.json && !options.quiet
    ? ora('Registering guild...').start()
    : null;

  try {
    const manager = getSandboxManager();
    const user = getCurrentUser();

    // Get sandbox first to validate it exists
    const sandbox = await manager.getByName(sandboxName);
    if (!sandbox) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Sandbox '${sandboxName}' not found`,
                code: 'NOT_FOUND',
              },
            },
            null,
            2
          )
        );
      } else {
        spinner?.fail(chalk.red(`Sandbox '${sandboxName}' not found`));
        console.error(chalk.yellow('\nUse "gaib sandbox list" to see available sandboxes'));
      }
      process.exit(1);
    }

    if (sandbox.status !== 'running') {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Sandbox '${sandboxName}' is not running (status: ${sandbox.status})`,
                code: 'NOT_RUNNING',
              },
            },
            null,
            2
          )
        );
      } else {
        spinner?.fail(
          chalk.red(`Sandbox '${sandboxName}' is not running (status: ${sandbox.status})`)
        );
      }
      process.exit(1);
    }

    // Validate guild ID format
    if (!/^\d{17,20}$/.test(guildId)) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Invalid guild ID format: ${guildId}`,
                code: 'INVALID_GUILD_ID',
              },
            },
            null,
            2
          )
        );
      } else {
        spinner?.fail(chalk.red(`Invalid guild ID format: ${guildId}`));
        console.error(chalk.yellow('\nGuild IDs are 17-20 digit numbers'));
      }
      process.exit(1);
    }

    // Register the guild
    await manager.registerGuild(sandbox.id, guildId, user);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            data: {
              sandboxId: sandbox.id,
              sandboxName: sandbox.name,
              guildId,
              registeredBy: user,
            },
          },
          null,
          2
        )
      );
    } else if (options.quiet) {
      // Sprint 88: Quiet mode - minimal output
      console.log(`registered: ${guildId} -> ${sandboxName}`);
    } else {
      spinner?.succeed(chalk.green(`Guild ${guildId} registered to sandbox '${sandboxName}'`));
      console.log('');
      console.log(`  Sandbox: ${chalk.cyan(sandbox.name)}`);
      console.log(`  Guild:   ${chalk.cyan(guildId)}`);
      console.log('');
      console.log('  Events from this guild will now be routed to this sandbox.');

      // Sprint 148: Next-step suggestion
      showNextStep(
        `gaib sandbox env ${sandboxName}`,
        'Get connection environment variables',
        options
      );
    }
  } catch (error) {
    spinner?.stop();
    handleError(error, options.json ?? false);
  }
}

/**
 * Create the register command
 */
export function createRegisterCommand(): Command {
  return new Command('register-guild')
    .alias('reg')
    .description('Register a Discord guild to route events to a sandbox')
    .argument('<sandbox>', 'Sandbox name or ID')
    .argument('<guildId>', 'Discord guild ID (17-20 digit number)')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  gaib sandbox register-guild my-sandbox 123456789012345678
  gaib sandbox reg test-sandbox 987654321098765432 --json

Notes:
  - The guild ID is the Discord server ID (right-click server → Copy Server ID)
  - A guild can only be registered to one sandbox at a time
  - Use "gaib sandbox unregister-guild" to remove a guild mapping
`
    )
    .action(registerCommand);
}
