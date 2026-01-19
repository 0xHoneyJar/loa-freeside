/**
 * ProgressiveGate - 3-Stage Engagement System
 *
 * Sprint 104: Progressive Engagement
 *
 * Manages the progression from FREE -> ENGAGED -> VERIFIED stages:
 * - FREE (0 points): Blurred features, glimpse mode
 * - ENGAGED (50 points): Partial features, trust inheritance
 * - VERIFIED: Full features after wallet verification
 *
 * @module services/discord/progressive-gate/ProgressiveGate
 */

import { createLogger, type ILogger } from '../../../packages/infrastructure/logging/index.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Engagement stages
 */
export const STAGES = {
  FREE: 'free',
  ENGAGED: 'engaged',
  VERIFIED: 'verified',
} as const;

export type Stage = (typeof STAGES)[keyof typeof STAGES];

/**
 * Point thresholds for stage transitions
 */
export const STAGE_THRESHOLDS = {
  FREE_MIN: 0,
  ENGAGED_MIN: 50,
  // VERIFIED requires wallet verification, not points
} as const;

/**
 * Default point values for activities
 */
export const ACTIVITY_POINTS = {
  leaderboard_view: 5,
  profile_view: 3,
  badge_preview: 2,
  cta_click: 10,
  command_use: 5,
  return_visit: 8,
} as const;

export type ActivityType = keyof typeof ACTIVITY_POINTS;

/**
 * Rate limiting configuration
 */
export const RATE_LIMITS = {
  /** Maximum points per hour */
  MAX_POINTS_PER_HOUR: 10,
  /** Points penalty after N repeated actions */
  REPEATED_ACTION_THRESHOLD: 3,
  /** Multiplier for repeated actions (50%) */
  REPEATED_ACTION_MULTIPLIER: 0.5,
  /** Minimum gap for return_visit (24 hours) */
  RETURN_VISIT_GAP_MS: 24 * 60 * 60 * 1000,
} as const;

/**
 * Blur levels for feature access
 */
