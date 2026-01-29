/**
 * Theme Registry Manager
 *
 * Sprint 169: Theme Registry - Deployment Tracking & Rollback
 *
 * Tracks theme deployments with full history and rollback capability.
 * Maintains a registry in S3 and audit log for each deployment.
 *
 * @see SDD grimoires/loa/sdd.md §15.4
 * @module packages/cli/commands/server/backup/ThemeRegistryManager
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { createHash } from 'crypto';

import {
  type ThemeRegistry,
  type ThemeDeployment,
  type RecordDeploymentOptions,
  type RollbackOptions,
  type RollbackResult,
  BackupError,
  BackupErrorCode,
  generateId,
  TIER_LIMITS,
} from './types.js';
import { SnapshotManager } from './SnapshotManager.js';

// ============================================================================
// Constants
// ============================================================================

/** Default AWS region */
const DEFAULT_REGION = 'us-east-1';

/** Default S3 bucket name pattern */
const DEFAULT_BUCKET_PATTERN = 'gaib-backups';

// ============================================================================
// Types
// ============================================================================

/**
 * ThemeRegistryManager configuration
 */
export interface ThemeRegistryManagerConfig {
  /** Discord Guild ID */
  serverId: string;
  /** Gaib workspace name */
  workspace: string;
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
  /** Service tier */
  tier: 'free' | 'premium';
}

/**
 * Registry info for display
 */
export interface RegistryInfo {
  current: ThemeDeployment | null;
  recentHistory: ThemeDeployment[];
  totalDeployments: number;
}

// ============================================================================
// ThemeRegistryManager Implementation
// ============================================================================

/**
 * Manages theme deployment tracking and rollback
 *
 * @example
 * ```typescript
 * const manager = await ThemeRegistryManager.create({
 *   serverId: '1234567890',
 *   workspace: 'default',
 * });
 *
 * // Record deployment
 * await manager.recordDeployment({
 *   themeName: 'sietch',
 *   themeVersion: '3.0.0',
 *   serial: 42,
 *   action: 'apply',
 *   who: 'user@example.com',
 * });
 *
 * // Get registry info
 * const info = await manager.getRegistryInfo();
 *
 * // Rollback
 * const result = await manager.rollback({ steps: 1 });
 * ```
 */
export class ThemeRegistryManager {
  private readonly s3Client: S3Client;
  private readonly config: ThemeRegistryManagerConfig;
  private snapshotManager: SnapshotManager | null = null;
  private registry: ThemeRegistry | null = null;

  constructor(config: ThemeRegistryManagerConfig) {
    this.config = config;
    this.s3Client = new S3Client({ region: config.region });
  }

  /**
   * Create a ThemeRegistryManager from environment variables
   */
  static async create(options: {
    serverId: string;
    workspace: string;
    tier?: 'free' | 'premium';
  }): Promise<ThemeRegistryManager> {
    const accountId = process.env.AWS_ACCOUNT_ID ?? '000000000000';
    const region = process.env.AWS_REGION ?? DEFAULT_REGION;

    const config: ThemeRegistryManagerConfig = {
      serverId: options.serverId,
      workspace: options.workspace,
      bucket: process.env.GAIB_BACKUP_BUCKET ?? `${DEFAULT_BUCKET_PATTERN}-${accountId}`,
      region,
      tier: options.tier ?? 'free',
    };

    const manager = new ThemeRegistryManager(config);
    await manager.loadRegistry();
    return manager;
  }

  /**
   * Set the snapshot manager for rollback operations
   */
  setSnapshotManager(snapshotManager: SnapshotManager): void {
    this.snapshotManager = snapshotManager;
  }

  // ============================================================================
  // Registry Operations
  // ============================================================================

  /**
   * Get the current registry state
   */
  async getRegistry(): Promise<ThemeRegistry> {
    if (!this.registry) {
      await this.loadRegistry();
    }
    return this.registry!;
  }

  /**
   * Get registry info (current + recent history)
   */
  async getRegistryInfo(): Promise<RegistryInfo> {
    const registry = await this.getRegistry();
    const historyLimit = TIER_LIMITS[this.config.tier].historyLimit;
    const recentCount = Math.min(5, historyLimit === Infinity ? 5 : historyLimit);

    return {
      current: registry.current,
      recentHistory: registry.history.slice(0, recentCount),
      totalDeployments: registry.history.length + (registry.current ? 1 : 0),
    };
  }

  /**
   * Get full deployment history
   */
  async getHistory(options: { limit?: number } = {}): Promise<ThemeDeployment[]> {
    const registry = await this.getRegistry();
    const historyLimit = TIER_LIMITS[this.config.tier].historyLimit;
    const limit = options.limit ?? (historyLimit === Infinity ? 100 : historyLimit);

    const allDeployments = registry.current
      ? [registry.current, ...registry.history]
      : registry.history;

    return allDeployments.slice(0, limit);
  }

  /**
   * Record a new deployment
   */
  async recordDeployment(options: RecordDeploymentOptions): Promise<ThemeDeployment> {
    const registry = await this.getRegistry();

    // Create deployment record
    const deployment: ThemeDeployment = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      themeName: options.themeName,
      themeVersion: options.themeVersion,
      serial: options.serial,
      snapshotId: options.snapshotId,
      action: options.action,
      message: options.message,
      who: options.who,
    };

    // Handle destroy action
    if (options.action === 'destroy') {
      // Move current to history
      if (registry.current) {
        registry.history.unshift(registry.current);
      }
      registry.current = null;
    } else {
      // Move current to history
      if (registry.current) {
        registry.history.unshift(registry.current);
      }
      registry.current = deployment;
    }

