/**
 * SchemaProvisioner Tests
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * Unit tests for SchemaProvisioner service.
 * Uses mock PostgreSQL client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchemaProvisioner } from '../services/schema-provisioner.js';
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

// Mock SQL client
interface MockSqlResult {
  [key: string]: unknown;
}

const createMockSql = () => {
  const mockSql = vi.fn() as unknown as ReturnType<typeof vi.fn> & {
    mock: { calls: unknown[][] };
  };
  return mockSql;
};

describe('SchemaProvisioner', () => {
  let provisioner: SchemaProvisioner;
  let mockSql: ReturnType<typeof createMockSql>;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSql = createMockSql();
    mockLogger = createMockLogger();

    provisioner = new SchemaProvisioner({
      sql: mockSql as unknown as Parameters<typeof SchemaProvisioner['prototype']['createSchema']>[0] extends string ? never : any,
      logger: mockLogger,
    });
  });

  describe('generateSchemaName', () => {
    it('should generate schema name from UUID', () => {
      const sandboxId = '12345678-1234-1234-1234-123456789abc';
      const schemaName = provisioner.generateSchemaName(sandboxId);

      expect(schemaName).toBe('sandbox_12345678');
    });

    it('should strip hyphens from UUID', () => {
      const sandboxId = 'abcd-ef01-2345-6789-abcdef012345';
      const schemaName = provisioner.generateSchemaName(sandboxId);

      // Without hyphens: abcdef01234567
      // First 8 chars: abcdef01
      expect(schemaName).toBe('sandbox_abcdef01');
    });

    it('should handle short IDs', () => {
      const sandboxId = 'abc123';
      const schemaName = provisioner.generateSchemaName(sandboxId);

      expect(schemaName).toBe('sandbox_abc123');
    });

    it('should use custom prefix if configured', () => {
      const customProvisioner = new SchemaProvisioner({
        sql: mockSql as any,
        logger: mockLogger,
        schemaPrefix: 'test_',
      });

      const schemaName = customProvisioner.generateSchemaName('12345678');
      expect(schemaName).toBe('test_12345678');
    });
  });

  describe('extractSandboxId', () => {
    it('should extract sandbox ID from schema name', () => {
      const schemaName = 'sandbox_12345678';
      const sandboxId = provisioner.extractSandboxId(schemaName);

      expect(sandboxId).toBe('12345678');
    });

    it('should throw for invalid schema name', () => {
      expect(() => {
        provisioner.extractSandboxId('invalid_schema');
      }).toThrow(SandboxError);
    });

    it('should throw with correct error code', () => {
      try {
        provisioner.extractSandboxId('invalid_schema');
      } catch (e) {
        expect(e).toBeInstanceOf(SandboxError);
        expect((e as SandboxError).code).toBe(SandboxErrorCode.SCHEMA_FAILED);
      }
    });
  });

  describe('createSchema', () => {
    it('should create schema successfully', async () => {
      const sandboxId = '12345678';

      // Mock: schemaExists returns false
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: false }]);
      // Mock: create_sandbox_schema call
      mockSql.mockResolvedValueOnce([]);
      // Mock: schemaExists returns true (after creation)
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: get_sandbox_schema_stats
      mockSql.mockResolvedValueOnce([
        { table_name: 'communities', row_count: '0' },
        { table_name: 'profiles', row_count: '0' },
        { table_name: 'badges', row_count: '0' },
      ]);

      const result = await provisioner.createSchema(sandboxId);

      expect(result.schemaName).toBe('sandbox_12345678');
      expect(result.tablesCreated).toContain('communities');
      expect(result.tablesCreated).toContain('profiles');
      expect(result.tablesCreated).toContain('badges');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should skip creation if schema already exists', async () => {
      const sandboxId = '12345678';

      // Mock: schemaExists returns true
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: schemaExists for getSchemaStats
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: get_sandbox_schema_stats
      mockSql.mockResolvedValueOnce([
        { table_name: 'communities', row_count: '5' },
      ]);

      const result = await provisioner.createSchema(sandboxId);

      expect(result.schemaName).toBe('sandbox_12345678');
      expect(result.tablesCreated).toContain('communities');
      // Should have logged a warning
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should throw SandboxError on database failure', async () => {
      const sandboxId = '12345678';

      // Mock: schemaExists returns false
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: false }]);
      // Mock: create_sandbox_schema throws
      mockSql.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(provisioner.createSchema(sandboxId)).rejects.toThrow(SandboxError);
    });
  });

  describe('dropSchema', () => {
    it('should drop existing schema', async () => {
      const sandboxId = '12345678';

      // Mock: schemaExists returns true
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: drop_sandbox_schema call
      mockSql.mockResolvedValueOnce([]);

      const result = await provisioner.dropSchema(sandboxId);

      expect(result.schemaName).toBe('sandbox_12345678');
      expect(result.existed).toBe(true);
    });

    it('should be idempotent for non-existent schema', async () => {
      const sandboxId = '12345678';

      // Mock: schemaExists returns false
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: false }]);
      // Mock: drop_sandbox_schema call (still runs)
      mockSql.mockResolvedValueOnce([]);

      const result = await provisioner.dropSchema(sandboxId);

      expect(result.existed).toBe(false);
    });
  });

  describe('schemaExists', () => {
    it('should return true for existing schema', async () => {
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);

      const exists = await provisioner.schemaExists('12345678');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent schema', async () => {
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: false }]);

      const exists = await provisioner.schemaExists('nonexistent');
      expect(exists).toBe(false);
    });
  });

  describe('getSchemaStats', () => {
    it('should return stats for existing schema', async () => {
      // Mock: schemaExists returns true
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      // Mock: get_sandbox_schema_stats
      mockSql.mockResolvedValueOnce([
        { table_name: 'communities', row_count: '10' },
        { table_name: 'profiles', row_count: '100' },
        { table_name: 'badges', row_count: '50' },
      ]);

      const stats = await provisioner.getSchemaStats('12345678');

      expect(stats.exists).toBe(true);
      expect(stats.tables.communities).toBe(10);
      expect(stats.tables.profiles).toBe(100);
      expect(stats.tables.badges).toBe(50);
      expect(stats.totalRows).toBe(160);
    });

    it('should return empty stats for non-existent schema', async () => {
      // Mock: schemaExists returns false
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: false }]);

      const stats = await provisioner.getSchemaStats('nonexistent');

      expect(stats.exists).toBe(false);
      expect(stats.tables).toEqual({});
      expect(stats.totalRows).toBe(0);
    });
  });

  describe('listSchemas', () => {
    it('should list all sandbox schemas', async () => {
      mockSql.mockResolvedValueOnce([
        { schema_name: 'sandbox_aaaaaaaa' },
        { schema_name: 'sandbox_bbbbbbbb' },
        { schema_name: 'sandbox_cccccccc' },
      ]);

      const schemas = await provisioner.listSchemas();

      expect(schemas).toEqual([
        'sandbox_aaaaaaaa',
        'sandbox_bbbbbbbb',
        'sandbox_cccccccc',
      ]);
    });

    it('should return empty array when no schemas exist', async () => {
      mockSql.mockResolvedValueOnce([]);

      const schemas = await provisioner.listSchemas();
      expect(schemas).toEqual([]);
    });
  });

  describe('cleanupOrphanedSchemas', () => {
    it('should drop orphaned schemas', async () => {
      const activeSandboxIds = new Set(['aaaaaaaa-1111-2222-3333-444444444444']);

      // Mock: listSchemas
      mockSql.mockResolvedValueOnce([
        { schema_name: 'sandbox_aaaaaaaa' }, // Active
        { schema_name: 'sandbox_bbbbbbbb' }, // Orphaned
        { schema_name: 'sandbox_cccccccc' }, // Orphaned
      ]);

      // Mock: dropSchema for bbbbbbbb
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      mockSql.mockResolvedValueOnce([]);

      // Mock: dropSchema for cccccccc
      mockSql.mockResolvedValueOnce([{ sandbox_schema_exists: true }]);
      mockSql.mockResolvedValueOnce([]);

      const orphaned = await provisioner.cleanupOrphanedSchemas(activeSandboxIds);

      expect(orphaned).toContain('sandbox_bbbbbbbb');
      expect(orphaned).toContain('sandbox_cccccccc');
      expect(orphaned).not.toContain('sandbox_aaaaaaaa');
    });

    it('should not drop any schemas when all are active', async () => {
      const activeSandboxIds = new Set([
        'aaaaaaaa-1111-2222-3333-444444444444',
        'bbbbbbbb-1111-2222-3333-444444444444',
      ]);

      // Mock: listSchemas
      mockSql.mockResolvedValueOnce([
        { schema_name: 'sandbox_aaaaaaaa' },
        { schema_name: 'sandbox_bbbbbbbb' },
      ]);

      const orphaned = await provisioner.cleanupOrphanedSchemas(activeSandboxIds);

      expect(orphaned).toEqual([]);
    });
  });
});
