/**
 * State Lock Utility
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Provides safe state locking for operations that modify state.
 * Ensures locks are properly released even on errors.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.6
 * @module packages/cli/commands/server/iac/StateLock
 */

import type { StateBackend, LockInfo, LockResult, LockOptions } from './backends/types.js';
import { StateLockError } from './backends/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Operations that require state locking
 */
export type LockOperation = 'apply' | 'destroy' | 'plan' | 'import' | 'state';

/**
 * Options for acquiring a lock
 */
export interface AcquireLockOptions {
  /** Operation being performed */
  operation: LockOperation;
  /** Additional info about the operation */
  info?: string;
  /** Timeout in milliseconds for lock acquisition */
  timeout?: number;
  /** Who is acquiring the lock (defaults to current user/hostname) */
  who?: string;
}

/**
 * Result of a locked operation
 */
export interface LockedOperationResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result of the operation (if successful) */
  result?: T;
  /** Error message (if failed) */
  error?: string;
  /** Lock info (if lock was acquired) */
  lockInfo?: LockInfo;
}

// ============================================================================
// StateLock
// ============================================================================

/**
 * State Lock Utility
 *
 * Provides safe state locking with automatic cleanup.
 *
 * @example
 * ```typescript
 * const stateLock = new StateLock(backend);
 *
 * // Execute with automatic lock management
 * const result = await stateLock.withLock('staging', { operation: 'apply' }, async () => {
 *   // Perform state-modifying operation
 *   return await applyChanges();
 * });
 *
 * // Manual lock management
 * const lock = await stateLock.acquire('staging', { operation: 'apply' });
 * try {
 *   // Do work
 * } finally {
 *   await stateLock.release('staging', lock.lockInfo!.id);
 * }
 * ```
 */
export class StateLock {
  private readonly backend: StateBackend;

  constructor(backend: StateBackend) {
    this.backend = backend;
  }

  // ============================================================================
  // Core Operations
  // ============================================================================

  /**
   * Acquire a lock on a workspace
   *
   * @param workspace - Workspace name
   * @param options - Lock options
   * @returns Lock result with lock info if acquired
   * @throws StateLockError if lock cannot be acquired
   */
  async acquire(workspace: string, options: AcquireLockOptions): Promise<LockResult> {
    const lockOptions: LockOptions = {
      operation: options.operation,
      info: options.info,
      who: options.who ?? this.getDefaultWho(),
    };

    const result = await this.backend.lock(workspace, lockOptions);

    if (!result.acquired) {
      throw new StateLockError(
        result.error ?? 'Failed to acquire state lock',
        result.lockInfo!,
        this.backend.type
      );
    }

    return result;
  }

  /**
   * Release a lock on a workspace
   *
   * @param workspace - Workspace name
   * @param lockId - Lock ID to release
   * @returns true if released, false if not found
   */
  async release(workspace: string, lockId: string): Promise<boolean> {
    return this.backend.unlock(workspace, lockId);
  }

  /**
   * Force release any lock on a workspace
   *
   * Use with caution - this can cause data corruption if another process
   * is actively using the lock.
   *
   * @param workspace - Workspace name
   * @returns true if a lock was released
   */
  async forceRelease(workspace: string): Promise<boolean> {
    return this.backend.forceUnlock(workspace);
  }

  /**
   * Get current lock info for a workspace
   *
   * @param workspace - Workspace name
   * @returns Lock info if locked, null if not
   */
  async getLockInfo(workspace: string): Promise<LockInfo | null> {
    return this.backend.getLockInfo(workspace);
  }

  /**
   * Check if a workspace is currently locked
   *
   * @param workspace - Workspace name
   * @returns true if locked
   */
  async isLocked(workspace: string): Promise<boolean> {
    const lockInfo = await this.getLockInfo(workspace);
    return lockInfo !== null;
  }

  // ============================================================================
  // High-Level Operations
  // ============================================================================

