/**
 * Server Teardown Command
 *
 * DANGEROUS: Destroys ALL Discord server resources (roles, categories, channels).
 * This command is designed for resetting test/sandbox servers only.
 *
 * Safety measures:
 * 1. Explicit --confirm-teardown flag required
 * 2. Server name must be typed exactly
 * 3. Random 6-digit confirmation code must be entered
 * 4. Final "TEARDOWN" keyword confirmation
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/teardown
 */

import chalk from 'chalk';
import * as readline from 'readline';
import {
  getGuildId,
  getDiscordToken,
  formatWarning,
  formatSuccess,
  formatInfo,
  handleError,
  ExitCodes,
} from './utils.js';
import { createClientFromEnv, DiscordClient } from './iac/index.js';
import type { Snowflake } from './iac/types.js';

/**
 * Options for the teardown command
 */
export interface TeardownOptions {
  guild?: string;
  json?: boolean;
  quiet?: boolean;
  confirmTeardown?: boolean;
  dryRun?: boolean;
  preserveCategories?: string[];
  /** Skip interactive prompts (requires --confirm-teardown and --json) */
  force?: boolean;
}

/**
 * Resources discovered on the server
 */
interface ServerResources {
  serverName: string;
  roles: Array<{ id: string; name: string; managed: boolean; isEveryone: boolean }>;
  categories: Array<{ id: string; name: string }>;
  channels: Array<{ id: string; name: string; parentId?: string | null }>;
}

/**
 * Generates a random 6-digit confirmation code
 */
function generateConfirmationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Fetches all deletable resources from the server
 */
async function fetchServerResources(
  client: DiscordClient,
  guildId: Snowflake
): Promise<ServerResources> {
  const data = await client.fetchGuildData(guildId);

  return {
    serverName: data.guild.name,
    roles: data.roles.map((r) => ({
      id: r.id,
      name: r.name,
      managed: r.managed,
      isEveryone: r.id === guildId, // @everyone role has same ID as guild
    })),
    categories: data.channels
      .filter((c) => c.type === 4) // GuildCategory = 4
      .map((c) => ({
        id: c.id,
        name: c.name ?? 'Unknown',
      })),
    channels: data.channels
      .filter((c) => c.type !== 4) // Not categories
      .map((c) => ({
        id: c.id,
        name: c.name ?? 'Unknown',
        parentId: 'parent_id' in c ? c.parent_id : null,
      })),
  };
}

/**
 * Four-stage confirmation for teardown operations
 *
 * Stage 1: Verify --confirm-teardown flag was passed
 * Stage 2: Type the server name exactly
 * Stage 3: Enter a random 6-digit confirmation code
 * Stage 4: Type "TEARDOWN" to execute
 */
async function confirmTeardown(
  serverName: string,
  resources: ServerResources,
  hasConfirmFlag: boolean
): Promise<boolean> {
  // Stage 1: Check flag
  if (!hasConfirmFlag) {
    console.log(
      chalk.red.bold('\n🚨 TEARDOWN BLOCKED: Missing required --confirm-teardown flag\n')
    );
    console.log(chalk.yellow('This command will PERMANENTLY DELETE:'));
    console.log(chalk.yellow(`  • ${resources.roles.filter((r) => !r.managed && !r.isEveryone).length} roles`));
    console.log(chalk.yellow(`  • ${resources.categories.length} categories`));
    console.log(chalk.yellow(`  • ${resources.channels.length} channels\n`));
    console.log(chalk.dim('To proceed, add the --confirm-teardown flag:\n'));
    console.log(chalk.cyan('  gaib server teardown --guild <id> --confirm-teardown\n'));
    return false;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  };

  try {
    // Display warning banner
    console.log(chalk.bgRed.white.bold('\n' + '═'.repeat(70)));
    console.log(chalk.bgRed.white.bold('  ⚠️  DANGER: COMPLETE SERVER TEARDOWN  ⚠️'.padEnd(69) + ' '));
    console.log(chalk.bgRed.white.bold('═'.repeat(70) + '\n'));

    console.log(chalk.red.bold('This operation will PERMANENTLY DELETE:\n'));
    console.log(chalk.red(`  🔴 ${resources.roles.filter((r) => !r.managed && !r.isEveryone).length} roles (excluding bot-managed and @everyone)`));
    console.log(chalk.red(`  🔴 ${resources.categories.length} categories`));
    console.log(chalk.red(`  🔴 ${resources.channels.length} channels`));
    console.log(chalk.red.bold('\n  ⚠️  THIS CANNOT BE UNDONE! ALL DATA WILL BE LOST!\n'));

    // Stage 2: Type server name
    console.log(chalk.yellow('─'.repeat(50)));
    console.log(chalk.yellow.bold('CONFIRMATION STEP 1 of 3'));
    console.log(chalk.yellow('─'.repeat(50)));
    console.log(chalk.white(`\nServer name: ${chalk.cyan.bold(serverName)}\n`));

    const nameAnswer = await askQuestion(
      chalk.yellow('Type the server name exactly to continue: ')
    );

    if (nameAnswer !== serverName) {
      console.log(chalk.red('\n❌ Server name does not match. Teardown cancelled.\n'));
      return false;
    }

    console.log(chalk.green('✓ Server name confirmed\n'));

    // Stage 3: Enter confirmation code
    const confirmCode = generateConfirmationCode();
    console.log(chalk.yellow('─'.repeat(50)));
    console.log(chalk.yellow.bold('CONFIRMATION STEP 2 of 3'));
    console.log(chalk.yellow('─'.repeat(50)));
    console.log(chalk.white(`\nEnter this code to continue: ${chalk.cyan.bold(confirmCode)}\n`));

    const codeAnswer = await askQuestion(
      chalk.yellow('Enter the 6-digit code: ')
    );

    if (codeAnswer !== confirmCode) {
      console.log(chalk.red('\n❌ Code does not match. Teardown cancelled.\n'));
      return false;
    }

    console.log(chalk.green('✓ Code confirmed\n'));

    // Stage 4: Type TEARDOWN
    console.log(chalk.yellow('─'.repeat(50)));
    console.log(chalk.yellow.bold('FINAL CONFIRMATION (3 of 3)'));
    console.log(chalk.yellow('─'.repeat(50)));
    console.log(
      chalk.red.bold('\n⚠️  Last chance to cancel! After this, all resources will be deleted.\n')
    );

    const teardownAnswer = await askQuestion(
      chalk.red.bold('Type "TEARDOWN" in all caps to execute: ')
    );

    if (teardownAnswer !== 'TEARDOWN') {
      console.log(chalk.red('\n❌ Confirmation failed. Teardown cancelled.\n'));
      return false;
    }

    console.log(chalk.green('\n✓ All confirmations passed\n'));
    return true;
  } finally {
    rl.close();
  }
}

