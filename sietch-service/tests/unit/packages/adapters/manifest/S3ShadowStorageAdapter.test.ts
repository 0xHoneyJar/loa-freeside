/**
 * S3ShadowStorageAdapter Unit Tests
 *
 * Sprint 43: Hybrid Manifest Repository
 *
 * Tests for S3 shadow storage operations with mocked S3 client.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  S3ShadowStorageAdapter,
  S3ShadowStorageError,
  createS3ShadowStorageAdapter,
  type ManifestSnapshot,
  type VersionIndex,
} from '../../../../../src/packages/adapters/manifest/S3ShadowStorageAdapter.js';
import type { ManifestContent } from '../../../../../src/packages/adapters/storage/schema.js';

// =============================================================================
// Mock S3 Client
// =============================================================================

function createMockS3Client() {
  const objects = new Map<string, string>();

  return {
    send: vi.fn(async (command: unknown) => {
      const cmd = command as { constructor: { name: string }; input: Record<string, unknown> };
      const commandName = cmd.constructor.name;

      if (commandName === 'PutObjectCommand') {
        const key = cmd.input.Key as string;
        const body = cmd.input.Body as string;
        objects.set(key, body);
        return {};
      }

      if (commandName === 'GetObjectCommand') {
        const key = cmd.input.Key as string;
        const body = objects.get(key);
        if (!body) {
          const error = new Error('NoSuchKey');
          (error as { name: string }).name = 'NoSuchKey';
          throw error;
        }
        return {
          Body: {
            transformToString: async () => body,
          },
        };
      }

      if (commandName === 'HeadBucketCommand') {
        return {};
      }

      if (commandName === 'ListObjectsV2Command') {
        const prefix = cmd.input.Prefix as string;
        const contents = Array.from(objects.entries())
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({
            Key: key,
            Size: Buffer.byteLength(value, 'utf8'),
          }));

        return { Contents: contents };
      }

      return {};
    }),
    _objects: objects,
  };
}

// =============================================================================
// Test Data
// =============================================================================

const testCommunityId = 'test-community-123';

const testManifestContent: ManifestContent = {
  schemaVersion: '1.0',
  theme: {
    themeId: 'sietch',
  },
  roles: [
    { id: 'role-1', name: 'Naib', color: '#FFD700' },
    { id: 'role-2', name: 'Fedaykin', color: '#C4A35A' },
  ],
  channels: [
    { id: 'channel-1', name: 'general', type: 'text' },
  ],
  categories: [
    { id: 'cat-1', name: 'SIETCH-COMMONS' },
  ],
};

// =============================================================================
// Tests
// =============================================================================

describe('S3ShadowStorageAdapter', () => {
  let adapter: S3ShadowStorageAdapter;
  let mockClient: ReturnType<typeof createMockS3Client>;

  beforeEach(() => {
    mockClient = createMockS3Client();
    adapter = new S3ShadowStorageAdapter({
      bucket: 'test-bucket',
      prefix: 'manifests/',
      communityId: testCommunityId,
      debug: false,
      client: mockClient as never,
    });
  });

  describe('generateChecksum', () => {
    it('should generate consistent checksum for same content', () => {
      const checksum1 = adapter.generateChecksum(testManifestContent);
      const checksum2 = adapter.generateChecksum(testManifestContent);

      expect(checksum1).toBe(checksum2);
      expect(checksum1).toHaveLength(64); // SHA-256 hex
    });

    it('should generate different checksum for different content', () => {
      const modifiedContent: ManifestContent = {
        ...testManifestContent,
        roles: [{ id: 'different', name: 'Different', color: '#000000' }],
      };

      const checksum1 = adapter.generateChecksum(testManifestContent);
      const checksum2 = adapter.generateChecksum(modifiedContent);

      expect(checksum1).not.toBe(checksum2);
    });
  });

  describe('validateChecksum', () => {
    it('should return true for valid checksum', () => {
      const checksum = adapter.generateChecksum(testManifestContent);
      const isValid = adapter.validateChecksum(testManifestContent, checksum);

      expect(isValid).toBe(true);
    });

    it('should return false for invalid checksum', () => {
      const isValid = adapter.validateChecksum(testManifestContent, 'invalid-checksum');

      expect(isValid).toBe(false);
    });
  });

  describe('writeVersion', () => {
    it('should write manifest to S3', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      const meta = await adapter.writeVersion({
        id: 'manifest-1',
        version: 1,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
        synthesizedBy: 'test',
      });

      expect(meta.version).toBe(1);
      expect(meta.checksum).toBe(checksum);
      expect(meta.communityId).toBe(testCommunityId);
      expect(meta.s3Key).toContain('v000001.json');
      expect(mockClient.send).toHaveBeenCalled();
    });

    it('should pad version number with zeros', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      const meta = await adapter.writeVersion({
        id: 'manifest-1',
        version: 42,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
      });

      expect(meta.s3Key).toContain('v000042.json');
    });

    it('should update index after write', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      await adapter.writeVersion({
        id: 'manifest-1',
        version: 1,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
      });

      // Should have written both version and index
      expect(mockClient._objects.size).toBe(2);
      expect(mockClient._objects.has(`manifests/${testCommunityId}/index.json`)).toBe(true);
    });
  });

  describe('readVersion', () => {
    it('should read existing version', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      await adapter.writeVersion({
        id: 'manifest-1',
        version: 1,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
        synthesizedBy: 'test',
      });

      const snapshot = await adapter.readVersion(1);

      expect(snapshot).not.toBeNull();
      expect(snapshot?.version).toBe(1);
      expect(snapshot?.content).toEqual(testManifestContent);
      expect(snapshot?.checksum).toBe(checksum);
    });

    it('should return null for non-existent version', async () => {
      const snapshot = await adapter.readVersion(999);

      expect(snapshot).toBeNull();
    });
  });

  describe('listVersions', () => {
    it('should list all versions', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      // Write multiple versions
      for (let i = 1; i <= 3; i++) {
        await adapter.writeVersion({
          id: `manifest-${i}`,
          version: i,
          content: testManifestContent,
          checksum,
          synthesizedAt: new Date(),
        });
      }

      const versions = await adapter.listVersions();

      expect(versions).toHaveLength(3);
      expect(versions[0].version).toBe(3); // Newest first
      expect(versions[2].version).toBe(1); // Oldest last
    });

    it('should limit results when specified', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      for (let i = 1; i <= 5; i++) {
        await adapter.writeVersion({
          id: `manifest-${i}`,
          version: i,
          content: testManifestContent,
          checksum,
          synthesizedAt: new Date(),
        });
      }

      const versions = await adapter.listVersions(2);

      expect(versions).toHaveLength(2);
      expect(versions[0].version).toBe(5);
      expect(versions[1].version).toBe(4);
    });

    it('should return empty array when no versions exist', async () => {
      const versions = await adapter.listVersions();

      expect(versions).toEqual([]);
    });
  });

  describe('getLatestVersion', () => {
    it('should return latest version number', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      await adapter.writeVersion({
        id: 'manifest-1',
        version: 1,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
      });

      await adapter.writeVersion({
        id: 'manifest-5',
        version: 5,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
      });

      const latest = await adapter.getLatestVersion();

      expect(latest).toBe(5);
    });

    it('should return 0 when no versions exist', async () => {
      const latest = await adapter.getLatestVersion();

      expect(latest).toBe(0);
    });
  });

  describe('readIndex', () => {
    it('should read existing index', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      await adapter.writeVersion({
        id: 'manifest-1',
        version: 1,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
      });

      const index = await adapter.readIndex();

      expect(index).not.toBeNull();
      expect(index?.communityId).toBe(testCommunityId);
      expect(index?.latestVersion).toBe(1);
      expect(index?.totalVersions).toBe(1);
    });

    it('should return null when no index exists', async () => {
      const index = await adapter.readIndex();

      expect(index).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('should return true when bucket is accessible', async () => {
      const isHealthy = await adapter.healthCheck();

      expect(isHealthy).toBe(true);
    });

    it('should return false when bucket is not accessible', async () => {
      mockClient.send.mockRejectedValueOnce(new Error('Access Denied'));

      const isHealthy = await adapter.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      const checksum = adapter.generateChecksum(testManifestContent);

      await adapter.writeVersion({
        id: 'manifest-1',
        version: 1,
        content: testManifestContent,
        checksum,
        synthesizedAt: new Date(),
      });

      const stats = await adapter.getStats();

      expect(stats.totalVersions).toBe(1);
      expect(stats.latestVersion).toBe(1);
      expect(stats.totalSizeBytes).toBeGreaterThan(0);
    });

    it('should return zeros when no data exists', async () => {
      const stats = await adapter.getStats();

      expect(stats.totalVersions).toBe(0);
      expect(stats.latestVersion).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
    });
  });

  describe('createS3ShadowStorageAdapter', () => {
    it('should create adapter instance', () => {
      const newAdapter = createS3ShadowStorageAdapter({
        bucket: 'test-bucket',
        communityId: 'test-123',
        client: mockClient as never,
      });

      expect(newAdapter).toBeInstanceOf(S3ShadowStorageAdapter);
    });
  });
});
