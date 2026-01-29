/**
 * Theme Registry Commands
 *
 * Sprint 169: Theme Registry - CLI Commands
 *
 * Registers theme registry, history, and rollback commands.
 *
 * @see SDD grimoires/loa/sdd.md §14.3
 * @module packages/cli/commands/server/theme/registry
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { ThemeRegistryManager } from '../backup/ThemeRegistryManager.js';
import { SnapshotManager } from '../backup/SnapshotManager.js';
import { BackupError } from '../backup/types.js';

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register theme registry commands on the theme command
 */
export function createThemeRegistryCommands(theme: Command): void {
  // ============================================================================
  // theme registry
  // ============================================================================

  theme
    .command('registry')
    .description('Show current theme deployment and recent history')
    .action(async () => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await ThemeRegistryManager.create({
          serverId,
          workspace,
        });

        const info = await manager.getRegistryInfo();

        console.log(chalk.cyan(`Theme Registry for server ${serverId}\n`));

        // Current deployment
        console.log(chalk.bold('Current Deployment:'));
        if (info.current) {
          console.log(`  Theme:     ${chalk.green(info.current.themeName)}@${info.current.themeVersion}`);
          console.log(`  Deployed:  ${info.current.timestamp}`);
          console.log(`  Serial:    ${info.current.serial}`);
          console.log(`  Action:    ${info.current.action}`);
          console.log(`  By:        ${info.current.who}`);
          if (info.current.snapshotId) {
            console.log(`  Snapshot:  ${info.current.snapshotId}`);
          }
          if (info.current.message) {
            console.log(`  Message:   ${info.current.message}`);
          }
        } else {
          console.log(chalk.dim('  No theme deployed'));
        }

        console.log();

        // Recent history
        console.log(chalk.bold('Recent History:'));
        if (info.recentHistory.length === 0) {
          console.log(chalk.dim('  No deployment history'));
        } else {
          for (const deployment of info.recentHistory) {
            const actionColor =
              deployment.action === 'destroy'
                ? chalk.red
                : deployment.action === 'rollback'
                  ? chalk.yellow
                  : chalk.green;

            console.log(
              `  ${deployment.timestamp.substring(0, 19)}  ` +
                `${actionColor(deployment.action.padEnd(8))}  ` +
                `${deployment.themeName}@${deployment.themeVersion}  ` +
                `${chalk.dim(deployment.who)}`
            );
          }
        }

        console.log();
        console.log(chalk.dim(`Total deployments: ${info.totalDeployments}`));
        console.log(chalk.dim('Run `gaib server theme history` for full history'));
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // theme history
  // ============================================================================

  theme
    .command('history')
    .description('Show full theme deployment history')
    .option('-l, --limit <n>', 'Maximum entries to show', '20')
    .action(async (options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await ThemeRegistryManager.create({
          serverId,
          workspace,
        });

        const history = await manager.getHistory({
          limit: parseInt(options.limit, 10),
        });

        if (history.length === 0) {
          console.log(chalk.yellow('No deployment history found.'));
          return;
        }

        console.log(chalk.cyan(`Theme Deployment History for server ${serverId}\n`));

        // Table header
        console.log(
          chalk.bold(
            `${'TIMESTAMP'.padEnd(22)} ${'ACTION'.padEnd(10)} ${'THEME'.padEnd(20)} ${'SERIAL'.padEnd(8)} ${'BY'.padEnd(15)} ${'SNAPSHOT'}`
          )
        );
        console.log(chalk.dim('-'.repeat(100)));

        // Table rows
        for (const deployment of history) {
          const timestamp = deployment.timestamp.substring(0, 20);
          const actionColor =
            deployment.action === 'destroy'
              ? chalk.red
              : deployment.action === 'rollback'
                ? chalk.yellow
                : chalk.green;
          const action = actionColor(deployment.action.padEnd(10));
          const theme = `${deployment.themeName}@${deployment.themeVersion}`.substring(0, 18).padEnd(20);
          const serial = String(deployment.serial).padEnd(8);
          const who = deployment.who.substring(0, 13).padEnd(15);
          const snapshot = deployment.snapshotId
            ? deployment.snapshotId.substring(0, 8)
            : chalk.dim('(none)');

          console.log(`${timestamp}  ${action} ${theme} ${serial} ${who} ${snapshot}`);
        }

        console.log();
        console.log(chalk.dim(`Showing ${history.length} deployment(s)`));
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // theme rollback
  // ============================================================================

  theme
    .command('rollback')
    .description('Rollback to a previous theme deployment')
    .option('-s, --steps <n>', 'Number of deployments to roll back', '1')
    .option('-t, --to <id>', 'Specific deployment ID to roll back to')
    .option('--dry-run', 'Show what would be rolled back without applying')
    .action(async (options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const registryManager = await ThemeRegistryManager.create({
          serverId,
          workspace,
        });

        // Set up snapshot manager for restore
        const snapshotManager = await SnapshotManager.create({
          serverId,
          workspace,
        });
        registryManager.setSnapshotManager(snapshotManager);

        if (options.dryRun) {
          console.log(chalk.cyan('Dry run - showing what would be rolled back...\n'));
        } else {
          console.log(chalk.cyan('Rolling back theme deployment...\n'));
        }

        const result = await registryManager.rollback({
          steps: options.to ? undefined : parseInt(options.steps, 10),
          toDeploymentId: options.to,
          dryRun: options.dryRun,
        });

        console.log(chalk.bold('From:'));
        if (result.from) {
          console.log(`  Theme:     ${result.from.themeName}@${result.from.themeVersion}`);
          console.log(`  Deployed:  ${result.from.timestamp}`);
          console.log(`  Serial:    ${result.from.serial}`);
        } else {
          console.log(chalk.dim('  No current deployment'));
        }

        console.log();
        console.log(chalk.bold('To:'));
        console.log(`  Theme:     ${result.to.themeName}@${result.to.themeVersion}`);
        console.log(`  Deployed:  ${result.to.timestamp}`);
        console.log(`  Serial:    ${result.to.serial}`);
        if (result.to.snapshotId) {
          console.log(`  Snapshot:  ${result.to.snapshotId}`);
        }

        if (options.dryRun) {
          console.log();
          console.log(chalk.yellow('Dry run complete. No changes were made.'));
          console.log(chalk.dim('Remove --dry-run to apply the rollback.'));
        } else {
          console.log();
          console.log(chalk.green('Rollback completed successfully!'));
          console.log(chalk.dim('Run `gaib server apply` to sync Discord with rolled back state.'));
        }
      } catch (error) {
        handleError(error);
      }
    });
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Handle errors with user-friendly messages
 */
function handleError(error: unknown): never {
  if (error instanceof BackupError) {
    if (error.code === 'NO_SNAPSHOT_FOR_ROLLBACK') {
      console.error(chalk.yellow('\nRollback Not Possible'));
      console.error(chalk.yellow('─'.repeat(40)));
      console.error(error.message);
      console.error();
      console.error(chalk.dim('Create snapshots during deployment to enable rollback.'));
      process.exit(1);
    }

    console.error(chalk.red(`\nTheme Registry Error: ${error.code}`));
    console.error(error.message);
    if (error.details) {
      console.error(chalk.dim(JSON.stringify(error.details, null, 2)));
    }
    process.exit(1);
  }

  if (error instanceof Error) {
    console.error(chalk.red('\nError:'), error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }

  console.error(chalk.red('\nUnknown error:'), error);
  process.exit(1);
}
