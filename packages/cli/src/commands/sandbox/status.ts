/**
 * Status Command - bd sandbox status
 *
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Displays detailed status and health information for a sandbox.
 *
 * @see SDD §6.5 Status Command
 * @module packages/cli/commands/sandbox/status
 */

import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import type { SandboxHealthStatus, HealthLevel } from '@arrakis/sandbox';
import {
  getSandboxManager,
  formatDate,
  formatDuration,
  timeUntil,
  handleError,
  createSilentLogger,
} from './utils.js';

/**
 * Options for status command
 */
export interface StatusCommandOptions {
  json?: boolean;
  watch?: boolean;
  interval?: number;
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
function formatHealthCheck(check: { name: string; healthy: boolean; message: string; latencyMs?: number }): string {
  const icon = check.healthy ? chalk.green('✓') : chalk.red('✗');
  const latency = check.latencyMs !== undefined ? chalk.dim(` (${check.latencyMs}ms)`) : '';
  return `${icon} ${check.name}: ${check.message}${latency}`;
}

/**
 * Displays status in terminal format
 */
function displayTerminalStatus(health: SandboxHealthStatus): void {
  const healthColor = getHealthColor(health.overallHealth);

  console.log();
  console.log(chalk.bold('Sandbox Status'));
  console.log(chalk.dim('─'.repeat(50)));

  // Basic info table
  const infoTable = new Table({
    style: { head: [], border: [] },
    colWidths: [20, 35],
  });

  infoTable.push(
    [chalk.bold('Name:'), chalk.cyan(health.sandbox.name)],
    [chalk.bold('ID:'), chalk.dim(health.sandbox.id)],
    [chalk.bold('Status:'), healthColor(health.sandbox.status)],
    [chalk.bold('Owner:'), health.sandbox.owner],
    [chalk.bold('Schema:'), chalk.dim(health.sandbox.schemaName)]
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

  const expiresIn = timeUntil(health.sandbox.expiresAt);
  const expiresDisplay = expiresIn < 0
    ? chalk.red('EXPIRED')
    : chalk.green(formatDuration(expiresIn));

  timingTable.push(
    [chalk.bold('Created:'), formatDate(health.sandbox.createdAt)],
    [chalk.bold('Expires:'), formatDate(health.sandbox.expiresAt)],
    [chalk.bold('Time Left:'), expiresDisplay]
  );

  if (health.sandbox.lastActivityAt) {
    timingTable.push([chalk.bold('Last Activity:'), formatDate(health.sandbox.lastActivityAt)]);
  }

  console.log(timingTable.toString());

  // Guild mappings
  if (health.sandbox.guildIds.length > 0) {
    console.log();
    console.log(chalk.bold('Registered Guilds'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const guildId of health.sandbox.guildIds) {
      console.log(`  ${chalk.cyan('•')} ${guildId}`);
    }
  }

  // Health checks
  console.log();
  console.log(chalk.bold('Health Checks'));
  console.log(chalk.dim('─'.repeat(50)));

  for (const check of health.checks) {
    console.log(`  ${formatHealthCheck(check)}`);
  }

  // Overall health
  console.log();
  console.log(
    chalk.bold('Overall Health: ') +
    healthColor(health.overallHealth.toUpperCase())
  );

  // Check time
  console.log(chalk.dim(`\nChecked at: ${formatDate(health.checkedAt)}`));
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
  const spinner = !options.json ? ora('Fetching sandbox status...').start() : null;

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
        console.error(chalk.yellow('\nUse "bd sandbox list" to see available sandboxes'));
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
          overallHealth: health.overallHealth,
          sandbox: {
            id: health.sandbox.id,
            name: health.sandbox.name,
            owner: health.sandbox.owner,
            status: health.sandbox.status,
            schemaName: health.sandbox.schemaName,
            createdAt: health.sandbox.createdAt.toISOString(),
            expiresAt: health.sandbox.expiresAt.toISOString(),
            lastActivityAt: health.sandbox.lastActivityAt?.toISOString() ?? null,
            guildIds: health.sandbox.guildIds,
          },
          checks: health.checks,
          checkedAt: health.checkedAt.toISOString(),
        },
      }, null, 2));
      return;
    }

    displayTerminalStatus(health);

    // Watch mode
    if (options.watch) {
      const interval = options.interval ?? 5;
      console.log(chalk.dim(`\nRefreshing every ${interval}s. Press Ctrl+C to stop.`));

      const watchInterval = setInterval(async () => {
        try {
          const updatedHealth = await manager.getHealth(sandbox.id);
          console.clear();
          displayTerminalStatus(updatedHealth);
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
