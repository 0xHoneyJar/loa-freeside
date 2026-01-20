/**
 * Auth Command Group
 *
 * Sprint 141: CLI Authentication Commands
 *
 * Registers the `gaib auth` command group with login, logout, and whoami subcommands.
 *
 * @see grimoires/loa/sdd.md §13.3.3 CLI Authentication Commands
 * @see grimoires/loa/prd.md §12 Gom Jabbar
 * @module packages/cli/commands/auth
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
  // Respect NO_COLOR environment variable
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  // Check for dumb terminal
  if (process.env.TERM === 'dumb') {
    return false;
  }

  // Check if stdout is a TTY
  if (!process.stdout.isTTY) {
    return false;
  }

  return true;
}

// =============================================================================
// Auth Command Group
// =============================================================================

/**
 * Creates the auth command group
 *
 * @returns Commander command with all auth subcommands
 */
export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Authentication management for local user accounts')
    .option('--no-color', 'Disable colored output')
    .option('-q, --quiet', 'Suppress non-essential output')
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
  $ gaib auth login                       Interactive login prompt
  $ gaib auth login -u testuser           Login with specified username
  $ gaib auth login --server https://api.example.com  Use custom server
  $ gaib auth logout                      Log out and clear credentials
  $ gaib auth whoami                      Show current authentication status
  $ gaib auth whoami --json               Output status as JSON

Environment:
  GAIB_API_URL   API server URL (default: ${DEFAULT_SERVER_URL})
`
    );

  // Register subcommands
  registerLoginCommand(auth);
  registerLogoutCommand(auth);
  registerWhoamiCommand(auth);

  return auth;
}

/**
 * Registers the 'login' subcommand
 */
function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Log in with username and password')
    .option('-u, --username <username>', 'Username (prompts if not provided)')
    .option('--server <url>', 'API server URL', DEFAULT_SERVER_URL)
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { loginCommand } = await import('./login.js');
      const globalOpts = parent.optsWithGlobals();
      await loginCommand({ ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'logout' subcommand
 */
function registerLogoutCommand(parent: Command): void {
  parent
    .command('logout')
    .description('Log out and clear stored credentials')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { logoutCommand } = await import('./logout.js');
      const globalOpts = parent.optsWithGlobals();
      await logoutCommand({ ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'whoami' subcommand
 */
function registerWhoamiCommand(parent: Command): void {
  parent
    .command('whoami')
    .description('Display current authentication status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { whoamiCommand } = await import('./whoami.js');
      const globalOpts = parent.optsWithGlobals();
      await whoamiCommand({ ...options, quiet: globalOpts.quiet });
    });
}

// =============================================================================
// Exports
// =============================================================================

export { createAuthCommand as default };

// Re-export guards for use by other commands
export {
  requireAuth,
  requireRoles,
  requireSandboxAccess,
  hasRole,
  hasAnyRole,
  canAccessSandbox,
  type UserRole,
} from './guards.js';

// Re-export credential utilities
export {
  loadCredentials,
  storeCredentials,
  clearCredentials,
  hasCredentials,
  isSessionExpired,
  isSessionExpiringSoon,
  getSessionHoursRemaining,
  getCredentialsPath,
  type StoredCredentials,
} from './credentials.js';
