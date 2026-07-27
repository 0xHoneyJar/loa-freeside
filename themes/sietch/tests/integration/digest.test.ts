/**
 * Weekly Digest Integration Tests
 *
 * Tests weekly digest system:
 * - Stats collection (members, BGT, tiers, promotions, badges)
 * - Digest formatting
 * - Posting to announcements channel with duplicate protection
 * - Persistent storage in weekly_digests
 *
 * Runs against the CURRENT DigestService API: collectWeeklyStats() is
 * synchronous and queries sqlite directly via getDatabase(). Uses a real
 * in-memory better-sqlite3 database instead of mocking DB helpers that no
 * longer exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Mock config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      channels: { announcements: 'channel-announcements' },
      guildId: 'guild',
      botToken: 'token',
    },
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

// getDatabase() returns a real in-memory sqlite database per test
let db: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getDatabase: vi.fn(() => db),
  logAuditEvent: vi.fn(),
}));

// Import after mocks
const { digestService } = await import('../../src/services/DigestService.js');

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
    last_active_at TEXT
  );
  CREATE TABLE weekly_digests (
    week_identifier TEXT PRIMARY KEY,
    total_members INTEGER NOT NULL,
    new_members INTEGER NOT NULL,
    total_bgt TEXT NOT NULL,
    tier_distribution TEXT NOT NULL,
    most_active_tier TEXT,
    promotions_count INTEGER NOT NULL,
    notable_promotions TEXT NOT NULL,
    badges_awarded INTEGER NOT NULL,
    top_new_member_nym TEXT,
    message_id TEXT,
    channel_id TEXT,
    generated_at TEXT NOT NULL
  );
`;

const BGT = (whole: number) => (BigInt(whole) * 10n ** 18n).toString();

function seedMember(opts: {
  id: string;
  nym?: string;
  tier?: string;
  bgt?: number;
  createdDaysAgo?: number;
}) {
  const created =
    opts.createdDaysAgo !== undefined
      ? `datetime('now', '-${opts.createdDaysAgo} days')`
      : `datetime('now', '-30 days')`;
  db.prepare(
    `INSERT INTO member_profiles (member_id, discord_user_id, nym, tier, onboarding_complete, created_at)
     VALUES (?, ?, ?, ?, 1, ${created})`
  ).run(opts.id, `discord-${opts.id}`, opts.nym ?? `Nym-${opts.id}`, opts.tier ?? 'hajra');
  db.prepare('INSERT INTO wallet_mappings (discord_user_id, wallet_address) VALUES (?, ?)').run(
    `discord-${opts.id}`,
    `0xwallet-${opts.id}`
  );
  db.prepare('INSERT INTO eligibility_snapshot (wallet_address, bgt_held) VALUES (?, ?)').run(
    `0xwallet-${opts.id}`,
    BGT(opts.bgt ?? 10)
  );
}

function makeTextChannel() {
  return {
    isTextBased: () => true,
    send: vi.fn(async () => ({ id: 'msg-1', channelId: 'channel-announcements' })),
  };
}

describe('Weekly Digest Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(':memory:');
    db.exec(SCHEMA);
  });

  afterEach(() => {
    db.close();
  });

  describe('Stats Collection', () => {
    it('should collect all required weekly stats', () => {
      // 3 long-standing members + 2 new this week
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100 });
      seedMember({ id: 'm2', tier: 'fedaykin', bgt: 500 });
      seedMember({ id: 'm3', tier: 'naib', bgt: 1000 });
      seedMember({ id: 'm4', tier: 'hajra', bgt: 50, createdDaysAgo: 2 });
      seedMember({ id: 'm5', tier: 'ichwan', bgt: 250, createdDaysAgo: 1 });

      // A promotion this week (old_tier NOT NULL) and an initial assignment
      db.prepare(
        `INSERT INTO tier_history (member_id, old_tier, new_tier, changed_at)
         VALUES ('m2', 'usul', 'fedaykin', datetime('now', '-1 day'))`
      ).run();
      db.prepare(
        `INSERT INTO tier_history (member_id, old_tier, new_tier, changed_at)
         VALUES ('m4', NULL, 'hajra', datetime('now', '-1 day'))`
      ).run();

      // Badges this week
      db.prepare(
        `INSERT INTO member_badges (member_id, awarded_at) VALUES ('m1', datetime('now', '-2 days'))`
      ).run();
      db.prepare(
        `INSERT INTO member_badges (member_id, awarded_at) VALUES ('m2', datetime('now', '-1 day'))`
      ).run();

      const stats = digestService.collectWeeklyStats();

      expect(stats.totalMembers).toBe(5);
      expect(stats.newMembers).toBe(2);
      expect(stats.totalBgt).toBe(1900); // 100+500+1000+50+250
      expect(stats.promotionsCount).toBe(1); // initial assignment excluded
      expect(stats.notablePromotions).toEqual([{ nym: 'Nym-m2', newTier: 'fedaykin' }]);
      expect(stats.badgesAwarded).toBe(2);
      expect(stats.tierDistribution.hajra).toBe(2);
      expect(stats.tierDistribution.fedaykin).toBe(1);
      expect(stats.tierDistribution.naib).toBe(1);
      // Top new member by BGT is the ichwan joiner with 250
      expect(stats.topNewMember).toEqual({ nym: 'Nym-m5', tier: 'ichwan' });
      expect(stats.weekIdentifier).toMatch(/^\d{4}-W\d{2}$/);
    });

    it('ranks top new member correctly when bgt_held has leading zeros', () => {
      // bgt_held is a wei string. LENGTH-then-lexicographic ordering is exact
      // only for CANONICAL integer strings: a non-canonical '000…' value (as
      // legacy/imported rows can carry) is longer than a genuinely larger
      // canonical value, so without normalization it wins the ranking.
      seedMember({ id: 'small', nym: 'LeadingZeros', tier: 'hajra', createdDaysAgo: 1 });
      seedMember({ id: 'big', nym: 'GenuineTop', tier: 'ichwan', createdDaysAgo: 1 });

      // '00000000000000000001' (20 chars) vs '999999999999999999' (18 chars).
      // Length-first without LTRIM ranks the leading-zero row first; the real
      // maximum is GenuineTop.
      db.prepare('UPDATE eligibility_snapshot SET bgt_held = ? WHERE wallet_address = ?').run(
        '00000000000000000001',
        '0xwallet-small'
      );
      db.prepare('UPDATE eligibility_snapshot SET bgt_held = ? WHERE wallet_address = ?').run(
        '999999999999999999',
        '0xwallet-big'
      );

      const stats = digestService.collectWeeklyStats();

      expect(stats.topNewMember).toEqual({ nym: 'GenuineTop', tier: 'ichwan' });
    });

    it('should handle zero new members gracefully', () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100 });

      const stats = digestService.collectWeeklyStats();

      expect(stats.totalMembers).toBe(1);
      expect(stats.newMembers).toBe(0);
      expect(stats.promotionsCount).toBe(0);
      expect(stats.badgesAwarded).toBe(0);
      expect(stats.topNewMember).toBeNull();
    });
  });

  describe('Digest Formatting', () => {
    it('should format digest with all stats sections', () => {
      seedMember({ id: 'm1', tier: 'fedaykin', bgt: 500, createdDaysAgo: 1 });
      db.prepare(
        `INSERT INTO tier_history (member_id, old_tier, new_tier, changed_at)
         VALUES ('m1', 'usul', 'fedaykin', datetime('now', '-1 day'))`
      ).run();
      db.prepare(
        `INSERT INTO member_badges (member_id, awarded_at) VALUES ('m1', datetime('now', '-1 day'))`
      ).run();

      const stats = digestService.collectWeeklyStats();
      const message = digestService.formatDigest(stats);

      expect(message).toContain('Weekly Pulse of the Sietch');
      expect(message).toContain('Community Stats');
      expect(message).toContain('Total Members: **1** (+1 new)');
      expect(message).toContain('500 BGT');
      expect(message).toContain('New Members');
      expect(message).toContain('Tier Promotions');
      expect(message).toContain('**Nym-m1** reached **Fedaykin**!');
      expect(message).toContain('Badges Awarded');
      expect(message).toContain('The spice flows...');
    });

    it('should handle digest with no notable events', () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 10 });

      const stats = digestService.collectWeeklyStats();
      const message = digestService.formatDigest(stats);

      expect(message).toContain('Weekly Pulse of the Sietch');
      expect(message).toContain('Total Members: **1**');
      // Sections with no events are omitted entirely
      expect(message).not.toContain('New Members');
      expect(message).not.toContain('Tier Promotions');
      expect(message).not.toContain('Badges Awarded');
    });

    it('should format large BGT numbers correctly', () => {
      seedMember({ id: 'whale', tier: 'naib', bgt: 1_250_000 });

      const stats = digestService.collectWeeklyStats();
      const message = digestService.formatDigest(stats);

      expect(stats.totalBgt).toBe(1_250_000);
      expect(message).toContain('1,250,000 BGT');
    });
  });

  describe('Digest Posting', () => {
    it('should post digest to announcements channel and store the record', async () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100 });
      const stats = digestService.collectWeeklyStats();
      const channel = makeTextChannel();
      const client = { channels: { fetch: vi.fn(async () => channel) } };

      const result = await digestService.postDigest(stats, client as any, 'channel-announcements');

      expect(result.success).toBe(true);
      expect(client.channels.fetch).toHaveBeenCalledWith('channel-announcements');
      expect(channel.send).toHaveBeenCalledTimes(1);
      expect(channel.send.mock.calls[0][0]).toContain('Weekly Pulse of the Sietch');

      // Stored with the Discord message id filled in
      const row = db
        .prepare('SELECT * FROM weekly_digests WHERE week_identifier = ?')
        .get(stats.weekIdentifier) as Record<string, unknown>;
      expect(row).toBeTruthy();
      expect(row.message_id).toBe('msg-1');
      expect(row.total_members).toBe(1);
    });

    it('should not post a duplicate digest for the same week', async () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100 });
      const stats = digestService.collectWeeklyStats();
      const channel = makeTextChannel();
      const client = { channels: { fetch: vi.fn(async () => channel) } };

      const first = await digestService.postDigest(stats, client as any, 'channel-announcements');
      expect(first.success).toBe(true);

      const second = await digestService.postDigest(stats, client as any, 'channel-announcements');
      expect(second.success).toBe(false);
      expect(second.error).toContain('already exists');
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it('should handle posting failure gracefully', async () => {
      seedMember({ id: 'm1', tier: 'hajra', bgt: 100 });
      const stats = digestService.collectWeeklyStats();
      const client = {
        channels: { fetch: vi.fn(async () => { throw new Error('Discord unavailable'); }) },
      };

      const result = await digestService.postDigest(stats, client as any, 'channel-announcements');

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe('Digest Storage', () => {
    it('should store digest with all metadata', async () => {
      seedMember({ id: 'm1', tier: 'fedaykin', bgt: 500, createdDaysAgo: 1 });
      db.prepare(
        `INSERT INTO tier_history (member_id, old_tier, new_tier, changed_at)
         VALUES ('m1', 'usul', 'fedaykin', datetime('now', '-1 day'))`
      ).run();

      const stats = digestService.collectWeeklyStats();
      const channel = makeTextChannel();
      const client = { channels: { fetch: vi.fn(async () => channel) } };
      await digestService.postDigest(stats, client as any, 'channel-announcements');

      const row = db
        .prepare('SELECT * FROM weekly_digests WHERE week_identifier = ?')
        .get(stats.weekIdentifier) as Record<string, unknown>;

      expect(row.new_members).toBe(1);
      expect(row.promotions_count).toBe(1);
      expect(JSON.parse(row.tier_distribution as string).fedaykin).toBe(1);
      expect(JSON.parse(row.notable_promotions as string)).toEqual([
        { nym: 'Nym-m1', newTier: 'fedaykin' },
      ]);
      expect(row.top_new_member_nym).toBe('Nym-m1');
      expect(digestService.digestExistsForWeek(stats.weekIdentifier)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle database query failures', () => {
      db.close();
      expect(() => digestService.collectWeeklyStats()).toThrow();
      db = new Database(':memory:'); // valid handle for afterEach close()
    });

    it('should produce a stable ISO week identifier', () => {
      expect(digestService.getWeekIdentifier(new Date('2025-01-16T12:00:00Z'))).toBe('2025-W03');
      expect(digestService.getWeekIdentifier(new Date('2024-12-31T12:00:00Z'))).toBe('2025-W01');
    });
  });
});
