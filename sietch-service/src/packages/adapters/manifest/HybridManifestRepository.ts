/**
 * Hybrid Manifest Repository
 *
 * Sprint 43: Hybrid Manifest Repository
 *
 * Implements IManifestProvider with hybrid storage model:
 * - PostgreSQL: Primary storage for runtime reads (fast)
 * - S3: Shadow storage for version history and disaster recovery
 *
 * Key features:
 * - Automatic S3 shadow write after every PostgreSQL write
 * - Drift detection between desired and actual state
 * - Disaster recovery from S3 when PostgreSQL is unavailable
 * - Checksum validation for data integrity
 *
 * @module packages/adapters/manifest/HybridManifestRepository
 */

import { createHash } from 'crypto';

import type {
  IManifestProvider,
  ManifestVersionMeta,
  DriftReport,
  DriftItem,
  DriftSummary,
  RecoveryOptions,
  RecoveryResult,
  CreateManifestInput,
  ApplyManifestInput,
  ManifestProviderOptions,
} from '../../core/ports/IManifestProvider.js';
import type { IStorageProvider } from '../../core/ports/IStorageProvider.js';
import type {
  Manifest,
  ManifestContent,
  ShadowState,
  ShadowResources,
  NewShadowState,
} from '../storage/schema.js';

import {
  S3ShadowStorageAdapter,
  type ManifestSnapshot,
} from './S3ShadowStorageAdapter.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for HybridManifestRepository
 */
export interface HybridManifestRepositoryConfig {
  /** Storage provider (PostgreSQL) */
  storage: IStorageProvider;
  /** S3 bucket name */
  s3Bucket: string;
  /** S3 key prefix */
  s3Prefix?: string;
  /** AWS region */
  awsRegion?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Error thrown by HybridManifestRepository
 */
export class HybridManifestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'HybridManifestError';
  }
}

// =============================================================================
// Hybrid Manifest Repository
// =============================================================================

/**
 * HybridManifestRepository provides a unified interface for manifest operations
 * with automatic hybrid storage to PostgreSQL and S3.
 *
 * Design principles:
 * - Write-through: All writes go to both PostgreSQL and S3
 * - Read-preference: Reads prefer PostgreSQL, fallback to S3
 * - Eventual consistency: S3 writes are async, don't block operations
 * - Recovery-first: Always maintain ability to recover from S3
 *
 * @example
 * ```typescript
 * const repo = new HybridManifestRepository({
 *   storage: drizzleStorageAdapter,
 *   s3Bucket: 'arrakis-manifests',
 *   awsRegion: 'us-east-1',
 * });
 *
 * // Create manifest (auto-shadows to S3)
 * const manifest = await repo.createManifest({
 *   content: manifestContent,
 *   synthesizedBy: 'wizard',
 * });
 *
 * // Detect drift
 * const drift = await repo.detectDrift();
 * if (drift.hasDrift) {
 *   console.log('Drift detected:', drift.drifts);
 * }
 *
 * // Recover from S3
 * const result = await repo.recoverFromS3({ targetVersion: 5 });
 * ```
 */
export class HybridManifestRepository implements IManifestProvider {
  private readonly storage: IStorageProvider;
  private readonly s3Shadow: S3ShadowStorageAdapter;
  private readonly debug: boolean;

  constructor(config: HybridManifestRepositoryConfig) {
    this.storage = config.storage;
    this.debug = config.debug ?? false;

    this.s3Shadow = new S3ShadowStorageAdapter({
      bucket: config.s3Bucket,
      prefix: config.s3Prefix,
      region: config.awsRegion,
      communityId: config.storage.tenantId,
      debug: config.debug,
    });
  }

  // ===========================================================================
  // Core Manifest Operations
  // ===========================================================================

