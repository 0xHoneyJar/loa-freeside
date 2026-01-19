/**
 * State Backend Types
 *
 * Sprint 96: Remote State Backend - Pluggable Backend Interfaces
 *
 * Defines the core interfaces for state backends, enabling both local
 * and remote (S3) state storage with locking support.
 *
 * @see SDD grimoires/loa/gaib-sdd.md §3.1
 * @module packages/cli/commands/server/iac/backends/types
 */

// ============================================================================
// State Types
// ============================================================================

/**
 * Gaib state file structure
 * Follows Terraform state conventions for familiarity
 */
export interface GaibState {
  /** State format version */
  version: number;
  /** Monotonically increasing counter for optimistic locking */
  serial: number;
  /** Unique identifier for state lineage (prevents cross-workspace pollution) */
  lineage: string;
  /** Workspace name this state belongs to */
  workspace: string;
  /** Managed Discord resources */
  resources: StateResource[];
  /** Output values from configuration */
  outputs: Record<string, StateOutput>;
  /** Timestamp of last modification */
  lastModified: string;
}

/**
 * Resource in state file
 */
export interface StateResource {
  /** Resource type (e.g., "discord_role", "discord_channel") */
  type: string;
  /** Resource name from configuration */
  name: string;
  /** Provider identifier */
  provider: string;
  /** Resource instances */
  instances: StateResourceInstance[];
}

/**
 * Resource instance data
 */
export interface StateResourceInstance {
  /** Schema version for migration support */
  schema_version: number;
  /** Resource attributes */
  attributes: Record<string, unknown>;
  /** Dependencies on other resources */
  dependencies?: string[];
}

/**
 * Output value in state
 */
export interface StateOutput {
  /** Output value */
  value: unknown;
  /** Whether this value is sensitive */
  sensitive: boolean;
}

// ============================================================================
// Lock Types
// ============================================================================

/**
 * Lock information for state operations
 */
export interface LockInfo {
  /** Unique lock ID */
  id: string;
  /** Who holds the lock */
  who: string;
  /** Operation being performed */
  operation: string;
  /** Additional info about the lock holder */
  info?: string;
  /** When the lock was acquired (ISO 8601) */
  created: string;
  /** Lock path/key */
  path: string;
}

/**
 * Result of a lock operation
 */
export interface LockResult {
  /** Whether the lock was acquired */
  acquired: boolean;
  /** Lock information if acquired, or existing lock info if held by another */
  lockInfo?: LockInfo;
  /** Error message if lock failed */
  error?: string;
}

// ============================================================================
// Backend Interface
// ============================================================================

/**
 * State backend interface
 *
 * All backends must implement this interface for:
 * - Reading and writing state
 * - Acquiring and releasing locks (optional for local backend)
 * - State versioning and integrity checks
 *
 * @example
 * ```typescript
 * const backend = await BackendFactory.create(config);
 *
 * // Read state
 * const state = await backend.getState('production');
 *
 * // Lock before write
 * const lock = await backend.lock('production', {
 *   who: 'user@example.com',
 *   operation: 'apply',
 * });
 *
 * if (lock.acquired) {
 *   // Perform changes
 *   await backend.setState('production', newState);
 *   await backend.unlock('production', lock.lockInfo!.id);
 * }
 * ```
 */
export interface StateBackend {
  /**
   * Backend type identifier
   */
  readonly type: BackendType;

  /**
   * Whether this backend supports locking
   */
  readonly supportsLocking: boolean;

  /**
   * Get state for a workspace
   *
   * @param workspace - Workspace name
   * @returns State object or null if no state exists
   */
  getState(workspace: string): Promise<GaibState | null>;

  /**
   * Set state for a workspace
   *
   * @param workspace - Workspace name
   * @param state - State to persist
   */
  setState(workspace: string, state: GaibState): Promise<void>;

  /**
   * Delete state for a workspace
   *
   * @param workspace - Workspace name
   */
  deleteState(workspace: string): Promise<void>;

  /**
   * List all workspaces with state
   *
   * @returns Array of workspace names
   */
  listWorkspaces(): Promise<string[]>;

  /**
   * Acquire a lock for a workspace
   *
   * @param workspace - Workspace name
   * @param options - Lock options
   * @returns Lock result
   */
  lock(workspace: string, options: LockOptions): Promise<LockResult>;

  /**
   * Release a lock for a workspace
   *
   * @param workspace - Workspace name
   * @param lockId - Lock ID to release
   * @returns Whether the unlock succeeded
   */
  unlock(workspace: string, lockId: string): Promise<boolean>;

  /**
   * Force unlock (admin operation)
   *
   * @param workspace - Workspace name
   * @returns Whether the force unlock succeeded
   */
  forceUnlock(workspace: string): Promise<boolean>;

  /**
   * Get current lock info for a workspace
   *
   * @param workspace - Workspace name
   * @returns Lock info or null if not locked
   */
  getLockInfo(workspace: string): Promise<LockInfo | null>;

