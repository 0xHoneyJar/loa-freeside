/**
 * CLI Commands Registry
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Registers all command groups with the main program.
 *
 * @module packages/cli/commands
 */

import type { Command } from 'commander';
import { createSandboxCommand } from './sandbox/index.js';

/**
 * Registers all command groups with the program
 *
 * @param program - Commander program instance
 */
export function registerCommands(program: Command): void {
  // Register sandbox command group
  program.addCommand(createSandboxCommand());

  // Future command groups can be added here:
  // program.addCommand(createWorkersCommand());
  // program.addCommand(createEventsCommand());
}

export { createSandboxCommand };