  /**
   * Create a new manifest version with automatic S3 shadow
   */
  async createManifest(input: CreateManifestInput): Promise<Manifest> {
    this.log('createManifest', { synthesizedBy: input.synthesizedBy });

    // Generate checksum if not provided
    const checksum = input.checksum ?? this.generateChecksum(input.content);

    // Create in PostgreSQL
    const manifest = await this.storage.createManifest({
      content: input.content,
      checksum,
      synthesizedBy: input.synthesizedBy,
    });

    // Shadow to S3 (async, don't block)
    if (!input.skipShadowWrite) {
      this.shadowToS3(manifest).catch((error) => {
        this.log('S3 shadow write failed (non-blocking)', { error });
      });
    }

    return manifest;
  }

  /**
   * Get current active manifest
   */
  async getCurrentManifest(): Promise<Manifest | null> {
    this.log('getCurrentManifest');
    return this.storage.getCurrentManifest();
  }

  /**
   * Get manifest by version (PostgreSQL first, fallback to S3)
   */
  async getManifestByVersion(version: number): Promise<Manifest | null> {
    this.log('getManifestByVersion', { version });

    // Try PostgreSQL first
    const pgManifest = await this.storage.getManifestByVersion(version);
    if (pgManifest) {
      return pgManifest;
    }

    // Fallback to S3
    const s3Snapshot = await this.s3Shadow.readVersion(version);
    if (!s3Snapshot) {
      return null;
    }

    // Convert S3 snapshot to Manifest type
    return this.snapshotToManifest(s3Snapshot);
  }

  /**
   * Get version history (from S3 index)
   */
  async getVersionHistory(limit?: number): Promise<ManifestVersionMeta[]> {
    this.log('getVersionHistory', { limit });
    return this.s3Shadow.listVersions(limit);
  }

  // ===========================================================================
  // Shadow State Operations
  // ===========================================================================

  /**
   * Record that a manifest was applied to Discord
   */
  async recordApply(input: ApplyManifestInput): Promise<ShadowState> {
    this.log('recordApply', { version: input.version });

    // Generate checksum for resources
    const checksum = this.generateResourcesChecksum(input.resources);

    const shadowData: NewShadowState = {
      communityId: this.storage.tenantId,
      manifestVersion: input.version,
      appliedBy: input.appliedBy,
      resources: input.resources,
      checksum,
      status: 'applied',
    };

    return this.storage.createShadowState(shadowData);
  }

  /**
   * Get current shadow state
   */
  async getCurrentShadowState(): Promise<ShadowState | null> {
    this.log('getCurrentShadowState');
    return this.storage.getCurrentShadowState();
  }

  /**
   * Get shadow state for a specific version
   */
  async getShadowStateByVersion(version: number): Promise<ShadowState | null> {
    this.log('getShadowStateByVersion', { version });
    return this.storage.getShadowStateByVersion(version);
  }

  // ===========================================================================
  // Drift Detection
  // ===========================================================================

  /**
   * Detect drift between desired and actual state
   *
   * Compares:
   * 1. Desired state (current manifest)
   * 2. Shadow state (what we think Discord has)
   * 3. Actual state (optional - live Discord state)
   */
  async detectDrift(actualState?: ShadowResources): Promise<DriftReport> {
    this.log('detectDrift');

    const manifest = await this.getCurrentManifest();
    const shadow = await this.getCurrentShadowState();

    if (!manifest) {
      return this.createEmptyDriftReport('No manifest found');
    }

    const drifts: DriftItem[] = [];
    const content = manifest.content;

    // Compare manifest to shadow (if shadow exists)
    if (shadow) {
      // Check manifest vs shadow version
      if (shadow.manifestVersion !== manifest.version) {
        drifts.push({
          resourceType: 'role', // Generic
          manifestId: 'version',
          driftType: 'mismatch',
          expected: manifest.version,
          actual: shadow.manifestVersion,
          severity: 'warning',
        });
      }

      // Check roles
      this.detectRoleDrift(content.roles, shadow.resources.roles, drifts);

      // Check channels
      this.detectChannelDrift(content.channels, shadow.resources.channels, drifts);

      // Check categories
      this.detectCategoryDrift(content.categories, shadow.resources.categories, drifts);

      // Validate checksum
      const expectedChecksum = this.generateResourcesChecksum(shadow.resources);
      if (expectedChecksum !== shadow.checksum) {
        drifts.push({
          resourceType: 'role',
          manifestId: 'checksum',
          driftType: 'mismatch',
          expected: shadow.checksum,
          actual: expectedChecksum,
          severity: 'error',
        });
      }
    } else {
      // No shadow state - everything is considered missing
      for (const role of content.roles) {
        drifts.push({
          resourceType: 'role',
          manifestId: role.id,
          driftType: 'missing',
          expected: role,
          severity: 'warning',
        });
      }
    }

    // If actual state provided, compare shadow to actual
    if (actualState && shadow) {
      this.detectActualDrift(shadow.resources, actualState, drifts);
    }

    const summary = this.calculateDriftSummary(
      content,
      shadow?.resources,
      drifts
    );

    return {
      hasDrift: drifts.length > 0,
      detectedAt: new Date(),
      communityId: this.storage.tenantId,
      manifestVersion: manifest.version,
      shadowVersion: shadow?.manifestVersion,
      drifts,
      summary,
    };
  }

