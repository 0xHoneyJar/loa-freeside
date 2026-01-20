#!/usr/bin/env node
/**
 * gaib CLI - Arrakis Developer CLI
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 90: CLI Rename (bd → gaib)
 * Sprint 148: CLI Ergonomics - Typo Detection
 *
 * Entry point for the `gaib` command.
 *
 * Named after "Lisan al-Gaib" (Voice from the Outer World) from Dune,
 * reflecting Arrakis's Dune-inspired naming and the CLI's role in
 * managing sandboxed (isolated/hidden) Discord servers.
 *
 * @module packages/cli/bin/gaib
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerCommands } from '../commands/index.js';

/**
 * Calculate Levenshtein distance between two strings
 * Used for typo detection / did-you-mean suggestions
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Find closest matching command names for typo suggestions
 */
function findSimilarCommands(input: string, commands: string[], maxDistance = 2): string[] {
  return commands
    .map((cmd) => ({ cmd, distance: levenshtein(input.toLowerCase(), cmd.toLowerCase()) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .map(({ cmd }) => cmd);
}

/**
 * Get all available top-level command names from program
 */
function getCommandNames(program: Command): string[] {
  return program.commands.map((cmd) => cmd.name());
}

const program = new Command();

program
  .name('gaib')
  .description('Arrakis Developer CLI - Manage sandboxes, workers, and events')
  .version('0.1.0');

// Register all command groups
registerCommands(program);

// Sprint 148: Handle unknown commands with typo suggestions
program.on('command:*', (operands: string[]) => {
  const unknownCommand = operands[0];
  const availableCommands = getCommandNames(program);
  const suggestions = findSimilarCommands(unknownCommand, availableCommands);

  console.error(chalk.red(`error: unknown command '${unknownCommand}'`));

  if (suggestions.length > 0) {
    console.error();
    console.error(chalk.yellow('Did you mean one of these?'));
    suggestions.forEach((cmd) => {
      console.error(`  ${chalk.cyan(cmd)}`);
    });
  }

  console.error();
  console.error(`Run ${chalk.cyan('gaib --help')} for a list of available commands.`);
  process.exit(1);
});

// Parse arguments
program.parse();
