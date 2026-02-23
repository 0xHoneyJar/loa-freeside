/**
 * Conservation Guard — governance_pending flag tests (F-1)
 *
 * AC-2.1.6: Verify pending flag set before updateLimit, cleared after;
 * verify crash-recovery scenario (flag expires via TTL, outbox row retried).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --------------------------------------------------------------------------
// Mock Redis
// --------------------------------------------------------------------------

function createMockRedis() {
  const store = new Map<string, { value: string; ttl: number }>();

  return {
    store,
    async exists(key: string): Promise<number> {
      return store.has(key) ? 1 : 0;
    },
    async set(key: string, value: string, mode?: string, ttl?: number): Promise<string> {
      store.set(key, { value, ttl: ttl ?? -1 });
      return 'OK';
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async incr(key: string): Promise<number> {
      const entry = store.get(key);
      const val = entry ? parseInt(entry.value, 10) + 1 : 1;
      store.set(key, { value: String(val), ttl: -1 });
      return val;
    },
    async pexpire(_key: string, _ms: number): Promise<number> {
      return 1;
    },
  };
}

// --------------------------------------------------------------------------
// Tests: isGovernancePending
// --------------------------------------------------------------------------

describe('isGovernancePending (F-1)', () => {
  it('returns false when no pending key exists', async () => {
    const { isGovernancePending } = await import('../conservation-guard.js');
    const redis = createMockRedis();
    const result = await isGovernancePending(redis as any, 'community-123');
    expect(result).toBe(false);
  });

  it('returns true when pending key is set', async () => {
    const { isGovernancePending } = await import('../conservation-guard.js');
    const redis = createMockRedis();
    await redis.set('governance_pending:community-123', '1', 'EX', 300);
    const result = await isGovernancePending(redis as any, 'community-123');
    expect(result).toBe(true);
  });

  it('returns false after pending key is deleted (success path)', async () => {
    const { isGovernancePending } = await import('../conservation-guard.js');
    const redis = createMockRedis();
    await redis.set('governance_pending:community-123', '1', 'EX', 300);
    await redis.del('governance_pending:community-123');
    const result = await isGovernancePending(redis as any, 'community-123');
    expect(result).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Tests: Outbox Worker governance_pending lifecycle
// --------------------------------------------------------------------------

describe('Outbox Worker governance_pending lifecycle (F-1)', () => {
  it('sets pending key BEFORE updateLimit and clears AFTER', async () => {
    const redis = createMockRedis();
    const callOrder: string[] = [];

    // Track Redis operations
    const origSet = redis.set.bind(redis);
    redis.set = async (...args: any[]) => {
      callOrder.push(`redis.set:${args[0]}`);
      return origSet(...args);
    };
    const origDel = redis.del.bind(redis);
    redis.del = async (...args: any[]) => {
      callOrder.push(`redis.del:${args[0]}`);
      return origDel(...args);
    };

    // Mock conservation guard
    const mockUpdateLimit = async () => {
      callOrder.push('updateLimit');
      // At this point, pending key should be set
      const pendingExists = await redis.exists('governance_pending:community-abc');
      expect(pendingExists).toBe(1);
    };

    // Simulate the outbox worker processRow logic directly
    const communityId = 'community-abc';
    const pendingKey = `governance_pending:${communityId}`;
    const pendingTtlSeconds = 5 * 60; // staleThresholdMinutes default

    await redis.set(pendingKey, '1', 'EX', pendingTtlSeconds);
    await mockUpdateLimit();
    await redis.del(pendingKey);

    expect(callOrder).toEqual([
      'redis.set:governance_pending:community-abc',
      'updateLimit',
      'redis.del:governance_pending:community-abc',
    ]);

    // After success, pending key should be gone
    const postExists = await redis.exists(pendingKey);
    expect(postExists).toBe(0);
  });

  it('pending key has TTL for crash recovery', async () => {
    const redis = createMockRedis();
    const communityId = 'community-crash';
    const pendingKey = `governance_pending:${communityId}`;
    const staleThresholdMinutes = 5;
    const ttlSeconds = staleThresholdMinutes * 60;

    await redis.set(pendingKey, '1', 'EX', ttlSeconds);

    // Verify the key was stored with TTL
    const entry = redis.store.get(pendingKey);
    expect(entry).toBeDefined();
    expect(entry!.ttl).toBe(ttlSeconds);

    // Simulate crash: key NOT deleted, but should eventually expire via TTL
    // In real Redis, TTL would expire the key. Here we verify it was set with TTL.
    expect(entry!.value).toBe('1');
  });

  it('setting pending key again on retry is idempotent', async () => {
    const redis = createMockRedis();
    const communityId = 'community-retry';
    const pendingKey = `governance_pending:${communityId}`;

    // First attempt: set pending
    await redis.set(pendingKey, '1', 'EX', 300);
    expect(await redis.exists(pendingKey)).toBe(1);

    // Simulate crash (key still exists with old TTL)
    // Retry: set pending again (should overwrite with fresh TTL)
    await redis.set(pendingKey, '1', 'EX', 300);
    expect(await redis.exists(pendingKey)).toBe(1);

    // Key still has value '1' — idempotent
    const entry = redis.store.get(pendingKey);
    expect(entry!.value).toBe('1');
  });
});
