/**
 * CLI Commands Registry
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 93: Discord Infrastructure-as-Code - CLI Commands & Polish
 * Sprint 141: Gom Jabbar - CLI Authentication Commands
 *
 * Registers all command groups with the main program.
 *
 * @module packages/cli/commands
 */

import type { Command } from 'commander';
import { createSandboxCommand } from './sandbox/index.js';
import { createServerCommand } from './server/index.js';
import { createAuthCommand } from './auth/index.js';
import { createUserCommand } from './user/index.js';

/**
 * Registers all command groups with the program
 *
 * @param program - Commander program instance
 */
export function registerCommands(program: Command): void {
  // Register auth command group
  // Sprint 141: Gom Jabbar - CLI Authentication
  program.addCommand(createAuthCommand());

  // Register user command group
  // Sprint 142: Gom Jabbar - CLI User Management
  program.addCommand(createUserCommand());

  // Register sandbox command group
  program.addCommand(createSandboxCommand());

  // Register server (IaC) command group
  // Sprint 93: Infrastructure-as-Code for Discord servers
  program.addCommand(createServerCommand());
}

export { createSandboxCommand, createServerCommand, createAuthCommand, createUserCommand };
