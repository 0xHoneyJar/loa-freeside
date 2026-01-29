/**
 * Server Command Group
 *
 * Sprint 93: Discord Infrastructure-as-Code - CLI Commands & Polish
 * Sprint 97: Workspace Management
 * Sprint 98: Apply & Destroy Operations
 * Sprint 99: Import & State Commands
 * Sprint 147: CLI Ergonomics Refactoring (Crysknife Edge)
 *
 * Registers the `gaib server` command group with all subcommands.
 * Provides Terraform-like workflow for Discord server configuration.
 *
 * @see SDD §6.0 CLI Commands
 * @see PRD §3.1 Infrastructure-as-Code
 * @see grimoires/loa/prd.md §15 Crysknife Edge (CLI Ergonomics)
 * @module packages/cli/commands/server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { shouldUseColor, handleError } from './utils.js';

/**
 * Creates the server command group
 *
 * @returns Commander command with all server subcommands
 */
export function createServerCommand(): Command {
  const server = new Command('server')
    .description('Infrastructure-as-Code for Discord servers (Terraform-like workflow)')
    // Common options (clig.dev compliance)
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
  $ gaib server init                         Initialize config in current directory
  $ gaib server init --guild 123456789       Initialize with guild ID
  $ gaib server plan                         Preview changes (dry-run)
  $ gaib server plan -f config.yaml          Plan from specific config file
  $ gaib server diff                         Show detailed diff of changes
  $ gaib server diff --json                  Output diff as JSON
  $ gaib server apply                        Apply changes to Discord
  $ gaib server apply --auto-approve         Apply without confirmation
  $ gaib server destroy                      Destroy all managed resources
  $ gaib server teardown --confirm-teardown  DANGEROUS: Delete ALL server resources

Workspace Commands:
  $ gaib server workspace ls                 List all workspaces
  $ gaib server workspace new staging        Create new workspace
  $ gaib server workspace use staging        Switch to workspace
  $ gaib server workspace show               Show current workspace details
  $ gaib server workspace rm staging         Delete a workspace

State Management:
  $ gaib server import <address> <id>        Import existing Discord resource
  $ gaib server state ls                     List all resources in state
  $ gaib server state show <address>         Show resource details
  $ gaib server state rm <address>           Remove resource from state
  $ gaib server state mv <src> <dest>        Rename resource address
  $ gaib server state pull                   Refresh state from Discord
  $ gaib server locks                        Show lock status for workspace
  $ gaib server unlock                       Force release a stuck lock

Theme Commands:
  $ gaib server theme ls                     List available themes
  $ gaib server theme info <name>            Show detailed theme information
`
    );

  // Register subcommands
  registerInitCommand(server);
  registerPlanCommand(server);
  registerDiffCommand(server);
  registerApplyCommand(server);
  registerDestroyCommand(server);
  registerTeardownCommand(server);
  registerExportCommand(server);
  registerWorkspaceCommand(server);
  registerImportCommand(server);
  registerStateCommand(server);
  registerLocksCommand(server);
  registerUnlockCommand(server);
  registerThemeCommand(server);

  // Register hidden aliases for backward compatibility (Sprint 154)
  registerHiddenAliases(server);

  return server;
}

/**
 * Registers the 'init' subcommand
 *
 * Initializes a new server configuration file.
 *
 * @see S-93.2 acceptance criteria
 */
function registerInitCommand(parent: Command): void {
  parent
    .command('init')
    .description('Initialize a new server configuration file')
    .option('-g, --guild <id>', 'Discord guild/server ID')
    .option('-f, --file <path>', 'Output file path', 'discord-server.yaml')
    .option('-t, --theme <name>', 'Use a theme as base configuration')
    .option('--force', 'Overwrite existing configuration file')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { initCommand } = await import('./init.js');
        const globalOpts = parent.optsWithGlobals();
        await initCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'plan' subcommand
 *
 * Shows what changes would be applied without making them.
 * Similar to `terraform plan`.
 *
 * @see S-93.3 acceptance criteria
 */
function registerPlanCommand(parent: Command): void {
  parent
    .command('plan')
    .description('Preview changes without applying them (dry-run)')
    .option('-f, --file <path>', 'Configuration file path', 'discord-server.yaml')
    .option('-g, --guild <id>', 'Override guild ID from config')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .option('--managed-only', 'Only show IaC-managed resources', true)
    .action(async (options) => {
      try {
        const { planCommand } = await import('./plan.js');
        const globalOpts = parent.optsWithGlobals();
        await planCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'diff' subcommand
 *
 * Shows detailed diff between config and current Discord state.
 *
 * @see S-93.4 acceptance criteria
 */
function registerDiffCommand(parent: Command): void {
  parent
    .command('diff')
    .description('Show detailed diff between config and current state')
    .option('-f, --file <path>', 'Configuration file path', 'discord-server.yaml')
    .option('-g, --guild <id>', 'Override guild ID from config')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output diff as JSON')
    .option('--no-permissions', 'Exclude permission changes from diff')
    .option('--managed-only', 'Only show IaC-managed resources', true)
    .action(async (options) => {
      try {
        const { diffCommand } = await import('./diff.js');
        const globalOpts = parent.optsWithGlobals();
        await diffCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'apply' subcommand
 *
 * Applies configuration changes to Discord with state locking.
 * Similar to `terraform apply`.
 *
 * @see Sprint 98: Apply & Destroy Operations
 */
function registerApplyCommand(parent: Command): void {
  parent
    .command('apply')
    .description('Apply configuration changes to Discord')
    .option('-f, --file <path>', 'Configuration file path', 'discord-server.yaml')
    .option('-g, --guild <id>', 'Override guild ID from config')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .option('--auto-approve', 'Skip interactive confirmation')
    .option('--dry-run', 'Show what would be applied without making changes')
    .option('--managed-only', 'Only apply to IaC-managed resources', true)
    .action(async (options) => {
      try {
        const { applyCommand } = await import('./apply.js');
        const globalOpts = parent.optsWithGlobals();
        await applyCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'destroy' subcommand
 *
 * Destroys all managed resources in a workspace.
 * Similar to `terraform destroy`.
 *
 * @see Sprint 98: Apply & Destroy Operations
 */
function registerDestroyCommand(parent: Command): void {
  parent
    .command('destroy')
    .description('Destroy all managed resources in the workspace')
    .option('-g, --guild <id>', 'Discord guild/server ID (required)')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .option('--auto-approve', 'Skip interactive confirmation')
    .option('--dry-run', 'Show what would be destroyed without making changes')
    .option('-t, --target <types...>', 'Target specific resource types (role, category, channel)')
    .action(async (options) => {
      try {
        const { destroyCommand } = await import('./destroy.js');
        const globalOpts = parent.optsWithGlobals();
        await destroyCommand({
          ...options,
          quiet: globalOpts.quiet,
          targetTypes: options.target,
        });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'teardown' subcommand
 *
 * DANGEROUS: Destroys ALL Discord server resources (not just managed ones).
 * Designed for resetting test/sandbox servers only.
 *
 * Safety measures:
 * - Requires explicit --confirm-teardown flag
 * - Server name must be typed exactly
 * - Random 6-digit confirmation code
 * - Final "TEARDOWN" keyword confirmation
 */
function registerTeardownCommand(parent: Command): void {
  parent
    .command('teardown')
    .description('DANGEROUS: Delete ALL server resources (roles, categories, channels)')
    .option('-g, --guild <id>', 'Discord guild/server ID (required)')
    .option('--json', 'Output result as JSON')
    .option('--confirm-teardown', 'Required flag to enable teardown (safety measure)')
    .option('--dry-run', 'Show what would be deleted without making changes')
    .option('--preserve-categories <names...>', 'Category names to preserve (not delete)')
    .option('--force', 'Skip interactive prompts (requires --confirm-teardown and --json)')
    .option('--skip-checkpoint', 'Skip checkpoint creation before teardown (DANGEROUS)')
    .addHelpText(
      'after',
      `
${chalk.red.bold('WARNING: This command is EXTREMELY DANGEROUS!')}

This command will ${chalk.red('PERMANENTLY DELETE')} all:
  - Roles (except bot-managed and @everyone)
  - Categories
  - Channels (text, voice, forum, etc.)

${chalk.yellow('Safety Requirements:')}
  1. You MUST pass --confirm-teardown flag
  2. You MUST type the server name exactly
  3. You MUST enter a random 6-digit confirmation code
  4. You MUST type "TEARDOWN" to execute

${chalk.cyan('Examples:')}
  $ gaib server teardown --guild 123456789 --dry-run
  $ gaib server teardown --guild 123456789 --confirm-teardown
  $ gaib server teardown --guild 123456789 --confirm-teardown --preserve-categories "archived"

${chalk.dim('This command is intended for resetting test/sandbox servers only.')}
`
    )
    .action(async (options) => {
      try {
        const { teardownCommand } = await import('./teardown.js');
        const globalOpts = parent.optsWithGlobals();
        await teardownCommand({
          ...options,
          quiet: globalOpts.quiet,
          preserveCategories: options.preserveCategories,
          force: options.force,
          skipCheckpoint: options.skipCheckpoint,
        });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'export' subcommand
 *
 * Exports current Discord server state to YAML configuration.
 *
 * @see S-93.5 acceptance criteria
 */
function registerExportCommand(parent: Command): void {
  parent
    .command('export')
    .description('Export current Discord server state to YAML')
    .option('-g, --guild <id>', 'Discord guild/server ID (required if not in config)')
    .option('-o, --output <path>', 'Output file path (default: stdout)')
    .option('--json', 'Output as JSON instead of YAML')
    .option('--include-unmanaged', 'Include resources not managed by IaC')
    .action(async (options) => {
      try {
        const { exportCommand } = await import('./export.js');
        const globalOpts = parent.optsWithGlobals();
        await exportCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'workspace' subcommand group (workspace management)
 *
 * Manages workspaces for environment isolation.
 *
 * @see Sprint 97: Workspace Management
 * @see Sprint 154: CLI Noun Clarity (reverted from 'ws' to 'workspace')
 */
function registerWorkspaceCommand(parent: Command): void {
  const workspace = parent
    .command('workspace')
    .description('Manage workspaces for environment isolation');

  // workspace ls (list)
  workspace
    .command('ls')
    .description('List all workspaces')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { workspaceListCommand } = await import('./workspace.js');
        const globalOpts = parent.optsWithGlobals();
        await workspaceListCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // workspace new
  workspace
    .command('new <name>')
    .description('Create a new workspace and switch to it')
    .option('--json', 'Output result as JSON')
    .action(async (name, options) => {
      try {
        const { workspaceNewCommand } = await import('./workspace.js');
        const globalOpts = parent.optsWithGlobals();
        await workspaceNewCommand(name, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // workspace use (was 'select')
  workspace
    .command('use <name>')
    .description('Switch to a workspace')
    .option('-c, --create', 'Create workspace if it does not exist')
    .option('--json', 'Output result as JSON')
    .action(async (name, options) => {
      try {
        const { workspaceSelectCommand } = await import('./workspace.js');
        const globalOpts = parent.optsWithGlobals();
        await workspaceSelectCommand(name, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // workspace show
  workspace
    .command('show [name]')
    .description('Show workspace details (defaults to current workspace)')
    .option('--json', 'Output result as JSON')
    .action(async (name, options) => {
      try {
        const { workspaceShowCommand } = await import('./workspace.js');
        const globalOpts = parent.optsWithGlobals();
        await workspaceShowCommand(name, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // workspace rm (was 'delete')
  workspace
    .command('rm <name>')
    .description('Delete a workspace')
    .option('-f, --force', 'Force delete even if workspace has resources')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output result as JSON')
    .action(async (name, options) => {
      try {
        const { workspaceDeleteCommand } = await import('./workspace.js');
        const globalOpts = parent.optsWithGlobals();
        await workspaceDeleteCommand(name, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'import' subcommand
 *
 * Imports an existing Discord resource into state management.
 *
 * @see Sprint 99: Import & State Commands
 */
function registerImportCommand(parent: Command): void {
  parent
    .command('import <address> <id>')
    .description('Import an existing Discord resource into state')
    .option('-g, --guild <id>', 'Discord guild/server ID (required)')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .action(async (address, resourceId, options) => {
      try {
        const { importCommand } = await import('./import.js');
        const globalOpts = parent.optsWithGlobals();
        await importCommand(address, resourceId, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'state' subcommand group (state management)
 *
 * Provides commands for managing state resources directly.
 *
 * @see Sprint 99: Import & State Commands
 * @see Sprint 154: CLI Noun Clarity (reverted from 'st' to 'state')
 */
function registerStateCommand(parent: Command): void {
  const state = parent
    .command('state')
    .description('Manage state resources directly');

  // state ls (list)
  state
    .command('ls')
    .description('List all resources in state')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { stateListCommand } = await import('./state.js');
        const globalOpts = parent.optsWithGlobals();
        await stateListCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // state show
  state
    .command('show <address>')
    .description('Show detailed information about a resource')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .action(async (address, options) => {
      try {
        const { stateShowCommand } = await import('./state.js');
        const globalOpts = parent.optsWithGlobals();
        await stateShowCommand(address, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // state rm
  state
    .command('rm <address>')
    .description('Remove a resource from state (does not delete from Discord)')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output result as JSON')
    .action(async (address, options) => {
      try {
        const { stateRmCommand } = await import('./state.js');
        const globalOpts = parent.optsWithGlobals();
        await stateRmCommand(address, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // state mv
  state
    .command('mv <source> <destination>')
    .description('Move/rename a resource address in state')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .action(async (source, destination, options) => {
      try {
        const { stateMvCommand } = await import('./state.js');
        const globalOpts = parent.optsWithGlobals();
        await stateMvCommand(source, destination, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // state pull
  state
    .command('pull')
    .description('Refresh state from Discord (updates all resource attributes)')
    .option('-g, --guild <id>', 'Discord guild/server ID (required)')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { statePullCommand } = await import('./state.js');
        const globalOpts = parent.optsWithGlobals();
        await statePullCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'locks' subcommand (was 'lock-status')
 *
 * Shows the current lock status for a workspace.
 *
 * @see Sprint 98: Apply & Destroy Operations
 * @see Sprint 147: CLI Ergonomics (renamed from 'lock-status' to 'locks')
 */
function registerLocksCommand(parent: Command): void {
  parent
    .command('locks')
    .description('Show lock status for the current workspace')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { lockStatusCommand } = await import('./force-unlock.js');
        const globalOpts = parent.optsWithGlobals();
        await lockStatusCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'unlock' subcommand (was 'force-unlock')
 *
 * Manually releases a state lock on a workspace.
 *
 * @see Sprint 98: Apply & Destroy Operations
 * @see Sprint 147: CLI Ergonomics (renamed from 'force-unlock' to 'unlock')
 */
function registerUnlockCommand(parent: Command): void {
  parent
    .command('unlock')
    .description('Force release a stuck state lock (use with caution)')
    .option('-w, --workspace <name>', 'Override current workspace')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { forceUnlockCommand } = await import('./force-unlock.js');
        const globalOpts = parent.optsWithGlobals();
        await forceUnlockCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers the 'theme' subcommand group (theme management)
 *
 * Commands for listing and inspecting themes.
 *
 * @see Sprint 100: Theme System
 * @see Sprint 154: CLI Noun Clarity (reverted from 'th' to 'theme')
 */
function registerThemeCommand(parent: Command): void {
  const theme = parent
    .command('theme')
    .description('Manage Discord server themes');

  // theme ls (list)
  theme
    .command('ls')
    .description('List available themes')
    .option('--json', 'Output result as JSON')
    .action(async (options) => {
      try {
        const { themeListCommand } = await import('./theme.js');
        const globalOpts = parent.optsWithGlobals();
        await themeListCommand({ ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });

  // theme info
  theme
    .command('info <name>')
    .description('Show detailed information about a theme')
    .option('--json', 'Output result as JSON')
    .action(async (name, options) => {
      try {
        const { themeInfoCommand } = await import('./theme.js');
        const globalOpts = parent.optsWithGlobals();
        await themeInfoCommand(name, { ...options, quiet: globalOpts.quiet });
      } catch (error) {
        handleError(error, options.json);
      }
    });
}

/**
 * Registers hidden aliases for backward compatibility
 *
 * Supports abbreviated forms (ws, st, th) that still work but don't appear in help.
 * Displays deprecation warning to stderr when used interactively.
 *
 * @see Sprint 154: CLI Noun Clarity
 */
function registerHiddenAliases(parent: Command): void {
  /**
   * Emit deprecation warning to stderr (TTY only)
   */
  function warnDeprecation(oldName: string, newName: string): void {
    if (process.stderr.isTTY) {
      console.error(
        chalk.yellow(`⚠️  '${oldName}' is deprecated, use '${newName}' instead.`)
      );
    }
  }

  // Hidden 'ws' alias for 'workspace'
  const wsAlias = parent
    .command('ws', { hidden: true })
    .description('Alias for workspace (deprecated)');

  wsAlias.command('ls').action(async (options) => {
    warnDeprecation('ws', 'workspace');
    const { workspaceListCommand } = await import('./workspace.js');
    await workspaceListCommand(options);
  });
  wsAlias.command('new <name>').action(async (name, options) => {
    warnDeprecation('ws', 'workspace');
    const { workspaceNewCommand } = await import('./workspace.js');
    await workspaceNewCommand(name, options);
  });
  wsAlias.command('use <name>').action(async (name, options) => {
    warnDeprecation('ws', 'workspace');
    const { workspaceSelectCommand } = await import('./workspace.js');
    await workspaceSelectCommand(name, options);
  });
  wsAlias.command('show [name]').action(async (name, options) => {
    warnDeprecation('ws', 'workspace');
    const { workspaceShowCommand } = await import('./workspace.js');
    await workspaceShowCommand(name, options);
  });
  wsAlias.command('rm <name>').action(async (name, options) => {
    warnDeprecation('ws', 'workspace');
    const { workspaceDeleteCommand } = await import('./workspace.js');
    await workspaceDeleteCommand(name, options);
  });

  // Hidden 'st' alias for 'state'
  const stAlias = parent
    .command('st', { hidden: true })
    .description('Alias for state (deprecated)');

  stAlias.command('ls').action(async (options) => {
    warnDeprecation('st', 'state');
    const { stateListCommand } = await import('./state.js');
    await stateListCommand(options);
  });
  stAlias.command('show <address>').action(async (address, options) => {
    warnDeprecation('st', 'state');
    const { stateShowCommand } = await import('./state.js');
    await stateShowCommand(address, options);
  });
  stAlias.command('rm <address>').action(async (address, options) => {
    warnDeprecation('st', 'state');
    const { stateRmCommand } = await import('./state.js');
    await stateRmCommand(address, options);
  });
  stAlias.command('mv <source> <destination>').action(async (source, destination, options) => {
    warnDeprecation('st', 'state');
    const { stateMvCommand } = await import('./state.js');
    await stateMvCommand(source, destination, options);
  });
  stAlias.command('pull').action(async (options) => {
    warnDeprecation('st', 'state');
    const { statePullCommand } = await import('./state.js');
    await statePullCommand(options);
  });

  // Hidden 'th' alias for 'theme'
  const thAlias = parent
    .command('th', { hidden: true })
    .description('Alias for theme (deprecated)');

  thAlias.command('ls').action(async (options) => {
    warnDeprecation('th', 'theme');
    const { themeListCommand } = await import('./theme.js');
    await themeListCommand(options);
  });
  thAlias.command('info <name>').action(async (name, options) => {
    warnDeprecation('th', 'theme');
    const { themeInfoCommand } = await import('./theme.js');
    await themeInfoCommand(name, options);
  });
}

export default createServerCommand;
