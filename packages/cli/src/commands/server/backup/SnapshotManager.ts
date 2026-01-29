/**
 * Snapshot Manager
 *
 * Sprint 168: Snapshots - Full Server Snapshot Management
 *
 * Creates and manages full server snapshots with manifest,
 * state, config export, and theme registry bundled together.
 *
 * @see SDD grimoires/loa/sdd.md §15.3
 * @module packages/cli/commands/server/backup/SnapshotManager
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { Readable } from 'stream';
import * as yaml from 'js-yaml';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

import type { GaibState } from '../iac/backends/types.js';
import type { StateBackend } from '../iac/backends/types.js';
import {
  type SnapshotManifest,
  type SnapshotResult,
  type SnapshotDiff,
  type ResourceDiff,
  type FileInfo,
  type BackupMetadataItem,
  type CreateSnapshotOptions,
  type RestoreSnapshotOptions,
  type ThemeRegistry,
  BackupError,
  BackupErrorCode,
  IntegrityError,
  generateId,
  calculateTTL,
  formatBytes,
  TIER_LIMITS,
} from './types.js';
import { TierManager } from './TierManager.js';

// ============================================================================
// Constants
// ============================================================================

/** Default AWS region */
const DEFAULT_REGION = 'us-east-1';

/** Default S3 bucket name pattern */
const DEFAULT_BUCKET_PATTERN = 'gaib-backups';

/** Default DynamoDB metadata table */
const DEFAULT_METADATA_TABLE = 'gaib-backup-metadata';

/** Default DynamoDB tiers table */
const DEFAULT_TIERS_TABLE = 'gaib-server-tiers';

// ============================================================================
// Types
// ============================================================================

/**
 * SnapshotManager configuration
 */
export interface SnapshotManagerConfig {
  /** Discord Guild ID */
  serverId: string;
  /** Gaib workspace name */
  workspace: string;
  /** S3 bucket name */
  bucket: string;
  /** DynamoDB metadata table name */
  metadataTable: string;
  /** DynamoDB server tiers table name */
  tiersTable: string;
  /** AWS region */
  region: string;
  /** KMS key ID for encryption */
  kmsKeyId?: string;
}

/**
 * Snapshot list item for display
 */
export interface SnapshotListItem {
  id: string;
  timestamp: string;
  serial: number;
  message?: string;
  discord: {
    roleCount: number;
    channelCount: number;
    categoryCount: number;
  };
  theme?: {
    name: string;
    version: string;
  };
}

/**
 * Download result
 */
export interface DownloadResult {
  outputDir: string;
  files: string[];
  manifest: SnapshotManifest;
}

// ============================================================================
// SnapshotManager Implementation
// ============================================================================

/**
 * Manages full server snapshots
 *
 * @example
 * ```typescript
 * const manager = await SnapshotManager.create({
 *   serverId: '1234567890',
 *   workspace: 'default',
 * });
 *
 * // Create snapshot
 * const snapshot = await manager.createSnapshot({ message: 'Before migration' });
 *
 * // List snapshots
 * const snapshots = await manager.listSnapshots();
 *
 * // Download snapshot
 * await manager.downloadSnapshot(snapshot.id, './backup');
 *
 * // Compare snapshots
 * const diff = await manager.compareSnapshots(id1, id2);
 * ```
 */
export class SnapshotManager {
  private readonly s3Client: S3Client;
  private readonly dynamoClient: DynamoDBClient;
  private readonly tierManager: TierManager;
  private readonly config: SnapshotManagerConfig;
  private backend: StateBackend | null = null;
  private configExporter: ConfigExporter | null = null;
  private themeRegistry: ThemeRegistry | null = null;

  constructor(config: SnapshotManagerConfig) {
    this.config = config;

    this.s3Client = new S3Client({ region: config.region });
    this.dynamoClient = new DynamoDBClient({ region: config.region });
    this.tierManager = new TierManager(this.dynamoClient, {
      tableName: config.tiersTable,
      serverId: config.serverId,
    });
  }

