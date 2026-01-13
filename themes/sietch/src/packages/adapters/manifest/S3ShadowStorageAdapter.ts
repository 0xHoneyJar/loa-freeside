/**
 * S3 Shadow Storage Adapter
 *
 * Sprint 43: Hybrid Manifest Repository
 *
 * Manages manifest version history in S3 for disaster recovery and audit.
 * Provides shadow storage that mirrors PostgreSQL manifests.
 *
 * Key features:
 * - Write-through caching: Every manifest write goes to both PostgreSQL and S3
 * - Version index: JSON index file for fast version lookups
 * - Checksum validation: SHA-256 integrity verification
 * - Disaster recovery: Full manifest reconstruction from S3
 *
 * S3 Key Structure:
 * ```
 * {prefix}/
 *   {communityId}/
 *     index.json                    # Version index
 *     versions/
 *       v001.json                   # Manifest content
 *       v002.json
 *       ...
 * ```
 *
 * @module packages/adapters/manifest/S3ShadowStorageAdapter
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

import type {
  ManifestVersionMeta,
} from '../../core/ports/IManifestProvider.js';
import type { ManifestContent } from '../storage/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * S3 adapter configuration
 */
export interface S3ShadowStorageConfig {
  /** S3 bucket name */
  bucket: string;
  /** Key prefix (default: 'manifests/') */
  prefix?: string;
  /** AWS region */
  region?: string;
  /** Community ID for scoping */
  communityId: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom S3 client (for testing) */
  client?: S3Client;
}

/**
 * Version index stored in S3
 */
export interface VersionIndex {
  /** Community ID */
  communityId: string;
  /** Latest version number */
  latestVersion: number;
  /** Total versions */
  totalVersions: number;
  /** Total size in bytes */
  totalSizeBytes: number;
  /** Last updated timestamp */
  updatedAt: string;
  /** Version metadata list */
  versions: ManifestVersionMeta[];
}

/**
 * Manifest snapshot stored in S3
 */
export interface ManifestSnapshot {
  /** Manifest ID */
  id: string;
  /** Community ID */
  communityId: string;
  /** Version number */
  version: number;
  /** Manifest content */
  content: ManifestContent;
  /** Content checksum */
  checksum: string;
  /** Creation timestamp */
  createdAt: string;
  /** Creator */
  createdBy?: string;
  /** Synthesized timestamp */
  synthesizedAt: string;
}

/**
 * Error thrown by S3 operations
 */
export class S3ShadowStorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'S3ShadowStorageError';
  }
}

// =============================================================================
// S3 Shadow Storage Adapter
// =============================================================================

/**
 * S3ShadowStorageAdapter handles shadow storage of manifests in S3.
 *
 * Design principles:
 * - Eventual consistency: S3 writes are async, don't block main flow
 * - Immutable versions: Once written, versions are never modified
 * - Index-based lookups: Fast version discovery without listing
 *
 * @example
 * ```typescript
 * const adapter = new S3ShadowStorageAdapter({
 *   bucket: 'arrakis-manifests',
 *   communityId: 'community-uuid',
 *   region: 'us-east-1',
 * });
 *
 * await adapter.writeVersion(manifest);
 * const snapshot = await adapter.readVersion(1);
 * ```
 */
export class S3ShadowStorageAdapter {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly communityId: string;
  private readonly debug: boolean;

  constructor(config: S3ShadowStorageConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? 'manifests/';
    this.communityId = config.communityId;
    this.debug = config.debug ?? false;

    // Use provided client or create new one
    if (config.client) {
      this.client = config.client;
    } else {
      const s3Config: S3ClientConfig = {};
      if (config.region) {
        s3Config.region = config.region;
      }
      this.client = new S3Client(s3Config);
    }
  }

  // ===========================================================================
  // Key Generation
  // ===========================================================================

  /**
   * Get the S3 key for a version
   */
  private getVersionKey(version: number): string {
    const paddedVersion = String(version).padStart(6, '0');
    return `${this.prefix}${this.communityId}/versions/v${paddedVersion}.json`;
  }

  /**
   * Get the S3 key for the version index
   */
  private getIndexKey(): string {
    return `${this.prefix}${this.communityId}/index.json`;
  }

  // ===========================================================================
  // Checksum
  // ===========================================================================

  /**
   * Generate SHA-256 checksum for content
   */
  generateChecksum(content: ManifestContent): string {
    const json = JSON.stringify(content, null, 0);
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Validate content against checksum
   */
  validateChecksum(content: ManifestContent, expectedChecksum: string): boolean {
    const actualChecksum = this.generateChecksum(content);
    return actualChecksum === expectedChecksum;
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Write a manifest version to S3
   */
  async writeVersion(
    manifest: {
      id: string;
      version: number;
      content: ManifestContent;
      checksum: string;
      synthesizedAt: Date;
      synthesizedBy?: string;
    }
  ): Promise<ManifestVersionMeta> {
    this.log('writeVersion', { version: manifest.version });

    const snapshot: ManifestSnapshot = {
      id: manifest.id,
      communityId: this.communityId,
      version: manifest.version,
      content: manifest.content,
      checksum: manifest.checksum,
      createdAt: new Date().toISOString(),
      createdBy: manifest.synthesizedBy,
      synthesizedAt: manifest.synthesizedAt.toISOString(),
    };

    const body = JSON.stringify(snapshot, null, 2);
    const key = this.getVersionKey(manifest.version);

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          Metadata: {
            'manifest-id': manifest.id,
            'manifest-version': String(manifest.version),
            'manifest-checksum': manifest.checksum,
          },
        })
      );

