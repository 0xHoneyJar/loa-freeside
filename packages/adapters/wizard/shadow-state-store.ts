/**
 * S3ShadowStateStore
 *
 * Sprint S-20: Wizard Session Store & State Model
 *
 * S3-backed shadow state storage for manifest history and drift detection.
 * Features:
 * - Git-style versioning for manifest history
 * - 3-state comparison (desired vs shadow vs actual)
 * - Immutable snapshots for audit trail
 *
 * @see SDD §3.1 Target Architecture - S3 (Shadow State)
 */

import type { Logger } from 'pino';
import type { CommunityManifest } from '@freeside/core/domain';

// =============================================================================
// Types
// =============================================================================

/**
 * S3 client interface (matches AWS SDK v3).
 */
export interface S3Client {
  send(command: unknown): Promise<unknown>;
}

/**
 * Shadow state snapshot metadata.
 */
export interface ShadowStateMetadata {
  /** Snapshot ID (UUID) */
  id: string;
  /** Community ID */
  communityId: string;
  /** Snapshot version (monotonic) */
  version: number;
  /** Creation timestamp */
  createdAt: Date;
  /** Creator user ID */
  createdBy: string;
  /** Reason for snapshot */
  reason: 'initial' | 'update' | 'rollback' | 'manual';
  /** Previous snapshot ID (null for first) */
  previousId: string | null;
  /** S3 key for manifest data */
  manifestKey: string;
  /** Content hash for integrity */
  contentHash: string;
}

/**
 * Shadow state snapshot with manifest.
 */
export interface ShadowStateSnapshot {
  /** Snapshot metadata */
  metadata: ShadowStateMetadata;
  /** Community manifest */
  manifest: CommunityManifest;
}

/**
 * Drift comparison result.
 */
export interface DriftComparisonResult {
  /** Whether drift exists */
  hasDrift: boolean;
  /** Desired state (latest manifest) */
  desired: CommunityManifest | null;
  /** Shadow state (last deployed) */
  shadow: CommunityManifest | null;
  /** Actual state from Discord (if available) */
  actual: ActualDiscordState | null;
  /** Specific drifts detected */
  drifts: DriftItem[];
  /** Comparison timestamp */
  comparedAt: Date;
}

/**
 * Actual Discord state snapshot.
 */
export interface ActualDiscordState {
  /** Guild ID */
  guildId: string;
  /** Fetched timestamp */
  fetchedAt: Date;
  /** Roles present in Discord */
  roles: ActualRole[];
  /** Channels present in Discord */
  channels: ActualChannel[];
}

/**
 * Actual role from Discord.
 */
export interface ActualRole {
  id: string;
  name: string;
  color: number;
  position: number;
  mentionable: boolean;
  hoist: boolean;
}

/**
 * Actual channel from Discord.
 */
export interface ActualChannel {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

/**
 * Individual drift item.
 */
export interface DriftItem {
  /** Type of drift */
  type: 'role_missing' | 'role_extra' | 'role_mismatch' |
        'channel_missing' | 'channel_extra' | 'channel_mismatch' |
        'config_mismatch';
  /** Entity involved */
  entity: string;
  /** Expected value */
  expected?: unknown;
  /** Actual value */
  actual?: unknown;
  /** Severity */
  severity: 'info' | 'warning' | 'error';
  /** Description */
  description: string;
}

/**
 * Options for S3ShadowStateStore.
 */
export interface ShadowStateStoreOptions {
  /** S3 client */
  s3Client: S3Client;
  /** S3 bucket name */
  bucketName: string;
  /** Logger instance */
  logger: Logger;
  /** Key prefix (default: 'shadow-state/') */
  keyPrefix?: string;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * S3-backed shadow state store.
 */
export class S3ShadowStateStore {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly keyPrefix: string;
  private readonly log: Logger;

  constructor(options: ShadowStateStoreOptions) {
    this.s3Client = options.s3Client;
    this.bucketName = options.bucketName;
    this.keyPrefix = options.keyPrefix ?? 'shadow-state/';
    this.log = options.logger.child({ component: 'S3ShadowStateStore' });
  }

  // ===========================================================================
  // Snapshot Operations
  // ===========================================================================