  /**
   * Create a SnapshotManager from environment variables
   */
  static async create(options: {
    serverId: string;
    workspace: string;
    backend?: StateBackend;
    configExporter?: ConfigExporter;
    themeRegistry?: ThemeRegistry;
  }): Promise<SnapshotManager> {
    const accountId = process.env.AWS_ACCOUNT_ID ?? '000000000000';
    const region = process.env.AWS_REGION ?? DEFAULT_REGION;

    const config: SnapshotManagerConfig = {
      serverId: options.serverId,
      workspace: options.workspace,
      bucket: process.env.GAIB_BACKUP_BUCKET ?? `${DEFAULT_BUCKET_PATTERN}-${accountId}`,
      metadataTable: process.env.GAIB_BACKUP_TABLE ?? DEFAULT_METADATA_TABLE,
      tiersTable: process.env.GAIB_TIERS_TABLE ?? DEFAULT_TIERS_TABLE,
      region,
      kmsKeyId: process.env.GAIB_BACKUP_KMS_KEY,
    };

    const manager = new SnapshotManager(config);
    if (options.backend) {
      manager.setBackend(options.backend);
    }
    if (options.configExporter) {
      manager.setConfigExporter(options.configExporter);
    }
    if (options.themeRegistry) {
      manager.setThemeRegistry(options.themeRegistry);
    }
    return manager;
  }

  /**
   * Set the state backend for reading state
   */
  setBackend(backend: StateBackend): void {
    this.backend = backend;
  }

  /**
   * Set the config exporter for generating YAML config
   */
  setConfigExporter(exporter: ConfigExporter): void {
    this.configExporter = exporter;
  }

  /**
   * Set the theme registry for bundling
   */
  setThemeRegistry(registry: ThemeRegistry): void {
    this.themeRegistry = registry;
  }

  // ============================================================================
  // Snapshot Operations
  // ============================================================================

