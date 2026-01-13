/**
 * Manifest Provider Interface
 *
 * Sprint 43: Hybrid Manifest Repository
 *
 * Defines the contract for manifest storage and retrieval.
 * Supports hybrid model with PostgreSQL for runtime and S3 for versioning.
 *
 * @module packages/core/ports/IManifestProvider
 */

import type {
  Manifest,
  ManifestContent,
  ShadowState,
  ShadowResources,
} from '../../adapters/storage/schema.js';

// =============================================================================
// Manifest Types
// =============================================================================

/**
 * Manifest version metadata stored in S3
 */
export interface ManifestVersionMeta {
  /** Manifest ID */
  id: string;
  /** Community ID */
  communityId: string;
  /** Version number */
  version: number;
  /** Content checksum (SHA-256) */
  checksum: string;
  /** When this version was created */
  createdAt: string;
  /** Who created this version */
  createdBy?: string;
  /** S3 object key */
  s3Key: string;
  /** Size in bytes */
  sizeBytes: number;
}

/**
 * Drift detection result
 */
export interface DriftReport {
  /** Whether drift was detected */
  hasDrift: boolean;
  /** Timestamp of detection */
  detectedAt: Date;
  /** Community ID */
  communityId: string;
  /** Current manifest version */
  manifestVersion: number;
  /** Shadow state version (if different) */
  shadowVersion?: number;
  /** Detailed drift information */
  drifts: DriftItem[];
  /** Summary statistics */
  summary: DriftSummary;
}

/**
 * Individual drift item
 */
export interface DriftItem {
  /** Type of resource */
  resourceType: 'role' | 'channel' | 'category';
  /** Resource ID in manifest */
  manifestId: string;
  /** Resource ID in Discord (shadow) */
  discordId?: string;
  /** Type of drift */
  driftType: 'missing' | 'extra' | 'modified' | 'mismatch';
  /** What is expected (from manifest) */
  expected?: unknown;
  /** What is actual (from shadow/Discord) */
  actual?: unknown;
  /** Severity of drift */
  severity: 'info' | 'warning' | 'error';
}

/**
 * Drift summary statistics
 */
export interface DriftSummary {
  /** Total resources in manifest */
  totalManifestResources: number;
  /** Total resources in shadow */
  totalShadowResources: number;
  /** Resources missing from shadow */
  missingFromShadow: number;
  /** Extra resources in shadow */
  extraInShadow: number;
  /** Modified resources */
  modified: number;
  /** Checksum mismatches */
  checksumMismatches: number;
}

/**
 * Recovery options for disaster recovery
 */
export interface RecoveryOptions {
  /** Target version to restore (latest if not specified) */
  targetVersion?: number;
  /** Whether to create a new manifest version after restore */
  createNewVersion?: boolean;
  /** Who is performing the recovery */
  recoveredBy?: string;
  /** Validate content after restore */
  validate?: boolean;
}

/**
 * Recovery result
 */
export interface RecoveryResult {
  /** Whether recovery succeeded */
  success: boolean;
  /** Recovered manifest */
  manifest?: Manifest;
  /** Version that was restored */
  restoredVersion: number;
  /** New version created (if createNewVersion was true) */
  newVersion?: number;
  /** Error message if failed */
  error?: string;
  /** Recovery timestamp */
  recoveredAt: Date;
}

/**
 * Input for creating a manifest with shadow write
 */
export interface CreateManifestInput {
  /** Manifest content */
  content: ManifestContent;
  /** Content checksum (auto-generated if not provided) */
  checksum?: string;
  /** Who is creating this manifest */
  synthesizedBy?: string;
  /** Skip shadow write (for testing) */
  skipShadowWrite?: boolean;
}

/**
 * Input for applying manifest to Discord
 */
export interface ApplyManifestInput {
  /** Manifest version to apply */
  version: number;
  /** Actual Discord resource mappings */
  resources: ShadowResources;
  /** Who is applying this manifest */
  appliedBy?: string;
}

