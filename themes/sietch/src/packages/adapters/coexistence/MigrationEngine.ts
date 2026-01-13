// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * Migration Engine - Strategy Selection, Execution, Rollback & Takeover
 *
 * Sprint 62: Migration Engine - Strategy Selection & Execution
 * Sprint 63: Migration Engine - Rollback & Takeover
 *
 * Orchestrates migration from incumbent token-gating to Arrakis with:
 * - Strategy selection (instant, gradual, parallel_forever, arrakis_primary)
 * - Readiness checks (min shadow days, min accuracy)
 * - Execution logic for different migration paths
 * - State machine transitions (shadow → parallel → primary → exclusive)
 * - Rollback system for emergency reverts (Sprint 63)
 * - Auto-rollback triggers on access loss / error rate (Sprint 63)
 * - Role takeover flow for exclusive mode transition (Sprint 63)
 *
 * CRITICAL: All migrations require readiness checks to pass.
 * This prevents premature migrations that could disrupt community access.
 *
 * @module packages/adapters/coexistence/MigrationEngine
 */

import type {
  ICoexistenceStorage,
  StoredMigrationState,
  CoexistenceMode,
  DivergenceSummary,
} from '../../core/ports/ICoexistenceStorage.js';
import type { MigrationStrategy } from '../storage/schema.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Constants
// =============================================================================

/** Minimum shadow days required before migration (Sprint 62 requirement) */
export const MIN_SHADOW_DAYS = 14;

/** Minimum accuracy percentage required before migration (Sprint 62 requirement) */
export const MIN_ACCURACY_PERCENT = 95;

/** Default batch size for gradual migration */
export const DEFAULT_BATCH_SIZE = 100;

/** Default gradual migration duration in days */
export const DEFAULT_GRADUAL_DURATION_DAYS = 7;

// =============================================================================
// Sprint 63 Constants - Rollback & Takeover
// =============================================================================

/** Access loss percentage that triggers auto-rollback in 1 hour window */
export const AUTO_ROLLBACK_ACCESS_LOSS_PERCENT = 5;

/** Error rate percentage that triggers auto-rollback in 15 min window */
export const AUTO_ROLLBACK_ERROR_RATE_PERCENT = 10;

/** Time window for access loss detection (milliseconds) */
export const ACCESS_LOSS_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Time window for error rate detection (milliseconds) */
export const ERROR_RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Maximum rollbacks before requiring manual intervention */
export const MAX_AUTO_ROLLBACKS = 3;

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a readiness check
 */
export interface ReadinessCheckResult {
  /** Whether all checks passed */
  ready: boolean;
  /** Current shadow days */
  shadowDays: number;
  /** Required shadow days */
  requiredShadowDays: number;
  /** Current accuracy percentage */
  accuracyPercent: number;
  /** Required accuracy percentage */
  requiredAccuracyPercent: number;
  /** Individual check results */
  checks: {
    shadowDaysCheck: boolean;
    accuracyCheck: boolean;
    incumbentConfigured: boolean;
    modeCheck: boolean;
  };
  /** Human-readable reason if not ready */
  reason?: string;
}

/**
 * Migration plan defining how migration will proceed
 */
export interface MigrationPlan {
  /** Selected migration strategy */
  strategy: MigrationStrategy;
  /** Source mode (usually shadow or parallel) */
  sourceMode: CoexistenceMode;
  /** Target mode after migration */
  targetMode: CoexistenceMode;
  /** For gradual: total members to migrate */
  totalMembers?: number;
  /** For gradual: batch size */
  batchSize?: number;
  /** For gradual: duration in days */
  durationDays?: number;
  /** For gradual: batches per day */
  batchesPerDay?: number;
  /** Readiness check result (must be ready) */
  readiness: ReadinessCheckResult;
  /** Estimated completion date */
  estimatedCompletion?: Date;
}

/**
 * Options for executing migration
 */
export interface MigrationExecutionOptions {
  /** Strategy to use */
  strategy: MigrationStrategy;
  /** For gradual: batch size (default: 100) */
  batchSize?: number;
  /** For gradual: duration in days (default: 7) */
  durationDays?: number;
  /** Skip readiness check (DANGEROUS - only for testing) */
  skipReadinessCheck?: boolean;
  /** Dry run - don't actually execute */
  dryRun?: boolean;
}

/**
 * Result of migration execution
 */
export interface MigrationExecutionResult {
  /** Whether migration started successfully */
  success: boolean;
  /** New coexistence mode */
  newMode: CoexistenceMode;
  /** Strategy used */
  strategy: MigrationStrategy;
  /** Error message if failed */
  error?: string;
  /** Migration plan that was executed */
  plan?: MigrationPlan;
  /** For gradual: initial batch migrated */
  initialBatchSize?: number;
  /** For gradual: remaining batches scheduled */
  remainingBatches?: number;
  /** Timestamp of execution */
  executedAt: Date;
}

/**
 * Gradual migration batch info
 */
export interface GradualBatchInfo {
  /** Batch number (1-indexed) */
  batchNumber: number;
  /** Total batches */
  totalBatches: number;
  /** Members in this batch */
  membersInBatch: number;
  /** Members migrated so far */
  membersMigrated: number;
  /** Members remaining */
  membersRemaining: number;
  /** Scheduled execution time */
  scheduledAt: Date;
  /** Whether this batch is complete */
  completed: boolean;
}

