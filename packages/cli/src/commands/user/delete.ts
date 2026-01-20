/**
 * Delete User Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Permanently deletes a user account (admin only).
 *
 * @see grimoires/loa/sdd.md §13.3.4 CLI User Management Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { requireAuth, requireRoles } from '../auth/guards.js';

// =============================================================================
// Types
// =============================================================================

interface DeleteOptions {
  userId: string;
  force?: boolean;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface DeleteResponse {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
}

// =============================================================================
// Delete Command
// =============================================================================

/**
 * Execute the delete command
 *
 * @param options - Command options
 */
export async function deleteCommand(options: DeleteOptions): Promise<void> {
  const { userId, force, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin']);

  // Confirmation prompt (unless --force)
  if (!force && !json) {
    const confirmed = await confirmDelete(userId);
    if (!confirmed) {
      console.log(chalk.yellow('Deletion cancelled.'));
      process.exit(0);
    }
  }

  const spinner = !quiet && !json ? ora('Deleting user...').start() : null;

  try {
    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as DeleteResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to delete user');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to delete user',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to delete user'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('User deleted');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        message: 'User permanently deleted',
      }));
    } else {
      console.log(chalk.green('User has been permanently deleted.'));
    }
  } catch (error) {
    spinner?.fail('Request failed');

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (json) {
      console.log(JSON.stringify({
        success: false,
        error: errorMessage,
      }));
    } else {
      console.log(chalk.red(`Error: ${errorMessage}`));
    }
    process.exit(1);
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Prompt user to confirm deletion
 */
async function confirmDelete(userId: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log(chalk.yellow(`\nWarning: This will permanently delete user ${userId}.`));
    console.log(chalk.yellow('This action cannot be undone.\n'));

    rl.question('Type "delete" to confirm: ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'delete');
    });
  });
}

export default deleteCommand;
