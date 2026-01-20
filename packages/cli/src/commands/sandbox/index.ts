/**
 * Sandbox Command Group
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 86: Discord Server Sandboxes - Event Routing
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 * Sprint 88: Discord Server Sandboxes - CLI Best Practices Compliance
 * Sprint 90: CLI Rename (bd → gaib)
 * Sprint 146: CLI Ergonomics Refactoring (Crysknife Edge)
 *
 * Registers the `gaib sandbox` command group with all subcommands.
 *
 * @see SDD §6.0 CLI Commands
 * @see grimoires/loa/prd.md §15 Crysknife Edge (CLI Ergonomics)
 * @module packages/cli/commands/sandbox
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { shouldUseColor } from './utils.js';

/**
 * Creates the sandbox command group
 *
 * @returns Commander command with all sandbox subcommands
 */
export function createSandboxCommand(): Command {
  const sandbox = new Command('sandbox')
    .description('Manage Discord server sandboxes for isolated testing')
    // Sprint 88: Color control (clig.dev compliance)
    .option('--no-color', 'Disable colored output')
    .option('-q, --quiet', 'Suppress non-essential output')
    .hook('preAction', (thisCommand) => {
      const opts = thisCommand.optsWithGlobals();
      // Disable colors if --no-color flag, NO_COLOR env, TERM=dumb, or non-TTY
      if (opts.noColor || !shouldUseColor()) {
        chalk.level = 0;
      }
    })
    .addHelpText(
      'after',
      `
Examples:
  $ gaib sandbox new                       Create sandbox with defaults (24h TTL)
  $ gaib sandbox new --ttl 48h             Create sandbox with 48 hour TTL
  $ gaib sandbox new --guild 123456        Create sandbox and register guild
  $ gaib sandbox ls                        List your running sandboxes
  $ gaib sandbox ls --all                  List all statuses including destroyed
  $ gaib sandbox status my-sandbox         Show detailed status and health checks
  $ gaib sandbox status my-sandbox --watch Watch status in real-time
  $ gaib sandbox rm my-sandbox             Destroy a sandbox by name
  $ gaib sandbox env my-sandbox            Get connection environment variables
  $ eval $(gaib sandbox env my-sandbox)    Export env vars to shell
  $ gaib sandbox link my-sandbox 123456789012345678    Register guild
  $ gaib sandbox unlink my-sandbox 123456789012345678  Unregister guild
`
    );

  // Import and register subcommands
  registerNewCommand(sandbox);
  registerLsCommand(sandbox);
  registerRmCommand(sandbox);
  registerEnvCommand(sandbox);
  // Sprint 86: Event Routing commands
  registerLinkCommand(sandbox);
  registerUnlinkCommand(sandbox);
  // Sprint 87: Cleanup & Polish commands
  registerStatusCommand(sandbox);

  return sandbox;
}

/**
 * Registers the 'new' subcommand (create sandbox)
 */
function registerNewCommand(parent: Command): void {
  parent
    .command('new [name]')
    .description('Create a new sandbox environment')
    .option('-t, --ttl <duration>', 'Time-to-live (e.g., 24h, 7d)', '24h')
    .option('-g, --guild <id>', 'Discord guild ID to register')
    .option('--json', 'Output as JSON')
    .option('-n, --dry-run', 'Show what would be created without doing it')
    .action(async (name: string | undefined, options) => {
      const { createCommand } = await import('./new.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await createCommand(name, { ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'ls' subcommand (list sandboxes)
 */
function registerLsCommand(parent: Command): void {
  parent
    .command('ls')
    .description('List sandboxes')
    .option('-o, --owner <username>', 'Filter by owner (default: current user)')
    .option('-s, --status <status>', 'Filter by status (running, expired, etc.)')
    .option('-a, --all', 'Include all statuses including destroyed')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { listCommand } = await import('./ls.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await listCommand({ ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'rm' subcommand (destroy sandbox)
 */
function registerRmCommand(parent: Command): void {
  parent
    .command('rm <name>')
    .description('Destroy a sandbox')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .option('-n, --dry-run', 'Show what would be destroyed without doing it')
    .action(async (name: string, options) => {
      const { destroyCommand } = await import('./rm.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await destroyCommand(name, { ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'env' subcommand (connection environment)
 */
function registerEnvCommand(parent: Command): void {
  parent
    .command('env <name>')
    .description('Get connection environment variables for a sandbox')
    .option('--json', 'Output as JSON instead of shell exports')
    .action(async (name: string, options) => {
      const { connectCommand } = await import('./env.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await connectCommand(name, { ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'link' subcommand (register guild)
 * Sprint 86: Event Routing
 */
function registerLinkCommand(parent: Command): void {
  parent
    .command('link <sandbox> <guildId>')
    .description('Register a Discord guild to route events to a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (sandbox: string, guildId: string, options) => {
      const { registerCommand } = await import('./link.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await registerCommand(sandbox, guildId, { ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'unlink' subcommand (unregister guild)
 * Sprint 86: Event Routing
 */
function registerUnlinkCommand(parent: Command): void {
  parent
    .command('unlink <sandbox> <guildId>')
    .description('Unregister a Discord guild from a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (sandbox: string, guildId: string, options) => {
      const { unregisterCommand } = await import('./unlink.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await unregisterCommand(sandbox, guildId, { ...options, quiet: globalOpts.quiet });
    });
}

/**
 * Registers the 'status' subcommand
 * Sprint 87: Cleanup & Polish
 */
function registerStatusCommand(parent: Command): void {
  parent
    .command('status <name>')
    .description('Show detailed status and health checks for a sandbox')
    .option('--json', 'Output as JSON')
    .option('-w, --watch', 'Watch mode - refresh status periodically')
    .option('-i, --interval <seconds>', 'Refresh interval in seconds (default: 5)', '5')
    .action(async (name: string, options) => {
      const { statusCommand } = await import('./status.js');
      // Merge global options (quiet) with command options
      const globalOpts = parent.optsWithGlobals();
      await statusCommand(name, {
        ...options,
        interval: parseInt(options.interval, 10),
        quiet: globalOpts.quiet,
      });
    });
}

export default createSandboxCommand;
