/**
 * Backup System Types
 *
 * Sprint 166: Backup Foundation - Type Definitions
 *
 * Defines interfaces for backup metadata, snapshots, theme registry,
 * and service tier configuration.
 *
 * @see SDD grimoires/loa/sdd.md §13-15
 * @module packages/cli/commands/server/backup/types
 */

// ============================================================================
// Backup Metadata Types
// ============================================================================

/**
 * Backup metadata stored in DynamoDB
 */
export interface BackupMetadata {
  /** Unique backup ID (UUID) */
  id: string;
  /** Discord Guild ID */
  serverId: string;
  /** Gaib workspace name */
  workspace: string;
  /** Backup type */
  type: 'state' | 'snapshot';
  /** ISO 8601 timestamp */
  timestamp: string;
  /** State serial at backup time */
  serial: number;
  /** State lineage ID for validation */
  lineage: string;
  /** Service tier */
  tier: 'free' | 'premium';
  /** User-provided description */
  message?: string;
  /** S3 bucket name */
  s3Bucket: string;
  /** S3 object key */
  s3Key: string;
  /** Compressed size in bytes */
  size: number;
  /** SHA-256 checksum of compressed content */
  checksum: string;
  /** TTL timestamp for auto-expiration (Unix seconds) */
  ttl?: number;
}

/**
 * DynamoDB item structure for backup metadata
 */
export interface BackupMetadataItem {
  /** Partition key: SERVER#{serverId} */
  PK: string;
  /** Sort key: BACKUP#{timestamp}#{id} */
  SK: string;
  /** GSI1 partition key: TIER#{tier} */
  GSI1PK: string;
  /** GSI1 sort key: TIMESTAMP#{timestamp} */
  GSI1SK: string;
  /** Backup metadata fields */
  id: string;
  serverId: string;
  workspace: string;
  type: 'state' | 'snapshot';
  timestamp: string;
  serial: number;
  lineage: string;
  tier: 'free' | 'premium';
  message?: string;
  s3Bucket: string;
  s3Key: string;
  size: number;
  checksum: string;
  /** TTL attribute for DynamoDB auto-expiration */
  TTL: number;
}

/**
 * Backup list item for display
 */
export interface BackupListItem {
  id: string;
  timestamp: string;
  serial: number;
  size: number;
  message?: string;
  type: 'state' | 'snapshot';
}

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Snapshot manifest stored at snapshots/{serverId}/{id}/manifest.json
 */
export interface SnapshotManifest {
  /** Manifest version */
  version: '1.0';
  /** Snapshot ID (UUID) */
  id: string;
  /** Discord Guild ID */
  serverId: string;
  /** Gaib workspace name */
  workspace: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** State serial at snapshot time */
  serial: number;
  /** State lineage ID */
  lineage: string;
  /** Service tier */
  tier: 'free' | 'premium';
  /** User-provided description */
  message?: string;

  /** Bundle file information */
  files: {
    state: FileInfo;
    config: FileInfo;
    themeRegistry: FileInfo;
  };

  /** Discord resource summary */
  discord: {
    roleCount: number;
    channelCount: number;
    categoryCount: number;
  };

  /** Theme info (if theme was applied) */
  theme?: {
    name: string;
    version: string;
  };

  /** SHA-256 of manifest (excluding this field) */
  manifestChecksum: string;
}

/**
 * File information within a snapshot
 */
export interface FileInfo {
  /** Relative path in snapshot */
  path: string;
  /** SHA-256 checksum */
  checksum: string;
  /** Original size in bytes */
  size: number;
  /** Compressed size in bytes */
  compressedSize: number;
}

/**
 * Snapshot comparison result
 */
export interface SnapshotDiff {
  snapshot1: { id: string; timestamp: string };
  snapshot2: { id: string; timestamp: string };
  roles: ResourceDiff;
  channels: ResourceDiff;
  categories: ResourceDiff;
}

/**
 * Resource differences between snapshots
 */
export interface ResourceDiff {
  added: string[];
  removed: string[];
  modified: Array<{
    name: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  }>;
}

// ============================================================================
// Theme Registry Types
// ============================================================================

/**
 * Theme registry stored at themes/{serverId}/registry.json
 */
