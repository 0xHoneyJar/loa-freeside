/**
 * Stats System Integration Tests
 *
 * Tests StatsService against its CURRENT API surface:
 * - getPersonalStats() — tier progress, activity, badges (sync)
 * - getCommunityStats() — aggregated public stats
 * - getAdminAnalytics() — dashboard analytics
 * - getTierLeaderboard() / getMemberTierProgressionRank()
 *
 * Direct sqlite queries run against a real in-memory better-sqlite3
 * database; the profile/activity/badge helpers (which live behind the db
 * barrel) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Mock config (ChainService + BoostService construct at module load via the
// services barrel and read these keys)
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      guildId: 'guild',
      channels: { census: 'channel-census' },
    },
    chain: {
      rpcUrls: ['https://rpc.test.example.com'],
      provider: 'rpc',
      bgtAddress: '0x0000000000000000000000000000000000000001',
      startBlock: 0,
    },
    boost: {
      thresholds: { level1: 2, level2: 7, level3: 14 },
      pricing: { pricePerMonthCents: 500 },
      bundles: undefined,
    },
    paddle: undefined,
  },
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// getDatabase() returns a real in-memory sqlite database per test; the
// profile/badge helpers are mocked.
let db: Database.Database;
const mockGetMemberProfileByDiscordId = vi.fn();
const mockGetMemberProfileById = vi.fn();
const mockGetMemberBadges = vi.fn();
const mockGetMemberActivity = vi.fn();
const mockGetMemberBadgeCount = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => db),
  getMemberProfileByDiscordId: mockGetMemberProfileByDiscordId,
  getMemberProfileById: mockGetMemberProfileById,
  getMemberBadges: mockGetMemberBadges,
  getMemberActivity: mockGetMemberActivity,
  getMemberBadgeCount: mockGetMemberBadgeCount,
  calculateTenureCategory: vi.fn(() => 'established'),
  logAuditEvent: vi.fn(),
}));

const mockGetOwnStats = vi.fn();
vi.mock('../../src/services/activity.js', () => ({
  getOwnStats: mockGetOwnStats,
}));

// Import after mocks
const { statsService } = await import('../../src/services/StatsService.js');

const SCHEMA = `
  CREATE TABLE member_profiles (
    member_id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    nym TEXT NOT NULL,
    tier TEXT NOT NULL,
    onboarding_complete INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE wallet_mappings (
    discord_user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL
  );
  CREATE TABLE eligibility_snapshot (
    wallet_address TEXT NOT NULL,
    bgt_held TEXT NOT NULL,
    rank INTEGER,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE tier_history (
    member_id TEXT NOT NULL,
    old_tier TEXT,
    new_tier TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE member_badges (
    member_id TEXT NOT NULL,
    awarded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE member_activity (
    member_id TEXT NOT NULL,
    activity_balance INTEGER NOT NULL DEFAULT 0,
    total_messages INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT
  );
`;

const BGT = (whole: number) => (BigInt(whole) * 10n ** 18n).toString();

function seedMember(opts: {
  id: string;
  tier?: string;
  bgt?: number;
  rank?: number | null;
  createdDaysAgo?: number;
  activityBalance?: number;
  activeDaysAgo?: number;
}) {
  const created =
    opts.createdDaysAgo !== undefined
      ? `datetime('now', '-${opts.createdDaysAgo} days')`
      : `datetime('now', '-30 days')`;
  db.prepare(
    `INSERT INTO member_profiles (member_id, discord_user_id, nym, tier, onboarding_complete, created_at)
     VALUES (?, ?, ?, ?, 1, ${created})`
  ).run(opts.id, `discord-${opts.id}`, `Nym-${opts.id}`, opts.tier ?? 'hajra');
  db.prepare('INSERT INTO wallet_mappings (discord_user_id, wallet_address) VALUES (?, ?)').run(
    `discord-${opts.id}`,
    `0xwallet-${opts.id}`
  );
  db.prepare(
    'INSERT INTO eligibility_snapshot (wallet_address, bgt_held, rank) VALUES (?, ?, ?)'
  ).run(`0xwallet-${opts.id}`, BGT(opts.bgt ?? 10), opts.rank ?? null);
  if (opts.activityBalance !== undefined) {
    const lastActive =
      opts.activeDaysAgo !== undefined
        ? `datetime('now', '-${opts.activeDaysAgo} days')`
        : `datetime('now', '-1 day')`;
    db.prepare(
      `INSERT INTO member_activity (member_id, activity_balance, last_active_at)
       VALUES (?, ?, ${lastActive})`
    ).run(opts.id, opts.activityBalance);
  }
}

describe('Stats System Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    db.exec(SCHEMA);
    mockGetMemberBadges.mockReturnValue([]);
  });

  afterEach(() => {
    db.close();
  });

  describe('Personal Stats', () => {
    function seedPersonal() {
      seedMember({ id: 'm1', tier: 'ichwan', bgt: 100, activityBalance: 200 });
      mockGetMemberProfileByDiscordId.mockReturnValue({
        memberId: 'm1',
        discordUserId: 'discord-m1',
        nym: 'Nym-m1',
        tier: 'ichwan',
        onboardingComplete: true,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      });
      mockGetOwnStats.mockReturnValue({ activityBalance: 200 });
    }

    it('should collect complete personal stats', () => {
      seedPersonal();
      mockGetMemberBadges.mockReturnValue([
        {
          badgeId: 'b1',
          name: 'First Steps',
          description: 'desc',
          category: 'milestone',
          emoji: '🏅',
          awardedAt: new Date(),
        },
      ]);

      const stats = statsService.getPersonalStats('discord-m1');

      expect(stats).not.toBeNull();
      expect(stats!.nym).toBe('Nym-m1');
      expect(stats!.memberId).toBe('m1');
      expect(stats!.tier).toBe('ichwan');
      expect(stats!.tierProgress).toBeDefined();
      expect(stats!.badgeCount).toBe(1);
      expect(stats!.badges).toHaveLength(1);
      expect(stats!.messagesThisWeek).toBe(20); // activityBalance / 10
      expect(stats!.tenureCategory).toBe('established');
    });

    it('should return null for unknown member', () => {
      mockGetMemberProfileByDiscordId.mockReturnValue(null);
      expect(statsService.getPersonalStats('discord-unknown')).toBeNull();
    });

    it('should return null when onboarding is incomplete', () => {
      mockGetMemberProfileByDiscordId.mockReturnValue({
        memberId: 'm1',
        nym: 'Nym-m1',
        tier: 'hajra',
        onboardingComplete: false,
        createdAt: new Date(),
      });
      expect(statsService.getPersonalStats('discord-m1')).toBeNull();
    });

    it('should return null when activity stats are missing', () => {
      seedPersonal();
      mockGetOwnStats.mockReturnValue(null);
      expect(statsService.getPersonalStats('discord-m1')).toBeNull();
    });
  });

  describe('Community Stats', () => {
    it('should aggregate totals, tiers, BGT and weekly active', () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100, activityBalance: 50 });
      seedMember({ id: 'm2', tier: 'fedaykin', bgt: 500, activityBalance: 80 });
      seedMember({ id: 'm3', tier: 'hajra', bgt: 25, activityBalance: 10, activeDaysAgo: 30 });

      const stats = statsService.getCommunityStats();

      expect(stats.total_members).toBe(3);
      expect(stats.members_by_tier.hajra).toBe(2);
      expect(stats.members_by_tier.fedaykin).toBe(1);
      // BigInt-safe wei sum: 625 BGT (would saturate int64 via CAST)
      expect(stats.total_bgt).toBe(625);
      expect(stats.weekly_active).toBe(2); // m3 last active 30 days ago
    });

    it('should handle an empty community', () => {
      const stats = statsService.getCommunityStats();
      expect(stats.total_members).toBe(0);
      expect(stats.total_bgt).toBe(0);
      expect(stats.weekly_active).toBe(0);
    });
  });

  describe('Admin Analytics', () => {
    it('should include weekly deltas and most active tier', () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100, activityBalance: 50 });
      seedMember({ id: 'm2', tier: 'fedaykin', bgt: 500, activityBalance: 300 });
      seedMember({ id: 'm3', tier: 'hajra', bgt: 25, activityBalance: 40, createdDaysAgo: 2 });

      db.prepare(
        `INSERT INTO tier_history (member_id, old_tier, new_tier, changed_at)
         VALUES ('m1', 'hajra', 'ichwan', datetime('now', '-1 day'))`
      ).run();
      db.prepare(
        `INSERT INTO member_badges (member_id, awarded_at) VALUES ('m1', datetime('now', '-1 day'))`
      ).run();

      const analytics = statsService.getAdminAnalytics();

      expect(analytics.totalMembers).toBe(3);
      expect(analytics.newThisWeek).toBe(1);
      expect(analytics.promotionsThisWeek).toBe(1);
      expect(analytics.badgesAwardedThisWeek).toBe(1);
      expect(analytics.mostActiveTier).toBe('fedaykin'); // 300 > 50+40
      expect(analytics.totalBgt).toBe(625);
      expect(analytics.totalBgtWei).toBe(BGT(625));
    });
  });

  describe('Tier Progression Leaderboard', () => {
    it('should rank progressing members by distance to next tier and exclude rank-based tiers', () => {
      // Two hajra members with different BGT — the richer one is closer to
      // the next tier. Rank-based tiers are excluded entirely.
      seedMember({ id: 'close', tier: 'hajra', bgt: 60 });
      seedMember({ id: 'far', tier: 'hajra', bgt: 20 });
      seedMember({ id: 'naib', tier: 'naib', bgt: 100000 });
      seedMember({ id: 'fedaykin', tier: 'fedaykin', bgt: 50000 });

      const leaderboard = statsService.getTierLeaderboard(10);

      const ids = leaderboard.map((e) => e.memberId);
      expect(ids).not.toContain('naib');
      expect(ids).not.toContain('fedaykin');
      expect(leaderboard.length).toBeGreaterThanOrEqual(2);

      // Sorted ascending by distance, ranks assigned 1..n
      for (let i = 1; i < leaderboard.length; i++) {
        expect(leaderboard[i].distanceToNextTier).toBeGreaterThanOrEqual(
          leaderboard[i - 1].distanceToNextTier
        );
        expect(leaderboard[i].rank).toBe(i + 1);
      }
      expect(leaderboard[0].rank).toBe(1);
      // The closer member outranks the farther one
      const closeRank = leaderboard.find((e) => e.memberId === 'close')?.rank;
      const farRank = leaderboard.find((e) => e.memberId === 'far')?.rank;
      expect(closeRank).toBeDefined();
      expect(farRank).toBeDefined();
      expect(closeRank!).toBeLessThan(farRank!);
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        seedMember({ id: `m${i}`, tier: 'hajra', bgt: 10 + i });
      }
      const leaderboard = statsService.getTierLeaderboard(3);
      expect(leaderboard.length).toBeLessThanOrEqual(3);
    });

    it('should report a member leaderboard rank (or null when not progressing)', () => {
      seedMember({ id: 'close', tier: 'hajra', bgt: 60 });
      seedMember({ id: 'naib', tier: 'naib', bgt: 100000 });

      expect(statsService.getMemberTierProgressionRank('close')).toBe(1);
      expect(statsService.getMemberTierProgressionRank('naib')).toBeNull();
    });
  });
});
