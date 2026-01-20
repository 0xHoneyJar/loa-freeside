/**
 * Show User Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Displays detailed user information.
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

interface ShowOptions {
  userId: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface UserPublic {
  id: string;
  username: string;
  roles: string[];
  sandboxAccess: string[];
  isActive: boolean;
  displayName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  requirePasswordChange: boolean;
}

interface ShowResponse {
  success: boolean;
  user?: UserPublic;
  error?: string;
  code?: string;
}

// =============================================================================
// Show Command
// =============================================================================

/**
 * Execute the show command
 *
 * @param options - Command options
 */
export async function showCommand(options: ShowOptions): Promise<void> {
  const { userId, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Fetching user...').start() : null;

  try {
    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as ShowResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to fetch user');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'User not found',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'User not found'));
      }
      process.exit(1);
    }

    spinner?.stop();

    const user = data.user!;

    // Output results
    if (json) {
      console.log(JSON.stringify({
        success: true,
        user,
      }));
    } else {
      console.log();
      console.log(chalk.bold(`User: ${user.username}`));
      console.log();

      // Basic info
      console.log(`ID:           ${user.id}`);
      console.log(`Display Name: ${user.displayName || chalk.dim('(none)')}`);

      // Status
      const statusColor = user.isActive ? chalk.green : chalk.red;
      console.log(`Status:       ${statusColor(user.isActive ? 'Active' : 'Disabled')}`);

      // Roles
      const roleDisplay = user.roles.map(r => {
        switch (r) {
          case 'admin': return chalk.red(r);
          case 'qa_admin': return chalk.yellow(r);
          case 'qa_tester': return chalk.blue(r);
          default: return r;
        }
      }).join(', ');
      console.log(`Roles:        ${roleDisplay}`);

      // Sandbox access
      if (user.sandboxAccess.length > 0) {
        const accessDisplay = user.sandboxAccess.includes('*')
          ? chalk.green('* (all sandboxes)')
          : user.sandboxAccess.join(', ');
        console.log(`Sandboxes:    ${accessDisplay}`);
      } else {
        console.log(`Sandboxes:    ${chalk.dim('none')}`);
      }

      console.log();

      // Timestamps
      console.log(`Created:      ${new Date(user.createdAt).toLocaleString()}`);
      console.log(`Last Login:   ${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : chalk.dim('Never')}`);

      // Password change required
      if (user.requirePasswordChange) {
        console.log();
        console.log(chalk.yellow('Note: Password change required on next login'));
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

export default showCommand;