  /**
   * Execute an operation with automatic lock management
   *
   * Acquires the lock before executing the operation and ensures
   * the lock is released even if the operation throws an error.
   *
   * @param workspace - Workspace name
   * @param options - Lock options
   * @param operation - Async operation to execute
   * @returns Operation result wrapped in LockedOperationResult
   */
  async withLock<T>(
    workspace: string,
    options: AcquireLockOptions,
    operation: () => Promise<T>
  ): Promise<LockedOperationResult<T>> {
    let lockResult: LockResult | undefined;

    try {
      // Acquire lock
      lockResult = await this.acquire(workspace, options);

      // Execute operation
      const result = await operation();

      return {
        success: true,
        result,
        lockInfo: lockResult.lockInfo,
      };
    } catch (error) {
      // Handle lock acquisition failure
      if (error instanceof StateLockError) {
        return {
          success: false,
          error: error.message,
          lockInfo: error.lockInfo,
        };
      }

      // Re-throw other errors after releasing lock
      throw error;
    } finally {
      // Always release the lock if we acquired it
      if (lockResult?.acquired && lockResult.lockInfo) {
        try {
          await this.release(workspace, lockResult.lockInfo.id);
        } catch {
          // Log but don't throw - we don't want to mask the original error
          // In production, this should be logged to monitoring
        }
      }
    }
  }

  /**
   * Execute an operation only if the workspace is not locked
   *
   * Unlike withLock, this does not acquire a lock - it just checks
   * that no lock exists before proceeding.
   *
   * @param workspace - Workspace name
   * @param operation - Async operation to execute
   * @returns Operation result
   * @throws StateLockError if workspace is locked
   */
  async withLockCheck<T>(
    workspace: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockInfo = await this.getLockInfo(workspace);

    if (lockInfo) {
      throw new StateLockError(
        `Workspace "${workspace}" is locked by another process`,
        lockInfo,
        this.backend.type
      );
    }

    return operation();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Get default "who" identifier for locks
   */
  private getDefaultWho(): string {
    const username = process.env.USER ?? process.env.USERNAME ?? 'unknown';
    const hostname = process.env.HOSTNAME ?? 'localhost';
    return `${username}@${hostname}`;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a StateLock instance
 *
 * @param backend - State backend to use for locking
 */
export function createStateLock(backend: StateBackend): StateLock {
  return new StateLock(backend);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format lock info for display
 *
 * @param lockInfo - Lock information
 * @returns Formatted string describing the lock
 */
export function formatLockInfo(lockInfo: LockInfo): string {
  const created = new Date(lockInfo.created);
  const age = formatLockAge(created);

  let message = `Lock held by ${lockInfo.who}`;
  message += `\n  Operation: ${lockInfo.operation}`;
  message += `\n  Created: ${lockInfo.created} (${age} ago)`;
  message += `\n  Lock ID: ${lockInfo.id}`;

  if (lockInfo.info) {
    message += `\n  Info: ${lockInfo.info}`;
  }

  return message;
}

/**
 * Format lock age for display
 */
function formatLockAge(created: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) {
    return `${diffDay}d ${diffHour % 24}h`;
  }
  if (diffHour > 0) {
    return `${diffHour}h ${diffMin % 60}m`;
  }
  if (diffMin > 0) {
    return `${diffMin}m ${diffSec % 60}s`;
  }
  return `${diffSec}s`;
}

/**
 * Check if a lock is stale (older than threshold)
 *
 * @param lockInfo - Lock information
 * @param thresholdMs - Stale threshold in milliseconds (default: 1 hour)
 * @returns true if lock is stale
 */
export function isLockStale(lockInfo: LockInfo, thresholdMs: number = 60 * 60 * 1000): boolean {
  const created = new Date(lockInfo.created);
  const now = new Date();
  return (now.getTime() - created.getTime()) > thresholdMs;
}
