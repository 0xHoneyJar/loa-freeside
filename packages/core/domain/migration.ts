/**
 * Migration Domain Types
 *
 * Sprint S-28: Migration Strategies & Rollback
 *
 * Defines the core domain types for migration engine,
 * including strategies, rollback, health monitoring, and audit trail.
 *
 * @see SDD §7.3 Migration Engine
 */

// =============================================================================
// Migration Strategy Types
// =============================================================================

/**
 * Available migration strategies.
 *
 * @see SDD §7.3.1
 */
export type MigrationStrategy =
  | 'instant'           // Immediate full migration
  | 'gradual'           // Progressive migration over N days
  | 'parallel_forever'  // Keep both systems indefinitely
  | 'arrakis_primary';  // Arrakis primary, incumbent backup

/**
 * Migration status states.
 */
export type MigrationStatus =
  | 'pending'           // Migration configured but not started
  | 'in_progress'       // Migration actively executing
  | 'in_progress_gradual' // Gradual migration in progress
  | 'completed'         // Migration completed successfully
  | 'rolled_back'       // Migration was rolled back
  | 'paused'            // Migration paused (manual or auto)
  | 'failed';           // Migration failed

/**
 * Rollback trigger type.
 */
export type RollbackTrigger =
  | 'manual'            // Admin initiated rollback
  | 'access_loss'       // Auto-triggered by access loss
  | 'error_rate'        // Auto-triggered by high error rate
  | 'incumbent_failure' // Auto-triggered by incumbent health
  | 'api_failure';      // Auto-triggered by API failures

// =============================================================================
// Migration Configuration Types
// =============================================================================

/**
 * Rollback threshold configuration.
 */
export interface RollbackThresholds {
  /** Maximum % of members losing access before auto-rollback */
  accessLossPercent: number;
  /** Time window for access loss monitoring (minutes) */
  accessLossWindowMinutes: number;
  /** Maximum error rate before auto-rollback */
  errorRatePercent: number;
  /** Time window for error rate monitoring (minutes) */
  errorRateWindowMinutes: number;
}

/**
 * Migration configuration.
 */
export interface MigrationConfig {
  /** Selected migration strategy */
  strategy: MigrationStrategy;
  /** Days for gradual migration (required for 'gradual' strategy) */
  gradualDays?: number;
  /** Members per batch for gradual migration */
  batchSize?: number;
  /** Rollback threshold configuration */
  rollbackThresholds: RollbackThresholds;
  /** Whether to preserve incumbent roles after migration */
  preserveIncumbentRoles?: boolean;
  /** Notification channel for migration updates */
  notificationChannelId?: string;
  /** Admins to notify on migration events */
  adminUserIds?: string[];
}

/**
 * Migration state persisted in storage.
 */
export interface MigrationState {
  /** Unique migration ID */
  migrationId: string;
  /** Community ID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Migration configuration */
  config: MigrationConfig;
  /** Current status */
  status: MigrationStatus;
  /** When migration started */
  startedAt: Date;
  /** When migration completed (if applicable) */
  completedAt: Date | null;
  /** Current progress (0-100) */
  progressPercent: number;
  /** Number of members migrated */
  membersMigrated: number;
  /** Total members to migrate */
  totalMembers: number;
  /** Last error message (if failed) */
  lastError: string | null;
  /** For gradual: current batch number */
  currentBatch?: number;
  /** For gradual: total batches */
  totalBatches?: number;
}

// =============================================================================
// Migration Readiness Types
// =============================================================================

/**
 * Individual readiness check result.
 */
export interface ReadinessCheck {
  /** Check name */
  name: string;
  /** Current value */
  current: number;
  /** Required value */
  required: number;
  /** Whether check passed */
  passed: boolean;
  /** Human-readable message */
  message: string;
}

/**
 * Migration readiness result.
 */
export interface MigrationReadiness {
  /** Overall readiness */
  ready: boolean;
  /** Individual check results */
  checks: ReadinessCheck[];
  /** Blocker messages (if not ready) */
  blockers: string[];
  /** Warning messages (ready but cautioned) */
  warnings: string[];
  /** Estimated days until ready (if not ready) */
  estimatedDaysUntilReady: number | null;
  /** Recommended strategy based on accuracy */
  recommendedStrategy: MigrationStrategy | null;
}

// =============================================================================
// Rollback Types
// =============================================================================

/**
 * Rollback request.
 */
export interface RollbackRequest {
  /** Migration ID to rollback */
  migrationId: string;
  /** Reason for rollback */
  reason: string;
  /** Trigger type */
  trigger: RollbackTrigger;
  /** User who requested (for manual rollback) */
  requestedBy?: string;
}

/**
 * Rollback result.
 */
export interface RollbackResult {
  /** Migration ID */
  migrationId: string;
  /** Whether rollback succeeded */
  success: boolean;
  /** Members affected */
  membersAffected: number;
  /** Roles restored */
  rolesRestored: number;
  /** Rollback timestamp */
  rolledBackAt: Date;
  /** Error message if failed */
  error?: string;
}