      const meta: ManifestVersionMeta = {
        id: manifest.id,
        communityId: this.communityId,
        version: manifest.version,
        checksum: manifest.checksum,
        createdAt: snapshot.createdAt,
        createdBy: manifest.synthesizedBy,
        s3Key: key,
        sizeBytes: Buffer.byteLength(body, 'utf8'),
      };

      // Update index
      await this.updateIndex(meta);

      return meta;
    } catch (error) {
      throw new S3ShadowStorageError(
        `Failed to write version ${manifest.version}`,
        'WRITE_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Update the version index
   */
  private async updateIndex(newVersion: ManifestVersionMeta): Promise<void> {
    this.log('updateIndex', { version: newVersion.version });

    // Get existing index or create new one
    let index = await this.readIndex();

    if (!index) {
      index = {
        communityId: this.communityId,
        latestVersion: 0,
        totalVersions: 0,
        totalSizeBytes: 0,
        updatedAt: new Date().toISOString(),
        versions: [],
      };
    }

    // Add new version (maintain sorted order, newest first)
    index.versions.unshift(newVersion);
    index.latestVersion = Math.max(index.latestVersion, newVersion.version);
    index.totalVersions = index.versions.length;
    index.totalSizeBytes += newVersion.sizeBytes;
    index.updatedAt = new Date().toISOString();

    // Write updated index
    const body = JSON.stringify(index, null, 2);
    const key = this.getIndexKey();

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
        })
      );
    } catch (error) {
      this.log('updateIndex failed', { error });
      // Don't throw - index is not critical for correctness
    }
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Read a manifest version from S3
   */
  async readVersion(version: number): Promise<ManifestSnapshot | null> {
    this.log('readVersion', { version });

    const key = this.getVersionKey(version);

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const body = await response.Body?.transformToString();
      if (!body) {
        return null;
      }

      return JSON.parse(body) as ManifestSnapshot;
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw new S3ShadowStorageError(
        `Failed to read version ${version}`,
        'READ_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Read the version index
   */
  async readIndex(): Promise<VersionIndex | null> {
    this.log('readIndex');

    const key = this.getIndexKey();

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      const body = await response.Body?.transformToString();
      if (!body) {
        return null;
      }

      return JSON.parse(body) as VersionIndex;
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw new S3ShadowStorageError(
        'Failed to read index',
        'READ_INDEX_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * List all versions (from index)
   */
  async listVersions(limit?: number): Promise<ManifestVersionMeta[]> {
    this.log('listVersions', { limit });

    const index = await this.readIndex();
    if (!index) {
      return [];
    }

    if (limit) {
      return index.versions.slice(0, limit);
    }
    return index.versions;
  }

  /**
   * Get latest version number
   */
  async getLatestVersion(): Promise<number> {
    const index = await this.readIndex();
    return index?.latestVersion ?? 0;
  }

  // ===========================================================================
  // Recovery Operations
  // ===========================================================================

  /**
   * Rebuild index from actual S3 objects
   *
   * Use when index is corrupted or missing.
   */
  async rebuildIndex(): Promise<VersionIndex> {
    this.log('rebuildIndex');

    const prefix = `${this.prefix}${this.communityId}/versions/`;
    const versions: ManifestVersionMeta[] = [];

    try {
      let continuationToken: string | undefined;

      do {
        const response = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of response.Contents ?? []) {
          if (!obj.Key) continue;

          // Parse version from key
          const match = obj.Key.match(/v(\d+)\.json$/);
          if (!match) continue;

          const version = parseInt(match[1], 10);

          // Read the version to get full metadata
          const snapshot = await this.readVersion(version);
          if (!snapshot) continue;

          versions.push({
            id: snapshot.id,
            communityId: snapshot.communityId,
            version: snapshot.version,
            checksum: snapshot.checksum,
            createdAt: snapshot.createdAt,
            createdBy: snapshot.createdBy,
            s3Key: obj.Key,
            sizeBytes: obj.Size ?? 0,
          });
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);

      // Sort by version descending
      versions.sort((a, b) => b.version - a.version);

      const index: VersionIndex = {
        communityId: this.communityId,
        latestVersion: versions[0]?.version ?? 0,
        totalVersions: versions.length,
        totalSizeBytes: versions.reduce((sum, v) => sum + v.sizeBytes, 0),
        updatedAt: new Date().toISOString(),
        versions,
      };

      // Write rebuilt index
      const body = JSON.stringify(index, null, 2);
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.getIndexKey(),
          Body: body,
          ContentType: 'application/json',
        })
      );

      return index;
    } catch (error) {
      throw new S3ShadowStorageError(
        'Failed to rebuild index',
        'REBUILD_INDEX_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * Check S3 bucket connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(
        new HeadBucketCommand({
          Bucket: this.bucket,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalVersions: number;
    latestVersion: number;
    totalSizeBytes: number;
  }> {
    const index = await this.readIndex();
    return {
      totalVersions: index?.totalVersions ?? 0,
      latestVersion: index?.latestVersion ?? 0,
      totalSizeBytes: index?.totalSizeBytes ?? 0,
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Check if error is a not found error
   */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === 'object') {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      return (
        err.name === 'NoSuchKey' ||
        err.$metadata?.httpStatusCode === 404
      );
    }
    return false;
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[S3ShadowStorage] ${message}`, data ?? '');
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an S3 shadow storage adapter
 */
export function createS3ShadowStorageAdapter(
  config: S3ShadowStorageConfig
): S3ShadowStorageAdapter {
  return new S3ShadowStorageAdapter(config);
}
