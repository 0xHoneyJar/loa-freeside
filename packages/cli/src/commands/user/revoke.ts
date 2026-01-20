/**
 * Revoke Sandbox Command for Gom Jabbar CLI
 *
 * Sprint 143: Sandbox Access Management
 *
 * Revokes a user's access to a specific sandbox.
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

interface RevokeSandboxOptions {
  userId: string;
  sandboxId: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface RevokeSandboxResponse {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
}

// =============================================================================
// Revoke Sandbox Command
// =============================================================================

/**
 * Execute the revoke-sandbox command
 *
 * @param options - Command options
 */
export async function revokeSandboxCommand(options: RevokeSandboxOptions): Promise<void> {
  const { userId, sandboxId, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Revoking sandbox access...').start() : null;

  try {
    // Make API request
    const response = await fetch(
      `${server}/api/users/${encodeURIComponent(userId)}/sandbox-access/${encodeURIComponent(sandboxId)}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${credentials.sessionToken}`,
        },
      }
    );

    const data = await response.json() as RevokeSandboxResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to revoke sandbox access');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to revoke sandbox access',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to revoke sandbox access'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('Sandbox access revoked');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        userId,
        sandboxId,
      }));
    } else {
      console.log(chalk.green(`Revoked access to sandbox "${sandboxId}" for user ${userId}`));
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

export default revokeSandboxCommand;