  /**
   * Check if backend is properly configured
   *
   * @returns Whether backend is ready
   */
  isConfigured(): Promise<boolean>;

  /**
   * Close backend connections/cleanup
   */
  close(): Promise<void>;
}

/**
 * Options for acquiring a lock
 */
export interface LockOptions {
  /** Who is requesting the lock */
  who: string;
  /** What operation is being performed */
  operation: string;
  /** Additional context */
  info?: string;
  /** Timeout in milliseconds (0 = no wait, just fail if locked) */
  timeout?: number;
}

// ============================================================================
// Backend Types
// ============================================================================

/**
 * Supported backend types
 */
export type BackendType = 'local' | 's3';

/**
 * Backend configuration base
 */
export interface BackendConfigBase {
  /** Backend type */
  type: BackendType;
}

/**
 * Local backend configuration
 */
export interface LocalBackendConfig extends BackendConfigBase {
  type: 'local';
  /** Path to state directory (default: .gaib/) */
  path?: string;
}

/**
 * S3 backend configuration
 */
export interface S3BackendConfig extends BackendConfigBase {
  type: 's3';
  /** S3 bucket name */
  bucket: string;
  /** Key prefix (supports ${workspace} variable) */
  key: string;
  /** AWS region */
  region: string;
  /** DynamoDB table for locking */
  dynamodb_table: string;
  /** Encryption method */
  encrypt?: boolean;
  /** KMS key ID for encryption */
  kms_key_id?: string;
  /** AWS profile to use */
  profile?: string;
  /** Endpoint override (for localstack, etc.) */
  endpoint?: string;
}

/**
 * Union of all backend configurations
 */
export type BackendConfig = LocalBackendConfig | S3BackendConfig;

// ============================================================================
// State Factory Types
// ============================================================================

/**
 * Options for creating an empty state
 */
export interface CreateStateOptions {
  /** Workspace name */
  workspace: string;
  /** Optional lineage (will be generated if not provided) */
  lineage?: string;
}

/**
 * Create an empty state object
 */
export function createEmptyState(options: CreateStateOptions): GaibState {
  return {
    version: 1,
    serial: 0,
    lineage: options.lineage ?? generateLineage(),
    workspace: options.workspace,
    resources: [],
    outputs: {},
    lastModified: new Date().toISOString(),
  };
}

/**
 * Generate a unique lineage identifier
 */
export function generateLineage(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Generate a unique lock ID
 */
export function generateLockId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `lock-${timestamp}-${random}`;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate state object structure
 */
export function isValidState(obj: unknown): obj is GaibState {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const state = obj as Partial<GaibState>;
  return (
    typeof state.version === 'number' &&
    typeof state.serial === 'number' &&
    typeof state.lineage === 'string' &&
    typeof state.workspace === 'string' &&
    Array.isArray(state.resources) &&
    typeof state.outputs === 'object' &&
    state.outputs !== null
  );
}

/**
 * Validate backend configuration
 */
export function isValidBackendConfig(obj: unknown): obj is BackendConfig {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const config = obj as Partial<BackendConfig>;

  if (config.type === 'local') {
    return true;
  }

  if (config.type === 's3') {
    const s3Config = config as Partial<S3BackendConfig>;
    return (
      typeof s3Config.bucket === 'string' &&
      typeof s3Config.key === 'string' &&
      typeof s3Config.region === 'string' &&
      typeof s3Config.dynamodb_table === 'string'
    );
  }

  return false;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error for backend operations
 */
export class BackendError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly backend: BackendType
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/**
 * Error when state is locked by another operation
 */
export class StateLockError extends BackendError {
  constructor(
    message: string,
    public readonly lockInfo: LockInfo,
    backend: BackendType
  ) {
    super(message, 'STATE_LOCKED', backend);
    this.name = 'StateLockError';
  }
}

/**
 * Error when state lineage doesn't match
 */
export class StateLineageError extends BackendError {
  constructor(
    expected: string,
    actual: string,
    backend: BackendType
  ) {
    super(
      `State lineage mismatch: expected "${expected}", got "${actual}". ` +
        'This may indicate state corruption or workspace collision.',
      'LINEAGE_MISMATCH',
      backend
    );
    this.name = 'StateLineageError';
  }
}

/**
 * Error when state serial is outdated
 */
export class StateSerialError extends BackendError {
  constructor(
    expected: number,
    actual: number,
    backend: BackendType
  ) {
    super(
      `State serial mismatch: expected ${expected}, got ${actual}. ` +
        'State was modified by another operation.',
      'SERIAL_MISMATCH',
      backend
    );
    this.name = 'StateSerialError';
  }
}

/**
 * Error when backend is not configured correctly
 */
export class BackendConfigError extends BackendError {
  constructor(
    message: string,
    backend: BackendType
  ) {
    super(message, 'CONFIG_ERROR', backend);
    this.name = 'BackendConfigError';
  }
}
