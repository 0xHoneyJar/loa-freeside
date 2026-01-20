/**
 * List Command - gaib sandbox list
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 90: CLI Rename (bd → gaib)
 *
 * Lists sandboxes with filtering options.
 *
 * @see SDD §6.2 List Command
 * @module packages/cli/commands/sandbox/list
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import type { SandboxStatus } from '@arrakis/sandbox';
import {
  getSandboxManager,
  getCurrentUser,
  formatDuration,
  timeUntil,
  handleError,
  createSilentLogger,
} from './utils.js';

/**
 * Options for list command
 */
export interface ListCommandOptions {
  owner?: string;
  status?: string;
  all?: boolean;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Maps status to display color
 */
function getStatusColor(status: SandboxStatus): string {
  switch (status) {
    case 'running':
      return chalk.green(status);
    case 'creating':
      return chalk.yellow(status);
    case 'pending':
      return chalk.blue(status);
    case 'expired':
      return chalk.red(status);
    case 'destroying':
      return chalk.magenta(status);
    case 'destroyed':
      return chalk.gray(status);
    default:
      return status;
  }
}

/**
 * Executes the list command
 *
 * @param options - Command options
 */
export async function listCommand(options: ListCommandOptions): Promise<void> {
  try {
    const owner = options.owner || getCurrentUser();
    const logger = createSilentLogger();
    const manager = getSandboxManager(logger);

    // Build filter
    const filter: { owner?: string; status?: SandboxStatus | SandboxStatus[]; includeDestroyed?: boolean } = {};

    // Filter by owner (unless showing all owners)
    if (!options.all || options.owner) {
      filter.owner = owner;
    }

    // Filter by status
    if (options.status) {
      filter.status = options.status as SandboxStatus;
    }

    // Include destroyed if --all
    filter.includeDestroyed = options.all;

    const sandboxes = await manager.list(filter);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            count: sandboxes.length,
            sandboxes: sandboxes.map((s) => ({
              id: s.id,
              name: s.name,
              owner: s.owner,
              status: s.status,
              schemaName: s.schemaName,
              createdAt: s.createdAt.toISOString(),
              expiresAt: s.expiresAt.toISOString(),
              guildIds: s.guildIds,
            })),
          },
          null,
          2
        )
      );
      return;
    }

    if (sandboxes.length === 0) {
      if (!options.quiet) {
        console.log(chalk.yellow('No sandboxes found.'));
        console.log(chalk.dim('Create one with: gaib sandbox create'));
      }
      return;
    }

    // Sprint 88: Quiet mode - just output names
    if (options.quiet) {
      for (const sandbox of sandboxes) {
        console.log(sandbox.name);
      }
      return;
    }

    // Create table
    const table = new Table({
      head: [
        chalk.bold('Name'),
        chalk.bold('Status'),
        chalk.bold('Owner'),
        chalk.bold('Expires'),
        chalk.bold('Guilds'),
      ],
      style: {
        head: [],
        border: [],
      },
    });

    for (const sandbox of sandboxes) {
      const expiresIn = timeUntil(sandbox.expiresAt);
      const expiresDisplay =
        sandbox.status === 'destroyed'
          ? chalk.gray('-')
          : expiresIn < 0
            ? chalk.red('expired')
            : formatDuration(expiresIn);

      table.push([
        chalk.cyan(sandbox.name),
        getStatusColor(sandbox.status),
        sandbox.owner,
        expiresDisplay,
        sandbox.guildIds.length > 0 ? sandbox.guildIds.length.toString() : '-',
      ]);
    }

    console.log(table.toString());
    console.log(chalk.dim(`\nTotal: ${sandboxes.length} sandbox(es)`));
  } catch (error) {
    handleError(error, options.json);
  }
}
