/**
 * Reset Password Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Resets a user's password and generates a new one.
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

interface ResetPasswordOptions {
  userId: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface ResetPasswordResponse {
  success: boolean;
  generatedPassword?: string;
  message?: string;
  error?: string;
  code?: string;
}

// =============================================================================
// Reset Password Command
// =============================================================================

/**
 * Execute the reset-password command
 *
 * @param options - Command options
 */
export async function resetPasswordCommand(options: ResetPasswordOptions): Promise<void> {
  const { userId, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Resetting password...').start() : null;

  try {
    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as ResetPasswordResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to reset password');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to reset password',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to reset password'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('Password reset');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        generatedPassword: data.generatedPassword,
      }));
    } else {
      console.log();
      console.log(chalk.green('Password has been reset.'));
      console.log();

      if (data.generatedPassword) {
        console.log(chalk.yellow('New password (shown only once):'));
        console.log(chalk.bold(data.generatedPassword));
        console.log();
        console.log(chalk.dim('User will be required to change password on next login.'));

        // Sprint 148: Next-step suggestion
        if (!quiet && process.stdout.isTTY) {
          console.log();
          console.log(chalk.dim('Next step:'));
          console.log(`  ${chalk.cyan('gaib auth login')}  ${chalk.dim('- Log in with new credentials')}`);
        }
      }
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

export default resetPasswordCommand;
