/**
 * Unregister Guild Command - gaib sandbox unregister-guild
 *
 * Sprint 86: Discord Server Sandboxes - Event Routing
 * Sprint 90: CLI Rename (bd → gaib)
 *
 * Unregisters a Discord guild from a sandbox (stops event routing).
 *
 * @module packages/cli/commands/sandbox/unregister
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getSandboxManager,
  getCurrentUser,
  handleError,
  isInteractive,
} from './utils.js';

/**
 * Options for unregister command
 */
interface UnregisterOptions {
  json?: boolean;
  quiet?: boolean;
}

/**
 * Unregister a guild from a sandbox
 */
export async function unregisterCommand(
  sandboxName: string,
  guildId: string,
  options: UnregisterOptions
): Promise<void> {
  // Only show spinner in interactive TTY mode, not in quiet mode (Sprint 88: clig.dev compliance)
  const spinner = isInteractive() && !options.json && !options.quiet
    ? ora('Unregistering guild...').start()
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
      }
      process.exit(1);
    }

    // Check if guild is actually registered to this sandbox
    if (!sandbox.guildIds.includes(guildId)) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Guild ${guildId} is not registered to sandbox '${sandboxName}'`,
                code: 'NOT_REGISTERED',
              },
            },
            null,
            2
          )
        );
      } else {
        spinner?.fail(
          chalk.red(`Guild ${guildId} is not registered to sandbox '${sandboxName}'`)
        );
      }
      process.exit(1);
    }

    // Unregister the guild
    await manager.unregisterGuild(sandbox.id, guildId, user);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            data: {
              sandboxId: sandbox.id,
              sandboxName: sandbox.name,
              guildId,
              unregisteredBy: user,
            },
          },
          null,
          2
        )
      );
    } else if (options.quiet) {
      // Sprint 88: Quiet mode - minimal output
      console.log(`unregistered: ${guildId} <- ${sandboxName}`);
    } else {
      spinner?.succeed(
        chalk.green(`Guild ${guildId} unregistered from sandbox '${sandboxName}'`)
      );
      console.log('');
      console.log('  Events from this guild will now route to production.');
      console.log('');
    }
  } catch (error) {
    spinner?.stop();
    handleError(error, options.json ?? false);
  }
}

/**
 * Create the unregister command
 */
export function createUnregisterCommand(): Command {
  return new Command('unregister-guild')
    .alias('unreg')
    .description('Unregister a Discord guild from a sandbox')
    .argument('<sandbox>', 'Sandbox name or ID')
    .argument('<guildId>', 'Discord guild ID')
    .option('--json', 'Output as JSON')
    .addHelpText(
      'after',
      `
Examples:
  gaib sandbox unregister-guild my-sandbox 123456789012345678
  gaib sandbox unreg test-sandbox 987654321098765432

Notes:
  - After unregistering, events from this guild will route to production
  - The guild can be registered to a different sandbox after unregistering
`
    )
    .action(unregisterCommand);
}
