/**
 * Update User Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Updates user properties (roles, display name, sandbox access).
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

interface UpdateOptions {
  userId: string;
  roles?: string;
  displayName?: string;
  sandboxAccess?: string;
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

interface UpdateResponse {
  success: boolean;
  user?: UserPublic;
  error?: string;
  code?: string;
}

// =============================================================================
// Update Command
// =============================================================================

/**
 * Execute the update command
 *
 * @param options - Command options
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
  const { userId, roles, displayName, sandboxAccess, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  // Check if any updates provided
  if (!roles && !displayName && !sandboxAccess) {
    if (json) {
      console.log(JSON.stringify({
        success: false,
        error: 'No updates specified. Use --roles, --display-name, or --sandbox-access',
      }));
    } else {
      console.log(chalk.yellow('No updates specified.'));
      console.log('Use --roles, --display-name, or --sandbox-access to specify changes.');
    }
    process.exit(1);
  }

  const spinner = !quiet && !json ? ora('Updating user...').start() : null;

  try {
    // Build request body
    const body: Record<string, unknown> = {};

    if (roles) {
      const roleList = roles.split(',').map(r => r.trim()).filter(Boolean);

      // Validate roles
      const validRoles = ['admin', 'qa_admin', 'qa_tester'];
      for (const role of roleList) {
        if (!validRoles.includes(role)) {
          spinner?.fail(`Invalid role: ${role}`);
          if (json) {
            console.log(JSON.stringify({
              success: false,
              error: `Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}`,
            }));
          } else if (!quiet) {
            console.log(chalk.red(`Valid roles: ${validRoles.join(', ')}`));
          }
          process.exit(1);
        }
      }

      body.roles = roleList;
    }

    if (displayName) {
      body.displayName = displayName;
    }

    if (sandboxAccess) {
      body.sandboxAccess = sandboxAccess.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Make API request
    const response = await fetch(`${server}/api/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as UpdateResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to update user');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to update user',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to update user'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('User updated');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        user: data.user,
      }));
    } else {
      const user = data.user!;

      console.log();
      console.log(chalk.green(`Updated: ${chalk.bold(user.username)}`));
      console.log();

      // Show updated fields
      if (roles) {
        const roleDisplay = user.roles.map(r => {
          switch (r) {
            case 'admin': return chalk.red(r);
            case 'qa_admin': return chalk.yellow(r);
            case 'qa_tester': return chalk.blue(r);
            default: return r;
          }
        }).join(', ');
        console.log(`Roles: ${roleDisplay}`);
      }

      if (displayName) {
        console.log(`Display Name: ${user.displayName || chalk.dim('(none)')}`);
      }

      if (sandboxAccess) {
        const accessDisplay = user.sandboxAccess.length > 0
          ? (user.sandboxAccess.includes('*') ? chalk.green('* (all)') : user.sandboxAccess.join(', '))
          : chalk.dim('none');
        console.log(`Sandbox Access: ${accessDisplay}`);
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

export default updateCommand;
