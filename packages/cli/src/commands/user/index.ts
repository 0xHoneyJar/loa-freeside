/**
 * User Command Group
 *
 * Sprint 142: CLI User Management Commands
 *
 * Registers the `gaib user` command group with CRUD subcommands.
 *
 * @see grimoires/loa/sdd.md §13.3.4 CLI User Management Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 * @module packages/cli/commands/user
 */

import { Command } from 'commander';
import chalk from 'chalk';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_SERVER_URL = process.env.GAIB_API_URL || 'http://localhost:3000';

// =============================================================================
// Color Control Helper
// =============================================================================

/**
 * Check if colors should be used
 */
function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

// =============================================================================
// User Command Group
// =============================================================================

/**
 * Creates the user command group
 *
 * @returns Commander command with all user subcommands
 */
export function createUserCommand(): Command {
  const user = new Command('user')
    .description('User account management (requires admin or qa_admin role)')
    .option('--no-color', 'Disable colored output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .option('--server <url>', 'API server URL', DEFAULT_SERVER_URL)
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      if (opts.noColor || !shouldUseColor()) {
        chalk.level = 0;
      }
    })
    .addHelpText(
      'after',
      `
Examples:
  $ gaib user create --username testuser --roles qa_tester
  $ gaib user list
  $ gaib user list --role qa_tester --active
  $ gaib user show <user-id>
  $ gaib user update <user-id> --roles qa_admin
  $ gaib user disable <user-id>
  $ gaib user enable <user-id>
  $ gaib user delete <user-id> --force
  $ gaib user reset-password <user-id>
  $ gaib user sandboxes <user-id>
  $ gaib user grant-sandbox <user-id> <sandbox-id>
  $ gaib user revoke-sandbox <user-id> <sandbox-id>

Environment:
  GAIB_API_URL   API server URL (default: ${DEFAULT_SERVER_URL})
`
    );

  // Register subcommands
  registerCreateCommand(user);
  registerListCommand(user);
  registerShowCommand(user);
  registerUpdateCommand(user);
  registerDisableCommand(user);
  registerEnableCommand(user);
  registerDeleteCommand(user);
  registerResetPasswordCommand(user);
  registerSandboxesCommand(user);
  registerGrantSandboxCommand(user);
  registerRevokeSandboxCommand(user);

  return user;
}

// =============================================================================
// Subcommand Registrations
// =============================================================================

/**
 * Registers the 'create' subcommand
 */
function registerCreateCommand(parent: Command): void {
  parent
    .command('create')
    .description('Create a new user account')
    .requiredOption('--username <username>', 'Username (3-32 alphanumeric/underscore characters)')
    .option('--roles <roles>', 'Comma-separated roles (qa_tester, qa_admin, admin)', 'qa_tester')
    .option('--display-name <name>', 'Display name')
    .option('--sandbox-access <ids>', 'Comma-separated sandbox IDs')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { createCommand } = await import('./create.js');
      const globalOpts = parent.optsWithGlobals();
      await createCommand({ ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'list' subcommand
 */
function registerListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List users')
    .option('--role <role>', 'Filter by role (qa_tester, qa_admin, admin)')
    .option('--active', 'Show only active users')
    .option('--inactive', 'Show only inactive users')
    .option('--search <query>', 'Search by username')
    .option('--limit <number>', 'Maximum results to return', '20')
    .option('--offset <number>', 'Skip first N results', '0')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { listCommand } = await import('./list.js');
      const globalOpts = parent.optsWithGlobals();
      await listCommand({ ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'show' subcommand
 */
function registerShowCommand(parent: Command): void {
  parent
    .command('show <user-id>')
    .description('Show user details')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { showCommand } = await import('./show.js');
      const globalOpts = parent.optsWithGlobals();
      await showCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'update' subcommand
 */
function registerUpdateCommand(parent: Command): void {
  parent
    .command('update <user-id>')
    .description('Update user properties')
    .option('--roles <roles>', 'Comma-separated roles (qa_tester, qa_admin, admin)')
    .option('--display-name <name>', 'Display name')
    .option('--sandbox-access <ids>', 'Comma-separated sandbox IDs (replaces existing)')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { updateCommand } = await import('./update.js');
      const globalOpts = parent.optsWithGlobals();
      await updateCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'disable' subcommand
 */
function registerDisableCommand(parent: Command): void {
  parent
    .command('disable <user-id>')
    .description('Disable a user account')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { disableCommand } = await import('./disable.js');
      const globalOpts = parent.optsWithGlobals();
      await disableCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'enable' subcommand
 */
function registerEnableCommand(parent: Command): void {
  parent
    .command('enable <user-id>')
    .description('Enable a user account')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { enableCommand } = await import('./enable.js');
      const globalOpts = parent.optsWithGlobals();
      await enableCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'delete' subcommand
 */
function registerDeleteCommand(parent: Command): void {
  parent
    .command('delete <user-id>')
    .description('Delete a user account (admin only)')
    .option('--force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { deleteCommand } = await import('./delete.js');
      const globalOpts = parent.optsWithGlobals();
      await deleteCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'reset-password' subcommand
 */
function registerResetPasswordCommand(parent: Command): void {
  parent
    .command('reset-password <user-id>')
    .description('Reset user password (generates new password)')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { resetPasswordCommand } = await import('./reset-password.js');
      const globalOpts = parent.optsWithGlobals();
      await resetPasswordCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'sandboxes' subcommand
 */
function registerSandboxesCommand(parent: Command): void {
  parent
    .command('sandboxes <user-id>')
    .description('List user\'s sandbox access')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { sandboxesCommand } = await import('./sandboxes.js');
      const globalOpts = parent.optsWithGlobals();
      await sandboxesCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'grant-sandbox' subcommand
 */
function registerGrantSandboxCommand(parent: Command): void {
  parent
    .command('grant-sandbox <user-id> <sandbox-id>')
    .description('Grant user access to a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (userId, sandboxId, options) => {
      const { grantSandboxCommand } = await import('./grant-sandbox.js');
      const globalOpts = parent.optsWithGlobals();
      await grantSandboxCommand({ userId, sandboxId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'revoke-sandbox' subcommand
 */
function registerRevokeSandboxCommand(parent: Command): void {
  parent
    .command('revoke-sandbox <user-id> <sandbox-id>')
    .description('Revoke user access from a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (userId, sandboxId, options) => {
      const { revokeSandboxCommand } = await import('./revoke-sandbox.js');
      const globalOpts = parent.optsWithGlobals();
      await revokeSandboxCommand({ userId, sandboxId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

// =============================================================================
// Exports
// =============================================================================

export { createUserCommand as default };
