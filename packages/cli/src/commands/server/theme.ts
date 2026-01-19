/**
 * Theme Commands
 *
 * Sprint 100: Theme System
 *
 * Commands for listing and inspecting available themes.
 *
 * @see SDD §6.0 Theme System
 * @module packages/cli/commands/server/theme
 */

import chalk from 'chalk';
import {
  listThemes,
  findThemePath,
  ThemeLoader,
  ThemeError,
  type LoadedTheme,
} from './themes/index.js';
import { ExitCodes } from './utils.js';

// Re-export exit codes type for convenience
type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

// ============================================================================
// Types
// ============================================================================

export interface ThemeListOptions {
  json?: boolean;
  quiet?: boolean;
}

export interface ThemeInfoOptions {
  json?: boolean;
  quiet?: boolean;
}

// ============================================================================
// Theme List Command
// ============================================================================

/**
 * List all available themes
 *
 * @param options - Command options
 * @returns Exit code
 */
export async function themeListCommand(options: ThemeListOptions): Promise<ExitCode> {
  const themes = listThemes();

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      themes: themes.map((t) => ({
        name: t.name,
        version: t.version,
        description: t.description,
        author: t.author,
        tags: t.tags,
      })),
      count: themes.length,
    }, null, 2));
    return ExitCodes.SUCCESS;
  }

  if (themes.length === 0) {
    if (!options.quiet) {
      console.log(chalk.yellow('No themes found.'));
      console.log();
      console.log('Theme search paths:');
      console.log('  - Built-in: themes/');
      console.log('  - Project: ./themes/');
      console.log('  - User: ~/.gaib/themes/');
    }
    return ExitCodes.SUCCESS;
  }

  if (!options.quiet) {
    console.log(chalk.bold('Available Themes'));
    console.log();
  }

  for (const theme of themes) {
    console.log(chalk.cyan.bold(theme.name) + chalk.gray(` v${theme.version}`));
    if (theme.description && !options.quiet) {
      console.log(`  ${theme.description}`);
    }
    if (theme.author && !options.quiet) {
      console.log(chalk.gray(`  Author: ${theme.author}`));
    }
    if (theme.tags && theme.tags.length > 0 && !options.quiet) {
      console.log(chalk.gray(`  Tags: ${theme.tags.join(', ')}`));
    }
    if (!options.quiet) {
      console.log();
    }
  }

  if (!options.quiet) {
    console.log(chalk.gray(`${themes.length} theme(s) available`));
  }

  return ExitCodes.SUCCESS;
}

// ============================================================================
// Theme Info Command
// ============================================================================

/**
 * Show detailed information about a theme
 *
 * @param name - Theme name
 * @param options - Command options
 * @returns Exit code
 */
export async function themeInfoCommand(
  name: string,
  options: ThemeInfoOptions
): Promise<ExitCode> {
  // Find theme path
  const themePath = findThemePath(name);
  if (!themePath) {
    if (options.json) {
      console.log(JSON.stringify({
        success: false,
        error: {
          code: 'THEME_NOT_FOUND',
          message: `Theme "${name}" not found`,
        },
      }, null, 2));
    } else {
      console.error(chalk.red(`Error: Theme "${name}" not found`));
      console.error();
      console.error('Run `gaib server theme list` to see available themes.');
    }
    return ExitCodes.VALIDATION_ERROR;
  }

  // Load theme to get full info
  const loader = new ThemeLoader();
  let theme: LoadedTheme;
  try {
    theme = await loader.load(name);
  } catch (error) {
    if (error instanceof ThemeError) {
      if (options.json) {
        console.log(JSON.stringify({
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        }, null, 2));
      } else {
        console.error(chalk.red(`Error: ${error.message}`));
        if (error.details) {
          for (const detail of error.details) {
            console.error(chalk.gray(`  ${detail}`));
          }
        }
      }
      return ExitCodes.VALIDATION_ERROR;
    }
    throw error;
  }

  const { manifest } = theme;

  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      theme: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        extends: manifest.extends,
        tags: manifest.tags,
        variables: manifest.variables,
        files: manifest.files,
        sourcePath: theme.sourcePath,
        summary: {
          roleCount: theme.roles.length,
          categoryCount: theme.categories.length,
          channelCount: theme.channels.length,
        },
      },
    }, null, 2));
    return ExitCodes.SUCCESS;
  }

  // Human-readable output
  console.log(chalk.bold.cyan(manifest.name) + chalk.gray(` v${manifest.version}`));
  console.log();

  if (manifest.description) {
    console.log(manifest.description);
    console.log();
  }

  // Metadata
  console.log(chalk.bold('Metadata'));
  if (manifest.author) {
    console.log(`  Author:  ${manifest.author}`);
  }
  if (manifest.license) {
    console.log(`  License: ${manifest.license}`);
  }
  if (manifest.extends) {
    console.log(`  Extends: ${manifest.extends}`);
  }
  if (manifest.tags && manifest.tags.length > 0) {
    console.log(`  Tags:    ${manifest.tags.join(', ')}`);
  }
  console.log(`  Path:    ${theme.sourcePath}`);
  console.log();

  // Variables
  const varEntries = Object.entries(manifest.variables ?? {});
  if (varEntries.length > 0) {
    console.log(chalk.bold('Variables'));
    for (const [varName, varDef] of varEntries) {
      const required = varDef.required ? chalk.red('*') : '';
      const defaultVal = varDef.default !== undefined
        ? chalk.gray(` (default: ${varDef.default})`)
        : '';
      console.log(`  ${chalk.cyan(varName)}${required}: ${varDef.type}${defaultVal}`);
      if (varDef.description) {
        console.log(chalk.gray(`    ${varDef.description}`));
      }
    }
    console.log();
  }

  // Content summary
  console.log(chalk.bold('Content'));
  console.log(`  Roles:      ${theme.roles.length}`);
  if (theme.roles.length > 0 && !options.quiet) {
    const roleNames = theme.roles.map((r) => r.name).slice(0, 5);
    const more = theme.roles.length > 5 ? ` (+${theme.roles.length - 5} more)` : '';
    console.log(chalk.gray(`              ${roleNames.join(', ')}${more}`));
  }

  console.log(`  Categories: ${theme.categories.length}`);
  if (theme.categories.length > 0 && !options.quiet) {
    const catNames = theme.categories.map((c) => c.name).slice(0, 5);
    const more = theme.categories.length > 5 ? ` (+${theme.categories.length - 5} more)` : '';
    console.log(chalk.gray(`              ${catNames.join(', ')}${more}`));
  }

  console.log(`  Channels:   ${theme.channels.length}`);
  if (theme.channels.length > 0 && !options.quiet) {
    const chanNames = theme.channels.map((c) => `#${c.name}`).slice(0, 5);
    const more = theme.channels.length > 5 ? ` (+${theme.channels.length - 5} more)` : '';
    console.log(chalk.gray(`              ${chanNames.join(', ')}${more}`));
  }
  console.log();

  // Files
  console.log(chalk.bold('Files'));
  const files = manifest.files ?? {};
  console.log(`  Server:     ${files.server ?? 'server.yaml'}`);
  console.log(`  Roles:      ${files.roles ?? 'roles.yaml'}`);
  console.log(`  Channels:   ${files.channels ?? 'channels.yaml'}`);
  if (files.categories) {
    console.log(`  Categories: ${files.categories}`);
  }

  return ExitCodes.SUCCESS;
}
