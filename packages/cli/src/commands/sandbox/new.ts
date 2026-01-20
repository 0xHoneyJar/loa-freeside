/**
 * Create Command - gaib sandbox create
 *
 * Sprint 85: Discord Server Sandboxes - CLI Commands
 * Sprint 90: CLI Rename (bd → gaib)
 *
 * Creates a new sandbox environment for isolated Discord testing.
 *
 * @see SDD §6.1 Create Command
 * @module packages/cli/commands/sandbox/create
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  getSandboxManager,
  getCurrentUser,
  parseTTL,
  formatDate,
  formatDuration,
  timeUntil,
  handleError,
  createSilentLogger,
  isInteractive,
  showNextStep,
} from './utils.js';

/**
 * Options for create command
 */
export interface CreateCommandOptions {
  ttl: string;
  guild?: string;
  json?: boolean;
  quiet?: boolean;
  dryRun?: boolean;
}

/**
 * Executes the create command
 *
 * @param name - Optional sandbox name (auto-generated if not provided)
 * @param options - Command options
 */
export async function createCommand(
  name: string | undefined,
  options: CreateCommandOptions
): Promise<void> {
  // Only show spinner in interactive TTY mode, not in quiet mode (Sprint 88: clig.dev compliance)
  const spinner = isInteractive() && !options.json && !options.quiet
    ? ora('Creating sandbox...').start()
    : null;

  try {
    // Parse TTL
    const ttlHours = parseTTL(options.ttl);
    const owner = getCurrentUser();

    // Sprint 88: Dry-run mode - show what would be created without doing it
    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({
          dryRun: true,
          wouldCreate: {
            name: name || '(auto-generated)',
            owner,
            ttlHours,
            guildIds: options.guild ? [options.guild] : [],
          },
        }, null, 2));
      } else {
        console.log(chalk.yellow('DRY RUN - No changes will be made'));
        console.log();
        console.log('Would create sandbox:');
        console.log(`  Name:   ${chalk.cyan(name || '(auto-generated)')}`);
        console.log(`  Owner:  ${owner}`);
        console.log(`  TTL:    ${ttlHours} hours`);
        if (options.guild) {
          console.log(`  Guild:  ${options.guild}`);
        }
      }
      process.exit(0);
    }

    const logger = createSilentLogger();
    const manager = getSandboxManager(logger);

    // Create sandbox
    const result = await manager.create({
      name,
      owner,
      ttlHours,
      guildIds: options.guild ? [options.guild] : [],
      metadata: {
        createdFrom: 'cli',
        createdBy: owner,
        ttlHours,
      },
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            sandbox: {
              id: result.sandbox.id,
              name: result.sandbox.name,
              owner: result.sandbox.owner,
              status: result.sandbox.status,
              schemaName: result.sandbox.schemaName,
              createdAt: result.sandbox.createdAt.toISOString(),
              expiresAt: result.sandbox.expiresAt.toISOString(),
              guildIds: result.sandbox.guildIds,
            },
            schema: result.schema,
            durationMs: result.durationMs,
          },
          null,
          2
        )
      );
    } else if (options.quiet) {
      // Sprint 88: Quiet mode - only output essential info (sandbox name)
      console.log(result.sandbox.name);
    } else {
      spinner?.succeed(chalk.green('Sandbox created successfully!'));
      console.log();
      console.log(chalk.bold('Sandbox Details:'));
      console.log(`  ID:      ${result.sandbox.id}`);
      console.log(`  Name:    ${chalk.cyan(result.sandbox.name)}`);
      console.log(`  Owner:   ${result.sandbox.owner}`);
      console.log(`  Status:  ${chalk.green(result.sandbox.status)}`);
      console.log(`  Schema:  ${result.sandbox.schemaName}`);
      console.log(`  Created: ${formatDate(result.sandbox.createdAt)}`);
      console.log(`  Expires: ${formatDate(result.sandbox.expiresAt)} (${formatDuration(timeUntil(result.sandbox.expiresAt))})`);

      if (result.sandbox.guildIds.length > 0) {
        console.log(`  Guilds:  ${result.sandbox.guildIds.join(', ')}`);
      }

      console.log();
      console.log(chalk.dim('To connect workers to this sandbox:'));
      console.log(chalk.dim(`  eval $(gaib sandbox env ${result.sandbox.name})`));

      // Sprint 148: Next-step suggestion
      showNextStep(
        `gaib sandbox env ${result.sandbox.name}`,
        'Get connection environment variables',
        options
      );
    }
  } catch (error) {
    spinner?.fail(chalk.red('Failed to create sandbox'));
    handleError(error, options.json);
  }
}