export const BLUR_LEVELS = {
  /** Heavy blur for FREE stage */
  FREE: 0.8,
  /** Light blur for ENGAGED stage */
  ENGAGED: 0.3,
  /** No blur for VERIFIED stage */
  VERIFIED: 0,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Activity record
 */
export interface ActivityRecord {
  type: ActivityType;
  timestamp: Date;
  points: number;
  penalized: boolean;
}

/**
 * Engagement state for a user
 */
export interface EngagementState {
  userId: string;
  communityId: string;
  stage: Stage;
  points: number;
  pointsToNextStage: number;
  progressPercent: number;
  isVerified: boolean;
  verifiedAt: Date | null;
  recentActivities: ActivityRecord[];
  pointsEarnedThisHour: number;
  canEarnMorePoints: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Access check result
 */
export interface AccessCheckResult {
  stage: Stage;
  allowed: boolean;
  blurLevel: number;
  reason?: string;
}

/**
 * Stage transition event
 */
export interface StageTransitionEvent {
  userId: string;
  communityId: string;
  fromStage: Stage;
  toStage: Stage;
  timestamp: Date;
  triggerActivity?: ActivityType;
}

/**
 * Storage adapter interface
 */
export interface IEngagementStorage {
  getEngagement(userId: string, communityId: string): Promise<EngagementState | null>;
  saveEngagement(state: EngagementState): Promise<void>;
  recordActivity(userId: string, communityId: string, activity: ActivityRecord): Promise<void>;
  getRecentActivities(userId: string, communityId: string, since: Date): Promise<ActivityRecord[]>;
  markVerified(userId: string, communityId: string): Promise<void>;
}

/**
 * Event emitter interface
 */
export interface IEngagementEvents {
  emit(event: 'stage_transition', data: StageTransitionEvent): void;
  emit(event: 'activity_recorded', data: { userId: string; communityId: string; activity: ActivityRecord }): void;
  emit(event: 'rate_limited', data: { userId: string; communityId: string; activityType: ActivityType }): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Progressive Gate service for managing engagement stages
 */
export class ProgressiveGate {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: IEngagementStorage,
    private readonly events?: IEngagementEvents,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'ProgressiveGate' });
  }

  /**
   * Check access for a user to a feature
   */
  async checkAccess(
    userId: string,
    communityId: string,
    requiredStage: Stage = STAGES.FREE
  ): Promise<AccessCheckResult> {
    const state = await this.getEngagementState(userId, communityId);
    const stageOrder = [STAGES.FREE, STAGES.ENGAGED, STAGES.VERIFIED];
    const currentIndex = stageOrder.indexOf(state.stage);
    const requiredIndex = stageOrder.indexOf(requiredStage);

    const allowed = currentIndex >= requiredIndex;
    const blurLevel = BLUR_LEVELS[state.stage.toUpperCase() as keyof typeof BLUR_LEVELS] ?? BLUR_LEVELS.FREE;

    return {
      stage: state.stage,
      allowed,
      blurLevel,
      reason: allowed ? undefined : `Requires ${requiredStage} stage (current: ${state.stage})`,
    };
  }

  /**
   * Record an activity and award points
   */
  async recordActivity(
    userId: string,
    communityId: string,
    activityType: ActivityType
  ): Promise<{ pointsAwarded: number; state: EngagementState; stageChanged: boolean }> {
    // Get current state
    let state = await this.getEngagementState(userId, communityId);
    const previousStage = state.stage;

    // Check rate limits
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentActivities = await this.storage.getRecentActivities(userId, communityId, oneHourAgo);

    // Calculate points earned in the last hour
    const pointsEarnedThisHour = recentActivities.reduce((sum, a) => sum + a.points, 0);

    if (pointsEarnedThisHour >= RATE_LIMITS.MAX_POINTS_PER_HOUR) {
      this.logger.debug('Rate limited', { userId, communityId, pointsEarnedThisHour });
      this.events?.emit('rate_limited', { userId, communityId, activityType });
      return { pointsAwarded: 0, state, stageChanged: false };
    }

    // Calculate base points for this activity
    let points: number = ACTIVITY_POINTS[activityType] ?? 0;

    // Apply repeated action penalty
    const sameTypeCount = recentActivities.filter(a => a.type === activityType).length;
    const penalized = sameTypeCount >= RATE_LIMITS.REPEATED_ACTION_THRESHOLD;
    if (penalized) {
      points = Math.floor(points * RATE_LIMITS.REPEATED_ACTION_MULTIPLIER);
    }

    // Cap at remaining rate limit
    const remainingAllowance = RATE_LIMITS.MAX_POINTS_PER_HOUR - pointsEarnedThisHour;
    points = Math.min(points, remainingAllowance);

    // Special handling for return_visit
    if (activityType === 'return_visit') {
      const lastActivity = state.recentActivities.length > 0
        ? new Date(Math.max(...state.recentActivities.map(a => a.timestamp.getTime())))
        : null;

      if (lastActivity && now.getTime() - lastActivity.getTime() < RATE_LIMITS.RETURN_VISIT_GAP_MS) {
        this.logger.debug('Return visit too soon', { userId, communityId });
        return { pointsAwarded: 0, state, stageChanged: false };
      }
    }

    // Record the activity
    const activity: ActivityRecord = {
      type: activityType,
      timestamp: now,
      points,
      penalized,
    };

    await this.storage.recordActivity(userId, communityId, activity);
    this.events?.emit('activity_recorded', { userId, communityId, activity });

    // Update engagement state
    state = await this.getEngagementState(userId, communityId);
    const newStage = this.calculateStage(state.points, state.isVerified);
    const stageChanged = newStage !== previousStage;

    if (stageChanged) {
      this.events?.emit('stage_transition', {
        userId,
        communityId,
        fromStage: previousStage,
        toStage: newStage,
        timestamp: now,
        triggerActivity: activityType,
      });

      this.logger.info('Stage transition', {
        userId,
        communityId,
        fromStage: previousStage,
        toStage: newStage,
      });
    }

    return { pointsAwarded: points, state, stageChanged };
  }

  /**
   * Mark a user as verified (wallet connected)
   */
  async markVerified(userId: string, communityId: string): Promise<EngagementState> {
    const previousState = await this.getEngagementState(userId, communityId);
    const previousStage = previousState.stage;

    await this.storage.markVerified(userId, communityId);

    const newState = await this.getEngagementState(userId, communityId);

    if (newState.stage !== previousStage) {
      this.events?.emit('stage_transition', {
        userId,
        communityId,
        fromStage: previousStage,
        toStage: newState.stage,
        timestamp: new Date(),
      });

      this.logger.info('User verified', {
        userId,
        communityId,
        stage: newState.stage,
      });
    }

    return newState;
  }

  /**
   * Get engagement state for a user
   */
  async getEngagementState(userId: string, communityId: string): Promise<EngagementState> {
    let state = await this.storage.getEngagement(userId, communityId);

    if (!state) {
      // Create initial state
      const now = new Date();
      state = {
        userId,
        communityId,
        stage: STAGES.FREE,
        points: 0,
        pointsToNextStage: STAGE_THRESHOLDS.ENGAGED_MIN,
        progressPercent: 0,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: now,
        updatedAt: now,
      };
      await this.storage.saveEngagement(state);
    }

    // Calculate derived fields
    state.stage = this.calculateStage(state.points, state.isVerified);
    state.pointsToNextStage = this.calculatePointsToNextStage(state.points, state.stage);
    state.progressPercent = this.calculateProgressPercent(state.points, state.stage);

    // Calculate rate limit status
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentActivities = await this.storage.getRecentActivities(userId, communityId, oneHourAgo);
    state.pointsEarnedThisHour = recentActivities.reduce((sum, a) => sum + a.points, 0);
    state.canEarnMorePoints = state.pointsEarnedThisHour < RATE_LIMITS.MAX_POINTS_PER_HOUR;

    return state;
  }

  /**
   * Calculate stage based on points and verification status
   */
  private calculateStage(points: number, isVerified: boolean): Stage {
    if (isVerified) {
      return STAGES.VERIFIED;
    }
    if (points >= STAGE_THRESHOLDS.ENGAGED_MIN) {
      return STAGES.ENGAGED;
    }
    return STAGES.FREE;
  }

  /**
   * Calculate points needed to reach the next stage
   */
  private calculatePointsToNextStage(points: number, stage: Stage): number {
    switch (stage) {
      case STAGES.FREE:
        return STAGE_THRESHOLDS.ENGAGED_MIN - points;
      case STAGES.ENGAGED:
        return 0; // Verification required, not points
      case STAGES.VERIFIED:
        return 0; // Already at max stage
      default:
        return 0;
    }
  }

  /**
   * Calculate progress percentage towards next stage
   */
  private calculateProgressPercent(points: number, stage: Stage): number {
    switch (stage) {
      case STAGES.FREE:
        return Math.min(100, Math.round((points / STAGE_THRESHOLDS.ENGAGED_MIN) * 100));
      case STAGES.ENGAGED:
        return 100; // Full progress, waiting for verification
      case STAGES.VERIFIED:
        return 100;
      default:
        return 0;
    }
  }
}

/**
 * Factory function to create ProgressiveGate
 */
export function createProgressiveGate(
  storage: IEngagementStorage,
  events?: IEngagementEvents,
  logger?: ILogger
): ProgressiveGate {
  return new ProgressiveGate(storage, events, logger);
}
