/**
 * Migration Port Interfaces
 *
 * Sprint S-28: Migration Strategies & Rollback
 *
 * Defines the contract interfaces for the migration engine and related services.
 *
 * @see SDD §7.3 Migration Engine
 */

import type {
  MigrationStrategy,
  MigrationConfig,
  MigrationState,
  MigrationReadiness,
  RollbackRequest,
  RollbackResult,
  PreMigrationSnapshot,
  IncumbentHealthCheck,
  IncumbentHealthThresholds,
  BackupActivationRequest,
  BackupActivationResult,
  MigrationAuditEvent,
  AuditQueryOptions,
  MemberRoleSnapshot,
} from '../domain/migration.js';

// =============================================================================
// Migration Engine Interface
// =============================================================================

/**
 * IMigrationEngine defines the contract for migration operations.
 *
 * @see SDD §7.3.2
 */
export interface IMigrationEngine {
  // ===========================================================================
  // Readiness & Status
  // ===========================================================================

  /**
   * Check if community is ready for migration.
   * Validates shadow days, accuracy, and divergence thresholds.
   *
   * @param communityId - Community to check
   * @returns Migration readiness result with detailed checks
   */
  checkReadiness(communityId: string): Promise<MigrationReadiness>;

  /**
   * Get current migration state for a community.
   *
   * @param communityId - Community ID
   * @returns Current migration state or null if no migration
   */
  getMigrationState(communityId: string): Promise<MigrationState | null>;

  /**
   * Get recommended migration strategy based on shadow accuracy.
   *
   * @param communityId - Community ID
   * @returns Recommended strategy or null if not ready
   */
  getRecommendedStrategy(communityId: string): Promise<MigrationStrategy | null>;

  // ===========================================================================
  // Migration Lifecycle
  // ===========================================================================

  /**
   * Start migration with selected strategy.
   *
   * @security CRITICAL: This method MUST be protected by an authorization layer.
   * Only community admins should be able to initiate migrations.
   *
   * @param communityId - Community to migrate
   * @param guildId - Discord guild ID
   * @param config - Migration configuration
   * @returns Migration ID for tracking
   * @throws Error if community not ready for migration
   */
  startMigration(
    communityId: string,
    guildId: string,
    config: MigrationConfig
  ): Promise<string>;

  /**
   * Pause an in-progress migration.
   *
   * @param migrationId - Migration to pause
   * @param reason - Reason for pause
   * @returns Updated migration state
   */
  pauseMigration(migrationId: string, reason: string): Promise<MigrationState>;

  /**
   * Resume a paused migration.
   *
   * @param migrationId - Migration to resume
   * @returns Updated migration state
   */
  resumeMigration(migrationId: string): Promise<MigrationState>;

  /**
   * Cancel an in-progress migration without rollback.
   *
   * @param migrationId - Migration to cancel
   * @param reason - Reason for cancellation
   * @returns Updated migration state
   */
  cancelMigration(migrationId: string, reason: string): Promise<MigrationState>;
}

// =============================================================================
// Rollback Manager Interface
// =============================================================================

/**
 * IRollbackManager defines the contract for rollback operations.
 */
export interface IRollbackManager {
  /**
   * Execute rollback to pre-migration state.
   *
   * @param request - Rollback request details
   * @returns Rollback result
   */
  rollback(request: RollbackRequest): Promise<RollbackResult>;

  /**
   * Get pre-migration snapshot for a migration.
   *
   * @param migrationId - Migration ID
   * @returns Snapshot or null if not found
   */
  getSnapshot(migrationId: string): Promise<PreMigrationSnapshot | null>;

  /**
   * Create pre-migration snapshot.
   *
   * @param migrationId - Migration ID
   * @param communityId - Community ID
   * @param guildId - Guild ID
   * @returns Created snapshot
   */
  createSnapshot(
    migrationId: string,
    communityId: string,
    guildId: string
  ): Promise<PreMigrationSnapshot>;

  /**
   * Check if auto-rollback should trigger based on metrics.
   *
   * @param migrationId - Migration ID
   * @returns Trigger info or null if no trigger
   */
  checkAutoRollbackTriggers(
    migrationId: string
  ): Promise<{ trigger: boolean; reason: string } | null>;
}

// =============================================================================
// Incumbent Health Monitor Interface
// =============================================================================

/**
 * IIncumbentHealthMonitor defines the contract for monitoring incumbent bot health.
 */
export interface IIncumbentHealthMonitor {
  /**
   * Check incumbent health for a guild.
   *
   * @param guildId - Discord guild ID
   * @param thresholds - Optional custom thresholds
   * @returns Health check result
   */
  checkHealth(
    guildId: string,
    thresholds?: Partial<IncumbentHealthThresholds>
  ): Promise<IncumbentHealthCheck>;

  /**
   * Get health history for a guild.
   *
   * @param guildId - Discord guild ID
   * @param limit - Number of records to return
   * @returns Array of health checks
   */
  getHealthHistory(
    guildId: string,
    limit?: number
  ): Promise<IncumbentHealthCheck[]>;

  /**
   * Start monitoring incumbent health for auto-backup.
   *
   * @param communityId - Community ID
   * @param guildId - Guild ID
   */
  startMonitoring(communityId: string, guildId: string): Promise<void>;

  /**
   * Stop monitoring incumbent health.
   *
   * @param guildId - Guild ID
   */
  stopMonitoring(guildId: string): Promise<void>;
}

// =============================================================================
// Backup Activation Interface
// =============================================================================

/**
 * IBackupActivationService defines the contract for activating Arrakis as backup.
 */
