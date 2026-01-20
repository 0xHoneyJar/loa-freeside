/**
 * Disable User Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Disables a user account (soft disable, revokes all sessions).
 *
 * @see grimoires/loa/sdd.md §13.3.4 CLI User Management Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 */

import chalk from 'chalk';
import ora from 'ora';
import { requireAuth, requireRoles } from '../auth/guards.js';

// =============================================================================
// Types
// =============================================================================

interface DisableOptions {
  userId: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface DisableResponse {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
}

// =============================================================================
// Disable Command
// =============================================================================

/**
 * Execute the disable command
 *
 * @param options - Command options
 */
export async function disableCommand(options: DisableOptions): Promise<void> {
  const { userId, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Disabling user...').start() : null;

  try {
    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}/disable`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as DisableResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to disable user');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to disable user',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to disable user'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('User disabled');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        message: 'User disabled',
      }));
    } else {
      console.log(chalk.green('User has been disabled.'));
      console.log(chalk.dim('All active sessions have been revoked.'));
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

export default disableCommand;
