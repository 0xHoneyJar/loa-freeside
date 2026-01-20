/**
 * List Users Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Lists users with optional filtering.
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

interface ListOptions {
  role?: string;
  active?: boolean;
  inactive?: boolean;
  search?: string;
  limit: string;
  offset: string;
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

interface ListResponse {
  success: boolean;
  users?: UserPublic[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

// =============================================================================
// List Command
// =============================================================================

/**
 * Execute the list command
 *
 * @param options - Command options
 */
export async function listCommand(options: ListOptions): Promise<void> {
  const { role, active, inactive, search, limit, offset, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Fetching users...').start() : null;

  try {
    // Build query params
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('offset', offset);

    if (role) {
      params.set('role', role);
    }

    if (active) {
      params.set('isActive', 'true');
    } else if (inactive) {
      params.set('isActive', 'false');
    }

    if (search) {
      params.set('search', search);
    }

    // Make API request
    const response = await fetch(`${server}/api/users?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
    });

    const data = await response.json() as ListResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to fetch users');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to fetch users',
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to fetch users'));
      }
      process.exit(1);
    }

    spinner?.stop();

    // Output results
    if (json) {
      console.log(JSON.stringify({
        success: true,
        users: data.users,
        total: data.total,
        hasMore: data.hasMore,
      }));
    } else {
      const users = data.users || [];

      if (users.length === 0) {
        console.log(chalk.yellow('No users found'));
        return;
      }

      // Table header
      console.log();
      console.log(chalk.bold('ID'.padEnd(38) + 'Username'.padEnd(20) + 'Roles'.padEnd(25) + 'Status'.padEnd(12) + 'Last Login'));
      console.log('-'.repeat(110));

      // Table rows
      for (const user of users) {
        const statusColor = user.isActive ? chalk.green : chalk.red;
        const roleDisplay = user.roles.map(r => {
          switch (r) {
            case 'admin': return chalk.red(r);
            case 'qa_admin': return chalk.yellow(r);
            case 'qa_tester': return chalk.blue(r);
            default: return r;
          }
        }).join(', ');

        const lastLogin = user.lastLoginAt
          ? new Date(user.lastLoginAt).toLocaleDateString()
          : chalk.dim('Never');

        console.log(
          user.id.padEnd(38) +
          user.username.padEnd(20) +
          roleDisplay.padEnd(35) +  // Extra padding for ANSI codes
          statusColor(user.isActive ? 'Active' : 'Disabled').padEnd(22) +  // Extra padding for ANSI codes
          lastLogin
        );
      }

      // Pagination info
      console.log();
      console.log(chalk.dim(
        `Showing ${users.length} of ${data.total ?? users.length} users` +
        (data.hasMore ? ' (more available)' : '')
      ));
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

export default listCommand;
