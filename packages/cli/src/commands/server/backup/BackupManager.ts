/**
 * Backup Manager
 *
 * Sprint 166: Backup Foundation - Core Backup Operations
 *
 * Manages state backups with S3 storage and DynamoDB metadata.
 * Supports compression, encryption, and tier-based retention.
 *
 * @see SDD grimoires/loa/sdd.md §15.1
 * @module packages/cli/commands/server/backup/BackupManager
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { Readable } from 'stream';

import type { GaibState } from '../iac/backends/types.js';
import type { StateBackend } from '../iac/backends/types.js';
import {
  type BackupMetadata,
  type BackupMetadataItem,
  type BackupListItem,
  type BackupManagerConfig,
  type CreateBackupOptions,
  type BackupResult,
  type ListBackupsOptions,
  type RestoreOptions,
  type RestoreResult,
  BackupError,
  BackupErrorCode,
  IntegrityError,
  LineageError,
  generateId,
  calculateTTL,
  formatBytes,
  fromDynamoItem,
  toDynamoItem,
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
// BackupManager Implementation
// ============================================================================

/**
 * Manages backup operations for Gaib state files
 *
 * @example
 * ```typescript
 * const manager = await BackupManager.create({
 *   serverId: '1234567890',
 *   workspace: 'default',
 * });
 *
 * // Create backup
 * const backup = await manager.createBackup({ message: 'Before migration' });
 *
 * // List backups
 * const backups = await manager.listBackups({ limit: 10 });
 *
 * // Restore backup
 * await manager.restoreBackup(backup.id);
 * ```
 */
export class BackupManager {
  private readonly s3Client: S3Client;
  private readonly dynamoClient: DynamoDBClient;
  private readonly tierManager: TierManager;
  private readonly config: BackupManagerConfig;
  private backend: StateBackend | null = null;

  constructor(config: BackupManagerConfig) {
    this.config = config;

    this.s3Client = new S3Client({ region: config.region });
    this.dynamoClient = new DynamoDBClient({ region: config.region });
    this.tierManager = new TierManager(this.dynamoClient, {
      tableName: config.tiersTable,
      serverId: config.serverId,
    });
  }

  /**
   * Create a BackupManager from environment variables
   */
  static async create(options: {
    serverId: string;
    workspace: string;
    backend?: StateBackend;
  }): Promise<BackupManager> {
    const accountId = process.env.AWS_ACCOUNT_ID ?? '000000000000';
    const region = process.env.AWS_REGION ?? DEFAULT_REGION;

    const config: BackupManagerConfig = {
      serverId: options.serverId,
      workspace: options.workspace,
      bucket: process.env.GAIB_BACKUP_BUCKET ?? `${DEFAULT_BUCKET_PATTERN}-${accountId}`,
      metadataTable: process.env.GAIB_BACKUP_TABLE ?? DEFAULT_METADATA_TABLE,
      tiersTable: process.env.GAIB_TIERS_TABLE ?? DEFAULT_TIERS_TABLE,
      region,
      kmsKeyId: process.env.GAIB_BACKUP_KMS_KEY,
    };

    const manager = new BackupManager(config);
    if (options.backend) {
      manager.setBackend(options.backend);
    }
    return manager;
  }

  /**
   * Set the state backend for reading/writing state
   */
  setBackend(backend: StateBackend): void {
    this.backend = backend;
  }

  // ============================================================================
  // Backup Operations
  // ============================================================================

