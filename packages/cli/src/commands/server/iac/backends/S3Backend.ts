/**
 * S3 State Backend
 *
 * Sprint 96: Remote State Backend - S3Backend Implementation
 *
 * Remote state backend using AWS S3 for storage and DynamoDB for locking.
 * Provides team collaboration with atomic operations and state versioning.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.1.1
 * @module packages/cli/commands/server/iac/backends/S3Backend
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  DeleteItemCommand,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
import { Readable } from 'stream';
import type {
  StateBackend,
  GaibState,
  LockInfo,
  LockResult,
  LockOptions,
  S3BackendConfig,
} from './types.js';
import {
  generateLockId,
  isValidState,
  BackendError,
  StateLockError,
  BackendConfigError,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Lock timeout in milliseconds (10 minutes) */
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

// ============================================================================
// S3Backend Implementation
// ============================================================================

/**
 * AWS S3 remote state backend with DynamoDB locking
 *
 * State is stored in S3 with server-side encryption.
 * DynamoDB provides distributed locking for concurrent access.
 *
 * @example
 * ```typescript
 * const backend = new S3Backend({
 *   type: 's3',
 *   bucket: 'my-gaib-state',
 *   key: 'servers/${workspace}/terraform.tfstate',
 *   region: 'us-east-1',
 *   dynamodb_table: 'gaib-locks',
 *   encrypt: true,
 * });
 *
 * const state = await backend.getState('production');
 * ```
 */
export class S3Backend implements StateBackend {
  readonly type = 's3' as const;
  readonly supportsLocking = true;

  private readonly config: S3BackendConfig;
  private readonly s3Client: S3Client;
  private readonly dynamoClient: DynamoDBClient;

  constructor(config: S3BackendConfig) {
    this.config = config;

    // Validate required config
    if (!config.bucket) {
      throw new BackendConfigError('S3 bucket is required', 's3');
    }
    if (!config.key) {
      throw new BackendConfigError('S3 key pattern is required', 's3');
    }
    if (!config.region) {
      throw new BackendConfigError('AWS region is required', 's3');
    }
    if (!config.dynamodb_table) {
      throw new BackendConfigError('DynamoDB table is required for locking', 's3');
    }

    // Build AWS client config
    const clientConfig: S3ClientConfig & DynamoDBClientConfig = {
      region: config.region,
    };

    // Use custom endpoint if specified (for localstack, etc.)
    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true;
    }

    // Use named profile if specified
    if (config.profile) {
      clientConfig.credentials = fromIni({ profile: config.profile });
    }

