/**
 * CleanupProvider Unit Tests
 *
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Tests for sandbox cleanup and orphaned resource management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CleanupProvider } from '../services/cleanup-provider.js';
import type { Logger } from 'pino';

// =============================================================================
// Mocks
// =============================================================================

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
    mockSql.mockClear();
  };

  return mockSql;
};

const createMockRedis = () => {
  const store = new Map<string, string>();
  let scanCursor = '0';
  let scanKeys: string[] = [];

  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: vi.fn((...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (store.has(key)) {
          store.delete(key);
          deleted++;
        }
      }
      return Promise.resolve(deleted);
    }),
    scan: vi.fn((cursor: string) => {
      // Return configured keys on first call, then '0' cursor
      if (cursor === '0' && scanKeys.length > 0) {
        const keys = scanKeys;
        scanKeys = [];
        return Promise.resolve(['0', keys]);
      }
      return Promise.resolve(['0', []]);
    }),
    _store: store,
    _clear: () => store.clear(),
    _setScanKeys: (keys: string[]) => {
      scanKeys = keys;
    },
  };
};

const createMockSchemaProvisioner = () => ({
  dropSchema: vi.fn().mockResolvedValue({ existed: true }),
  listSchemas: vi.fn().mockResolvedValue([]),
});

const createMockRouteProvider = () => ({
  getGuildsForSandbox: vi.fn().mockResolvedValue([]),
  invalidateSandboxRoutes: vi.fn().mockResolvedValue(undefined),
  registerMapping: vi.fn().mockResolvedValue(undefined),
});

// =============================================================================
// Test Suite
// =============================================================================

describe('CleanupProvider', () => {
  let cleanupProvider: CleanupProvider;
  let mockSql: ReturnType<typeof createMockSql>;
  let mockRedis: ReturnType<typeof createMockRedis>;
  let mockSchemaProvisioner: ReturnType<typeof createMockSchemaProvisioner>;
  let mockRouteProvider: ReturnType<typeof createMockRouteProvider>;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSql = createMockSql();
    mockRedis = createMockRedis();
    mockSchemaProvisioner = createMockSchemaProvisioner();
    mockRouteProvider = createMockRouteProvider();
    mockLogger = createMockLogger();
    mockRedis._clear();
    (mockSql as any).resetMocks();

    cleanupProvider = new CleanupProvider({
      sql: mockSql as any,
      redis: mockRedis as any,
      schemaProvisioner: mockSchemaProvisioner as any,
      routeProvider: mockRouteProvider as any,
      logger: mockLogger,
    });
  });

  // ===========================================================================
  // cleanupSandbox Tests
  // ===========================================================================

  describe('cleanupSandbox', () => {
    it('should cleanup sandbox in correct order', async () => {
      const sandboxId = 'test-sandbox-id';

      // Mock: markStatus (UPDATE)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: getGuildsForSandbox returns no guilds
      mockRouteProvider.getGuildsForSandbox.mockResolvedValueOnce([]);
      // Mock: markDestroyed (UPDATE)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);

      const result = await cleanupProvider.cleanupSandbox(sandboxId);

      expect(result.success).toBe(true);
      expect(result.sandboxId).toBe(sandboxId);
      expect(result.stepsCompleted).toContain('mark_destroying');
      expect(result.stepsCompleted).toContain('drop_schema');
      expect(result.stepsCompleted).toContain('mark_destroyed');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup guild mappings when guilds are registered', async () => {
      const sandboxId = 'test-sandbox-id';
      const guildIds = ['guild1', 'guild2'];

      // Mock: markStatus
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: getGuildsForSandbox returns guilds
      mockRouteProvider.getGuildsForSandbox.mockResolvedValueOnce(guildIds);
      // Mock: DELETE guild mappings
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: markDestroyed
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);

      const result = await cleanupProvider.cleanupSandbox(sandboxId);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toContain('remove_guild_mappings');
      expect(result.stepsCompleted).toContain('invalidate_cache');
      expect(mockRouteProvider.invalidateSandboxRoutes).toHaveBeenCalledWith(sandboxId);
    });

    it('should delete Redis keys', async () => {
      const sandboxId = 'test-sandbox-id';

      // Setup Redis keys
      mockRedis._store.set(`sandbox:${sandboxId}:key1`, 'value1');
      mockRedis._store.set(`sandbox:${sandboxId}:key2`, 'value2');
      mockRedis._setScanKeys([`sandbox:${sandboxId}:key1`, `sandbox:${sandboxId}:key2`]);

      // Mock SQL calls
      (mockSql as any).mockResolvedValueOnce([]); // markStatus
      (mockSql as any).mockResolvedValueOnce([]); // audit
      mockRouteProvider.getGuildsForSandbox.mockResolvedValueOnce([]);
      (mockSql as any).mockResolvedValueOnce([]); // markDestroyed
      (mockSql as any).mockResolvedValueOnce([]); // audit

      const result = await cleanupProvider.cleanupSandbox(sandboxId);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toContain('delete_redis_keys');
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should handle cleanup failure gracefully', async () => {
      const sandboxId = 'test-sandbox-id';

      // Mock: markStatus succeeds
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log succeeds
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: getGuildsForSandbox throws
      mockRouteProvider.getGuildsForSandbox.mockRejectedValueOnce(new Error('Database error'));

      const result = await cleanupProvider.cleanupSandbox(sandboxId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(result.stepsCompleted).toContain('mark_destroying');
      expect(result.stepsCompleted).not.toContain('mark_destroyed');
    });

    it('should continue cleanup when schema does not exist', async () => {
      const sandboxId = 'test-sandbox-id';

      // Mock: markStatus
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);
      mockRouteProvider.getGuildsForSandbox.mockResolvedValueOnce([]);
      // Mock: schema drop returns existed: false
      mockSchemaProvisioner.dropSchema.mockResolvedValueOnce({ existed: false });
      // Mock: markDestroyed
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);

      const result = await cleanupProvider.cleanupSandbox(sandboxId);

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).not.toContain('drop_schema');
    });
  });

  // ===========================================================================
  // cleanupExpired Tests
  // ===========================================================================

  describe('cleanupExpired', () => {
    it('should find and cleanup expired sandboxes', async () => {
      const expiredSandbox = {
        id: 'expired-sandbox',
        name: 'expired',
        owner: 'testuser',
        status: 'expired',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      };

      // Mock: findExpired query
      (mockSql as any).mockResolvedValueOnce([expiredSandbox]);
      // Mock: cleanupSandbox calls (markStatus, audit, markDestroyed, audit)
      (mockSql as any).mockResolvedValueOnce([]);
      (mockSql as any).mockResolvedValueOnce([]);
      mockRouteProvider.getGuildsForSandbox.mockResolvedValueOnce([]);
      (mockSql as any).mockResolvedValueOnce([]);
      (mockSql as any).mockResolvedValueOnce([]);

      const stats = await cleanupProvider.cleanupExpired();

      expect(stats.cleanedUp).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track failed cleanups', async () => {
      const expiredSandbox = {
        id: 'expired-sandbox',
        name: 'expired',
        owner: 'testuser',
        status: 'expired',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      };

      // Mock: findExpired query
      (mockSql as any).mockResolvedValueOnce([expiredSandbox]);
      // Mock: markStatus succeeds
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log succeeds
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: getGuildsForSandbox throws
      mockRouteProvider.getGuildsForSandbox.mockRejectedValueOnce(new Error('Database error'));

      const stats = await cleanupProvider.cleanupExpired();

      expect(stats.cleanedUp).toBe(0);
      expect(stats.failed).toBe(1);
    });

    it('should handle no expired sandboxes', async () => {
      // Mock: findExpired returns empty
      (mockSql as any).mockResolvedValueOnce([]);

      const stats = await cleanupProvider.cleanupExpired();

      expect(stats.cleanedUp).toBe(0);
      expect(stats.failed).toBe(0);
    });
  });

  // ===========================================================================
  // cleanupRedisKeys Tests
  // ===========================================================================

  describe('cleanupRedisKeys', () => {
    it('should delete all keys matching sandbox prefix', async () => {
      const sandboxId = 'test-sandbox';
      const keys = [
        `sandbox:${sandboxId}:key1`,
        `sandbox:${sandboxId}:key2`,
        `sandbox:${sandboxId}:key3`,
      ];

      mockRedis._setScanKeys(keys);

      const deleted = await cleanupProvider.cleanupRedisKeys(sandboxId);

      expect(deleted).toBe(3);
      expect(mockRedis.del).toHaveBeenCalledWith(...keys);
    });

    it('should return 0 when no keys found', async () => {
      const sandboxId = 'empty-sandbox';
      mockRedis._setScanKeys([]);

      const deleted = await cleanupProvider.cleanupRedisKeys(sandboxId);

      expect(deleted).toBe(0);
    });

    it('should throw SandboxError on Redis failure', async () => {
      const sandboxId = 'test-sandbox';

      mockRedis.scan.mockRejectedValueOnce(new Error('Redis connection failed'));

      await expect(cleanupProvider.cleanupRedisKeys(sandboxId)).rejects.toThrow(
        'Failed to cleanup Redis keys'
      );
    });
  });

  // ===========================================================================
  // findOrphanedResources Tests
  // ===========================================================================

  describe('findOrphanedResources', () => {
    it('should find orphaned schemas', async () => {
      // Mock: get active sandbox IDs
      (mockSql as any).mockResolvedValueOnce([
        { id: 'active-1234abcd-5678-efgh-ijkl-mnopqrstuvwx', status: 'running' },
      ]);

      // Mock: list all schemas
      mockSchemaProvisioner.listSchemas.mockResolvedValueOnce([
        'sandbox_active12', // matches active sandbox
        'sandbox_orphan12', // orphaned - no matching sandbox
      ]);

      const result = await cleanupProvider.findOrphanedResources();

      expect(result.schemas).toContain('sandbox_orphan12');
      expect(result.schemas).not.toContain('sandbox_active12');
    });

    it('should find orphaned Redis key prefixes', async () => {
      // Use UUIDs that match the regex pattern in CleanupProvider
      const orphanedId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const activeId = 'f0e9d8c7-b6a5-4321-fedc-ba0987654321';

      // Mock: get active sandbox IDs
      (mockSql as any).mockResolvedValueOnce([{ id: activeId, status: 'running' }]);

      // Mock: list schemas (none orphaned)
      mockSchemaProvisioner.listSchemas.mockResolvedValueOnce([]);

      // Mock: Redis SCAN finds keys with sandbox prefix pattern
      mockRedis.scan.mockResolvedValueOnce(['0', [
        `sandbox:${orphanedId}:key1`,
        `sandbox:${activeId}:key2`,
      ]]);

      const result = await cleanupProvider.findOrphanedResources();

      expect(result.redisKeyPrefixes).toContain(orphanedId);
      expect(result.redisKeyPrefixes).not.toContain(activeId);
    });
  });

  // ===========================================================================
  // cleanupOrphanedResources Tests
  // ===========================================================================

  describe('cleanupOrphanedResources', () => {
    it('should cleanup orphaned schemas and Redis keys', async () => {
      const orphanedSchemaId = 'orphan12';
      const orphanedRedisId = 'orphaned-redis-id';

      // Mock findOrphanedResources calls
      // Get active sandboxes
      (mockSql as any).mockResolvedValueOnce([]);
      // List schemas
      mockSchemaProvisioner.listSchemas.mockResolvedValueOnce([`sandbox_${orphanedSchemaId}`]);
      // Redis scan for orphaned keys
      mockRedis._setScanKeys([`sandbox:${orphanedRedisId}:key`]);

      // Mock cleanup calls
      mockSchemaProvisioner.dropSchema.mockResolvedValueOnce({ existed: true });
      mockRedis._setScanKeys([`sandbox:${orphanedRedisId}:key`]);

      const result = await cleanupProvider.cleanupOrphanedResources();

      expect(result.schemasDropped).toContain(`sandbox_${orphanedSchemaId}`);
      expect(result.redisKeysDeleted).toBeGreaterThanOrEqual(0);
    });

    it('should continue cleanup on individual failures', async () => {
      // Mock findOrphanedResources
      (mockSql as any).mockResolvedValueOnce([]);
      mockSchemaProvisioner.listSchemas.mockResolvedValueOnce([
        'sandbox_orphan1',
        'sandbox_orphan2',
      ]);
      mockRedis._setScanKeys([]);

      // First schema drop fails, second succeeds
      mockSchemaProvisioner.dropSchema
        .mockRejectedValueOnce(new Error('Drop failed'))
        .mockResolvedValueOnce({ existed: true });

      const result = await cleanupProvider.cleanupOrphanedResources();

      // Should have at least one success
      expect(result.schemasDropped.length).toBeGreaterThanOrEqual(1);
    });
  });
});
