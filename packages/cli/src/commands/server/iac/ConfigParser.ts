/**
 * Config Parser - YAML Configuration Parsing and Validation
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Parses YAML configuration files and validates them against Zod schemas.
 * Provides detailed error messages for validation failures.
 *
 * @see PRD grimoires/loa/discord-iac-prd.md §3.1 FR-1
 * @see SDD grimoires/loa/discord-iac-sdd.md §4.1
 * @module packages/cli/commands/server/iac/ConfigParser
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { ServerConfigSchema, type ServerConfig } from './schemas.js';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error for configuration parsing/validation issues
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code: ConfigErrorCode,
    public readonly details?: ConfigErrorDetail[]
  ) {
    super(message);
    this.name = 'ConfigError';
  }

  /**
   * Format error for CLI display
   */
  format(): string {
    const lines = [`Error: ${this.message}`];

    if (this.details && this.details.length > 0) {
      lines.push('');
      lines.push('Details:');
      for (const detail of this.details) {
        const pathStr = detail.path.length > 0 ? ` at ${detail.path.join('.')}` : '';
        lines.push(`  - ${detail.message}${pathStr}`);
      }
    }

    return lines.join('\n');
  }
}

/**
 * Error codes for configuration issues
 */
export enum ConfigErrorCode {
  /** Config file not found */
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  /** Config file cannot be read */
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  /** YAML syntax error */
  YAML_PARSE_ERROR = 'YAML_PARSE_ERROR',
  /** Schema validation failed */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Cross-reference validation failed */
  REFERENCE_ERROR = 'REFERENCE_ERROR',
}

/**
 * Detailed error information
 */
export interface ConfigErrorDetail {
  /** Error message */
  message: string;
  /** Path to the problematic field */
  path: (string | number)[];
  /** Expected value (if applicable) */
  expected?: string;
  /** Received value (if applicable) */
  received?: string;
}

// ============================================================================
// Config Parser
// ============================================================================

/**
 * Options for parsing configuration
 */
export interface ParseOptions {
  /** Whether to validate cross-references (default: true) */
  validateReferences?: boolean;
}

/**
 * Parse result with configuration and metadata
 */
export interface ParseResult {
  /** Parsed and validated configuration */
  config: ServerConfig;
  /** Source file path (if parsed from file) */
  sourcePath?: string;
  /** Warnings (non-fatal issues) */
  warnings: string[];
}

/**
 * Parse a YAML configuration file
 *
 * @param filePath - Path to the YAML configuration file
 * @param options - Parsing options
 * @returns Parsed and validated configuration
 * @throws ConfigError if parsing or validation fails
 */
export function parseConfigFile(
  filePath: string,
  options: ParseOptions = {}
): ParseResult {
  const absolutePath = path.resolve(filePath);

  // Check file exists
  if (!fs.existsSync(absolutePath)) {
    throw new ConfigError(
      `Configuration file not found: ${filePath}`,
      ConfigErrorCode.FILE_NOT_FOUND
    );
  }

  // Read file
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    throw new ConfigError(
      `Failed to read configuration file: ${filePath}`,
      ConfigErrorCode.FILE_READ_ERROR,
      [{ message: String(error), path: [] }]
    );
  }

  // Parse and validate
  const result = parseConfigString(content, options);
  result.sourcePath = absolutePath;

  return result;
}

/**
 * Parse a YAML configuration string
 *
 * @param content - YAML content to parse
 * @param options - Parsing options
 * @returns Parsed and validated configuration
 * @throws ConfigError if parsing or validation fails
 */
export function parseConfigString(
  content: string,
  options: ParseOptions = {}
): ParseResult {
  const warnings: string[] = [];

  // Parse YAML
  let rawConfig: unknown;
  try {
    rawConfig = yaml.load(content);
  } catch (error) {
    const yamlError = error as yaml.YAMLException;
    throw new ConfigError(
      'YAML syntax error',
      ConfigErrorCode.YAML_PARSE_ERROR,
      [
        {
          message: yamlError.message,
          path: yamlError.mark ? [`line ${yamlError.mark.line + 1}`] : [],
        },
      ]
    );
  }

  // Handle empty file
  if (rawConfig === null || rawConfig === undefined) {
    rawConfig = { version: '1' };
    warnings.push('Configuration file is empty, using defaults');
  }

  // Validate against schema
  const parseResult = ServerConfigSchema.safeParse(rawConfig);

  if (!parseResult.success) {
    const details = parseResult.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path,
      expected: 'expected' in issue ? String(issue.expected) : undefined,
      received: 'received' in issue ? String(issue.received) : undefined,
    }));

    throw new ConfigError(
      'Configuration validation failed',
      ConfigErrorCode.VALIDATION_ERROR,
      details
    );
  }

  const config = parseResult.data;

  // Additional cross-reference validation
  if (options.validateReferences !== false) {
    const referenceErrors = validateReferences(config);
    if (referenceErrors.length > 0) {
      throw new ConfigError(
        'Configuration reference validation failed',
        ConfigErrorCode.REFERENCE_ERROR,
        referenceErrors
      );
    }
  }

  // Generate warnings for potential issues
  warnings.push(...generateWarnings(config));

  return { config, warnings };
}

/**
 * Validate cross-references in the configuration
 * (This is redundant with Zod's superRefine but provides more detailed errors)
 */
