/**
 * WizardSessionStore Unit Tests
 *
 * Sprint 42: WizardEngine & Session Store
 *
 * Tests for Redis-backed session storage with mocked Redis client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Redis } from 'ioredis';
import {
  WizardSessionStore,
  SessionStoreError,
  createWizardSessionStore,
} from '../../../../src/packages/wizard/WizardSessionStore.js';
import {
  WizardSession,
  CreateSessionParams,
  serializeSession,
  createWizardSession,
} from '../../../../src/packages/wizard/WizardSession.js';
import { WizardState } from '../../../../src/packages/wizard/WizardState.js';

// Mock Redis client
function createMockRedis() {
  const storage = new Map<string, string>();
  const sets = new Map<string, Set<string>>();

  return {
    get: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    setex: vi.fn((key: string, ttl: number, value: string) => {
      storage.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn((key: string) => {
      const deleted = storage.delete(key) ? 1 : 0;
      return Promise.resolve(deleted);
    }),
    sadd: vi.fn((key: string, member: string) => {
      let set = sets.get(key);
      if (!set) {
        set = new Set();
        sets.set(key, set);
      }
      const added = set.has(member) ? 0 : 1;
      set.add(member);
      return Promise.resolve(added);
    }),
    srem: vi.fn((key: string, member: string) => {
      const set = sets.get(key);
      if (!set) return Promise.resolve(0);
      const removed = set.delete(member) ? 1 : 0;
      return Promise.resolve(removed);
    }),
    smembers: vi.fn((key: string) => {
      const set = sets.get(key);
      return Promise.resolve(set ? Array.from(set) : []);
    }),
    keys: vi.fn((pattern: string) => {
      const prefix = pattern.replace('*', '');
      const keys = Array.from(storage.keys()).filter((k) => k.startsWith(prefix));
      return Promise.resolve(keys);
    }),
    ping: vi.fn(() => Promise.resolve('PONG')),
    pipeline: vi.fn(() => {
      const commands: Array<{ method: string; args: unknown[] }> = [];
      const pipe = {
        setex: (key: string, ttl: number, value: string) => {
          commands.push({ method: 'setex', args: [key, ttl, value] });
          return pipe;
        },
        del: (key: string) => {
          commands.push({ method: 'del', args: [key] });
          return pipe;
        },
        sadd: (key: string, member: string) => {
          commands.push({ method: 'sadd', args: [key, member] });
          return pipe;
        },
        srem: (key: string, member: string) => {
          commands.push({ method: 'srem', args: [key, member] });
          return pipe;
        },
        exec: async () => {
          const results = [];
          for (const cmd of commands) {
            if (cmd.method === 'setex') {
              storage.set(cmd.args[0] as string, cmd.args[2] as string);
              results.push([null, 'OK']);
            } else if (cmd.method === 'del') {
              const deleted = storage.delete(cmd.args[0] as string) ? 1 : 0;
              results.push([null, deleted]);
            } else if (cmd.method === 'sadd') {
              let set = sets.get(cmd.args[0] as string);
              if (!set) {
                set = new Set();
                sets.set(cmd.args[0] as string, set);
              }
              set.add(cmd.args[1] as string);
              results.push([null, 1]);
            } else if (cmd.method === 'srem') {
              const set = sets.get(cmd.args[0] as string);
              if (set) set.delete(cmd.args[1] as string);
              results.push([null, 1]);
            }
          }
          return results;
        },
      };
      return pipe;
    }),
    _storage: storage,
    _sets: sets,
  } as unknown as Redis & { _storage: Map<string, string>; _sets: Map<string, Set<string>> };
}

describe('WizardSessionStore', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let store: WizardSessionStore;

  const defaultParams: CreateSessionParams = {
    guildId: 'guild_123',
    userId: 'user_456',
    channelId: 'channel_789',
  };

  beforeEach(() => {
    redis = createMockRedis();
    store = new WizardSessionStore({ redis, keyPrefix: 'test-wizard', ttl: 900 });
  });

  describe('create', () => {
    it('should create a new session', async () => {
      const session = await store.create(defaultParams);

      expect(session.id).toMatch(/^wiz_/);
      expect(session.guildId).toBe(defaultParams.guildId);
      expect(session.userId).toBe(defaultParams.userId);
      expect(session.channelId).toBe(defaultParams.channelId);
      expect(session.state).toBe(WizardState.INIT);
    });

    it('should store session in Redis', async () => {
      const session = await store.create(defaultParams);

      const stored = await store.get(session.id);
      expect(stored).not.toBeNull();
      expect(stored?.id).toBe(session.id);
    });

    it('should throw if user already has active session', async () => {
      await store.create(defaultParams);

      await expect(store.create(defaultParams)).rejects.toThrow(SessionStoreError);
    });

    it('should allow new session if previous was completed', async () => {
      const first = await store.create(defaultParams);
      // Manually mark as complete
      await store.update(first.id, { state: WizardState.CHAIN_SELECT });
      await store.update(first.id, { state: WizardState.ASSET_CONFIG });
      await store.update(first.id, { state: WizardState.ELIGIBILITY_RULES });
      await store.update(first.id, { state: WizardState.ROLE_MAPPING });
      await store.update(first.id, { state: WizardState.CHANNEL_STRUCTURE });
      await store.update(first.id, { state: WizardState.REVIEW });
      await store.update(first.id, { state: WizardState.DEPLOY });
      await store.update(first.id, { state: WizardState.COMPLETE });

      const second = await store.create(defaultParams);
      expect(second.id).not.toBe(first.id);
    });
  });

  describe('get', () => {
    it('should return session by ID', async () => {
      const created = await store.create(defaultParams);
      const retrieved = await store.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const result = await store.get('wiz_nonexistent_123');
      expect(result).toBeNull();
    });
  });

  describe('getActiveSessionId', () => {
    it('should return active session ID for user', async () => {
      const session = await store.create(defaultParams);
      const activeId = await store.getActiveSessionId(
        defaultParams.guildId,
        defaultParams.userId
      );

      expect(activeId).toBe(session.id);
    });

    it('should return null if no active session', async () => {
      const activeId = await store.getActiveSessionId('guild_new', 'user_new');
      expect(activeId).toBeNull();
    });
  });

  describe('getActiveSession', () => {
    it('should return active session for user', async () => {
      const session = await store.create(defaultParams);
      const active = await store.getActiveSession(
        defaultParams.guildId,
        defaultParams.userId
      );

      expect(active).not.toBeNull();
      expect(active?.id).toBe(session.id);
    });
  });

  describe('update', () => {
    it('should update session state', async () => {
      const session = await store.create(defaultParams);
      const updated = await store.update(session.id, {
        state: WizardState.CHAIN_SELECT,
      });

      expect(updated.state).toBe(WizardState.CHAIN_SELECT);
      expect(updated.stepCount).toBe(1);
      expect(updated.history).toContain(WizardState.INIT);
    });

    it('should update session data', async () => {
      const session = await store.create(defaultParams);
      const updated = await store.update(session.id, {
        data: { chainId: 'ethereum' },
      });

      expect(updated.data.chainId).toBe('ethereum');
    });

    it('should merge data updates', async () => {
      const session = await store.create(defaultParams);
      await store.update(session.id, { data: { chainId: 'ethereum' } });
      const updated = await store.update(session.id, {
        data: { assets: [{ type: 'native', address: null, symbol: 'ETH' }] },
      });

      expect(updated.data.chainId).toBe('ethereum');
      expect(updated.data.assets).toHaveLength(1);
    });

    it('should throw for invalid state transition', async () => {
      const session = await store.create(defaultParams);

      await expect(
        store.update(session.id, { state: WizardState.COMPLETE })
      ).rejects.toThrow(SessionStoreError);
    });

    it('should throw for non-existent session', async () => {
      await expect(
        store.update('wiz_nonexistent', { state: WizardState.CHAIN_SELECT })
      ).rejects.toThrow(SessionStoreError);
    });

    it('should update timestamps', async () => {
      const session = await store.create(defaultParams);
      const originalUpdatedAt = session.updatedAt;

      // Wait a bit to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const updated = await store.update(session.id, { data: { chainId: 'ethereum' } });
      expect(updated.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('transition', () => {
    it('should transition to next state', async () => {
      const session = await store.create(defaultParams);
      const updated = await store.transition(session.id, WizardState.CHAIN_SELECT);

      expect(updated.state).toBe(WizardState.CHAIN_SELECT);
    });

    it('should transition with data', async () => {
      const session = await store.create(defaultParams);
      const updated = await store.transition(session.id, WizardState.CHAIN_SELECT, {
        chainId: 'berachain',
      });

      expect(updated.state).toBe(WizardState.CHAIN_SELECT);
      expect(updated.data.chainId).toBe('berachain');
    });
  });

  describe('fail', () => {
    it('should mark session as failed', async () => {
      const session = await store.create(defaultParams);
      const failed = await store.fail(session.id, 'Test error');

      expect(failed.state).toBe(WizardState.FAILED);
      expect(failed.error).toBe('Test error');
    });
  });

  describe('delete', () => {
    it('should delete session', async () => {
      const session = await store.create(defaultParams);
      const deleted = await store.delete(session.id);

      expect(deleted).toBe(true);

      const retrieved = await store.get(session.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent session', async () => {
      const deleted = await store.delete('wiz_nonexistent');
      expect(deleted).toBe(false);
    });

    it('should clear user active session lookup', async () => {
      const session = await store.create(defaultParams);
      await store.delete(session.id);

      const activeId = await store.getActiveSessionId(
        defaultParams.guildId,
        defaultParams.userId
      );
      expect(activeId).toBeNull();
    });
  });

  describe('extendTTL', () => {
    it('should extend session TTL', async () => {
      const session = await store.create(defaultParams);
      const originalExpiry = new Date(session.expiresAt).getTime();

      const extended = await store.extendTTL(session.id, 1800); // 30 minutes
      expect(extended).toBe(true);

      const updated = await store.get(session.id);
      expect(new Date(updated!.expiresAt).getTime()).toBeGreaterThan(originalExpiry);
    });

    it('should return false for terminal session', async () => {
      const session = await store.create(defaultParams);
      // Transition to complete
      await store.transition(session.id, WizardState.CHAIN_SELECT);
      await store.transition(session.id, WizardState.ASSET_CONFIG);
      await store.transition(session.id, WizardState.ELIGIBILITY_RULES);
      await store.transition(session.id, WizardState.ROLE_MAPPING);
      await store.transition(session.id, WizardState.CHANNEL_STRUCTURE);
      await store.transition(session.id, WizardState.REVIEW);
      await store.transition(session.id, WizardState.DEPLOY);
      await store.transition(session.id, WizardState.COMPLETE);

      const extended = await store.extendTTL(session.id);
      expect(extended).toBe(false);
    });
  });

  describe('query', () => {
    it('should query sessions by guildId', async () => {
      await store.create({ ...defaultParams, guildId: 'guild_A', userId: 'user_1' });
      await store.create({ ...defaultParams, guildId: 'guild_A', userId: 'user_2' });
      await store.create({ ...defaultParams, guildId: 'guild_B', userId: 'user_3' });

      const result = await store.query({ guildId: 'guild_A' });
      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should filter by state', async () => {
      const session1 = await store.create({ ...defaultParams, userId: 'user_1' });
      await store.create({ ...defaultParams, userId: 'user_2' });

      // Advance first session
      await store.transition(session1.id, WizardState.CHAIN_SELECT);

      const result = await store.query({
        guildId: defaultParams.guildId,
        state: WizardState.CHAIN_SELECT,
      });
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].id).toBe(session1.id);
    });
  });

  describe('healthCheck', () => {
    it('should return true when Redis is healthy', async () => {
      const healthy = await store.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should return false when Redis fails', async () => {
      (redis.ping as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Connection failed')
      );

      const healthy = await store.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('createWizardSessionStore', () => {
    it('should create store instance', () => {
      const newStore = createWizardSessionStore(redis, { keyPrefix: 'custom' });
      expect(newStore).toBeInstanceOf(WizardSessionStore);
    });
  });
});
