/**
 * SandboxManager Tests
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * Unit tests for SandboxManager service.
 * Uses mock PostgreSQL client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxManager } from '../services/sandbox-manager.js';
import { SandboxError, SandboxErrorCode } from '../types.js';
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

  const mockSql = vi.fn((...args: unknown[]) => {
    const result = mockResults[callIndex] ?? [];
    callIndex++;
    return Promise.resolve(result);
  });

  // Add method to set up sequential results
  (mockSql as any).mockResolvedValueOnce = (value: unknown) => {
    mockResults.push(value);
    return mockSql;
  };

  (mockSql as any).mockRejectedValueOnce = (error: Error) => {
    mockResults.push(Promise.reject(error));
    return mockSql;
  };

  (mockSql as any).resetMocks = () => {
    mockResults.length = 0;
    callIndex = 0;
  };

  return mockSql;
};

describe('SandboxManager', () => {
  let manager: SandboxManager;
  let mockSql: ReturnType<typeof createMockSql>;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSql = createMockSql();
    mockLogger = createMockLogger();

    manager = new SandboxManager({
      sql: mockSql as any,
      logger: mockLogger,
      defaultTtlHours: 24,
      maxTtlHours: 168,
      maxSandboxesPerOwner: 5,
    });
  });

  describe('create', () => {
    it('should create a sandbox successfully', async () => {
      const sandboxId = '12345678-1234-1234-1234-123456789abc';
      const schemaName = 'sandbox_12345678';

      // Mock: checkOwnerLimit (count query)
      (mockSql as any).mockResolvedValueOnce([{ count: '0' }]);
      // Mock: checkNameAvailability
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: INSERT sandbox
      (mockSql as any).mockResolvedValueOnce([{ id: sandboxId, schema_name: 'pending_xxx' }]);
      // Mock: UPDATE schema_name
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log (sandbox_created)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: schemaExists (false)
      (mockSql as any).mockResolvedValueOnce([{ sandbox_schema_exists: false }]);
      // Mock: create_sandbox_schema
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: schemaExists (true)
      (mockSql as any).mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: get_sandbox_schema_stats
      (mockSql as any).mockResolvedValueOnce([
        { table_name: 'communities', row_count: '0' },
        { table_name: 'profiles', row_count: '0' },
      ]);
      // Mock: status update (get current status)
      (mockSql as any).mockResolvedValueOnce([{ status: 'creating' }]);
      // Mock: status update (UPDATE)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log (status_changed)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: getById SELECT
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'sandbox-testuser-abc123',
        owner: 'testuser',
        status: 'running',
        schema_name: schemaName,
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: { ttlHours: 24, createdBy: 'testuser', createdFrom: 'api' },
        guild_ids: [],
      }]);

      const result = await manager.create({
        owner: 'testuser',
        ttlHours: 24,
      });

      expect(result.sandbox).toBeDefined();
      expect(result.sandbox.owner).toBe('testuser');
      expect(result.sandbox.status).toBe('running');
      expect(result.schema.tablesCreated).toContain('communities');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should throw when owner limit exceeded', async () => {
      // Mock: checkOwnerLimit returns max count
      (mockSql as any).mockResolvedValueOnce([{ count: '5' }]);

      try {
        await manager.create({
          owner: 'testuser',
          ttlHours: 24,
        });
        // Should not reach here
        expect.fail('Expected SandboxError to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(SandboxError);
        expect((e as SandboxError).code).toBe(SandboxErrorCode.MAX_EXCEEDED);
      }
    });

    it('should throw when name already exists', async () => {
      // Mock: checkOwnerLimit
      (mockSql as any).mockResolvedValueOnce([{ count: '0' }]);
      // Mock: checkNameAvailability returns existing
      (mockSql as any).mockResolvedValueOnce([{ id: 'existing-id' }]);

      await expect(manager.create({
        owner: 'testuser',
        name: 'existing-sandbox',
      })).rejects.toThrow(SandboxError);
    });

    it('should cap TTL at maximum', async () => {
      // Mock: checkOwnerLimit
      (mockSql as any).mockResolvedValueOnce([{ count: '0' }]);
      // Mock: checkNameAvailability
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: INSERT sandbox
      const sandboxId = '12345678-1234-1234-1234-123456789abc';
      (mockSql as any).mockResolvedValueOnce([{ id: sandboxId, schema_name: 'pending_xxx' }]);
      // Mock: UPDATE schema_name
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: schemaExists
      (mockSql as any).mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: stats
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: status updates
      (mockSql as any).mockResolvedValueOnce([{ status: 'creating' }]);
      (mockSql as any).mockResolvedValueOnce([]);
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'sandbox-testuser-abc123',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: { ttlHours: 168, createdBy: 'testuser', createdFrom: 'api' },
        guild_ids: [],
      }]);

      const result = await manager.create({
        owner: 'testuser',
        ttlHours: 500, // Exceeds max of 168
      });

      // TTL should be capped at 168
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return sandbox by ID', async () => {
      const sandboxId = '12345678-1234-1234-1234-123456789abc';

      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: ['123456789'],
      }]);

      const sandbox = await manager.getById(sandboxId);

      expect(sandbox).not.toBeNull();
      expect(sandbox?.id).toBe(sandboxId);
      expect(sandbox?.name).toBe('test-sandbox');
      expect(sandbox?.guildIds).toEqual(['123456789']);
    });

    it('should return null for non-existent sandbox', async () => {
      (mockSql as any).mockResolvedValueOnce([]);

      const sandbox = await manager.getById('nonexistent');
      expect(sandbox).toBeNull();
    });
  });

  describe('getByGuildId', () => {
    it('should return sandbox for guild', async () => {
      const guildId = '123456789012345678';

      (mockSql as any).mockResolvedValueOnce([{
        id: 'sandbox-id',
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [guildId],
      }]);

      const sandbox = await manager.getByGuildId(guildId);

      expect(sandbox).not.toBeNull();
      expect(sandbox?.guildIds).toContain(guildId);
    });

    it('should return null for unmapped guild', async () => {
      (mockSql as any).mockResolvedValueOnce([]);

      const sandbox = await manager.getByGuildId('unmapped-guild');
      expect(sandbox).toBeNull();
    });
  });

  describe('list', () => {
    it('should list all sandboxes', async () => {
      (mockSql as any).mockResolvedValueOnce([
        {
          id: 'sandbox-1',
          name: 'sandbox-1',
          owner: 'user1',
          status: 'running',
          schema_name: 'sandbox_aaaaaaaa',
          discord_token_id: null,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          destroyed_at: null,
          last_activity_at: null,
          metadata: {},
          guild_ids: [],
        },
        {
          id: 'sandbox-2',
          name: 'sandbox-2',
          owner: 'user2',
          status: 'running',
          schema_name: 'sandbox_bbbbbbbb',
          discord_token_id: null,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          destroyed_at: null,
          last_activity_at: null,
          metadata: {},
          guild_ids: [],
        },
      ]);

      const sandboxes = await manager.list();

      expect(sandboxes).toHaveLength(2);
      expect(sandboxes[0].name).toBe('sandbox-1');
      expect(sandboxes[1].name).toBe('sandbox-2');
    });

    it('should filter by owner', async () => {
      (mockSql as any).mockResolvedValueOnce([
        {
          id: 'sandbox-1',
          name: 'sandbox-1',
          owner: 'testuser',
          status: 'running',
          schema_name: 'sandbox_aaaaaaaa',
          discord_token_id: null,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          destroyed_at: null,
          last_activity_at: null,
          metadata: {},
          guild_ids: [],
        },
      ]);

      const sandboxes = await manager.list({ owner: 'testuser' });

      expect(sandboxes).toHaveLength(1);
      expect(sandboxes[0].owner).toBe('testuser');
    });

    it('should filter by status', async () => {
      (mockSql as any).mockResolvedValueOnce([
        {
          id: 'sandbox-1',
          name: 'sandbox-1',
          owner: 'testuser',
          status: 'expired',
          schema_name: 'sandbox_aaaaaaaa',
          discord_token_id: null,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() - 1000).toISOString(),
          destroyed_at: null,
          last_activity_at: null,
          metadata: {},
          guild_ids: [],
        },
      ]);

      const sandboxes = await manager.list({ status: 'expired' });

      expect(sandboxes).toHaveLength(1);
      expect(sandboxes[0].status).toBe('expired');
    });
  });

  describe('registerGuild', () => {
    it('should register guild to sandbox', async () => {
      const sandboxId = 'sandbox-id';
      const guildId = '123456789012345678';

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);
      // Mock: checkGuildAvailability
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: INSERT mapping
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);

      await expect(
        manager.registerGuild(sandboxId, guildId, 'testuser')
      ).resolves.toBeUndefined();
    });

    it('should throw when sandbox not running', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById returns expired sandbox
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
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
      }]);

      await expect(
        manager.registerGuild(sandboxId, 'guild-id', 'testuser')
      ).rejects.toThrow(SandboxError);
    });

    it('should throw when guild already mapped', async () => {
      const sandboxId = 'sandbox-id';
      const guildId = '123456789012345678';

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);
      // Mock: checkGuildAvailability returns existing mapping
      (mockSql as any).mockResolvedValueOnce([{
        sandbox_id: 'other-sandbox',
        sandbox_name: 'other-sandbox-name',
      }]);

      await expect(
        manager.registerGuild(sandboxId, guildId, 'testuser')
      ).rejects.toThrow(SandboxError);
    });
  });

  describe('extendTtl', () => {
    it('should extend TTL', async () => {
      const sandboxId = 'sandbox-id';
      const now = Date.now();
      const currentExpiry = new Date(now + 12 * 60 * 60 * 1000); // 12 hours from now

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date(now).toISOString(),
        expires_at: currentExpiry.toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);
      // Mock: UPDATE expires_at
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);

      const newExpiry = await manager.extendTtl(sandboxId, 24, 'testuser');

      expect(newExpiry.getTime()).toBeGreaterThan(currentExpiry.getTime());
    });

    it('should cap extension at max TTL', async () => {
      const sandboxId = 'sandbox-id';
      const now = Date.now();
      const createdAt = new Date(now);
      const currentExpiry = new Date(now + 100 * 60 * 60 * 1000); // 100 hours from now

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: createdAt.toISOString(),
        expires_at: currentExpiry.toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);
      // Mock: UPDATE expires_at
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log
      (mockSql as any).mockResolvedValueOnce([]);

      const newExpiry = await manager.extendTtl(sandboxId, 100, 'testuser');

      // Should be capped at max TTL (168 hours from creation)
      const maxExpiry = new Date(createdAt.getTime() + 168 * 60 * 60 * 1000);
      expect(newExpiry.getTime()).toBeLessThanOrEqual(maxExpiry.getTime());
    });
  });

  describe('destroy', () => {
    it('should destroy sandbox', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);
      // Mock: get status for transition check
      (mockSql as any).mockResolvedValueOnce([{ status: 'running' }]);
      // Mock: UPDATE status to destroying
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log (status_changed)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log (sandbox_destroying)
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: schemaExists
      (mockSql as any).mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: drop_sandbox_schema
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: UPDATE to destroyed
      (mockSql as any).mockResolvedValueOnce([]);
      // Mock: audit log (sandbox_destroyed)
      (mockSql as any).mockResolvedValueOnce([]);

      await expect(manager.destroy(sandboxId, 'testuser')).resolves.toBeUndefined();
    });

    it('should be idempotent for already destroyed sandbox', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById returns destroyed sandbox
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'destroyed',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        destroyed_at: new Date().toISOString(),
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);

      await expect(manager.destroy(sandboxId, 'testuser')).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('getHealth', () => {
    it('should return healthy status', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: new Date().toISOString(),
        metadata: {},
        guild_ids: ['123456789'],
      }]);
      // Mock: schemaExists
      (mockSql as any).mockResolvedValueOnce([{ sandbox_schema_exists: true }]);

      const health = await manager.getHealth(sandboxId);

      expect(health.health).toBe('healthy');
      expect(health.checks.schema).toBe('ok');
      expect(health.checks.routing).toBe('ok');
    });

    it('should return degraded for no guilds', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: [],
      }]);
      // Mock: schemaExists
      (mockSql as any).mockResolvedValueOnce([{ sandbox_schema_exists: true }]);

      const health = await manager.getHealth(sandboxId);

      expect(health.health).toBe('degraded');
      expect(health.checks.routing).toBe('no_guilds');
    });
  });

  describe('getConnectionDetails', () => {
    it('should return connection details for running sandbox', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
        owner: 'testuser',
        status: 'running',
        schema_name: 'sandbox_12345678',
        discord_token_id: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        destroyed_at: null,
        last_activity_at: null,
        metadata: {},
        guild_ids: ['123456789'],
      }]);

      const details = await manager.getConnectionDetails(sandboxId);

      expect(details.sandboxId).toBe(sandboxId);
      expect(details.schemaName).toBe('sandbox_12345678');
      expect(details.redisPrefix).toBe(`sandbox:${sandboxId}:`);
      expect(details.natsPrefix).toBe(`sandbox.${sandboxId}.`);
      expect(details.env.SANDBOX_ID).toBe(sandboxId);
    });

    it('should throw for non-running sandbox', async () => {
      const sandboxId = 'sandbox-id';

      // Mock: getById returns expired sandbox
      (mockSql as any).mockResolvedValueOnce([{
        id: sandboxId,
        name: 'test-sandbox',
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
      }]);

      await expect(manager.getConnectionDetails(sandboxId)).rejects.toThrow(SandboxError);
    });
  });

  describe('findExpired', () => {
    it('should find expired sandboxes', async () => {
      (mockSql as any).mockResolvedValueOnce([
        {
          id: 'sandbox-1',
          name: 'sandbox-1',
          owner: 'testuser',
          status: 'running',
          schema_name: 'sandbox_aaaaaaaa',
          discord_token_id: null,
          created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          expires_at: new Date(Date.now() - 1000).toISOString(),
          destroyed_at: null,
          last_activity_at: null,
          metadata: {},
          guild_ids: [],
        },
      ]);

      const expired = await manager.findExpired();

      expect(expired).toHaveLength(1);
      expect(expired[0].id).toBe('sandbox-1');
    });
  });

  describe('updateActivity', () => {
    it('should update last activity timestamp', async () => {
      const sandboxId = 'sandbox-id';

      (mockSql as any).mockResolvedValueOnce([]);

      await expect(manager.updateActivity(sandboxId)).resolves.toBeUndefined();
    });
  });
});
