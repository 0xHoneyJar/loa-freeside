/**
 * Workspace Command
 *
 * Sprint 97: Workspace Management
 *
 * Manages workspaces for environment isolation (dev/staging/prod).
 * Each workspace has its own state file, enabling different configurations
 * for different environments.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.2
 * @module packages/cli/commands/server/workspace
 */

import chalk from 'chalk';
import { createWorkspaceManager, WorkspaceError, DEFAULT_WORKSPACE } from './iac/WorkspaceManager.js';
import type { WorkspaceInfo } from './iac/WorkspaceManager.js';

// ============================================================================
// Types
// ============================================================================

interface WorkspaceListOptions {
  json?: boolean;
  quiet?: boolean;
}

interface WorkspaceNewOptions {
  json?: boolean;
  quiet?: boolean;
}

interface WorkspaceSelectOptions {
  create?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface WorkspaceShowOptions {
  json?: boolean;
  quiet?: boolean;
}

interface WorkspaceDeleteOptions {
  force?: boolean;
  yes?: boolean;
  json?: boolean;
  quiet?: boolean;
}

// ============================================================================
// Commands
// ============================================================================

/**
 * List all workspaces
 *
 * @example
 * ```
 * $ gaib server workspace list
 * * default     (0 resources)
 *   staging     (5 resources)
 *   production  (12 resources)
 * ```
 */
export async function workspaceListCommand(options: WorkspaceListOptions = {}): Promise<void> {
  const manager = await createWorkspaceManager();

  try {
    const workspaces = await manager.list();

    if (options.json) {
      console.log(JSON.stringify({ workspaces }, null, 2));
      return;
    }

    if (workspaces.length === 0) {
      if (!options.quiet) {
        console.log(chalk.yellow('No workspaces found. Use "gaib server workspace new <name>" to create one.'));
      }
      return;
    }

    if (!options.quiet) {
      console.log(chalk.bold('Workspaces:'));
      console.log();
    }

    for (const ws of workspaces) {
      const marker = ws.current ? chalk.green('* ') : '  ';
      const name = ws.current ? chalk.green.bold(ws.name) : ws.name;
      const resources = chalk.dim(`(${ws.resourceCount} resources)`);
      console.log(`${marker}${name.padEnd(20)} ${resources}`);
    }

    if (!options.quiet) {
      console.log();
      console.log(chalk.dim(`Current workspace: ${workspaces.find(w => w.current)?.name ?? DEFAULT_WORKSPACE}`));
    }
  } finally {
    await manager.getBackend().close();
  }
}

/**
 * Create a new workspace
 *
 * @example
 * ```
 * $ gaib server workspace new staging
 * Created and switched to workspace "staging".
 * ```
 */
export async function workspaceNewCommand(name: string, options: WorkspaceNewOptions = {}): Promise<void> {
  const manager = await createWorkspaceManager();

  try {
    const workspace = await manager.create(name, { switchTo: true });

    if (options.json) {
      console.log(JSON.stringify({ workspace, message: `Created and switched to workspace "${name}"` }, null, 2));
      return;
    }

    if (!options.quiet) {
      console.log(chalk.green(`Created and switched to workspace "${chalk.bold(name)}".`));
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message, code: error.code }, null, 2));
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  } finally {
    await manager.getBackend().close();
  }
}

/**
 * Select (switch to) a workspace
 *
 * @example
 * ```
 * $ gaib server workspace select staging
 * Switched to workspace "staging".
 *
 * $ gaib server workspace select new-env --create
 * Created and switched to workspace "new-env".
 * ```
 */
export async function workspaceSelectCommand(name: string, options: WorkspaceSelectOptions = {}): Promise<void> {
  const manager = await createWorkspaceManager();

  try {
    const workspace = await manager.select(name, { create: options.create });

    if (options.json) {
      const message = options.create && workspace.resourceCount === 0
        ? `Created and switched to workspace "${name}"`
        : `Switched to workspace "${name}"`;
      console.log(JSON.stringify({ workspace, message }, null, 2));
      return;
    }

    if (!options.quiet) {
      console.log(chalk.green(`Switched to workspace "${chalk.bold(name)}".`));
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message, code: error.code }, null, 2));
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  } finally {
    await manager.getBackend().close();
  }
}

