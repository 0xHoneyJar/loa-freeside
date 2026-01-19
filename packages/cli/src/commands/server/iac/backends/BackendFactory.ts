/**
 * Backend Factory
 *
 * Sprint 96: Remote State Backend - BackendFactory Implementation
 *
 * Factory for creating state backend instances based on configuration.
 * Handles backend type detection, validation, and instantiation.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.1.3
 * @module packages/cli/commands/server/iac/backends/BackendFactory
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { StateBackend, BackendConfig, BackendType } from './types.js';
import { BackendConfigError, isValidBackendConfig } from './types.js';
import { createLocalBackend } from './LocalBackend.js';
import { createS3Backend, createS3BackendFromEnv } from './S3Backend.js';

// ============================================================================
// Configuration File Constants
// ============================================================================

/** Default Gaib configuration file name */
const CONFIG_FILE = 'gaib.yaml';

/** Alternative configuration file names */
const CONFIG_FILE_ALTERNATIVES = ['gaib.yml', '.gaib.yaml', '.gaib.yml'];

// ============================================================================
// BackendFactory
// ============================================================================

/**
 * Factory for creating state backend instances
 *
 * @example
 * ```typescript
 * // Create from project configuration
 * const backend = await BackendFactory.fromConfig();
 *
 * // Create from explicit configuration
 * const backend = BackendFactory.create({
 *   type: 's3',
 *   bucket: 'my-bucket',
 *   key: 'state/${workspace}/terraform.tfstate',
 *   region: 'us-east-1',
 *   dynamodb_table: 'gaib-locks',
 * });
 *
 * // Create from environment
 * const backend = BackendFactory.fromEnvironment();
 * ```
 */
export class BackendFactory {
  /**
   * Create a backend from explicit configuration
   */
  static create(config: BackendConfig): StateBackend {
    if (!isValidBackendConfig(config)) {
      const typeHint = (config as { type?: string }).type ?? 'local';
      throw new BackendConfigError(
        `Invalid backend configuration for type "${typeHint}"`,
        typeHint as BackendType
      );
    }

    switch (config.type) {
      case 'local':
        return createLocalBackend(config);

      case 's3':
        return createS3Backend(config);
    }
  }

  /**
   * Create a backend from project configuration file
   *
   * Searches for gaib.yaml in the current directory and parents.
   *
   * @param cwd - Starting directory (default: process.cwd())
   */
  static async fromConfig(cwd: string = process.cwd()): Promise<StateBackend> {
    const configPath = findConfigFile(cwd);

    if (!configPath) {
      // No config file found, use local backend
      return createLocalBackend();
    }

    const config = loadConfigFile(configPath);

    if (!config.backend) {
      // No backend specified, use local
      return createLocalBackend();
    }

    return BackendFactory.create(config.backend);
  }

  /**
   * Create a backend from environment variables
   *
   * Environment variable precedence:
   * 1. GAIB_BACKEND_TYPE - "local" or "s3"
   * 2. GAIB_S3_BUCKET - if set, uses S3 backend
   * 3. Default: local backend
   */
  static fromEnvironment(): StateBackend {
    const backendType = process.env.GAIB_BACKEND_TYPE as BackendType | undefined;

    if (backendType === 's3' || process.env.GAIB_S3_BUCKET) {
      return createS3BackendFromEnv();
    }

    return createLocalBackend({
      path: process.env.GAIB_STATE_PATH,
    });
  }

  /**
   * Create a backend with automatic detection
   *
   * Priority:
   * 1. Environment variables (if GAIB_BACKEND_TYPE or GAIB_S3_BUCKET set)
   * 2. Configuration file (gaib.yaml)
   * 3. Local backend (default)
   */
  static async auto(cwd: string = process.cwd()): Promise<StateBackend> {
    // Check environment first
    if (process.env.GAIB_BACKEND_TYPE || process.env.GAIB_S3_BUCKET) {
      return BackendFactory.fromEnvironment();
    }

    // Try configuration file
    return BackendFactory.fromConfig(cwd);
  }

  /**
   * Get the backend type from configuration without creating an instance
   */
  static getBackendType(cwd: string = process.cwd()): BackendType {
    // Check environment
    if (process.env.GAIB_BACKEND_TYPE) {
      return process.env.GAIB_BACKEND_TYPE as BackendType;
    }
    if (process.env.GAIB_S3_BUCKET) {
      return 's3';
    }

    // Check config file
    const configPath = findConfigFile(cwd);
    if (configPath) {
      const config = loadConfigFile(configPath);
      if (config.backend?.type) {
        return config.backend.type;
      }
    }

    return 'local';
  }
}

// ============================================================================
// Configuration File Utilities
// ============================================================================

/**
 * Find the configuration file in the directory tree
 */
export function findConfigFile(startDir: string): string | null {
  let currentDir = startDir;

  // Walk up the directory tree
  while (true) {
    // Check main config file
    const mainPath = join(currentDir, CONFIG_FILE);
    if (existsSync(mainPath)) {
      return mainPath;
    }

    // Check alternatives
    for (const alt of CONFIG_FILE_ALTERNATIVES) {
      const altPath = join(currentDir, alt);
      if (existsSync(altPath)) {
        return altPath;
      }
    }

    // Move up to parent
    const parentDir = join(currentDir, '..');

    // Check if we've reached the root
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

/**
 * Load and parse a Gaib configuration file
 */
export function loadConfigFile(configPath: string): GaibConfig {
  const content = readFileSync(configPath, 'utf-8');
  const config = parseYaml(content);

  if (typeof config !== 'object' || config === null) {
    throw new Error(`Invalid configuration file: ${configPath}`);
  }

  return config as GaibConfig;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Gaib configuration file structure
 */
export interface GaibConfig {
  /** Configuration version */
  version?: string;
  /** Project name */
  name?: string;
  /** Backend configuration */
  backend?: BackendConfig;
  /** Discord bot configuration */
  discord?: {
    bot_token?: string;
  };
  /** Server configuration */
  server?: Record<string, unknown>;
  /** Output definitions */
  outputs?: Record<string, unknown>;
}

// ============================================================================
// Backend Management Utilities
// ============================================================================

/**
 * Ensure a backend is properly closed
 */
export async function withBackend<T>(
  backend: StateBackend,
  fn: (backend: StateBackend) => Promise<T>
): Promise<T> {
  try {
    return await fn(backend);
  } finally {
    await backend.close();
  }
}

/**
 * Execute with lock protection
 */
export async function withLock<T>(
  backend: StateBackend,
  workspace: string,
  who: string,
  operation: string,
  fn: (lockInfo: { lockId: string }) => Promise<T>
): Promise<T> {
  const lockResult = await backend.lock(workspace, { who, operation });

  if (!lockResult.acquired) {
    throw new Error(
      lockResult.error ?? 'Failed to acquire lock'
    );
  }

  const lockId = lockResult.lockInfo!.id;

  try {
    return await fn({ lockId });
  } finally {
    await backend.unlock(workspace, lockId);
  }
}

// ============================================================================
// Export Convenience Functions
// ============================================================================

/**
 * Create a local backend
 */
export { createLocalBackend } from './LocalBackend.js';

/**
 * Create an S3 backend
 */
export { createS3Backend, createS3BackendFromEnv } from './S3Backend.js';
