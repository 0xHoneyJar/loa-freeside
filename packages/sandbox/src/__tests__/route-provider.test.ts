/**
 * RouteProvider Tests
 *
 * Sprint 86: Discord Server Sandboxes - Event Routing
 *
 * Unit tests for RouteProvider service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RouteProvider } from '../services/route-provider.js';
import type { Logger } from 'pino';

// Mock logger
const createMockLogger = (): Logger => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => logger),
  } as unknown as Logger;
  return logger;
};

// Mock SQL client with tagged template support
const createMockSql = () => {
  const mockResults: unknown[] = [];
  let callIndex = 0;

  const mockSql = vi.fn((..._args: unknown[]) => {
    const result = mockResults[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(result);
  });

  (mockSql as any).mockResolvedValueOnce = (value: unknown) => {
    mockResults.push(value);
    return mockSql;
  };

  (mockSql as any).resetMocks = () => {
    mockResults.length = 0;
    callIndex = 0;
  };

  return mockSql;
};

// Mock Redis client
const createMockRedis = () => {
  const store = new Map<string, string>();

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    }),
    _store: store,
    _clear: () => store.clear(),
  };
};

describe('RouteProvider', () => {
  let provider: RouteProvider;
  let mockSql: ReturnType<typeof createMockSql>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSql = createMockSql();
    mockRedis = createMockRedis();
    mockLogger = createMockLogger();
    mockRedis._clear();

    provider = new RouteProvider({
      sql: mockSql as any,
      redis: mockRedis as any,
      logger: mockLogger,
      cacheTtlMs: 60000,
    });
  });

  describe('getSandboxForGuild', () => {
    it('should return cached result on cache hit', async () => {
      const guildId = '123456789012345678';
      const sandboxId = 'sandbox-uuid';

      // Pre-populate cache
      mockRedis._store.set(`sandbox:route:${guildId}`, sandboxId);

      const result = await provider.getSandboxForGuild(guildId);

      expect(result.sandboxId).toBe(sandboxId);
      expect(result.cached).toBe(true);
      expect(mockSql).not.toHaveBeenCalled();
    });

    it('should return null sentinel as null on cache hit', async () => {
      const guildId = '123456789012345678';

      // Pre-populate cache with NULL sentinel
      mockRedis._store.set(`sandbox:route:${guildId}`, '__NULL__');

      const result = await provider.getSandboxForGuild(guildId);

      expect(result.sandboxId).toBeNull();
      expect(result.cached).toBe(true);
      expect(mockSql).not.toHaveBeenCalled();
    });

    it('should query database on cache miss', async () => {
      const guildId = '123456789012345678';
      const sandboxId = 'sandbox-uuid';

      // Mock database response
      (mockSql as any).mockResolvedValueOnce([{ sandbox_id: sandboxId }]);

      const result = await provider.getSandboxForGuild(guildId);

      expect(result.sandboxId).toBe(sandboxId);
      expect(result.cached).toBe(false);
      expect(mockSql).toHaveBeenCalled();
    });

    it('should cache null result with sentinel value', async () => {
      const guildId = '123456789012345678';

      // Mock database response - no mapping found
      (mockSql as any).mockResolvedValueOnce([]);

      const result = await provider.getSandboxForGuild(guildId);

      expect(result.sandboxId).toBeNull();
      expect(result.cached).toBe(false);

      // Verify NULL sentinel was cached
      expect(mockRedis.set).toHaveBeenCalledWith(
        `sandbox:route:${guildId}`,
        '__NULL__',
        'PX',
        60000
      );
    });

    it('should cache valid sandbox ID', async () => {
      const guildId = '123456789012345678';
      const sandboxId = 'sandbox-uuid';

      // Mock database response
      (mockSql as any).mockResolvedValueOnce([{ sandbox_id: sandboxId }]);

      await provider.getSandboxForGuild(guildId);

      // Verify sandbox ID was cached
      expect(mockRedis.set).toHaveBeenCalledWith(
        `sandbox:route:${guildId}`,
        sandboxId,
        'PX',
        60000
      );
    });
  });

  describe('getSandboxesForGuilds', () => {
    it('should batch lookup multiple guilds', async () => {
      const guildIds = ['guild-1', 'guild-2', 'guild-3'];

      // Pre-populate cache for guild-1
      mockRedis._store.set('sandbox:route:guild-1', 'sandbox-1');

      // Mock database response for guild-2 and guild-3
      (mockSql as any).mockResolvedValueOnce([
        { guild_id: 'guild-2', sandbox_id: 'sandbox-2' },
        // guild-3 has no mapping
      ]);

      const results = await provider.getSandboxesForGuilds(guildIds);

      expect(results.get('guild-1')).toBe('sandbox-1');
      expect(results.get('guild-2')).toBe('sandbox-2');
      expect(results.get('guild-3')).toBeNull();
    });

    it('should use only cache when all guilds are cached', async () => {
      const guildIds = ['guild-1', 'guild-2'];

      // Pre-populate cache for all guilds
      mockRedis._store.set('sandbox:route:guild-1', 'sandbox-1');
      mockRedis._store.set('sandbox:route:guild-2', 'sandbox-2');

      const results = await provider.getSandboxesForGuilds(guildIds);

      expect(results.get('guild-1')).toBe('sandbox-1');
      expect(results.get('guild-2')).toBe('sandbox-2');
      expect(mockSql).not.toHaveBeenCalled();
    });
  });

  describe('registerMapping', () => {
    it('should update cache with new mapping', async () => {
      const guildId = '123456789012345678';
      const sandboxId = 'sandbox-uuid';

      await provider.registerMapping(guildId, sandboxId);

      expect(mockRedis.set).toHaveBeenCalledWith(
        `sandbox:route:${guildId}`,
        sandboxId,
        'PX',
        60000
      );
    });
  });

  describe('removeMapping', () => {
    it('should invalidate cache for guild', async () => {
      const guildId = '123456789012345678';

      // Pre-populate cache
      mockRedis._store.set(`sandbox:route:${guildId}`, 'sandbox-uuid');

      await provider.removeMapping(guildId);

      expect(mockRedis.del).toHaveBeenCalledWith(`sandbox:route:${guildId}`);
    });
  });

  describe('invalidateCache', () => {
    it('should delete cache key for guild', async () => {
      const guildId = '123456789012345678';

      await provider.invalidateCache(guildId);

      expect(mockRedis.del).toHaveBeenCalledWith(`sandbox:route:${guildId}`);
    });
  });

  describe('invalidateSandboxRoutes', () => {
    it('should invalidate all guilds mapped to sandbox', async () => {
      const sandboxId = 'sandbox-uuid';

      // Mock database response for guilds in sandbox
      (mockSql as any).mockResolvedValueOnce([
        { guild_id: 'guild-1' },
        { guild_id: 'guild-2' },
      ]);

      await provider.invalidateSandboxRoutes(sandboxId);

      expect(mockRedis.del).toHaveBeenCalledWith('sandbox:route:guild-1');
      expect(mockRedis.del).toHaveBeenCalledWith('sandbox:route:guild-2');
    });
  });

  describe('getGuildsForSandbox', () => {
    it('should return all guilds mapped to sandbox', async () => {
      const sandboxId = 'sandbox-uuid';

      (mockSql as any).mockResolvedValueOnce([
        { guild_id: 'guild-1' },
        { guild_id: 'guild-2' },
        { guild_id: 'guild-3' },
      ]);

      const guilds = await provider.getGuildsForSandbox(sandboxId);

      expect(guilds).toEqual(['guild-1', 'guild-2', 'guild-3']);
    });

    it('should return empty array if no guilds mapped', async () => {
      const sandboxId = 'sandbox-uuid';

      (mockSql as any).mockResolvedValueOnce([]);

      const guilds = await provider.getGuildsForSandbox(sandboxId);

      expect(guilds).toEqual([]);
    });
  });

  describe('getAllActiveMappings', () => {
    it('should return all active route mappings', async () => {
      const now = new Date();

      (mockSql as any).mockResolvedValueOnce([
        { guild_id: 'guild-1', sandbox_id: 'sandbox-1', created_at: now.toISOString() },
        { guild_id: 'guild-2', sandbox_id: 'sandbox-1', created_at: now.toISOString() },
      ]);

      const mappings = await provider.getAllActiveMappings();

      expect(mappings).toHaveLength(2);
      expect(mappings[0].guildId).toBe('guild-1');
      expect(mappings[0].sandboxId).toBe('sandbox-1');
      expect(mappings[0].createdAt).toBeInstanceOf(Date);
    });
  });

  describe('warmCache', () => {
    it('should populate cache with all active mappings', async () => {
      const now = new Date();

      (mockSql as any).mockResolvedValueOnce([
        { guild_id: 'guild-1', sandbox_id: 'sandbox-1', created_at: now.toISOString() },
        { guild_id: 'guild-2', sandbox_id: 'sandbox-2', created_at: now.toISOString() },
      ]);

      const count = await provider.warmCache();

      expect(count).toBe(2);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'sandbox:route:guild-1',
        'sandbox-1',
        'PX',
        60000
      );
      expect(mockRedis.set).toHaveBeenCalledWith(
        'sandbox:route:guild-2',
        'sandbox-2',
        'PX',
        60000
      );
    });

    it('should return 0 when no active mappings', async () => {
      (mockSql as any).mockResolvedValueOnce([]);

      const count = await provider.warmCache();

      expect(count).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return route provider statistics', async () => {
      // Mock mapping count
      (mockSql as any).mockResolvedValueOnce([{ count: '10' }]);
      // Mock active sandbox count
      (mockSql as any).mockResolvedValueOnce([{ count: '3' }]);

      const stats = await provider.getStats();

      expect(stats.totalMappings).toBe(10);
      expect(stats.activeSandboxes).toBe(3);
    });
  });
});