  /**
   * Save a new manifest snapshot.
   * Creates a new version in the manifest history.
   *
   * @param communityId - Community ID
   * @param manifest - Manifest to save
   * @param userId - User creating the snapshot
   * @param reason - Reason for snapshot
   * @returns Created snapshot metadata
   */
  async saveSnapshot(
    communityId: string,
    manifest: CommunityManifest,
    userId: string,
    reason: 'initial' | 'update' | 'rollback' | 'manual'
  ): Promise<ShadowStateMetadata> {
    const id = crypto.randomUUID();
    const now = new Date();

    // Get latest version for this community
    const latestMeta = await this.getLatestMetadata(communityId);
    const version = latestMeta ? latestMeta.version + 1 : 1;

    // Generate content hash
    const contentHash = await this.hashContent(manifest);

    // Create metadata
    const metadata: ShadowStateMetadata = {
      id,
      communityId,
      version,
      createdAt: now,
      createdBy: userId,
      reason,
      previousId: latestMeta?.id ?? null,
      manifestKey: `${this.keyPrefix}${communityId}/manifests/${id}.json`,
      contentHash,
    };

    // Save manifest to S3
    await this.putObject(
      metadata.manifestKey,
      JSON.stringify(manifest, null, 2),
      {
        'x-amz-meta-snapshot-id': id,
        'x-amz-meta-version': String(version),
        'x-amz-meta-community-id': communityId,
      }
    );

    // Save metadata
    await this.putObject(
      `${this.keyPrefix}${communityId}/metadata/${id}.json`,
      JSON.stringify(metadata, null, 2)
    );

    // Update latest pointer
    await this.putObject(
      `${this.keyPrefix}${communityId}/latest.json`,
      JSON.stringify({ snapshotId: id, version })
    );

    this.log.info(
      { communityId, snapshotId: id, version, reason },
      'Manifest snapshot saved'
    );

    return metadata;
  }

  /**
   * Get the latest snapshot for a community.
   *
   * @param communityId - Community ID
   * @returns Latest snapshot or null
   */
  async getLatestSnapshot(communityId: string): Promise<ShadowStateSnapshot | null> {
    const metadata = await this.getLatestMetadata(communityId);
    if (!metadata) {
      return null;
    }

    const manifest = await this.getManifest(metadata.manifestKey);
    if (!manifest) {
      return null;
    }

    return { metadata, manifest };
  }

  /**
   * Get a specific snapshot by ID.
   *
   * @param communityId - Community ID
   * @param snapshotId - Snapshot ID
   * @returns Snapshot or null
   */
  async getSnapshot(
    communityId: string,
    snapshotId: string
  ): Promise<ShadowStateSnapshot | null> {
    const metadata = await this.getMetadata(communityId, snapshotId);
    if (!metadata) {
      return null;
    }

    const manifest = await this.getManifest(metadata.manifestKey);
    if (!manifest) {
      return null;
    }

    return { metadata, manifest };
  }

  /**
   * List all snapshots for a community.
   *
   * @param communityId - Community ID
   * @param limit - Maximum snapshots to return
   * @returns Array of snapshot metadata, newest first
   */
  async listSnapshots(
    communityId: string,
    limit = 50
  ): Promise<ShadowStateMetadata[]> {
    const prefix = `${this.keyPrefix}${communityId}/metadata/`;
    const objects = await this.listObjects(prefix, limit);

    const metadata: ShadowStateMetadata[] = [];

    for (const obj of objects) {
      const content = await this.getObject(obj.key);
      if (content) {
        try {
          const meta = JSON.parse(content) as ShadowStateMetadata;
          meta.createdAt = new Date(meta.createdAt);
          metadata.push(meta);
        } catch (error) {
          this.log.warn({ key: obj.key, error }, 'Failed to parse metadata');
        }
      }
    }

    // Sort by version descending (newest first)
    return metadata.sort((a, b) => b.version - a.version);
  }

  // ===========================================================================
  // Drift Detection
  // ===========================================================================

  /**
   * Compare desired state (latest manifest), shadow state (deployed),
   * and actual Discord state.
   *
   * @param communityId - Community ID
   * @param actualState - Current Discord state (optional)
   * @returns Drift comparison result
   */
  async compareDrift(
    communityId: string,
    actualState?: ActualDiscordState
  ): Promise<DriftComparisonResult> {
    const snapshot = await this.getLatestSnapshot(communityId);

    const result: DriftComparisonResult = {
      hasDrift: false,
      desired: snapshot?.manifest ?? null,
      shadow: snapshot?.manifest ?? null, // Shadow IS the deployed state
      actual: actualState ?? null,
      drifts: [],
      comparedAt: new Date(),
    };

    if (!snapshot?.manifest || !actualState) {
      return result;
    }

    // Compare roles
    this.compareRoles(snapshot.manifest, actualState, result);

    // Compare channels
    this.compareChannels(snapshot.manifest, actualState, result);

    result.hasDrift = result.drifts.length > 0;

    this.log.info(
      {
        communityId,
        hasDrift: result.hasDrift,
        driftCount: result.drifts.length,
      },
      'Drift comparison completed'
    );

    return result;
  }

