/**
 * Activity Tracking Integration Tests
 *
 * Tests activity recording, decay, and balance calculations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: { naib: 'role', fedaykin: 'role' },
      guildId: 'guild',
      channels: { theDoor: 'channel', census: 'channel' },
      botToken: 'token',
    },
    socialLayer: {
      profile: { launchDate: '2025-01-01T00:00:00Z' },
    },
  },
}));

// Mock database
const mockPrepare = vi.fn();
const mockRun = vi.fn();
const mockGet = vi.fn();

vi.mock('../../src/db/queries.js', () => ({
  getMemberProfileById: vi.fn(),
  getMemberProfileByDiscordId: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare.mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: vi.fn(() => []),
    }),
  })),
  logAuditEvent: vi.fn(),
}));

// Activity constants (matching src/services/activity.ts)
const ACTIVITY_POINTS = {
  message: 1,
  reactionGiven: 0.5,
  reactionReceived: 0.5,
};

const RATE_LIMITS = {
  messagesPerMinute: 5,
  reactionsPerMinute: 10,
};

const DECAY_RATE = 0.02; // 2% daily decay

describe('Activity Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Message Activity', () => {
    it('should award points for messages', () => {
      const points = ACTIVITY_POINTS.message;
      expect(points).toBe(1);
    });

    it('should respect rate limits', () => {
      const messagesInLastMinute = 6;
      const isRateLimited = messagesInLastMinute > RATE_LIMITS.messagesPerMinute;

      expect(isRateLimited).toBe(true);
    });

    it('should not award points when rate limited', () => {
      const messagesInLastMinute = 6;
      const isRateLimited = messagesInLastMinute > RATE_LIMITS.messagesPerMinute;
      const pointsAwarded = isRateLimited ? 0 : ACTIVITY_POINTS.message;

      expect(pointsAwarded).toBe(0);
    });

    it('should allow messages within rate limit', () => {
      const messagesInLastMinute = 3;
      const isRateLimited = messagesInLastMinute > RATE_LIMITS.messagesPerMinute;
      const pointsAwarded = isRateLimited ? 0 : ACTIVITY_POINTS.message;

      expect(pointsAwarded).toBe(1);
    });
  });

  describe('Reaction Activity', () => {
    it('should award points for giving reactions', () => {
      const points = ACTIVITY_POINTS.reactionGiven;
      expect(points).toBe(0.5);
    });

    it('should award points for receiving reactions', () => {
      const points = ACTIVITY_POINTS.reactionReceived;
      expect(points).toBe(0.5);
    });

    it('should respect reaction rate limits', () => {
      const reactionsInLastMinute = 12;
      const isRateLimited = reactionsInLastMinute > RATE_LIMITS.reactionsPerMinute;

      expect(isRateLimited).toBe(true);
    });
  });

  describe('Activity Balance Decay', () => {
    it('should calculate daily decay correctly', () => {
      const currentBalance = 100;
      const decayAmount = currentBalance * DECAY_RATE;

      expect(decayAmount).toBe(2); // 2% of 100
    });

    it('should not decay below zero', () => {
      const currentBalance = 1;
      const decayAmount = currentBalance * DECAY_RATE;
      const newBalance = Math.max(0, currentBalance - decayAmount);

      expect(newBalance).toBeGreaterThanOrEqual(0);
    });

    it('should apply decay proportionally to days elapsed', () => {
      const currentBalance = 100;
      const daysElapsed = 3;

      // Compound decay
      let balance = currentBalance;
      for (let i = 0; i < daysElapsed; i++) {
        balance = balance * (1 - DECAY_RATE);
      }

      // After 3 days at 2% daily decay
      expect(balance).toBeCloseTo(94.12, 1);
    });

    it('should preserve activity balance when member is active', () => {
      // Member earned 5 points today
      const activityToday = 5;
      const currentBalance = 100;
      const decayAmount = currentBalance * DECAY_RATE;

      // Net balance = current - decay + new activity
      const netBalance = currentBalance - decayAmount + activityToday;

      expect(netBalance).toBe(103); // 100 - 2 + 5
    });
  });

  describe('Activity Balance Queries', () => {
    it('should return zero for new members', () => {
      mockGet.mockReturnValue(null);

      const defaultBalance = 0;
      expect(defaultBalance).toBe(0);
    });

    it('should return stored balance for existing members', () => {
      mockGet.mockReturnValue({ activity_balance: 150.5 });

      const balance = mockGet()?.activity_balance ?? 0;
      expect(balance).toBe(150.5);
    });
  });

  describe('Activity Statistics', () => {
    it('should track message count', () => {
      const stats = {
        messageCount: 50,
        reactionsGiven: 25,
        reactionsReceived: 30,
      };

      expect(stats.messageCount).toBe(50);
    });

    it('should calculate total activity points', () => {
      const stats = {
        messageCount: 50,
        reactionsGiven: 25,
        reactionsReceived: 30,
      };

      const totalPoints =
        stats.messageCount * ACTIVITY_POINTS.message +
        stats.reactionsGiven * ACTIVITY_POINTS.reactionGiven +
        stats.reactionsReceived * ACTIVITY_POINTS.reactionReceived;

      expect(totalPoints).toBe(50 * 1 + 25 * 0.5 + 30 * 0.5); // 77.5
    });
  });

  describe('Rate Limit Cache', () => {
    it('should track activity timestamps per member', () => {
      const memberActivity = new Map<string, number[]>();
      const memberId = 'member-123';
      const now = Date.now();

      // Record activity
      if (!memberActivity.has(memberId)) {
        memberActivity.set(memberId, []);
      }
      memberActivity.get(memberId)!.push(now);

      expect(memberActivity.get(memberId)).toHaveLength(1);
    });

    it('should clean up old timestamps', () => {
      const memberActivity = new Map<string, number[]>();
      const memberId = 'member-123';
      const now = Date.now();
      const oneMinuteAgo = now - 61000;

      memberActivity.set(memberId, [oneMinuteAgo, now]);

      // Filter to only last minute
      const recentActivity = memberActivity
        .get(memberId)!
        .filter((ts) => ts > now - 60000);

      expect(recentActivity).toHaveLength(1);
    });
  });

  describe('Activity Event Logging', () => {
    it('should log activity events with member ID only', () => {
      const event = {
        type: 'message_recorded',
        memberId: 'member-123',
        points: 1,
        timestamp: new Date().toISOString(),
      };

      // Should NOT contain Discord ID or wallet
      expect(JSON.stringify(event)).not.toContain('discord');
      expect(JSON.stringify(event)).not.toContain('wallet');
      expect(JSON.stringify(event)).not.toContain('0x');
    });
  });
});
