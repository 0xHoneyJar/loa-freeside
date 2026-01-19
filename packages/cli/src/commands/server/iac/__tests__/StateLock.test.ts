/**
 * StateLock Tests
 *
 * Sprint 98: Apply & Destroy Operations
 *
 * Unit tests for state locking utility.
 *
 * @module packages/cli/commands/server/iac/__tests__/StateLock.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  StateLock,
  createStateLock,
  formatLockInfo,
  isLockStale,
} from '../StateLock.js';
import { createLocalBackend } from '../backends/LocalBackend.js';
import { StateLockError } from '../backends/types.js';
import type { StateBackend, LockInfo } from '../backends/types.js';

describe('StateLock', () => {
  let tempDir: string;
  let backend: StateBackend;
  let stateLock: StateLock;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'statelock-test-'));
    backend = createLocalBackend({ path: join(tempDir, '.gaib') });
    stateLock = createStateLock(backend);
  });

  afterEach(async () => {
    await backend.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ============================================================================
  // acquire()
  // ============================================================================

  describe('acquire()', () => {
    it('acquires a lock successfully', async () => {
      const result = await stateLock.acquire('default', {
        operation: 'apply',
        info: 'Test apply',
      });

      expect(result.acquired).toBe(true);
      expect(result.lockInfo).toBeDefined();
      expect(result.lockInfo?.operation).toBe('apply');
    });

    it('throws StateLockError when lock already held', async () => {
      // Acquire first lock
      await stateLock.acquire('default', { operation: 'apply' });

      // Try to acquire second lock
      await expect(
        stateLock.acquire('default', { operation: 'apply' })
      ).rejects.toThrow(StateLockError);
    });

    it('includes custom info in lock', async () => {
      const result = await stateLock.acquire('default', {
        operation: 'destroy',
        info: 'Destroying all resources',
      });

      expect(result.lockInfo?.info).toBe('Destroying all resources');
    });

    it('includes who in lock', async () => {
      const result = await stateLock.acquire('default', {
        operation: 'apply',
        who: 'test-user@test-host',
      });

      expect(result.lockInfo?.who).toBe('test-user@test-host');
    });
  });

  // ============================================================================
  // release()
  // ============================================================================

  describe('release()', () => {
    it('releases a held lock', async () => {
      const acquired = await stateLock.acquire('default', { operation: 'apply' });
      const released = await stateLock.release('default', acquired.lockInfo!.id);

      expect(released).toBe(true);
    });

    it('handles release for non-existent lock', async () => {
      // LocalBackend returns true even if lock doesn't exist (no lock file = success)
      const released = await stateLock.release('default', 'non-existent-lock-id');

      // The backend considers "no lock" as a successful release
      expect(released).toBe(true);
    });

    it('allows re-acquisition after release', async () => {
      const first = await stateLock.acquire('default', { operation: 'apply' });
      await stateLock.release('default', first.lockInfo!.id);

      const second = await stateLock.acquire('default', { operation: 'apply' });
      expect(second.acquired).toBe(true);
    });
  });

  // ============================================================================
  // forceRelease()
  // ============================================================================

  describe('forceRelease()', () => {
    it('force releases a held lock', async () => {
      await stateLock.acquire('default', { operation: 'apply' });
      const released = await stateLock.forceRelease('default');

      expect(released).toBe(true);
    });

    it('handles force release when no lock exists', async () => {
      // LocalBackend returns true for forceUnlock even if no lock exists
      const released = await stateLock.forceRelease('default');

      // The backend considers "no lock" as a successful release
      expect(released).toBe(true);
    });

    it('allows re-acquisition after force release', async () => {
      await stateLock.acquire('default', { operation: 'apply' });
      await stateLock.forceRelease('default');

      const result = await stateLock.acquire('default', { operation: 'apply' });
      expect(result.acquired).toBe(true);
    });
  });

  // ============================================================================
  // getLockInfo()
  // ============================================================================

  describe('getLockInfo()', () => {
    it('returns lock info when locked', async () => {
      await stateLock.acquire('default', {
        operation: 'apply',
        info: 'Test info',
      });

      const info = await stateLock.getLockInfo('default');

      expect(info).not.toBeNull();
      expect(info?.operation).toBe('apply');
      expect(info?.info).toBe('Test info');
    });

    it('returns null when not locked', async () => {
      const info = await stateLock.getLockInfo('default');

      expect(info).toBeNull();
    });
  });

  // ============================================================================
  // isLocked()
  // ============================================================================

  describe('isLocked()', () => {
    it('returns true when locked', async () => {
      await stateLock.acquire('default', { operation: 'apply' });

      const locked = await stateLock.isLocked('default');

      expect(locked).toBe(true);
    });

    it('returns false when not locked', async () => {
      const locked = await stateLock.isLocked('default');

      expect(locked).toBe(false);
    });
  });

  // ============================================================================
  // withLock()
  // ============================================================================

  describe('withLock()', () => {
    it('executes operation with lock', async () => {
      const result = await stateLock.withLock(
        'default',
        { operation: 'apply' },
        async () => 'success'
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('success');
    });

    it('releases lock after success', async () => {
      await stateLock.withLock('default', { operation: 'apply' }, async () => 'done');

      const locked = await stateLock.isLocked('default');
      expect(locked).toBe(false);
    });

    it('releases lock after error', async () => {
      try {
        await stateLock.withLock('default', { operation: 'apply' }, async () => {
          throw new Error('Test error');
        });
      } catch {
        // Expected
      }

      const locked = await stateLock.isLocked('default');
      expect(locked).toBe(false);
    });

    it('returns lock info on conflict', async () => {
      // Acquire lock first
      await stateLock.acquire('default', { operation: 'apply', who: 'other-process' });

      const result = await stateLock.withLock(
        'default',
        { operation: 'apply' },
        async () => 'never'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('lock');
    });
  });

  // ============================================================================
  // withLockCheck()
  // ============================================================================

  describe('withLockCheck()', () => {
    it('executes when not locked', async () => {
      const result = await stateLock.withLockCheck('default', async () => 'success');

      expect(result).toBe('success');
    });

    it('throws when locked', async () => {
      await stateLock.acquire('default', { operation: 'apply' });

      await expect(
        stateLock.withLockCheck('default', async () => 'never')
      ).rejects.toThrow(StateLockError);
    });
  });
});

// ============================================================================
// Utility Functions
// ============================================================================

describe('formatLockInfo()', () => {
  it('formats lock info for display', () => {
    const lockInfo: LockInfo = {
      id: 'test-lock-id',
      who: 'user@host',
      operation: 'apply',
      info: 'Applying changes',
      created: new Date().toISOString(),
      path: '.gaib/default.lock',
    };

    const formatted = formatLockInfo(lockInfo);

    expect(formatted).toContain('user@host');
    expect(formatted).toContain('apply');
    expect(formatted).toContain('test-lock-id');
    expect(formatted).toContain('Applying changes');
  });

  it('handles missing info field', () => {
    const lockInfo: LockInfo = {
      id: 'test-lock-id',
      who: 'user@host',
      operation: 'destroy',
      created: new Date().toISOString(),
      path: '.gaib/default.lock',
    };

    const formatted = formatLockInfo(lockInfo);

    expect(formatted).toContain('user@host');
    expect(formatted).toContain('destroy');
  });
});

describe('isLockStale()', () => {
  it('returns false for recent lock', () => {
    const lockInfo: LockInfo = {
      id: 'test-lock-id',
      who: 'user@host',
      operation: 'apply',
      created: new Date().toISOString(),
      path: '.gaib/default.lock',
    };

    expect(isLockStale(lockInfo)).toBe(false);
  });

  it('returns true for old lock (default threshold)', () => {
    const oldDate = new Date();
    oldDate.setHours(oldDate.getHours() - 2); // 2 hours ago

    const lockInfo: LockInfo = {
      id: 'test-lock-id',
      who: 'user@host',
      operation: 'apply',
      created: oldDate.toISOString(),
      path: '.gaib/default.lock',
    };

    expect(isLockStale(lockInfo)).toBe(true);
  });

  it('respects custom threshold', () => {
    const recentDate = new Date();
    recentDate.setMinutes(recentDate.getMinutes() - 10); // 10 minutes ago

    const lockInfo: LockInfo = {
      id: 'test-lock-id',
      who: 'user@host',
      operation: 'apply',
      created: recentDate.toISOString(),
      path: '.gaib/default.lock',
    };

    // 5 minute threshold - lock should be stale
    expect(isLockStale(lockInfo, 5 * 60 * 1000)).toBe(true);

    // 15 minute threshold - lock should not be stale
    expect(isLockStale(lockInfo, 15 * 60 * 1000)).toBe(false);
  });
});
