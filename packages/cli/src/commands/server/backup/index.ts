/**
 * Backup Commands
 *
 * Sprint 166: Backup Foundation - CLI Commands
 *
 * Registers backup create, list, restore, and delete commands.
 *
 * @see SDD grimoires/loa/sdd.md §14.1
 * @module packages/cli/commands/server/backup
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { BackupManager } from './BackupManager.js';
import { formatBytes, BackupError, TierLimitError } from './types.js';

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register backup commands on the server command
 */
export function createBackupCommands(server: Command): void {
  const backup = server
    .command('backup')
    .description('Manage state backups');

  // ============================================================================
  // backup create
  // ============================================================================

  backup
    .command('create')
    .description('Create a state backup')
    .option('-m, --message <message>', 'Backup description')
    .action(async (options) => {
      try {
        // Get server ID and workspace from environment or config
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        console.log(chalk.cyan('Creating backup...'));

        const manager = await BackupManager.create({
          serverId,
          workspace,
        });

        // TODO: Set backend from current context
        // manager.setBackend(backend);

        const result = await manager.createBackup({
          message: options.message,
        });

        console.log(chalk.green('\nBackup created successfully!'));
        console.log();
        console.log(`  ${chalk.bold('ID:')}        ${result.id}`);
        console.log(`  ${chalk.bold('Timestamp:')} ${result.timestamp}`);
        console.log(`  ${chalk.bold('Serial:')}    ${result.serial}`);
        console.log(`  ${chalk.bold('Size:')}      ${formatBytes(result.size)}`);
        console.log(`  ${chalk.bold('Checksum:')}  ${result.checksum.substring(0, 16)}...`);
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // backup list
  // ============================================================================

  backup
    .command('list')
    .alias('ls')
    .description('List state backups')
    .option('-l, --limit <n>', 'Maximum backups to show', '20')
    .action(async (options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await BackupManager.create({
          serverId,
          workspace,
        });

        const backups = await manager.listBackups({
          limit: parseInt(options.limit, 10),
        });

        if (backups.length === 0) {
          console.log(chalk.yellow('No backups found.'));
          console.log(chalk.dim('Create a backup with: gaib server backup create'));
          return;
        }

        console.log(chalk.cyan(`Backups for server ${serverId}:\n`));

        // Table header
        console.log(
          chalk.bold(
            `${'ID'.padEnd(38)} ${'TIMESTAMP'.padEnd(24)} ${'SERIAL'.padEnd(8)} ${'SIZE'.padEnd(10)} MESSAGE`
          )
        );
        console.log(chalk.dim('-'.repeat(100)));

        // Table rows
        for (const backup of backups) {
          const id = backup.id.substring(0, 36);
          const timestamp = backup.timestamp.substring(0, 22);
          const serial = String(backup.serial).padEnd(8);
          const size = formatBytes(backup.size).padEnd(10);
          const message = backup.message ?? chalk.dim('(no message)');

          console.log(`${id}  ${timestamp}  ${serial} ${size} ${message}`);
        }

        console.log();
        console.log(chalk.dim(`Showing ${backups.length} backup(s)`));
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // backup restore
  // ============================================================================

  backup
    .command('restore <backup-id>')
    .description('Restore from a backup')
    .option('--dry-run', 'Show what would be restored without applying')
    .action(async (backupId, options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await BackupManager.create({
          serverId,
          workspace,
        });

        // TODO: Set backend from current context
        // manager.setBackend(backend);

        if (options.dryRun) {
          console.log(chalk.cyan('Dry run - showing what would be restored...\n'));
        } else {
          console.log(chalk.cyan('Restoring backup...\n'));
        }

        const result = await manager.restoreBackup(backupId, {
          dryRun: options.dryRun,
        });

        console.log(`  ${chalk.bold('Backup ID:')}      ${result.backup.id}`);
        console.log(`  ${chalk.bold('Backup Time:')}    ${result.backup.timestamp}`);
        console.log();
        console.log(chalk.bold('Changes:'));
        console.log(`  Serial:     ${result.changes.serial.from} → ${result.changes.serial.to}`);
        console.log(`  Resources:  ${result.changes.resourceCount.from} → ${result.changes.resourceCount.to}`);

        if (options.dryRun) {
          console.log();
          console.log(chalk.yellow('Dry run complete. No changes were made.'));
          console.log(chalk.dim('Remove --dry-run to apply the restore.'));
        } else {
          console.log();
          console.log(chalk.green('Restore completed successfully!'));
          console.log(chalk.dim('Run `gaib server diff` to see the current state vs Discord.'));
        }
      } catch (error) {
        handleError(error);
      }
    });

  // ============================================================================
  // backup delete
  // ============================================================================

  backup
    .command('delete <backup-id>')
    .alias('rm')
    .description('Delete a backup')
    .option('-f, --force', 'Skip confirmation')
    .action(async (backupId, options) => {
      try {
        const serverId = process.env.DISCORD_GUILD_ID;
        const workspace = process.env.GAIB_WORKSPACE ?? 'default';

        if (!serverId) {
          console.error(chalk.red('Error: DISCORD_GUILD_ID environment variable is required'));
          process.exit(1);
        }

        const manager = await BackupManager.create({
          serverId,
          workspace,
        });

        // Get backup info first
        const backup = await manager.getBackupMetadata(backupId);
        if (!backup) {
          console.error(chalk.red(`Backup not found: ${backupId}`));
          process.exit(1);
        }

        // Confirm unless --force
        if (!options.force) {
          console.log(chalk.yellow('About to delete backup:'));
          console.log(`  ID:        ${backup.id}`);
          console.log(`  Timestamp: ${backup.timestamp}`);
          console.log(`  Serial:    ${backup.serial}`);
          console.log(`  Size:      ${formatBytes(backup.size)}`);
          if (backup.message) {
            console.log(`  Message:   ${backup.message}`);
          }
          console.log();
          console.log(chalk.red('This action cannot be undone!'));
          console.log(chalk.dim('Use --force to skip this confirmation.'));

          // In a real CLI we'd prompt for confirmation
          // For now, require --force
          console.log();
          console.log(chalk.yellow('Add --force to confirm deletion.'));
          return;
        }

        console.log(chalk.cyan('Deleting backup...'));

        await manager.deleteBackup(backupId);

        console.log(chalk.green(`Backup ${backupId} deleted successfully.`));
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
    console.error(chalk.dim('Upgrade to premium for unlimited backups.'));
    process.exit(1);
  }

  if (error instanceof BackupError) {
    console.error(chalk.red(`\nBackup Error: ${error.code}`));
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

// ============================================================================
// Exports
// ============================================================================

export { BackupManager } from './BackupManager.js';
export { TierManager } from './TierManager.js';
export { RestoreEngine, createRestoreEngine } from './RestoreEngine.js';
export { SnapshotManager, type ConfigExporter } from './SnapshotManager.js';
export { ThemeRegistryManager } from './ThemeRegistryManager.js';
export { NotificationService } from './NotificationService.js';
export * from './types.js';
