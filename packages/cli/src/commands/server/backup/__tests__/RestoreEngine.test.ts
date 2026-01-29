/**
 * RestoreEngine Integration Tests
 *
 * Sprint 167: Restore Engine - Integration Tests
 *
 * Tests full backup → restore cycle with integrity validation,
 * lineage checking, and state comparison.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

import { RestoreEngine, createRestoreEngine } from '../RestoreEngine.js';
import { IntegrityError, LineageError } from '../types.js';
import type { BackupMetadata } from '../types.js';
import type { GaibState, StateBackend } from '../../iac/backends/types.js';

// ============================================================================
// Mocks
// ============================================================================

const s3Mock = mockClient(S3Client);

// Mock state backend
const createMockBackend = (state: GaibState | null): StateBackend => ({
  type: 'local' as const,
  supportsLocking: false,
  getState: vi.fn().mockResolvedValue(state),
  setState: vi.fn().mockResolvedValue(undefined),
  deleteState: vi.fn().mockResolvedValue(undefined),
  listWorkspaces: vi.fn().mockResolvedValue(['default']),
  lock: vi.fn().mockResolvedValue({ acquired: true, lockInfo: undefined }),
  unlock: vi.fn().mockResolvedValue(true),
  forceUnlock: vi.fn().mockResolvedValue(true),
  getLockInfo: vi.fn().mockResolvedValue(null),
  isConfigured: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
});

// Sample states for testing
const sampleState: GaibState = {
  version: 1,
  serial: 42,
  lineage: 'test-lineage-123',
  workspace: 'default',
  resources: [
    {
      type: 'discord_role',
      name: 'naib',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '1111111111',
            name: 'Naib',
            color: '#FFD700',
          },
        },
      ],
    },
    {
      type: 'discord_channel',
      name: 'general',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '2222222222',
            name: 'general',
            type: 'text',
          },
        },
      ],
    },
  ],
  outputs: {},
  lastModified: '2026-01-29T12:00:00Z',
};

const modifiedState: GaibState = {
  ...sampleState,
  serial: 50,
  resources: [
    {
      type: 'discord_role',
      name: 'naib',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '1111111111',
            name: 'Naib',
            color: '#FF0000', // Changed color
          },
        },
      ],
    },
    // Removed general channel
    {
      type: 'discord_channel',
      name: 'announcements',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '3333333333',
            name: 'announcements',
            type: 'announcement',
          },
        },
      ],
    },
  ],
  lastModified: '2026-01-29T14:00:00Z',
};

const differentLineageState: GaibState = {
  ...sampleState,
  lineage: 'different-lineage-456',
};

// Helper to create backup metadata
const createBackupMetadata = (state: GaibState): BackupMetadata => {
  const compressed = gzipSync(Buffer.from(JSON.stringify(state)));
  const checksum = createHash('sha256').update(compressed).digest('hex');

  return {
    id: 'backup-abc123',
    serverId: '1234567890',
    workspace: 'default',
    type: 'state',
    timestamp: '2026-01-29T12:00:00Z',
    serial: state.serial,
    lineage: state.lineage,
    tier: 'free',
    s3Bucket: 'gaib-backups-123456789012',
    s3Key: 'state/1234567890/default/backup.2026-01-29T12:00:00Z.json.gz',
    size: compressed.length,
    checksum,
  };
};

// ============================================================================
// Test Setup
// ============================================================================

describe('RestoreEngine', () => {
  let s3Client: S3Client;
  let mockBackend: StateBackend;
  let engine: RestoreEngine;

  beforeEach(() => {
    s3Mock.reset();
    s3Client = new S3Client({ region: 'us-east-1' });
    mockBackend = createMockBackend(sampleState);
    engine = createRestoreEngine(s3Client, mockBackend, 'default');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Validation Tests
  // ============================================================================

  describe('validate', () => {
    it('should pass validation for valid backup', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      const result = await engine.validate(backup, compressed);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect checksum mismatch', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);
      backup.checksum = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      const result = await engine.validate(backup, compressed);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'CHECKSUM_MISMATCH' })
      );
    });

    it('should detect lineage mismatch', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(differentLineageState)));
      const backup = createBackupMetadata(differentLineageState);

      const result = await engine.validate(backup, compressed);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'LINEAGE_MISMATCH' })
      );
    });

    it('should skip lineage check when configured', async () => {
      const engineNoLineageCheck = createRestoreEngine(
        s3Client,
        mockBackend,
        'default',
        { skipLineageCheck: true }
      );

      const compressed = gzipSync(Buffer.from(JSON.stringify(differentLineageState)));
      const backup = createBackupMetadata(differentLineageState);

      const result = await engineNoLineageCheck.validate(backup, compressed);

      expect(result.valid).toBe(true);
      expect(result.errors).not.toContainEqual(
        expect.objectContaining({ code: 'LINEAGE_MISMATCH' })
      );
    });

    it('should warn on serial regression', async () => {
      const olderState: GaibState = { ...sampleState, serial: 10 };
      const compressed = gzipSync(Buffer.from(JSON.stringify(olderState)));
      const backup = createBackupMetadata(olderState);

      const result = await engine.validate(backup, compressed);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'SERIAL_REGRESSION' })
      );
    });

    it('should warn on workspace mismatch', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);
      backup.workspace = 'staging';

      const result = await engine.validate(backup, compressed);

      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: 'WORKSPACE_MISMATCH' })
      );
    });

    it('should detect corrupted data', async () => {
      const backup = createBackupMetadata(sampleState);
      const corruptedData = Buffer.from('not gzip data');
      backup.checksum = createHash('sha256').update(corruptedData).digest('hex');

      const result = await engine.validate(backup, corruptedData);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'DECOMPRESS_FAILED' })
      );
    });
  });

  // ============================================================================
  // Compare Tests
  // ============================================================================

  describe('compare', () => {
    it('should detect no changes when states match', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      const result = await engine.compare(backup, compressed);

      expect(result.serial.from).toBe(42);
      expect(result.serial.to).toBe(42);
      expect(result.resourceCount.from).toBe(2);
      expect(result.resourceCount.to).toBe(2);
      expect(result.resources.added).toHaveLength(0);
      expect(result.resources.removed).toHaveLength(0);
      expect(result.resources.modified).toHaveLength(0);
    });

    it('should detect added resources', async () => {
      // Current state has fewer resources
      const lessState: GaibState = {
        ...sampleState,
        resources: [sampleState.resources[0]], // Only naib role
      };
      mockBackend = createMockBackend(lessState);
      engine = createRestoreEngine(s3Client, mockBackend, 'default');

      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      const result = await engine.compare(backup, compressed);

      expect(result.resources.added).toContainEqual(
        expect.objectContaining({ type: 'discord_channel', name: 'general' })
      );
    });

    it('should detect removed resources', async () => {
      // Restoring from backup with fewer resources
      const lessState: GaibState = {
        ...sampleState,
        resources: [sampleState.resources[0]], // Only naib role
      };
      const compressed = gzipSync(Buffer.from(JSON.stringify(lessState)));
      const backup = createBackupMetadata(lessState);

      const result = await engine.compare(backup, compressed);

      expect(result.resources.removed).toContainEqual(
        expect.objectContaining({ type: 'discord_channel', name: 'general' })
      );
    });

    it('should detect modified resources', async () => {
      // Current state has different values
      const modifiedCurrent: GaibState = {
        ...sampleState,
        resources: [
          {
            ...sampleState.resources[0],
            instances: [
              {
                schema_version: 1,
                attributes: {
                  id: '1111111111',
                  name: 'Naib',
                  color: '#00FF00', // Different color
                },
              },
            ],
          },
          sampleState.resources[1],
        ],
      };
      mockBackend = createMockBackend(modifiedCurrent);
      engine = createRestoreEngine(s3Client, mockBackend, 'default');

      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      const result = await engine.compare(backup, compressed);

      expect(result.resources.modified).toContainEqual(
        expect.objectContaining({
          type: 'discord_role',
          name: 'naib',
          changes: expect.objectContaining({
            color: { from: '#00FF00', to: '#FFD700' },
          }),
        })
      );
    });
  });

  // ============================================================================
  // Restore Tests
  // ============================================================================

  describe('restore', () => {
    it('should restore successfully with valid backup', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await engine.restore(backup, { dryRun: false });

      expect(result.dryRun).toBe(false);
      expect(result.backup.id).toBe(backup.id);
      expect(mockBackend.setState).toHaveBeenCalled();
    });

    it('should not modify state on dry run', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await engine.restore(backup, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(mockBackend.setState).not.toHaveBeenCalled();
    });

    it('should throw IntegrityError on checksum mismatch', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);
      backup.checksum = 'wrong-checksum-here';

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      await expect(engine.restore(backup, {})).rejects.toThrow(IntegrityError);
    });

    it('should throw LineageError on lineage mismatch', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(differentLineageState)));
      const backup = createBackupMetadata(differentLineageState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      await expect(engine.restore(backup, {})).rejects.toThrow(LineageError);
    });

    it('should increment serial on restore', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      await engine.restore(backup, { dryRun: false });

      expect(mockBackend.setState).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          serial: 43, // Incremented from 42
        })
      );
    });

    it('should update lastModified on restore', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const before = new Date().toISOString();
      await engine.restore(backup, { dryRun: false });

      const setStateCall = vi.mocked(mockBackend.setState).mock.calls[0];
      const savedState = setStateCall[1] as GaibState;

      expect(new Date(savedState.lastModified).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime()
      );
    });
  });

  // ============================================================================
  // Download Tests
  // ============================================================================

  describe('download', () => {
    it('should download and validate backup', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const backup = createBackupMetadata(sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await engine.download(backup);

      expect(result.compressed).toEqual(compressed);
      expect(result.state.serial).toBe(42);
      expect(result.validation.valid).toBe(true);
    });

    it('should return validation errors for invalid backup', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(differentLineageState)));
      const backup = createBackupMetadata(differentLineageState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await engine.download(backup);

      expect(result.validation.valid).toBe(false);
      expect(result.validation.errors).toContainEqual(
        expect.objectContaining({ code: 'LINEAGE_MISMATCH' })
      );
    });
  });

  // ============================================================================
  // Full Cycle Tests
  // ============================================================================

  describe('full restore cycle', () => {
    it('should restore modified state and detect all changes', async () => {
      // Current state is modifiedState, backup is original sampleState
      mockBackend = createMockBackend(modifiedState);
      engine = createRestoreEngine(s3Client, mockBackend, 'default');

      // Backup is original state with same lineage
      const originalWithSameLineage: GaibState = {
        ...sampleState,
        lineage: modifiedState.lineage, // Match lineage for valid restore
      };
      const compressed = gzipSync(Buffer.from(JSON.stringify(originalWithSameLineage)));
      const backup = createBackupMetadata(originalWithSameLineage);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      // First, compare
      const comparison = await engine.compare(backup, compressed);

      expect(comparison.resources.removed).toContainEqual(
        expect.objectContaining({ type: 'discord_channel', name: 'announcements' })
      );
      expect(comparison.resources.added).toContainEqual(
        expect.objectContaining({ type: 'discord_channel', name: 'general' })
      );
      expect(comparison.resources.modified).toContainEqual(
        expect.objectContaining({
          type: 'discord_role',
          name: 'naib',
        })
      );

      // Then restore with dry run
      const dryRunResult = await engine.restore(backup, { dryRun: true });
      expect(dryRunResult.dryRun).toBe(true);
      expect(mockBackend.setState).not.toHaveBeenCalled();

      // Reset mock for actual restore
      vi.mocked(mockBackend.setState).mockClear();

      // Need to reset the S3 mock since we already consumed the stream
      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(gzipSync(Buffer.from(JSON.stringify(originalWithSameLineage)))),
      });

      // Finally, actual restore
      const result = await engine.restore(backup, { dryRun: false });
      expect(result.dryRun).toBe(false);
      expect(mockBackend.setState).toHaveBeenCalledTimes(1);

      // Verify restored state
      const savedState = vi.mocked(mockBackend.setState).mock.calls[0][1] as GaibState;
      expect(savedState.resources).toHaveLength(2);
      expect(savedState.resources[0].name).toBe('naib');
      expect(savedState.resources[1].name).toBe('general');
    });
  });
});