  /**
   * Create a full server snapshot
   */
  async createSnapshot(options: CreateSnapshotOptions = {}): Promise<SnapshotResult> {
    // 1. Check tier limits
    const tier = await this.tierManager.getTier();
    await this.tierManager.checkSnapshotLimit();

    // 2. Get current state
    const state = await this.getCurrentState();
    if (!state) {
      throw new BackupError(
        'No state to snapshot. Run `gaib server apply` first.',
        BackupErrorCode.NO_STATE
      );
    }

    // 3. Generate snapshot ID and paths
    const id = generateId();
    const timestamp = new Date().toISOString();
    const baseKey = `snapshots/${this.config.serverId}/${id}`;

    // 4. Prepare files
    const stateJson = JSON.stringify(state, null, 2);
    const stateCompressed = gzipSync(Buffer.from(stateJson));
    const stateChecksum = createHash('sha256').update(stateCompressed).digest('hex');

    // 5. Get config export
    const configYaml = this.configExporter
      ? await this.configExporter.export()
      : yaml.dump({ version: '1.0', server: { id: this.config.serverId } });
    const configCompressed = gzipSync(Buffer.from(configYaml));
    const configChecksum = createHash('sha256').update(configCompressed).digest('hex');

    // 6. Get theme registry
    const registryJson = JSON.stringify(this.themeRegistry ?? { version: '1.0', serverId: this.config.serverId, workspace: this.config.workspace, current: null, history: [], lastUpdated: timestamp }, null, 2);
    const registryCompressed = gzipSync(Buffer.from(registryJson));
    const registryChecksum = createHash('sha256').update(registryCompressed).digest('hex');

    // 7. Count Discord resources
    const discordCounts = this.countResources(state);

    // 8. Build manifest
    const manifest: SnapshotManifest = {
      version: '1.0',
      id,
      serverId: this.config.serverId,
      workspace: this.config.workspace,
      timestamp,
      serial: state.serial,
      lineage: state.lineage,
      tier,
      message: options.message,
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
          size: Buffer.from(configYaml).length,
          compressedSize: configCompressed.length,
        },
        themeRegistry: {
          path: 'theme-registry.json.gz',
          checksum: registryChecksum,
          size: Buffer.from(registryJson).length,
          compressedSize: registryCompressed.length,
        },
      },
      discord: discordCounts,
      theme: this.themeRegistry?.current
        ? {
            name: this.themeRegistry.current.themeName,
            version: this.themeRegistry.current.themeVersion,
          }
        : undefined,
      manifestChecksum: '', // Will be calculated after
    };

    // 9. Calculate manifest checksum
    const manifestWithoutChecksum = { ...manifest, manifestChecksum: undefined };
    manifest.manifestChecksum = createHash('sha256')
      .update(JSON.stringify(manifestWithoutChecksum))
      .digest('hex');

    // 10. Upload files to S3
    const uploads = [
      this.uploadFile(`${baseKey}/manifest.json`, JSON.stringify(manifest, null, 2), 'application/json', tier),
      this.uploadFile(`${baseKey}/state.json.gz`, stateCompressed, 'application/gzip', tier),
      this.uploadFile(`${baseKey}/config.yaml.gz`, configCompressed, 'application/gzip', tier),
      this.uploadFile(`${baseKey}/theme-registry.json.gz`, registryCompressed, 'application/gzip', tier),
    ];

    await Promise.all(uploads);

    // 11. Write metadata to DynamoDB
    const ttl = calculateTTL(TIER_LIMITS[tier].retentionDays);
    const metadataItem: BackupMetadataItem = {
      PK: `SERVER#${this.config.serverId}`,
      SK: `SNAPSHOT#${timestamp}#${id}`,
      GSI1PK: `TIER#${tier}`,
      GSI1SK: `TIMESTAMP#${timestamp}`,
      id,
      serverId: this.config.serverId,
      workspace: this.config.workspace,
      type: 'snapshot',
      timestamp,
      serial: state.serial,
      lineage: state.lineage,
      tier,
      message: options.message,
      s3Bucket: this.config.bucket,
      s3Key: baseKey,
      size: stateCompressed.length + configCompressed.length + registryCompressed.length,
      checksum: manifest.manifestChecksum,
      TTL: ttl,
    };

    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.config.metadataTable,
        Item: marshall(metadataItem),
      })
    );

    // 12. Update usage tracking
    await this.tierManager.recordSnapshot();

    return {
      id,
      timestamp,
      manifest,
    };
  }

  /**
   * List snapshots for current server
   */
  async listSnapshots(options: { limit?: number } = {}): Promise<SnapshotListItem[]> {
    const limit = options.limit ?? 20;

    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.metadataTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: marshall({
          ':pk': `SERVER#${this.config.serverId}`,
          ':skPrefix': 'SNAPSHOT#',
        }),
        ScanIndexForward: false, // Newest first
        Limit: limit,
      })
    );

    const items: SnapshotListItem[] = [];

    for (const item of result.Items ?? []) {
      const unmarshalled = unmarshall(item) as BackupMetadataItem;

      // Fetch manifest for additional details
      try {
        const manifest = await this.getManifest(unmarshalled.id);
        items.push({
          id: unmarshalled.id,
          timestamp: unmarshalled.timestamp,
          serial: unmarshalled.serial,
          message: unmarshalled.message,
          discord: manifest.discord,
          theme: manifest.theme,
        });
      } catch {
        // If manifest fetch fails, use basic info
        items.push({
          id: unmarshalled.id,
          timestamp: unmarshalled.timestamp,
          serial: unmarshalled.serial,
          message: unmarshalled.message,
          discord: { roleCount: 0, channelCount: 0, categoryCount: 0 },
        });
      }
    }

    return items;
  }

  /**
   * Get snapshot manifest by ID
   */
  async getManifest(snapshotId: string): Promise<SnapshotManifest> {
    const baseKey = `snapshots/${this.config.serverId}/${snapshotId}`;

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: `${baseKey}/manifest.json`,
      })
    );

    if (!response.Body) {
      throw new BackupError(
        `Snapshot manifest not found: ${snapshotId}`,
        BackupErrorCode.NOT_FOUND
      );
    }

    const body = await this.streamToString(response.Body as Readable);
    return JSON.parse(body) as SnapshotManifest;
  }

  /**
   * Download snapshot to local directory
   */
  async downloadSnapshot(snapshotId: string, outputDir: string): Promise<DownloadResult> {
    // 1. Get manifest
    const manifest = await this.getManifest(snapshotId);

    // 2. Verify manifest checksum
    const manifestWithoutChecksum = { ...manifest, manifestChecksum: undefined };
    const expectedChecksum = createHash('sha256')
      .update(JSON.stringify(manifestWithoutChecksum))
      .digest('hex');

    if (expectedChecksum !== manifest.manifestChecksum) {
      throw new IntegrityError(
        'Manifest checksum mismatch',
        manifest.manifestChecksum,
        expectedChecksum
      );
    }

    // 3. Create output directory
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const baseKey = `snapshots/${this.config.serverId}/${snapshotId}`;
    const files: string[] = [];

    // 4. Download and verify each file
    for (const [name, fileInfo] of Object.entries(manifest.files)) {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: `${baseKey}/${fileInfo.path}`,
        })
      );

      if (!response.Body) {
        throw new BackupError(
          `Snapshot file not found: ${fileInfo.path}`,
          BackupErrorCode.SNAPSHOT_INCOMPLETE
        );
      }

      const compressed = await this.streamToBuffer(response.Body as Readable);

      // Verify checksum
      const actualChecksum = createHash('sha256').update(compressed).digest('hex');
      if (actualChecksum !== fileInfo.checksum) {
        throw new IntegrityError(
          `File checksum mismatch: ${fileInfo.path}`,
          fileInfo.checksum,
          actualChecksum
        );
      }

      // Decompress
      const decompressed = gunzipSync(compressed);

      // Determine output filename
      let outputFile: string;
      if (name === 'state') {
        outputFile = 'state.json';
      } else if (name === 'config') {
        outputFile = 'config.yaml';
      } else {
        outputFile = 'theme-registry.json';
      }

      const outputPath = join(outputDir, outputFile);
      writeFileSync(outputPath, decompressed);
      files.push(outputPath);
    }

    // 5. Also save manifest
    const manifestPath = join(outputDir, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    files.push(manifestPath);

    return {
      outputDir,
      files,
      manifest,
    };
  }

  /**
   * Restore from a snapshot
   */
  async restoreSnapshot(
    snapshotId: string,
    options: RestoreSnapshotOptions = {}
  ): Promise<{ dryRun: boolean; manifest: SnapshotManifest; state: GaibState }> {
    // 1. Get manifest
    const manifest = await this.getManifest(snapshotId);

    // 2. Download state file
    const baseKey = `snapshots/${this.config.serverId}/${snapshotId}`;
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: `${baseKey}/${manifest.files.state.path}`,
      })
    );

    if (!response.Body) {
      throw new BackupError(
        `Snapshot state file not found: ${snapshotId}`,
        BackupErrorCode.SNAPSHOT_INCOMPLETE
      );
    }

    const compressed = await this.streamToBuffer(response.Body as Readable);

    // 3. Verify checksum
    const actualChecksum = createHash('sha256').update(compressed).digest('hex');
    if (actualChecksum !== manifest.files.state.checksum) {
      throw new IntegrityError(
        'State file checksum mismatch',
        manifest.files.state.checksum,
        actualChecksum
      );
    }

    // 4. Decompress
    const decompressed = gunzipSync(compressed);
    const state = JSON.parse(decompressed.toString()) as GaibState;

    // 5. Handle dry run
    if (options.dryRun) {
      return { dryRun: true, manifest, state };
    }

    // 6. Write restored state
    if (!this.backend) {
      throw new BackupError(
        'No state backend configured',
        BackupErrorCode.RESTORE_FAILED
      );
    }

    // Increment serial
    const currentState = await this.backend.getState(this.config.workspace);
    state.serial = (currentState?.serial ?? 0) + 1;
    state.lastModified = new Date().toISOString();

    await this.backend.setState(this.config.workspace, state);

    return { dryRun: false, manifest, state };
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(id1: string, id2: string): Promise<SnapshotDiff> {
    // 1. Get both manifests
    const manifest1 = await this.getManifest(id1);
    const manifest2 = await this.getManifest(id2);

    // 2. Download both state files
    const state1 = await this.downloadStateFile(id1, manifest1);
    const state2 = await this.downloadStateFile(id2, manifest2);

    // 3. Compare resources
    const roles = this.compareResourceType(state1, state2, 'discord_role');
    const channels = this.compareResourceType(state1, state2, 'discord_channel');
    const categories = this.compareResourceType(state1, state2, 'discord_category');

    return {
      snapshot1: { id: id1, timestamp: manifest1.timestamp },
      snapshot2: { id: id2, timestamp: manifest2.timestamp },
      roles,
      channels,
      categories,
    };
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    const baseKey = `snapshots/${this.config.serverId}/${snapshotId}`;

    // 1. List all objects in the snapshot prefix
    const listResponse = await this.s3Client.send(
      new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: baseKey,
      })
    );

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // 2. Delete all objects
      await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: {
            Objects: listResponse.Contents.map((obj) => ({ Key: obj.Key! })),
          },
        })
      );
    }

    // 3. Find and delete DynamoDB metadata
    const queryResult = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.metadataTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: marshall({
          ':pk': `SERVER#${this.config.serverId}`,
          ':skPrefix': 'SNAPSHOT#',
          ':id': snapshotId,
        }),
        Limit: 1,
      })
    );

    if (queryResult.Items && queryResult.Items.length > 0) {
      const item = unmarshall(queryResult.Items[0]) as BackupMetadataItem;
      await this.dynamoClient.send(
        new DeleteItemCommand({
          TableName: this.config.metadataTable,
          Key: marshall({
            PK: item.PK,
            SK: item.SK,
          }),
        })
      );
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Upload a file to S3
   */
  private async uploadFile(
    key: string,
    body: Buffer | string,
    contentType: string,
    tier: 'free' | 'premium'
  ): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: this.config.kmsKeyId ? 'aws:kms' : 'AES256',
        SSEKMSKeyId: this.config.kmsKeyId,
        Tagging: `Tier=${tier}&ServerId=${this.config.serverId}`,
      })
    );
  }

  /**
   * Get current state from backend
   */
  private async getCurrentState(): Promise<GaibState | null> {
    if (!this.backend) {
      return null;
    }
    return this.backend.getState(this.config.workspace);
  }

  /**
   * Count Discord resources in state
   */
  private countResources(state: GaibState): { roleCount: number; channelCount: number; categoryCount: number } {
    const resources = state.resources ?? [];
    return {
      roleCount: resources.filter((r) => r.type === 'discord_role').length,
      channelCount: resources.filter((r) => r.type === 'discord_channel').length,
      categoryCount: resources.filter((r) => r.type === 'discord_category').length,
    };
  }

  /**
   * Download state file from snapshot
   */
  private async downloadStateFile(snapshotId: string, manifest: SnapshotManifest): Promise<GaibState> {
    const baseKey = `snapshots/${this.config.serverId}/${snapshotId}`;
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: `${baseKey}/${manifest.files.state.path}`,
      })
    );

    if (!response.Body) {
      throw new BackupError(
        `Snapshot state file not found: ${snapshotId}`,
        BackupErrorCode.SNAPSHOT_INCOMPLETE
      );
    }

    const compressed = await this.streamToBuffer(response.Body as Readable);
    const decompressed = gunzipSync(compressed);
    return JSON.parse(decompressed.toString()) as GaibState;
  }

  /**
   * Compare resources of a specific type between two states
   */
  private compareResourceType(
    state1: GaibState,
    state2: GaibState,
    resourceType: string
  ): ResourceDiff {
    const resources1 = (state1.resources ?? []).filter((r) => r.type === resourceType);
    const resources2 = (state2.resources ?? []).filter((r) => r.type === resourceType);

    const map1 = new Map(resources1.map((r) => [r.name, r]));
    const map2 = new Map(resources2.map((r) => [r.name, r]));

    const added: string[] = [];
    const removed: string[] = [];
    const modified: Array<{ name: string; changes: Record<string, { from: unknown; to: unknown }> }> = [];

    // Find removed (in state1 but not in state2)
    for (const name of map1.keys()) {
      if (!map2.has(name)) {
        removed.push(name);
      }
    }

    // Find added and modified
    for (const [name, resource2] of map2) {
      const resource1 = map1.get(name);
      if (!resource1) {
        added.push(name);
      } else {
        const changes = this.compareAttributes(resource1, resource2);
        if (Object.keys(changes).length > 0) {
          modified.push({ name, changes });
        }
      }
    }

    return { added, removed, modified };
  }

  /**
   * Compare attributes between two resources
   */
  private compareAttributes(
    r1: { instances?: unknown[] },
    r2: { instances?: unknown[] }
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const attrs1 = (r1.instances?.[0] as { attributes?: Record<string, unknown> })?.attributes ?? {};
    const attrs2 = (r2.instances?.[0] as { attributes?: Record<string, unknown> })?.attributes ?? {};

    const allKeys = new Set([...Object.keys(attrs1), ...Object.keys(attrs2)]);

    for (const key of allKeys) {
      if (JSON.stringify(attrs1[key]) !== JSON.stringify(attrs2[key])) {
        changes[key] = { from: attrs1[key], to: attrs2[key] };
      }
    }

    return changes;
  }

  /**
   * Convert a readable stream to string
   */
  private async streamToString(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  /**
   * Convert a readable stream to buffer
   */
  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Get the tier manager
   */
  getTierManager(): TierManager {
    return this.tierManager;
  }

  /**
   * Get the configuration
   */
  getConfig(): SnapshotManagerConfig {
    return { ...this.config };
  }
}

// ============================================================================
// Config Exporter Interface
// ============================================================================

/**
 * Interface for config export functionality
 */
export interface ConfigExporter {
  export(): Promise<string>;
}
