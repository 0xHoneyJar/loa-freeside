/**
 * GlimpseMode Tests
 *
 * Sprint 61: Glimpse Mode - Social Layer Preview
 *
 * Tests for the GlimpseMode service that provides blurred/locked previews
 * of social features to encourage migration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  GlimpseMode,
  createGlimpseMode,
  type GlimpseProfile,
  type GlimpseBadgeShowcase,
  type OwnPreviewProfile,
  type ConvictionRankResult,
  type UpgradeCTA,
  type TellAdminRequest,
} from '../../../../../src/packages/adapters/coexistence/GlimpseMode.js';
import type { ICoexistenceStorage } from '../../../../../src/packages/core/ports/ICoexistenceStorage.js';
import type { MemberVerificationStatus } from '../../../../../src/packages/core/services/VerificationTiersService.js';
import type { GatedProfile } from '../../../../../src/packages/core/services/TierIntegration.js';

// =============================================================================
// Mock Storage
// =============================================================================

function createMockStorage(): ICoexistenceStorage {
  return {
    // Incumbent config
    getIncumbentConfig: vi.fn().mockResolvedValue(null),
    saveIncumbentConfig: vi.fn().mockResolvedValue(undefined),
    deleteIncumbentConfig: vi.fn().mockResolvedValue(undefined),

    // Migration state
    getMigrationState: vi.fn().mockResolvedValue(null),
    saveMigrationState: vi.fn().mockResolvedValue(undefined),

    // Shadow ledger
    getShadowEntry: vi.fn().mockResolvedValue(null),
    saveShadowEntry: vi.fn().mockResolvedValue(undefined),
    getShadowEntries: vi.fn().mockResolvedValue([]),
    getShadowStats: vi.fn().mockResolvedValue({ total: 0, matches: 0, divergences: 0 }),
    getShadowDivergences: vi.fn().mockResolvedValue([]),

    // Parallel roles
    getParallelRoles: vi.fn().mockResolvedValue([]),
    saveParallelRoles: vi.fn().mockResolvedValue(undefined),
    deleteParallelRoles: vi.fn().mockResolvedValue(undefined),

    // Parallel channels
    getParallelChannels: vi.fn().mockResolvedValue([]),
    saveParallelChannels: vi.fn().mockResolvedValue(undefined),
    deleteParallelChannels: vi.fn().mockResolvedValue(undefined),
  };
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createStatus(overrides: Partial<MemberVerificationStatus> = {}): MemberVerificationStatus {
  return {
    communityId: 'test-community-123',
    memberId: 'test-member-456',
    hasIncumbentAccess: true,
    hasArrakisWallet: false,
    isArrakisVerified: false,
    ...overrides,
  };
}

function createProfile(overrides: Partial<GatedProfile> = {}): GatedProfile {
  return {
    memberId: 'profile-member-789',
    nym: 'TestUser',
    pfpUrl: 'https://example.com/avatar.png',
    tier: 'fedaykin',
    badgeCount: 5,
    badges: [],
    convictionScore: 85,
    ...overrides,
  };
}

function createBadges(count: number = 5) {
  return Array.from({ length: count }, (_, i) => ({
    id: `badge-${i + 1}`,
    name: `Badge ${i + 1}`,
    emoji: '🏅',
    category: i % 2 === 0 ? 'achievement' : 'participation',
  }));
}

// =============================================================================
// Tests
// =============================================================================

describe('GlimpseMode', () => {
  let storage: ICoexistenceStorage;
  let glimpseMode: GlimpseMode;

  beforeEach(() => {
    storage = createMockStorage();
    glimpseMode = createGlimpseMode(storage);
  });

  // ===========================================================================
  // Factory Function
  // ===========================================================================

  describe('createGlimpseMode', () => {
    it('creates a GlimpseMode instance', () => {
      const mode = createGlimpseMode(storage);
      expect(mode).toBeInstanceOf(GlimpseMode);
    });
  });

  // ===========================================================================
  // TASK-61.2: Blurred Profile Card (TASK-61.9 tests)
  // ===========================================================================

  describe('createGlimpseProfile', () => {
    describe('Tier 1 (incumbent_only)', () => {
      it('creates heavily blurred profile for incumbent_only viewer', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: false,
          isArrakisVerified: false,
        });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.isBlurred).toBe(true);
        expect(result.blurIntensity).toBe(80);
        expect(result.nym).toBe('TestUser');
        expect(result.pfpUrl).toBe('https://example.com/avatar.png');
      });

      it('does not show tier label for incumbent_only', () => {
        const viewerStatus = createStatus({ hasArrakisWallet: false });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.preview.tierLabel).toBeUndefined();
        expect(result.preview.badgeCountPreview).toBeUndefined();
      });

      it('shows activity level indicator', () => {
        const viewerStatus = createStatus({ hasArrakisWallet: false });
        const profile = createProfile({ badgeCount: 10 });

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.preview.activityLevel).toBe('high');
      });

      it('shows restriction message for profile_view', () => {
        const viewerStatus = createStatus({ hasArrakisWallet: false });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.restriction.feature).toBe('profile_view');
        expect(result.restriction.message).toContain('Connect your wallet');
        expect(result.restriction.unlockAction).toBe('Connect Wallet');
      });
    });

    describe('Tier 2 (arrakis_basic)', () => {
      it('creates lightly blurred profile for arrakis_basic viewer', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: false,
        });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.isBlurred).toBe(true);
        expect(result.blurIntensity).toBe(30);
      });

      it('shows tier label and badge count preview', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: false,
        });
        const profile = createProfile({ tier: 'naib', badgeCount: 7 });

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.preview.tierLabel).toBe('naib');
        expect(result.preview.badgeCountPreview).toBe(7);
      });

      it('shows restriction message for full_profile', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: false,
        });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.restriction.feature).toBe('full_profile');
        expect(result.restriction.message).toContain('verification');
      });
    });

    describe('Tier 3 (arrakis_full)', () => {
      it('creates non-blurred profile for arrakis_full viewer', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: true,
        });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.isBlurred).toBe(false);
        expect(result.blurIntensity).toBe(0);
      });

      it('shows no restriction message', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: true,
        });
        const profile = createProfile();

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.restriction.message).toBe('');
        expect(result.restriction.unlockAction).toBe('');
      });
    });

    describe('Activity level calculation', () => {
      it('returns "low" for 0-1 badges', () => {
        const viewerStatus = createStatus();
        const profile = createProfile({ badgeCount: 1 });

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.preview.activityLevel).toBe('low');
      });

      it('returns "medium" for 2-4 badges', () => {
        const viewerStatus = createStatus();
        const profile = createProfile({ badgeCount: 3 });

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.preview.activityLevel).toBe('medium');
      });

      it('returns "high" for 5+ badges', () => {
        const viewerStatus = createStatus();
        const profile = createProfile({ badgeCount: 5 });

        const result = glimpseMode.createGlimpseProfile(viewerStatus, profile);

        expect(result.preview.activityLevel).toBe('high');
      });
    });
  });

  // ===========================================================================
  // TASK-61.3: Locked Badge Showcase (TASK-61.9 tests)
  // ===========================================================================

  describe('createBadgeShowcase', () => {
    describe('Tier 1 (incumbent_only)', () => {
      it('shows all badges as locked for incumbent_only', () => {
        const viewerStatus = createStatus({ hasArrakisWallet: false });
        const badges = createBadges(5);

        const result = glimpseMode.createBadgeShowcase(viewerStatus, badges);

        expect(result.viewerTier).toBe('incumbent_only');
        expect(result.totalBadges).toBe(5);
        expect(result.readyToClaim).toBe(5);
        expect(result.fullAccessible).toBe(false);
        expect(result.lockedBadges).toHaveLength(5);
        expect(result.lockedBadges.every((b) => b.isLocked)).toBe(true);
      });

      it('shows correct unlock message for incumbent_only', () => {
        const viewerStatus = createStatus({ hasArrakisWallet: false });
        const badges = createBadges(3);

        const result = glimpseMode.createBadgeShowcase(viewerStatus, badges);

        expect(result.unlockMessage).toContain('3 badges ready to claim');
        expect(result.unlockAction).toBe('Connect Wallet');
      });
    });

    describe('Tier 2 (arrakis_basic)', () => {
      it('shows badges as locked but previewable for arrakis_basic', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: false,
        });
        const badges = createBadges(5);

        const result = glimpseMode.createBadgeShowcase(viewerStatus, badges);

        expect(result.viewerTier).toBe('arrakis_basic');
        expect(result.totalBadges).toBe(5);
        expect(result.readyToClaim).toBe(5);
        expect(result.fullAccessible).toBe(false);
        // Has unlocked badges in preview mode
        expect(result.unlockedBadges.length).toBeGreaterThan(0);
      });

      it('shows correct unlock message for arrakis_basic', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: false,
        });
        const badges = createBadges(7);

        const result = glimpseMode.createBadgeShowcase(viewerStatus, badges);

        expect(result.unlockMessage).toContain('7 badges earned');
        expect(result.unlockAction).toBe('Complete Verification');
      });
    });

    describe('Tier 3 (arrakis_full)', () => {
      it('shows all badges as unlocked for arrakis_full', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: true,
        });
        const badges = createBadges(5);

        const result = glimpseMode.createBadgeShowcase(viewerStatus, badges);

        expect(result.viewerTier).toBe('arrakis_full');
        expect(result.totalBadges).toBe(5);
        expect(result.readyToClaim).toBe(0);
        expect(result.fullAccessible).toBe(true);
        expect(result.unlockedBadges).toHaveLength(5);
        expect(result.lockedBadges).toHaveLength(0);
      });

      it('shows no unlock action for arrakis_full', () => {
        const viewerStatus = createStatus({
          hasArrakisWallet: true,
          isArrakisVerified: true,
        });
        const badges = createBadges(5);

        const result = glimpseMode.createBadgeShowcase(viewerStatus, badges);

        expect(result.unlockAction).toBe('');
      });
    });
  });

  // ===========================================================================
  // TASK-61.4: Own Preview Profile
  // ===========================================================================

  describe('createOwnPreviewProfile', () => {
    it('creates preview profile with badge stats', () => {
      const status = createStatus({ hasArrakisWallet: false });
      const profileData = {
        nym: 'PreviewUser',
        pfpUrl: 'https://example.com/pfp.png',
        badges: [
          { category: 'achievement' },
          { category: 'achievement' },
          { category: 'participation' },
        ],
      };
      const stats = { convictionRank: 15, totalMembers: 100 };

      const result = glimpseMode.createOwnPreviewProfile(status, profileData, stats);

      expect(result.memberId).toBe('test-member-456');
      expect(result.nym).toBe('PreviewUser');
      expect(result.currentTier).toBe('incumbent_only');
      expect(result.previewStats.badgeCount).toBe(3);
      expect(result.previewStats.badgesByCategory.get('achievement')).toBe(2);
      expect(result.previewStats.badgesByCategory.get('participation')).toBe(1);
    });

    it('calculates conviction percentile correctly', () => {
      const status = createStatus({ hasArrakisWallet: false });
      const profileData = { nym: 'User', badges: [] };
      const stats = { convictionRank: 10, totalMembers: 100 };

      const result = glimpseMode.createOwnPreviewProfile(status, profileData, stats);

      expect(result.previewStats.convictionRank).toBe(10);
      expect(result.previewStats.convictionPercentile).toBe('Top 9%');
    });

    it('shows features to unlock for incumbent_only', () => {
      const status = createStatus({ hasArrakisWallet: false });
      const profileData = { nym: 'User', badges: [] };
      const stats = { totalMembers: 100 };

      const result = glimpseMode.createOwnPreviewProfile(status, profileData, stats);

      expect(result.featuresToUnlock.length).toBeGreaterThan(0);
      expect(result.nextUpgradeAction).toBe('Connect your wallet');
      expect(result.nextTierName).toBe('Arrakis Basic');
    });

    it('shows features to unlock for arrakis_basic', () => {
      const status = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: false,
      });
      const profileData = { nym: 'User', badges: [] };
      const stats = { totalMembers: 100 };

      const result = glimpseMode.createOwnPreviewProfile(status, profileData, stats);

      expect(result.featuresToUnlock.length).toBeGreaterThan(0);
      expect(result.nextUpgradeAction).toBe('Complete verification');
      expect(result.nextTierName).toBe('Arrakis Full');
    });

    it('shows no features to unlock for arrakis_full', () => {
      const status = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: true,
      });
      const profileData = { nym: 'User', badges: [] };
      const stats = { totalMembers: 100 };

      const result = glimpseMode.createOwnPreviewProfile(status, profileData, stats);

      expect(result.featuresToUnlock).toHaveLength(0);
    });
  });

  // ===========================================================================
  // TASK-61.5: Upgrade CTA (TASK-61.10 tests)
  // ===========================================================================

  describe('createUpgradeCTA', () => {
    it('creates wallet connection CTA for incumbent_only', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.createUpgradeCTA(viewerStatus, 'profile');

      expect(result).not.toBeNull();
      expect(result!.currentTier).toBe('incumbent_only');
      expect(result!.targetTier).toBe('arrakis_basic');
      expect(result!.actionType).toBe('connect_wallet');
      expect(result!.buttonLabel).toBe('Connect Wallet');
    });

    it('creates verification CTA for arrakis_basic', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: false,
      });

      const result = glimpseMode.createUpgradeCTA(viewerStatus, 'badge');

      expect(result).not.toBeNull();
      expect(result!.currentTier).toBe('arrakis_basic');
      expect(result!.targetTier).toBe('arrakis_full');
      expect(result!.actionType).toBe('complete_verification');
      expect(result!.buttonLabel).toBe('Complete Verification');
    });

    it('returns null for arrakis_full', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: true,
      });

      const result = glimpseMode.createUpgradeCTA(viewerStatus, 'profile');

      expect(result).toBeNull();
    });

    it('generates CTA ID with context and tier', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.createUpgradeCTA(viewerStatus, 'profile');

      // CTA ID should contain context and tier information
      expect(result!.ctaId).toContain('profile');
      expect(result!.ctaId).toContain('incumbent_only');
    });

    it('includes context-specific messaging', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const profileCTA = glimpseMode.createUpgradeCTA(viewerStatus, 'profile');
      const leaderboardCTA = glimpseMode.createUpgradeCTA(viewerStatus, 'leaderboard');

      expect(profileCTA!.title).toContain('Profile');
      expect(leaderboardCTA!.title).toContain('Leaderboard');
    });

    it('includes unlock features list', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.createUpgradeCTA(viewerStatus, 'profile');

      expect(result!.unlockFeatures.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // TASK-61.6: Badge Count Preview
  // ===========================================================================

  describe('getBadgeCountPreview', () => {
    it('returns full count for arrakis_full', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: true,
      });

      const result = glimpseMode.getBadgeCountPreview(viewerStatus, 10);

      expect(result.count).toBe(10);
      expect(result.label).toBe('10 badges');
      expect(result.isPreview).toBe(false);
      expect(result.message).toBe('');
    });

    it('returns preview count for arrakis_basic', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: false,
      });

      const result = glimpseMode.getBadgeCountPreview(viewerStatus, 5);

      expect(result.count).toBe(5);
      expect(result.label).toBe('5 badges earned');
      expect(result.isPreview).toBe(true);
      expect(result.message).toContain('verification');
    });

    it('returns preview count for incumbent_only', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.getBadgeCountPreview(viewerStatus, 3);

      expect(result.count).toBe(3);
      expect(result.label).toBe('3 badges ready');
      expect(result.isPreview).toBe(true);
      expect(result.message).toContain('wallet');
    });
  });

  // ===========================================================================
  // TASK-61.7: Conviction Rank Position
  // ===========================================================================

  describe('calculateConvictionRank', () => {
    it('calculates percentile correctly', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: false,
      });

      const result = glimpseMode.calculateConvictionRank(viewerStatus, 10, 100);

      expect(result.position).toBe(10);
      expect(result.totalMembers).toBe(100);
      expect(result.percentile).toBe(10);
      expect(result.percentileLabel).toContain('Top 10%');
    });

    it('formats percentile label for top positions', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: true,
      });

      const result = glimpseMode.calculateConvictionRank(viewerStatus, 5, 100);

      expect(result.percentileLabel).toContain('Top 5%');
    });

    it('shows conviction score for arrakis_basic+', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: false,
      });

      const result = glimpseMode.calculateConvictionRank(viewerStatus, 10, 100, 85);

      expect(result.detailedVisible).toBe(true);
      expect(result.convictionScore).toBe(85);
      expect(result.upgradeAction).toBeUndefined();
    });

    it('hides conviction score for incumbent_only', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.calculateConvictionRank(viewerStatus, 10, 100, 85);

      expect(result.detailedVisible).toBe(false);
      expect(result.convictionScore).toBeUndefined();
      expect(result.upgradeAction).toContain('Connect wallet');
    });
  });

  // ===========================================================================
  // TASK-61.8: Unlock Messaging
  // ===========================================================================

  describe('getUnlockMessage', () => {
    it('returns wallet connection message for incumbent_only', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.getUnlockMessage(viewerStatus, 'profile_view');

      expect(result.message).toContain('wallet');
      expect(result.action).toBe('connect_wallet');
      expect(result.buttonLabel).toBe('Connect Wallet');
    });

    it('returns verification message for arrakis_basic', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: false,
      });

      const result = glimpseMode.getUnlockMessage(viewerStatus, 'badge_showcase');

      expect(result.message).toContain('verification');
      expect(result.action).toBe('complete_verification');
      expect(result.buttonLabel).toBe('Complete Verification');
    });

    it('returns empty message for arrakis_full', () => {
      const viewerStatus = createStatus({
        hasArrakisWallet: true,
        isArrakisVerified: true,
      });

      const result = glimpseMode.getUnlockMessage(viewerStatus, 'full_profile');

      expect(result.message).toBe('');
      expect(result.action).toBe('');
      expect(result.buttonLabel).toBe('');
    });

    it('includes feature name in message', () => {
      const viewerStatus = createStatus({ hasArrakisWallet: false });

      const result = glimpseMode.getUnlockMessage(viewerStatus, 'badge_showcase');

      expect(result.message).toContain('Badge Showcase');
    });
  });

  // ===========================================================================
  // Tell Admin Functionality
  // ===========================================================================

  describe('createTellAdminRequest', () => {
    it('creates a tell admin request', () => {
      const status = createStatus();

      const result = glimpseMode.createTellAdminRequest(status, 'Please migrate!');

      expect(result.memberId).toBe('test-member-456');
      expect(result.communityId).toBe('test-community-123');
      expect(result.requestType).toBe('migrate_community');
      expect(result.message).toBe('Please migrate!');
      expect(result.isRepeat).toBe(false);
      expect(result.requestedAt).toBeInstanceOf(Date);
    });

    it('throttles repeat requests', () => {
      const status = createStatus();

      // First request
      const first = glimpseMode.createTellAdminRequest(status);
      expect(first.isRepeat).toBe(false);

      // Second request (should be throttled)
      const second = glimpseMode.createTellAdminRequest(status);
      expect(second.isRepeat).toBe(true);
      expect(second.nextAllowedAt).toBeDefined();
    });

    it('allows requests from different users', () => {
      const status1 = createStatus({ memberId: 'user-1' });
      const status2 = createStatus({ memberId: 'user-2' });

      const first = glimpseMode.createTellAdminRequest(status1);
      const second = glimpseMode.createTellAdminRequest(status2);

      expect(first.isRepeat).toBe(false);
      expect(second.isRepeat).toBe(false);
    });

    it('clears throttle with clearThrottle()', () => {
      const status = createStatus();

      glimpseMode.createTellAdminRequest(status);
      glimpseMode.clearThrottle();
      const result = glimpseMode.createTellAdminRequest(status);

      expect(result.isRepeat).toBe(false);
    });
  });

  // ===========================================================================
  // Integration with TierIntegration
  // ===========================================================================

  describe('getTierIntegration', () => {
    it('returns the tier integration instance', () => {
      const integration = glimpseMode.getTierIntegration();

      expect(integration).toBeDefined();
      expect(typeof integration.getTiersService).toBe('function');
      expect(typeof integration.getFeatureGate).toBe('function');
    });
  });
});
