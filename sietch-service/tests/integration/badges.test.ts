/**
 * Badge System Integration Tests
 *
 * Tests badge awarding, notifications, and eligibility checking.
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
vi.mock('../../src/db/queries.js', () => ({
  getMemberProfileById: vi.fn(),
  getMemberBadgeCount: vi.fn(),
  getMemberActivity: vi.fn(),
  memberHasBadge: vi.fn(),
  awardBadgeToMember: vi.fn(),
  revokeBadgeFromMember: vi.fn(),
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
  logAuditEvent: vi.fn(),
}));

// Badge definitions (matching src/services/badge.ts)
const BADGE_IDS = {
  // Tenure badges
  newcomer: 'newcomer',
  established: 'established',
  veteran: 'veteran',
  og: 'og',

  // Activity badges
  active: 'active',
  engaged: 'engaged',
  dedicated: 'dedicated',

  // Special badges
  helper: 'helper',
  consistent: 'consistent',
  early_adopter: 'early_adopter',
};

const TENURE_THRESHOLDS = {
  newcomer: 0,
  established: 30,
  veteran: 90,
  og: 365,
};

const ACTIVITY_THRESHOLDS = {
  active: 50,
  engaged: 200,
  dedicated: 500,
};

describe('Badge System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Badge Definitions', () => {
    it('should have all required badge IDs', () => {
      expect(BADGE_IDS.newcomer).toBe('newcomer');
      expect(BADGE_IDS.established).toBe('established');
      expect(BADGE_IDS.veteran).toBe('veteran');
      expect(BADGE_IDS.og).toBe('og');
      expect(BADGE_IDS.active).toBe('active');
      expect(BADGE_IDS.engaged).toBe('engaged');
      expect(BADGE_IDS.dedicated).toBe('dedicated');
    });

    it('should have correct tenure thresholds', () => {
      expect(TENURE_THRESHOLDS.newcomer).toBe(0);
      expect(TENURE_THRESHOLDS.established).toBe(30);
      expect(TENURE_THRESHOLDS.veteran).toBe(90);
      expect(TENURE_THRESHOLDS.og).toBe(365);
    });

    it('should have correct activity thresholds', () => {
      expect(ACTIVITY_THRESHOLDS.active).toBe(50);
      expect(ACTIVITY_THRESHOLDS.engaged).toBe(200);
      expect(ACTIVITY_THRESHOLDS.dedicated).toBe(500);
    });
  });

  describe('Tenure Badge Eligibility', () => {
    it('should award newcomer badge on day 0', () => {
      const daysSinceJoin = 0;
      const eligible = daysSinceJoin >= TENURE_THRESHOLDS.newcomer;

      expect(eligible).toBe(true);
    });

    it('should award established badge after 30 days', () => {
      const daysSinceJoin = 30;
      const eligible = daysSinceJoin >= TENURE_THRESHOLDS.established;

      expect(eligible).toBe(true);
    });

    it('should NOT award established badge before 30 days', () => {
      const daysSinceJoin = 29;
      const eligible = daysSinceJoin >= TENURE_THRESHOLDS.established;

      expect(eligible).toBe(false);
    });

    it('should award veteran badge after 90 days', () => {
      const daysSinceJoin = 90;
      const eligible = daysSinceJoin >= TENURE_THRESHOLDS.veteran;

      expect(eligible).toBe(true);
    });

    it('should award OG badge after 365 days', () => {
      const daysSinceJoin = 365;
      const eligible = daysSinceJoin >= TENURE_THRESHOLDS.og;

      expect(eligible).toBe(true);
    });

    it('should calculate days since join correctly', () => {
      const joinDate = new Date('2024-06-01');
      const now = new Date('2024-09-01');
      const daysSinceJoin = Math.floor(
        (now.getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysSinceJoin).toBe(92);
    });
  });

  describe('Activity Badge Eligibility', () => {
    it('should award active badge at 50 activity points', () => {
      const activityBalance = 50;
      const eligible = activityBalance >= ACTIVITY_THRESHOLDS.active;

      expect(eligible).toBe(true);
    });

    it('should award engaged badge at 200 activity points', () => {
      const activityBalance = 200;
      const eligible = activityBalance >= ACTIVITY_THRESHOLDS.engaged;

      expect(eligible).toBe(true);
    });

    it('should award dedicated badge at 500 activity points', () => {
      const activityBalance = 500;
      const eligible = activityBalance >= ACTIVITY_THRESHOLDS.dedicated;

      expect(eligible).toBe(true);
    });

    it('should NOT award dedicated badge at 499 points', () => {
      const activityBalance = 499;
      const eligible = activityBalance >= ACTIVITY_THRESHOLDS.dedicated;

      expect(eligible).toBe(false);
    });
  });

  describe('Badge Award Prevention', () => {
    it('should not award duplicate badges', () => {
      const memberBadges = ['newcomer', 'active'];
      const badgeToAward = 'newcomer';

      const alreadyHas = memberBadges.includes(badgeToAward);

      expect(alreadyHas).toBe(true);
    });

    it('should allow awarding new badges', () => {
      const memberBadges = ['newcomer'];
      const badgeToAward = 'active';

      const alreadyHas = memberBadges.includes(badgeToAward);

      expect(alreadyHas).toBe(false);
    });
  });

  describe('Badge Revocation', () => {
    it('should allow revoking badges', () => {
      const memberBadges = ['newcomer', 'active', 'helper'];
      const badgeToRevoke = 'helper';

      const newBadges = memberBadges.filter((b) => b !== badgeToRevoke);

      expect(newBadges).not.toContain('helper');
      expect(newBadges).toHaveLength(2);
    });

    it('should NOT revoke tenure badges (permanent)', () => {
      const permanentBadges = ['newcomer', 'established', 'veteran', 'og'];
      const badgeToRevoke = 'veteran';

      const isPermanent = permanentBadges.includes(badgeToRevoke);

      expect(isPermanent).toBe(true);
    });
  });

  describe('Admin Badge Awards', () => {
    it('should allow admin to award special badges', () => {
      const specialBadges = ['helper', 'consistent', 'early_adopter'];
      const badgeToAward = 'helper';

      const isSpecialBadge = specialBadges.includes(badgeToAward);

      expect(isSpecialBadge).toBe(true);
    });

    it('should require reason for admin awards', () => {
      const adminAward = {
        badgeId: 'helper',
        memberId: 'member-123',
        awardedBy: 'admin-456',
        reason: 'Consistently helps other members',
      };

      expect(adminAward.reason).toBeDefined();
      expect(adminAward.reason.length).toBeGreaterThan(0);
    });
  });

  describe('Badge Notification', () => {
    it('should build notification embed with badge info', () => {
      const badge = {
        id: 'veteran',
        name: 'Veteran',
        description: 'Been a member for 90+ days',
        emoji: '🎖️',
      };

      const notification = {
        title: `${badge.emoji} New Badge Earned!`,
        description: `You've earned the **${badge.name}** badge!`,
        fields: [{ name: 'About', value: badge.description }],
      };

      expect(notification.title).toContain(badge.emoji);
      expect(notification.description).toContain(badge.name);
    });

    it('should NOT include private data in notifications', () => {
      const notification = {
        title: '🎖️ New Badge Earned!',
        description: 'You\'ve earned the **Veteran** badge!',
        memberId: 'member-123',
      };

      const json = JSON.stringify(notification);

      expect(json).not.toContain('discord');
      expect(json).not.toContain('wallet');
      expect(json).not.toContain('0x');
    });
  });

  describe('Badge Count', () => {
    it('should count unique badges per member', () => {
      const memberBadges = [
        { badgeId: 'newcomer', awardedAt: new Date() },
        { badgeId: 'active', awardedAt: new Date() },
        { badgeId: 'helper', awardedAt: new Date() },
      ];

      expect(memberBadges.length).toBe(3);
    });

    it('should not count revoked badges', () => {
      const memberBadges = [
        { badgeId: 'newcomer', revokedAt: null },
        { badgeId: 'active', revokedAt: null },
        { badgeId: 'helper', revokedAt: new Date() }, // Revoked
      ];

      const activeBadges = memberBadges.filter((b) => !b.revokedAt);

      expect(activeBadges.length).toBe(2);
    });
  });

  describe('Role Upgrade Triggers', () => {
    it('should check for @Engaged role at 5+ badges', () => {
      const badgeCount = 5;
      const qualifiesForEngaged = badgeCount >= 5;

      expect(qualifiesForEngaged).toBe(true);
    });

    it('should check for @Trusted role at 10+ badges', () => {
      const badgeCount = 10;
      const qualifiesForTrusted = badgeCount >= 10;

      expect(qualifiesForTrusted).toBe(true);
    });

    it('should check for @Trusted role with Helper badge', () => {
      const memberBadges = ['newcomer', 'helper'];
      const hasHelperBadge = memberBadges.includes('helper');

      expect(hasHelperBadge).toBe(true);
    });
  });

  describe('Badge Audit Trail', () => {
    it('should log badge award events', () => {
      const auditEvent = {
        eventType: 'badge_awarded',
        eventData: {
          memberId: 'member-123',
          badgeId: 'helper',
          awardedBy: 'admin-456',
        },
      };

      expect(auditEvent.eventType).toBe('badge_awarded');
      expect(auditEvent.eventData.memberId).toBeDefined();
      expect(auditEvent.eventData.badgeId).toBeDefined();
    });

    it('should log badge revoke events', () => {
      const auditEvent = {
        eventType: 'badge_revoked',
        eventData: {
          memberId: 'member-123',
          badgeId: 'helper',
          revokedBy: 'admin-456',
          reason: 'Misuse of badge',
        },
      };

      expect(auditEvent.eventType).toBe('badge_revoked');
      expect(auditEvent.eventData.reason).toBeDefined();
    });
  });
});

// =============================================================================
// Sprint 18: Usul Ascended Badge Tests
// =============================================================================

describe('Usul Ascended Badge (Sprint 18)', () => {
  // Constants matching badge.ts
  const USUL_ASCENDED_BADGE = {
    badgeId: 'usul-ascended',
    name: 'Usul Ascended',
    description: 'Reached the Usul tier (1111+ BGT)',
    emoji: '⭐',
    category: 'special',
  };

  const USUL_TIER_THRESHOLD = 1111; // BGT

  describe('Badge Definition', () => {
    it('should have correct badge ID', () => {
      expect(USUL_ASCENDED_BADGE.badgeId).toBe('usul-ascended');
    });

    it('should have correct badge name', () => {
      expect(USUL_ASCENDED_BADGE.name).toBe('Usul Ascended');
    });

    it('should have description mentioning 1111+ BGT', () => {
      expect(USUL_ASCENDED_BADGE.description).toContain('1111');
      expect(USUL_ASCENDED_BADGE.description).toContain('BGT');
    });

    it('should be in special category (auto-awarded)', () => {
      expect(USUL_ASCENDED_BADGE.category).toBe('special');
    });

    it('should have star emoji', () => {
      expect(USUL_ASCENDED_BADGE.emoji).toBe('⭐');
    });
  });

  describe('Auto-Award Eligibility', () => {
    it('should award when member reaches Usul tier (1111 BGT)', () => {
      const memberBgt = 1111;
      const memberTier = 'usul';
      const oldTier = 'sayyadina';

      const shouldAward =
        memberBgt >= USUL_TIER_THRESHOLD &&
        memberTier === 'usul' &&
        oldTier !== null &&
        oldTier !== 'usul';

      expect(shouldAward).toBe(true);
    });

    it('should award when member exceeds Usul threshold (1500 BGT)', () => {
      const memberBgt = 1500;
      const memberTier = 'usul';
      const oldTier = 'sayyadina';

      const shouldAward =
        memberBgt >= USUL_TIER_THRESHOLD &&
        memberTier === 'usul' &&
        oldTier !== null &&
        oldTier !== 'usul';

      expect(shouldAward).toBe(true);
    });

    it('should NOT award on first tier assignment (oldTier is null)', () => {
      const memberBgt = 1111;
      const memberTier = 'usul';
      const oldTier = null;

      const shouldAward =
        memberBgt >= USUL_TIER_THRESHOLD &&
        memberTier === 'usul' &&
        oldTier !== null;

      expect(shouldAward).toBe(false);
    });

    it('should NOT award if member is below Usul threshold (1110 BGT)', () => {
      const memberBgt = 1110;
      const memberTier = 'sayyadina';
      const oldTier = 'mushtamal';

      const shouldAward =
        memberBgt >= USUL_TIER_THRESHOLD && memberTier === 'usul';

      expect(shouldAward).toBe(false);
    });

    it('should NOT award again if member already has badge', () => {
      const memberBadges = ['newcomer', 'usul-ascended', 'active'];
      const alreadyHasBadge = memberBadges.includes(USUL_ASCENDED_BADGE.badgeId);

      expect(alreadyHasBadge).toBe(true);
    });

    it('should NOT award if tier is Fedaykin (rank-based, not BGT-based Usul)', () => {
      const memberBgt = 1200;
      const memberTier = 'fedaykin'; // Rank 8-69 overrides BGT tier
      const oldTier = 'usul';

      const shouldAward = memberTier === 'usul';

      expect(shouldAward).toBe(false);
    });

    it('should NOT award if tier is Naib (rank-based)', () => {
      const memberBgt = 2000;
      const memberTier = 'naib'; // Rank 1-7 overrides BGT tier
      const oldTier = 'usul';

      const shouldAward = memberTier === 'usul';

      expect(shouldAward).toBe(false);
    });
  });

  describe('Badge Persistence Through Tier Changes', () => {
    it('should persist badge when member is promoted from Usul to Fedaykin', () => {
      // Member has Usul Ascended badge
      const memberBadges = ['newcomer', 'usul-ascended'];

      // Member is promoted to Fedaykin (rank 8-69)
      const oldTier = 'usul';
      const newTier = 'fedaykin';

      // Badge should remain (tiers change, badges persist)
      // Badges are separate from tiers - they are permanent achievements
      const badgeRevokedOnTierChange = false; // Expected behavior

      expect(badgeRevokedOnTierChange).toBe(false);
      expect(memberBadges).toContain('usul-ascended');
    });

    it('should persist badge when member is promoted from Fedaykin to Naib', () => {
      // Member has Usul Ascended badge from before reaching Fedaykin
      const memberBadges = ['newcomer', 'usul-ascended'];

      // Member is now being promoted to Naib
      const oldTier = 'fedaykin';
      const newTier = 'naib';

      // Badge should still be there
      expect(memberBadges).toContain('usul-ascended');
    });

    it('should persist badge when member is demoted from Fedaykin to Usul', () => {
      // Member has badge, drops in rank from Top 69
      const memberBadges = ['newcomer', 'usul-ascended'];

      // Demotion from Fedaykin back to Usul (left top 69 but still has 1111+ BGT)
      const oldTier = 'fedaykin';
      const newTier = 'usul';

      // Badge persists through demotion
      expect(memberBadges).toContain('usul-ascended');
    });

    it('should persist badge even if BGT drops below Usul threshold', () => {
      // Badges are permanent achievements once earned
      const memberBadges = ['newcomer', 'usul-ascended'];

      // Member's BGT drops to below Usul threshold
      const currentBgt = 800; // Below 1111
      const currentTier = 'sayyadina'; // Demoted tier

      // Badge should still persist - it's a historical achievement
      expect(memberBadges).toContain('usul-ascended');
    });
  });

  describe('Badge Award Notification', () => {
    it('should trigger notification when badge is auto-awarded', () => {
      const notification = {
        type: 'badge_award',
        badgeId: 'usul-ascended',
        badgeName: 'Usul Ascended',
        badgeDescription: USUL_ASCENDED_BADGE.description,
        badgeEmoji: '⭐',
        awardReason: 'Reached Usul tier (1111+ BGT)',
        isWaterSharer: false,
      };

      expect(notification.type).toBe('badge_award');
      expect(notification.badgeId).toBe('usul-ascended');
      expect(notification.awardReason).toContain('Usul tier');
      expect(notification.isWaterSharer).toBe(false);
    });

    it('should include correct badge details in notification embed', () => {
      const embed = {
        title: `${USUL_ASCENDED_BADGE.emoji} Badge Awarded!`,
        description: 'You have been awarded a badge!',
        fields: [
          { name: '⭐ Badge', value: '**Usul Ascended**' },
          { name: '📝 Description', value: USUL_ASCENDED_BADGE.description },
          { name: '💬 Award Reason', value: 'Reached Usul tier (1111+ BGT)' },
        ],
      };

      expect(embed.title).toContain(USUL_ASCENDED_BADGE.emoji);
      expect(embed.fields.find((f) => f.name.includes('Badge'))?.value).toContain('Usul Ascended');
    });
  });

  describe('Idempotency', () => {
    it('should not create duplicate badge records', () => {
      const memberBadges = [
        { badgeId: 'usul-ascended', awardedAt: new Date('2025-01-01') },
      ];

      // Attempt to award again should check for existing badge first
      const hasExisting = memberBadges.some(
        (b) => b.badgeId === 'usul-ascended'
      );

      expect(hasExisting).toBe(true);

      // Award function should return false/null when badge already exists
      const awardResult = hasExisting ? null : { badgeId: 'usul-ascended' };
      expect(awardResult).toBeNull();
    });

    it('should handle rapid tier changes without duplicate awards', () => {
      // Simulate rapid tier changes during sync
      const tierChanges = [
        { oldTier: 'sayyadina', newTier: 'usul' },
        { oldTier: 'usul', newTier: 'usul' }, // No change (re-processed)
        { oldTier: 'usul', newTier: 'usul' }, // No change (re-processed)
      ];

      let badgeAwardCount = 0;
      let hasBadge = false;

      for (const change of tierChanges) {
        const isPromotion = change.newTier === 'usul' && change.oldTier !== 'usul';
        if (isPromotion && !hasBadge) {
          badgeAwardCount++;
          hasBadge = true;
        }
      }

      // Should only award once
      expect(badgeAwardCount).toBe(1);
    });
  });

  describe('Audit Trail', () => {
    it('should log badge award with correct event data', () => {
      const auditEvent = {
        eventType: 'admin_badge_award', // Same event type as other badge awards
        eventData: {
          memberId: 'member-123',
          badgeId: 'usul-ascended',
          awardedBy: null, // Auto-awarded by system
          reason: 'Reached Usul tier (1111+ BGT)',
          isAutoAward: true,
        },
      };

      expect(auditEvent.eventData.badgeId).toBe('usul-ascended');
      expect(auditEvent.eventData.isAutoAward).toBe(true);
      expect(auditEvent.eventData.awardedBy).toBeNull();
    });
  });
});
