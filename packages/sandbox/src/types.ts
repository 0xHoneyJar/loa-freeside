/**
 * Sandbox Types - TypeScript type definitions
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * @see SDD §5.2 Type Definitions
 * @module packages/sandbox/types
 */

// =============================================================================
// Sandbox Status
// =============================================================================

/**
 * Sandbox lifecycle status values
 *
 * State transitions:
 * - pending → creating → running → destroying → destroyed
 * - running → expired → destroying → destroyed (TTL expiry)
 */
export type SandboxStatus =
  | 'pending'
  | 'creating'
  | 'running'
  | 'expired'
  | 'destroying'
  | 'destroyed';

/**
 * Valid status transitions
 */
export const VALID_STATUS_TRANSITIONS: Record<SandboxStatus, SandboxStatus[]> = {
  pending: ['creating'],
  creating: ['running', 'destroying'], // Can fail during creation
  running: ['expired', 'destroying'],
  expired: ['destroying'],
  destroying: ['destroyed'],
  destroyed: [], // Terminal state
};

// =============================================================================
// Sandbox Metadata
// =============================================================================

/**
 * Sandbox metadata stored in JSONB column
 */
export interface SandboxMetadata {
  /** Human-readable description */
  description?: string;
  /** Tags for filtering/organization */
  tags?: string[];
  /** Username of creator */
  createdBy?: string;
  /** Creation source */
  createdFrom?: 'cli' | 'api';
  /** Original TTL in hours */
  ttlHours?: number;
}

// =============================================================================
// Sandbox Creation
// =============================================================================

/**
 * Options for creating a new sandbox
 */
export interface CreateSandboxOptions {
  /**
   * Sandbox name. Auto-generated if not provided.
   * Format: sandbox-{owner}-{nanoid(6)}
   */
  name?: string;

  /** Developer username who owns the sandbox */
  owner: string;

  /**
   * Time-to-live in hours.
   * @default 24
   */
  ttlHours?: number;

  /**
   * Discord guild IDs to register immediately.
   * These guilds will route events to this sandbox.
   */
  guildIds?: string[];

  /** Additional metadata */
  metadata?: SandboxMetadata;
}

// =============================================================================
// Sandbox Entity
// =============================================================================

/**
 * Sandbox entity returned from queries
 */
export interface Sandbox {
  /** UUID primary key */
  id: string;

  /** Human-readable name (unique) */
  name: string;

  /** Developer username who owns the sandbox */
  owner: string;

  /** Current lifecycle status */
  status: SandboxStatus;

  /** PostgreSQL schema name (sandbox_{short_id}) */
  schemaName: string;

  /** Discord token ID (null = shared token) */
  discordTokenId: string | null;

  /** When the sandbox was created */
  createdAt: Date;

  /** When the sandbox will expire (TTL) */
  expiresAt: Date;

  /** When the sandbox was destroyed (null if not destroyed) */
  destroyedAt: Date | null;

  /** Last activity timestamp */
  lastActivityAt: Date | null;

  /** Additional metadata */
  metadata: SandboxMetadata;

  /** Registered guild IDs (populated from mapping table) */
  guildIds: string[];
}

// =============================================================================
// Sandbox Health
// =============================================================================

/**
 * Health check result for a sandbox
 */
export interface SandboxHealthCheck {
  /** Schema status */
  schema: 'ok' | 'missing' | 'error';
  /** Redis accessibility */
  redis: 'ok' | 'error';
  /** Routing status */
  routing: 'ok' | 'no_guilds' | 'error';
}

/**
 * Overall health status
 */
export type HealthLevel = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Sandbox health status response
 */
export interface SandboxHealthStatus {
  /** Sandbox ID */
  sandboxId: string;

  /** Current status */
  status: SandboxStatus;

  /** Overall health level */
  health: HealthLevel;

  /** Individual check results */
  checks: SandboxHealthCheck;

  /** Last activity timestamp */
  lastActivity: Date | null;

  /** Human-readable time until expiry (e.g., "2 hours") */
  expiresIn: string;
}

// =============================================================================
// Sandbox Connection Details
// =============================================================================

/**
 * Connection details for workers to use a sandbox
 */
export interface SandboxConnectionDetails {
  /** Sandbox ID */
  sandboxId: string;

  /** PostgreSQL schema name */
  schemaName: string;

  /** Redis key prefix (sandbox:{id}:) */
  redisPrefix: string;

  /** NATS subject prefix (sandbox.{id}.) */
  natsPrefix: string;

  /** Registered guild IDs */
  guildIds: string[];

  /** Ready-to-export environment variables */
  env: Record<string, string>;
}

// =============================================================================
// Sandbox Filtering
// =============================================================================

/**
 * Filter options for list queries
 */
export interface SandboxFilter {
  /** Filter by owner username */
  owner?: string;

  /** Filter by status (single or multiple) */
  status?: SandboxStatus | SandboxStatus[];

  /** Include destroyed sandboxes */
  includeDestroyed?: boolean;
}

// =============================================================================
// Audit Events
// =============================================================================

/**
 * Audit event types
 */
export type AuditEventType =
  | 'sandbox_created'
  | 'sandbox_destroying'
  | 'sandbox_destroyed'
  | 'guild_registered'
  | 'guild_unregistered'
  | 'ttl_extended'
  | 'status_changed';

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  /** UUID primary key */
  id: string;

  /** Associated sandbox ID */
  sandboxId: string;

  /** Event type */
  eventType: AuditEventType;

  /** Actor (username or 'system') */
  actor: string;

  /** Additional event details */
  details: Record<string, unknown>;

  /** When the event occurred */
  createdAt: Date;
}

// =============================================================================
// Schema Statistics
// =============================================================================

/**
 * Statistics for a sandbox schema
 */
export interface SchemaStats {
  /** Whether the schema exists */
  exists: boolean;

  /** Table statistics (name → row count) */
  tables: Record<string, number>;

  /** Total row count across all tables */
  totalRows: number;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Sandbox error codes
 */
export enum SandboxErrorCode {
  /** Sandbox name already exists */
  NAME_EXISTS = 'SANDBOX_001',
  /** Max sandboxes per developer exceeded */
  MAX_EXCEEDED = 'SANDBOX_002',
  /** Guild already mapped to another sandbox */
  GUILD_MAPPED = 'SANDBOX_003',
  /** Sandbox not found */
  NOT_FOUND = 'SANDBOX_004',
  /** Schema creation failed */
  SCHEMA_FAILED = 'SANDBOX_005',
  /** Cleanup failed */
  CLEANUP_FAILED = 'SANDBOX_006',
  /** Invalid status transition */
  INVALID_TRANSITION = 'SANDBOX_007',
}

/**
 * Sandbox-specific error
 */
export class SandboxError extends Error {
  constructor(
    public readonly code: SandboxErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