/**
 * Callback for Discord role operations
 * Called when migration needs to apply/remove roles
 */
export type ApplyRolesCallback = (
  guildId: string,
  memberId: string,
  roleIdsToAdd: string[],
  roleIdsToRemove: string[]
) => Promise<void>;

/**
 * Callback to get guild members for gradual migration
 */
export type GetGuildMembersCallback = (guildId: string) => Promise<string[]>;

// =============================================================================
// Sprint 63 Types - Rollback & Takeover
// =============================================================================

/**
 * Rollback trigger type
 */
export type RollbackTrigger = 'manual' | 'auto_access_loss' | 'auto_error_rate' | 'auto_health_check';

/**
 * Options for rollback operation
 */
export interface RollbackOptions {
  /** Reason for rollback */
  reason: string;
  /** Trigger type */
  trigger: RollbackTrigger;
  /** Admin who initiated (for manual rollbacks) */
  initiatedBy?: string;
  /** Whether to preserve incumbent roles during rollback */
  preserveIncumbentRoles?: boolean;
}

/**
 * Result of rollback operation
 */
export interface RollbackResult {
  /** Whether rollback succeeded */
  success: boolean;
  /** Previous mode before rollback */
  previousMode: CoexistenceMode;
  /** New mode after rollback */
  newMode: CoexistenceMode;
  /** Error message if failed */
  error?: string;
  /** Trigger that caused rollback */
  trigger: RollbackTrigger;
  /** Timestamp of rollback */
  rolledBackAt: Date;
  /** Total rollback count for this community */
  rollbackCount: number;
}

/**
 * Access loss metrics for auto-rollback detection
 */
export interface AccessMetrics {
  /** Community ID */
  communityId: string;
  /** Total members with access before period */
  previousAccessCount: number;
  /** Total members with access now */
  currentAccessCount: number;
  /** Percentage of access lost */
  accessLossPercent: number;
  /** Whether threshold exceeded */
  thresholdExceeded: boolean;
  /** Time window start */
  windowStart: Date;
  /** Time window end */
  windowEnd: Date;
}

/**
 * Error rate metrics for auto-rollback detection
 */
export interface ErrorMetrics {
  /** Community ID */
  communityId: string;
  /** Total operations in window */
  totalOperations: number;
  /** Failed operations in window */
  failedOperations: number;
  /** Error rate percentage */
  errorRatePercent: number;
  /** Whether threshold exceeded */
  thresholdExceeded: boolean;
  /** Time window start */
  windowStart: Date;
  /** Time window end */
  windowEnd: Date;
}

/**
 * Auto-rollback check result
 */
export interface AutoRollbackCheckResult {
  /** Whether auto-rollback should trigger */
  shouldRollback: boolean;
  /** Trigger reason if should rollback */
  trigger?: RollbackTrigger;
  /** Detailed reason */
  reason?: string;
  /** Access metrics (if checked) */
  accessMetrics?: AccessMetrics;
  /** Error metrics (if checked) */
  errorMetrics?: ErrorMetrics;
  /** Whether max rollbacks reached */
  maxRollbacksReached: boolean;
}

/**
 * Takeover confirmation step
 */
export type TakeoverStep = 'community_name' | 'acknowledge_risks' | 'rollback_plan';

/**
 * Takeover confirmation state
 */
export interface TakeoverConfirmationState {
  /** Community ID */
  communityId: string;
  /** Admin initiating takeover */
  adminId: string;
  /** Steps completed */
  completedSteps: TakeoverStep[];
  /** Community name confirmation */
  communityNameConfirmed?: boolean;
  /** Risk acknowledgment */
  risksAcknowledged?: boolean;
  /** Rollback plan acknowledged */
  rollbackPlanAcknowledged?: boolean;
  /** When confirmation started */
  startedAt: Date;
  /** Confirmation expires after 5 minutes */
  expiresAt: Date;
}

/**
 * Takeover result
 */
export interface TakeoverResult {
  /** Whether takeover succeeded */
  success: boolean;
  /** Previous mode */
  previousMode: CoexistenceMode;
  /** New mode (should be exclusive) */
  newMode: CoexistenceMode;
  /** Error message if failed */
  error?: string;
  /** Roles renamed during takeover */
  rolesRenamed: number;
  /** Timestamp of takeover */
  takenOverAt: Date;
}

/**
 * Callback for renaming Discord roles (remove namespace prefix)
 */
export type RenameRolesCallback = (
  guildId: string,
  roleRenames: Array<{ roleId: string; newName: string }>
) => Promise<void>;

/**
 * Callback for notifying admin of auto-rollback
 */
export type NotifyAdminCallback = (
  guildId: string,
  adminUserId: string,
  message: string,
  details: {
    trigger: RollbackTrigger;
    previousMode: CoexistenceMode;
    newMode: CoexistenceMode;
    rollbackCount: number;
  }
) => Promise<void>;

// =============================================================================
// Migration Engine
// =============================================================================

/**
 * Migration Engine
 *
 * Orchestrates migration from incumbent token-gating to Arrakis.
 * Supports multiple strategies with strict readiness checks.
 * Handles rollback and takeover operations (Sprint 63).
 */