  private compareRoles(
    manifest: CommunityManifest,
    actual: ActualDiscordState,
    result: DriftComparisonResult
  ): void {
    const expectedRoleNames = new Set(manifest.tierRoles.map((r) => r.roleName));
    const actualRoleNames = new Set(actual.roles.map((r) => r.name));

    // Check for missing roles
    for (const tierRole of manifest.tierRoles) {
      const actualRole = actual.roles.find((r) => r.name === tierRole.roleName);

      if (!actualRole) {
        result.drifts.push({
          type: 'role_missing',
          entity: tierRole.roleName,
          expected: tierRole,
          severity: 'error',
          description: `Role "${tierRole.roleName}" expected but not found in Discord`,
        });
        continue;
      }

      // Check role properties
      if (actualRole.color !== tierRole.roleColor) {
        result.drifts.push({
          type: 'role_mismatch',
          entity: tierRole.roleName,
          expected: tierRole.roleColor,
          actual: actualRole.color,
          severity: 'warning',
          description: `Role "${tierRole.roleName}" color mismatch`,
        });
      }

      if (actualRole.mentionable !== tierRole.mentionable) {
        result.drifts.push({
          type: 'role_mismatch',
          entity: tierRole.roleName,
          expected: tierRole.mentionable,
          actual: actualRole.mentionable,
          severity: 'info',
          description: `Role "${tierRole.roleName}" mentionable mismatch`,
        });
      }
    }

    // Check for extra roles (Arrakis-prefixed only)
    for (const actualRole of actual.roles) {
      if (
        actualRole.name.startsWith('arrakis-') &&
        !expectedRoleNames.has(actualRole.name)
      ) {
        result.drifts.push({
          type: 'role_extra',
          entity: actualRole.name,
          actual: actualRole,
          severity: 'info',
          description: `Extra Arrakis role "${actualRole.name}" found in Discord`,
        });
      }
    }
  }

  private compareChannels(
    manifest: CommunityManifest,
    actual: ActualDiscordState,
    result: DriftComparisonResult
  ): void {
    if (!manifest.channels || manifest.channelTemplate === 'none') {
      return;
    }

    for (const expectedChannel of manifest.channels) {
      const actualChannel = actual.channels.find(
        (c) => c.name === expectedChannel.name
      );

      if (!actualChannel) {
        result.drifts.push({
          type: 'channel_missing',
          entity: expectedChannel.name,
          expected: expectedChannel,
          severity: 'warning',
          description: `Channel "${expectedChannel.name}" expected but not found`,
        });
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async getLatestMetadata(
    communityId: string
  ): Promise<ShadowStateMetadata | null> {
    const content = await this.getObject(
      `${this.keyPrefix}${communityId}/latest.json`
    );

    if (!content) {
      return null;
    }

    try {
      const latest = JSON.parse(content) as { snapshotId: string };
      return this.getMetadata(communityId, latest.snapshotId);
    } catch {
      return null;
    }
  }

  private async getMetadata(
    communityId: string,
    snapshotId: string
  ): Promise<ShadowStateMetadata | null> {
    const content = await this.getObject(
      `${this.keyPrefix}${communityId}/metadata/${snapshotId}.json`
    );

    if (!content) {
      return null;
    }

    try {
      const meta = JSON.parse(content) as ShadowStateMetadata;
      meta.createdAt = new Date(meta.createdAt);
      return meta;
    } catch {
      return null;
    }
  }

  private async getManifest(key: string): Promise<CommunityManifest | null> {
    const content = await this.getObject(key);
    if (!content) {
      return null;
    }

    try {
      const manifest = JSON.parse(content) as CommunityManifest;
      manifest.createdAt = new Date(manifest.createdAt);
      manifest.updatedAt = new Date(manifest.updatedAt);
      return manifest;
    } catch {
      return null;
    }
  }

  private async hashContent(content: unknown): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(content));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // S3 client wrappers (simplified for mock testing)
  private async putObject(
    key: string,
    body: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    await this.s3Client.send({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      Metadata: metadata,
    });
  }

  private async getObject(key: string): Promise<string | null> {
    try {
      const response = await this.s3Client.send({
        Bucket: this.bucketName,
        Key: key,
      }) as { Body?: { transformToString: () => Promise<string> } };

      return response?.Body?.transformToString() ?? null;
    } catch {
      return null;
    }
  }

  private async listObjects(
    prefix: string,
    maxKeys: number
  ): Promise<Array<{ key: string }>> {
    try {
      const response = await this.s3Client.send({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }) as { Contents?: Array<{ Key: string }> };

      return (response?.Contents ?? []).map((c) => ({ key: c.Key }));
    } catch {
      return [];
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an S3-backed shadow state store.
 *
 * @param options - Store options
 * @returns Shadow state store instance
 */
export function createShadowStateStore(
  options: ShadowStateStoreOptions
): S3ShadowStateStore {
  return new S3ShadowStateStore(options);
}
