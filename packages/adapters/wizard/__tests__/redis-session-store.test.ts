/**
 * RedisWizardSessionStore Tests
 *
 * Sprint S-20: Wizard Session Store & State Model
 *
 * Comprehensive tests for:
 * - Session CRUD operations
 * - State machine transitions
 * - IP binding security
 * - Guild indexing
 * - TTL behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RedisWizardSessionStore } from '../redis-session-store.js';
import type { RedisClient } from '../redis-session-store.js';
import { WizardState } from '@freeside/core/domain';
import type { NewWizardSession } from '@freeside/core/domain';

// =============================================================================
// Mock Redis Client
// =============================================================================

class MockRedisClient implements RedisClient {
  private store = new Map<string, { value: string; expiry: number }>();
  private counters = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiry > 0 && Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.store.set(key, { value, expiry: 0 });
    return 'OK';
  }

  async setex(key: string, seconds: number, value: string): Promise<unknown> {
    this.store.set(key, { value, expiry: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let count = 0;
    for (const k of keys) {
      if (this.store.delete(k)) count++;
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const item = this.store.get(key);
    if (!item) return 0;
    item.expiry = Date.now() + seconds * 1000;
    return 1;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.has(key)) count++;
    }
    return count;
  }

  async incr(key: string): Promise<number> {
    const current = this.counters.get(key) ?? 0;
    const next = current + 1;
    this.counters.set(key, next);
    return next;
  }

  async incrby(key: string, increment: number): Promise<number> {
    const current = this.counters.get(key) ?? 0;
    const next = current + increment;
    this.counters.set(key, next);
    return next;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace('*', '');
    return Array.from(this.store.keys()).filter((k) => k.startsWith(prefix));
  }

  async quit(): Promise<unknown> {
    return 'OK';
  }

  // Test helpers
  clear(): void {
    this.store.clear();
    this.counters.clear();
  }

  getAll(): Map<string, { value: string; expiry: number }> {
    return this.store;
  }
}

// =============================================================================
// Mock Logger
// =============================================================================

const createMockLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

// =============================================================================
// Test Data
// =============================================================================

const createTestSession = (overrides: Partial<NewWizardSession> = {}): NewWizardSession => ({
  communityId: 'community-123',
  guildId: 'guild-456',
  userId: 'user-789',
  state: WizardState.INIT,
  data: {},
  ...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe('RedisWizardSessionStore', () => {
  let redis: MockRedisClient;
  let logger: ReturnType<typeof createMockLogger>;
  let store: RedisWizardSessionStore;

  beforeEach(() => {
    redis = new MockRedisClient();
    logger = createMockLogger();
    store = new RedisWizardSessionStore({
      redis,
      logger: logger as unknown as import('pino').Logger,
      ttlSeconds: 900,
    });
  });

  afterEach(() => {
    redis.clear();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should use default TTL when not specified', () => {
      const defaultStore = new RedisWizardSessionStore({
        redis,
        logger: logger as unknown as import('pino').Logger,
      });
      expect(defaultStore.ttlSeconds).toBe(900);
    });

    it('should use custom TTL when specified', () => {
      const customStore = new RedisWizardSessionStore({
        redis,
        logger: logger as unknown as import('pino').Logger,
        ttlSeconds: 300,
      });
      expect(customStore.ttlSeconds).toBe(300);
    });
  });

  // ===========================================================================
  // CRUD Tests
  // ===========================================================================

  describe('create', () => {
    it('should create a new session with generated fields', async () => {
      const input = createTestSession();
      const session = await store.create(input);

      expect(session.id).toBeDefined();
      expect(session.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(session.communityId).toBe(input.communityId);
      expect(session.guildId).toBe(input.guildId);
      expect(session.userId).toBe(input.userId);
      expect(session.state).toBe(WizardState.INIT);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.updatedAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
    });

    it('should store session in Redis with TTL', async () => {
      const input = createTestSession();
      const session = await store.create(input);

      const stored = redis.getAll();
      expect(stored.has(`wizard:session:${session.id}`)).toBe(true);
    });

    it('should create guild index', async () => {
      const input = createTestSession();
      const session = await store.create(input);

      const guildIndex = await redis.get(`wizard:guild:${input.guildId}`);
      expect(guildIndex).toBe(session.id);
    });

    it('should throw if session already exists for guild', async () => {
      const input = createTestSession();
      await store.create(input);

      await expect(store.create(input)).rejects.toThrow(
        `Session already exists for guild ${input.guildId}`
      );
    });

    it('should log session creation', async () => {
      const input = createTestSession();
      await store.create(input);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: input.guildId,
          userId: input.userId,
        }),
        'Wizard session created'
      );
    });
  });

  describe('get', () => {
    it('should return session by ID', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const session = await store.get(created.id);
      expect(session).not.toBeNull();
      expect(session!.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const session = await store.get('non-existent-id');
      expect(session).toBeNull();
    });

    it('should deserialize dates correctly', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const session = await store.get(created.id);
      expect(session!.createdAt).toBeInstanceOf(Date);
      expect(session!.updatedAt).toBeInstanceOf(Date);
      expect(session!.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('getByGuild', () => {
    it('should return session by guild ID', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const session = await store.getByGuild(input.guildId);
      expect(session).not.toBeNull();
      expect(session!.id).toBe(created.id);
    });

    it('should return null for non-existent guild', async () => {
      const session = await store.getByGuild('non-existent-guild');
      expect(session).toBeNull();
    });
  });

  describe('update', () => {
    it('should update session fields', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const updated = await store.update(created.id, {
        data: { communityName: 'Test Community' },
      });

      expect(updated).not.toBeNull();
      expect(updated!.data.communityName).toBe('Test Community');
    });

    it('should refresh updatedAt timestamp', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      // Wait a bit to ensure time difference
      await new Promise((r) => setTimeout(r, 10));

      const updated = await store.update(created.id, {
        data: { communityName: 'Test' },
      });

      expect(updated!.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    });

    it('should not allow changing immutable fields', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const updated = await store.update(created.id, {
        id: 'new-id',
        guildId: 'new-guild',
        communityId: 'new-community',
        createdAt: new Date(0),
      } as Partial<import('@freeside/core/domain').WizardSession>);

      expect(updated!.id).toBe(created.id);
      expect(updated!.guildId).toBe(created.guildId);
      expect(updated!.communityId).toBe(created.communityId);
      expect(updated!.createdAt.getTime()).toBe(created.createdAt.getTime());
    });

    it('should return null for non-existent session', async () => {
      const updated = await store.update('non-existent', { data: {} });
      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete session', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const deleted = await store.delete(created.id);
      expect(deleted).toBe(true);

      const session = await store.get(created.id);
      expect(session).toBeNull();
    });

    it('should delete guild index', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      await store.delete(created.id);

      const exists = await store.existsForGuild(input.guildId);
      expect(exists).toBe(false);
    });

    it('should return false for non-existent session', async () => {
      const deleted = await store.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteByGuild', () => {
    it('should delete session by guild ID', async () => {
      const input = createTestSession();
      await store.create(input);

      const deleted = await store.deleteByGuild(input.guildId);
      expect(deleted).toBe(true);

      const session = await store.getByGuild(input.guildId);
      expect(session).toBeNull();
    });

    it('should return false for non-existent guild', async () => {
      const deleted = await store.deleteByGuild('non-existent');
      expect(deleted).toBe(false);
    });
  });

  // ===========================================================================
  // State Machine Tests
  // ===========================================================================

  describe('transition', () => {
    it('should allow valid forward transition', async () => {
      const input = createTestSession({
        state: WizardState.INIT,
        data: { communityName: 'Test Community' },
      });
      const created = await store.create(input);

      const result = await store.transition(created.id, WizardState.CHAIN_SELECT);

      expect(result.success).toBe(true);
      expect(result.session!.state).toBe(WizardState.CHAIN_SELECT);
    });

    it('should allow valid backward transition', async () => {
      const input = createTestSession({
        state: WizardState.CHAIN_SELECT,
        data: { communityName: 'Test Community', chains: [] },
      });
      const created = await store.create(input);

      const result = await store.transition(created.id, WizardState.INIT);

      expect(result.success).toBe(true);
      expect(result.session!.state).toBe(WizardState.INIT);
    });

    it('should reject invalid transition', async () => {
      const input = createTestSession({ state: WizardState.INIT });
      const created = await store.create(input);

      // Trying to skip from INIT to ASSET_CONFIG
      const result = await store.transition(created.id, WizardState.ASSET_CONFIG);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('should reject transition from terminal state', async () => {
      const input = createTestSession({
        state: WizardState.DEPLOY,
        data: {
          communityName: 'Test',
          chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
          assets: [{ id: '1', type: 'erc20', contractAddress: '0x', chainId: 'ethereum', name: 'Test', symbol: 'TST' }],
          rules: [{ id: '1', type: 'min_balance', assetId: '1', parameters: {}, description: 'test' }],
          tierRoles: [{ tierId: 'gold', roleName: 'Gold', roleColor: 0, mentionable: false, hoist: false }],
          channelTemplate: 'none',
          manifest: {
            version: '1.0',
            name: 'Test',
            themeId: 'basic',
            chains: [],
            assets: [],
            rules: [],
            tierRoles: [],
            channelTemplate: 'none',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          validated: true,
        },
      });
      const created = await store.create(input);

      // DEPLOY is terminal, no transitions allowed
      const result = await store.transition(created.id, WizardState.REVIEW);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid state transition');
    });

    it('should merge data on transition', async () => {
      const input = createTestSession({
        state: WizardState.INIT,
        data: { communityName: 'Test Community' },
      });
      const created = await store.create(input);

      const result = await store.transition(created.id, WizardState.CHAIN_SELECT, {
        chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
      });

      expect(result.success).toBe(true);
      expect(result.session!.data.communityName).toBe('Test Community');
      expect(result.session!.data.chains).toHaveLength(1);
    });

    it('should return error for non-existent session', async () => {
      const result = await store.transition('non-existent', WizardState.CHAIN_SELECT);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
    });
  });

  // ===========================================================================
  // Security Tests
  // ===========================================================================

  describe('validateSession', () => {
    it('should validate existing session', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const result = await store.validateSession(created.id, '192.168.1.1');

      expect(result.valid).toBe(true);
      expect(result.session).toBeDefined();
    });

    it('should return not_found for non-existent session', async () => {
      const result = await store.validateSession('non-existent', '192.168.1.1');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should return ip_mismatch for wrong IP', async () => {
      const input = createTestSession({ ipAddress: '192.168.1.1' });
      const created = await store.create(input);

      const result = await store.validateSession(created.id, '10.0.0.1');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ip_mismatch');
    });

    it('should pass validation when no IP is bound', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const result = await store.validateSession(created.id, 'any-ip');

      expect(result.valid).toBe(true);
    });
  });

  describe('bindToIp', () => {
    it('should bind session to IP', async () => {
      const input = createTestSession();
      const created = await store.create(input);

      const updated = await store.bindToIp(created.id, '192.168.1.1');

      expect(updated).not.toBeNull();
      expect(updated!.ipAddress).toBe('192.168.1.1');
    });

    it('should not rebind already bound session', async () => {
      const input = createTestSession({ ipAddress: '192.168.1.1' });
      const created = await store.create(input);

      const updated = await store.bindToIp(created.id, '10.0.0.1');

      expect(updated!.ipAddress).toBe('192.168.1.1');
    });

    it('should return null for non-existent session', async () => {
      const updated = await store.bindToIp('non-existent', '192.168.1.1');
      expect(updated).toBeNull();
    });
  });

  // ===========================================================================
  // Utility Tests
  // ===========================================================================

  describe('refresh', () => {
    it('should refresh session TTL', async () => {
      const input = createTestSession();
      const created = await store.create(input);
      const originalExpiry = created.expiresAt;

      // Wait a bit
      await new Promise((r) => setTimeout(r, 10));

      const refreshed = await store.refresh(created.id);
      expect(refreshed).toBe(true);

      const updated = await store.get(created.id);
      expect(updated!.expiresAt.getTime()).toBeGreaterThan(originalExpiry.getTime());
    });

    it('should return false for non-existent session', async () => {
      const refreshed = await store.refresh('non-existent');
      expect(refreshed).toBe(false);
    });
  });

  describe('existsForGuild', () => {
    it('should return true when session exists', async () => {
      const input = createTestSession();
      await store.create(input);

      const exists = await store.existsForGuild(input.guildId);
      expect(exists).toBe(true);
    });

    it('should return false when no session exists', async () => {
      const exists = await store.existsForGuild('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      // Create sessions in different states
      await store.create(createTestSession({ guildId: 'guild-1' }));
      await store.create(createTestSession({ guildId: 'guild-2' }));

      const stats = await store.getStats();

      expect(stats.activeSessions).toBe(2);
      expect(stats.sessionsByState[WizardState.INIT]).toBe(2);
    });

    it('should handle empty store', async () => {
      const stats = await store.getStats();

      expect(stats.activeSessions).toBe(0);
      expect(stats.averageDurationSeconds).toBe(0);
    });
  });

  describe('close', () => {
    it('should close Redis connection', async () => {
      await store.close();

      expect(logger.info).toHaveBeenCalledWith('Wizard session store closed');
    });
  });
});

// =============================================================================
// State Machine Validation Tests
// =============================================================================

describe('State Machine Validation', () => {
  let redis: MockRedisClient;
  let logger: ReturnType<typeof createMockLogger>;
  let store: RedisWizardSessionStore;

  beforeEach(() => {
    redis = new MockRedisClient();
    logger = createMockLogger();
    store = new RedisWizardSessionStore({
      redis,
      logger: logger as unknown as import('pino').Logger,
    });
  });

  afterEach(() => {
    redis.clear();
  });

  it('should validate data requirements for CHAIN_SELECT', async () => {
    const session = await store.create(createTestSession({ data: {} }));

    // Missing communityName - should fail
    const result = await store.transition(session.id, WizardState.CHAIN_SELECT);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Community name is required');
  });

  it('should validate data requirements for ASSET_CONFIG', async () => {
    const session = await store.create(
      createTestSession({
        state: WizardState.CHAIN_SELECT,
        data: { communityName: 'Test' },
      })
    );

    // Missing chains - should fail
    const result = await store.transition(session.id, WizardState.ASSET_CONFIG);

    expect(result.success).toBe(false);
    expect(result.error).toContain('At least one chain must be selected');
  });

  it('should validate full wizard flow', async () => {
    // INIT -> CHAIN_SELECT
    let session = await store.create(
      createTestSession({ data: { communityName: 'Test Community' } })
    );
    let result = await store.transition(session.id, WizardState.CHAIN_SELECT);
    expect(result.success).toBe(true);

    // CHAIN_SELECT -> ASSET_CONFIG
    result = await store.transition(session.id, WizardState.ASSET_CONFIG, {
      chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
    });
    expect(result.success).toBe(true);

    // ASSET_CONFIG -> ELIGIBILITY_RULES
    result = await store.transition(session.id, WizardState.ELIGIBILITY_RULES, {
      assets: [
        {
          id: '1',
          type: 'erc20',
          contractAddress: '0x',
          chainId: 'ethereum',
          name: 'Test Token',
          symbol: 'TST',
        },
      ],
    });
    expect(result.success).toBe(true);

    // ELIGIBILITY_RULES -> ROLE_MAPPING
    result = await store.transition(session.id, WizardState.ROLE_MAPPING, {
      rules: [
        {
          id: '1',
          type: 'min_balance',
          assetId: '1',
          parameters: { amount: 100 },
          description: 'Min 100 TST',
        },
      ],
    });
    expect(result.success).toBe(true);

    // ROLE_MAPPING -> CHANNEL_STRUCTURE
    result = await store.transition(session.id, WizardState.CHANNEL_STRUCTURE, {
      tierRoles: [
        {
          tierId: 'gold',
          roleName: 'Gold Member',
          roleColor: 0xffd700,
          mentionable: false,
          hoist: true,
        },
      ],
    });
    expect(result.success).toBe(true);

    // CHANNEL_STRUCTURE -> REVIEW
    result = await store.transition(session.id, WizardState.REVIEW, {
      channelTemplate: 'none',
    });
    expect(result.success).toBe(true);

    // REVIEW -> DEPLOY
    result = await store.transition(session.id, WizardState.DEPLOY, {
      manifest: {
        version: '1.0',
        name: 'Test Community',
        themeId: 'basic',
        chains: [],
        assets: [],
        rules: [],
        tierRoles: [],
        channelTemplate: 'none',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      validated: true,
    });
    expect(result.success).toBe(true);
    expect(result.session!.state).toBe(WizardState.DEPLOY);
  });
});