  /**
   * Validate checksum for a manifest version
   */
  async validateChecksum(version: number): Promise<boolean> {
    this.log('validateChecksum', { version });

    const manifest = await this.getManifestByVersion(version);
    if (!manifest) {
      return false;
    }

    const expectedChecksum = this.generateChecksum(manifest.content);
    return expectedChecksum === manifest.checksum;
  }

  // ===========================================================================
  // Disaster Recovery
  // ===========================================================================

  /**
   * Recover manifest from S3 shadow storage
   */
  async recoverFromS3(options?: RecoveryOptions): Promise<RecoveryResult> {
    this.log('recoverFromS3', options);

    try {
      // Determine target version
      const targetVersion = options?.targetVersion ??
        await this.s3Shadow.getLatestVersion();

      if (targetVersion === 0) {
        return {
          success: false,
          restoredVersion: 0,
          error: 'No versions available in S3',
          recoveredAt: new Date(),
        };
      }

      // Read from S3
      const snapshot = await this.s3Shadow.readVersion(targetVersion);
      if (!snapshot) {
        return {
          success: false,
          restoredVersion: targetVersion,
          error: `Version ${targetVersion} not found in S3`,
          recoveredAt: new Date(),
        };
      }

      // Validate content if requested
      if (options?.validate !== false) {
        const isValid = this.s3Shadow.validateChecksum(
          snapshot.content,
          snapshot.checksum
        );
        if (!isValid) {
          return {
            success: false,
            restoredVersion: targetVersion,
            error: 'Checksum validation failed',
            recoveredAt: new Date(),
          };
        }
      }

      // Restore to PostgreSQL
      let restoredManifest: Manifest;

      if (options?.createNewVersion) {
        // Create as new version
        restoredManifest = await this.storage.createManifest({
          content: snapshot.content,
          checksum: snapshot.checksum,
          synthesizedBy: options.recoveredBy ?? 'disaster-recovery',
        });
      } else {
        // Deactivate current and restore with same version
        await this.storage.deactivateCurrentManifest();
        restoredManifest = await this.storage.createManifest({
          content: snapshot.content,
          checksum: snapshot.checksum,
          synthesizedBy: options?.recoveredBy ?? 'disaster-recovery',
        });
      }

      return {
        success: true,
        manifest: restoredManifest,
        restoredVersion: targetVersion,
        newVersion: options?.createNewVersion ? restoredManifest.version : undefined,
        recoveredAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        restoredVersion: options?.targetVersion ?? 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        recoveredAt: new Date(),
      };
    }
  }

  /**
   * List available versions for recovery
   */
  async listRecoverableVersions(): Promise<ManifestVersionMeta[]> {
    this.log('listRecoverableVersions');
    return this.s3Shadow.listVersions();
  }

  // ===========================================================================
  // Health & Maintenance
  // ===========================================================================

