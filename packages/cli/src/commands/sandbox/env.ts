/**
 * Connect Command - gaib sandbox connect
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 90: CLI Rename (bd → gaib)
 *
 * Outputs environment variables for connecting workers to a sandbox.
 *
 * @see SDD §6.4 Connect Command
 * @module packages/cli/commands/sandbox/connect
 */

import chalk from 'chalk';
import {
  getSandboxManager,
  handleError,
  createSilentLogger,
} from './utils.js';

/**
 * Options for connect command
 */
export interface ConnectCommandOptions {
  json?: boolean;
  quiet?: boolean;
}

/**
 * Executes the connect command
 *
 * Outputs environment variables in shell export format by default,
 * suitable for use with eval:
 *
 *   eval $(gaib sandbox connect my-sandbox)
 *
 * @param name - Sandbox name to connect to
 * @param options - Command options
 */
export async function connectCommand(
  name: string,
  options: ConnectCommandOptions
): Promise<void> {
  try {
    const logger = createSilentLogger();
    const manager = getSandboxManager(logger);

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
        // Output to stderr so eval doesn't capture it
        console.error(chalk.red(`Error: Sandbox '${name}' not found.`));
      }
      process.exit(1);
    }

    // Check if sandbox is running
    if (sandbox.status !== 'running') {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: {
                message: `Sandbox '${name}' is not running (status: ${sandbox.status})`,
                code: 'NOT_RUNNING',
              },
            },
            null,
            2
          )
        );
      } else {
        console.error(
          chalk.red(`Error: Sandbox '${name}' is not running (status: ${sandbox.status}).`)
        );
      }
      process.exit(1);
    }

    // Get connection details
    const details = await manager.getConnectionDetails(sandbox.id);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            sandbox: {
              id: sandbox.id,
              name: sandbox.name,
            },
            connection: {
              schemaName: details.schemaName,
              redisPrefix: details.redisPrefix,
              natsPrefix: details.natsPrefix,
              guildIds: details.guildIds,
            },
            env: details.env,
          },
          null,
          2
        )
      );
    } else {
      // Output shell export statements
      // These should be the ONLY output to stdout for eval to work correctly
      for (const [key, value] of Object.entries(details.env)) {
        console.log(`export ${key}="${value}"`);
      }

      // Sprint 88: Quiet mode - suppress stderr comments
      if (!options.quiet) {
        // Helpful comment (stderr so eval doesn't capture)
        console.error(chalk.dim(`# Connected to sandbox: ${sandbox.name}`));
        console.error(chalk.dim(`# Schema: ${details.schemaName}`));
        console.error(chalk.dim(`# Redis prefix: ${details.redisPrefix}`));
        console.error(chalk.dim(`# NATS prefix: ${details.natsPrefix}`));
      }
    }
  } catch (error) {
    handleError(error, options.json);
  }
}
