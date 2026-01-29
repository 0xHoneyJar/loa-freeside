/**
 * BackupManager Unit Tests
 *
 * Sprint 166: Backup Foundation - Unit Tests
 *
 * Tests backup creation, listing, restore, and delete operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import { createHash } from 'crypto';

import { BackupManager } from '../BackupManager.js';
import { BackupError, BackupErrorCode, IntegrityError, LineageError } from '../types.js';
import type { GaibState, StateBackend } from '../../iac/backends/types.js';

// ============================================================================
// Mocks
// ============================================================================

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);

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

// Sample state for testing
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
  ],
  outputs: {},
  lastModified: '2026-01-29T12:00:00Z',
};

// ============================================================================
// Test Setup
// ============================================================================

describe('BackupManager', () => {
  let manager: BackupManager;
  let mockBackend: StateBackend;

  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();

    // Set environment variables
    process.env.AWS_ACCOUNT_ID = '123456789012';
    process.env.AWS_REGION = 'us-east-1';

    mockBackend = createMockBackend(sampleState);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // createBackup Tests
  // ============================================================================

  describe('createBackup', () => {
    beforeEach(async () => {
      manager = await BackupManager.create({
        serverId: '1234567890',
        workspace: 'default',
        backend: mockBackend,
      });
      manager.setBackend(mockBackend);

      // Mock tier check (free tier, no backups today)
      dynamoMock.on(QueryCommand).resolves({ Items: [] });
    });

    it('should create compressed backup in S3', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await manager.createBackup({ message: 'Test backup' });

      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.serial).toBe(42);
      expect(result.size).toBeGreaterThan(0);
      expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);

      // Verify S3 was called
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls.length).toBe(1);
      expect(s3Calls[0].args[0].input.Bucket).toBe('gaib-backups-123456789012');
      expect(s3Calls[0].args[0].input.ContentType).toBe('application/gzip');
    });

    it('should calculate correct checksum', async () => {
      let uploadedBody: Buffer | undefined;

      s3Mock.on(PutObjectCommand).callsFake((input) => {
        uploadedBody = input.Body as Buffer;
        return {};
      });
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await manager.createBackup({});

      // Verify checksum matches uploaded content
      const expectedChecksum = createHash('sha256').update(uploadedBody!).digest('hex');
      expect(result.checksum).toBe(expectedChecksum);
    });

    it('should write metadata to DynamoDB', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await manager.createBackup({ message: 'Test backup' });

      // Verify DynamoDB was called
      const dynamoCalls = dynamoMock.commandCalls(PutItemCommand);
      expect(dynamoCalls.length).toBeGreaterThanOrEqual(1);

      // Find the metadata write call
      const metadataCall = dynamoCalls.find((call) =>
        call.args[0].input.TableName === 'gaib-backup-metadata'
      );
      expect(metadataCall).toBeDefined();
    });

    it('should throw error when no state exists', async () => {
      const emptyBackend = createMockBackend(null);
      manager.setBackend(emptyBackend);

      await expect(manager.createBackup({})).rejects.toThrow(BackupError);
      await expect(manager.createBackup({})).rejects.toMatchObject({
        code: BackupErrorCode.NO_STATE,
      });
    });
  });

  // ============================================================================
  // listBackups Tests
  // ============================================================================

  describe('listBackups', () => {
    beforeEach(async () => {
      manager = await BackupManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should return backups from DynamoDB', async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: { S: 'SERVER#1234567890' },
            SK: { S: 'BACKUP#2026-01-29T12:00:00Z#abc123' },
            id: { S: 'abc123' },
            timestamp: { S: '2026-01-29T12:00:00Z' },
            serial: { N: '42' },
            size: { N: '1024' },
            message: { S: 'Test backup' },
            type: { S: 'state' },
          },
          {
            PK: { S: 'SERVER#1234567890' },
            SK: { S: 'BACKUP#2026-01-28T12:00:00Z#def456' },
            id: { S: 'def456' },
            timestamp: { S: '2026-01-28T12:00:00Z' },
            serial: { N: '41' },
            size: { N: '2048' },
            type: { S: 'state' },
          },
        ],
      });

      const backups = await manager.listBackups({ limit: 10 });

      expect(backups).toHaveLength(2);
      expect(backups[0].id).toBe('abc123');
      expect(backups[0].timestamp).toBe('2026-01-29T12:00:00Z');
      expect(backups[0].serial).toBe(42);
      expect(backups[0].size).toBe(1024);
      expect(backups[0].message).toBe('Test backup');
    });

    it('should return empty array when no backups exist', async () => {
      dynamoMock.on(QueryCommand).resolves({ Items: [] });

      const backups = await manager.listBackups({});

      expect(backups).toEqual([]);
    });

    it('should respect limit parameter', async () => {
      dynamoMock.on(QueryCommand).resolves({ Items: [] });

      await manager.listBackups({ limit: 5 });

      const calls = dynamoMock.commandCalls(QueryCommand);
      expect(calls[0].args[0].input.Limit).toBe(5);
    });
  });

  // ============================================================================
  // restoreBackup Tests
  // ============================================================================

  describe('restoreBackup', () => {
    const backupMetadata = {
      PK: { S: 'SERVER#1234567890' },
      SK: { S: 'BACKUP#2026-01-29T12:00:00Z#abc123' },
      id: { S: 'abc123' },
      serverId: { S: '1234567890' },
      workspace: { S: 'default' },
      timestamp: { S: '2026-01-29T12:00:00Z' },
      serial: { N: '42' },
      lineage: { S: 'test-lineage-123' },
      tier: { S: 'free' },
      s3Bucket: { S: 'gaib-backups-123456789012' },
      s3Key: { S: 'state/1234567890/default/backup.2026-01-29T12:00:00Z.json.gz' },
      size: { N: '1024' },
      checksum: { S: '' }, // Will be set below
      type: { S: 'state' },
      TTL: { N: '1735689600' },
    };

    beforeEach(async () => {
      manager = await BackupManager.create({
        serverId: '1234567890',
        workspace: 'default',
        backend: mockBackend,
      });
      manager.setBackend(mockBackend);
    });

    it('should verify checksum before restore', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const correctChecksum = createHash('sha256').update(compressed).digest('hex');

      dynamoMock.on(QueryCommand).resolves({
        Items: [{ ...backupMetadata, checksum: { S: correctChecksum } }],
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await manager.restoreBackup('abc123', { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.backup.checksum).toBe(correctChecksum);
    });

    it('should throw IntegrityError on checksum mismatch', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const wrongChecksum = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      dynamoMock.on(QueryCommand).resolves({
        Items: [{ ...backupMetadata, checksum: { S: wrongChecksum } }],
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      await expect(manager.restoreBackup('abc123', {})).rejects.toThrow(IntegrityError);
    });

    it('should validate lineage matches current state', async () => {
      const differentLineageState = { ...sampleState, lineage: 'different-lineage' };
      const compressed = gzipSync(Buffer.from(JSON.stringify(differentLineageState)));
      const checksum = createHash('sha256').update(compressed).digest('hex');

      dynamoMock.on(QueryCommand).resolves({
        Items: [{ ...backupMetadata, checksum: { S: checksum } }],
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      await expect(manager.restoreBackup('abc123', {})).rejects.toThrow(LineageError);
    });

    it('should support dry-run mode', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const checksum = createHash('sha256').update(compressed).digest('hex');

      dynamoMock.on(QueryCommand).resolves({
        Items: [{ ...backupMetadata, checksum: { S: checksum } }],
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await manager.restoreBackup('abc123', { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(mockBackend.setState).not.toHaveBeenCalled();
    });

    it('should write restored state on non-dry-run', async () => {
      const compressed = gzipSync(Buffer.from(JSON.stringify(sampleState)));
      const checksum = createHash('sha256').update(compressed).digest('hex');

      dynamoMock.on(QueryCommand).resolves({
        Items: [{ ...backupMetadata, checksum: { S: checksum } }],
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(compressed),
      });

      const result = await manager.restoreBackup('abc123', { dryRun: false });

      expect(result.dryRun).toBe(false);
      expect(mockBackend.setState).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // deleteBackup Tests
  // ============================================================================

  describe('deleteBackup', () => {
    beforeEach(async () => {
      manager = await BackupManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should delete from S3 and DynamoDB', async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: { S: 'SERVER#1234567890' },
            SK: { S: 'BACKUP#2026-01-29T12:00:00Z#abc123' },
            id: { S: 'abc123' },
            serverId: { S: '1234567890' },
            workspace: { S: 'default' },
            timestamp: { S: '2026-01-29T12:00:00Z' },
            s3Bucket: { S: 'gaib-backups-123456789012' },
            s3Key: { S: 'state/1234567890/default/backup.2026-01-29T12:00:00Z.json.gz' },
            serial: { N: '42' },
            lineage: { S: 'test-lineage' },
            tier: { S: 'free' },
            size: { N: '1024' },
            checksum: { S: 'abc' },
            type: { S: 'state' },
            TTL: { N: '1735689600' },
          },
        ],
      });
      s3Mock.on(DeleteObjectCommand).resolves({});
      dynamoMock.on(DeleteItemCommand).resolves({});

      await manager.deleteBackup('abc123');

      expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(DeleteItemCommand)).toHaveLength(1);
    });

    it('should throw error when backup not found', async () => {
      dynamoMock.on(QueryCommand).resolves({ Items: [] });

      await expect(manager.deleteBackup('nonexistent')).rejects.toThrow(BackupError);
      await expect(manager.deleteBackup('nonexistent')).rejects.toMatchObject({
        code: BackupErrorCode.NOT_FOUND,
      });
    });
  });
});