export interface IBackupActivationService {
  /**
   * Activate Arrakis as backup.
   * Non-automatic - requires explicit admin action.
   *
   * @security CRITICAL: This method MUST be protected by an authorization layer.
   * Only community admins should be able to activate backup mode.
   *
   * @param request - Activation request
   * @returns Activation result
   */
  activateBackup(request: BackupActivationRequest): Promise<BackupActivationResult>;

  /**
   * Deactivate Arrakis backup.
   *
   * @param communityId - Community ID
   * @param requestedBy - User requesting deactivation
   * @returns Whether deactivation succeeded
   */
  deactivateBackup(communityId: string, requestedBy: string): Promise<boolean>;

  /**
   * Check if backup is currently active for a community.
   *
   * @param communityId - Community ID
   * @returns Whether backup is active
   */
  isBackupActive(communityId: string): Promise<boolean>;
}

// =============================================================================
// Audit Trail Interface
// =============================================================================

/**
 * IMigrationAuditTrail defines the contract for migration audit logging.
 */
export interface IMigrationAuditTrail {
  /**
   * Log an audit event.
   *
   * @param event - Event to log (without eventId - will be generated)
   */
  log(event: Omit<MigrationAuditEvent, 'eventId'>): Promise<void>;

  /**
   * Query audit events.
   *
   * @param options - Query options
   * @returns Matching events
   */
  query(options: AuditQueryOptions): Promise<MigrationAuditEvent[]>;

  /**
   * Get audit events for a specific migration.
   *
   * @param migrationId - Migration ID
   * @returns Events for the migration
   */
  getByMigration(migrationId: string): Promise<MigrationAuditEvent[]>;

  /**
   * Get recent events for a community.
   *
   * @param communityId - Community ID
   * @param limit - Number of events
   * @returns Recent events
   */
  getRecent(communityId: string, limit?: number): Promise<MigrationAuditEvent[]>;
}

// =============================================================================
// Strategy Executor Interface
// =============================================================================

/**
 * IMigrationStrategyExecutor defines the contract for executing migration strategies.
 */
export interface IMigrationStrategyExecutor {
  /**
   * Execute instant migration.
   *
   * @param migrationId - Migration ID
   * @param communityId - Community ID
   * @param guildId - Guild ID
   */
  executeInstant(
    migrationId: string,
    communityId: string,
    guildId: string
  ): Promise<void>;

  /**
   * Execute gradual migration.
   *
   * @param migrationId - Migration ID
   * @param communityId - Community ID
   * @param guildId - Guild ID
   * @param config - Migration config (for gradualDays and batchSize)
   */
  executeGradual(
    migrationId: string,
    communityId: string,
    guildId: string,
    config: MigrationConfig
  ): Promise<void>;

  /**
   * Execute arrakis_primary migration.
   *
   * @param migrationId - Migration ID
   * @param communityId - Community ID
   * @param guildId - Guild ID
   */
  executeArrakisPrimary(
    migrationId: string,
    communityId: string,
    guildId: string
  ): Promise<void>;

  /**
   * Execute parallel_forever (no migration, just config update).
   *
   * @param communityId - Community ID
   */
  executeParallelForever(communityId: string): Promise<void>;

  /**
   * Process a gradual migration batch.
   *
   * @param migrationId - Migration ID
   * @param batchNumber - Batch number
   * @param memberIds - Member IDs in this batch
   */
  processGradualBatch(
    migrationId: string,
    batchNumber: number,
    memberIds: string[]
  ): Promise<void>;
}

// =============================================================================
// Migration State Store Interface
// =============================================================================

/**
 * IMigrationStateStore defines the contract for persisting migration state.
 */
export interface IMigrationStateStore {
  /**
   * Save migration state.
   */
  save(state: MigrationState): Promise<void>;

  /**
   * Get migration state by ID.
   */
  getById(migrationId: string): Promise<MigrationState | null>;

  /**
   * Get active migration for a community.
   */
  getActiveByCommunity(communityId: string): Promise<MigrationState | null>;

  /**
   * Get migration history for a community.
   */
  getHistoryByCommunity(
    communityId: string,
    limit?: number
  ): Promise<MigrationState[]>;

  /**
   * Update migration status.
   */
  updateStatus(
    migrationId: string,
    status: MigrationState['status'],
    error?: string
  ): Promise<void>;

  /**
   * Update migration progress.
   */
  updateProgress(
    migrationId: string,
    progressPercent: number,
    membersMigrated: number
  ): Promise<void>;
}

// =============================================================================
// Snapshot Store Interface
// =============================================================================

/**
 * ISnapshotStore defines the contract for storing pre-migration snapshots.
 */
export interface ISnapshotStore {
  /**
   * Save snapshot.
   */
  save(snapshot: PreMigrationSnapshot): Promise<void>;

  /**
   * Get snapshot by migration ID.
   */
  getByMigration(migrationId: string): Promise<PreMigrationSnapshot | null>;

  /**
   * Delete snapshot.
   */
  delete(migrationId: string): Promise<void>;

  /**
   * Add member to snapshot.
   */
  addMember(migrationId: string, member: MemberRoleSnapshot): Promise<void>;
}

// =============================================================================
// Combined Migration Interface (Facade)
// =============================================================================

/**
 * IMigrationAndRollback is the combined interface for the MigrationManager class.
 * Extends multiple interfaces to provide a unified API.
 */
export interface IMigrationAndRollback
  extends IMigrationEngine,
    IRollbackManager,
    IIncumbentHealthMonitor,
    IBackupActivationService {
  /**
   * Get audit trail interface.
   */
  getAuditTrail(): IMigrationAuditTrail;
}
