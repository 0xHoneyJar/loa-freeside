/**
 * HybridManifestRepository Unit Tests
 *
 * Sprint 43: Hybrid Manifest Repository
 *
 * Tests for hybrid PostgreSQL + S3 manifest storage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HybridManifestRepository,
  createHybridManifestRepository,
} from '../../../../../src/packages/adapters/manifest/HybridManifestRepository.js';
import { S3ShadowStorageAdapter } from '../../../../../src/packages/adapters/manifest/S3ShadowStorageAdapter.js';
import type { IStorageProvider } from '../../../../../src/packages/core/ports/IStorageProvider.js';
import type {
  Manifest,
  ManifestContent,
  ShadowState,
  ShadowResources,
} from '../../../../../src/packages/adapters/storage/schema.js';

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
// Mock Storage Provider
// =============================================================================

function createMockStorageProvider(communityId: string): IStorageProvider & {
  _manifests: Map<number, Manifest>;
  _shadowStates: Map<number, ShadowState>;
  _currentVersion: number;
} {
  const manifests = new Map<number, Manifest>();
  const shadowStates = new Map<number, ShadowState>();
  let currentVersion = 0;

  return {
    tenantId: communityId,
    _manifests: manifests,
    _shadowStates: shadowStates,
    _currentVersion: currentVersion,

    createManifest: vi.fn(async (data) => {
      currentVersion++;
      const manifest: Manifest = {
        id: `manifest-${currentVersion}`,
        communityId,
        version: currentVersion,
        content: data.content,
        checksum: data.checksum,
        synthesizedAt: new Date(),
        synthesizedBy: data.synthesizedBy ?? null,
        isActive: true,
        createdAt: new Date(),
      };
      manifests.set(currentVersion, manifest);
      return manifest;
    }),

    getCurrentManifest: vi.fn(async () => {
      if (manifests.size === 0) return null;
      const latest = Math.max(...manifests.keys());
      return manifests.get(latest) ?? null;
    }),

    getManifestByVersion: vi.fn(async (version: number) => {
      return manifests.get(version) ?? null;
    }),

    deactivateCurrentManifest: vi.fn(async () => {
      // Mark all as inactive
      for (const manifest of manifests.values()) {
        manifest.isActive = false;
      }
    }),

    createShadowState: vi.fn(async (data) => {
      const shadowState: ShadowState = {
        id: `shadow-${data.manifestVersion}`,
        communityId,
        manifestVersion: data.manifestVersion,
        appliedAt: new Date(),
        appliedBy: data.appliedBy ?? null,
        resources: data.resources,
        checksum: data.checksum,
        status: data.status,
        createdAt: new Date(),
      };
      shadowStates.set(data.manifestVersion, shadowState);
      return shadowState;
    }),

    getCurrentShadowState: vi.fn(async () => {
      if (shadowStates.size === 0) return null;
      const latest = Math.max(...shadowStates.keys());
      return shadowStates.get(latest) ?? null;
    }),

    getShadowStateByVersion: vi.fn(async (version: number) => {
      return shadowStates.get(version) ?? null;
    }),

    // Other required methods (stubbed)
    createCommunity: vi.fn(),
    getCommunityByDiscordId: vi.fn(),
    createRole: vi.fn(),
    createChannel: vi.fn(),
    createCategory: vi.fn(),
    updateRole: vi.fn(),
    updateChannel: vi.fn(),
    updateCategory: vi.fn(),
    deleteRole: vi.fn(),
    deleteChannel: vi.fn(),
    deleteCategory: vi.fn(),
    getRoleByManifestId: vi.fn(),
    getChannelByManifestId: vi.fn(),
    getCategoryByManifestId: vi.fn(),
    getAllRoles: vi.fn(),
    getAllChannels: vi.fn(),
    getAllCategories: vi.fn(),
  } as unknown as IStorageProvider & {
    _manifests: Map<number, Manifest>;
    _shadowStates: Map<number, ShadowState>;
    _currentVersion: number;
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
    { id: 'channel-2', name: 'voice-chat', type: 'voice' },
  ],
  categories: [
    { id: 'cat-1', name: 'SIETCH-COMMONS' },
  ],
};

const testShadowResources: ShadowResources = {
  roles: {
    'role-1': 'discord-role-1',
    'role-2': 'discord-role-2',
  },
  channels: {
    'channel-1': 'discord-channel-1',
    'channel-2': 'discord-channel-2',
  },
  categories: {
    'cat-1': 'discord-cat-1',
  },
};

// =============================================================================
// Helper to create repo with mock S3
// =============================================================================

function createTestRepo(mockStorage: ReturnType<typeof createMockStorageProvider>, mockS3Client: ReturnType<typeof createMockS3Client>) {
  // Create repo
  const repo = new HybridManifestRepository({
    storage: mockStorage,
    s3Bucket: 'test-bucket',
    s3Prefix: 'manifests/',
    debug: false,
  });

  // Create mock S3 shadow adapter and inject it
  const mockS3Shadow = new S3ShadowStorageAdapter({
    bucket: 'test-bucket',
    prefix: 'manifests/',
    communityId: testCommunityId,
    debug: false,
    client: mockS3Client as never,
  });

  // Inject the mock S3 shadow adapter
  (repo as unknown as { s3Shadow: S3ShadowStorageAdapter }).s3Shadow = mockS3Shadow;

  return { repo, mockS3Shadow };
}

// =============================================================================
// Tests
// =============================================================================

describe('HybridManifestRepository', () => {
  let repo: HybridManifestRepository;
  let mockStorage: ReturnType<typeof createMockStorageProvider>;
  let mockS3Client: ReturnType<typeof createMockS3Client>;
  let mockS3Shadow: S3ShadowStorageAdapter;

  beforeEach(() => {
    mockStorage = createMockStorageProvider(testCommunityId);
    mockS3Client = createMockS3Client();
    const testSetup = createTestRepo(mockStorage, mockS3Client);
    repo = testSetup.repo;
    mockS3Shadow = testSetup.mockS3Shadow;
  });

  describe('createManifest', () => {
    it('should create manifest in PostgreSQL', async () => {
      const manifest = await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test-wizard',
        skipShadowWrite: true,
      });

      expect(manifest).toBeDefined();
      expect(manifest.version).toBe(1);
      expect(manifest.content).toEqual(testManifestContent);
      expect(mockStorage.createManifest).toHaveBeenCalled();
    });

    it('should skip S3 shadow when specified', async () => {
      const manifest = await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      expect(manifest).toBeDefined();
      // S3 should not be written
      expect(mockS3Client._objects.size).toBe(0);
    });

    it('should use provided checksum', async () => {
      const customChecksum = 'custom-checksum-123';

      const manifest = await repo.createManifest({
        content: testManifestContent,
        checksum: customChecksum,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      expect(manifest.checksum).toBe(customChecksum);
    });

    it('should auto-generate checksum when not provided', async () => {
      const manifest = await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      expect(manifest.checksum).toBeDefined();
      expect(manifest.checksum.length).toBe(64); // SHA-256 hex length
    });
  });

  describe('getCurrentManifest', () => {
    it('should return current manifest from PostgreSQL', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const manifest = await repo.getCurrentManifest();

      expect(manifest).toBeDefined();
      expect(manifest?.version).toBe(1);
    });

    it('should return null when no manifest exists', async () => {
      const manifest = await repo.getCurrentManifest();

      expect(manifest).toBeNull();
    });
  });

  describe('getManifestByVersion', () => {
    it('should return manifest from PostgreSQL when available', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const manifest = await repo.getManifestByVersion(1);

      expect(manifest).toBeDefined();
      expect(manifest?.version).toBe(1);
    });

    it('should return null for non-existent version', async () => {
      const manifest = await repo.getManifestByVersion(999);

      expect(manifest).toBeNull();
    });
  });

  describe('recordApply', () => {
    it('should record shadow state', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const shadowState = await repo.recordApply({
        version: 1,
        resources: testShadowResources,
        appliedBy: 'test-applier',
      });

      expect(shadowState).toBeDefined();
      expect(shadowState.manifestVersion).toBe(1);
      expect(shadowState.resources).toEqual(testShadowResources);
      expect(mockStorage.createShadowState).toHaveBeenCalled();
    });

    it('should generate checksum for resources', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const shadowState = await repo.recordApply({
        version: 1,
        resources: testShadowResources,
        appliedBy: 'test',
      });

      expect(shadowState.checksum).toBeDefined();
      expect(shadowState.checksum.length).toBe(64);
    });
  });

  describe('getCurrentShadowState', () => {
    it('should return current shadow state', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      await repo.recordApply({
        version: 1,
        resources: testShadowResources,
        appliedBy: 'test',
      });

      const shadow = await repo.getCurrentShadowState();

      expect(shadow).toBeDefined();
      expect(shadow?.manifestVersion).toBe(1);
    });

    it('should return null when no shadow exists', async () => {
      const shadow = await repo.getCurrentShadowState();

      expect(shadow).toBeNull();
    });
  });

  describe('getShadowStateByVersion', () => {
    it('should return shadow state for specific version', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      await repo.recordApply({
        version: 1,
        resources: testShadowResources,
        appliedBy: 'test',
      });

      const shadow = await repo.getShadowStateByVersion(1);

      expect(shadow).toBeDefined();
      expect(shadow?.manifestVersion).toBe(1);
    });

    it('should return null for non-existent version', async () => {
      const shadow = await repo.getShadowStateByVersion(999);

      expect(shadow).toBeNull();
    });
  });

  describe('detectDrift', () => {
    it('should return no drift when no manifest exists', async () => {
      const drift = await repo.detectDrift();

      expect(drift.hasDrift).toBe(false);
    });

    it('should detect missing resources when no shadow exists', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const drift = await repo.detectDrift();

      expect(drift.hasDrift).toBe(true);
      expect(drift.drifts.length).toBeGreaterThan(0);
      expect(drift.drifts.some(d => d.driftType === 'missing')).toBe(true);
    });

    it('should detect extra resources in shadow', async () => {
      await repo.createManifest({
        content: {
          ...testManifestContent,
          roles: [{ id: 'role-1', name: 'Naib', color: '#FFD700' }], // Only one role
        },
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      await repo.recordApply({
        version: 1,
        resources: testShadowResources, // Has two roles
        appliedBy: 'test',
      });

      const drift = await repo.detectDrift();

      expect(drift.hasDrift).toBe(true);
      expect(drift.drifts.some(d => d.driftType === 'extra')).toBe(true);
    });

    it('should compare shadow to actual state when provided', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      await repo.recordApply({
        version: 1,
        resources: testShadowResources,
        appliedBy: 'test',
      });

      const actualState: ShadowResources = {
        ...testShadowResources,
        roles: {
          'role-1': 'different-discord-id', // Mismatch
          'role-2': 'discord-role-2',
        },
      };

      const drift = await repo.detectDrift(actualState);

      expect(drift.hasDrift).toBe(true);
      expect(drift.drifts.some(d => d.driftType === 'mismatch')).toBe(true);
    });

    it('should include drift summary', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const drift = await repo.detectDrift();

      expect(drift.summary).toBeDefined();
      expect(drift.summary.totalManifestResources).toBeGreaterThan(0);
    });
  });

  describe('validateChecksum', () => {
    it('should return true for valid checksum', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const isValid = await repo.validateChecksum(1);

      expect(isValid).toBe(true);
    });

    it('should return false for non-existent version', async () => {
      const isValid = await repo.validateChecksum(999);

      expect(isValid).toBe(false);
    });
  });

  describe('recoverFromS3', () => {
    it('should return error when no versions in S3', async () => {
      const result = await repo.recoverFromS3();

      expect(result.success).toBe(false);
      expect(result.error).toContain('No versions available');
    });

    it('should include recovery timestamp', async () => {
      const result = await repo.recoverFromS3();

      expect(result.recoveredAt).toBeDefined();
      expect(result.recoveredAt).toBeInstanceOf(Date);
    });
  });

  describe('listRecoverableVersions', () => {
    it('should return empty array when no versions in S3', async () => {
      const versions = await repo.listRecoverableVersions();

      expect(versions).toEqual([]);
    });
  });

  describe('healthCheck', () => {
    it('should check both PostgreSQL and S3', async () => {
      const health = await repo.healthCheck();

      expect(health).toHaveProperty('s3');
      expect(health).toHaveProperty('postgres');
      expect(health.postgres).toBe(true); // Mock always succeeds
      expect(health.s3).toBe(true); // Mock always succeeds
    });
  });

  describe('getStats', () => {
    it('should return storage statistics', async () => {
      const stats = await repo.getStats();

      expect(stats).toHaveProperty('totalVersions');
      expect(stats).toHaveProperty('latestVersion');
      expect(stats).toHaveProperty('s3ObjectCount');
      expect(stats).toHaveProperty('totalSizeBytes');
    });

    it('should return latest version from manifest if available', async () => {
      await repo.createManifest({
        content: testManifestContent,
        synthesizedBy: 'test',
        skipShadowWrite: true,
      });

      const stats = await repo.getStats();

      expect(stats.latestVersion).toBe(1);
    });
  });

  describe('getVersionHistory', () => {
    it('should return empty array when no history', async () => {
      const history = await repo.getVersionHistory();

      expect(history).toEqual([]);
    });
  });

  describe('createHybridManifestRepository', () => {
    it('should create repository instance', () => {
      const newRepo = createHybridManifestRepository({
        storage: mockStorage,
        s3Bucket: 'test-bucket',
      });

      expect(newRepo).toBeInstanceOf(HybridManifestRepository);
    });
  });
});
