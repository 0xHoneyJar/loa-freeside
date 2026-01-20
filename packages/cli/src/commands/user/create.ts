/**
 * Create User Command for Gom Jabbar CLI
 *
 * Sprint 142: CLI User Management Commands
 *
 * Creates a new user account with optional auto-generated password.
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

interface CreateOptions {
  username: string;
  roles: string;
  displayName?: string;
  sandboxAccess?: string;
  server: string;
  json?: boolean;
  quiet?: boolean;
}

interface CreateResponse {
  success: boolean;
  user?: {
    id: string;
    username: string;
    roles: string[];
    sandboxAccess: string[];
    displayName: string | null;
    isActive: boolean;
    createdAt: string;
    requirePasswordChange: boolean;
  };
  generatedPassword?: string;
  error?: string;
  code?: string;
}

// =============================================================================
// Create Command
// =============================================================================

/**
 * Execute the create command
 *
 * @param options - Command options
 */
export async function createCommand(options: CreateOptions): Promise<void> {
  const { username, roles, displayName, sandboxAccess, server, json, quiet } = options;

  // Authenticate
  const credentials = await requireAuth();
  await requireRoles(credentials, ['admin', 'qa_admin']);

  const spinner = !quiet && !json ? ora('Creating user...').start() : null;

  try {
    // Parse roles
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

    // Build request body
    const body: Record<string, unknown> = {
      username,
      roles: roleList,
      requirePasswordChange: true,
    };

    if (displayName) {
      body.displayName = displayName;
    }

    if (sandboxAccess) {
      body.sandboxAccess = sandboxAccess.split(',').map(s => s.trim()).filter(Boolean);
    }

    // Make API request
    const response = await fetch(`${server}/api/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${credentials.sessionToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as CreateResponse;

    if (!response.ok || !data.success) {
      spinner?.fail('Failed to create user');

      if (json) {
        console.log(JSON.stringify({
          success: false,
          error: data.error || 'Failed to create user',
          code: data.code,
        }));
      } else {
        console.log(chalk.red(data.error || 'Failed to create user'));
        if (data.code) {
          console.log(chalk.dim(`Error code: ${data.code}`));
        }
      }
      process.exit(1);
    }

    // Success
    spinner?.succeed('User created');

    if (json) {
      console.log(JSON.stringify({
        success: true,
        user: data.user,
        generatedPassword: data.generatedPassword,
      }));
    } else {
      console.log();
      console.log(chalk.green(`User created: ${chalk.bold(data.user?.username)}`));
      console.log();
      console.log(`ID: ${data.user?.id}`);
      console.log(`Roles: ${data.user?.roles.join(', ')}`);

      if (data.user?.sandboxAccess.length) {
        console.log(`Sandbox access: ${data.user.sandboxAccess.join(', ')}`);
      }

      if (data.generatedPassword) {
        console.log();
        console.log(chalk.yellow('Generated password (shown only once):'));
        console.log(chalk.bold(data.generatedPassword));
        console.log();
        console.log(chalk.dim('User will be required to change password on first login.'));
      }

      // Sprint 148: Next-step suggestion
      if (!quiet && process.stdout.isTTY) {
        console.log();
        console.log(chalk.dim('Next step:'));
        console.log(`  ${chalk.cyan(`gaib user grant ${data.user?.id} <sandbox-id>`)}  ${chalk.dim('- Grant sandbox access')}`);
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

export default createCommand;
