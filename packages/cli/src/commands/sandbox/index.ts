/**
 * Sandbox Command Group
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 86: Discord Server Sandboxes - Event Routing
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Registers the `bd sandbox` command group with all subcommands.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/sandbox
 */

import { Command } from 'commander';

/**
 * Creates the sandbox command group
 *
 * @returns Commander command with all sandbox subcommands
 */
export function createSandboxCommand(): Command {
  const sandbox = new Command('sandbox')
    .description('Manage Discord server sandboxes for isolated testing')
    .addHelpText(
      'after',
      `
Examples:
  $ bd sandbox create                    Create sandbox with defaults (24h TTL)
  $ bd sandbox create --ttl 48h          Create sandbox with 48 hour TTL
  $ bd sandbox create --guild 123456     Create sandbox and register guild
  $ bd sandbox list                      List your running sandboxes
  $ bd sandbox list --all                List all statuses including destroyed
  $ bd sandbox status my-sandbox         Show detailed status and health checks
  $ bd sandbox status my-sandbox --watch Watch status in real-time
  $ bd sandbox destroy my-sandbox        Destroy a sandbox by name
  $ bd sandbox connect my-sandbox        Get connection environment variables
  $ eval $(bd sandbox connect my-sandbox)  Export env vars to shell
  $ bd sandbox register-guild my-sandbox 123456789012345678  Register guild
  $ bd sandbox unregister-guild my-sandbox 123456789012345678  Unregister guild
`
    );

  // Import and register subcommands
  registerCreateCommand(sandbox);
  registerListCommand(sandbox);
  registerDestroyCommand(sandbox);
  registerConnectCommand(sandbox);
  // Sprint 86: Event Routing commands
  registerRegisterGuildCommand(sandbox);
  registerUnregisterGuildCommand(sandbox);
  // Sprint 87: Cleanup & Polish commands
  registerStatusCommand(sandbox);

  return sandbox;
}

/**
 * Registers the 'create' subcommand
 */
function registerCreateCommand(parent: Command): void {
  parent
    .command('create [name]')
    .description('Create a new sandbox environment')
    .option('-t, --ttl <duration>', 'Time-to-live (e.g., 24h, 7d)', '24h')
    .option('-g, --guild <id>', 'Discord guild ID to register')
    .option('--json', 'Output as JSON')
    .action(async (name: string | undefined, options) => {
      const { createCommand } = await import('./create.js');
      await createCommand(name, options);
    });
}

/**
 * Registers the 'list' subcommand
 */
function registerListCommand(parent: Command): void {
  parent
    .command('list')
    .alias('ls')
    .description('List sandboxes')
    .option('-o, --owner <username>', 'Filter by owner (default: current user)')
    .option('-s, --status <status>', 'Filter by status (running, expired, etc.)')
    .option('-a, --all', 'Include all statuses including destroyed')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { listCommand } = await import('./list.js');
      await listCommand(options);
    });
}

/**
 * Registers the 'destroy' subcommand
 */
function registerDestroyCommand(parent: Command): void {
  parent
    .command('destroy <name>')
    .alias('rm')
    .description('Destroy a sandbox')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options) => {
      const { destroyCommand } = await import('./destroy.js');
      await destroyCommand(name, options);
    });
}

/**
 * Registers the 'connect' subcommand
 */
function registerConnectCommand(parent: Command): void {
  parent
    .command('connect <name>')
    .description('Get connection environment variables for a sandbox')
    .option('--json', 'Output as JSON instead of shell exports')
    .action(async (name: string, options) => {
      const { connectCommand } = await import('./connect.js');
      await connectCommand(name, options);
    });
}

/**
 * Registers the 'register-guild' subcommand
 * Sprint 86: Event Routing
 */
function registerRegisterGuildCommand(parent: Command): void {
  parent
    .command('register-guild <sandbox> <guildId>')
    .alias('reg')
    .description('Register a Discord guild to route events to a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (sandbox: string, guildId: string, options) => {
      const { registerCommand } = await import('./register.js');
      await registerCommand(sandbox, guildId, options);
    });
}

/**
 * Registers the 'unregister-guild' subcommand
 * Sprint 86: Event Routing
 */
function registerUnregisterGuildCommand(parent: Command): void {
  parent
    .command('unregister-guild <sandbox> <guildId>')
    .alias('unreg')
    .description('Unregister a Discord guild from a sandbox')
    .option('--json', 'Output as JSON')
    .action(async (sandbox: string, guildId: string, options) => {
      const { unregisterCommand } = await import('./unregister.js');
      await unregisterCommand(sandbox, guildId, options);
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
      await statusCommand(name, {
        ...options,
        interval: parseInt(options.interval, 10),
      });
    });
}

export default createSandboxCommand;
