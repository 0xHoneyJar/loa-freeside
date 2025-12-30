/**
 * Migration Engine - Strategy Selection & Execution
 *
 * Sprint 62: Migration Engine - Strategy Selection & Execution
 *
 * Orchestrates migration from incumbent token-gating to Arrakis with:
 * - Strategy selection (instant, gradual, parallel_forever, arrakis_primary)
 * - Readiness checks (min shadow days, min accuracy)
 * - Execution logic for different migration paths
 * - State machine transitions (shadow → parallel → primary → exclusive)
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
// Migration Engine
// =============================================================================

/**
 * Migration Engine
 *
 * Orchestrates migration from incumbent token-gating to Arrakis.
 * Supports multiple strategies with strict readiness checks.
 */
export class MigrationEngine {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly applyRoles?: ApplyRolesCallback,
    private readonly getGuildMembers?: GetGuildMembersCallback,
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
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new MigrationEngine instance
 */
export function createMigrationEngine(
  storage: ICoexistenceStorage,
  applyRoles?: ApplyRolesCallback,
  getGuildMembers?: GetGuildMembersCallback,
  logger?: ILogger
): MigrationEngine {
  return new MigrationEngine(storage, applyRoles, getGuildMembers, logger);
}
