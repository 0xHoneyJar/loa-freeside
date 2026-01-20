/**
 * User Command Group
 *
 * Sprint 142: CLI User Management Commands
 * Sprint 146: CLI Ergonomics Refactoring (Crysknife Edge)
 *
 * Registers the `gaib user` command group with CRUD subcommands.
 *
 * @see grimoires/loa/sdd.md §13.3.4 CLI User Management Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 * @see grimoires/loa/prd.md §15 Crysknife Edge (CLI Ergonomics)
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
  $ gaib user ls
  $ gaib user ls --role qa_tester --active
  $ gaib user show <user-id>
  $ gaib user set <user-id> --roles qa_admin
  $ gaib user off <user-id>
  $ gaib user on <user-id>
  $ gaib user rm <user-id> --force
  $ gaib user passwd <user-id>
  $ gaib user access <user-id>
  $ gaib user grant <user-id> <sandbox-id>
  $ gaib user revoke <user-id> <sandbox-id>

Environment:
  GAIB_API_URL   API server URL (default: ${DEFAULT_SERVER_URL})
`
    );

  // Register subcommands
  registerCreateCommand(user);
  registerLsCommand(user);
  registerShowCommand(user);
  registerSetCommand(user);
  registerOffCommand(user);
  registerOnCommand(user);
  registerRmCommand(user);
  registerPasswdCommand(user);
  registerAccessCommand(user);
  registerGrantCommand(user);
  registerRevokeCommand(user);

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
 * Registers the 'ls' subcommand (list users)
 */
function registerLsCommand(parent: Command): void {
  parent
    .command('ls')
    .description('List users')
    .option('--role <role>', 'Filter by role (qa_tester, qa_admin, admin)')
    .option('--active', 'Show only active users')
    .option('--inactive', 'Show only inactive users')
    .option('--search <query>', 'Search by username')
    .option('--limit <number>', 'Maximum results to return', '20')
    .option('--offset <number>', 'Skip first N results', '0')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { listCommand } = await import('./ls.js');
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
 * Registers the 'set' subcommand (update user)
 */
function registerSetCommand(parent: Command): void {
  parent
    .command('set <user-id>')
    .description('Update user properties')
    .option('--roles <roles>', 'Comma-separated roles (qa_tester, qa_admin, admin)')
    .option('--display-name <name>', 'Display name')
    .option('--sandbox-access <ids>', 'Comma-separated sandbox IDs (replaces existing)')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { updateCommand } = await import('./set.js');
      const globalOpts = parent.optsWithGlobals();
      await updateCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'off' subcommand (disable user)
 */
function registerOffCommand(parent: Command): void {
  parent
    .command('off <user-id>')
    .description('Disable a user account')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { disableCommand } = await import('./off.js');
      const globalOpts = parent.optsWithGlobals();
      await disableCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'on' subcommand (enable user)
 */
function registerOnCommand(parent: Command): void {
  parent
    .command('on <user-id>')
    .description('Enable a user account')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { enableCommand } = await import('./on.js');
      const globalOpts = parent.optsWithGlobals();
      await enableCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'rm' subcommand (delete user)
 */
function registerRmCommand(parent: Command): void {
  parent
    .command('rm <user-id>')
    .description('Delete a user account (admin only)')
    .option('--force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { deleteCommand } = await import('./rm.js');
      const globalOpts = parent.optsWithGlobals();
      await deleteCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'passwd' subcommand (reset password)
 */
function registerPasswdCommand(parent: Command): void {
  parent
    .command('passwd <user-id>')
    .description('Reset user password (generates new password)')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { resetPasswordCommand } = await import('./passwd.js');
      const globalOpts = parent.optsWithGlobals();
      await resetPasswordCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'access' subcommand (list user's sandboxes)
 */
function registerAccessCommand(parent: Command): void {
  parent
    .command('access <user-id>')
    .description('List user\'s sandbox access')
    .option('--json', 'Output as JSON')
    .action(async (userId, options) => {
      const { sandboxesCommand } = await import('./access.js');
      const globalOpts = parent.optsWithGlobals();
      await sandboxesCommand({ userId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'grant' subcommand (grant sandbox access)
 */
function registerGrantCommand(parent: Command): void {
  parent
    .command('grant <user-id> <sandbox-id>')
    .description('Grant user access to a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (userId, sandboxId, options) => {
      const { grantSandboxCommand } = await import('./grant.js');
      const globalOpts = parent.optsWithGlobals();
      await grantSandboxCommand({ userId, sandboxId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'revoke' subcommand (revoke sandbox access)
 */
function registerRevokeCommand(parent: Command): void {
  parent
    .command('revoke <user-id> <sandbox-id>')
    .description('Revoke user access from a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (userId, sandboxId, options) => {
      const { revokeSandboxCommand } = await import('./revoke.js');
      const globalOpts = parent.optsWithGlobals();
      await revokeSandboxCommand({ userId, sandboxId, ...options, server: globalOpts.server, quiet: globalOpts.quiet });
    });
}

// =============================================================================
// Exports
// =============================================================================

export { createUserCommand as default };
