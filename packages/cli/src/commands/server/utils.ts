/**
 * Server CLI Utilities
 *
 * Sprint 93: Discord Infrastructure-as-Code - CLI Commands & Polish
 *
 * Shared utilities for server IaC CLI commands.
 *
 * @see SDD §6.0 CLI Commands
 * @module packages/cli/commands/server/utils
 */

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { ServerDiff, ResourceChange, PermissionChange } from './iac/types.js';

// =============================================================================
// Environment & Configuration
// =============================================================================

/**
 * Gets the Discord bot token from environment
 *
 * Accepts either DISCORD_BOT_TOKEN or DISCORD_TOKEN for flexibility
 *
 * @throws Error if neither DISCORD_BOT_TOKEN nor DISCORD_TOKEN is set
 */
export function getDiscordToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error(
      'Discord bot token not found.\n' +
        'Please set DISCORD_BOT_TOKEN or DISCORD_TOKEN environment variable.'
    );
  }
  return token;
}

/**
 * Discord Snowflake ID validation regex
 * Discord IDs are 17-19 digit integers (snowflakes)
 *
 * Sprint 94 (H-3): Input validation to prevent SSRF and injection attacks
 *
 * @see https://discord.com/developers/docs/reference#snowflakes
 */
const GUILD_ID_REGEX = /^\d{17,19}$/;

/**
 * CLI error codes for sanitized error messages
 *
 * Sprint 94 (H-3): Use error codes instead of detailed messages
 */
export const GuildValidationErrors = {
  INVALID_FORMAT: 'E1001',
  MISSING_GUILD: 'E1002',
} as const;

/**
 * Validates a Discord guild ID (snowflake format)
 *
 * Discord snowflakes are 64-bit integers represented as strings.
 * Valid snowflakes are 17-19 digits long.
 *
 * Sprint 94 (H-3): Guild ID validation to prevent SSRF and injection
 *
 * @param guildId - The guild ID to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * validateGuildId('123456789012345678')  // true
 * validateGuildId('12345')               // false (too short)
 * validateGuildId('abc')                 // false (non-numeric)
 * validateGuildId('123-456')             // false (invalid characters)
 */
export function validateGuildId(guildId: string): boolean {
  return GUILD_ID_REGEX.test(guildId);
}

/**
 * Gets and validates the guild ID from options or config
 *
 * Resolution order:
 * 1. --guild CLI option
 * 2. DISCORD_GUILD_ID environment variable
 *
 * Sprint 94 (H-3): Validates guild ID format to prevent SSRF/injection
 *
 * @param options - CLI options
 * @returns Guild ID or undefined if not provided
 * @throws Error with sanitized error code if guild ID is invalid format
 */
export function getGuildId(options: { guild?: string }): string | undefined {
  const guildId = options.guild || process.env.DISCORD_GUILD_ID;

  // No guild ID provided - not an error, some commands don't require it
  if (!guildId) {
    return undefined;
  }

  // Sprint 94 (H-3): Validate guild ID format
  if (!validateGuildId(guildId)) {
    const error = new Error(`Invalid guild ID format [${GuildValidationErrors.INVALID_FORMAT}]`);
    (error as Error & { code: string }).code = GuildValidationErrors.INVALID_FORMAT;
    throw error;
  }

  return guildId;
}

/**
 * Resolves the configuration file path
 *
 * @param filePath - User-provided path or default
 * @returns Absolute path to config file
 */
export function resolveConfigPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

/**
 * Checks if a config file exists
 *
 * @param filePath - Path to config file
 * @returns true if file exists
 */
export function configExists(filePath: string): boolean {
  return existsSync(resolveConfigPath(filePath));
}

/**
 * Reads a config file
 *
 * @param filePath - Path to config file
 * @returns File contents as string
 * @throws Error if file doesn't exist
 */
export function readConfigFile(filePath: string): string {
  const fullPath = resolveConfigPath(filePath);
  if (!existsSync(fullPath)) {
    throw new Error(
      `Configuration file not found: ${filePath}\n` +
        'Run "gaib server init" to create one, or specify a path with -f/--file.'
    );
  }
  return readFileSync(fullPath, 'utf-8');
}

/**
 * Writes a config file
 *
 * @param filePath - Path to config file
 * @param content - Content to write
 * @param force - Overwrite if exists
 * @throws Error if file exists and force is false
 */
export function writeConfigFile(filePath: string, content: string, force = false): void {
  const fullPath = resolveConfigPath(filePath);
  if (existsSync(fullPath) && !force) {
    throw new Error(
      `Configuration file already exists: ${filePath}\n` +
        'Use --force to overwrite, or specify a different path with -f/--file.'
    );
  }
  writeFileSync(fullPath, content, 'utf-8');
}

// =============================================================================
// TTY Detection & Color Control
// =============================================================================

/**
 * Determines if colors should be used in output
 *
 * Checks environment variables and TTY status per clig.dev guidelines:
 * - NO_COLOR env var set → no color
 * - TERM=dumb → no color
 * - stdout is not a TTY → no color
 *
 * @see https://clig.dev/ "Disable color if NO_COLOR env var is set"
 * @returns true if colors should be used
 */
