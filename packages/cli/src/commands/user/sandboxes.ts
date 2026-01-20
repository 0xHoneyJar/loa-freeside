/**
 * Sandboxes Command for Gom Jabbar CLI
 *
 * Sprint 143: Sandbox Access Management
 *
 * Lists a user's sandbox access permissions.
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

interface SandboxesOptions {
  userId: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface SandboxesResponse {
  success: boolean;
  userId: string;
  username: string;
  sandboxAccess: string[];
  error?: string;
  code?: string;
}

// =============================================================================
// Sandboxes Command
// =============================================================================

/**
 * Execute the sandboxes command
 *
 * @param options - Command options
 */
export async function sandboxesCommand(options: SandboxesOptions): Promise<void> {
  const { userId, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Fetching sandbox access...').start() : null;

  try {
    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}/sandbox-access`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as SandboxesResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to fetch sandbox access');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to fetch sandbox access',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to fetch sandbox access'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('Sandbox access retrieved');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        userId: data.userId,
        username: data.username,
        sandboxAccess: data.sandboxAccess,
      }));
    } else {
      console.log();
      console.log(chalk.bold(`Sandbox access for ${data.username}:`));
      console.log();

      if (data.sandboxAccess.length === 0) {
        console.log(chalk.dim('  No sandbox access granted'));
      } else {
        for (const sandboxId of data.sandboxAccess) {
          console.log(`  ${chalk.cyan('•')} ${sandboxId}`);
        }
      }
      console.log();
      console.log(chalk.dim(`Total: ${data.sandboxAccess.length} sandbox(es)`));
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

export default sandboxesCommand;
