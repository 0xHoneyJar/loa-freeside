/**
 * MigrationManager Implementation
 *
 * Sprint S-28: Migration Strategies & Rollback
 *
 * Implements IMigrationAndRollback for migration operations including:
 * - Strategy selection and execution (instant, gradual, parallel_forever, arrakis_primary)
 * - Rollback system with auto-triggers
 * - Incumbent health monitoring
 * - Backup activation
 * - Audit trail
 *
 * @see SDD §7.3 Migration Engine
 */

import type { Logger } from 'pino';
import type {
  IMigrationAndRollback,
  IMigrationAuditTrail,
  IMigrationStateStore,
  ISnapshotStore,
  IMigrationStrategyExecutor,
} from '@arrakis/core/ports';
import type {
  MigrationStrategy,
  MigrationConfig,
  MigrationState,
  MigrationReadiness,
  ReadinessCheck,
  RollbackRequest,
  RollbackResult,
  PreMigrationSnapshot,
  MemberRoleSnapshot,
  IncumbentHealthCheck,
  IncumbentHealthStatus,
  IncumbentHealthThresholds,
  BackupActivationRequest,
  BackupActivationResult,
  MigrationAuditEvent,
  MigrationAuditEventType,
  AuditQueryOptions,
} from '@arrakis/core/domain';
import {
  DEFAULT_ROLLBACK_THRESHOLDS,
  DEFAULT_INCUMBENT_HEALTH_THRESHOLDS,
  DEFAULT_GRADUAL_MIGRATION_DAYS,
  DEFAULT_MIGRATION_BATCH_SIZE,
  MIN_SHADOW_DAYS_FOR_MIGRATION,
  MIN_ACCURACY_FOR_MIGRATION,
  MAX_DIVERGENCE_RATE_FOR_MIGRATION,
} from '@arrakis/core/domain';

// =============================================================================
// Input Validation Constants
// =============================================================================

/** Minimum gradual migration days */
const MIN_GRADUAL_DAYS = 1;

/** Maximum gradual migration days */
const MAX_GRADUAL_DAYS = 90;

/** Minimum batch size */
const MIN_BATCH_SIZE = 10;

/** Maximum batch size */
const MAX_BATCH_SIZE = 1000;

/** Maximum reason length */
const MAX_REASON_LENGTH = 500;

/** Valid migration strategies */
const VALID_STRATEGIES: MigrationStrategy[] = [
  'instant',
  'gradual',
  'parallel_forever',
  'arrakis_primary',
];

// =============================================================================
// Input Validation Helpers
// =============================================================================

/**
 * Validate and sanitize ID strings.
 */
function sanitizeId(value: string | undefined | null, name: string): string {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
  if (trimmed.length > 100) {
    throw new Error(`${name} exceeds maximum length of 100 characters`);
  }
  return trimmed;
}

/**
 * Validate migration strategy.
 */
