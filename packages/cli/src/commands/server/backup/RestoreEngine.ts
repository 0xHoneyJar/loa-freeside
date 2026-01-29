/**
 * Restore Engine
 *
 * Sprint 167: Restore Engine - Integrity Validation
 *
 * Handles backup restore operations with integrity validation,
 * lineage checking, and state comparison.
 *
 * @see SDD grimoires/loa/sdd.md §15.2
 * @module packages/cli/commands/server/backup/RestoreEngine
 */

import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';
import { Readable } from 'stream';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

import type { GaibState } from '../iac/backends/types.js';
import type { StateBackend } from '../iac/backends/types.js';
import {
  type BackupMetadata,
  type RestoreOptions,
  type RestoreResult,
  BackupError,
  BackupErrorCode,
  IntegrityError,
  LineageError,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Restore validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Validation error
 */
export interface ValidationError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * State comparison result
 */
export interface StateComparison {
  serial: { from: number; to: number };
  resourceCount: { from: number; to: number };
  resources: {
    added: ResourceChange[];
    removed: ResourceChange[];
    modified: ResourceChange[];
  };
}

/**
 * Resource change detail
 */
export interface ResourceChange {
  type: string;
  name: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

/**
 * RestoreEngine configuration
 */
export interface RestoreEngineConfig {
  /** S3 client for fetching backups */
  s3Client: S3Client;
  /** State backend for reading/writing state */
  backend: StateBackend;
  /** Current workspace */
  workspace: string;
  /** Skip lineage validation (dangerous) */
  skipLineageCheck?: boolean;
}

// ============================================================================
// RestoreEngine Implementation
// ============================================================================

/**
 * Handles backup restore operations with integrity validation
 *
 * @example
 * ```typescript
 * const engine = new RestoreEngine({
 *   s3Client,
 *   backend,
 *   workspace: 'default',
 * });
 *
 * // Validate before restore
 * const validation = await engine.validate(backup, compressedData);
 *
 * // Preview changes
 * const comparison = await engine.compare(backup, compressedData);
 *
 * // Perform restore
 * const result = await engine.restore(backup, { dryRun: false });
 * ```
 */
export class RestoreEngine {
  private readonly s3Client: S3Client;
  private readonly backend: StateBackend;
  private readonly workspace: string;
  private readonly skipLineageCheck: boolean;

  constructor(config: RestoreEngineConfig) {
    this.s3Client = config.s3Client;
    this.backend = config.backend;
    this.workspace = config.workspace;
    this.skipLineageCheck = config.skipLineageCheck ?? false;
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Validate a backup before restore
   */
  async validate(
    backup: BackupMetadata,
    compressedData: Buffer
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Verify checksum
    const actualChecksum = createHash('sha256').update(compressedData).digest('hex');
    if (actualChecksum !== backup.checksum) {
      errors.push({
        code: 'CHECKSUM_MISMATCH',
        message: 'Backup data checksum does not match stored checksum',
        details: {
          expected: backup.checksum,
          actual: actualChecksum,
        },
      });
    }

    // 2. Try to decompress
    let state: GaibState;
    try {
      const decompressed = gunzipSync(compressedData);
      state = JSON.parse(decompressed.toString()) as GaibState;
    } catch (error) {
      errors.push({
        code: 'DECOMPRESS_FAILED',
        message: 'Failed to decompress backup data',
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return { valid: false, errors, warnings };
    }

    // 3. Validate lineage
    if (!this.skipLineageCheck) {
      const currentState = await this.backend.getState(this.workspace);
      if (currentState && currentState.lineage !== state.lineage) {
        errors.push({
          code: 'LINEAGE_MISMATCH',
          message: 'Backup lineage does not match current workspace',
          details: {
            backupLineage: state.lineage,
            currentLineage: currentState.lineage,
          },
        });
      }
    }

    // 4. Check state version compatibility
    if (state.version > 1) {
      warnings.push({
        code: 'NEWER_VERSION',
        message: `Backup uses state version ${state.version}, which may have newer features`,
      });
    }

    // 5. Check for missing workspace
    if (backup.workspace !== this.workspace) {
      warnings.push({
        code: 'WORKSPACE_MISMATCH',
        message: `Backup is from workspace "${backup.workspace}", restoring to "${this.workspace}"`,
      });
    }

    // 6. Check serial regression
    const currentState = await this.backend.getState(this.workspace);
    if (currentState && state.serial < currentState.serial) {
      warnings.push({
        code: 'SERIAL_REGRESSION',
        message: `Restoring to an older state (serial ${state.serial} < ${currentState.serial})`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Compare backup state with current state
   */
  async compare(
    backup: BackupMetadata,
    compressedData: Buffer
  ): Promise<StateComparison> {
    // Decompress backup state
    const decompressed = gunzipSync(compressedData);
    const backupState = JSON.parse(decompressed.toString()) as GaibState;

    // Get current state
    const currentState = await this.backend.getState(this.workspace);

    // Calculate changes
    const currentResources = currentState?.resources ?? [];
    const backupResources = backupState.resources ?? [];

    const currentMap = new Map(
      currentResources.map((r) => [`${r.type}.${r.name}`, r])
    );
    const backupMap = new Map(
      backupResources.map((r) => [`${r.type}.${r.name}`, r])
    );

    const added: ResourceChange[] = [];
    const removed: ResourceChange[] = [];
    const modified: ResourceChange[] = [];

    // Find removed (in current but not in backup)
    for (const [key, resource] of currentMap) {
      if (!backupMap.has(key)) {
        removed.push({
          type: resource.type,
          name: resource.name,
        });
      }
    }

    // Find added and modified
    for (const [key, backupResource] of backupMap) {
      const currentResource = currentMap.get(key);
      if (!currentResource) {
        added.push({
          type: backupResource.type,
          name: backupResource.name,
        });
      } else {
        // Check for modifications
        const changes = this.compareResources(currentResource, backupResource);
        if (Object.keys(changes).length > 0) {
          modified.push({
            type: backupResource.type,
            name: backupResource.name,
            changes,
          });
        }
      }
    }

    return {
      serial: {
        from: currentState?.serial ?? 0,
        to: backupState.serial,
      },
      resourceCount: {
        from: currentResources.length,
        to: backupResources.length,
      },
      resources: {
        added,
        removed,
        modified,
      },
    };
  }

  /**
   * Restore from a backup
   */
  async restore(
    backup: BackupMetadata,
    options: RestoreOptions = {}
  ): Promise<RestoreResult> {
    // 1. Download from S3
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: backup.s3Bucket,
        Key: backup.s3Key,
      })
    );

    if (!response.Body) {
      throw new BackupError(
        `Backup file empty: ${backup.id}`,
        BackupErrorCode.NOT_FOUND
      );
    }

    const compressed = await this.streamToBuffer(response.Body as Readable);

    // 2. Validate
    const validation = await this.validate(backup, compressed);
    if (!validation.valid) {
      const checksumError = validation.errors.find(
        (e) => e.code === 'CHECKSUM_MISMATCH'
      );
      if (checksumError) {
        throw new IntegrityError(
          'Backup checksum mismatch - data may be corrupted',
          checksumError.details?.expected as string,
          checksumError.details?.actual as string
        );
      }

      const lineageError = validation.errors.find(
        (e) => e.code === 'LINEAGE_MISMATCH'
      );
      if (lineageError) {
        throw new LineageError(
          lineageError.details?.backupLineage as string,
          lineageError.details?.currentLineage as string
        );
      }

      throw new BackupError(
        `Validation failed: ${validation.errors.map((e) => e.message).join(', ')}`,
        BackupErrorCode.RESTORE_FAILED
      );
    }

    // 3. Decompress
    const decompressed = gunzipSync(compressed);
    const state = JSON.parse(decompressed.toString()) as GaibState;

    // 4. Get comparison
    const comparison = await this.compare(backup, compressed);

    // 5. Handle dry run
    if (options.dryRun) {
      return {
        dryRun: true,
        backup,
        state,
        changes: {
          serial: comparison.serial,
          resourceCount: comparison.resourceCount,
        },
      };
    }

    // 6. Get current state for serial increment
    const currentState = await this.backend.getState(this.workspace);

    // 7. Increment serial and update timestamp
    state.serial = (currentState?.serial ?? 0) + 1;
    state.lastModified = new Date().toISOString();

    // 8. Write restored state
    await this.backend.setState(this.workspace, state);

    return {
      dryRun: false,
      backup,
      state,
      changes: {
        serial: comparison.serial,
        resourceCount: comparison.resourceCount,
      },
    };
  }

  /**
   * Download and validate backup data
   */
  async download(backup: BackupMetadata): Promise<{
    compressed: Buffer;
    state: GaibState;
    validation: ValidationResult;
  }> {
    // Download from S3
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: backup.s3Bucket,
        Key: backup.s3Key,
      })
    );

    if (!response.Body) {
      throw new BackupError(
        `Backup file empty: ${backup.id}`,
        BackupErrorCode.NOT_FOUND
      );
    }

    const compressed = await this.streamToBuffer(response.Body as Readable);

    // Decompress
    const decompressed = gunzipSync(compressed);
    const state = JSON.parse(decompressed.toString()) as GaibState;

    // Validate
    const validation = await this.validate(backup, compressed);

    return { compressed, state, validation };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Compare two resources and return changes
   */
  private compareResources(
    current: { type: string; name: string; instances?: unknown[] },
    backup: { type: string; name: string; instances?: unknown[] }
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    // Compare instances
    const currentInstance = current.instances?.[0] as
      | { attributes?: Record<string, unknown> }
      | undefined;
    const backupInstance = backup.instances?.[0] as
      | { attributes?: Record<string, unknown> }
      | undefined;

    if (!currentInstance?.attributes || !backupInstance?.attributes) {
      return changes;
    }

    const allKeys = new Set([
      ...Object.keys(currentInstance.attributes),
      ...Object.keys(backupInstance.attributes),
    ]);

    for (const key of allKeys) {
      const currentValue = currentInstance.attributes[key];
      const backupValue = backupInstance.attributes[key];

      if (JSON.stringify(currentValue) !== JSON.stringify(backupValue)) {
        changes[key] = { from: currentValue, to: backupValue };
      }
    }

    return changes;
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
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a RestoreEngine from S3 and backend instances
 */
export function createRestoreEngine(
  s3Client: S3Client,
  backend: StateBackend,
  workspace: string,
  options: { skipLineageCheck?: boolean } = {}
): RestoreEngine {
  return new RestoreEngine({
    s3Client,
    backend,
    workspace,
    skipLineageCheck: options.skipLineageCheck,
  });
}
