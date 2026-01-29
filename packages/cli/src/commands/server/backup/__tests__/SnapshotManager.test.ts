/**
 * SnapshotManager Unit Tests
 *
 * Sprint 168: Snapshots - Unit Tests
 *
 * Tests snapshot creation, listing, restore, download, and compare operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
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
import * as fs from 'fs';
import * as path from 'path';

import { SnapshotManager, type ConfigExporter } from '../SnapshotManager.js';
import { IntegrityError } from '../types.js';
import type { GaibState, StateBackend } from '../../iac/backends/types.js';
import type { ThemeRegistry } from '../types.js';

// ============================================================================
// Mocks
// ============================================================================

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  };
});

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

// Mock config exporter
const createMockExporter = (yaml: string): ConfigExporter => ({
  export: vi.fn().mockResolvedValue(yaml),
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
    {
      type: 'discord_category',
      name: 'general-category',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '3333333333',
            name: 'General',
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
    // Added new role
    {
      type: 'discord_role',
      name: 'fedaykin',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '4444444444',
            name: 'Fedaykin',
            color: '#00FF00',
          },
        },
      ],
    },
    // Channel removed
    {
      type: 'discord_category',
      name: 'general-category',
      provider: 'gaib',
      instances: [
        {
          schema_version: 1,
          attributes: {
            id: '3333333333',
            name: 'General',
          },
        },
      ],
    },
  ],
  lastModified: '2026-01-29T14:00:00Z',
};

const sampleConfig = `version: '1.0'
server:
  id: '1234567890'
roles:
  - name: Naib
    color: '#FFD700'
`;

const sampleThemeRegistry: ThemeRegistry = {
  serverId: '1234567890',
  workspace: 'default',
  version: '1.0',
  current: {
    id: 'deploy-123',
    timestamp: '2026-01-29T12:00:00Z',
    themeName: 'sietch',
    themeVersion: '3.0.0',
    serial: 42,
    action: 'apply',
    who: 'test-user',
  },
  history: [],
  lastUpdated: '2026-01-29T12:00:00Z',
};

// Helper to create mock manifest
const createMockManifest = (id: string, state: GaibState) => {
  const stateJson = JSON.stringify(state, null, 2);
  const stateCompressed = gzipSync(Buffer.from(stateJson));
  const stateChecksum = createHash('sha256').update(stateCompressed).digest('hex');

  const configCompressed = gzipSync(Buffer.from(sampleConfig));
  const configChecksum = createHash('sha256').update(configCompressed).digest('hex');

  const registryJson = JSON.stringify(sampleThemeRegistry, null, 2);
  const registryCompressed = gzipSync(Buffer.from(registryJson));
  const registryChecksum = createHash('sha256').update(registryCompressed).digest('hex');

  const manifest = {
    version: '1.0' as const,
    id,
    serverId: '1234567890',
    workspace: 'default',
    timestamp: '2026-01-29T12:00:00Z',
    serial: state.serial,
    lineage: state.lineage,
    tier: 'free' as const,
    files: {
      state: {
        path: 'state.json.gz',
        checksum: stateChecksum,
        size: Buffer.from(stateJson).length,
        compressedSize: stateCompressed.length,
      },
      config: {
        path: 'config.yaml.gz',
        checksum: configChecksum,
        size: Buffer.from(sampleConfig).length,
        compressedSize: configCompressed.length,
      },
      themeRegistry: {
        path: 'theme-registry.json.gz',
        checksum: registryChecksum,
        size: Buffer.from(registryJson).length,
        compressedSize: registryCompressed.length,
      },
    },
    discord: {
      roleCount: 1,
      channelCount: 1,
      categoryCount: 1,
    },
    theme: {
      name: 'sietch',
      version: '3.0.0',
    },
    manifestChecksum: '',
  };

  const manifestWithoutChecksum = { ...manifest, manifestChecksum: undefined };
  manifest.manifestChecksum = createHash('sha256')
    .update(JSON.stringify(manifestWithoutChecksum))
    .digest('hex');

  return { manifest, stateCompressed, configCompressed, registryCompressed };
};

// ============================================================================
// Test Setup
// ============================================================================

describe('SnapshotManager', () => {
  let manager: SnapshotManager;
  let mockBackend: StateBackend;
  let mockExporter: ConfigExporter;

  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    vi.clearAllMocks();

    process.env.AWS_ACCOUNT_ID = '123456789012';
    process.env.AWS_REGION = 'us-east-1';

    mockBackend = createMockBackend(sampleState);
    mockExporter = createMockExporter(sampleConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // createSnapshot Tests
  // ============================================================================

  describe('createSnapshot', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
        backend: mockBackend,
        configExporter: mockExporter,
        themeRegistry: sampleThemeRegistry,
      });

      // Mock tier check
      dynamoMock.on(QueryCommand).resolves({ Items: [] });
    });

    it('should create snapshot with manifest and files', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await manager.createSnapshot({ message: 'Test snapshot' });

      expect(result.id).toBeDefined();
      expect(result.timestamp).toBeDefined();
      expect(result.manifest.serial).toBe(42);
      expect(result.manifest.discord.roleCount).toBe(1);
      expect(result.manifest.discord.channelCount).toBe(1);
      expect(result.manifest.discord.categoryCount).toBe(1);
      expect(result.manifest.theme?.name).toBe('sietch');

      // Verify S3 uploads (manifest + 3 files)
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls.length).toBe(4);
    });

    it('should generate correct manifest checksums', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(PutItemCommand).resolves({});

      const result = await manager.createSnapshot({});

      // Verify manifest checksum
      const manifestWithoutChecksum = { ...result.manifest, manifestChecksum: undefined };
      const expectedChecksum = createHash('sha256')
        .update(JSON.stringify(manifestWithoutChecksum))
        .digest('hex');

      expect(result.manifest.manifestChecksum).toBe(expectedChecksum);
    });

    it('should write metadata to DynamoDB', async () => {
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(PutItemCommand).resolves({});

      await manager.createSnapshot({});

      const dynamoCalls = dynamoMock.commandCalls(PutItemCommand);
      expect(dynamoCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should throw error when no state exists', async () => {
      const emptyBackend = createMockBackend(null);
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
        backend: emptyBackend,
      });

      await expect(manager.createSnapshot({})).rejects.toThrow('No state to snapshot');
    });
  });

  // ============================================================================
  // listSnapshots Tests
  // ============================================================================

  describe('listSnapshots', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should return snapshots from DynamoDB', async () => {
      const { manifest } = createMockManifest('snap-123', sampleState);

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: { S: 'SERVER#1234567890' },
            SK: { S: 'SNAPSHOT#2026-01-29T12:00:00Z#snap-123' },
            id: { S: 'snap-123' },
            timestamp: { S: '2026-01-29T12:00:00Z' },
            serial: { N: '42' },
            message: { S: 'Test snapshot' },
          },
        ],
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(manifest)),
      });

      const snapshots = await manager.listSnapshots({ limit: 10 });

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].id).toBe('snap-123');
      expect(snapshots[0].timestamp).toBe('2026-01-29T12:00:00Z');
    });

    it('should return empty array when no snapshots exist', async () => {
      dynamoMock.on(QueryCommand).resolves({ Items: [] });

      const snapshots = await manager.listSnapshots({});

      expect(snapshots).toEqual([]);
    });
  });

  // ============================================================================
  // getManifest Tests
  // ============================================================================

  describe('getManifest', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should fetch and parse manifest from S3', async () => {
      const { manifest } = createMockManifest('snap-123', sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(manifest)),
      });

      const result = await manager.getManifest('snap-123');

      expect(result.id).toBe('snap-123');
      expect(result.serial).toBe(42);
    });
  });

  // ============================================================================
  // downloadSnapshot Tests
  // ============================================================================

  describe('downloadSnapshot', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should download and verify all files', async () => {
      const { manifest, stateCompressed, configCompressed, registryCompressed } =
        createMockManifest('snap-123', sampleState);

      // Mock manifest fetch
      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest)) });

      // Mock file fetches
      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('state.json.gz') })
        .resolves({ Body: Readable.from(stateCompressed) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('config.yaml.gz') })
        .resolves({ Body: Readable.from(configCompressed) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('theme-registry.json.gz') })
        .resolves({ Body: Readable.from(registryCompressed) });

      const result = await manager.downloadSnapshot('snap-123', '/tmp/test-output');

      expect(result.outputDir).toBe('/tmp/test-output');
      expect(result.files).toHaveLength(4); // 3 files + manifest
      expect(result.manifest.id).toBe('snap-123');
    });

    it('should throw IntegrityError on checksum mismatch', async () => {
      const { manifest } = createMockManifest('snap-123', sampleState);

      // Mock manifest fetch
      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest)) });

      // Return corrupted data
      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('state.json.gz') })
        .resolves({ Body: Readable.from(gzipSync(Buffer.from('corrupted data'))) });

      await expect(
        manager.downloadSnapshot('snap-123', '/tmp/test-output')
      ).rejects.toThrow(IntegrityError);
    });
  });

  // ============================================================================
  // compareSnapshots Tests
  // ============================================================================

  describe('compareSnapshots', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should show differences between snapshots', async () => {
      const { manifest: manifest1, stateCompressed: state1Compressed } =
        createMockManifest('snap-1', sampleState);
      const { manifest: manifest2, stateCompressed: state2Compressed } =
        createMockManifest('snap-2', modifiedState);

      // Mock manifest fetches
      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('snap-1/manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest1)) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('snap-2/manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest2)) });

      // Mock state file fetches
      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('snap-1/state.json.gz') })
        .resolves({ Body: Readable.from(state1Compressed) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('snap-2/state.json.gz') })
        .resolves({ Body: Readable.from(gzipSync(Buffer.from(JSON.stringify(modifiedState)))) });

      const diff = await manager.compareSnapshots('snap-1', 'snap-2');

      expect(diff.snapshot1.id).toBe('snap-1');
      expect(diff.snapshot2.id).toBe('snap-2');

      // Modified role (color changed)
      expect(diff.roles.modified).toContainEqual(
        expect.objectContaining({
          name: 'naib',
          changes: expect.objectContaining({
            color: { from: '#FFD700', to: '#FF0000' },
          }),
        })
      );

      // Added role
      expect(diff.roles.added).toContain('fedaykin');

      // Removed channel
      expect(diff.channels.removed).toContain('general');
    });

    it('should show no changes for identical snapshots', async () => {
      const { manifest, stateCompressed } = createMockManifest('snap-1', sampleState);

      s3Mock.on(GetObjectCommand).resolves({
        Body: Readable.from(JSON.stringify(manifest)),
      });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('state.json.gz') })
        .resolves({ Body: Readable.from(stateCompressed) });

      const diff = await manager.compareSnapshots('snap-1', 'snap-1');

      expect(diff.roles.added).toHaveLength(0);
      expect(diff.roles.removed).toHaveLength(0);
      expect(diff.roles.modified).toHaveLength(0);
    });
  });

  // ============================================================================
  // restoreSnapshot Tests
  // ============================================================================

  describe('restoreSnapshot', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
        backend: mockBackend,
      });
    });

    it('should restore state from snapshot', async () => {
      const { manifest, stateCompressed } = createMockManifest('snap-123', sampleState);

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest)) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('state.json.gz') })
        .resolves({ Body: Readable.from(stateCompressed) });

      const result = await manager.restoreSnapshot('snap-123', { dryRun: false });

      expect(result.dryRun).toBe(false);
      expect(result.manifest.id).toBe('snap-123');
      expect(mockBackend.setState).toHaveBeenCalled();
    });

    it('should not modify state on dry run', async () => {
      const { manifest, stateCompressed } = createMockManifest('snap-123', sampleState);

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest)) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('state.json.gz') })
        .resolves({ Body: Readable.from(stateCompressed) });

      const result = await manager.restoreSnapshot('snap-123', { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(mockBackend.setState).not.toHaveBeenCalled();
    });

    it('should throw IntegrityError on state checksum mismatch', async () => {
      const { manifest } = createMockManifest('snap-123', sampleState);

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('manifest.json') })
        .resolves({ Body: Readable.from(JSON.stringify(manifest)) });

      s3Mock
        .on(GetObjectCommand, { Key: expect.stringContaining('state.json.gz') })
        .resolves({ Body: Readable.from(gzipSync(Buffer.from('corrupted'))) });

      await expect(
        manager.restoreSnapshot('snap-123', {})
      ).rejects.toThrow(IntegrityError);
    });
  });

  // ============================================================================
  // deleteSnapshot Tests
  // ============================================================================

  describe('deleteSnapshot', () => {
    beforeEach(async () => {
      manager = await SnapshotManager.create({
        serverId: '1234567890',
        workspace: 'default',
      });
    });

    it('should delete snapshot files from S3 and metadata from DynamoDB', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [
          { Key: 'snapshots/1234567890/snap-123/manifest.json' },
          { Key: 'snapshots/1234567890/snap-123/state.json.gz' },
        ],
      });

      s3Mock.on(DeleteObjectsCommand).resolves({});

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            PK: { S: 'SERVER#1234567890' },
            SK: { S: 'SNAPSHOT#2026-01-29T12:00:00Z#snap-123' },
            id: { S: 'snap-123' },
          },
        ],
      });

      dynamoMock.on(DeleteItemCommand).resolves({});

      await manager.deleteSnapshot('snap-123');

      expect(s3Mock.commandCalls(DeleteObjectsCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(DeleteItemCommand)).toHaveLength(1);
    });
  });
});