function validateStrategy(strategy: MigrationStrategy): MigrationStrategy {
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(`Invalid migration strategy: ${strategy}. Must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }
  return strategy;
}

/**
 * Validate gradual days.
 */
function sanitizeGradualDays(days: number | undefined): number {
  if (days === undefined) return DEFAULT_GRADUAL_MIGRATION_DAYS;
  const num = Math.floor(days);
  return Math.max(MIN_GRADUAL_DAYS, Math.min(num, MAX_GRADUAL_DAYS));
}

/**
 * Validate batch size.
 */
function sanitizeBatchSize(size: number | undefined): number {
  if (size === undefined) return DEFAULT_MIGRATION_BATCH_SIZE;
  const num = Math.floor(size);
  return Math.max(MIN_BATCH_SIZE, Math.min(num, MAX_BATCH_SIZE));
}

/**
 * Validate reason string.
 */
function sanitizeReason(reason: string | undefined, defaultReason: string): string {
  if (!reason || typeof reason !== 'string') return defaultReason;
  const trimmed = reason.trim();
  return trimmed.slice(0, MAX_REASON_LENGTH) || defaultReason;
}

// =============================================================================
// Dependency Interfaces
// =============================================================================

/**
 * Shadow ledger interface for migration readiness data.
 */
export interface IShadowLedgerForMigration {
  /**
   * Get shadow mode start date for a community.
   */
  getShadowStartDate(communityId: string): Promise<Date | null>;

  /**
   * Get shadow accuracy for a community.
   */
  getShadowAccuracy(communityId: string): Promise<number>;

  /**
   * Get divergence rate for a community.
   */
  getDivergenceRate(communityId: string): Promise<number>;

  /**
   * Get current member count in shadow mode.
   */
  getMemberCount(communityId: string): Promise<number>;
}

/**
 * Discord service interface for migration operations.
 */
export interface IDiscordMigrationService {
  /**
   * Check if bot is present in guild.
   */
  isBotInGuild(guildId: string): Promise<boolean>;

  /**
   * Get all member roles in a guild.
   */
  getGuildMemberRoles(guildId: string): Promise<Array<{
    userId: string;
    roles: string[];
  }>>;

  /**
   * Add roles to a member.
   */
  addRolesToMember(guildId: string, userId: string, roleIds: string[]): Promise<void>;

  /**
   * Remove roles from a member.
   */
  removeRolesFromMember(guildId: string, userId: string, roleIds: string[]): Promise<void>;

  /**
   * Get incumbent bot's last role update time.
   */
  getLastIncumbentRoleUpdate(guildId: string): Promise<Date | null>;

  /**
   * Check if incumbent bot is present in guild.
   */
  isIncumbentBotPresent(guildId: string): Promise<boolean>;
}

/**
 * Role mapping interface for migration.
 */
export interface IRoleMappingService {
  /**
   * Get Arrakis roles that correspond to incumbent roles.
   */
  getArrakisRolesForIncumbent(
    communityId: string,
    incumbentRoles: string[]
  ): Promise<string[]>;

  /**
   * Get incumbent roles for a member.
   */
  getIncumbentRoles(guildId: string, userId: string): Promise<string[]>;

  /**
   * Get Arrakis roles for a member.
   */
  getArrakisRoles(guildId: string, userId: string): Promise<string[]>;
}

/**
 * Community service for migration config.
 */
export interface IMigrationCommunityService {
  /**
   * Update community coexistence mode.
   */
  updateCoexistenceMode(
    communityId: string,
    mode: 'shadow' | 'parallel' | 'primary' | 'solo'
  ): Promise<void>;

  /**
   * Get community admin user IDs.
   */
  getAdminUserIds(communityId: string): Promise<string[]>;
}

/**
 * Notification service for migration events.
 */
export interface IMigrationNotificationService {
  /**
   * Send notification to a channel.
   */
  sendChannelNotification(
    channelId: string,
    message: string,
    options?: { mentions?: string[] }
  ): Promise<void>;

  /**
   * Send DM to users.
   */
  sendDirectMessage(userIds: string[], message: string): Promise<void>;
}

/**
 * Metrics client for migration tracking.
 */
export interface IMigrationMetrics {
  /**
   * Increment counter.
   */
  increment(metric: string, value?: number, tags?: Record<string, string>): void;

  /**
   * Record gauge.
   */
  gauge(metric: string, value: number, tags?: Record<string, string>): void;

  /**
   * Record timing.
   */
  timing(metric: string, valueMs: number, tags?: Record<string, string>): void;
}

// =============================================================================
// MigrationManager Options
// =============================================================================

/**
 * MigrationManager configuration options.
 */
export interface MigrationManagerOptions {
  /** Auto-rollback check interval in milliseconds (default: 60000 = 1 minute) */
  autoRollbackCheckIntervalMs?: number;
  /** Health check interval in milliseconds (default: 3600000 = 1 hour) */
  healthCheckIntervalMs?: number;
  /** Enable auto-rollback triggers (default: true) */
  enableAutoRollback?: boolean;
}

// =============================================================================
// InMemory Store Implementations (for testing/default)
// =============================================================================

/**
 * In-memory migration state store.
 */
export class InMemoryMigrationStateStore implements IMigrationStateStore {
  private readonly states = new Map<string, MigrationState>();
  private readonly communityIndex = new Map<string, string[]>();

  async save(state: MigrationState): Promise<void> {
    this.states.set(state.migrationId, state);

    const existing = this.communityIndex.get(state.communityId) ?? [];
    if (!existing.includes(state.migrationId)) {
      existing.push(state.migrationId);
      this.communityIndex.set(state.communityId, existing);
    }
  }

  async getById(migrationId: string): Promise<MigrationState | null> {
    return this.states.get(migrationId) ?? null;
  }

  async getActiveByCommunity(communityId: string): Promise<MigrationState | null> {
    const ids = this.communityIndex.get(communityId) ?? [];
    for (const id of ids) {
      const state = this.states.get(id);
      if (state && ['pending', 'in_progress', 'in_progress_gradual', 'paused'].includes(state.status)) {
        return state;
      }
    }
    return null;
  }

  async getHistoryByCommunity(communityId: string, limit = 10): Promise<MigrationState[]> {
    const ids = this.communityIndex.get(communityId) ?? [];
    const states: MigrationState[] = [];
    for (const id of ids) {
      const state = this.states.get(id);
      if (state) states.push(state);
    }
    return states
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async updateStatus(
    migrationId: string,
    status: MigrationState['status'],
    error?: string
  ): Promise<void> {
    const state = this.states.get(migrationId);
    if (state) {
      state.status = status;
      if (error) state.lastError = error;
      if (status === 'completed' || status === 'rolled_back' || status === 'failed') {
        state.completedAt = new Date();
      }
    }
  }

  async updateProgress(
    migrationId: string,
    progressPercent: number,
    membersMigrated: number
  ): Promise<void> {
    const state = this.states.get(migrationId);
    if (state) {
      state.progressPercent = progressPercent;
      state.membersMigrated = membersMigrated;
    }
  }
}

/**
 * In-memory snapshot store.
 */
export class InMemorySnapshotStore implements ISnapshotStore {
  private readonly snapshots = new Map<string, PreMigrationSnapshot>();

  async save(snapshot: PreMigrationSnapshot): Promise<void> {
    this.snapshots.set(snapshot.migrationId, snapshot);
  }

  async getByMigration(migrationId: string): Promise<PreMigrationSnapshot | null> {
    return this.snapshots.get(migrationId) ?? null;
  }

  async delete(migrationId: string): Promise<void> {
    this.snapshots.delete(migrationId);
  }

  async addMember(migrationId: string, member: MemberRoleSnapshot): Promise<void> {
    const snapshot = this.snapshots.get(migrationId);
    if (snapshot) {
      snapshot.members.push(member);
    }
  }
}

/**
 * In-memory audit trail.
 */
export class InMemoryMigrationAuditTrail implements IMigrationAuditTrail {
  private readonly events: MigrationAuditEvent[] = [];
  private eventCounter = 0;

  async log(event: Omit<MigrationAuditEvent, 'eventId'>): Promise<void> {
    this.eventCounter++;
    const fullEvent: MigrationAuditEvent = {
      ...event,
      eventId: `audit-${this.eventCounter}-${Date.now()}`,
    };
    this.events.push(fullEvent);
  }

  async query(options: AuditQueryOptions): Promise<MigrationAuditEvent[]> {
    let filtered = [...this.events];

    if (options.communityId) {
      filtered = filtered.filter((e) => e.communityId === options.communityId);
    }
    if (options.migrationId) {
      filtered = filtered.filter((e) => e.migrationId === options.migrationId);
    }
    if (options.eventType) {
      filtered = filtered.filter((e) => e.eventType === options.eventType);
    }
    if (options.fromDate) {
      filtered = filtered.filter((e) => e.timestamp >= options.fromDate!);
    }
    if (options.toDate) {
      filtered = filtered.filter((e) => e.timestamp <= options.toDate!);
    }

    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return filtered.slice(offset, offset + limit);
  }

  async getByMigration(migrationId: string): Promise<MigrationAuditEvent[]> {
    return this.query({ migrationId });
  }

  async getRecent(communityId: string, limit = 20): Promise<MigrationAuditEvent[]> {
    return this.query({ communityId, limit });
  }
}

// =============================================================================
// MigrationManager Implementation
// =============================================================================

/**
 * MigrationManager implements the complete migration engine.
 *
 * @security CRITICAL: startMigration and activateBackup MUST be protected
 * by an authorization layer. Only community admins should be able to call these methods.
 */
export class MigrationManager implements IMigrationAndRollback {
  private readonly log: Logger;
  private readonly shadowLedger: IShadowLedgerForMigration;
  private readonly discord: IDiscordMigrationService;
  private readonly roleMapping: IRoleMappingService;
  private readonly community: IMigrationCommunityService;
  private readonly notifications: IMigrationNotificationService;
  private readonly metrics: IMigrationMetrics;
  private readonly stateStore: IMigrationStateStore;
  private readonly snapshotStore: ISnapshotStore;
  private readonly auditTrail: IMigrationAuditTrail;
  private readonly options: Required<MigrationManagerOptions>;

  // Active migrations being monitored for auto-rollback
  private readonly activeMonitors = new Map<string, NodeJS.Timeout>();
  // Active health monitors
  private readonly healthMonitors = new Map<string, NodeJS.Timeout>();
  // Backup active states
  private readonly backupActive = new Map<string, { activationId: string; activatedAt: Date }>();

  constructor(
    logger: Logger,
    shadowLedger: IShadowLedgerForMigration,
    discord: IDiscordMigrationService,
    roleMapping: IRoleMappingService,
    community: IMigrationCommunityService,
    notifications: IMigrationNotificationService,
    metrics: IMigrationMetrics,
    stateStore?: IMigrationStateStore,
    snapshotStore?: ISnapshotStore,
    auditTrail?: IMigrationAuditTrail,
    options?: MigrationManagerOptions
  ) {
    this.log = logger.child({ component: 'MigrationManager' });
    this.shadowLedger = shadowLedger;
    this.discord = discord;
    this.roleMapping = roleMapping;
    this.community = community;
    this.notifications = notifications;
    this.metrics = metrics;
    this.stateStore = stateStore ?? new InMemoryMigrationStateStore();
    this.snapshotStore = snapshotStore ?? new InMemorySnapshotStore();
    this.auditTrail = auditTrail ?? new InMemoryMigrationAuditTrail();
    this.options = {
      autoRollbackCheckIntervalMs: options?.autoRollbackCheckIntervalMs ?? 60000,
      healthCheckIntervalMs: options?.healthCheckIntervalMs ?? 3600000,
      enableAutoRollback: options?.enableAutoRollback ?? true,
    };
  }

  // ===========================================================================
  // IMigrationEngine Implementation
  // ===========================================================================

  /**
   * Check if community is ready for migration.
   * @rateLimit Apply per-community rate limiting: 10 requests/minute
   */
  async checkReadiness(communityId: string): Promise<MigrationReadiness> {
    const safeId = sanitizeId(communityId, 'communityId');
    this.log.debug({ communityId: safeId }, 'Checking migration readiness');

    const checks: ReadinessCheck[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];

    // Check 1: Shadow days
    const shadowStart = await this.shadowLedger.getShadowStartDate(safeId);
    const shadowDays = shadowStart
      ? Math.floor((Date.now() - shadowStart.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    checks.push({
      name: 'shadow_days',
      current: shadowDays,
      required: MIN_SHADOW_DAYS_FOR_MIGRATION,
      passed: shadowDays >= MIN_SHADOW_DAYS_FOR_MIGRATION,
      message: shadowDays >= MIN_SHADOW_DAYS_FOR_MIGRATION
        ? `Shadow mode running for ${shadowDays} days (minimum ${MIN_SHADOW_DAYS_FOR_MIGRATION})`
        : `Need ${MIN_SHADOW_DAYS_FOR_MIGRATION - shadowDays} more days in shadow mode`,
    });

    if (shadowDays < MIN_SHADOW_DAYS_FOR_MIGRATION) {
      blockers.push(`Minimum ${MIN_SHADOW_DAYS_FOR_MIGRATION} days in shadow mode required (currently ${shadowDays})`);
    }

    // Check 2: Accuracy
    const accuracy = await this.shadowLedger.getShadowAccuracy(safeId);
    checks.push({
      name: 'accuracy',
      current: accuracy,
      required: MIN_ACCURACY_FOR_MIGRATION,
      passed: accuracy >= MIN_ACCURACY_FOR_MIGRATION,
      message: accuracy >= MIN_ACCURACY_FOR_MIGRATION
        ? `Shadow accuracy at ${(accuracy * 100).toFixed(1)}% (minimum ${MIN_ACCURACY_FOR_MIGRATION * 100}%)`
        : `Accuracy ${(accuracy * 100).toFixed(1)}% below minimum ${MIN_ACCURACY_FOR_MIGRATION * 100}%`,
    });

    if (accuracy < MIN_ACCURACY_FOR_MIGRATION) {
      blockers.push(`Accuracy ${(accuracy * 100).toFixed(1)}% below minimum ${MIN_ACCURACY_FOR_MIGRATION * 100}%`);
    }

    // Check 3: Divergence rate
    const divergence = await this.shadowLedger.getDivergenceRate(safeId);
    checks.push({
      name: 'divergence_rate',
      current: divergence,
      required: MAX_DIVERGENCE_RATE_FOR_MIGRATION,
      passed: divergence <= MAX_DIVERGENCE_RATE_FOR_MIGRATION,
      message: divergence <= MAX_DIVERGENCE_RATE_FOR_MIGRATION
        ? `Divergence rate at ${(divergence * 100).toFixed(1)}% (max ${MAX_DIVERGENCE_RATE_FOR_MIGRATION * 100}%)`
        : `Divergence rate ${(divergence * 100).toFixed(1)}% exceeds max ${MAX_DIVERGENCE_RATE_FOR_MIGRATION * 100}%`,
    });

    if (divergence > MAX_DIVERGENCE_RATE_FOR_MIGRATION) {
      blockers.push(`Divergence rate ${(divergence * 100).toFixed(1)}% exceeds maximum ${MAX_DIVERGENCE_RATE_FOR_MIGRATION * 100}%`);
    }

    // Add warnings for edge cases
    if (accuracy >= MIN_ACCURACY_FOR_MIGRATION && accuracy < 0.98) {
      warnings.push('Accuracy is acceptable but not optimal. Consider waiting for higher accuracy.');
    }

    const ready = blockers.length === 0;
    const estimatedDaysUntilReady = ready
      ? null
      : Math.max(0, MIN_SHADOW_DAYS_FOR_MIGRATION - shadowDays);

    // Recommend strategy based on accuracy
    let recommendedStrategy: MigrationStrategy | null = null;
    if (ready) {
      if (accuracy >= 0.99) {
        recommendedStrategy = 'instant';
      } else if (accuracy >= 0.97) {
        recommendedStrategy = 'gradual';
      } else {
        recommendedStrategy = 'arrakis_primary';
      }
    }

    this.metrics.gauge('migration.readiness.shadow_days', shadowDays, { communityId: safeId });
    this.metrics.gauge('migration.readiness.accuracy', accuracy, { communityId: safeId });
    this.metrics.gauge('migration.readiness.divergence', divergence, { communityId: safeId });
    this.metrics.increment('migration.readiness.checks', 1, {
      communityId: safeId,
      ready: String(ready),
    });

    return {
      ready,
      checks,
      blockers,
      warnings,
      estimatedDaysUntilReady,
      recommendedStrategy,
    };
  }

  /**
   * Get current migration state for a community.
   */
  async getMigrationState(communityId: string): Promise<MigrationState | null> {
    const safeId = sanitizeId(communityId, 'communityId');
    return this.stateStore.getActiveByCommunity(safeId);
  }

  /**
   * Get recommended migration strategy based on shadow accuracy.
   */
  async getRecommendedStrategy(communityId: string): Promise<MigrationStrategy | null> {
    const readiness = await this.checkReadiness(communityId);
    return readiness.recommendedStrategy;
  }

  /**
   * Start migration with selected strategy.
   *
   * @security CRITICAL: This method MUST be protected by an authorization layer.
   * Only community admins should be able to initiate migrations.
   *
   * @rateLimit Apply per-community rate limiting: 1 request/hour
   */
  async startMigration(
    communityId: string,
    guildId: string,
    config: MigrationConfig
  ): Promise<string> {
    const safeCommunityId = sanitizeId(communityId, 'communityId');
    const safeGuildId = sanitizeId(guildId, 'guildId');
    const safeStrategy = validateStrategy(config.strategy);

    this.log.info(
      { communityId: safeCommunityId, guildId: safeGuildId, strategy: safeStrategy },
      'Starting migration'
    );

    // Check for existing active migration
    const existing = await this.stateStore.getActiveByCommunity(safeCommunityId);
    if (existing) {
      throw new Error(`Active migration already exists: ${existing.migrationId}`);
    }

    // Check readiness (except for parallel_forever which doesn't require full readiness)
    if (safeStrategy !== 'parallel_forever') {
      const readiness = await this.checkReadiness(safeCommunityId);
      if (!readiness.ready) {
        throw new Error(`Community not ready for migration: ${readiness.blockers.join(', ')}`);
      }
    }

    // Validate config
    const safeConfig: MigrationConfig = {
      strategy: safeStrategy,
      gradualDays: safeStrategy === 'gradual' ? sanitizeGradualDays(config.gradualDays) : undefined,
      batchSize: safeStrategy === 'gradual' ? sanitizeBatchSize(config.batchSize) : undefined,
      rollbackThresholds: {
        ...DEFAULT_ROLLBACK_THRESHOLDS,
        ...config.rollbackThresholds,
      },
      preserveIncumbentRoles: config.preserveIncumbentRoles ?? false,
      notificationChannelId: config.notificationChannelId,
      adminUserIds: config.adminUserIds,
    };

    // Get member count
    const memberCount = await this.shadowLedger.getMemberCount(safeCommunityId);

    // Create migration state
    const migrationId = `mig-${safeCommunityId}-${Date.now()}`;
    const state: MigrationState = {
      migrationId,
      communityId: safeCommunityId,
      guildId: safeGuildId,
      config: safeConfig,
      status: 'pending',
      startedAt: new Date(),
      completedAt: null,
      progressPercent: 0,
      membersMigrated: 0,
      totalMembers: memberCount,
      lastError: null,
      currentBatch: safeStrategy === 'gradual' ? 0 : undefined,
      totalBatches: safeStrategy === 'gradual'
        ? Math.ceil(memberCount / (safeConfig.batchSize ?? DEFAULT_MIGRATION_BATCH_SIZE))
        : undefined,
    };

    await this.stateStore.save(state);

    // Create pre-migration snapshot
    await this.createSnapshot(migrationId, safeCommunityId, safeGuildId);

    // Log audit event
    await this.auditTrail.log({
      communityId: safeCommunityId,
      guildId: safeGuildId,
      migrationId,
      eventType: 'migration_started',
      timestamp: new Date(),
      actor: 'system',
      details: {
        strategy: safeStrategy,
        memberCount,
        config: safeConfig,
      },
      severity: 'info',
    });

    // Start migration execution
    await this.executeMigration(migrationId, state);

    this.metrics.increment('migration.started', 1, {
      communityId: safeCommunityId,
      strategy: safeStrategy,
    });

    return migrationId;
  }

  /**
   * Pause an in-progress migration.
   */
  async pauseMigration(migrationId: string, reason: string): Promise<MigrationState> {
    const safeId = sanitizeId(migrationId, 'migrationId');
    const safeReason = sanitizeReason(reason, 'Paused by user');

    const state = await this.stateStore.getById(safeId);
    if (!state) {
      throw new Error(`Migration not found: ${safeId}`);
    }

    if (!['in_progress', 'in_progress_gradual'].includes(state.status)) {
      throw new Error(`Cannot pause migration in status: ${state.status}`);
    }

    await this.stateStore.updateStatus(safeId, 'paused');

    // Stop auto-rollback monitoring
    this.stopAutoRollbackMonitor(safeId);

    await this.auditTrail.log({
      communityId: state.communityId,
      guildId: state.guildId,
      migrationId: safeId,
      eventType: 'migration_paused',
      timestamp: new Date(),
      actor: 'system',
      details: { reason: safeReason },
      severity: 'warning',
    });

    this.metrics.increment('migration.paused', 1, { communityId: state.communityId });

    const updated = await this.stateStore.getById(safeId);
    return updated!;
  }

  /**
   * Resume a paused migration.
   */
  async resumeMigration(migrationId: string): Promise<MigrationState> {
    const safeId = sanitizeId(migrationId, 'migrationId');

    const state = await this.stateStore.getById(safeId);
    if (!state) {
      throw new Error(`Migration not found: ${safeId}`);
    }

    if (state.status !== 'paused') {
      throw new Error(`Cannot resume migration in status: ${state.status}`);
    }

    const newStatus = state.config.strategy === 'gradual' ? 'in_progress_gradual' : 'in_progress';
    await this.stateStore.updateStatus(safeId, newStatus);

    await this.auditTrail.log({
      communityId: state.communityId,
      guildId: state.guildId,
      migrationId: safeId,
      eventType: 'migration_resumed',
      timestamp: new Date(),
      actor: 'system',
      details: {},
      severity: 'info',
    });

    // Resume execution
    const updated = await this.stateStore.getById(safeId);
    await this.executeMigration(safeId, updated!);

    this.metrics.increment('migration.resumed', 1, { communityId: state.communityId });

    return updated!;
  }

  /**
   * Cancel an in-progress migration without rollback.
   */
  async cancelMigration(migrationId: string, reason: string): Promise<MigrationState> {
    const safeId = sanitizeId(migrationId, 'migrationId');
    const safeReason = sanitizeReason(reason, 'Cancelled by user');

    const state = await this.stateStore.getById(safeId);
    if (!state) {
      throw new Error(`Migration not found: ${safeId}`);
    }

    if (['completed', 'rolled_back', 'failed'].includes(state.status)) {
      throw new Error(`Cannot cancel migration in status: ${state.status}`);
    }

    await this.stateStore.updateStatus(safeId, 'failed', `Cancelled: ${safeReason}`);

    // Stop monitoring
    this.stopAutoRollbackMonitor(safeId);

    await this.auditTrail.log({
      communityId: state.communityId,
      guildId: state.guildId,
      migrationId: safeId,
      eventType: 'migration_failed',
      timestamp: new Date(),
      actor: 'system',
      details: { reason: safeReason, cancelled: true },
      severity: 'warning',
    });

    this.metrics.increment('migration.cancelled', 1, { communityId: state.communityId });

    const updated = await this.stateStore.getById(safeId);
    return updated!;
  }

  // ===========================================================================
  // IRollbackManager Implementation
  // ===========================================================================

  /**
   * Execute rollback to pre-migration state.
   */
  async rollback(request: RollbackRequest): Promise<RollbackResult> {
    const safeMigrationId = sanitizeId(request.migrationId, 'migrationId');
    const safeReason = sanitizeReason(request.reason, 'Rollback requested');

    this.log.warn(
      { migrationId: safeMigrationId, trigger: request.trigger, reason: safeReason },
      'Initiating rollback'
    );

    const state = await this.stateStore.getById(safeMigrationId);
    if (!state) {
      return {
        migrationId: safeMigrationId,
        success: false,
        membersAffected: 0,
        rolesRestored: 0,
        rolledBackAt: new Date(),
        error: 'Migration not found',
      };
    }

    const snapshot = await this.snapshotStore.getByMigration(safeMigrationId);
    if (!snapshot) {
      return {
        migrationId: safeMigrationId,
        success: false,
        membersAffected: 0,
        rolesRestored: 0,
        rolledBackAt: new Date(),
        error: 'Pre-migration snapshot not found',
      };
    }

    await this.auditTrail.log({
      communityId: state.communityId,
      guildId: state.guildId,
      migrationId: safeMigrationId,
      eventType: 'rollback_started',
      timestamp: new Date(),
      actor: request.requestedBy ?? 'system',
      details: { trigger: request.trigger, reason: safeReason },
      severity: 'warning',
    });

    // Stop monitoring
    this.stopAutoRollbackMonitor(safeMigrationId);

    let membersAffected = 0;
    let rolesRestored = 0;

    try {
      // Restore each member's roles
      for (const member of snapshot.members) {
        try {
          // Remove Arrakis roles
          if (member.arrakisRoles.length > 0) {
            await this.discord.removeRolesFromMember(
              state.guildId,
              member.userId,
              member.arrakisRoles
            );
          }

          // Restore incumbent roles (if they were removed)
          if (member.incumbentRoles.length > 0 && !state.config.preserveIncumbentRoles) {
            await this.discord.addRolesToMember(
              state.guildId,
              member.userId,
              member.incumbentRoles
            );
            rolesRestored += member.incumbentRoles.length;
          }

          membersAffected++;
        } catch (err) {
          this.log.error(
            { err, userId: member.userId },
            'Failed to restore member roles during rollback'
          );
        }
      }

      await this.stateStore.updateStatus(safeMigrationId, 'rolled_back');

      // Restore community mode to shadow
      await this.community.updateCoexistenceMode(state.communityId, 'shadow');

      await this.auditTrail.log({
        communityId: state.communityId,
        guildId: state.guildId,
        migrationId: safeMigrationId,
        eventType: 'rollback_completed',
        timestamp: new Date(),
        actor: request.requestedBy ?? 'system',
        details: { membersAffected, rolesRestored },
        severity: 'info',
      });

      // Notify admins
      if (state.config.notificationChannelId) {
        await this.notifications.sendChannelNotification(
          state.config.notificationChannelId,
          `⚠️ Migration rolled back: ${safeReason}\n` +
            `Members affected: ${membersAffected}\n` +
            `Roles restored: ${rolesRestored}`
        );
      }

      this.metrics.increment('migration.rollback.completed', 1, {
        communityId: state.communityId,
        trigger: request.trigger,
      });

      return {
        migrationId: safeMigrationId,
        success: true,
        membersAffected,
        rolesRestored,
        rolledBackAt: new Date(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';

      await this.auditTrail.log({
        communityId: state.communityId,
        guildId: state.guildId,
        migrationId: safeMigrationId,
        eventType: 'rollback_failed',
        timestamp: new Date(),
        actor: request.requestedBy ?? 'system',
        details: { error },
        severity: 'critical',
      });

      this.metrics.increment('migration.rollback.failed', 1, {
        communityId: state.communityId,
      });

      return {
        migrationId: safeMigrationId,
        success: false,
        membersAffected,
        rolesRestored,
        rolledBackAt: new Date(),
        error,
      };
    }
  }

  /**
   * Get pre-migration snapshot.
   */
  async getSnapshot(migrationId: string): Promise<PreMigrationSnapshot | null> {
    const safeId = sanitizeId(migrationId, 'migrationId');
    return this.snapshotStore.getByMigration(safeId);
  }

  /**
   * Create pre-migration snapshot.
   */
  async createSnapshot(
    migrationId: string,
    communityId: string,
    guildId: string
  ): Promise<PreMigrationSnapshot> {
    const safeMigrationId = sanitizeId(migrationId, 'migrationId');
    const safeCommunityId = sanitizeId(communityId, 'communityId');
    const safeGuildId = sanitizeId(guildId, 'guildId');

    this.log.info({ migrationId: safeMigrationId }, 'Creating pre-migration snapshot');

    const memberRoles = await this.discord.getGuildMemberRoles(safeGuildId);
    const members: MemberRoleSnapshot[] = [];

    for (const member of memberRoles) {
      const incumbentRoles = await this.roleMapping.getIncumbentRoles(safeGuildId, member.userId);
      const arrakisRoles = await this.roleMapping.getArrakisRoles(safeGuildId, member.userId);

      members.push({
        userId: member.userId,
        incumbentRoles,
        arrakisRoles,
      });
    }

    const snapshot: PreMigrationSnapshot = {
      migrationId: safeMigrationId,
      communityId: safeCommunityId,
      guildId: safeGuildId,
      snapshotAt: new Date(),
      members,
    };

    await this.snapshotStore.save(snapshot);

    this.metrics.gauge('migration.snapshot.members', members.length, {
      migrationId: safeMigrationId,
    });

    return snapshot;
  }

  /**
   * Check if auto-rollback should trigger.
   */
  async checkAutoRollbackTriggers(
    migrationId: string
  ): Promise<{ trigger: boolean; reason: string } | null> {
    const safeId = sanitizeId(migrationId, 'migrationId');

    const state = await this.stateStore.getById(safeId);
    if (!state || !['in_progress', 'in_progress_gradual'].includes(state.status)) {
      return null;
    }

    const { rollbackThresholds } = state.config;

    // Check access loss
    // In a real implementation, this would query metrics/logs
    // For now, we simulate by checking shadow ledger divergence
    const divergence = await this.shadowLedger.getDivergenceRate(state.communityId);
    const accessLoss = divergence * 100; // Approximate

    if (accessLoss > rollbackThresholds.accessLossPercent) {
      return {
        trigger: true,
        reason: `Access loss ${accessLoss.toFixed(1)}% exceeds threshold ${rollbackThresholds.accessLossPercent}%`,
      };
    }

    // In production, would also check error rates from metrics
    // For this implementation, we return null if no triggers

    return null;
  }

  // ===========================================================================
  // IIncumbentHealthMonitor Implementation
  // ===========================================================================

  /**
   * Check incumbent health for a guild.
   */
  async checkHealth(
    guildId: string,
    thresholds?: Partial<IncumbentHealthThresholds>
  ): Promise<IncumbentHealthCheck> {
    const safeGuildId = sanitizeId(guildId, 'guildId');

    const fullThresholds: IncumbentHealthThresholds = {
      ...DEFAULT_INCUMBENT_HEALTH_THRESHOLDS,
      ...thresholds,
    };

    const errors: string[] = [];
    let botPresent = false;
    let hoursSinceLastUpdate = Infinity;

    try {
      botPresent = await this.discord.isIncumbentBotPresent(safeGuildId);
    } catch (err) {
      errors.push(`Failed to check bot presence: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    try {
      const lastUpdate = await this.discord.getLastIncumbentRoleUpdate(safeGuildId);
      if (lastUpdate) {
        hoursSinceLastUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
      }
    } catch (err) {
      errors.push(`Failed to get last update: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    let status: IncumbentHealthStatus;

    if (!botPresent || hoursSinceLastUpdate >= fullThresholds.deadHours) {
      status = 'dead';
    } else if (hoursSinceLastUpdate >= fullThresholds.criticalHours) {
      status = 'critical';
    } else if (hoursSinceLastUpdate >= fullThresholds.warningHours) {
      status = 'warning';
    } else {
      status = 'healthy';
    }

    const result: IncumbentHealthCheck = {
      status,
      botPresent,
      hoursSinceLastRoleUpdate: hoursSinceLastUpdate === Infinity ? -1 : hoursSinceLastUpdate,
      roleFreshnessThresholdHours: fullThresholds.warningHours,
      errors,
      checkedAt: new Date(),
    };

    await this.auditTrail.log({
      communityId: '', // Will be filled by caller if needed
      guildId: safeGuildId,
      migrationId: null,
      eventType: 'health_check',
      timestamp: new Date(),
      actor: 'system',
      details: result,
      severity: status === 'healthy' ? 'info' : status === 'warning' ? 'warning' : 'error',
    });

    this.metrics.gauge('migration.incumbent.health_status',
      status === 'healthy' ? 1 : status === 'warning' ? 0.5 : 0,
      { guildId: safeGuildId }
    );

    return result;
  }

  /**
   * Get health history for a guild.
   */
  async getHealthHistory(guildId: string, limit = 10): Promise<IncumbentHealthCheck[]> {
    const safeGuildId = sanitizeId(guildId, 'guildId');
    const safeLimit = Math.max(1, Math.min(limit, 100));

    const events = await this.auditTrail.query({
      eventType: 'health_check',
      limit: safeLimit,
    });

    // Filter to this guild and extract health check data
    return events
      .filter((e) => e.guildId === safeGuildId)
      .map((e) => e.details as unknown as IncumbentHealthCheck);
  }

  /**
   * Start monitoring incumbent health.
   */
  async startMonitoring(communityId: string, guildId: string): Promise<void> {
    const safeCommunityId = sanitizeId(communityId, 'communityId');
    const safeGuildId = sanitizeId(guildId, 'guildId');

    if (this.healthMonitors.has(safeGuildId)) {
      return; // Already monitoring
    }

    const interval = setInterval(async () => {
      try {
        const health = await this.checkHealth(safeGuildId);

        // If incumbent is dead/critical, notify admins
        if (health.status === 'dead' || health.status === 'critical') {
          const admins = await this.community.getAdminUserIds(safeCommunityId);
          if (admins.length > 0) {
            await this.notifications.sendDirectMessage(
              admins,
              `⚠️ Incumbent bot health alert for guild ${safeGuildId}: ${health.status.toUpperCase()}\n` +
                `Hours since last update: ${health.hoursSinceLastRoleUpdate.toFixed(1)}\n` +
                `Consider activating Arrakis as backup.`
            );
          }
        }
      } catch (err) {
        this.log.error({ err, guildId: safeGuildId }, 'Health check failed');
      }
    }, this.options.healthCheckIntervalMs);

    this.healthMonitors.set(safeGuildId, interval);
    this.log.info({ guildId: safeGuildId }, 'Started health monitoring');
  }

  /**
   * Stop monitoring incumbent health.
   */
  async stopMonitoring(guildId: string): Promise<void> {
    const safeGuildId = sanitizeId(guildId, 'guildId');

    const interval = this.healthMonitors.get(safeGuildId);
    if (interval) {
      clearInterval(interval);
      this.healthMonitors.delete(safeGuildId);
      this.log.info({ guildId: safeGuildId }, 'Stopped health monitoring');
    }
  }

  // ===========================================================================
  // IBackupActivationService Implementation
  // ===========================================================================

  /**
   * Activate Arrakis as backup.
   *
   * @security CRITICAL: This method MUST be protected by an authorization layer.
   * Only community admins should be able to activate backup mode.
   *
   * @rateLimit Apply per-community rate limiting: 1 request/hour
   */
  async activateBackup(request: BackupActivationRequest): Promise<BackupActivationResult> {
    const safeCommunityId = sanitizeId(request.communityId, 'communityId');
    const safeGuildId = sanitizeId(request.guildId, 'guildId');
    const safeReason = sanitizeReason(request.reason, 'Backup activation requested');

    this.log.warn(
      { communityId: safeCommunityId, guildId: safeGuildId, reason: safeReason },
      'Activating Arrakis as backup'
    );

    if (this.backupActive.has(safeCommunityId)) {
      return {
        success: false,
        activationId: '',
        membersCovered: 0,
        activatedAt: new Date(),
        error: 'Backup already active for this community',
      };
    }

    const activationId = `backup-${safeCommunityId}-${Date.now()}`;

    try {
      // Update community mode to primary (Arrakis as primary)
      await this.community.updateCoexistenceMode(safeCommunityId, 'primary');

      // Get member count
      const memberCount = await this.shadowLedger.getMemberCount(safeCommunityId);

      this.backupActive.set(safeCommunityId, {
        activationId,
        activatedAt: new Date(),
      });

      await this.auditTrail.log({
        communityId: safeCommunityId,
        guildId: safeGuildId,
        migrationId: null,
        eventType: 'backup_activated',
        timestamp: new Date(),
        actor: request.requestedBy,
        details: { reason: safeReason, membersCovered: memberCount },
        severity: 'warning',
      });

      this.metrics.increment('migration.backup.activated', 1, {
        communityId: safeCommunityId,
      });

      return {
        success: true,
        activationId,
        membersCovered: memberCount,
        activatedAt: new Date(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';

      return {
        success: false,
        activationId: '',
        membersCovered: 0,
        activatedAt: new Date(),
        error,
      };
    }
  }

  /**
   * Deactivate Arrakis backup.
   */
  async deactivateBackup(communityId: string, requestedBy: string): Promise<boolean> {
    const safeCommunityId = sanitizeId(communityId, 'communityId');

    if (!this.backupActive.has(safeCommunityId)) {
      return false;
    }

    try {
      // Restore to shadow mode
      await this.community.updateCoexistenceMode(safeCommunityId, 'shadow');

      this.backupActive.delete(safeCommunityId);

      await this.auditTrail.log({
        communityId: safeCommunityId,
        guildId: '',
        migrationId: null,
        eventType: 'backup_deactivated',
        timestamp: new Date(),
        actor: requestedBy,
        details: {},
        severity: 'info',
      });

      this.metrics.increment('migration.backup.deactivated', 1, {
        communityId: safeCommunityId,
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if backup is active.
   */
  async isBackupActive(communityId: string): Promise<boolean> {
    const safeCommunityId = sanitizeId(communityId, 'communityId');
    return this.backupActive.has(safeCommunityId);
  }

  // ===========================================================================
  // Audit Trail Access
  // ===========================================================================

  /**
   * Get audit trail interface.
   */
  getAuditTrail(): IMigrationAuditTrail {
    return this.auditTrail;
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Execute migration based on strategy.
   */
  private async executeMigration(migrationId: string, state: MigrationState): Promise<void> {
    const { strategy } = state.config;

    await this.stateStore.updateStatus(
      migrationId,
      strategy === 'gradual' ? 'in_progress_gradual' : 'in_progress'
    );

    // Start auto-rollback monitoring
    if (this.options.enableAutoRollback) {
      this.startAutoRollbackMonitor(migrationId);
    }

    try {
      switch (strategy) {
        case 'instant':
          await this.executeInstantMigration(migrationId, state);
          break;
        case 'gradual':
          await this.executeGradualMigration(migrationId, state);
          break;
        case 'arrakis_primary':
          await this.executeArrakisPrimaryMigration(migrationId, state);
          break;
        case 'parallel_forever':
          await this.executeParallelForeverMigration(migrationId, state);
          break;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      await this.stateStore.updateStatus(migrationId, 'failed', error);

      await this.auditTrail.log({
        communityId: state.communityId,
        guildId: state.guildId,
        migrationId,
        eventType: 'migration_failed',
        timestamp: new Date(),
        actor: 'system',
        details: { error },
        severity: 'error',
      });

      this.stopAutoRollbackMonitor(migrationId);

      throw err;
    }
  }

  /**
   * Execute instant migration - immediate full cutover.
   */
  private async executeInstantMigration(
    migrationId: string,
    state: MigrationState
  ): Promise<void> {
    this.log.info({ migrationId }, 'Executing instant migration');

    const snapshot = await this.snapshotStore.getByMigration(migrationId);
    if (!snapshot) {
      throw new Error('Snapshot not found');
    }

    let membersMigrated = 0;

    for (const member of snapshot.members) {
      try {
        // Get Arrakis roles for this member based on incumbent roles
        const arrakisRoles = await this.roleMapping.getArrakisRolesForIncumbent(
          state.communityId,
          member.incumbentRoles
        );

        // Add Arrakis roles
        if (arrakisRoles.length > 0) {
          await this.discord.addRolesToMember(state.guildId, member.userId, arrakisRoles);
        }

        // Optionally remove incumbent roles
        if (!state.config.preserveIncumbentRoles && member.incumbentRoles.length > 0) {
          await this.discord.removeRolesFromMember(
            state.guildId,
            member.userId,
            member.incumbentRoles
          );
        }

        membersMigrated++;
        await this.stateStore.updateProgress(
          migrationId,
          Math.round((membersMigrated / state.totalMembers) * 100),
          membersMigrated
        );
      } catch (err) {
        this.log.error({ err, userId: member.userId }, 'Failed to migrate member');
      }
    }

    // Update community mode
    await this.community.updateCoexistenceMode(state.communityId, 'solo');

    await this.completeMigration(migrationId, state);
  }

  /**
   * Execute gradual migration - phased transition.
   */
  private async executeGradualMigration(
    migrationId: string,
    state: MigrationState
  ): Promise<void> {
    this.log.info({ migrationId, days: state.config.gradualDays }, 'Executing gradual migration');

    const snapshot = await this.snapshotStore.getByMigration(migrationId);
    if (!snapshot) {
      throw new Error('Snapshot not found');
    }

    const batchSize = state.config.batchSize ?? DEFAULT_MIGRATION_BATCH_SIZE;
    const totalBatches = Math.ceil(snapshot.members.length / batchSize);
    const days = state.config.gradualDays ?? DEFAULT_GRADUAL_MIGRATION_DAYS;
    const msPerBatch = (days * 24 * 60 * 60 * 1000) / totalBatches;

    let currentBatch = state.currentBatch ?? 0;
    let membersMigrated = state.membersMigrated;

    while (currentBatch < totalBatches) {
      // Check if paused
      const currentState = await this.stateStore.getById(migrationId);
      if (currentState?.status === 'paused') {
        return; // Exit and wait for resume
      }

      const startIdx = currentBatch * batchSize;
      const endIdx = Math.min(startIdx + batchSize, snapshot.members.length);
      const batch = snapshot.members.slice(startIdx, endIdx);

      await this.auditTrail.log({
        communityId: state.communityId,
        guildId: state.guildId,
        migrationId,
        eventType: 'batch_started',
        timestamp: new Date(),
        actor: 'system',
        details: { batchNumber: currentBatch + 1, totalBatches, batchSize: batch.length },
        severity: 'info',
      });

      for (const member of batch) {
        try {
          const arrakisRoles = await this.roleMapping.getArrakisRolesForIncumbent(
            state.communityId,
            member.incumbentRoles
          );

          if (arrakisRoles.length > 0) {
            await this.discord.addRolesToMember(state.guildId, member.userId, arrakisRoles);
          }

          if (!state.config.preserveIncumbentRoles && member.incumbentRoles.length > 0) {
            await this.discord.removeRolesFromMember(
              state.guildId,
              member.userId,
              member.incumbentRoles
            );
          }

          membersMigrated++;
        } catch (err) {
          this.log.error({ err, userId: member.userId }, 'Failed to migrate member in batch');
        }
      }

      currentBatch++;
      await this.stateStore.updateProgress(
        migrationId,
        Math.round((membersMigrated / state.totalMembers) * 100),
        membersMigrated
      );

      // Update batch tracking
      const stateToUpdate = await this.stateStore.getById(migrationId);
      if (stateToUpdate) {
        stateToUpdate.currentBatch = currentBatch;
        await this.stateStore.save(stateToUpdate);
      }

      await this.auditTrail.log({
        communityId: state.communityId,
        guildId: state.guildId,
        migrationId,
        eventType: 'batch_completed',
        timestamp: new Date(),
        actor: 'system',
        details: { batchNumber: currentBatch, membersMigrated },
        severity: 'info',
      });

      // Wait before next batch (except for last batch)
      if (currentBatch < totalBatches) {
        await new Promise((resolve) => setTimeout(resolve, msPerBatch));
      }
    }

    // Update community mode
    await this.community.updateCoexistenceMode(state.communityId, 'solo');

    await this.completeMigration(migrationId, state);
  }

  /**
   * Execute arrakis_primary migration - Arrakis primary, incumbent backup.
   */
  private async executeArrakisPrimaryMigration(
    migrationId: string,
    state: MigrationState
  ): Promise<void> {
    this.log.info({ migrationId }, 'Executing arrakis_primary migration');

    const snapshot = await this.snapshotStore.getByMigration(migrationId);
    if (!snapshot) {
      throw new Error('Snapshot not found');
    }

    let membersMigrated = 0;

    for (const member of snapshot.members) {
      try {
        const arrakisRoles = await this.roleMapping.getArrakisRolesForIncumbent(
          state.communityId,
          member.incumbentRoles
        );

        if (arrakisRoles.length > 0) {
          await this.discord.addRolesToMember(state.guildId, member.userId, arrakisRoles);
        }

        // Keep incumbent roles as backup - don't remove them
        membersMigrated++;
        await this.stateStore.updateProgress(
          migrationId,
          Math.round((membersMigrated / state.totalMembers) * 100),
          membersMigrated
        );
      } catch (err) {
        this.log.error({ err, userId: member.userId }, 'Failed to migrate member');
      }
    }

    // Update to primary mode (Arrakis manages, incumbent exists)
    await this.community.updateCoexistenceMode(state.communityId, 'primary');

    await this.completeMigration(migrationId, state);
  }

  /**
   * Execute parallel_forever migration - keep both systems indefinitely.
   */
  private async executeParallelForeverMigration(
    migrationId: string,
    state: MigrationState
  ): Promise<void> {
    this.log.info({ migrationId }, 'Executing parallel_forever migration (config only)');

    // This strategy doesn't actually migrate - it just updates config
    // to run both systems indefinitely in parallel

    await this.community.updateCoexistenceMode(state.communityId, 'parallel');

    await this.stateStore.updateProgress(migrationId, 100, state.totalMembers);
    await this.completeMigration(migrationId, state);
  }

  /**
   * Complete migration.
   */
  private async completeMigration(migrationId: string, state: MigrationState): Promise<void> {
    await this.stateStore.updateStatus(migrationId, 'completed');

    this.stopAutoRollbackMonitor(migrationId);

    await this.auditTrail.log({
      communityId: state.communityId,
      guildId: state.guildId,
      migrationId,
      eventType: 'migration_completed',
      timestamp: new Date(),
      actor: 'system',
      details: { strategy: state.config.strategy },
      severity: 'info',
    });

    // Notify
    if (state.config.notificationChannelId) {
      await this.notifications.sendChannelNotification(
        state.config.notificationChannelId,
        `✅ Migration completed successfully!\n` +
          `Strategy: ${state.config.strategy}\n` +
          `Members migrated: ${state.membersMigrated}`,
        { mentions: state.config.adminUserIds }
      );
    }

    this.metrics.increment('migration.completed', 1, {
      communityId: state.communityId,
      strategy: state.config.strategy,
    });
  }

  /**
   * Start auto-rollback monitor.
   */
  private startAutoRollbackMonitor(migrationId: string): void {
    if (this.activeMonitors.has(migrationId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const trigger = await this.checkAutoRollbackTriggers(migrationId);
        if (trigger?.trigger) {
          this.log.warn({ migrationId, reason: trigger.reason }, 'Auto-rollback triggered');

          await this.auditTrail.log({
            communityId: '',
            guildId: '',
            migrationId,
            eventType: 'threshold_triggered',
            timestamp: new Date(),
            actor: 'system',
            details: { reason: trigger.reason },
            severity: 'critical',
          });

          await this.rollback({
            migrationId,
            reason: trigger.reason,
            trigger: 'access_loss',
          });
        }
      } catch (err) {
        this.log.error({ err, migrationId }, 'Auto-rollback check failed');
      }
    }, this.options.autoRollbackCheckIntervalMs);

    this.activeMonitors.set(migrationId, interval);
  }

  /**
   * Stop auto-rollback monitor.
   */
  private stopAutoRollbackMonitor(migrationId: string): void {
    const interval = this.activeMonitors.get(migrationId);
    if (interval) {
      clearInterval(interval);
      this.activeMonitors.delete(migrationId);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a MigrationManager instance.
 */
export function createMigrationManager(
  logger: Logger,
  shadowLedger: IShadowLedgerForMigration,
  discord: IDiscordMigrationService,
  roleMapping: IRoleMappingService,
  community: IMigrationCommunityService,
  notifications: IMigrationNotificationService,
  metrics: IMigrationMetrics,
  stateStore?: IMigrationStateStore,
  snapshotStore?: ISnapshotStore,
  auditTrail?: IMigrationAuditTrail,
  options?: MigrationManagerOptions
): MigrationManager {
  return new MigrationManager(
    logger,
    shadowLedger,
    discord,
    roleMapping,
    community,
    notifications,
    metrics,
    stateStore,
    snapshotStore,
    auditTrail,
    options
  );
}