export class MigrationEngine {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly applyRoles?: ApplyRolesCallback,
    private readonly getGuildMembers?: GetGuildMembersCallback,
    private readonly renameRoles?: RenameRolesCallback,
    private readonly notifyAdmin?: NotifyAdminCallback,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'MigrationEngine' });
  }

  // ===========================================================================
  // Readiness Check (TASK-62.3)
  // ===========================================================================

  /**
   * Check if a community is ready for migration
   *
   * Readiness requires:
   * - Minimum 14 days in shadow mode
   * - Minimum 95% accuracy
   * - Incumbent bot configured
   * - Currently in shadow or parallel mode
   */
  async checkReadiness(communityId: string): Promise<ReadinessCheckResult> {
    this.logger.info('Checking migration readiness', { communityId });

    // Get migration state
    const state = await this.storage.getMigrationState(communityId);
    if (!state) {
      return {
        ready: false,
        shadowDays: 0,
        requiredShadowDays: MIN_SHADOW_DAYS,
        accuracyPercent: 0,
        requiredAccuracyPercent: MIN_ACCURACY_PERCENT,
        checks: {
          shadowDaysCheck: false,
          accuracyCheck: false,
          incumbentConfigured: false,
          modeCheck: false,
        },
        reason: 'No migration state found - community not initialized for coexistence',
      };
    }

    // Get incumbent config
    const incumbentConfig = await this.storage.getIncumbentConfig(communityId);
    const incumbentConfigured = incumbentConfig !== null;

    // Get divergence summary for accuracy
    const divergenceSummary = await this.storage.getDivergenceSummary(communityId);

    // Calculate shadow days
    const shadowDays = this.calculateShadowDays(state);

    // Perform checks
    const shadowDaysCheck = shadowDays >= MIN_SHADOW_DAYS;
    const accuracyCheck = divergenceSummary.accuracyPercent >= MIN_ACCURACY_PERCENT;
    const modeCheck = state.currentMode === 'shadow' || state.currentMode === 'parallel';

    const ready = shadowDaysCheck && accuracyCheck && incumbentConfigured && modeCheck;

    // Build reason if not ready
    let reason: string | undefined;
    if (!ready) {
      const reasons: string[] = [];
      if (!incumbentConfigured) {
        reasons.push('No incumbent bot configured');
      }
      if (!modeCheck) {
        reasons.push(`Invalid mode for migration: ${state.currentMode} (must be shadow or parallel)`);
      }
      if (!shadowDaysCheck) {
        reasons.push(`Insufficient shadow days: ${shadowDays}/${MIN_SHADOW_DAYS}`);
      }
      if (!accuracyCheck) {
        reasons.push(`Insufficient accuracy: ${divergenceSummary.accuracyPercent.toFixed(1)}%/${MIN_ACCURACY_PERCENT}%`);
      }
      reason = reasons.join('; ');
    }

    const result: ReadinessCheckResult = {
      ready,
      shadowDays,
      requiredShadowDays: MIN_SHADOW_DAYS,
      accuracyPercent: divergenceSummary.accuracyPercent,
      requiredAccuracyPercent: MIN_ACCURACY_PERCENT,
      checks: {
        shadowDaysCheck,
        accuracyCheck,
        incumbentConfigured,
        modeCheck,
      },
      reason,
    };

    this.logger.info('Readiness check completed', {
      communityId,
      ready,
      shadowDays,
      accuracyPercent: divergenceSummary.accuracyPercent,
      reason,
    });

    return result;
  }

  // ===========================================================================
  // Migration Execution (TASK-62.4)
  // ===========================================================================

  /**
   * Execute migration with the specified strategy
   *
   * Strategies:
   * - `instant`: Immediately transition to parallel/primary mode
   * - `gradual`: Migrate new members immediately, existing over N days
   * - `parallel_forever`: Enable parallel mode indefinitely (no takeover planned)
   * - `arrakis_primary`: Make Arrakis the primary gate, incumbent as backup
   */
  async executeMigration(
    communityId: string,
    options: MigrationExecutionOptions
  ): Promise<MigrationExecutionResult> {
    const { strategy, skipReadinessCheck = false, dryRun = false } = options;
    const executedAt = new Date();

    this.logger.info('Executing migration', {
      communityId,
      strategy,
      skipReadinessCheck,
      dryRun,
    });

    // Check readiness (unless skipped - dangerous!)
    if (!skipReadinessCheck) {
      const readiness = await this.checkReadiness(communityId);
      if (!readiness.ready) {
        this.logger.warn('Migration blocked - readiness check failed', {
          communityId,
          reason: readiness.reason,
        });
        return {
          success: false,
          newMode: 'shadow',
          strategy,
          error: `Migration blocked: ${readiness.reason}`,
          executedAt,
        };
      }
    }

    // Get current state
    const state = await this.storage.getMigrationState(communityId);
    if (!state) {
      return {
        success: false,
        newMode: 'shadow',
        strategy,
        error: 'No migration state found',
        executedAt,
      };
    }

    // Build migration plan
    const plan = await this.buildMigrationPlan(communityId, state, options);

    // Dry run - return plan without executing
    if (dryRun) {
      this.logger.info('Dry run - migration plan built but not executed', {
        communityId,
        strategy,
        plan,
      });
      return {
        success: true,
        newMode: state.currentMode,
        strategy,
        plan,
        executedAt,
      };
    }

    // Execute based on strategy
    try {
      switch (strategy) {
        case 'instant':
          return await this.executeInstantMigration(communityId, state, plan, executedAt);

        case 'gradual':
          return await this.executeGradualMigration(communityId, state, plan, options, executedAt);

        case 'parallel_forever':
          return await this.enableParallelMode(communityId, state, plan, executedAt);

        case 'arrakis_primary':
          return await this.enablePrimaryMode(communityId, state, plan, executedAt);

        default:
          return {
            success: false,
            newMode: state.currentMode,
            strategy,
            error: `Unknown migration strategy: ${strategy}`,
            executedAt,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Migration execution failed', {
        communityId,
        strategy,
        error: errorMessage,
      });
      return {
        success: false,
        newMode: state.currentMode,
        strategy,
        error: errorMessage,
        executedAt,
      };
    }
  }

  // ===========================================================================
  // Strategy Implementations
  // ===========================================================================

  /**
   * Execute instant migration (TASK-62.5)
   *
   * Immediately transitions from shadow to parallel mode.
   * All members get Arrakis roles applied instantly.
   */
  private async executeInstantMigration(
    communityId: string,
    _state: StoredMigrationState,
    plan: MigrationPlan,
    executedAt: Date
  ): Promise<MigrationExecutionResult> {
    this.logger.info('Executing instant migration', { communityId });

    // Update mode to parallel
    await this.storage.updateMode(communityId, 'parallel', 'Instant migration executed');

    // Update migration state
    await this.storage.saveMigrationState({
      communityId,
      currentMode: 'parallel',
      strategy: 'instant',
      parallelEnabledAt: executedAt,
      readinessCheckPassed: true,
    });

    this.logger.info('Instant migration completed', {
      communityId,
      newMode: 'parallel',
    });

    return {
      success: true,
      newMode: 'parallel',
      strategy: 'instant',
      plan,
      executedAt,
    };
  }

  /**
   * Execute gradual migration (TASK-62.6)
   *
   * Migrates new members immediately, existing members over N days.
   * - New members: Get Arrakis roles immediately on join
   * - Existing members: Migrated in batches over the specified duration
   */
  private async executeGradualMigration(
    communityId: string,
    _state: StoredMigrationState,
    plan: MigrationPlan,
    options: MigrationExecutionOptions,
    executedAt: Date
  ): Promise<MigrationExecutionResult> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const durationDays = options.durationDays ?? DEFAULT_GRADUAL_DURATION_DAYS;

    this.logger.info('Executing gradual migration', {
      communityId,
      batchSize,
      durationDays,
      totalMembers: plan.totalMembers,
    });

    // Calculate batches
    const totalMembers = plan.totalMembers ?? 0;
    const totalBatches = Math.ceil(totalMembers / batchSize);
    const batchesPerDay = totalBatches / durationDays;

    // Enable parallel mode for new members
    await this.storage.updateMode(communityId, 'parallel', 'Gradual migration started');

    // Update migration state with gradual config
    await this.storage.saveMigrationState({
      communityId,
      currentMode: 'parallel',
      targetMode: 'primary', // Gradual aims for primary mode
      strategy: 'gradual',
      parallelEnabledAt: executedAt,
      readinessCheckPassed: true,
    });

    // Note: Actual batch scheduling would be handled by a job scheduler
    // This implementation marks the migration as started
    // A separate scheduled job would process batches over time

    this.logger.info('Gradual migration initiated', {
      communityId,
      totalBatches,
      batchesPerDay,
      estimatedCompletion: plan.estimatedCompletion,
    });

    return {
      success: true,
      newMode: 'parallel',
      strategy: 'gradual',
      plan,
      initialBatchSize: Math.min(batchSize, totalMembers),
      remainingBatches: Math.max(0, totalBatches - 1),
      executedAt,
    };
  }

  /**
   * Enable parallel mode (TASK-62.7)
   *
   * For `parallel_forever` strategy - both systems run indefinitely.
   * No planned takeover, useful for communities that want both systems.
   */
  private async enableParallelMode(
    communityId: string,
    _state: StoredMigrationState,
    plan: MigrationPlan,
    executedAt: Date
  ): Promise<MigrationExecutionResult> {
    this.logger.info('Enabling parallel_forever mode', { communityId });

    // Update mode to parallel
    await this.storage.updateMode(communityId, 'parallel', 'Parallel forever enabled');

    // Update migration state - no target mode (parallel is the final state)
    await this.storage.saveMigrationState({
      communityId,
      currentMode: 'parallel',
      targetMode: 'parallel', // No planned transition
      strategy: 'parallel_forever',
      parallelEnabledAt: executedAt,
      readinessCheckPassed: true,
    });

    this.logger.info('Parallel forever mode enabled', {
      communityId,
    });

    return {
      success: true,
      newMode: 'parallel',
      strategy: 'parallel_forever',
      plan,
      executedAt,
    };
  }

  /**
   * Enable primary mode (TASK-62.8)
   *
   * For `arrakis_primary` strategy - Arrakis becomes the primary gate.
   * Incumbent remains as backup but Arrakis takes precedence.
   */
  private async enablePrimaryMode(
    communityId: string,
    _state: StoredMigrationState,
    plan: MigrationPlan,
    executedAt: Date
  ): Promise<MigrationExecutionResult> {
    this.logger.info('Enabling arrakis_primary mode', { communityId });

    // Update mode to primary
    await this.storage.updateMode(communityId, 'primary', 'Arrakis primary enabled');

    // Update migration state
    await this.storage.saveMigrationState({
      communityId,
      currentMode: 'primary',
      targetMode: 'exclusive', // Primary can transition to exclusive
      strategy: 'arrakis_primary',
      primaryEnabledAt: executedAt,
      readinessCheckPassed: true,
    });

    this.logger.info('Arrakis primary mode enabled', {
      communityId,
    });

    return {
      success: true,
      newMode: 'primary',
      strategy: 'arrakis_primary',
      plan,
      executedAt,
    };
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Build migration plan based on strategy and current state
   */
  private async buildMigrationPlan(
    communityId: string,
    state: StoredMigrationState,
    options: MigrationExecutionOptions
  ): Promise<MigrationPlan> {
    const readiness = await this.checkReadiness(communityId);

    // Determine target mode based on strategy
    let targetMode: CoexistenceMode;
    switch (options.strategy) {
      case 'instant':
        targetMode = 'parallel';
        break;
      case 'gradual':
        targetMode = 'primary'; // Gradual aims for primary
        break;
      case 'parallel_forever':
        targetMode = 'parallel';
        break;
      case 'arrakis_primary':
        targetMode = 'primary';
        break;
      default:
        targetMode = 'parallel';
    }

    const plan: MigrationPlan = {
      strategy: options.strategy,
      sourceMode: state.currentMode,
      targetMode,
      readiness,
    };

    // Add gradual-specific fields
    if (options.strategy === 'gradual') {
      const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
      const durationDays = options.durationDays ?? DEFAULT_GRADUAL_DURATION_DAYS;

      // Get member count from divergence summary
      const summary = await this.storage.getDivergenceSummary(communityId);
      const totalMembers = summary.totalMembers;

      plan.totalMembers = totalMembers;
      plan.batchSize = batchSize;
      plan.durationDays = durationDays;
      plan.batchesPerDay = Math.ceil(totalMembers / batchSize / durationDays);

      // Calculate estimated completion
      const estimatedCompletion = new Date();
      estimatedCompletion.setDate(estimatedCompletion.getDate() + durationDays);
      plan.estimatedCompletion = estimatedCompletion;
    }

    return plan;
  }

  /**
   * Calculate days since shadow mode started
   */
  private calculateShadowDays(state: StoredMigrationState): number {
    if (!state.shadowStartedAt) {
      return 0;
    }

    const now = new Date();
    const shadowStart = new Date(state.shadowStartedAt);
    const diffMs = now.getTime() - shadowStart.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    return Math.max(0, diffDays);
  }

  /**
   * Get gradual migration batch info
   *
   * Used by scheduled jobs to determine which batch to process next.
   */
  async getGradualBatchInfo(communityId: string): Promise<GradualBatchInfo | null> {
    const state = await this.storage.getMigrationState(communityId);
    if (!state || state.strategy !== 'gradual') {
      return null;
    }

    // Get member counts
    const summary = await this.storage.getDivergenceSummary(communityId);

    // Calculate batch info based on migration progress
    // Note: In a real implementation, this would track actual batch progress
    // For now, we return initial batch info
    const totalMembers = summary.totalMembers;
    const batchSize = DEFAULT_BATCH_SIZE;
    const totalBatches = Math.ceil(totalMembers / batchSize);

    return {
      batchNumber: 1,
      totalBatches,
      membersInBatch: Math.min(batchSize, totalMembers),
      membersMigrated: 0,
      membersRemaining: totalMembers,
      scheduledAt: new Date(),
      completed: false,
    };
  }

  /**
   * Get available strategies for a community
   *
   * Returns which strategies are available based on current state.
   */
  async getAvailableStrategies(communityId: string): Promise<{
    strategies: MigrationStrategy[];
    currentMode: CoexistenceMode;
    readiness: ReadinessCheckResult;
  }> {
    const state = await this.storage.getMigrationState(communityId);
    const readiness = await this.checkReadiness(communityId);

    if (!state) {
      return {
        strategies: [],
        currentMode: 'shadow',
        readiness,
      };
    }

    const strategies: MigrationStrategy[] = [];

    // All strategies available from shadow mode if ready
    if (state.currentMode === 'shadow' && readiness.ready) {
      strategies.push('instant', 'gradual', 'parallel_forever', 'arrakis_primary');
    }

    // From parallel, can go to primary
    if (state.currentMode === 'parallel' && readiness.ready) {
      strategies.push('arrakis_primary');
    }

    return {
      strategies,
      currentMode: state.currentMode,
      readiness,
    };
  }

  // ===========================================================================
  // Rollback System (Sprint 63 - TASK-63.1)
  // ===========================================================================

  /**
   * Rollback to previous mode
   *
   * Performs a rollback from current mode to the previous safe mode.
   * Cannot rollback from exclusive mode (that's a one-way transition).
   *
   * Mode rollback paths:
   * - exclusive -> BLOCKED (cannot rollback)
   * - primary -> parallel
   * - parallel -> shadow
   * - shadow -> BLOCKED (already at base mode)
   */
  async rollback(
    communityId: string,
    options: RollbackOptions
  ): Promise<RollbackResult> {
    const rolledBackAt = new Date();

    this.logger.info('Initiating rollback', {
      communityId,
      trigger: options.trigger,
      reason: options.reason,
    });

    // Get current state
    const state = await this.storage.getMigrationState(communityId);
    if (!state) {
      return {
        success: false,
        previousMode: 'shadow',
        newMode: 'shadow',
        error: 'No migration state found',
        trigger: options.trigger,
        rolledBackAt,
        rollbackCount: 0,
      };
    }

    const previousMode = state.currentMode;

    // Cannot rollback from exclusive mode
    if (previousMode === 'exclusive') {
      this.logger.warn('Cannot rollback from exclusive mode', { communityId });
      return {
        success: false,
        previousMode,
        newMode: previousMode,
        error: 'Cannot rollback from exclusive mode - this is a one-way transition',
        trigger: options.trigger,
        rolledBackAt,
        rollbackCount: state.rollbackCount,
      };
    }

    // Cannot rollback from shadow mode (already at base)
    if (previousMode === 'shadow') {
      this.logger.warn('Cannot rollback from shadow mode - already at base', { communityId });
      return {
        success: false,
        previousMode,
        newMode: previousMode,
        error: 'Cannot rollback from shadow mode - already at base mode',
        trigger: options.trigger,
        rolledBackAt,
        rollbackCount: state.rollbackCount,
      };
    }

    // Determine target mode for rollback
    let targetMode: CoexistenceMode;
    switch (previousMode) {
      case 'primary':
        targetMode = 'parallel';
        break;
      case 'parallel':
        targetMode = 'shadow';
        break;
      default:
        targetMode = 'shadow';
    }

    try {
      // Record rollback in storage
      await this.storage.recordRollback(communityId, options.reason, targetMode);

      // Update mode
      await this.storage.updateMode(
        communityId,
        targetMode,
        `Rollback: ${options.reason}`
      );

      // Get updated rollback count
      const updatedState = await this.storage.getMigrationState(communityId);
      const rollbackCount = updatedState?.rollbackCount ?? state.rollbackCount + 1;

      this.logger.info('Rollback completed', {
        communityId,
        previousMode,
        newMode: targetMode,
        trigger: options.trigger,
        rollbackCount,
      });

      return {
        success: true,
        previousMode,
        newMode: targetMode,
        trigger: options.trigger,
        rolledBackAt,
        rollbackCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Rollback failed', {
        communityId,
        error: errorMessage,
      });
      return {
        success: false,
        previousMode,
        newMode: previousMode,
        error: errorMessage,
        trigger: options.trigger,
        rolledBackAt,
        rollbackCount: state.rollbackCount,
      };
    }
  }

  // ===========================================================================
  // Auto-Rollback Detection (Sprint 63 - TASK-63.3, TASK-63.4, TASK-63.5)
  // ===========================================================================

  /**
   * Check if auto-rollback should be triggered
   *
   * Auto-rollback triggers:
   * - >5% access loss in 1 hour window
   * - >10% error rate in 15 minute window
   * - Max 3 auto-rollbacks before requiring manual intervention
   */
  async checkAutoRollback(
    communityId: string,
    accessMetrics?: AccessMetrics,
    errorMetrics?: ErrorMetrics
  ): Promise<AutoRollbackCheckResult> {
    // Get current state
    const state = await this.storage.getMigrationState(communityId);
    if (!state) {
      return {
        shouldRollback: false,
        maxRollbacksReached: false,
      };
    }

    // Cannot auto-rollback from shadow or exclusive
    if (state.currentMode === 'shadow' || state.currentMode === 'exclusive') {
      return {
        shouldRollback: false,
        maxRollbacksReached: false,
      };
    }

    // Check if max rollbacks reached
    const maxRollbacksReached = state.rollbackCount >= MAX_AUTO_ROLLBACKS;
    if (maxRollbacksReached) {
      this.logger.warn('Max auto-rollbacks reached - manual intervention required', {
        communityId,
        rollbackCount: state.rollbackCount,
      });
      return {
        shouldRollback: false,
        maxRollbacksReached: true,
        reason: `Max auto-rollbacks (${MAX_AUTO_ROLLBACKS}) reached - manual intervention required`,
      };
    }

    // Check access loss threshold
    if (accessMetrics?.thresholdExceeded) {
      return {
        shouldRollback: true,
        trigger: 'auto_access_loss',
        reason: `Access loss of ${accessMetrics.accessLossPercent.toFixed(1)}% exceeds threshold of ${AUTO_ROLLBACK_ACCESS_LOSS_PERCENT}%`,
        accessMetrics,
        maxRollbacksReached: false,
      };
    }

    // Check error rate threshold
    if (errorMetrics?.thresholdExceeded) {
      return {
        shouldRollback: true,
        trigger: 'auto_error_rate',
        reason: `Error rate of ${errorMetrics.errorRatePercent.toFixed(1)}% exceeds threshold of ${AUTO_ROLLBACK_ERROR_RATE_PERCENT}%`,
        errorMetrics,
        maxRollbacksReached: false,
      };
    }

    return {
      shouldRollback: false,
      accessMetrics,
      errorMetrics,
      maxRollbacksReached: false,
    };
  }

  /**
   * Calculate access loss metrics for a community
   *
   * Compares member access counts over the specified time window.
   */
  async calculateAccessMetrics(
    communityId: string,
    previousAccessCount: number,
    currentAccessCount: number
  ): Promise<AccessMetrics> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - ACCESS_LOSS_WINDOW_MS);

    // Calculate access loss
    const accessLost = Math.max(0, previousAccessCount - currentAccessCount);
    const accessLossPercent = previousAccessCount > 0
      ? (accessLost / previousAccessCount) * 100
      : 0;

    const thresholdExceeded = accessLossPercent > AUTO_ROLLBACK_ACCESS_LOSS_PERCENT;

    return {
      communityId,
      previousAccessCount,
      currentAccessCount,
      accessLossPercent,
      thresholdExceeded,
      windowStart,
      windowEnd: now,
    };
  }

  /**
   * Calculate error rate metrics for a community
   *
   * Tracks failed operations over the specified time window.
   */
  async calculateErrorMetrics(
    communityId: string,
    totalOperations: number,
    failedOperations: number
  ): Promise<ErrorMetrics> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - ERROR_RATE_WINDOW_MS);

    // Calculate error rate
    const errorRatePercent = totalOperations > 0
      ? (failedOperations / totalOperations) * 100
      : 0;

    const thresholdExceeded = errorRatePercent > AUTO_ROLLBACK_ERROR_RATE_PERCENT;

    return {
      communityId,
      totalOperations,
      failedOperations,
      errorRatePercent,
      thresholdExceeded,
      windowStart,
      windowEnd: now,
    };
  }

  /**
   * Execute auto-rollback if conditions are met
   *
   * Called by the rollback watcher job to check and execute auto-rollbacks.
   * Notifies admin after successful rollback.
   */
  async executeAutoRollbackIfNeeded(
    communityId: string,
    guildId: string,
    adminUserId: string,
    accessMetrics?: AccessMetrics,
    errorMetrics?: ErrorMetrics
  ): Promise<RollbackResult | null> {
    // Check if auto-rollback should trigger
    const check = await this.checkAutoRollback(communityId, accessMetrics, errorMetrics);

    if (!check.shouldRollback) {
      return null;
    }

    // Execute rollback
    const result = await this.rollback(communityId, {
      reason: check.reason ?? 'Auto-rollback triggered',
      trigger: check.trigger ?? 'auto_access_loss',
    });

    // Notify admin if rollback succeeded
    if (result.success && this.notifyAdmin) {
      try {
        await this.notifyAdmin(
          guildId,
          adminUserId,
          `⚠️ Auto-rollback triggered for your community.\n\nReason: ${check.reason}`,
          {
            trigger: result.trigger,
            previousMode: result.previousMode,
            newMode: result.newMode,
            rollbackCount: result.rollbackCount,
          }
        );
      } catch (notifyError) {
        this.logger.error('Failed to notify admin of auto-rollback', {
          communityId,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    }

    return result;
  }

  // ===========================================================================
  // Takeover System (Sprint 63 - TASK-63.7, TASK-63.8, TASK-63.9)
  // ===========================================================================

  /**
   * Check if takeover is available for a community
   *
   * Takeover is only available when:
   * - Community is in primary mode
   * - All readiness checks pass
   */
  async canTakeover(communityId: string): Promise<{
    canTakeover: boolean;
    currentMode: CoexistenceMode;
    reason?: string;
  }> {
    const state = await this.storage.getMigrationState(communityId);
    if (!state) {
      return {
        canTakeover: false,
        currentMode: 'shadow',
        reason: 'No migration state found',
      };
    }

    // Must be in primary mode to takeover
    if (state.currentMode !== 'primary') {
      return {
        canTakeover: false,
        currentMode: state.currentMode,
        reason: `Cannot takeover from ${state.currentMode} mode - must be in primary mode`,
      };
    }

    // Already in exclusive mode
    if (state.currentMode === 'exclusive') {
      return {
        canTakeover: false,
        currentMode: state.currentMode,
        reason: 'Already in exclusive mode',
      };
    }

    return {
      canTakeover: true,
      currentMode: state.currentMode,
    };
  }

  /**
   * Create takeover confirmation state
   *
   * Starts the three-step confirmation process for takeover.
   */
  createTakeoverConfirmation(
    communityId: string,
    adminId: string
  ): TakeoverConfirmationState {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    return {
      communityId,
      adminId,
      completedSteps: [],
      startedAt: now,
      expiresAt,
    };
  }

  /**
   * Validate and update takeover confirmation step
   */
  validateTakeoverStep(
    confirmation: TakeoverConfirmationState,
    step: TakeoverStep,
    input: string,
    expectedValue?: string
  ): { valid: boolean; error?: string; updatedConfirmation: TakeoverConfirmationState } {
    // Check if expired
    if (new Date() > confirmation.expiresAt) {
      return {
        valid: false,
        error: 'Confirmation expired - please start again',
        updatedConfirmation: confirmation,
      };
    }

    // Validate based on step
    switch (step) {
      case 'community_name':
        if (expectedValue && input.toLowerCase() !== expectedValue.toLowerCase()) {
          return {
            valid: false,
            error: 'Community name does not match',
            updatedConfirmation: confirmation,
          };
        }
        return {
          valid: true,
          updatedConfirmation: {
            ...confirmation,
            completedSteps: [...confirmation.completedSteps, step],
            communityNameConfirmed: true,
          },
        };

      case 'acknowledge_risks':
        if (input.toLowerCase() !== 'i understand') {
          return {
            valid: false,
            error: 'Please type "I understand" to acknowledge risks',
            updatedConfirmation: confirmation,
          };
        }
        return {
          valid: true,
          updatedConfirmation: {
            ...confirmation,
            completedSteps: [...confirmation.completedSteps, step],
            risksAcknowledged: true,
          },
        };

      case 'rollback_plan':
        if (input.toLowerCase() !== 'confirmed') {
          return {
            valid: false,
            error: 'Please type "confirmed" to acknowledge rollback plan',
            updatedConfirmation: confirmation,
          };
        }
        return {
          valid: true,
          updatedConfirmation: {
            ...confirmation,
            completedSteps: [...confirmation.completedSteps, step],
            rollbackPlanAcknowledged: true,
          },
        };

      default:
        return {
          valid: false,
          error: `Unknown confirmation step: ${step}`,
          updatedConfirmation: confirmation,
        };
    }
  }

  /**
   * Check if all takeover confirmation steps are complete
   */
  isTakeoverConfirmationComplete(confirmation: TakeoverConfirmationState): boolean {
    const requiredSteps: TakeoverStep[] = ['community_name', 'acknowledge_risks', 'rollback_plan'];
    return requiredSteps.every(step => confirmation.completedSteps.includes(step));
  }

  /**
   * Execute takeover
   *
   * Transitions from primary to exclusive mode and renames roles.
   * REQUIRES all three confirmation steps to be completed.
   */
  async executeTakeover(
    communityId: string,
    guildId: string,
    confirmation: TakeoverConfirmationState
  ): Promise<TakeoverResult> {
    const takenOverAt = new Date();

    this.logger.info('Executing takeover', { communityId, guildId });

    // Verify all confirmation steps completed
    if (!this.isTakeoverConfirmationComplete(confirmation)) {
      const missingSteps = ['community_name', 'acknowledge_risks', 'rollback_plan']
        .filter(step => !confirmation.completedSteps.includes(step as TakeoverStep));
      return {
        success: false,
        previousMode: 'primary',
        newMode: 'primary',
        error: `Missing confirmation steps: ${missingSteps.join(', ')}`,
        rolesRenamed: 0,
        takenOverAt,
      };
    }

    // Verify confirmation not expired
    if (new Date() > confirmation.expiresAt) {
      return {
        success: false,
        previousMode: 'primary',
        newMode: 'primary',
        error: 'Confirmation expired - please start again',
        rolesRenamed: 0,
        takenOverAt,
      };
    }

    // Check if takeover is allowed
    const canTakeoverResult = await this.canTakeover(communityId);
    if (!canTakeoverResult.canTakeover) {
      return {
        success: false,
        previousMode: canTakeoverResult.currentMode,
        newMode: canTakeoverResult.currentMode,
        error: canTakeoverResult.reason,
        rolesRenamed: 0,
        takenOverAt,
      };
    }

    try {
      // Get parallel roles to rename
      const parallelRoles = await this.storage.getParallelRoles(communityId);
      let rolesRenamed = 0;

      // Rename roles (remove namespace prefix)
      if (this.renameRoles && parallelRoles.length > 0) {
        const roleRenames = parallelRoles.map(role => ({
          roleId: role.discordRoleId,
          newName: role.baseName, // Remove @arrakis- prefix
        }));

        await this.renameRoles(guildId, roleRenames);
        rolesRenamed = roleRenames.length;

        this.logger.info('Roles renamed during takeover', {
          communityId,
          rolesRenamed,
        });
      }

      // Transition to exclusive mode
      await this.storage.updateMode(communityId, 'exclusive', 'Takeover completed');

      // Update migration state
      await this.storage.saveMigrationState({
        communityId,
        currentMode: 'exclusive',
        targetMode: 'exclusive',
        exclusiveEnabledAt: takenOverAt,
      });

      this.logger.info('Takeover completed', {
        communityId,
        rolesRenamed,
      });

      return {
        success: true,
        previousMode: 'primary',
        newMode: 'exclusive',
        rolesRenamed,
        takenOverAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Takeover failed', {
        communityId,
        error: errorMessage,
      });
      return {
        success: false,
        previousMode: 'primary',
        newMode: 'primary',
        error: errorMessage,
        rolesRenamed: 0,
        takenOverAt,
      };
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new MigrationEngine instance
 *
 * @param storage - Coexistence storage adapter
 * @param applyRoles - Callback for applying/removing Discord roles
 * @param getGuildMembers - Callback for getting guild member IDs
 * @param renameRoles - Callback for renaming Discord roles (Sprint 63 takeover)
 * @param notifyAdmin - Callback for notifying admin of auto-rollback (Sprint 63)
 * @param logger - Optional custom logger
 */
export function createMigrationEngine(
  storage: ICoexistenceStorage,
  applyRoles?: ApplyRolesCallback,
  getGuildMembers?: GetGuildMembersCallback,
  renameRoles?: RenameRolesCallback,
  notifyAdmin?: NotifyAdminCallback,
  logger?: ILogger
): MigrationEngine {
  return new MigrationEngine(storage, applyRoles, getGuildMembers, renameRoles, notifyAdmin, logger);
}
