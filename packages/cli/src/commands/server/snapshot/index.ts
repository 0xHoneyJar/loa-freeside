/**
 * Snapshot Commands
 *
 * Sprint 168: Snapshots - CLI Commands
 *
 * Registers snapshot create, list, restore, download, and compare commands.
 *
 * @see SDD grimoires/loa/sdd.md §14.2
 * @module packages/cli/commands/server/snapshot
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { SnapshotManager } from '../backup/SnapshotManager.js';
import { formatBytes, BackupError, TierLimitError } from '../backup/types.js';

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register snapshot commands on the server command
 */
export function createSnapshotCommands(server: Command): void {
  const snapshot = server
    .command('snapshot')
    .description('Manage full server snapshots');

  // ============================================================================
  // snapshot create
  // ============================================================================

  snapshot
    .command('create')
    .description('Create a full server snapshot')
    .option('-m, --message <message>', 'Snapshot description')
    .action(async (options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        console.log(chalk.cyan('Creating snapshot...'));

        const manager = await SnapshotManager.create({
          serverId,
          workspace,
        });

        const result = await manager.createSnapshot({
          message: options.message,
        });

        console.log(chalk.green('\nSnapshot created successfully!'));
        console.log();
        console.log(`  ${chalk.bold('ID:')}        ${result.id}`);
        console.log(`  ${chalk.bold('Timestamp:')} ${result.timestamp}`);
        console.log(`  ${chalk.bold('Serial:')}    ${result.manifest.serial}`);
        console.log();
        console.log(chalk.bold('Discord Resources:'));
        console.log(`  Roles:      ${result.manifest.discord.roleCount}`);
        console.log(`  Channels:   ${result.manifest.discord.channelCount}`);
        console.log(`  Categories: ${result.manifest.discord.categoryCount}`);
        if (result.manifest.theme) {
          console.log();
          console.log(chalk.bold('Theme:'));
          console.log(`  Name:    ${result.manifest.theme.name}`);
          console.log(`  Version: ${result.manifest.theme.version}`);
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // snapshot list
  // ============================================================================

  snapshot
    .command('list')
    .alias('ls')
    .description('List server snapshots')
    .option('-l, --limit <n>', 'Maximum snapshots to show', '20')
    .action(async (options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await SnapshotManager.create({
          serverId,
          workspace,
        });

        const snapshots = await manager.listSnapshots({
          limit: parseInt(options.limit, 10),
        });

        if (snapshots.length === 0) {
          console.log(chalk.yellow('No snapshots found.'));
          console.log(chalk.dim('Create a snapshot with: gaib server snapshot create'));
          return;
        }

        console.log(chalk.cyan(`Snapshots for server ${serverId}:\n`));

        // Table header
        console.log(
          chalk.bold(
            `${'ID'.padEnd(38)} ${'TIMESTAMP'.padEnd(22)} ${'SERIAL'.padEnd(8)} ${'R/C/Ch'.padEnd(10)} ${'THEME'.padEnd(15)} MESSAGE`
          )
        );
        console.log(chalk.dim('-'.repeat(120)));

        // Table rows
        for (const snap of snapshots) {
          const id = snap.id.substring(0, 36);
          const timestamp = snap.timestamp.substring(0, 20);
          const serial = String(snap.serial).padEnd(8);
          const resources = `${snap.discord.roleCount}/${snap.discord.categoryCount}/${snap.discord.channelCount}`.padEnd(10);
          const theme = snap.theme ? `${snap.theme.name}@${snap.theme.version}`.substring(0, 13).padEnd(15) : chalk.dim('(no theme)').padEnd(15);
          const message = snap.message ?? chalk.dim('(no message)');

          console.log(`${id}  ${timestamp}  ${serial} ${resources} ${theme} ${message}`);
        }

        console.log();
        console.log(chalk.dim(`Showing ${snapshots.length} snapshot(s)`));
        console.log(chalk.dim('R/C/Ch = Roles/Categories/Channels'));
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // snapshot restore
  // ============================================================================

  snapshot
    .command('restore <snapshot-id>')
    .description('Restore from a snapshot')
    .option('--dry-run', 'Show what would be restored without applying')
    .option('--apply', 'Also apply restored config to Discord')
    .action(async (snapshotId, options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await SnapshotManager.create({
          serverId,
          workspace,
        });

        if (options.dryRun) {
          console.log(chalk.cyan('Dry run - showing what would be restored...\n'));
        } else {
          console.log(chalk.cyan('Restoring snapshot...\n'));
        }

        const result = await manager.restoreSnapshot(snapshotId, {
          dryRun: options.dryRun,
          apply: options.apply,
        });

        console.log(`  ${chalk.bold('Snapshot ID:')}  ${result.manifest.id}`);
        console.log(`  ${chalk.bold('Snapshot Time:')} ${result.manifest.timestamp}`);
        console.log(`  ${chalk.bold('Serial:')}       ${result.manifest.serial}`);
        console.log();
        console.log(chalk.bold('Discord Resources:'));
        console.log(`  Roles:      ${result.manifest.discord.roleCount}`);
        console.log(`  Channels:   ${result.manifest.discord.channelCount}`);
        console.log(`  Categories: ${result.manifest.discord.categoryCount}`);

        if (options.dryRun) {
          console.log();
          console.log(chalk.yellow('Dry run complete. No changes were made.'));
          console.log(chalk.dim('Remove --dry-run to apply the restore.'));
        } else {
          console.log();
          console.log(chalk.green('State restored successfully!'));
          if (options.apply) {
            console.log(chalk.dim('Run `gaib server apply` to sync Discord with restored state.'));
          } else {
            console.log(chalk.dim('Run `gaib server diff` to see the current state vs Discord.'));
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // snapshot download
  // ============================================================================

  snapshot
    .command('download <snapshot-id>')
    .description('Download snapshot to local directory')
    .requiredOption('-o, --output <dir>', 'Output directory')
    .action(async (snapshotId, options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await SnapshotManager.create({
          serverId,
          workspace,
        });

        console.log(chalk.cyan(`Downloading snapshot to ${options.output}...`));

        const result = await manager.downloadSnapshot(snapshotId, options.output);

        console.log(chalk.green('\nSnapshot downloaded successfully!'));
        console.log();
        console.log(`  ${chalk.bold('Output directory:')} ${result.outputDir}`);
        console.log();
        console.log(chalk.bold('Files:'));
        for (const file of result.files) {
          console.log(`  - ${file}`);
        }
        console.log();
        console.log(chalk.bold('Discord Resources:'));
        console.log(`  Roles:      ${result.manifest.discord.roleCount}`);
        console.log(`  Channels:   ${result.manifest.discord.channelCount}`);
        console.log(`  Categories: ${result.manifest.discord.categoryCount}`);
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // snapshot compare
  // ============================================================================

  snapshot
    .command('compare <id1> <id2>')
    .description('Compare two snapshots')
    .action(async (id1, id2) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await SnapshotManager.create({
          serverId,
          workspace,
        });

        console.log(chalk.cyan('Comparing snapshots...\n'));

        const diff = await manager.compareSnapshots(id1, id2);

        console.log(chalk.bold('Snapshot 1:'));
        console.log(`  ID:        ${diff.snapshot1.id}`);
        console.log(`  Timestamp: ${diff.snapshot1.timestamp}`);
        console.log();
        console.log(chalk.bold('Snapshot 2:'));
        console.log(`  ID:        ${diff.snapshot2.id}`);
        console.log(`  Timestamp: ${diff.snapshot2.timestamp}`);
        console.log();

        // Roles
        console.log(chalk.bold.cyan('Roles:'));
        if (diff.roles.added.length === 0 && diff.roles.removed.length === 0 && diff.roles.modified.length === 0) {
          console.log(chalk.dim('  No changes'));
        } else {
          for (const name of diff.roles.added) {
            console.log(chalk.green(`  + ${name}`));
          }
          for (const name of diff.roles.removed) {
            console.log(chalk.red(`  - ${name}`));
          }
          for (const mod of diff.roles.modified) {
            console.log(chalk.yellow(`  ~ ${mod.name}`));
            for (const [key, change] of Object.entries(mod.changes)) {
              console.log(chalk.dim(`      ${key}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`));
            }
          }
        }
        console.log();

        // Channels
        console.log(chalk.bold.cyan('Channels:'));
        if (diff.channels.added.length === 0 && diff.channels.removed.length === 0 && diff.channels.modified.length === 0) {
          console.log(chalk.dim('  No changes'));
        } else {
          for (const name of diff.channels.added) {
            console.log(chalk.green(`  + ${name}`));
          }
          for (const name of diff.channels.removed) {
            console.log(chalk.red(`  - ${name}`));
          }
          for (const mod of diff.channels.modified) {
            console.log(chalk.yellow(`  ~ ${mod.name}`));
            for (const [key, change] of Object.entries(mod.changes)) {
              console.log(chalk.dim(`      ${key}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`));
            }
          }
        }
        console.log();

        // Categories
        console.log(chalk.bold.cyan('Categories:'));
        if (diff.categories.added.length === 0 && diff.categories.removed.length === 0 && diff.categories.modified.length === 0) {
          console.log(chalk.dim('  No changes'));
        } else {
          for (const name of diff.categories.added) {
            console.log(chalk.green(`  + ${name}`));
          }
          for (const name of diff.categories.removed) {
            console.log(chalk.red(`  - ${name}`));
          }
          for (const mod of diff.categories.modified) {
            console.log(chalk.yellow(`  ~ ${mod.name}`));
            for (const [key, change] of Object.entries(mod.changes)) {
              console.log(chalk.dim(`      ${key}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`));
            }
          }
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // snapshot delete
  // ============================================================================

  snapshot
    .command('delete <snapshot-id>')
    .alias('rm')
    .description('Delete a snapshot')
    .option('-f, --force', 'Skip confirmation')
    .action(async (snapshotId, options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await SnapshotManager.create({
          serverId,
          workspace,
        });

        // Get snapshot info first
        const manifest = await manager.getManifest(snapshotId);

        // Confirm unless --force
        if (!options.force) {
          console.log(chalk.yellow('About to delete snapshot:'));
          console.log(`  ID:        ${manifest.id}`);
          console.log(`  Timestamp: ${manifest.timestamp}`);
          console.log(`  Serial:    ${manifest.serial}`);
          console.log(`  Resources: ${manifest.discord.roleCount} roles, ${manifest.discord.channelCount} channels`);
          if (manifest.message) {
            console.log(`  Message:   ${manifest.message}`);
          }
          console.log();
          console.log(chalk.red('This action cannot be undone!'));
          console.log(chalk.dim('Use --force to skip this confirmation.'));
          console.log();
          console.log(chalk.yellow('Add --force to confirm deletion.'));
          return;
        }

        console.log(chalk.cyan('Deleting snapshot...'));

        await manager.deleteSnapshot(snapshotId);

        console.log(chalk.green(`Snapshot ${snapshotId} deleted successfully.`));
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
  if (error instanceof TierLimitError) {
    console.error(chalk.yellow('\nTier Limit Exceeded'));
    console.error(chalk.yellow('─'.repeat(40)));
    console.error(error.message);
    console.error();
    console.error(chalk.dim('Upgrade to premium for unlimited snapshots.'));
    process.exit(1);
  }

  if (error instanceof BackupError) {
    console.error(chalk.red(`\nSnapshot Error: ${error.code}`));
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
