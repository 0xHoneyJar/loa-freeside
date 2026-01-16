/**
 * IShadowLedger Interface
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Port interface for shadow mode ledger operations.
 * Tracks incumbent vs Arrakis eligibility for proving accuracy.
 *
 * @see SDD §7.1.3 Shadow Ledger Schema
 */

import type {
  ShadowMemberState,
  ShadowDivergence,
  ShadowPrediction,
  DivergenceType,
  PredictionType,
  IncumbentState,
  ArrakisEligibilityResult,
} from '../domain/coexistence.js';

// =============================================================================
// Query Options
// =============================================================================

/**
 * Options for querying divergences.
 */
export interface DivergenceQueryOptions {
  /** Filter by guild ID */
  guildId?: string;
  /** Filter by divergence type */
  divergenceType?: DivergenceType;
  /** Filter by resolved status */
  resolved?: boolean;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Start date filter */
  since?: Date;
  /** End date filter */
  until?: Date;
}

/**
 * Options for querying predictions.
 */
export interface PredictionQueryOptions {
  /** Filter by guild ID */
  guildId?: string;
  /** Filter by prediction type */
  predictionType?: PredictionType;
  /** Filter by verified status */
  verified?: boolean;
  /** Filter by correctness */
  correct?: boolean;
  /** Limit results */
  limit?: number;
  /** Start date filter */
  since?: Date;
  /** End date filter */
  until?: Date;
}

// =============================================================================
// IShadowLedger Interface
// =============================================================================

/**
 * Port interface for shadow ledger operations.
 */
export interface IShadowLedger {
  // ===========================================================================
  // Shadow Member State Operations
  // ===========================================================================

  /**
   * Get shadow state for a member.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @returns Shadow state or null if not found
   */
  getMemberState(guildId: string, userId: string): Promise<ShadowMemberState | null>;

  /**
   * Get all shadow states for a guild.
   *
   * @param guildId - Discord guild ID
   * @param limit - Maximum records to return
   * @param offset - Pagination offset
   * @returns Array of shadow member states
   */
  getGuildStates(guildId: string, limit?: number, offset?: number): Promise<ShadowMemberState[]>;

  /**
   * Get all members with divergences in a guild.
   *
   * @param guildId - Discord guild ID
   * @returns Array of shadow states where divergenceFlag is true
   */
  getDivergentMembers(guildId: string): Promise<ShadowMemberState[]>;

  /**
   * Upsert shadow member state.
   *
   * @param state - Shadow member state to save
   * @returns Updated state
   */
  saveMemberState(state: ShadowMemberState): Promise<ShadowMemberState>;

  /**
   * Batch upsert shadow member states.
   *
   * @param states - Array of states to save
   * @returns Number of states saved
   */
  saveMemberStates(states: ShadowMemberState[]): Promise<number>;

  /**
   * Delete shadow state for a member.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @returns True if deleted
   */
  deleteMemberState(guildId: string, userId: string): Promise<boolean>;

  /**
   * Delete all shadow states for a guild.
   *
   * @param guildId - Discord guild ID
   * @returns Number of states deleted
   */
  deleteGuildStates(guildId: string): Promise<number>;

  // ===========================================================================
  // Divergence Recording
  // ===========================================================================

  /**
   * Record a divergence between incumbent and Arrakis states.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @param incumbentState - Current incumbent state
   * @param arrakisResult - Arrakis eligibility result
   * @returns Recorded divergence
   */
  recordDivergence(
    guildId: string,
    userId: string,
    incumbentState: IncumbentState,
    arrakisResult: ArrakisEligibilityResult
  ): Promise<ShadowDivergence>;

  /**
   * Get divergences by query options.
   *
   * @param options - Query options
   * @returns Array of divergences
   */
  getDivergences(options: DivergenceQueryOptions): Promise<ShadowDivergence[]>;

  /**
   * Mark a divergence as resolved.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @param detectedAt - When divergence was detected
   * @returns Updated divergence
   */
  resolveDivergence(
    guildId: string,
    userId: string,
    detectedAt: Date
  ): Promise<ShadowDivergence | null>;

  /**
   * Get divergence count by type for a guild.
   *
   * @param guildId - Discord guild ID
   * @param since - Start date
   * @returns Count by divergence type
   */
  getDivergenceCounts(
    guildId: string,
    since?: Date
  ): Promise<Record<DivergenceType, number>>;

  // ===========================================================================
  // Prediction Tracking
  // ===========================================================================

  /**
   * Record a prediction for future validation.
   *
   * @param guildId - Discord guild ID
   * @param userId - Discord user ID
   * @param predictionType - Type of prediction
   * @param predictedValue - Predicted value
   * @returns Recorded prediction
   */
  recordPrediction(
    guildId: string,
    userId: string,
    predictionType: PredictionType,
    predictedValue: string
  ): Promise<ShadowPrediction>;

  /**
   * Get predictions by query options.
   *
   * @param options - Query options
   * @returns Array of predictions
   */
  getPredictions(options: PredictionQueryOptions): Promise<ShadowPrediction[]>;

  /**
   * Get unverified predictions for a guild.
   *
   * @param guildId - Discord guild ID
   * @returns Array of unverified predictions
   */
  getUnverifiedPredictions(guildId: string): Promise<ShadowPrediction[]>;

  /**
   * Verify a prediction with actual value.
   *
   * @param predictionId - Prediction ID
   * @param actualValue - Actual observed value
   * @returns Updated prediction with correctness
   */
  verifyPrediction(
    predictionId: string,
    actualValue: string
  ): Promise<ShadowPrediction | null>;

  /**
   * Batch verify predictions.
   *
   * @param verifications - Array of prediction ID to actual value mappings
   * @returns Number of predictions verified
   */
  verifyPredictions(
    verifications: Array<{ predictionId: string; actualValue: string }>
  ): Promise<number>;

  // ===========================================================================
  // Accuracy Calculation
  // ===========================================================================

  /**
   * Calculate accuracy for a guild over a time period.
   *
   * @param guildId - Discord guild ID
   * @param since - Start date
   * @param until - End date (default: now)
   * @returns Accuracy score (0-1)
   */
  calculateAccuracy(guildId: string, since: Date, until?: Date): Promise<number>;

  /**
   * Get accuracy trend over time.
   *
   * @param guildId - Discord guild ID
   * @param intervalDays - Days per bucket
   * @param buckets - Number of buckets
   * @returns Array of accuracy values ordered by date
   */
  getAccuracyTrend(
    guildId: string,
    intervalDays: number,
    buckets: number
  ): Promise<Array<{ date: Date; accuracy: number; sampleSize: number }>>;

  // ===========================================================================
  // Stats & Analytics
  // ===========================================================================

  /**
   * Get shadow sync statistics for a guild.
   *
   * @param guildId - Discord guild ID
   * @returns Shadow statistics
   */
  getStats(guildId: string): Promise<{
    totalMembers: number;
    divergentMembers: number;
    divergenceRate: number;
    totalPredictions: number;
    verifiedPredictions: number;
    accuracy: number;
    lastSyncAt: Date | null;
  }>;
}
