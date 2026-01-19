/**
 * Progressive Gate - 3-Stage Engagement System
 *
 * Sprint 104: Progressive Engagement
 *
 * @module services/discord/progressive-gate
 */

export {
  ProgressiveGate,
  createProgressiveGate,
  // Constants
  STAGES,
  STAGE_THRESHOLDS,
  ACTIVITY_POINTS,
  RATE_LIMITS,
  BLUR_LEVELS,
  // Types
  type Stage,
  type ActivityType,
  type ActivityRecord,
  type EngagementState,
  type AccessCheckResult,
  type StageTransitionEvent,
  type IEngagementStorage,
  type IEngagementEvents,
} from './ProgressiveGate.js';
