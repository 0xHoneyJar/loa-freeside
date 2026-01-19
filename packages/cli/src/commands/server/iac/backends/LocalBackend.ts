/**
 * Local State Backend
 *
 * Sprint 96: Remote State Backend - LocalBackend Implementation
 *
 * File-based state backend for development and single-user workflows.
 * Stores state in .gaib/ directory with basic file locking.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.1.2
 * @module packages/cli/commands/server/iac/backends/LocalBackend
 */

import { existsSync, mkdirSync, promises as fs } from 'fs';
import { join, dirname } from 'path';
import type {
  StateBackend,
  GaibState,
  LockInfo,
  LockResult,
  LockOptions,
  LocalBackendConfig,
} from './types.js';
import {
  generateLockId,
  isValidState,
  BackendError,
  StateLockError,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** State file name */
const STATE_FILE = 'terraform.tfstate';

/** Lock file name */
const LOCK_FILE = '.lock';

/** Default state directory */
const DEFAULT_PATH = '.gaib';

/** Lock file stale threshold (10 minutes) */
const LOCK_STALE_MS = 10 * 60 * 1000;

// ============================================================================
// LocalBackend Implementation
// ============================================================================

/**
 * Local file-based state backend
 *
 * Directory structure:
 * ```
 * .gaib/
 * ├── workspaces/
 * │   ├── default/
 * │   │   ├── terraform.tfstate
 * │   │   └── .lock
 * │   ├── staging/
 * │   │   ├── terraform.tfstate
 * │   │   └── .lock
 * │   └── production/
 * │       ├── terraform.tfstate
 * │       └── .lock
 * └── .current-workspace
 * ```
 */
export class LocalBackend implements StateBackend {
  readonly type = 'local' as const;
  readonly supportsLocking = true;

  private readonly basePath: string;

  constructor(config: LocalBackendConfig) {
    this.basePath = config.path ?? DEFAULT_PATH;
  }

  // ============================================================================
  // State Operations
  // ============================================================================

  async getState(workspace: string): Promise<GaibState | null> {
    const statePath = this.getStatePath(workspace);

    try {
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content);

      if (!isValidState(state)) {
        throw new BackendError(
          `Invalid state file format at ${statePath}`,
          'INVALID_STATE',
          'local'
        );
      }

      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async setState(workspace: string, state: GaibState): Promise<void> {
    const statePath = this.getStatePath(workspace);

    // Ensure directory exists
    const dir = dirname(statePath);
    await this.ensureDir(dir);

    // Update last modified
    state.lastModified = new Date().toISOString();

    // Write atomically (write to temp, then rename)
    const tempPath = `${statePath}.tmp`;
    const content = JSON.stringify(state, null, 2);

    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, statePath);
  }

  async deleteState(workspace: string): Promise<void> {
    const statePath = this.getStatePath(workspace);
    const lockPath = this.getLockPath(workspace);

    try {
      await fs.unlink(statePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Try to remove the workspace directory if empty
    const workspaceDir = dirname(statePath);
    try {
      await fs.rmdir(workspaceDir);
    } catch {
      // Directory not empty or doesn't exist, ignore
    }
  }

  async listWorkspaces(): Promise<string[]> {
    const workspacesDir = this.getWorkspacesDir();

    try {
      const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  // ============================================================================
  // Locking Operations
  // ============================================================================

  async lock(workspace: string, options: LockOptions): Promise<LockResult> {
    const lockPath = this.getLockPath(workspace);

    // Ensure directory exists
    await this.ensureDir(dirname(lockPath));

    // Check for existing lock
    const existingLock = await this.getLockInfo(workspace);

    if (existingLock) {
      // Check if lock is stale
      const lockAge = Date.now() - new Date(existingLock.created).getTime();

      if (lockAge < LOCK_STALE_MS) {
        return {
          acquired: false,
          lockInfo: existingLock,
          error: `State is locked by ${existingLock.who} (operation: ${existingLock.operation})`,
        };
      }

      // Lock is stale, remove it
      await this.forceUnlock(workspace);
    }

    // Create new lock
    const lockInfo: LockInfo = {
      id: generateLockId(),
      who: options.who,
      operation: options.operation,
      info: options.info,
      created: new Date().toISOString(),
      path: lockPath,
    };

    try {
      // Use exclusive flag to prevent race conditions
      await fs.writeFile(lockPath, JSON.stringify(lockInfo, null, 2), {
        flag: 'wx',
      });

      return {
        acquired: true,
        lockInfo,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Another process acquired the lock between our check and create
        const currentLock = await this.getLockInfo(workspace);
        return {
          acquired: false,
          lockInfo: currentLock ?? undefined,
          error: 'Lock was acquired by another process',
        };
      }
      throw error;
    }
  }

  async unlock(workspace: string, lockId: string): Promise<boolean> {
    const lockPath = this.getLockPath(workspace);
    const existingLock = await this.getLockInfo(workspace);

    if (!existingLock) {
      return true; // No lock exists
    }

    if (existingLock.id !== lockId) {
      throw new StateLockError(
        `Cannot unlock: lock ID mismatch (expected ${lockId}, got ${existingLock.id})`,
        existingLock,
        'local'
      );
    }

    try {
      await fs.unlink(lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return true; // Lock already removed
      }
      throw error;
    }
  }

  async forceUnlock(workspace: string): Promise<boolean> {
    const lockPath = this.getLockPath(workspace);

    try {
      await fs.unlink(lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return true;
      }
      throw error;
    }
  }

  async getLockInfo(workspace: string): Promise<LockInfo | null> {
    const lockPath = this.getLockPath(workspace);

    try {
      const content = await fs.readFile(lockPath, 'utf-8');
      return JSON.parse(content) as LockInfo;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  // ============================================================================
  // Configuration & Lifecycle
  // ============================================================================

  async isConfigured(): Promise<boolean> {
    // Local backend is always "configured", but we check if base path exists
    // or can be created
    try {
      await this.ensureDir(this.basePath);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // No cleanup needed for local backend
  }

  // ============================================================================
  // Path Helpers
  // ============================================================================

  private getWorkspacesDir(): string {
    return join(this.basePath, 'workspaces');
  }

  private getWorkspaceDir(workspace: string): string {
    return join(this.getWorkspacesDir(), workspace);
  }

  private getStatePath(workspace: string): string {
    return join(this.getWorkspaceDir(workspace), STATE_FILE);
  }

  private getLockPath(workspace: string): string {
    return join(this.getWorkspaceDir(workspace), LOCK_FILE);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    if (!existsSync(dirPath)) {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a LocalBackend instance
 */
export function createLocalBackend(config?: Partial<LocalBackendConfig>): LocalBackend {
  return new LocalBackend({
    type: 'local',
    path: config?.path,
  });
}

// ============================================================================
// Current Workspace Tracking
// ============================================================================

/**
 * Get the current workspace name from local tracking
 */
export async function getCurrentWorkspace(basePath: string = DEFAULT_PATH): Promise<string> {
  const trackingFile = join(basePath, '.current-workspace');

  try {
    const content = await fs.readFile(trackingFile, 'utf-8');
    return content.trim() || 'default';
  } catch {
    return 'default';
  }
}

/**
 * Set the current workspace in local tracking
 */
export async function setCurrentWorkspace(
  workspace: string,
  basePath: string = DEFAULT_PATH
): Promise<void> {
  const trackingFile = join(basePath, '.current-workspace');

  // Ensure directory exists
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }

  await fs.writeFile(trackingFile, workspace, 'utf-8');
}