  /**
   * Create a state backup
   */
  async createBackup(options: CreateBackupOptions = {}): Promise<BackupResult> {
    // 1. Check tier limits
    const tier = await this.tierManager.getTier();
    await this.tierManager.checkBackupLimit();

    // 2. Get current state
    const state = await this.getCurrentState();
    if (!state) {
      throw new BackupError(
        'No state to backup. Run `gaib server apply` first.',
        BackupErrorCode.NO_STATE
      );
    }

    // 3. Compress state
    const stateJson = JSON.stringify(state, null, 2);
    const compressed = gzipSync(Buffer.from(stateJson));

    // 4. Calculate checksum
    const checksum = createHash('sha256').update(compressed).digest('hex');

    // 5. Generate backup ID and S3 key
    const id = generateId();
    const timestamp = new Date().toISOString();
    const s3Key = this.getBackupS3Key(timestamp);

    // 6. Upload to S3
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: s3Key,
        Body: compressed,
        ContentType: 'application/gzip',
        ContentEncoding: 'gzip',
        ServerSideEncryption: this.config.kmsKeyId ? 'aws:kms' : 'AES256',
        SSEKMSKeyId: this.config.kmsKeyId,
        Tagging: `Tier=${tier}&ServerId=${this.config.serverId}`,
        Metadata: {
          'gaib-backup-id': id,
          'gaib-server-id': this.config.serverId,
          'gaib-workspace': this.config.workspace,
          'gaib-serial': String(state.serial),
          'gaib-lineage': state.lineage,
        },
      })
    );

    // 7. Create metadata
    const metadata: BackupMetadata = {
      id,
      serverId: this.config.serverId,
      workspace: this.config.workspace,
      type: 'state',
      timestamp,
      serial: state.serial,
      lineage: state.lineage,
      tier,
      message: options.message,
      s3Bucket: this.config.bucket,
      s3Key,
      size: compressed.length,
      checksum,
    };

    // 8. Calculate TTL based on tier
    const ttl = calculateTTL(TIER_LIMITS[tier].retentionDays);

    // 9. Write metadata to DynamoDB
    const item = toDynamoItem(metadata, ttl);
    await this.dynamoClient.send(
      new PutItemCommand({
        TableName: this.config.metadataTable,
        Item: marshall(item),
      })
    );

    // 10. Update usage tracking
    await this.tierManager.recordBackup();

    return {
      id,
      timestamp,
      serial: state.serial,
      size: compressed.length,
      checksum,
    };
  }

  /**
   * List backups for current server
   */
  async listBackups(options: ListBackupsOptions = {}): Promise<BackupListItem[]> {
    const limit = options.limit ?? 20;

    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.metadataTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: marshall({
          ':pk': `SERVER#${this.config.serverId}`,
          ':skPrefix': 'BACKUP#',
        }),
        ScanIndexForward: false, // Newest first
        Limit: limit,
      })
    );

    return (result.Items ?? []).map((item) => {
      const unmarshalled = unmarshall(item) as BackupMetadataItem;
      return {
        id: unmarshalled.id,
        timestamp: unmarshalled.timestamp,
        serial: unmarshalled.serial,
        size: unmarshalled.size,
        message: unmarshalled.message,
        type: unmarshalled.type,
      };
    });
  }

  /**
   * Get backup metadata by ID
   */
  async getBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
    // We need to query since we don't know the timestamp
    const result = await this.dynamoClient.send(
      new QueryCommand({
        TableName: this.config.metadataTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: marshall({
          ':pk': `SERVER#${this.config.serverId}`,
          ':skPrefix': 'BACKUP#',
          ':id': backupId,
        }),
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    const item = unmarshall(result.Items[0]) as BackupMetadataItem;
    return fromDynamoItem(item);
  }

  /**
   * Restore from a backup
   */
  async restoreBackup(
    backupId: string,
    options: RestoreOptions = {}
  ): Promise<RestoreResult> {
    // 1. Get backup metadata
    const backup = await this.getBackupMetadata(backupId);
    if (!backup) {
      throw new BackupError(
        `Backup not found: ${backupId}`,
        BackupErrorCode.NOT_FOUND
      );
    }

    // 2. Download from S3
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: backup.s3Bucket,
        Key: backup.s3Key,
      })
    );

    if (!response.Body) {
      throw new BackupError(
        `Backup file empty: ${backupId}`,
        BackupErrorCode.NOT_FOUND
      );
    }

    const compressed = await this.streamToBuffer(response.Body as Readable);

    // 3. Verify checksum
    const checksum = createHash('sha256').update(compressed).digest('hex');
    if (checksum !== backup.checksum) {
      throw new IntegrityError(
        'Backup checksum mismatch - data may be corrupted',
        backup.checksum,
        checksum
      );
    }

    // 4. Decompress
    const decompressed = gunzipSync(compressed);
    const state = JSON.parse(decompressed.toString()) as GaibState;

    // 5. Validate lineage
    const currentState = await this.getCurrentState();
    if (currentState && currentState.lineage !== state.lineage) {
      throw new LineageError(state.lineage, currentState.lineage);
    }

    // 6. Calculate changes
    const changes = {
      serial: {
        from: currentState?.serial ?? 0,
        to: state.serial,
      },
      resourceCount: {
        from: currentState?.resources?.length ?? 0,
        to: state.resources?.length ?? 0,
      },
    };

    if (options.dryRun) {
      return {
        dryRun: true,
        backup,
        state,
        changes,
      };
    }

    // 7. Write restored state
    if (!this.backend) {
      throw new BackupError(
        'No state backend configured',
        BackupErrorCode.RESTORE_FAILED
      );
    }

    // Increment serial to mark this as a new state version
    state.serial = (currentState?.serial ?? 0) + 1;
    state.lastModified = new Date().toISOString();

    await this.backend.setState(this.config.workspace, state);

    return {
      dryRun: false,
      backup,
      state,
      changes,
    };
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    // 1. Get backup metadata
    const backup = await this.getBackupMetadata(backupId);
    if (!backup) {
      throw new BackupError(
        `Backup not found: ${backupId}`,
        BackupErrorCode.NOT_FOUND
      );
    }

    // 2. Delete from S3
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: backup.s3Bucket,
        Key: backup.s3Key,
      })
    );

    // 3. Delete from DynamoDB
    await this.dynamoClient.send(
      new DeleteItemCommand({
        TableName: this.config.metadataTable,
        Key: marshall({
          PK: `SERVER#${this.config.serverId}`,
          SK: `BACKUP#${backup.timestamp}#${backup.id}`,
        }),
      })
    );
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Get the S3 key for a backup
   */
  private getBackupS3Key(timestamp: string): string {
    return `state/${this.config.serverId}/${this.config.workspace}/backup.${timestamp}.json.gz`;
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
   * Get the current tier manager
   */
  getTierManager(): TierManager {
    return this.tierManager;
  }

  /**
   * Get the S3 client (for testing)
   */
  getS3Client(): S3Client {
    return this.s3Client;
  }

  /**
   * Get the DynamoDB client (for testing)
   */
  getDynamoClient(): DynamoDBClient {
    return this.dynamoClient;
  }

  /**
   * Get the configuration
   */
  getConfig(): BackupManagerConfig {
    return { ...this.config };
  }
}
