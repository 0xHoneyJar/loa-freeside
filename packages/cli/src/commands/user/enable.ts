/**
 * Enable User Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Enables a previously disabled user account.
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

interface EnableOptions {
  userId: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface EnableResponse {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
}

// =============================================================================
// Enable Command
// =============================================================================

/**
 * Execute the enable command
 *
 * @param options - Command options
 */
export async function enableCommand(options: EnableOptions): Promise<void> {
  const { userId, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Enabling user...').start() : null;

  try {
    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}/enable`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as EnableResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to enable user');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to enable user',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to enable user'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('User enabled');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        message: 'User enabled',
      }));
    } else {
      console.log(chalk.green('User has been enabled.'));
      console.log(chalk.dim('User can now log in again.'));
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

export default enableCommand;
