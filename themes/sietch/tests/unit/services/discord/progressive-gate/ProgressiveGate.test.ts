/**
 * ProgressiveGate Unit Tests
 *
 * Sprint 104: Progressive Engagement
 *
 * Tests the 3-stage engagement system:
 * - Stage calculation (FREE -> ENGAGED -> VERIFIED)
 * - Point accumulation and rate limiting
 * - Activity recording
 * - Access checks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ProgressiveGate,
  createProgressiveGate,
  STAGES,
  STAGE_THRESHOLDS,
  ACTIVITY_POINTS,
  RATE_LIMITS,
  BLUR_LEVELS,
  type IEngagementStorage,
  type IEngagementEvents,
  type EngagementState,
  type ActivityRecord,
} from '../../../../../src/services/discord/progressive-gate/ProgressiveGate.js';

// Mock the logger module
vi.mock('../../../../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// =============================================================================
// Mock Storage Implementation
// =============================================================================

function createMockStorage(initialStates: Map<string, EngagementState> = new Map()): IEngagementStorage {
  const states = new Map(initialStates);
  const activities = new Map<string, ActivityRecord[]>();

  const getKey = (userId: string, communityId: string) => `${userId}:${communityId}`;

  return {
    getEngagement: vi.fn(async (userId: string, communityId: string) => {
      return states.get(getKey(userId, communityId)) ?? null;
    }),
    saveEngagement: vi.fn(async (state: EngagementState) => {
      states.set(getKey(state.userId, state.communityId), state);
    }),
    recordActivity: vi.fn(async (userId: string, communityId: string, activity: ActivityRecord) => {
      const key = getKey(userId, communityId);
      const existing = activities.get(key) ?? [];
      existing.push(activity);
      activities.set(key, existing);

      // Update state points
      const state = states.get(key);
      if (state) {
        state.points += activity.points;
        state.updatedAt = new Date();
        states.set(key, state);
      }
    }),
    getRecentActivities: vi.fn(async (userId: string, communityId: string, since: Date) => {
      const key = getKey(userId, communityId);
      const all = activities.get(key) ?? [];
      return all.filter(a => a.timestamp >= since);
    }),
    markVerified: vi.fn(async (userId: string, communityId: string) => {
      const key = getKey(userId, communityId);
      const state = states.get(key);
      if (state) {
        state.isVerified = true;
        state.verifiedAt = new Date();
        states.set(key, state);
      }
    }),
  };
}

function createMockEvents(): IEngagementEvents {
  return {
    emit: vi.fn(),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ProgressiveGate', () => {
  let storage: IEngagementStorage;
  let events: IEngagementEvents;
  let gate: ProgressiveGate;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createMockStorage();
    events = createMockEvents();
    gate = createProgressiveGate(storage, events);
  });

  describe('Factory Function', () => {
    it('should create ProgressiveGate with createProgressiveGate', () => {
      const gate = createProgressiveGate(storage);
      expect(gate).toBeInstanceOf(ProgressiveGate);
    });
  });

  describe('Stage Calculation', () => {
    it('should start new users at FREE stage', async () => {
      const state = await gate.getEngagementState('user-1', 'community-1');

      expect(state.stage).toBe(STAGES.FREE);
      expect(state.points).toBe(0);
      expect(state.isVerified).toBe(false);
    });

    it('should transition to ENGAGED at 50 points', async () => {
      // Create state with 50 points
      const initialState: EngagementState = {
        userId: 'user-1',
        communityId: 'community-1',
        stage: STAGES.FREE,
        points: 50,
        pointsToNextStage: 0,
        progressPercent: 100,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storage = createMockStorage(new Map([['user-1:community-1', initialState]]));
      gate = createProgressiveGate(storage, events);

      const state = await gate.getEngagementState('user-1', 'community-1');

      expect(state.stage).toBe(STAGES.ENGAGED);
    });

    it('should transition to VERIFIED when marked verified', async () => {
      const initialState: EngagementState = {
        userId: 'user-1',
        communityId: 'community-1',
        stage: STAGES.ENGAGED,
        points: 60,
        pointsToNextStage: 0,
        progressPercent: 100,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storage = createMockStorage(new Map([['user-1:community-1', initialState]]));
      gate = createProgressiveGate(storage, events);

      const state = await gate.markVerified('user-1', 'community-1');

      expect(state.stage).toBe(STAGES.VERIFIED);
      expect(state.isVerified).toBe(true);
    });
  });

  describe('Point Accumulation', () => {
    it('should award correct points for activities', async () => {
      const result = await gate.recordActivity('user-1', 'community-1', 'leaderboard_view');

      expect(result.pointsAwarded).toBe(ACTIVITY_POINTS.leaderboard_view);
      expect(storage.recordActivity).toHaveBeenCalled();
    });

    it('should award points for different activity types', async () => {
      expect(ACTIVITY_POINTS.leaderboard_view).toBe(5);
      expect(ACTIVITY_POINTS.profile_view).toBe(3);
      expect(ACTIVITY_POINTS.badge_preview).toBe(2);
      expect(ACTIVITY_POINTS.cta_click).toBe(10);
      expect(ACTIVITY_POINTS.command_use).toBe(5);
      expect(ACTIVITY_POINTS.return_visit).toBe(8);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce max points per hour', async () => {
      // Mock storage to return activities that sum to max points
      const recentActivities: ActivityRecord[] = [
        { type: 'cta_click', timestamp: new Date(), points: 10, penalized: false },
      ];
      storage.getRecentActivities = vi.fn().mockResolvedValue(recentActivities);

      const result = await gate.recordActivity('user-1', 'community-1', 'leaderboard_view');

      // Should be rate limited (10 points already earned)
      expect(result.pointsAwarded).toBe(0);
      expect(events.emit).toHaveBeenCalledWith('rate_limited', expect.any(Object));
    });

    it('should apply repeated action penalty after 3 repeats', async () => {
      // Mock 3 previous leaderboard_view activities
      const recentActivities: ActivityRecord[] = [
        { type: 'leaderboard_view', timestamp: new Date(), points: 5, penalized: false },
        { type: 'leaderboard_view', timestamp: new Date(), points: 5, penalized: false },
        { type: 'leaderboard_view', timestamp: new Date(), points: 5, penalized: false },
      ];
      storage.getRecentActivities = vi.fn().mockResolvedValue(recentActivities);

      // This is the 4th leaderboard_view, should get 50% penalty
      // But we're also at 15 points, so rate limited
      // Let's reduce the mock to under limit
      storage.getRecentActivities = vi.fn().mockResolvedValue([
        { type: 'leaderboard_view', timestamp: new Date(), points: 2, penalized: false },
        { type: 'leaderboard_view', timestamp: new Date(), points: 2, penalized: false },
        { type: 'leaderboard_view', timestamp: new Date(), points: 2, penalized: false },
      ]);

      const result = await gate.recordActivity('user-1', 'community-1', 'leaderboard_view');

      // Should get penalized (50% of 5 = 2 points)
      expect(result.pointsAwarded).toBe(2);
    });
  });

  describe('Access Checks', () => {
    it('should allow FREE access to all users', async () => {
      const result = await gate.checkAccess('user-1', 'community-1', STAGES.FREE);

      expect(result.allowed).toBe(true);
      expect(result.stage).toBe(STAGES.FREE);
    });

    it('should deny ENGAGED access to FREE users', async () => {
      const result = await gate.checkAccess('user-1', 'community-1', STAGES.ENGAGED);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Requires engaged');
    });

    it('should return correct blur levels', async () => {
      // FREE user
      let result = await gate.checkAccess('user-1', 'community-1', STAGES.FREE);
      expect(result.blurLevel).toBe(BLUR_LEVELS.FREE);

      // ENGAGED user
      const engagedState: EngagementState = {
        userId: 'user-2',
        communityId: 'community-1',
        stage: STAGES.ENGAGED,
        points: 60,
        pointsToNextStage: 0,
        progressPercent: 100,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      storage = createMockStorage(new Map([['user-2:community-1', engagedState]]));
      gate = createProgressiveGate(storage, events);

      result = await gate.checkAccess('user-2', 'community-1', STAGES.FREE);
      expect(result.blurLevel).toBe(BLUR_LEVELS.ENGAGED);
    });
  });

  describe('Stage Transitions', () => {
    it('should emit stage_transition event on promotion', async () => {
      // Set up user just below threshold
      const initialState: EngagementState = {
        userId: 'user-1',
        communityId: 'community-1',
        stage: STAGES.FREE,
        points: 45,
        pointsToNextStage: 5,
        progressPercent: 90,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storage = createMockStorage(new Map([['user-1:community-1', initialState]]));
      gate = createProgressiveGate(storage, events);

      // This activity should push them over 50 points
      await gate.recordActivity('user-1', 'community-1', 'leaderboard_view');

      // Check if stage_transition was emitted
      expect(events.emit).toHaveBeenCalledWith('stage_transition', expect.objectContaining({
        userId: 'user-1',
        communityId: 'community-1',
        fromStage: STAGES.FREE,
        toStage: STAGES.ENGAGED,
      }));
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate correct progress percent', async () => {
      // 25 points = 50% progress
      const state25: EngagementState = {
        userId: 'user-1',
        communityId: 'community-1',
        stage: STAGES.FREE,
        points: 25,
        pointsToNextStage: 25,
        progressPercent: 50,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storage = createMockStorage(new Map([['user-1:community-1', state25]]));
      gate = createProgressiveGate(storage, events);

      const state = await gate.getEngagementState('user-1', 'community-1');

      expect(state.progressPercent).toBe(50);
      expect(state.pointsToNextStage).toBe(25);
    });

    it('should cap progress at 100%', async () => {
      const state100: EngagementState = {
        userId: 'user-1',
        communityId: 'community-1',
        stage: STAGES.FREE,
        points: 100, // More than threshold
        pointsToNextStage: 0,
        progressPercent: 100,
        isVerified: false,
        verifiedAt: null,
        recentActivities: [],
        pointsEarnedThisHour: 0,
        canEarnMorePoints: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      storage = createMockStorage(new Map([['user-1:community-1', state100]]));
      gate = createProgressiveGate(storage, events);

      const state = await gate.getEngagementState('user-1', 'community-1');

      // Should be ENGAGED since points > 50
      expect(state.stage).toBe(STAGES.ENGAGED);
      expect(state.progressPercent).toBe(100);
    });
  });

  describe('Constants', () => {
    it('should have correct stage thresholds', () => {
      expect(STAGE_THRESHOLDS.FREE_MIN).toBe(0);
      expect(STAGE_THRESHOLDS.ENGAGED_MIN).toBe(50);
    });

    it('should have correct blur levels', () => {
      expect(BLUR_LEVELS.FREE).toBe(0.8);
      expect(BLUR_LEVELS.ENGAGED).toBe(0.3);
      expect(BLUR_LEVELS.VERIFIED).toBe(0);
    });

    it('should have correct rate limits', () => {
      expect(RATE_LIMITS.MAX_POINTS_PER_HOUR).toBe(10);
      expect(RATE_LIMITS.REPEATED_ACTION_THRESHOLD).toBe(3);
      expect(RATE_LIMITS.REPEATED_ACTION_MULTIPLIER).toBe(0.5);
    });
  });
});