/**
 * Show workspace details
 *
 * @example
 * ```
 * $ gaib server workspace show
 * Workspace: default
 * Current:   yes
 * Backend:   local
 * Resources: 5
 * Serial:    12
 * Modified:  2024-01-15T10:30:00Z
 *
 * $ gaib server workspace show staging
 * Workspace: staging
 * Current:   no
 * Backend:   s3
 * Resources: 8
 * Serial:    24
 * Modified:  2024-01-15T14:20:00Z
 * ```
 */
export async function workspaceShowCommand(name?: string, options: WorkspaceShowOptions = {}): Promise<void> {
  const manager = await createWorkspaceManager();

  try {
    const workspace = await manager.show(name);

    if (options.json) {
      console.log(JSON.stringify({ workspace }, null, 2));
      return;
    }

    console.log(`${chalk.bold('Workspace:')}  ${workspace.current ? chalk.green(workspace.name) : workspace.name}`);
    console.log(`${chalk.bold('Current:')}    ${workspace.current ? chalk.green('yes') : 'no'}`);
    console.log(`${chalk.bold('Backend:')}    ${workspace.backend}`);
    console.log(`${chalk.bold('Resources:')}  ${workspace.resourceCount}`);
    console.log(`${chalk.bold('Serial:')}     ${workspace.serial}`);
    console.log(`${chalk.bold('Modified:')}   ${workspace.lastModified ?? chalk.dim('never')}`);
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message, code: error.code }, null, 2));
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  } finally {
    await manager.getBackend().close();
  }
}

/**
 * Delete a workspace
 *
 * @example
 * ```
 * $ gaib server workspace delete staging
 * Type "staging" to confirm deletion: staging
 * Deleted workspace "staging".
 *
 * $ gaib server workspace delete staging --force
 * Deleted workspace "staging" (had 5 resources).
 * ```
 */
export async function workspaceDeleteCommand(
  name: string,
  options: WorkspaceDeleteOptions = {},
  confirmFn?: () => Promise<boolean>
): Promise<void> {
  const manager = await createWorkspaceManager();

  try {
    // Get workspace info before deletion for reporting
    let workspace: WorkspaceInfo;
    try {
      workspace = await manager.show(name);
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'WORKSPACE_NOT_FOUND') {
        if (options.json) {
          console.log(JSON.stringify({ error: error.message, code: error.code }, null, 2));
          process.exit(1);
        }
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }
      throw error;
    }

    // Require confirmation unless --yes flag
    if (!options.yes && !options.json) {
      // Use provided confirm function or default stdin
      const confirmed = confirmFn
        ? await confirmFn()
        : await confirmDeletion(name);

      if (!confirmed) {
        console.log(chalk.yellow('Deletion cancelled.'));
        return;
      }
    }

    await manager.delete(name, { force: options.force });

    if (options.json) {
      console.log(JSON.stringify({
        message: `Deleted workspace "${name}"`,
        resourcesDeleted: workspace.resourceCount,
      }, null, 2));
      return;
    }

    if (!options.quiet) {
      if (workspace.resourceCount > 0 && options.force) {
        console.log(chalk.green(`Deleted workspace "${chalk.bold(name)}" (had ${workspace.resourceCount} resources).`));
      } else {
        console.log(chalk.green(`Deleted workspace "${chalk.bold(name)}".`));
      }
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message, code: error.code }, null, 2));
        process.exit(1);
      }
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
    throw error;
  } finally {
    await manager.getBackend().close();
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Prompt user to confirm workspace deletion
 */
async function confirmDeletion(workspaceName: string): Promise<boolean> {
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      chalk.yellow(`Type "${workspaceName}" to confirm deletion: `),
      (answer) => {
        rl.close();
        resolve(answer.trim() === workspaceName);
      }
    );
  });
}

// ============================================================================
// Formatters for JSON output
// ============================================================================

/**
 * Format workspace list for JSON output
 */
export function formatWorkspaceListJson(workspaces: WorkspaceInfo[]): string {
  return JSON.stringify({ workspaces }, null, 2);
}

/**
 * Format single workspace for JSON output
 */
export function formatWorkspaceJson(workspace: WorkspaceInfo): string {
  return JSON.stringify({ workspace }, null, 2);
}
