/**
 * Theme Provider Interface Tests
 * Sprint S-17: Theme Interface & BasicTheme
 *
 * Tests for theme provider type definitions and validation utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  type IThemeProvider,
  type TierConfig,
  type BadgeConfig,
  type NamingConfig,
  type TierResult,
  type EarnedBadge,
  type Profile,
  type ProfileHistory,
  type BadgeEvaluatorType,
  type BadgeRarity,
  type SubscriptionTier,
  type ThemeValidationResult,
  validateTheme,
  DEFAULT_NAMING_CONFIG,
} from '../theme-provider.js';

// --------------------------------------------------------------------------
// Test Fixtures
// --------------------------------------------------------------------------

const createMockTier = (overrides: Partial<TierConfig> = {}): TierConfig => ({
  id: 'test-tier',
  name: 'Test',
  displayName: 'Test Tier',
  minRank: 1,
  maxRank: 10,
  roleColor: 0xffffff,
  permissions: [],
  ...overrides,
});

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

// Create a mock theme for validation tests
class MockTheme implements IThemeProvider {
  readonly id = 'mock';
  readonly name = 'Mock Theme';
  readonly description = 'A mock theme for testing';
  readonly subscriptionTier: SubscriptionTier = 'free';

  constructor(
    private tiers: TierConfig[] = [
      createMockTier({ id: 'high', minRank: 1, maxRank: 10 }),
      createMockTier({ id: 'low', minRank: 11, maxRank: 100 }),
    ],
    private badges: BadgeConfig[] = [createMockBadge()]
  ) {}

  getTierConfig(): TierConfig[] {
    return this.tiers;
  }

  getBadgeConfig(): BadgeConfig[] {
    return this.badges;
  }

  getNamingConfig(): NamingConfig {
    return DEFAULT_NAMING_CONFIG;
  }

  evaluateTier(score: number, totalMembers: number, rank: number): TierResult {
    const tier = this.tiers.find((t) => rank >= t.minRank && rank <= t.maxRank);
    return {
      tier: tier ?? this.tiers[this.tiers.length - 1],
      score,
      rank,
      percentile: Math.round((1 - (rank - 1) / totalMembers) * 100),
    };
  }

  evaluateBadges(_profile: Profile, _history: ProfileHistory): EarnedBadge[] {
    return [];
  }
}

// --------------------------------------------------------------------------
// Type Definition Tests
// --------------------------------------------------------------------------

describe('Theme Provider Types', () => {
  describe('SubscriptionTier', () => {
    it('should accept valid subscription tiers', () => {
      const tiers: SubscriptionTier[] = ['free', 'pro', 'enterprise'];
      expect(tiers).toHaveLength(3);
    });
  });

  describe('BadgeEvaluatorType', () => {
    it('should include all basic evaluator types', () => {
      const basicTypes: BadgeEvaluatorType[] = [
        'join_order',
        'tenure',
        'tier_reached',
        'recent_activity',
        'manual_grant',
      ];
      expect(basicTypes).toHaveLength(5);
    });

    it('should include all advanced evaluator types', () => {
      const advancedTypes: BadgeEvaluatorType[] = [
        'balance_stability',
        'market_survival',
        'activity_streak',
        'event_participation',
        'rank_tenure',
        'referrals',
      ];
      expect(advancedTypes).toHaveLength(6);
    });
  });

  describe('BadgeRarity', () => {
    it('should accept all rarity levels', () => {
      const rarities: BadgeRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      expect(rarities).toHaveLength(5);
    });
  });
});

// --------------------------------------------------------------------------
// TierConfig Tests
// --------------------------------------------------------------------------

describe('TierConfig', () => {
  it('should create a valid tier config', () => {
    const tier = createMockTier({
      id: 'gold',
      name: 'Gold',
      displayName: 'Gold Member',
      minRank: 1,
      maxRank: 10,
      roleColor: 0xffd700,
      permissions: ['view_analytics'],
      emoji: '🥇',
    });

    expect(tier.id).toBe('gold');
    expect(tier.name).toBe('Gold');
    expect(tier.displayName).toBe('Gold Member');
    expect(tier.minRank).toBe(1);
    expect(tier.maxRank).toBe(10);
    expect(tier.roleColor).toBe(0xffd700);
    expect(tier.permissions).toContain('view_analytics');
    expect(tier.emoji).toBe('🥇');
  });

  it('should allow optional emoji', () => {
    const tier = createMockTier({ emoji: undefined });
    expect(tier.emoji).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// BadgeConfig Tests
// --------------------------------------------------------------------------

describe('BadgeConfig', () => {
  it('should create a valid badge config', () => {
    const badge = createMockBadge({
      id: 'early_adopter',
      name: 'Early Adopter',
      displayName: 'Early Adopter',
      description: 'First 100 members',
      emoji: '🌟',
      evaluator: 'join_order',
      parameters: { maxPosition: 100 },
      rarity: 'rare',
    });

    expect(badge.id).toBe('early_adopter');
    expect(badge.evaluator).toBe('join_order');
    expect(badge.parameters.maxPosition).toBe(100);
    expect(badge.rarity).toBe('rare');
  });

  it('should support all evaluator types', () => {
    const evaluatorTypes: BadgeEvaluatorType[] = [
      'join_order',
      'tenure',
      'tier_reached',
      'recent_activity',
      'manual_grant',
      'balance_stability',
      'market_survival',
      'activity_streak',
      'event_participation',
      'rank_tenure',
      'referrals',
    ];

    for (const evaluator of evaluatorTypes) {
      const badge = createMockBadge({ evaluator });
      expect(badge.evaluator).toBe(evaluator);
    }
  });
});

// --------------------------------------------------------------------------
// NamingConfig Tests
// --------------------------------------------------------------------------

describe('NamingConfig', () => {
  it('should have default naming config', () => {
    expect(DEFAULT_NAMING_CONFIG.tierPrefix).toBe('Rank');
    expect(DEFAULT_NAMING_CONFIG.tierSuffix).toBe('');
    expect(DEFAULT_NAMING_CONFIG.communityNoun).toBe('Members');
    expect(DEFAULT_NAMING_CONFIG.leaderboardTitle).toBe('Top Holders');
    expect(DEFAULT_NAMING_CONFIG.scoreLabel).toBe('Score');
  });
});

// --------------------------------------------------------------------------
// Profile Tests
// --------------------------------------------------------------------------

describe('Profile', () => {
  it('should create a valid profile', () => {
    const profile = createMockProfile({
      userId: 'user-abc',
      communityId: 'community-xyz',
      score: 5000,
      rank: 3,
      tierId: 'gold',
      joinPosition: 10,
    });

    expect(profile.userId).toBe('user-abc');
    expect(profile.communityId).toBe('community-xyz');
    expect(profile.score).toBe(5000);
    expect(profile.rank).toBe(3);
    expect(profile.tierId).toBe('gold');
    expect(profile.joinPosition).toBe(10);
  });
});

// --------------------------------------------------------------------------
// ProfileHistory Tests
// --------------------------------------------------------------------------

describe('ProfileHistory', () => {
  it('should create a valid profile history', () => {
    const history = createMockHistory({
      tenureDays: 365,
      daysSinceLastActivity: 0,
      activityStreakDays: 100,
      balanceEverDropped: false,
    });

    expect(history.tenureDays).toBe(365);
    expect(history.daysSinceLastActivity).toBe(0);
    expect(history.activityStreakDays).toBe(100);
    expect(history.balanceEverDropped).toBe(false);
  });

  it('should track tiers reached', () => {
    const history = createMockHistory({
      tiersReached: ['bronze', 'silver', 'gold'],
    });

    expect(history.tiersReached).toContain('bronze');
    expect(history.tiersReached).toContain('silver');
    expect(history.tiersReached).toContain('gold');
  });
});

// --------------------------------------------------------------------------
// Theme Validation Tests
// --------------------------------------------------------------------------

describe('validateTheme', () => {
  it('should validate a correct theme', () => {
    const theme = new MockTheme();
    const result = validateTheme(theme);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject theme with fewer than 2 tiers', () => {
    const theme = new MockTheme([createMockTier()]);
    const result = validateTheme(theme);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Theme must have at least 2 tiers');
  });

  it('should reject overlapping tier ranges', () => {
    const theme = new MockTheme([
      createMockTier({ id: 'tier1', minRank: 1, maxRank: 20 }),
      createMockTier({ id: 'tier2', minRank: 15, maxRank: 50 }), // Overlaps!
    ]);
    const result = validateTheme(theme);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('overlap'))).toBe(true);
  });

  it('should reject duplicate tier IDs', () => {
    const theme = new MockTheme([
      createMockTier({ id: 'same', minRank: 1, maxRank: 10 }),
      createMockTier({ id: 'same', minRank: 11, maxRank: 50 }), // Duplicate!
    ]);
    const result = validateTheme(theme);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate tier ID: same');
  });

  it('should reject duplicate badge IDs', () => {
    const theme = new MockTheme(
      [
        createMockTier({ id: 'tier1', minRank: 1, maxRank: 10 }),
        createMockTier({ id: 'tier2', minRank: 11, maxRank: 50 }),
      ],
      [createMockBadge({ id: 'same' }), createMockBadge({ id: 'same' })] // Duplicate!
    );
    const result = validateTheme(theme);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Duplicate badge ID: same');
  });

  it('should allow adjacent (non-overlapping) tier ranges', () => {
    const theme = new MockTheme([
      createMockTier({ id: 'tier1', minRank: 1, maxRank: 10 }),
      createMockTier({ id: 'tier2', minRank: 11, maxRank: 50 }), // Adjacent, not overlapping
    ]);
    const result = validateTheme(theme);

    expect(result.valid).toBe(true);
  });
});

// --------------------------------------------------------------------------
// IThemeProvider Interface Tests
// --------------------------------------------------------------------------

describe('IThemeProvider', () => {
  it('should implement required properties', () => {
    const theme = new MockTheme();

    expect(theme.id).toBe('mock');
    expect(theme.name).toBe('Mock Theme');
    expect(theme.description).toBe('A mock theme for testing');
    expect(theme.subscriptionTier).toBe('free');
  });

  it('should implement getTierConfig', () => {
    const theme = new MockTheme();
    const tiers = theme.getTierConfig();

    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBeGreaterThanOrEqual(2);
  });

  it('should implement getBadgeConfig', () => {
    const theme = new MockTheme();
    const badges = theme.getBadgeConfig();

    expect(Array.isArray(badges)).toBe(true);
  });

  it('should implement getNamingConfig', () => {
    const theme = new MockTheme();
    const naming = theme.getNamingConfig();

    expect(naming.tierPrefix).toBeDefined();
    expect(naming.communityNoun).toBeDefined();
    expect(naming.leaderboardTitle).toBeDefined();
    expect(naming.scoreLabel).toBeDefined();
  });

  it('should implement evaluateTier', () => {
    const theme = new MockTheme();
    const result = theme.evaluateTier(1000, 500, 5);

    expect(result.tier).toBeDefined();
    expect(result.score).toBe(1000);
    expect(result.rank).toBe(5);
    expect(typeof result.percentile).toBe('number');
  });

  it('should implement evaluateBadges', () => {
    const theme = new MockTheme();
    const profile = createMockProfile();
    const history = createMockHistory();
    const badges = theme.evaluateBadges(profile, history);

    expect(Array.isArray(badges)).toBe(true);
  });
});