/**
 * Executes the teardown, deleting all resources
 */
async function executeTeardown(
  client: DiscordClient,
  guildId: Snowflake,
  resources: ServerResources,
  options: TeardownOptions
): Promise<{
  success: boolean;
  deleted: { roles: number; categories: number; channels: number };
  failed: { roles: number; categories: number; channels: number };
  errors: string[];
}> {
  const result = {
    success: true,
    deleted: { roles: 0, categories: 0, channels: 0 },
    failed: { roles: 0, categories: 0, channels: 0 },
    errors: [] as string[],
  };

  const log = (message: string) => {
    if (!options.quiet && !options.json) {
      console.log(message);
    }
  };

  // Delete channels first (they depend on categories)
  log(chalk.bold('\n🗑️  Deleting channels...\n'));
  for (const channel of resources.channels) {
    try {
      if (options.dryRun) {
        log(`  ${chalk.yellow('○')} [DRY RUN] Would delete channel: ${channel.name}`);
        result.deleted.channels++;
      } else {
        await client.deleteChannel(channel.id);
        log(`  ${chalk.green('✓')} Deleted channel: ${channel.name}`);
        result.deleted.channels++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`  ${chalk.red('✗')} Failed to delete channel ${channel.name}: ${msg}`);
      result.failed.channels++;
      result.errors.push(`channel/${channel.name}: ${msg}`);
      result.success = false;
    }
  }

  // Delete categories
  log(chalk.bold('\n🗑️  Deleting categories...\n'));
  for (const category of resources.categories) {
    // Check if category should be preserved
    if (options.preserveCategories?.includes(category.name)) {
      log(`  ${chalk.blue('○')} Preserved category: ${category.name}`);
      continue;
    }

    try {
      if (options.dryRun) {
        log(`  ${chalk.yellow('○')} [DRY RUN] Would delete category: ${category.name}`);
        result.deleted.categories++;
      } else {
        await client.deleteChannel(category.id); // Categories are deleted via channel API
        log(`  ${chalk.green('✓')} Deleted category: ${category.name}`);
        result.deleted.categories++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`  ${chalk.red('✗')} Failed to delete category ${category.name}: ${msg}`);
      result.failed.categories++;
      result.errors.push(`category/${category.name}: ${msg}`);
      result.success = false;
    }
  }

  // Delete roles (skip managed and @everyone)
  log(chalk.bold('\n🗑️  Deleting roles...\n'));
  const deletableRoles = resources.roles.filter((r) => !r.managed && !r.isEveryone);
  for (const role of deletableRoles) {
    try {
      if (options.dryRun) {
        log(`  ${chalk.yellow('○')} [DRY RUN] Would delete role: ${role.name}`);
        result.deleted.roles++;
      } else {
        await client.deleteRole(guildId, role.id);
        log(`  ${chalk.green('✓')} Deleted role: ${role.name}`);
        result.deleted.roles++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log(`  ${chalk.red('✗')} Failed to delete role ${role.name}: ${msg}`);
      result.failed.roles++;
      result.errors.push(`role/${role.name}: ${msg}`);
      result.success = false;
    }
  }

  return result;
}

/**
 * Executes the teardown command
 *
 * DANGEROUS: Destroys ALL Discord server resources.
 *
 * @param options - Command options
 */
export async function teardownCommand(options: TeardownOptions): Promise<void> {
  // Validate environment
  getDiscordToken();

  // Get guild ID
  const guildId = getGuildId(options);
  if (!guildId) {
    throw Object.assign(
      new Error(
        'Guild ID is required. Either:\n' +
          '  - Pass --guild <id> option\n' +
          '  - Set DISCORD_GUILD_ID environment variable'
      ),
      { code: 'MISSING_GUILD_ID' }
    );
  }

  try {
    // Create client and fetch resources
    const client = createClientFromEnv();

    if (!options.quiet && !options.json) {
      formatInfo(`Fetching server resources for guild ${guildId}...`);
    }

    const resources = await fetchServerResources(client, guildId);

    if (!options.quiet && !options.json) {
      formatInfo(`Server: ${resources.serverName}`);
    }

    // Check if there's anything to delete
    const deletableRoles = resources.roles.filter((r) => !r.managed && !r.isEveryone);
    const totalResources =
      deletableRoles.length + resources.categories.length + resources.channels.length;

    if (totalResources === 0) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              guildId,
              serverName: resources.serverName,
              message: 'No resources to delete.',
            },
            null,
            2
          )
        );
      } else if (!options.quiet) {
        console.log(chalk.green('\n✓ Server is already empty. Nothing to teardown.\n'));
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Dry run mode - show what would be deleted
    if (options.dryRun && !options.confirmTeardown) {
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              dryRun: true,
              guildId,
              serverName: resources.serverName,
              wouldDelete: {
                roles: deletableRoles.map((r) => ({ id: r.id, name: r.name })),
                categories: resources.categories,
                channels: resources.channels.map((c) => ({ id: c.id, name: c.name })),
              },
              summary: {
                roles: deletableRoles.length,
                categories: resources.categories.length,
                channels: resources.channels.length,
                total: totalResources,
              },
            },
            null,
            2
          )
        );
      } else {
        console.log(chalk.bold.yellow('\n🔍 DRY RUN: Resources that would be deleted\n'));
        console.log(chalk.cyan('Roles:'));
        for (const role of deletableRoles) {
          console.log(`  - ${role.name}`);
        }
        console.log(chalk.cyan('\nCategories:'));
        for (const cat of resources.categories) {
          console.log(`  - ${cat.name}`);
        }
        console.log(chalk.cyan('\nChannels:'));
        for (const channel of resources.channels) {
          console.log(`  - ${channel.name}`);
        }
        console.log(
          chalk.dim(`\nTotal: ${totalResources} resources would be deleted\n`)
        );
        console.log(chalk.dim('To execute, add --confirm-teardown flag.\n'));
      }
      process.exit(ExitCodes.SUCCESS);
    }

    // Require confirmation (unless --force with --json and --confirm-teardown)
    const skipInteractive = options.force && options.json && options.confirmTeardown;

    if (!skipInteractive && !options.json) {
      const confirmed = await confirmTeardown(
        resources.serverName,
        resources,
        options.confirmTeardown ?? false
      );

      if (!confirmed) {
        process.exit(ExitCodes.SUCCESS);
      }
    } else if (!options.confirmTeardown) {
      // JSON mode still requires --confirm-teardown
      console.log(
        JSON.stringify(
          {
            success: false,
            error: 'Missing --confirm-teardown flag. This flag is required for teardown operations.',
            guildId,
            serverName: resources.serverName,
          },
          null,
          2
        )
      );
      process.exit(ExitCodes.VALIDATION_ERROR);
    }

    // Execute teardown
    if (!options.quiet && !options.json) {
      console.log(chalk.bold.red('\n🔥 EXECUTING TEARDOWN...\n'));
    }

    const result = await executeTeardown(client, guildId, resources, options);

    // Output results
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            success: result.success,
            guildId,
            serverName: resources.serverName,
            dryRun: options.dryRun ?? false,
            deleted: result.deleted,
            failed: result.failed,
            errors: result.errors,
          },
          null,
          2
        )
      );
    } else if (!options.quiet) {
      console.log('');

      if (result.success) {
        formatSuccess('Teardown complete!', {
          rolesDeleted: result.deleted.roles,
          categoriesDeleted: result.deleted.categories,
          channelsDeleted: result.deleted.channels,
        });
      } else {
        formatWarning('Teardown completed with errors.');
        console.log(chalk.dim(`  Deleted: ${result.deleted.roles} roles, ${result.deleted.categories} categories, ${result.deleted.channels} channels`));
        console.log(chalk.dim(`  Failed: ${result.failed.roles} roles, ${result.failed.categories} categories, ${result.failed.channels} channels`));

        if (result.errors.length > 0) {
          console.log(chalk.red('\nErrors:'));
          for (const err of result.errors) {
            console.log(chalk.red(`  - ${err}`));
          }
        }
      }

      console.log('');
    }

    process.exit(result.success ? ExitCodes.SUCCESS : ExitCodes.PARTIAL_FAILURE);
  } catch (error) {
    handleError(error, options.json);
  }
}