    // Enforce history limit for free tier
    const historyLimit = TIER_LIMITS[this.config.tier].historyLimit;
    if (historyLimit !== Infinity && registry.history.length > historyLimit) {
      registry.history = registry.history.slice(0, historyLimit);
    }

    registry.lastUpdated = deployment.timestamp;

    // Save registry
    await this.saveRegistry();

    // Write audit log entry
    await this.writeAuditEntry(deployment);

    return deployment;
  }

  // ============================================================================
  // Rollback Operations
  // ============================================================================

  /**
   * Rollback to a previous deployment
   */
  async rollback(options: RollbackOptions = {}): Promise<RollbackResult> {
    const registry = await this.getRegistry();
    const steps = options.steps ?? 1;

    // Find target deployment
    let targetDeployment: ThemeDeployment | undefined;

    if (options.toDeploymentId) {
      // Find specific deployment
      const allDeployments = registry.current
        ? [registry.current, ...registry.history]
        : registry.history;
      targetDeployment = allDeployments.find((d) => d.id === options.toDeploymentId);
    } else {
      // Roll back N steps
      if (steps > registry.history.length) {
        throw new BackupError(
          `Cannot rollback ${steps} steps - only ${registry.history.length} deployments in history`,
          BackupErrorCode.NOT_FOUND
        );
      }
      targetDeployment = registry.history[steps - 1];
    }

    if (!targetDeployment) {
      throw new BackupError(
        options.toDeploymentId
          ? `Deployment not found: ${options.toDeploymentId}`
          : 'No deployment found to rollback to',
        BackupErrorCode.NOT_FOUND
      );
    }

    // Check for snapshot
    if (!targetDeployment.snapshotId) {
      throw new BackupError(
        `Cannot rollback to deployment ${targetDeployment.id} - no associated snapshot. ` +
          'Rollback requires a snapshot to restore state.',
        BackupErrorCode.NO_SNAPSHOT
      );
    }

    // Dry run - just return what would happen
    if (options.dryRun) {
      return {
        dryRun: true,
        from: registry.current,
        to: targetDeployment,
      };
    }

    // Actual rollback
    if (!this.snapshotManager) {
      throw new BackupError(
        'Snapshot manager not configured - cannot perform rollback',
        BackupErrorCode.RESTORE_FAILED
      );
    }

    // Restore snapshot
    await this.snapshotManager.restoreSnapshot(targetDeployment.snapshotId, {
      dryRun: false,
    });

    // Record rollback as new deployment
    await this.recordDeployment({
      themeName: targetDeployment.themeName,
      themeVersion: targetDeployment.themeVersion,
      serial: targetDeployment.serial + 1, // Increment serial
      snapshotId: targetDeployment.snapshotId,
      action: 'rollback',
      message: `Rollback to deployment ${targetDeployment.id}`,
      who: options.who ?? 'system',
    });

    return {
      dryRun: false,
      from: registry.current,
      to: targetDeployment,
    };
  }

  /**
   * Find deployment by ID
   */
  async findDeployment(deploymentId: string): Promise<ThemeDeployment | null> {
    const registry = await this.getRegistry();
    const allDeployments = registry.current
      ? [registry.current, ...registry.history]
      : registry.history;
    return allDeployments.find((d) => d.id === deploymentId) ?? null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Load registry from S3
   */
  private async loadRegistry(): Promise<void> {
    const key = this.getRegistryKey();

    try {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        })
      );

      if (response.Body) {
        const body = await this.streamToString(response.Body as Readable);
        this.registry = JSON.parse(body) as ThemeRegistry;
      } else {
        this.registry = this.createEmptyRegistry();
      }
    } catch (error) {
      // If not found, create empty registry
      if ((error as { name?: string }).name === 'NoSuchKey') {
        this.registry = this.createEmptyRegistry();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save registry to S3
   */
  private async saveRegistry(): Promise<void> {
    if (!this.registry) {
      return;
    }

    const key = this.getRegistryKey();

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: JSON.stringify(this.registry, null, 2),
        ContentType: 'application/json',
        Tagging: `ServerId=${this.config.serverId}`,
      })
    );
  }

  /**
   * Write audit log entry
   */
  private async writeAuditEntry(deployment: ThemeDeployment): Promise<void> {
    const key = `themes/${this.config.serverId}/audit/${deployment.timestamp.replace(/:/g, '-')}.json`;

    const auditEntry = {
      ...deployment,
      serverId: this.config.serverId,
      workspace: this.config.workspace,
    };

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: JSON.stringify(auditEntry, null, 2),
        ContentType: 'application/json',
        Tagging: `ServerId=${this.config.serverId}&Action=${deployment.action}`,
      })
    );
  }

  /**
   * Get S3 key for registry
   */
  private getRegistryKey(): string {
    return `themes/${this.config.serverId}/registry.json`;
  }

  /**
   * Create empty registry
   */
  private createEmptyRegistry(): ThemeRegistry {
    return {
      serverId: this.config.serverId,
      workspace: this.config.workspace,
      current: null,
      history: [],
      lastUpdated: new Date().toISOString(),
      version: '1.0',
    };
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

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Get the configuration
   */
  getConfig(): ThemeRegistryManagerConfig {
    return { ...this.config };
  }

  /**
   * Get current theme registry object
   */
  getCurrentRegistry(): ThemeRegistry | null {
    return this.registry;
  }
}