export interface ThemeRegistry {
  /** Discord Guild ID */
  serverId: string;
  /** Gaib workspace name */
  workspace: string;
  /** Current theme deployment (null if destroyed) */
  current: ThemeDeployment | null;
  /** Deployment history (newest first) */
  history: ThemeDeployment[];
  /** Last update timestamp */
  lastUpdated: string;
  /** Registry version */
  version: '1.0';
}

/**
 * Theme deployment record
 */
export interface ThemeDeployment {
  /** Deployment ID (UUID) */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Theme name */
  themeName: string;
  /** Theme version */
  themeVersion: string;
  /** State serial after deployment */
  serial: number;
  /** Associated snapshot ID (if created) */
  snapshotId?: string;
  /** Operation type */
  action: 'apply' | 'rollback' | 'destroy';
  /** User description */
  message?: string;
  /** Who performed the action */
  who: string;
}

// ============================================================================
// Service Tier Types
// ============================================================================

/**
 * Server tier configuration stored in DynamoDB
 */
export interface ServerTierConfig {
  /** Partition key: SERVER#{serverId} */
  PK: string;
  /** Discord Guild ID */
  serverId: string;
  /** Service tier */
  tier: 'free' | 'premium';
  /** Backups created today (resets at midnight UTC) */
  backupsToday: number;
  /** Last backup timestamp */
  lastBackupAt?: string;
  /** Snapshots created this week (resets Sunday midnight UTC) */
  snapshotsThisWeek: number;
  /** Last snapshot timestamp */
  lastSnapshotAt?: string;
  /** Account creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Tier limits configuration
 */
export interface TierLimits {
  /** Daily on-demand backup limit */
  dailyBackups: number;
  /** Weekly snapshot limit */
  weeklySnapshots: number;
  /** Retention days */
  retentionDays: number;
  /** History entries to keep */
  historyLimit: number;
  /** Cross-region replication enabled */
  crossRegion: boolean;
}

/**
 * Tier limits by tier type
 */
export const TIER_LIMITS: Record<'free' | 'premium', TierLimits> = {
  free: {
    dailyBackups: 1,
    weeklySnapshots: 3,
    retentionDays: 7,
    historyLimit: 5,
    crossRegion: false,
  },
  premium: {
    dailyBackups: Infinity,
    weeklySnapshots: Infinity,
    retentionDays: 90,
    historyLimit: Infinity,
    crossRegion: true,
  },
};

// ============================================================================
// Operation Types
// ============================================================================

/**
 * Options for creating a backup
 */
export interface CreateBackupOptions {
  /** User-provided description */
  message?: string;
}

/**
 * Result of backup creation
 */
export interface BackupResult {
  /** Backup ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** State serial */
  serial: number;
  /** Compressed size in bytes */
  size: number;
  /** SHA-256 checksum */
  checksum: string;
}

/**
 * Options for listing backups
 */
export interface ListBackupsOptions {
  /** Maximum backups to return */
  limit?: number;
  /** Pagination token */
  startKey?: string;
}

/**
 * Options for restoring a backup
 */
export interface RestoreOptions {
  /** Show what would be restored without applying */
  dryRun?: boolean;
}

/**
 * Result of restore operation
 */
export interface RestoreResult {
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Backup that was restored */
  backup: BackupMetadata;
  /** Restored state */
  state: unknown;
  /** Changes that would be/were made */
  changes: {
    serial: { from: number; to: number };
    resourceCount: { from: number; to: number };
  };
}

/**
 * Options for creating a snapshot
 */
export interface CreateSnapshotOptions {
  /** User-provided description */
  message?: string;
}

/**
 * Result of snapshot creation
 */
export interface SnapshotResult {
  /** Snapshot ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Snapshot manifest */
  manifest: SnapshotManifest;
}

/**
 * Options for restoring a snapshot
 */
export interface RestoreSnapshotOptions {
  /** Show what would be restored without applying */
  dryRun?: boolean;
  /** Also apply restored config to Discord */
  apply?: boolean;
}

/**
 * Options for theme rollback
 */
export interface RollbackOptions {
  /** Number of deployments to roll back */
  steps?: number;
  /** Specific deployment ID to roll back to */
  toDeploymentId?: string;
  /** Show what would be rolled back without applying */
  dryRun?: boolean;
}

/**
 * Result of rollback operation
 */
export interface RollbackResult {
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Deployment being rolled back from */
  from: ThemeDeployment | null;
  /** Deployment being rolled back to */
  to: ThemeDeployment;
}

/**
 * Options for recording a deployment
 */
export interface RecordDeploymentOptions {
  /** Theme name */
  themeName: string;
  /** Theme version */
  themeVersion: string;
  /** State serial after deployment */
  serial: number;
  /** Associated snapshot ID */
  snapshotId?: string;
  /** Operation type */
  action: 'apply' | 'rollback' | 'destroy';
  /** User description */
  message?: string;
  /** Who performed the action */
  who: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Backup manager configuration
 */
export interface BackupManagerConfig {
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

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for backup operations
 */
export enum BackupErrorCode {
  NOT_FOUND = 'BACKUP_NOT_FOUND',
  CHECKSUM_MISMATCH = 'CHECKSUM_MISMATCH',
  LINEAGE_MISMATCH = 'LINEAGE_MISMATCH',
  TIER_LIMIT = 'TIER_LIMIT_EXCEEDED',
  S3_ERROR = 'S3_ERROR',
  DYNAMODB_ERROR = 'DYNAMODB_ERROR',
  SNAPSHOT_INCOMPLETE = 'SNAPSHOT_INCOMPLETE',
  RESTORE_FAILED = 'RESTORE_FAILED',
  NO_STATE = 'NO_STATE',
  NO_SNAPSHOT = 'NO_SNAPSHOT_FOR_ROLLBACK',
}

/**
 * Base error for backup operations
 */
export class BackupError extends Error {
  constructor(
    message: string,
    public readonly code: BackupErrorCode,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * Error when tier limit is exceeded
 */
export class TierLimitError extends BackupError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, BackupErrorCode.TIER_LIMIT, details);
    this.name = 'TierLimitError';
  }
}

/**
 * Error when backup/snapshot integrity check fails
 */
export class IntegrityError extends BackupError {
  constructor(
    message: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(message, BackupErrorCode.CHECKSUM_MISMATCH, { expected, actual });
    this.name = 'IntegrityError';
  }
}

/**
 * Error when lineage validation fails
 */
export class LineageError extends BackupError {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(
      `Lineage mismatch: backup has "${expected}", current state has "${actual}". ` +
        'This backup may be from a different workspace.',
      BackupErrorCode.LINEAGE_MISMATCH,
      { expected, actual }
    );
    this.name = 'LineageError';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Calculate TTL timestamp for a given retention period
 */
export function calculateTTL(retentionDays: number): number {
  const now = Date.now();
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  return Math.floor((now + retentionMs) / 1000);
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Convert BackupMetadataItem to BackupMetadata
 */
export function fromDynamoItem(item: BackupMetadataItem): BackupMetadata {
  return {
    id: item.id,
    serverId: item.serverId,
    workspace: item.workspace,
    type: item.type,
    timestamp: item.timestamp,
    serial: item.serial,
    lineage: item.lineage,
    tier: item.tier,
    message: item.message,
    s3Bucket: item.s3Bucket,
    s3Key: item.s3Key,
    size: item.size,
    checksum: item.checksum,
    ttl: item.TTL,
  };
}

/**
 * Convert BackupMetadata to DynamoDB item
 */
export function toDynamoItem(
  metadata: BackupMetadata,
  ttl: number
): BackupMetadataItem {
  return {
    PK: `SERVER#${metadata.serverId}`,
    SK: `BACKUP#${metadata.timestamp}#${metadata.id}`,
    GSI1PK: `TIER#${metadata.tier}`,
    GSI1SK: `TIMESTAMP#${metadata.timestamp}`,
    id: metadata.id,
    serverId: metadata.serverId,
    workspace: metadata.workspace,
    type: metadata.type,
    timestamp: metadata.timestamp,
    serial: metadata.serial,
    lineage: metadata.lineage,
    tier: metadata.tier,
    message: metadata.message,
    s3Bucket: metadata.s3Bucket,
    s3Key: metadata.s3Key,
    size: metadata.size,
    checksum: metadata.checksum,
    TTL: ttl,
  };
}