export function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * Determines if the terminal supports interactive features
 *
 * Used to decide whether to show spinners, prompts, etc.
 *
 * @returns true if running in an interactive TTY
 */
export function isInteractive(): boolean {
  return process.stdout.isTTY === true;
}

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Error codes for CLI exit statuses
 */
export const ExitCodes = {
  SUCCESS: 0,
  VALIDATION_ERROR: 1,
  PARTIAL_FAILURE: 2,
  API_ERROR: 3,
  CONFIG_ERROR: 4,
} as const;

/**
 * Handles errors in CLI commands
 *
 * @param error - Error to handle
 * @param json - Whether to output as JSON
 */
export function handleError(error: unknown, json: boolean = false): never {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string }).code;

  if (json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            message,
            code: code || 'UNKNOWN',
          },
        },
        null,
        2
      )
    );
  } else {
    console.error(chalk.red(`Error: ${message}`));
    if (code) {
      console.error(chalk.dim(`Code: ${code}`));
    }
  }

  // Determine exit code based on error type
  let exitCode: number = ExitCodes.VALIDATION_ERROR;
  if (code === 'ENOENT' || code === 'CONFIG_NOT_FOUND') {
    exitCode = ExitCodes.CONFIG_ERROR;
  } else if (code === 'DISCORD_API_ERROR' || code === 'RATE_LIMITED') {
    exitCode = ExitCodes.API_ERROR;
  }

  process.exit(exitCode);
}

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Operation type symbols for diff display
 */
export const OperationSymbols = {
  create: chalk.green('+'),
  update: chalk.yellow('~'),
  delete: chalk.red('-'),
  noop: chalk.dim(' '),
} as const;

/**
 * Operation type colors for diff display
 */
export const OperationColors = {
  create: chalk.green,
  update: chalk.yellow,
  delete: chalk.red,
  noop: chalk.dim,
} as const;

/**
 * Formats a single change for display
 *
 * @param change - Change to format
 * @param resourceType - Type of resource (role, category, channel)
 * @returns Formatted string
 */
export function formatChange(change: ResourceChange<unknown>, resourceType: string): string {
  const symbol = OperationSymbols[change.operation];
  const color = OperationColors[change.operation];
  const name = change.name;

  let line = `  ${symbol} ${color(resourceType)}: ${name}`;

  if (change.operation === 'update' && change.changes && change.changes.length > 0) {
    for (const fieldChange of change.changes) {
      line += `\n      ${chalk.dim(fieldChange.field)}: ${chalk.red(String(fieldChange.from))} → ${chalk.green(String(fieldChange.to))}`;
    }
  }

  return line;
}

/**
 * Formats a permission change for display
 *
 * @param change - Permission change to format
 * @returns Formatted string
 */
export function formatPermissionChange(change: PermissionChange): string {
  const symbol = OperationSymbols[change.operation];
  const color = OperationColors[change.operation];

  return `  ${symbol} ${color('permission')}: ${change.targetName}/${change.subjectName}`;
}

/**
 * Formats a diff result for human-readable display
 *
 * @param diff - Diff result to format
 * @returns Formatted string
 */
export function formatDiffOutput(diff: ServerDiff): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold('\n📋 Diff Summary\n'));
  lines.push(
    `  ${chalk.green(`${diff.summary.create} creates`)}, ` +
      `${chalk.yellow(`${diff.summary.update} updates`)}, ` +
      `${chalk.red(`${diff.summary.delete} deletes`)}\n`
  );

  if (!diff.hasChanges) {
    lines.push(chalk.dim('  No changes detected. Server is in sync with configuration.\n'));
    return lines.join('\n');
  }

  // Roles
  const roleChanges = diff.roles.filter((c) => c.operation !== 'noop');
  if (roleChanges.length > 0) {
    lines.push(chalk.bold('Roles:'));
    for (const change of roleChanges) {
      lines.push(formatChange(change, 'role'));
    }
    lines.push('');
  }

  // Categories
  const categoryChanges = diff.categories.filter((c) => c.operation !== 'noop');
  if (categoryChanges.length > 0) {
    lines.push(chalk.bold('Categories:'));
    for (const change of categoryChanges) {
      lines.push(formatChange(change, 'category'));
    }
    lines.push('');
  }

  // Channels
  const channelChanges = diff.channels.filter((c) => c.operation !== 'noop');
  if (channelChanges.length > 0) {
    lines.push(chalk.bold('Channels:'));
    for (const change of channelChanges) {
      lines.push(formatChange(change, 'channel'));
    }
    lines.push('');
  }

  // Permissions
  const permissionChanges = diff.permissions.filter((c) => c.operation !== 'noop');
  if (permissionChanges.length > 0) {
    lines.push(chalk.bold('Permissions:'));
    for (const change of permissionChanges) {
      lines.push(formatPermissionChange(change));
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats a plan result (wrapper around diff with apply preview)
 *
 * @param diff - Diff result
 * @returns Formatted plan output
 */
export function formatPlanOutput(diff: ServerDiff): string {
  const lines: string[] = [];

  lines.push(chalk.bold.cyan('\n🔍 Execution Plan\n'));
  lines.push(
    chalk.dim('  The following changes would be applied to bring Discord in sync with your config:\n')
  );

  lines.push(formatDiffOutput(diff));

  if (diff.hasChanges) {
    lines.push(chalk.dim('  To apply these changes, run: gaib server apply\n'));
  }

  return lines.join('\n');
}

/**
 * Formats success output
 *
 * @param message - Success message
 * @param details - Optional details object
 * @param json - Whether to output as JSON
 */
export function formatSuccess(message: string, details?: Record<string, unknown>, json = false): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          message,
          ...details,
        },
        null,
        2
      )
    );
  } else {
    console.log(chalk.green(`✓ ${message}`));
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        console.log(chalk.dim(`  ${key}: ${value}`));
      }
    }
  }
}