    this.s3Client = new S3Client(clientConfig);
    this.dynamoClient = new DynamoDBClient(clientConfig);
  }

  // ============================================================================
  // State Operations
  // ============================================================================

  async getState(workspace: string): Promise<GaibState | null> {
    const key = this.resolveKey(workspace);

    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        return null;
      }

      // Read body as string
      const content = await this.streamToString(response.Body as Readable);
      const state = JSON.parse(content);

      if (!isValidState(state)) {
        throw new BackendError(
          `Invalid state file format at s3://${this.config.bucket}/${key}`,
          'INVALID_STATE',
          's3'
        );
      }

      return state;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return null;
      }
      if ((error as { Code?: string }).Code === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async setState(workspace: string, state: GaibState): Promise<void> {
    const key = this.resolveKey(workspace);

    // Update last modified
    state.lastModified = new Date().toISOString();

    const content = JSON.stringify(state, null, 2);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: content,
      ContentType: 'application/json',
      ServerSideEncryption: this.config.encrypt ? 'aws:kms' : undefined,
      SSEKMSKeyId: this.config.kms_key_id,
    });

    await this.s3Client.send(command);
  }

  async deleteState(workspace: string): Promise<void> {
    const key = this.resolveKey(workspace);

    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });

    await this.s3Client.send(command);
  }

  async listWorkspaces(): Promise<string[]> {
    const prefix = this.getKeyPrefix();
    const workspaces: string[] = [];

    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.config.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken,
      });

      const response = await this.s3Client.send(command);

      // Extract workspace names from common prefixes
      if (response.CommonPrefixes) {
        for (const prefixObj of response.CommonPrefixes) {
          if (prefixObj.Prefix) {
            const workspaceName = this.extractWorkspaceFromPrefix(prefixObj.Prefix);
            if (workspaceName) {
              workspaces.push(workspaceName);
            }
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return workspaces;
  }

  // ============================================================================
  // Locking Operations (DynamoDB)
  // ============================================================================

  async lock(workspace: string, options: LockOptions): Promise<LockResult> {
    const lockKey = this.getLockKey(workspace);
    const now = Date.now();
    const lockId = generateLockId();

    // Check for existing lock first
    const existingLock = await this.getLockInfo(workspace);

    if (existingLock) {
      const lockAge = now - new Date(existingLock.created).getTime();

      if (lockAge < LOCK_TIMEOUT_MS) {
        return {
          acquired: false,
          lockInfo: existingLock,
          error: `State is locked by ${existingLock.who} (operation: ${existingLock.operation})`,
        };
      }

      // Lock is stale, try to acquire with conditional write
    }

    const lockInfo: LockInfo = {
      id: lockId,
      who: options.who,
      operation: options.operation,
      info: options.info,
      created: new Date().toISOString(),
      path: lockKey,
    };

    try {
      // Try to acquire lock with conditional expression
      // This prevents race conditions between checking and acquiring
      const command = new PutItemCommand({
        TableName: this.config.dynamodb_table,
        Item: {
          LockID: { S: lockKey },
          ID: { S: lockId },
          Who: { S: options.who },
          Operation: { S: options.operation },
          Info: { S: options.info ?? '' },
          Created: { S: lockInfo.created },
          TTL: { N: String(Math.floor((now + LOCK_TIMEOUT_MS) / 1000)) },
        },
        // Only succeed if no lock exists OR existing lock is stale
        ConditionExpression:
          'attribute_not_exists(LockID) OR Created < :stale_threshold',
        ExpressionAttributeValues: {
          ':stale_threshold': {
            S: new Date(now - LOCK_TIMEOUT_MS).toISOString(),
          },
        },
      });

      await this.dynamoClient.send(command);

      return {
        acquired: true,
        lockInfo,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        // Someone else acquired the lock
        const currentLock = await this.getLockInfo(workspace);
        return {
          acquired: false,
          lockInfo: currentLock ?? undefined,
          error: 'Lock was acquired by another process',
        };
      }
      throw error;
    }
  }

  async unlock(workspace: string, lockId: string): Promise<boolean> {
    const lockKey = this.getLockKey(workspace);
    const existingLock = await this.getLockInfo(workspace);

    if (!existingLock) {
      return true; // No lock exists
    }

    if (existingLock.id !== lockId) {
      throw new StateLockError(
        `Cannot unlock: lock ID mismatch (expected ${lockId}, got ${existingLock.id})`,
        existingLock,
        's3'
      );
    }

    const command = new DeleteItemCommand({
      TableName: this.config.dynamodb_table,
      Key: {
        LockID: { S: lockKey },
      },
      // Only delete if lock ID matches
      ConditionExpression: 'ID = :lockId',
      ExpressionAttributeValues: {
        ':lockId': { S: lockId },
      },
    });

    try {
      await this.dynamoClient.send(command);
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
        // Lock was modified by someone else
        throw new StateLockError(
          'Cannot unlock: lock was modified by another process',
          existingLock,
          's3'
        );
      }
      throw error;
    }
  }

  async forceUnlock(workspace: string): Promise<boolean> {
    const lockKey = this.getLockKey(workspace);

    const command = new DeleteItemCommand({
      TableName: this.config.dynamodb_table,
      Key: {
        LockID: { S: lockKey },
      },
    });

    try {
      await this.dynamoClient.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async getLockInfo(workspace: string): Promise<LockInfo | null> {
    const lockKey = this.getLockKey(workspace);

    const command = new GetItemCommand({
      TableName: this.config.dynamodb_table,
      Key: {
        LockID: { S: lockKey },
      },
    });

    try {
      const response = await this.dynamoClient.send(command);

      if (!response.Item) {
        return null;
      }

      return {
        id: response.Item.ID?.S ?? '',
        who: response.Item.Who?.S ?? '',
        operation: response.Item.Operation?.S ?? '',
        info: response.Item.Info?.S || undefined,
        created: response.Item.Created?.S ?? new Date().toISOString(),
        path: lockKey,
      };
    } catch {
      return null;
    }
  }

  // ============================================================================
  // Configuration & Lifecycle
  // ============================================================================

  async isConfigured(): Promise<boolean> {
    try {
      // Check S3 bucket access
      const headCommand = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.resolveKey('_config_check'),
      });

      // We expect this to fail with NoSuchKey, but not with access denied
      await this.s3Client.send(headCommand).catch((error) => {
        if ((error as { name?: string }).name === 'NoSuchKey') {
          return; // This is fine
        }
        throw error;
      });

      // Check DynamoDB table access
      const getCommand = new GetItemCommand({
        TableName: this.config.dynamodb_table,
        Key: {
          LockID: { S: '_config_check' },
        },
      });

      await this.dynamoClient.send(getCommand);

      return true;
    } catch (error) {
      const errorName = (error as { name?: string }).name;
      if (
        errorName === 'AccessDeniedException' ||
        errorName === 'NoSuchBucket' ||
        errorName === 'ResourceNotFoundException'
      ) {
        return false;
      }
      // Other errors might be transient, assume configured
      return true;
    }
  }

  async close(): Promise<void> {
    this.s3Client.destroy();
    this.dynamoClient.destroy();
  }

  // ============================================================================
  // Key Management
  // ============================================================================

  /**
   * Resolve the S3 key for a workspace
   */
  private resolveKey(workspace: string): string {
    return this.config.key.replace(/\$\{workspace\}/g, workspace);
  }

  /**
   * Get the prefix before the workspace variable
   */
  private getKeyPrefix(): string {
    const index = this.config.key.indexOf('${workspace}');
    if (index === -1) {
      return this.config.key;
    }
    return this.config.key.substring(0, index);
  }

  /**
   * Extract workspace name from S3 prefix
   */
  private extractWorkspaceFromPrefix(prefix: string): string | null {
    const keyPrefix = this.getKeyPrefix();
    if (!prefix.startsWith(keyPrefix)) {
      return null;
    }

    // Remove prefix and trailing slash
    const remainder = prefix.substring(keyPrefix.length);
    const workspaceName = remainder.replace(/\/$/, '');

    if (!workspaceName) {
      return null;
    }

    return workspaceName;
  }

  /**
   * Get the DynamoDB lock key for a workspace
   */
  private getLockKey(workspace: string): string {
    return `${this.config.bucket}/${this.resolveKey(workspace)}`;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

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
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an S3Backend instance
 */
export function createS3Backend(config: S3BackendConfig): S3Backend {
  return new S3Backend(config);
}

/**
 * Create an S3Backend from environment variables
 */
export function createS3BackendFromEnv(): S3Backend {
  const bucket = process.env.GAIB_S3_BUCKET;
  const region = process.env.GAIB_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const dynamodb_table = process.env.GAIB_DYNAMODB_TABLE ?? 'gaib-locks';
  const key = process.env.GAIB_S3_KEY ?? 'servers/${workspace}/terraform.tfstate';

  if (!bucket) {
    throw new BackendConfigError(
      'GAIB_S3_BUCKET environment variable is required for S3 backend',
      's3'
    );
  }

  return new S3Backend({
    type: 's3',
    bucket,
    key,
    region,
    dynamodb_table,
    encrypt: process.env.GAIB_S3_ENCRYPT !== 'false',
    kms_key_id: process.env.GAIB_KMS_KEY_ID,
    profile: process.env.AWS_PROFILE,
    endpoint: process.env.GAIB_S3_ENDPOINT,
  });
}
