/**
 * Badge Evaluators Tests
 * Sprint S-17: Theme Interface & BasicTheme
 *
 * Tests for all badge evaluation functions.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateJoinOrder,
  evaluateTenure,
  evaluateTierReached,
  evaluateRecentActivity,
  evaluateManualGrant,
  evaluateBalanceStability,
  evaluateMarketSurvival,
  evaluateActivityStreak,
  evaluateEventParticipation,
  evaluateRankTenure,
  evaluateReferrals,
  evaluateBadge,
  evaluateAllBadges,
  BADGE_EVALUATORS,
} from '../badge-evaluators.js';
import type { BadgeConfig, Profile, ProfileHistory } from '../../../core/ports/theme-provider.js';

// --------------------------------------------------------------------------
// Test Fixtures
// --------------------------------------------------------------------------

const createMockBadge = (overrides: Partial<BadgeConfig> = {}): BadgeConfig => ({
  id: 'test-badge',
  name: 'Test',
  displayName: 'Test Badge',
  description: 'A test badge',
  emoji: '🏆',
  evaluator: 'manual_grant',
  parameters: {},
  rarity: 'common',
  ...overrides,
});

const createMockProfile = (overrides: Partial<Profile> = {}): Profile => ({
  userId: 'user-123',
  communityId: 'community-456',
  score: 1000,
  rank: 5,
  tierId: 'gold',
  joinedAt: new Date('2024-01-01'),
  joinPosition: 50,
  manualBadges: [],
  ...overrides,
});

const createMockHistory = (overrides: Partial<ProfileHistory> = {}): ProfileHistory => ({
  tenureDays: 100,
  daysSinceLastActivity: 1,
  activityStreakDays: 30,
  balanceEverDropped: false,
  marketDownturnsSurvived: 2,
  eventsAttended: 5,
  daysAtRankOrBetter: 50,
  referralCount: 3,
  tiersReached: ['bronze', 'silver', 'gold'],
  ...overrides,
});

// --------------------------------------------------------------------------
// Basic Evaluator Tests
// --------------------------------------------------------------------------

describe('Join Order Evaluator', () => {
  const badge = createMockBadge({
    id: 'early_adopter',
    evaluator: 'join_order',
    parameters: { maxPosition: 100 },
  });

  it('should award badge to early members', () => {
    const profile = createMockProfile({ joinPosition: 50 });
    const history = createMockHistory();

    const result = evaluateJoinOrder(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.badge.id).toBe('early_adopter');
    expect(result?.metadata?.joinPosition).toBe(50);
  });

  it('should not award badge to late members', () => {
    const profile = createMockProfile({ joinPosition: 150 });
    const history = createMockHistory();

    const result = evaluateJoinOrder(badge, profile, history);

    expect(result).toBeNull();
  });

  it('should award badge to member at exact boundary', () => {
    const profile = createMockProfile({ joinPosition: 100 });
    const history = createMockHistory();

    const result = evaluateJoinOrder(badge, profile, history);

    expect(result).not.toBeNull();
  });

  it('should handle invalid parameters', () => {
    const badBadge = createMockBadge({
      evaluator: 'join_order',
      parameters: { maxPosition: -1 },
    });
    const profile = createMockProfile();
    const history = createMockHistory();

    const result = evaluateJoinOrder(badBadge, profile, history);

    expect(result).toBeNull();
  });

  it('should set earnedAt to joinedAt date', () => {
    const joinDate = new Date('2024-06-15');
    const profile = createMockProfile({ joinPosition: 10, joinedAt: joinDate });
    const history = createMockHistory();

    const result = evaluateJoinOrder(badge, profile, history);

    expect(result?.earnedAt).toEqual(joinDate);
  });
});

describe('Tenure Evaluator', () => {
  const badge = createMockBadge({
    id: 'veteran',
    evaluator: 'tenure',
    parameters: { minDays: 180 },
  });

  it('should award badge to long-tenured members', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ tenureDays: 200 });

    const result = evaluateTenure(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.tenureDays).toBe(200);
  });

  it('should not award badge to new members', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ tenureDays: 30 });

    const result = evaluateTenure(badge, profile, history);

    expect(result).toBeNull();
  });

  it('should award badge at exact threshold', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ tenureDays: 180 });

    const result = evaluateTenure(badge, profile, history);

    expect(result).not.toBeNull();
  });

  it('should handle invalid parameters', () => {
    const badBadge = createMockBadge({
      evaluator: 'tenure',
      parameters: { minDays: 'invalid' },
    });
    const profile = createMockProfile();
    const history = createMockHistory();

    const result = evaluateTenure(badBadge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Tier Reached Evaluator', () => {
  const badge = createMockBadge({
    id: 'top_tier',
    evaluator: 'tier_reached',
    parameters: { tierId: 'gold' },
  });

  it('should award badge when current tier matches', () => {
    const profile = createMockProfile({ tierId: 'gold' });
    const history = createMockHistory();

    const result = evaluateTierReached(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.tierId).toBe('gold');
  });

  it('should award badge when tier was reached historically', () => {
    const profile = createMockProfile({ tierId: 'silver' });
    const history = createMockHistory({ tiersReached: ['bronze', 'silver', 'gold'] });

    const result = evaluateTierReached(badge, profile, history);

    expect(result).not.toBeNull();
  });

  it('should not award badge when tier never reached', () => {
    const profile = createMockProfile({ tierId: 'bronze' });
    const history = createMockHistory({ tiersReached: ['bronze'] });

    const result = evaluateTierReached(badge, profile, history);

    expect(result).toBeNull();
  });

  it('should handle invalid parameters', () => {
    const badBadge = createMockBadge({
      evaluator: 'tier_reached',
      parameters: { tierId: '' },
    });
    const profile = createMockProfile();
    const history = createMockHistory();

    const result = evaluateTierReached(badBadge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Recent Activity Evaluator', () => {
  const badge = createMockBadge({
    id: 'active',
    evaluator: 'recent_activity',
    parameters: { maxDays: 30 },
  });

  it('should award badge to recently active members', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ daysSinceLastActivity: 5 });

    const result = evaluateRecentActivity(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.daysSinceLastActivity).toBe(5);
  });

  it('should not award badge to inactive members', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ daysSinceLastActivity: 60 });

    const result = evaluateRecentActivity(badge, profile, history);

    expect(result).toBeNull();
  });

  it('should award badge at exact boundary', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ daysSinceLastActivity: 30 });

    const result = evaluateRecentActivity(badge, profile, history);

    expect(result).not.toBeNull();
  });

  it('should have null earnedAt (dynamic badge)', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ daysSinceLastActivity: 1 });

    const result = evaluateRecentActivity(badge, profile, history);

    expect(result?.earnedAt).toBeNull();
  });
});

describe('Manual Grant Evaluator', () => {
  const badge = createMockBadge({
    id: 'contributor',
    evaluator: 'manual_grant',
    parameters: {},
  });

  it('should award badge when manually granted', () => {
    const profile = createMockProfile({ manualBadges: ['contributor'] });
    const history = createMockHistory();

    const result = evaluateManualGrant(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.manuallyGranted).toBe(true);
  });

  it('should not award badge when not granted', () => {
    const profile = createMockProfile({ manualBadges: [] });
    const history = createMockHistory();

    const result = evaluateManualGrant(badge, profile, history);

    expect(result).toBeNull();
  });

  it('should not award wrong badge', () => {
    const profile = createMockProfile({ manualBadges: ['other_badge'] });
    const history = createMockHistory();

    const result = evaluateManualGrant(badge, profile, history);

    expect(result).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Advanced Evaluator Tests (S-18 preparation)
// --------------------------------------------------------------------------

describe('Balance Stability Evaluator', () => {
  const badge = createMockBadge({
    id: 'diamond_hands',
    evaluator: 'balance_stability',
    parameters: { minRetention: 1.0 },
  });

  it('should award badge when balance never dropped', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ balanceEverDropped: false });

    const result = evaluateBalanceStability(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.balanceEverDropped).toBe(false);
  });

  it('should not award badge when balance dropped', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ balanceEverDropped: true });

    const result = evaluateBalanceStability(badge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Market Survival Evaluator', () => {
  const badge = createMockBadge({
    id: 'survivor',
    evaluator: 'market_survival',
    parameters: { minEvents: 3 },
  });

  it('should award badge for sufficient downturns survived', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ marketDownturnsSurvived: 5 });

    const result = evaluateMarketSurvival(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.downturns).toBe(5);
  });

  it('should not award badge for insufficient downturns', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ marketDownturnsSurvived: 1 });

    const result = evaluateMarketSurvival(badge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Activity Streak Evaluator', () => {
  const badge = createMockBadge({
    id: 'streak',
    evaluator: 'activity_streak',
    parameters: { minStreak: 30 },
  });

  it('should award badge for long streaks', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ activityStreakDays: 45 });

    const result = evaluateActivityStreak(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.streakDays).toBe(45);
  });

  it('should not award badge for short streaks', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ activityStreakDays: 10 });

    const result = evaluateActivityStreak(badge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Event Participation Evaluator', () => {
  const badge = createMockBadge({
    id: 'event_goer',
    evaluator: 'event_participation',
    parameters: { minEvents: 10 },
  });

  it('should award badge for sufficient events', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ eventsAttended: 15 });

    const result = evaluateEventParticipation(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.eventsAttended).toBe(15);
  });

  it('should not award badge for insufficient events', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ eventsAttended: 3 });

    const result = evaluateEventParticipation(badge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Rank Tenure Evaluator', () => {
  const badge = createMockBadge({
    id: 'elite',
    evaluator: 'rank_tenure',
    parameters: { maxRank: 10, minDays: 90 },
  });

  it('should award badge for long tenure at top rank', () => {
    const profile = createMockProfile({ rank: 5 });
    const history = createMockHistory({ daysAtRankOrBetter: 120 });

    const result = evaluateRankTenure(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.currentRank).toBe(5);
    expect(result?.metadata?.daysAtRank).toBe(120);
  });

  it('should not award badge if rank too low', () => {
    const profile = createMockProfile({ rank: 50 });
    const history = createMockHistory({ daysAtRankOrBetter: 120 });

    const result = evaluateRankTenure(badge, profile, history);

    expect(result).toBeNull();
  });

  it('should not award badge if tenure too short', () => {
    const profile = createMockProfile({ rank: 5 });
    const history = createMockHistory({ daysAtRankOrBetter: 30 });

    const result = evaluateRankTenure(badge, profile, history);

    expect(result).toBeNull();
  });
});

describe('Referrals Evaluator', () => {
  const badge = createMockBadge({
    id: 'recruiter',
    evaluator: 'referrals',
    parameters: { minReferrals: 5 },
  });

  it('should award badge for sufficient referrals', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ referralCount: 10 });

    const result = evaluateReferrals(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.metadata?.referrals).toBe(10);
  });

  it('should not award badge for insufficient referrals', () => {
    const profile = createMockProfile();
    const history = createMockHistory({ referralCount: 2 });

    const result = evaluateReferrals(badge, profile, history);

    expect(result).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Evaluator Registry Tests
// --------------------------------------------------------------------------

describe('BADGE_EVALUATORS Registry', () => {
  it('should have all basic evaluators', () => {
    expect(BADGE_EVALUATORS.join_order).toBeDefined();
    expect(BADGE_EVALUATORS.tenure).toBeDefined();
    expect(BADGE_EVALUATORS.tier_reached).toBeDefined();
    expect(BADGE_EVALUATORS.recent_activity).toBeDefined();
    expect(BADGE_EVALUATORS.manual_grant).toBeDefined();
  });

  it('should have all advanced evaluators', () => {
    expect(BADGE_EVALUATORS.balance_stability).toBeDefined();
    expect(BADGE_EVALUATORS.market_survival).toBeDefined();
    expect(BADGE_EVALUATORS.activity_streak).toBeDefined();
    expect(BADGE_EVALUATORS.event_participation).toBeDefined();
    expect(BADGE_EVALUATORS.rank_tenure).toBeDefined();
    expect(BADGE_EVALUATORS.referrals).toBeDefined();
  });

  it('should have 11 total evaluators', () => {
    expect(Object.keys(BADGE_EVALUATORS)).toHaveLength(11);
  });
});

// --------------------------------------------------------------------------
// Utility Function Tests
// --------------------------------------------------------------------------

describe('evaluateBadge', () => {
  it('should use correct evaluator for badge type', () => {
    const badge = createMockBadge({
      id: 'early',
      evaluator: 'join_order',
      parameters: { maxPosition: 100 },
    });
    const profile = createMockProfile({ joinPosition: 10 });
    const history = createMockHistory();

    const result = evaluateBadge(badge, profile, history);

    expect(result).not.toBeNull();
    expect(result?.badge.id).toBe('early');
  });

  it('should return null for unknown evaluator type', () => {
    const badge = {
      ...createMockBadge(),
      evaluator: 'unknown_type' as any,
    };
    const profile = createMockProfile();
    const history = createMockHistory();

    const result = evaluateBadge(badge, profile, history);

    expect(result).toBeNull();
  });
});

describe('evaluateAllBadges', () => {
  it('should evaluate multiple badges', () => {
    const badges = [
      createMockBadge({
        id: 'early',
        evaluator: 'join_order',
        parameters: { maxPosition: 100 },
      }),
      createMockBadge({
        id: 'active',
        evaluator: 'recent_activity',
        parameters: { maxDays: 30 },
      }),
    ];
    const profile = createMockProfile({ joinPosition: 50 });
    const history = createMockHistory({ daysSinceLastActivity: 5 });

    const results = evaluateAllBadges(badges, profile, history);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.badge.id)).toContain('early');
    expect(results.map((r) => r.badge.id)).toContain('active');
  });

  it('should filter out unearned badges', () => {
    const badges = [
      createMockBadge({
        id: 'early',
        evaluator: 'join_order',
        parameters: { maxPosition: 10 }, // Won't earn this
      }),
      createMockBadge({
        id: 'active',
        evaluator: 'recent_activity',
        parameters: { maxDays: 30 },
      }),
    ];
    const profile = createMockProfile({ joinPosition: 500 }); // Too late
    const history = createMockHistory({ daysSinceLastActivity: 5 });

    const results = evaluateAllBadges(badges, profile, history);

    expect(results).toHaveLength(1);
    expect(results[0].badge.id).toBe('active');
  });

  it('should return empty array when no badges earned', () => {
    const badges = [
      createMockBadge({
        id: 'early',
        evaluator: 'join_order',
        parameters: { maxPosition: 10 },
      }),
    ];
    const profile = createMockProfile({ joinPosition: 500 });
    const history = createMockHistory();

    const results = evaluateAllBadges(badges, profile, history);

    expect(results).toHaveLength(0);
  });
});