/**
 * Formats a warning message
 *
 * @param message - Warning message
 */
export function formatWarning(message: string): void {
  console.warn(chalk.yellow(`⚠ ${message}`));
}

/**
 * Formats an info message
 *
 * @param message - Info message
 */
export function formatInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

// =============================================================================
// Progress Indicators
// =============================================================================

/**
 * Simple progress callback for StateWriter
 *
 * @param quiet - Whether to suppress output
 * @returns Progress callback function
 */
export function createProgressCallback(quiet: boolean): (message: string) => void {
  if (quiet) {
    return () => {};
  }
  return (message: string) => {
    console.log(chalk.dim(`  ${message}`));
  };
}

// =============================================================================
// YAML Generation
// =============================================================================

/**
 * Generates a default server configuration template
 *
 * @param guildId - Optional guild ID to include
 * @param serverName - Optional server name
 * @returns YAML configuration string
 */
export function generateDefaultConfig(guildId?: string, serverName?: string): string {
  const config = `# Discord Server Infrastructure-as-Code Configuration
# Generated by gaib server init
# Documentation: https://github.com/0xHoneyJar/arrakis

version: "1.0"

server:
  name: "${serverName || 'My Discord Server'}"
${guildId ? `  id: "${guildId}"` : '  # id: "YOUR_GUILD_ID"  # Uncomment and set your guild ID'}

# Roles managed by IaC
# Tip: Add [managed-by:arrakis-iac] to role names to mark them as IaC-managed
roles:
  # Example role:
  # - name: "Moderator [managed-by:arrakis-iac]"
  #   color: "#3498db"
  #   permissions:
  #     - KICK_MEMBERS
  #     - BAN_MEMBERS
  #     - MANAGE_MESSAGES
  #   hoist: true
  #   mentionable: false
  []

# Categories managed by IaC
# Tip: Add [managed-by:arrakis-iac] to category names to mark them as IaC-managed
categories:
  # Example category:
  # - name: "📋 Information [managed-by:arrakis-iac]"
  #   position: 0
  []

# Channels managed by IaC
# Tip: Add [managed-by:arrakis-iac] to channel topics to mark them as IaC-managed
channels:
  # Example text channel:
  # - name: "welcome"
  #   type: text
  #   topic: "Welcome to the server! [managed-by:arrakis-iac]"
  #   category: "📋 Information [managed-by:arrakis-iac]"
  #
  # Example voice channel:
  # - name: "General Voice"
  #   type: voice
  #   topic: "[managed-by:arrakis-iac]"
  #   category: "📋 Information [managed-by:arrakis-iac]"
  []
`;

  return config;
}

/**
 * Generates a themed server configuration template
 *
 * @param guildId - Optional guild ID to include
 * @param serverName - Optional server name
 * @param themeName - Theme name to use
 * @returns YAML configuration string
 */
export function generateThemedConfig(
  guildId?: string,
  serverName?: string,
  themeName?: string
): string {
  const config = `# Discord Server Infrastructure-as-Code Configuration
# Generated by gaib server init --theme ${themeName}
# Documentation: https://github.com/0xHoneyJar/arrakis

version: "1.0"

server:
  name: "${serverName || 'My Discord Server'}"
${guildId ? `  id: "${guildId}"` : '  # id: "YOUR_GUILD_ID"  # Uncomment and set your guild ID'}

# Theme configuration
# The theme provides default roles, categories, and channels
# Override theme values by specifying them directly below
theme:
  name: ${themeName}
  # Customize theme variables:
  # variables:
  #   community_name: "My Community"
  #   primary_color: "#FF5500"

# Add custom roles (these merge with theme roles)
# roles:
#   - name: "Custom Role"
#     color: "#00FF00"

# Add custom categories (these merge with theme categories)
# categories:
#   - name: "Custom Category"
#     position: 10

# Add custom channels (these merge with theme channels)
# channels:
#   - name: "custom-channel"
#     type: text
#     category: "Custom Category"
`;

  return config;
}
