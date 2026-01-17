#!/usr/bin/env node
/**
 * bd CLI - Arrakis Developer CLI
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 *
 * Entry point for the `bd` command.
 *
 * @module packages/cli/bin/bd
 */

import { Command } from 'commander';
import { registerCommands } from '../commands/index.js';

const program = new Command();

program
  .name('bd')
  .description('Arrakis Developer CLI - Manage sandboxes, workers, and events')
  .version('0.1.0');

// Register all command groups
registerCommands(program);

// Parse arguments
program.parse();
