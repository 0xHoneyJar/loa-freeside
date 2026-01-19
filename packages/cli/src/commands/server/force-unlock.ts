/**
 * Server Force-Unlock Command
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Manually releases a state lock on a workspace.
 * Use with caution - this can cause data corruption if another process
 * is actively using the lock.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/force-unlock
 */

import chalk from 'chalk';
import * as readline from 'readline';
import {
  formatWarning,
  formatSuccess,
  formatInfo,
  handleError,
  ExitCodes,
} from './utils.js';
import { createWorkspaceManager } from './iac/WorkspaceManager.js';
import { StateLock, formatLockInfo, isLockStale } from './iac/StateLock.js';
import { BackendFactory } from './iac/backends/BackendFactory.js';

/**
 * Options for the force-unlock command
 */
export interface ForceUnlockOptions {
  workspace?: string;
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
}

/**
 * Prompts user for confirmation
 */
async function confirmUnlock(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(
      chalk.red.bold('\n⚠️  WARNING: Force-unlocking can cause data corruption!\n')
    );
    console.log(chalk.yellow('  Only use this if you are certain no other process is'));
    console.log(chalk.yellow('  actively using the lock.\n'));

    rl.question(
      chalk.red('Are you sure you want to force-unlock? ') +
        chalk.dim('Only "yes" will be accepted: '),
      (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes');
      }
    );
  });
}

/**
 * Executes the force-unlock command
 *
 * Manually releases a state lock on a workspace.
 *
 * @param options - Command options
 */
export async function forceUnlockCommand(options: ForceUnlockOptions): Promise<void> {
  // Initialize backend
  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? await manager.current();
    await manager.getBackend().close();

    // Create state lock utility
    const stateLock = new StateLock(backend);

    // Check current lock status
    const lockInfo = await stateLock.getLockInfo(workspace);

    if (!lockInfo) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              workspace,
              wasLocked: false,
              message: 'Workspace was not locked.',
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        console.log(chalk.green(`\n✓ Workspace "${workspace}" is not locked.\n`));
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Show lock info
    if (!options.json && !options.quiet) {
      formatInfo(`Workspace: ${workspace}`);
      console.log(chalk.bold('\n🔒 Current lock:\n'));
      console.log(formatLockInfo(lockInfo));

      // Check if lock is stale
      if (isLockStale(lockInfo)) {
        console.log(chalk.yellow('\n  Note: This lock appears to be stale (> 1 hour old).'));
      }
    }

    // Confirm unless --yes
    if (!options.yes && !options.json) {
      const confirmed = await confirmUnlock();
      if (!confirmed) {
        console.log(chalk.yellow('\nUnlock cancelled.\n'));
        process.exit(ExitCodes.SUCCESS);
      }
    }

    // Force unlock
    const released = await stateLock.forceRelease(workspace);

    // Output result
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: released,
            workspace,
            wasLocked: true,
            lockReleased: released,
            previousLock: {
              id: lockInfo.id,
              who: lockInfo.who,
              operation: lockInfo.operation,
              created: lockInfo.created,
            },
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      if (released) {
        formatSuccess(`Lock released for workspace "${workspace}".`);
      } else {
        formatWarning('Failed to release lock. It may have already been released.');
      }
      console.log('');
    }

    process.exit(released ? ExitCodes.SUCCESS : ExitCodes.VALIDATION_ERROR);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}

/**
 * Show lock status command
 *
 * Shows the current lock status for a workspace without modifying it.
 */
export interface LockStatusOptions {
  workspace?: string;
  json?: boolean;
}

export async function lockStatusCommand(options: LockStatusOptions): Promise<void> {
  // Initialize backend
  const backend = await BackendFactory.auto(process.cwd());

  try {
    // Get current workspace context
    const manager = await createWorkspaceManager();
    const workspace = options.workspace ?? await manager.current();
    await manager.getBackend().close();

    // Create state lock utility
    const stateLock = new StateLock(backend);

    // Check current lock status
    const lockInfo = await stateLock.getLockInfo(workspace);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            workspace,
            locked: lockInfo !== null,
            lockInfo: lockInfo
              ? {
                  id: lockInfo.id,
                  who: lockInfo.who,
                  operation: lockInfo.operation,
                  info: lockInfo.info,
                  created: lockInfo.created,
                  isStale: isLockStale(lockInfo),
                }
              : null,
          },
          null,
          2
        )
      );
    } else {
      console.log(chalk.bold(`\nWorkspace: ${workspace}`));

      if (lockInfo) {
        console.log(chalk.yellow('\n🔒 Locked\n'));
        console.log(formatLockInfo(lockInfo));

        if (isLockStale(lockInfo)) {
          console.log(chalk.yellow('\n  Note: This lock appears to be stale (> 1 hour old).'));
          console.log(chalk.dim('  Run "gaib server force-unlock" to release it.'));
        }
      } else {
        console.log(chalk.green('\n🔓 Unlocked\n'));
      }
    }

    process.exit(ExitCodes.SUCCESS);
  } catch (error) {
    handleError(error, options.json);
  } finally {
    await backend.close();
  }
}
