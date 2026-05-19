/**
 * Status Command - gaib sandbox status
 *
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 * Sprint 90: CLI Rename (bd → gaib)
 * Sprint 148: Type alignment with @freeside/sandbox SandboxHealthStatus
 *
 * Displays detailed status and health information for a sandbox.
 *
 * @see SDD §6.5 Status Command
 * @module packages/cli/commands/sandbox/status
 */

import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import type { SandboxHealthStatus, HealthLevel, Sandbox } from '@freeside/sandbox';
import {
  getSandboxManager,
  formatDate,
  handleError,
  createSilentLogger,
  isInteractive,
} from './utils.js';

/**
 * Options for status command
 */
export interface StatusCommandOptions {
  json?: boolean;
  watch?: boolean;
  interval?: number;
  quiet?: boolean;
}

/**
 * Maps health level to display color
 */
function getHealthColor(level: HealthLevel): (text: string) => string {
  switch (level) {
    case 'healthy':
      return chalk.green;
    case 'degraded':
      return chalk.yellow;
    case 'unhealthy':
      return chalk.red;
    default:
      return chalk.white;
  }
}

/**
 * Formats health check result for display
 */
function formatHealthCheckItem(name: string, status: string): string {
  const healthy = status === 'ok';
  const icon = healthy ? chalk.green('✓') : chalk.red('✗');
  return `${icon} ${name}: ${status}`;
}

/**
 * Displays status in terminal format
 *
 * @param health - Health status from the manager
 * @param sandbox - Full sandbox entity for additional details
 */
function displayTerminalStatus(health: SandboxHealthStatus, sandbox: Sandbox): void {
  const healthColor = getHealthColor(health.health);

  console.log();
  console.log(chalk.bold('Sandbox Status'));
  console.log(chalk.dim('─'.repeat(50)));

  // Basic info table
  const infoTable = new Table({
    style: { head: [], border: [] },
    colWidths: [20, 35],
  });

  infoTable.push(
    [chalk.bold('Name:'), chalk.cyan(sandbox.name)],
    [chalk.bold('ID:'), chalk.dim(sandbox.id)],
    [chalk.bold('Status:'), healthColor(health.status)],
    [chalk.bold('Owner:'), sandbox.owner],
    [chalk.bold('Schema:'), chalk.dim(sandbox.schemaName)]
  );

  console.log(infoTable.toString());

  // Timing info
  console.log();
  console.log(chalk.bold('Timing'));
  console.log(chalk.dim('─'.repeat(50)));

  const timingTable = new Table({
    style: { head: [], border: [] },
    colWidths: [20, 35],
  });

  timingTable.push(
    [chalk.bold('Created:'), formatDate(sandbox.createdAt)],
    [chalk.bold('Expires:'), formatDate(sandbox.expiresAt)],
    [chalk.bold('Time Left:'), health.expiresIn.startsWith('-') ? chalk.red('EXPIRED') : chalk.green(health.expiresIn)]
  );

  if (health.lastActivity) {
    timingTable.push([chalk.bold('Last Activity:'), formatDate(health.lastActivity)]);
  }

  console.log(timingTable.toString());

  // Guild mappings
  if (sandbox.guildIds.length > 0) {
    console.log();
    console.log(chalk.bold('Registered Guilds'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const guildId of sandbox.guildIds) {
      console.log(`  ${chalk.cyan('•')} ${guildId}`);
    }
  }

  // Health checks
  console.log();
  console.log(chalk.bold('Health Checks'));
  console.log(chalk.dim('─'.repeat(50)));

  console.log(`  ${formatHealthCheckItem('Schema', health.checks.schema)}`);
  console.log(`  ${formatHealthCheckItem('Redis', health.checks.redis)}`);
  console.log(`  ${formatHealthCheckItem('Routing', health.checks.routing)}`);

  // Overall health
  console.log();
  console.log(
    chalk.bold('Overall Health: ') +
    healthColor(health.health.toUpperCase())
  );
}

/**
 * Executes the status command
 *
 * @param name - Sandbox name
 * @param options - Command options
 */
export async function statusCommand(
  name: string,
  options: StatusCommandOptions
): Promise<void> {
  // Only show spinner in interactive TTY mode, not in quiet mode (Sprint 88: clig.dev compliance)
  const spinner = isInteractive() && !options.json && !options.quiet
    ? ora('Fetching sandbox status...').start()
    : null;

  try {
    const logger = createSilentLogger();
    const manager = getSandboxManager(logger);

    // Get sandbox by name first
    const sandbox = await manager.getByName(name);
    if (!sandbox) {
      if (options.json) {
        console.log(JSON.stringify({
          success: false,
          error: {
            message: `Sandbox '${name}' not found`,
            code: 'NOT_FOUND',
          },
        }, null, 2));
      } else {
        spinner?.fail(chalk.red(`Sandbox '${name}' not found`));
        console.error(chalk.yellow('\nUse "gaib sandbox list" to see available sandboxes'));
      }
      process.exit(1);
    }

    // Get health status
    const health = await manager.getHealth(sandbox.id);

    spinner?.stop();

    if (options.json) {
      console.log(JSON.stringify({
        success: true,
        health: {
          sandboxId: health.sandboxId,
          status: health.status,
          health: health.health,
          checks: health.checks,
          lastActivity: health.lastActivity?.toISOString() ?? null,
          expiresIn: health.expiresIn,
        },
        sandbox: {
          id: sandbox.id,
          name: sandbox.name,
          owner: sandbox.owner,
          status: sandbox.status,
          schemaName: sandbox.schemaName,
          createdAt: sandbox.createdAt.toISOString(),
          expiresAt: sandbox.expiresAt.toISOString(),
          lastActivityAt: sandbox.lastActivityAt?.toISOString() ?? null,
          guildIds: sandbox.guildIds,
        },
      }, null, 2));
      return;
    }

    // Sprint 88: Quiet mode - just output health status
    if (options.quiet) {
      console.log(`${sandbox.name}: ${health.health}`);
      return;
    }

    displayTerminalStatus(health, sandbox);

    // Watch mode
    if (options.watch) {
      const interval = options.interval ?? 5;
      console.log(chalk.dim(`\nRefreshing every ${interval}s. Press Ctrl+C to stop.`));

      const watchInterval = setInterval(async () => {
        try {
          const updatedHealth = await manager.getHealth(sandbox.id);
          // Re-fetch sandbox in case it changed
          const updatedSandbox = await manager.getByName(name);
          if (!updatedSandbox) {
            clearInterval(watchInterval);
            console.log(chalk.yellow('\nSandbox no longer available.'));
            process.exit(0);
            return;
          }
          console.clear();
          displayTerminalStatus(updatedHealth, updatedSandbox);
          console.log(chalk.dim(`\nRefreshing every ${interval}s. Press Ctrl+C to stop.`));
        } catch {
          // Sandbox may have been destroyed
          clearInterval(watchInterval);
          console.log(chalk.yellow('\nSandbox no longer available.'));
          process.exit(0);
        }
      }, interval * 1000);

      // Handle graceful shutdown
      process.on('SIGINT', () => {
        clearInterval(watchInterval);
        console.log(chalk.dim('\nStopped watching.'));
        process.exit(0);
      });
    }
  } catch (error) {
    spinner?.stop();
    handleError(error, options.json);
  }
}