function validateReferences(config: ServerConfig): ConfigErrorDetail[] {
  const errors: ConfigErrorDetail[] = [];

  const roleNames = new Set(config.roles.map((r) => r.name.toLowerCase()));
  const categoryNames = new Set(config.categories.map((c) => c.name.toLowerCase()));

  // Validate channel category references
  for (let i = 0; i < config.channels.length; i++) {
    const channel = config.channels[i];
    if (channel.category && !categoryNames.has(channel.category.toLowerCase())) {
      errors.push({
        message: `Unknown category reference: "${channel.category}"`,
        path: ['channels', i, 'category'],
        expected: `One of: ${[...categoryNames].join(', ')}`,
        received: channel.category,
      });
    }
  }

  // Validate channel permission role references
  for (let i = 0; i < config.channels.length; i++) {
    const channel = config.channels[i];
    if (channel.permissions) {
      for (const roleName of Object.keys(channel.permissions)) {
        if (roleName !== '@everyone' && !roleNames.has(roleName.toLowerCase())) {
          errors.push({
            message: `Unknown role reference in permissions: "${roleName}"`,
            path: ['channels', i, 'permissions', roleName],
            expected: `One of: @everyone, ${[...roleNames].join(', ')}`,
            received: roleName,
          });
        }
      }
    }
  }

  // Validate category permission role references
  for (let i = 0; i < config.categories.length; i++) {
    const category = config.categories[i];
    if (category.permissions) {
      for (const roleName of Object.keys(category.permissions)) {
        if (roleName !== '@everyone' && !roleNames.has(roleName.toLowerCase())) {
          errors.push({
            message: `Unknown role reference in permissions: "${roleName}"`,
            path: ['categories', i, 'permissions', roleName],
            expected: `One of: @everyone, ${[...roleNames].join(', ')}`,
            received: roleName,
          });
        }
      }
    }
  }

  return errors;
}

/**
 * Generate warnings for potential configuration issues
 */
function generateWarnings(config: ServerConfig): string[] {
  const warnings: string[] = [];

  // Warn if no roles defined
  if (config.roles.length === 0) {
    warnings.push('No roles defined in configuration');
  }

  // Warn if channels have no category
  const uncategorizedChannels = config.channels.filter((c) => !c.category);
  if (uncategorizedChannels.length > 0 && config.categories.length > 0) {
    warnings.push(
      `${uncategorizedChannels.length} channel(s) have no category: ${uncategorizedChannels.map((c) => c.name).join(', ')}`
    );
  }

  // Warn about high position values
  const highPositionRoles = config.roles.filter((r) => r.position && r.position > 50);
  if (highPositionRoles.length > 0) {
    warnings.push(
      `High position values may cause conflicts: ${highPositionRoles.map((r) => r.name).join(', ')}`
    );
  }

  // Warn if Administrator permission is granted
  const adminRoles = config.roles.filter((r) =>
    r.permissions.includes('ADMINISTRATOR')
  );
  if (adminRoles.length > 0) {
    warnings.push(
      `Administrator permission granted to: ${adminRoles.map((r) => r.name).join(', ')} - This gives full server control`
    );
  }

  return warnings;
}

/**
 * Validate a configuration object (without file I/O)
 *
 * @param config - Configuration object to validate
 * @returns Validation result with errors if invalid
 */
export function validateConfig(config: unknown): {
  valid: boolean;
  errors: ConfigErrorDetail[];
  warnings: string[];
} {
  const parseResult = ServerConfigSchema.safeParse(config);

  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
      warnings: [],
    };
  }

  const referenceErrors = validateReferences(parseResult.data);
  if (referenceErrors.length > 0) {
    return {
      valid: false,
      errors: referenceErrors,
      warnings: [],
    };
  }

  return {
    valid: true,
    errors: [],
    warnings: generateWarnings(parseResult.data),
  };
}

/**
 * Create a minimal valid configuration
 */
export function createEmptyConfig(): ServerConfig {
  return {
    version: '1',
    roles: [],
    categories: [],
    channels: [],
  };
}

/**
 * Serialize a configuration to YAML
 *
 * @param config - Configuration to serialize
 * @returns YAML string
 */
export function serializeConfig(config: ServerConfig): string {
  // Remove defaults and empty arrays for cleaner output
  const cleaned: Record<string, unknown> = {
    version: config.version,
  };

  if (config.server) {
    cleaned.server = config.server;
  }

  if (config.roles.length > 0) {
    cleaned.roles = config.roles.map((role) => {
      const r: Record<string, unknown> = { name: role.name };
      if (role.color) r.color = role.color;
      if (role.hoist) r.hoist = role.hoist;
      if (role.mentionable) r.mentionable = role.mentionable;
      if (role.permissions.length > 0) r.permissions = role.permissions;
      if (role.position !== undefined) r.position = role.position;
      return r;
    });
  }

  if (config.categories.length > 0) {
    cleaned.categories = config.categories.map((cat) => {
      const c: Record<string, unknown> = { name: cat.name };
      if (cat.position !== undefined) c.position = cat.position;
      if (cat.permissions) c.permissions = cat.permissions;
      return c;
    });
  }

  if (config.channels.length > 0) {
    cleaned.channels = config.channels.map((ch) => {
      const c: Record<string, unknown> = { name: ch.name };
      if (ch.type !== 'text') c.type = ch.type;
      if (ch.category) c.category = ch.category;
      if (ch.topic) c.topic = ch.topic;
      if (ch.nsfw) c.nsfw = ch.nsfw;
      if (ch.slowmode) c.slowmode = ch.slowmode;
      if (ch.position !== undefined) c.position = ch.position;
      if (ch.permissions) c.permissions = ch.permissions;
      if (ch.bitrate) c.bitrate = ch.bitrate;
      if (ch.userLimit) c.userLimit = ch.userLimit;
      return c;
    });
  }

  return yaml.dump(cleaned, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  });
}