// =============================================================================
// Manifest Provider Interface
// =============================================================================

/**
 * IManifestProvider defines the contract for hybrid manifest storage.
 *
 * The hybrid model stores:
 * - PostgreSQL: Current/recent manifests for fast runtime reads
 * - S3: Full version history for disaster recovery and audit
 *
 * Key operations:
 * - Create manifest with automatic S3 shadow write
 * - Retrieve manifest from PostgreSQL (fast) or S3 (historical)
 * - Detect drift between desired (manifest) and actual (shadow) state
 * - Recover from S3 in disaster scenarios
 */
export interface IManifestProvider {
  // ===========================================================================
  // Core Manifest Operations
  // ===========================================================================

  /**
   * Create a new manifest version
   *
   * Automatically:
   * 1. Generates checksum if not provided
   * 2. Saves to PostgreSQL with incremented version
   * 3. Writes shadow copy to S3
   */
  createManifest(input: CreateManifestInput): Promise<Manifest>;

  /**
   * Get current active manifest
   */
  getCurrentManifest(): Promise<Manifest | null>;

  /**
   * Get manifest by version number
   *
   * First checks PostgreSQL, falls back to S3 for old versions.
   */
  getManifestByVersion(version: number): Promise<Manifest | null>;

  /**
   * Get manifest version history (metadata only)
   *
   * Returns lightweight version list from S3 index.
   */
  getVersionHistory(limit?: number): Promise<ManifestVersionMeta[]>;

  // ===========================================================================
  // Shadow State Operations
  // ===========================================================================

  /**
   * Record that a manifest was applied to Discord
   *
   * Creates shadow state entry with Discord resource mappings.
   */
  recordApply(input: ApplyManifestInput): Promise<ShadowState>;

  /**
   * Get current shadow state
   */
  getCurrentShadowState(): Promise<ShadowState | null>;

  /**
   * Get shadow state for a specific manifest version
   */
  getShadowStateByVersion(version: number): Promise<ShadowState | null>;

  // ===========================================================================
  // Drift Detection
  // ===========================================================================

  /**
   * Detect drift between desired and actual state
   *
   * Compares:
   * - Desired: Current manifest content
   * - Shadow: Last applied state (what we think Discord has)
   * - Actual: Optional live Discord state (if provided)
   */
  detectDrift(actualState?: ShadowResources): Promise<DriftReport>;

  /**
   * Validate checksum integrity
   *
   * Compares stored checksum against recomputed checksum.
   */
  validateChecksum(version: number): Promise<boolean>;

  // ===========================================================================
  // Disaster Recovery
  // ===========================================================================

  /**
   * Recover manifest from S3 shadow storage
   *
   * Use when PostgreSQL data is corrupted or lost.
   */
  recoverFromS3(options?: RecoveryOptions): Promise<RecoveryResult>;

  /**
   * List available versions in S3 for recovery
   */
  listRecoverableVersions(): Promise<ManifestVersionMeta[]>;

  // ===========================================================================
  // Health & Maintenance
  // ===========================================================================

  /**
   * Check S3 connectivity and bucket access
   */
  healthCheck(): Promise<{ s3: boolean; postgres: boolean }>;

  /**
   * Get storage statistics
   */
  getStats(): Promise<{
    totalVersions: number;
    latestVersion: number;
    s3ObjectCount: number;
    totalSizeBytes: number;
  }>;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Options for creating a manifest provider
 */
export interface ManifestProviderOptions {
  /** S3 bucket name for shadow storage */
  s3Bucket: string;
  /** S3 key prefix (default: 'manifests/') */
  s3Prefix?: string;
  /** AWS region */
  awsRegion?: string;
  /** Tenant ID (community ID) */
  tenantId: string;
  /** Database connection string */
  connectionString: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Factory function type for creating manifest providers
 */
export type ManifestProviderFactory = (
  options: ManifestProviderOptions
) => Promise<IManifestProvider>;