  /**
   * Check connectivity to both PostgreSQL and S3
   */
  async healthCheck(): Promise<{ s3: boolean; postgres: boolean }> {
    this.log('healthCheck');

    const [s3Health, pgHealth] = await Promise.all([
      this.s3Shadow.healthCheck(),
      this.checkPostgresHealth(),
    ]);

    return {
      s3: s3Health,
      postgres: pgHealth,
    };
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalVersions: number;
    latestVersion: number;
    s3ObjectCount: number;
    totalSizeBytes: number;
  }> {
    this.log('getStats');

    const s3Stats = await this.s3Shadow.getStats();
    const currentManifest = await this.getCurrentManifest();

    return {
      totalVersions: s3Stats.totalVersions,
      latestVersion: currentManifest?.version ?? s3Stats.latestVersion,
      s3ObjectCount: s3Stats.totalVersions,
      totalSizeBytes: s3Stats.totalSizeBytes,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Shadow manifest to S3 (async)
   */
  private async shadowToS3(manifest: Manifest): Promise<void> {
    await this.s3Shadow.writeVersion({
      id: manifest.id,
      version: manifest.version,
      content: manifest.content,
      checksum: manifest.checksum,
      synthesizedAt: manifest.synthesizedAt,
      synthesizedBy: manifest.synthesizedBy ?? undefined,
    });
  }

  /**
   * Generate SHA-256 checksum for manifest content
   */
  private generateChecksum(content: ManifestContent): string {
    const json = JSON.stringify(content, null, 0);
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Generate checksum for shadow resources
   */
  private generateResourcesChecksum(resources: ShadowResources): string {
    const json = JSON.stringify(resources, null, 0);
    return createHash('sha256').update(json).digest('hex');
  }

  /**
   * Convert S3 snapshot to Manifest type
   */
  private snapshotToManifest(snapshot: ManifestSnapshot): Manifest {
    return {
      id: snapshot.id,
      communityId: snapshot.communityId,
      version: snapshot.version,
      content: snapshot.content,
      checksum: snapshot.checksum,
      synthesizedAt: new Date(snapshot.synthesizedAt),
      synthesizedBy: snapshot.createdBy ?? null,
      isActive: false, // S3-only manifests are not active in PostgreSQL
      createdAt: new Date(snapshot.createdAt),
    };
  }

  /**
   * Detect role drift
   */
  private detectRoleDrift(
    manifestRoles: { id: string; name: string; color: string }[],
    shadowRoles: Record<string, string>,
    drifts: DriftItem[]
  ): void {
    const manifestRoleIds = new Set(manifestRoles.map((r) => r.id));
    const shadowRoleIds = new Set(Object.keys(shadowRoles));

    // Roles in manifest but not in shadow (missing)
    for (const role of manifestRoles) {
      if (!shadowRoleIds.has(role.id)) {
        drifts.push({
          resourceType: 'role',
          manifestId: role.id,
          driftType: 'missing',
          expected: role,
          severity: 'warning',
        });
      }
    }

    // Roles in shadow but not in manifest (extra)
    for (const roleId of shadowRoleIds) {
      if (!manifestRoleIds.has(roleId)) {
        drifts.push({
          resourceType: 'role',
          manifestId: roleId,
          discordId: shadowRoles[roleId],
          driftType: 'extra',
          severity: 'info',
        });
      }
    }
  }

  /**
   * Detect channel drift
   */
  private detectChannelDrift(
    manifestChannels: { id: string; name: string; type: string }[],
    shadowChannels: Record<string, string>,
    drifts: DriftItem[]
  ): void {
    const manifestChannelIds = new Set(manifestChannels.map((c) => c.id));
    const shadowChannelIds = new Set(Object.keys(shadowChannels));

    for (const channel of manifestChannels) {
      if (!shadowChannelIds.has(channel.id)) {
        drifts.push({
          resourceType: 'channel',
          manifestId: channel.id,
          driftType: 'missing',
          expected: channel,
          severity: 'warning',
        });
      }
    }

    for (const channelId of shadowChannelIds) {
      if (!manifestChannelIds.has(channelId)) {
        drifts.push({
          resourceType: 'channel',
          manifestId: channelId,
          discordId: shadowChannels[channelId],
          driftType: 'extra',
          severity: 'info',
        });
      }
    }
  }

  /**
   * Detect category drift
   */
  private detectCategoryDrift(
    manifestCategories: { id: string; name: string }[],
    shadowCategories: Record<string, string>,
    drifts: DriftItem[]
  ): void {
    const manifestCategoryIds = new Set(manifestCategories.map((c) => c.id));
    const shadowCategoryIds = new Set(Object.keys(shadowCategories));

    for (const category of manifestCategories) {
      if (!shadowCategoryIds.has(category.id)) {
        drifts.push({
          resourceType: 'category',
          manifestId: category.id,
          driftType: 'missing',
          expected: category,
          severity: 'warning',
        });
      }
    }

    for (const categoryId of shadowCategoryIds) {
      if (!manifestCategoryIds.has(categoryId)) {
        drifts.push({
          resourceType: 'category',
          manifestId: categoryId,
          discordId: shadowCategories[categoryId],
          driftType: 'extra',
          severity: 'info',
        });
      }
    }
  }

  /**
   * Detect drift between shadow and actual state
   */
  private detectActualDrift(
    shadow: ShadowResources,
    actual: ShadowResources,
    drifts: DriftItem[]
  ): void {
    // Compare roles
    for (const [manifestId, shadowDiscordId] of Object.entries(shadow.roles)) {
      const actualDiscordId = actual.roles[manifestId];
      if (actualDiscordId && actualDiscordId !== shadowDiscordId) {
        drifts.push({
          resourceType: 'role',
          manifestId,
          discordId: actualDiscordId,
          driftType: 'mismatch',
          expected: shadowDiscordId,
          actual: actualDiscordId,
          severity: 'error',
        });
      }
    }

    // Compare channels
    for (const [manifestId, shadowDiscordId] of Object.entries(shadow.channels)) {
      const actualDiscordId = actual.channels[manifestId];
      if (actualDiscordId && actualDiscordId !== shadowDiscordId) {
        drifts.push({
          resourceType: 'channel',
          manifestId,
          discordId: actualDiscordId,
          driftType: 'mismatch',
          expected: shadowDiscordId,
          actual: actualDiscordId,
          severity: 'error',
        });
      }
    }
  }

  /**
   * Calculate drift summary statistics
   */
  private calculateDriftSummary(
    content: ManifestContent,
    shadowResources: ShadowResources | undefined,
    drifts: DriftItem[]
  ): DriftSummary {
    const totalManifestResources =
      content.roles.length + content.channels.length + content.categories.length;

    const totalShadowResources = shadowResources
      ? Object.keys(shadowResources.roles).length +
        Object.keys(shadowResources.channels).length +
        Object.keys(shadowResources.categories).length
      : 0;

    return {
      totalManifestResources,
      totalShadowResources,
      missingFromShadow: drifts.filter((d) => d.driftType === 'missing').length,
      extraInShadow: drifts.filter((d) => d.driftType === 'extra').length,
      modified: drifts.filter((d) => d.driftType === 'modified').length,
      checksumMismatches: drifts.filter(
        (d) => d.driftType === 'mismatch' && d.manifestId === 'checksum'
      ).length,
    };
  }

  /**
   * Create empty drift report
   */
  private createEmptyDriftReport(reason: string): DriftReport {
    return {
      hasDrift: false,
      detectedAt: new Date(),
      communityId: this.storage.tenantId,
      manifestVersion: 0,
      drifts: [],
      summary: {
        totalManifestResources: 0,
        totalShadowResources: 0,
        missingFromShadow: 0,
        extraInShadow: 0,
        modified: 0,
        checksumMismatches: 0,
      },
    };
  }

  /**
   * Check PostgreSQL health
   */
  private async checkPostgresHealth(): Promise<boolean> {
    try {
      // Simple query to check connectivity
      await this.storage.getCurrentManifest();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[HybridManifestRepository] ${message}`, data ?? '');
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a HybridManifestRepository
 */
export function createHybridManifestRepository(
  config: HybridManifestRepositoryConfig
): HybridManifestRepository {
  return new HybridManifestRepository(config);
}