/**
 * Pre-migration snapshot for rollback.
 */
export interface PreMigrationSnapshot {
  /** Migration ID */
  migrationId: string;
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Snapshot timestamp */
  snapshotAt: Date;
  /** Member role states */
  members: MemberRoleSnapshot[];
}

/**
 * Individual member role snapshot.
 */
export interface MemberRoleSnapshot {
  /** User ID */
  userId: string;
  /** Incumbent roles before migration */
  incumbentRoles: string[];
  /** Arrakis roles (if any) before migration */
  arrakisRoles: string[];
}

// =============================================================================
// Incumbent Health Types
// =============================================================================

/**
 * Incumbent health status.
 */
export type IncumbentHealthStatus = 'healthy' | 'warning' | 'critical' | 'dead';

/**
 * Incumbent health check result.
 */
export interface IncumbentHealthCheck {
  /** Health status */
  status: IncumbentHealthStatus;
  /** Is bot present in guild? */
  botPresent: boolean;
  /** Hours since last role update */
  hoursSinceLastRoleUpdate: number;
  /** Role freshness threshold (hours) */
  roleFreshnessThresholdHours: number;
  /** Any errors during check */
  errors: string[];
  /** Checked at timestamp */
  checkedAt: Date;
}

/**
 * Incumbent health thresholds.
 */
export interface IncumbentHealthThresholds {
  /** Hours without update before warning (default: 48) */
  warningHours: number;
  /** Hours without update before critical (default: 72) */
  criticalHours: number;
  /** Hours without update before considered dead (default: 168 = 7 days) */
  deadHours: number;
}

// =============================================================================
// Backup Activation Types
// =============================================================================

/**
 * Backup activation request.
 */
export interface BackupActivationRequest {
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** User ID requesting activation */
  requestedBy: string;
  /** Reason for activation */
  reason: string;
}

/**
 * Backup activation result.
 */
export interface BackupActivationResult {
  /** Whether activation succeeded */
  success: boolean;
  /** Activation ID for tracking */
  activationId: string;
  /** Members covered by backup */
  membersCovered: number;
  /** Activation timestamp */
  activatedAt: Date;
  /** Error if failed */
  error?: string;
}

// =============================================================================
// Audit Trail Types
// =============================================================================

/**
 * Migration audit event types.
 */
export type MigrationAuditEventType =
  | 'migration_started'
  | 'migration_completed'
  | 'migration_failed'
  | 'migration_paused'
  | 'migration_resumed'
  | 'batch_started'
  | 'batch_completed'
  | 'rollback_started'
  | 'rollback_completed'
  | 'rollback_failed'
  | 'health_check'
  | 'backup_activated'
  | 'backup_deactivated'
  | 'threshold_triggered'
  | 'config_updated';

/**
 * Migration audit event.
 */
export interface MigrationAuditEvent {
  /** Unique event ID */
  eventId: string;
  /** Community ID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Migration ID (if applicable) */
  migrationId: string | null;
  /** Event type */
  eventType: MigrationAuditEventType;
  /** Event timestamp */
  timestamp: Date;
  /** Actor (user or system) */
  actor: string;
  /** Event details (JSON) */
  details: Record<string, unknown>;
  /** Severity level */
  severity: 'info' | 'warning' | 'error' | 'critical';
}

/**
 * Audit query options.
 */
export interface AuditQueryOptions {
  /** Filter by community ID */
  communityId?: string;
  /** Filter by migration ID */
  migrationId?: string;
  /** Filter by event type */
  eventType?: MigrationAuditEventType;
  /** Filter by date range (start) */
  fromDate?: Date;
  /** Filter by date range (end) */
  toDate?: Date;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Default rollback thresholds per SDD §7.3.
 */
export const DEFAULT_ROLLBACK_THRESHOLDS: RollbackThresholds = {
  accessLossPercent: 5,           // >5% access loss
  accessLossWindowMinutes: 60,    // in 1 hour
  errorRatePercent: 10,           // >10% error rate
  errorRateWindowMinutes: 15,     // in 15 minutes
};

/**
 * Default incumbent health thresholds.
 */
export const DEFAULT_INCUMBENT_HEALTH_THRESHOLDS: IncumbentHealthThresholds = {
  warningHours: 48,   // 2 days
  criticalHours: 72,  // 3 days
  deadHours: 168,     // 7 days
};

/**
 * Default gradual migration days.
 */
export const DEFAULT_GRADUAL_MIGRATION_DAYS = 14;

/**
 * Default batch size for gradual migration.
 */
export const DEFAULT_MIGRATION_BATCH_SIZE = 100;

/**
 * Minimum shadow days required for migration.
 */
export const MIN_SHADOW_DAYS_FOR_MIGRATION = 14;

/**
 * Minimum accuracy required for migration.
 */
export const MIN_ACCURACY_FOR_MIGRATION = 0.95;

/**
 * Maximum divergence rate allowed for migration.
 */
export const MAX_DIVERGENCE_RATE_FOR_MIGRATION = 0.05;
