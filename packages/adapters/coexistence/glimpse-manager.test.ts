/**
 * GlimpseManager Tests
 *
 * Sprint S-27: Glimpse Mode & Migration Readiness
 *
 * Tests for glimpse mode operations and migration readiness checks.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Logger } from 'pino';
import {
  GlimpseManager,
  createGlimpseManager,
  type ILeaderboardDataSource,
  type IProfileDataSource,
  type IBadgeDataSource,
  type ICommunityVerificationSource,
  type IShadowStats,
  type IGlimpseConfigStore,
  type IGlimpseMetrics,
} from './glimpse-manager.js';
import type { GlimpseContext } from '@arrakis/core/ports';
import type {
  GlimpseModeConfig,
  MigrationReadinessRequirements,
  PreviewProfile,
} from '@arrakis/core/domain';

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockLogger(): Logger {
  return {
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function createMockLeaderboard(): ILeaderboardDataSource {
  return {
    getLeaderboard: vi.fn().mockResolvedValue({
      entries: [
        { userId: 'user-1', displayName: 'User One', score: 1000, tier: 'Gold', rank: 1 },
        { userId: 'user-2', displayName: 'User Two', score: 800, tier: 'Silver', rank: 2 },
        { userId: 'user-3', displayName: 'User Three', score: 600, tier: 'Bronze', rank: 3 },
      ],
      total: 100,
    }),
    getUserPosition: vi.fn().mockResolvedValue({
      rank: 5,
      score: 500,
      tier: 'Silver',
      displayName: 'Viewer',
    }),
  };
}

function createMockProfiles(): IProfileDataSource {
  return {
    getProfiles: vi.fn().mockResolvedValue({
      profiles: [
        {
          userId: 'user-1',
          displayName: 'User One',
          avatarUrl: 'https://example.com/avatar1.png',
          tierName: 'Gold',
          convictionScore: 1000,
          badgeCount: 5,
        },
        {
          userId: 'user-2',
          displayName: 'User Two',
          avatarUrl: 'https://example.com/avatar2.png',
          tierName: 'Silver',
          convictionScore: 800,
          badgeCount: 3,
        },
      ],
      total: 50,
    }),
    getFullProfile: vi.fn().mockResolvedValue({
      userId: 'viewer-123',
      displayName: 'Viewer',
      avatarUrl: 'https://example.com/viewer.png',
      tier: { name: 'Silver', rank: 2, color: '#C0C0C0', icon: null },
      convictionScore: 500,
      leaderboardPosition: 5,
      totalMembers: 100,
      percentile: 5,
      earnedBadges: [],
      totalBadgesAvailable: 10,
      memberSince: new Date('2024-01-01'),
      daysAsMember: 365,
      walletAddresses: [],
      nftHoldings: [],
      tokenHoldings: [],
    } as PreviewProfile),
  };
}

function createMockBadges(): IBadgeDataSource {
  return {
    getBadges: vi.fn().mockResolvedValue({
      badges: [
        {
          badgeId: 'badge-1',
          name: 'Early Adopter',
          description: 'Joined early',
          iconUrl: 'https://example.com/badge1.png',
          rarity: 'rare',
          totalHolders: 50,
        },
        {
          badgeId: 'badge-2',
          name: 'Whale',
          description: 'Big holder',
          iconUrl: 'https://example.com/badge2.png',
          rarity: 'legendary',
          totalHolders: 10,
        },
      ],
      total: 20,
    }),
    getUserBadges: vi.fn().mockResolvedValue(['badge-1']), // Viewer has badge-1
  };
}

function createMockVerification(): ICommunityVerificationSource {
  return {
    getVerificationTier: vi.fn().mockResolvedValue('incumbent_only'),
    getGuildId: vi.fn().mockResolvedValue('guild-123'),
    getShadowModeStartDate: vi.fn().mockResolvedValue(
      new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) // 20 days ago
    ),
  };
}

function createMockShadow(): IShadowStats {
  return {
    getStats: vi.fn().mockResolvedValue({
      accuracy: 0.96,
      totalMembers: 100,
      divergentMembers: 4,
      lastSyncAt: new Date(),
    }),
  };
}

function createMockConfigStore(): IGlimpseConfigStore {
  return {
    getConfig: vi.fn().mockResolvedValue(null),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getRequirements: vi.fn().mockResolvedValue(null),
    saveRequirements: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMetrics(): IGlimpseMetrics {
  return {
    glimpseViews: { inc: vi.fn() },
    readinessChecks: { inc: vi.fn() },
  };
}

function createTestContext(viewerId = 'viewer-123'): GlimpseContext {
  return {
    communityId: 'community-123',
    guildId: 'guild-123',
    viewerId,
    isAdmin: false,
  };
}

// =============================================================================
// GlimpseManager Tests
// =============================================================================

describe('GlimpseManager', () => {
  let leaderboard: ILeaderboardDataSource;
  let profiles: IProfileDataSource;
  let badges: IBadgeDataSource;
  let verification: ICommunityVerificationSource;
  let shadow: IShadowStats;
  let configStore: IGlimpseConfigStore;
  let metrics: IGlimpseMetrics;
  let logger: Logger;
  let manager: GlimpseManager;

  beforeEach(() => {
    leaderboard = createMockLeaderboard();
    profiles = createMockProfiles();
    badges = createMockBadges();
    verification = createMockVerification();
    shadow = createMockShadow();
    configStore = createMockConfigStore();
    metrics = createMockMetrics();
    logger = createMockLogger();

    manager = new GlimpseManager(
      leaderboard,
      profiles,
      badges,
      verification,
      shadow,
      configStore,
      metrics,
      logger
    );
  });

  // ===========================================================================
  // Glimpse Mode Lifecycle Tests
  // ===========================================================================

  describe('isGlimpseModeActive', () => {
    it('should return true when tier is incumbent_only', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('incumbent_only');

      const active = await manager.isGlimpseModeActive('community-123');

      expect(active).toBe(true);
    });

    it('should return true when tier is arrakis_basic', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_basic');

      const active = await manager.isGlimpseModeActive('community-123');

      expect(active).toBe(true);
    });

    it('should return false when tier is arrakis_full', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_full');

      const active = await manager.isGlimpseModeActive('community-123');

      expect(active).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return complete status for community', async () => {
      const status = await manager.getStatus('community-123');

      expect(status).not.toBeNull();
      expect(status!.communityId).toBe('community-123');
      expect(status!.guildId).toBe('guild-123');
      expect(status!.active).toBe(true);
      expect(status!.verificationTier).toBe('incumbent_only');
      expect(status!.availableFeatures).toBeDefined();
      expect(status!.lockedFeatures).toBeDefined();
      expect(status!.migrationReadiness).toBeDefined();
    });

    it('should return null for non-existent community', async () => {
      (verification.getGuildId as Mock).mockResolvedValue(null);

      const status = await manager.getStatus('nonexistent');

      expect(status).toBeNull();
    });

    it('should return null when tier is null', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue(null);

      const status = await manager.getStatus('community-123');

      expect(status).toBeNull();
    });

    it('should show inactive for arrakis_full tier', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_full');

      const status = await manager.getStatus('community-123');

      expect(status!.active).toBe(false);
      expect(status!.lockedFeatures).toHaveLength(0);
    });
  });

  describe('getConfig', () => {
    it('should return stored config if exists', async () => {
      const storedConfig: GlimpseModeConfig = {
        communityId: 'community-123',
        guildId: 'guild-123',
        enabled: true,
        leaderboardVisibility: 'preview',
        profileDirectoryVisibility: 'blurred',
        badgeShowcaseVisibility: 'locked',
        showUnlockCTA: false,
        customUnlockMessage: 'Custom message',
      };
      (configStore.getConfig as Mock).mockResolvedValue(storedConfig);

      const config = await manager.getConfig('community-123');

      expect(config).toEqual(storedConfig);
    });

    it('should return default config if not stored', async () => {
      const config = await manager.getConfig('community-123');

      expect(config).not.toBeNull();
      expect(config!.enabled).toBe(true);
      expect(config!.leaderboardVisibility).toBe('preview');
      expect(config!.profileDirectoryVisibility).toBe('blurred');
      expect(config!.badgeShowcaseVisibility).toBe('locked');
      expect(config!.showUnlockCTA).toBe(true);
    });

    it('should return null for non-existent community', async () => {
      (verification.getGuildId as Mock).mockResolvedValue(null);

      const config = await manager.getConfig('nonexistent');

      expect(config).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('should update config with partial values', async () => {
      await manager.updateConfig('community-123', {
        showUnlockCTA: false,
        customUnlockMessage: 'New message',
      });

      expect(configStore.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'community-123',
          showUnlockCTA: false,
          customUnlockMessage: 'New message',
        })
      );
    });

    it('should throw for non-existent community', async () => {
      (verification.getGuildId as Mock).mockResolvedValue(null);

      await expect(
        manager.updateConfig('nonexistent', { showUnlockCTA: false })
      ).rejects.toThrow('Community nonexistent not found');
    });
  });

  // ===========================================================================
  // Leaderboard Glimpse Tests (S-27.1)
  // ===========================================================================

  describe('getLeaderboard', () => {
    it('should hide competitor details in glimpse mode', async () => {
      const context = createTestContext();

      const result = await manager.getLeaderboard(context);

      expect(result.isGlimpseMode).toBe(true);

      // Non-viewer entries should be glimpsed
      const nonViewerEntry = result.entries.find((e) => e.userId !== 'viewer-123');
      expect(nonViewerEntry!.displayName).toBeNull();
      expect(nonViewerEntry!.score).toBeNull();
      expect(nonViewerEntry!.tier).toBeNull();
      expect(nonViewerEntry!.isGlimpsed).toBe(true);
    });

    it('should always show viewer entry', async () => {
      const context = createTestContext('user-1');

      const result = await manager.getLeaderboard(context);

      // Viewer entry from leaderboard should not be glimpsed
      const viewerEntry = result.entries.find((e) => e.isViewer);
      expect(viewerEntry).toBeDefined();
      expect(viewerEntry!.displayName).toBe('User One');
      expect(viewerEntry!.score).toBe(1000);
      expect(viewerEntry!.isGlimpsed).toBe(false);
    });

    it('should include separate viewerEntry', async () => {
      const context = createTestContext();

      const result = await manager.getLeaderboard(context);

      expect(result.viewerEntry).not.toBeNull();
      expect(result.viewerEntry!.rank).toBe(5);
      expect(result.viewerEntry!.score).toBe(500);
      expect(result.viewerEntry!.isViewer).toBe(true);
    });

    it('should show all details when arrakis_full', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_full');
      const context = createTestContext();

      const result = await manager.getLeaderboard(context);

      expect(result.isGlimpseMode).toBe(false);

      // All entries should have details
      for (const entry of result.entries) {
        expect(entry.displayName).not.toBeNull();
        expect(entry.score).not.toBeNull();
        expect(entry.isGlimpsed).toBe(false);
      }
    });

    it('should include unlock message in glimpse mode', async () => {
      const context = createTestContext();

      const result = await manager.getLeaderboard(context);

      expect(result.unlockMessage).toBeDefined();
      expect(result.unlockMessage).toContain('community migrates');
    });

    it('should not include unlock message when not in glimpse mode', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_full');
      const context = createTestContext();

      const result = await manager.getLeaderboard(context);

      expect(result.unlockMessage).toBeUndefined();
    });

    it('should record metrics', async () => {
      const context = createTestContext();

      await manager.getLeaderboard(context);

      expect(metrics.glimpseViews.inc).toHaveBeenCalledWith({
        community_id: 'community-123',
        feature: 'leaderboard',
      });
    });

    it('should pass options to data source', async () => {
      const context = createTestContext();

      await manager.getLeaderboard(context, {
        limit: 10,
        offset: 5,
        period: 'week',
      });

      expect(leaderboard.getLeaderboard).toHaveBeenCalledWith('guild-123', {
        limit: 10,
        offset: 5,
        period: 'week',
      });
    });
  });

  // ===========================================================================
  // Profile Directory Glimpse Tests (S-27.2)
  // ===========================================================================

  describe('getProfileDirectory', () => {
    it('should blur non-viewer profiles in glimpse mode', async () => {
      const context = createTestContext();

      const result = await manager.getProfileDirectory(context);

      expect(result.isGlimpseMode).toBe(true);

      // Non-viewer profiles should be blurred
      const blurredProfile = result.profiles.find((p) => p.userId !== 'viewer-123');
      expect(blurredProfile!.displayName).toBeNull();
      expect(blurredProfile!.avatarUrl).toBeNull();
      expect(blurredProfile!.tierName).toBeNull();
      expect(blurredProfile!.convictionScore).toBeNull();
      expect(blurredProfile!.isBlurred).toBe(true);
      // Badge count should still be visible
      expect(blurredProfile!.badgeCount).toBeGreaterThanOrEqual(0);
    });

    it('should show viewer profile in full', async () => {
      // Set viewer to be in the profile list
      (profiles.getProfiles as Mock).mockResolvedValue({
        profiles: [
          {
            userId: 'viewer-123',
            displayName: 'Viewer',
            avatarUrl: 'https://example.com/viewer.png',
            tierName: 'Silver',
            convictionScore: 500,
            badgeCount: 2,
          },
          {
            userId: 'user-2',
            displayName: 'User Two',
            avatarUrl: 'https://example.com/avatar2.png',
            tierName: 'Gold',
            convictionScore: 800,
            badgeCount: 3,
          },
        ],
        total: 50,
      });

      const context = createTestContext();

      const result = await manager.getProfileDirectory(context);

      const viewerProfile = result.profiles.find((p) => p.isViewer);
      expect(viewerProfile!.displayName).toBe('Viewer');
      expect(viewerProfile!.avatarUrl).toBe('https://example.com/viewer.png');
      expect(viewerProfile!.tierName).toBe('Silver');
      expect(viewerProfile!.isBlurred).toBe(false);
    });

    it('should include viewerProfile separately', async () => {
      (profiles.getProfiles as Mock).mockResolvedValue({
        profiles: [
          {
            userId: 'viewer-123',
            displayName: 'Viewer',
            avatarUrl: 'https://example.com/viewer.png',
            tierName: 'Silver',
            convictionScore: 500,
            badgeCount: 2,
          },
        ],
        total: 1,
      });

      const context = createTestContext();

      const result = await manager.getProfileDirectory(context);

      expect(result.viewerProfile).not.toBeNull();
      expect(result.viewerProfile!.isViewer).toBe(true);
      expect(result.viewerProfile!.isBlurred).toBe(false);
    });

    it('should show all details when arrakis_full', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_full');
      const context = createTestContext();

      const result = await manager.getProfileDirectory(context);

      expect(result.isGlimpseMode).toBe(false);

      // All profiles should have details
      for (const profile of result.profiles) {
        expect(profile.displayName).not.toBeNull();
        expect(profile.isBlurred).toBe(false);
      }
    });

    it('should record metrics', async () => {
      const context = createTestContext();

      await manager.getProfileDirectory(context);

      expect(metrics.glimpseViews.inc).toHaveBeenCalledWith({
        community_id: 'community-123',
        feature: 'profile_directory',
      });
    });
  });

  // ===========================================================================
  // Badge Showcase Glimpse Tests (S-27.3)
  // ===========================================================================

  describe('getBadgeShowcase', () => {
    it('should lock unearned badges in glimpse mode', async () => {
      const context = createTestContext();

      const result = await manager.getBadgeShowcase(context);

      expect(result.isGlimpseMode).toBe(true);

      // Badge viewer has not earned should be locked
      const lockedBadge = result.badges.find((b) => b.badgeId === 'badge-2');
      expect(lockedBadge!.isLocked).toBe(true);
      expect(lockedBadge!.viewerEarned).toBe(false);
    });

    it('should not lock earned badges', async () => {
      const context = createTestContext();

      const result = await manager.getBadgeShowcase(context);

      // Badge viewer has earned should not be locked
      const earnedBadge = result.badges.find((b) => b.badgeId === 'badge-1');
      expect(earnedBadge!.isLocked).toBe(false);
      expect(earnedBadge!.viewerEarned).toBe(true);
    });

    it('should include viewerBadges array', async () => {
      const context = createTestContext();

      const result = await manager.getBadgeShowcase(context);

      expect(result.viewerBadges).toHaveLength(1);
      expect(result.viewerBadges[0]!.badgeId).toBe('badge-1');
    });

    it('should not lock any badges when arrakis_full', async () => {
      (verification.getVerificationTier as Mock).mockResolvedValue('arrakis_full');
      const context = createTestContext();

      const result = await manager.getBadgeShowcase(context);

      expect(result.isGlimpseMode).toBe(false);

      // Even unearned badges should not be locked
      const unearnedBadge = result.badges.find((b) => !b.viewerEarned);
      expect(unearnedBadge!.isLocked).toBe(false);
    });

    it('should preserve badge metadata', async () => {
      const context = createTestContext();

      const result = await manager.getBadgeShowcase(context);

      const badge = result.badges[0]!;
      expect(badge.name).toBe('Early Adopter');
      expect(badge.description).toBe('Joined early');
      expect(badge.iconUrl).toBe('https://example.com/badge1.png');
      expect(badge.rarity).toBe('rare');
      expect(badge.totalHolders).toBe(50);
    });

    it('should record metrics', async () => {
      const context = createTestContext();

      await manager.getBadgeShowcase(context);

      expect(metrics.glimpseViews.inc).toHaveBeenCalledWith({
        community_id: 'community-123',
        feature: 'badge_showcase',
      });
    });
  });

  // ===========================================================================
  // Preview Profile Tests (S-27.4)
  // ===========================================================================

  describe('getPreviewProfile', () => {
    it('should return full profile for viewer', async () => {
      const context = createTestContext();

      const result = await manager.getPreviewProfile(context);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe('viewer-123');
      expect(result!.displayName).toBe('Viewer');
      expect(result!.convictionScore).toBe(500);
      expect(result!.leaderboardPosition).toBe(5);
    });

    it('should return full profile regardless of tier', async () => {
      // Even in incumbent_only, viewer sees their full profile
      const context = createTestContext();

      const result = await manager.getPreviewProfile(context);

      expect(result).not.toBeNull();
      expect(result!.tier).toBeDefined();
      expect(result!.percentile).toBeDefined();
      expect(result!.memberSince).toBeDefined();
    });

    it('should return null if profile not found', async () => {
      (profiles.getFullProfile as Mock).mockResolvedValue(null);
      const context = createTestContext();

      const result = await manager.getPreviewProfile(context);

      expect(result).toBeNull();
    });

    it('should record metrics', async () => {
      const context = createTestContext();

      await manager.getPreviewProfile(context);

      expect(metrics.glimpseViews.inc).toHaveBeenCalledWith({
        community_id: 'community-123',
        feature: 'preview_profile',
      });
    });
  });

  // ===========================================================================
  // Unlock Messaging Tests (S-27.5)
  // ===========================================================================

  describe('getUnlockMessage', () => {
    it('should return custom message if set', async () => {
      (configStore.getConfig as Mock).mockResolvedValue({
        communityId: 'community-123',
        guildId: 'guild-123',
        enabled: true,
        leaderboardVisibility: 'preview',
        profileDirectoryVisibility: 'blurred',
        badgeShowcaseVisibility: 'locked',
        showUnlockCTA: true,
        customUnlockMessage: 'Custom unlock message here',
      });

      const result = await manager.getUnlockMessage('community-123', 'leaderboard', false);

      expect(result.type).toBe('custom');
      expect(result.message).toBe('Custom unlock message here');
    });

    it('should return admin_action_required when ready', async () => {
      // Mock readiness as ready
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
      );
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.98,
        totalMembers: 100,
        divergentMembers: 2,
        lastSyncAt: new Date(),
      });

      const result = await manager.getUnlockMessage('community-123', 'leaderboard', false);

      expect(result.type).toBe('admin_action_required');
    });

    it('should show readiness status to admins when not ready', async () => {
      // Mock readiness as not ready (5 days < 14)
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      );

      const result = await manager.getUnlockMessage('community-123', 'leaderboard', true);

      expect(result.type).toBe('readiness_check');
      expect(result.description).toContain('Blockers');
    });

    it('should return migration_cta for non-admins when not ready', async () => {
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      );

      const result = await manager.getUnlockMessage('community-123', 'leaderboard', false);

      expect(result.type).toBe('migration_cta');
      expect(result.message).toContain('community migrates');
    });
  });

  describe('setCustomUnlockMessage', () => {
    it('should update config with custom message', async () => {
      await manager.setCustomUnlockMessage('community-123', 'New custom message');

      expect(configStore.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          customUnlockMessage: 'New custom message',
        })
      );
    });
  });

  // ===========================================================================
  // Migration Readiness Tests (S-27.6)
  // ===========================================================================

  describe('checkReadiness', () => {
    it('should return ready when all checks pass', async () => {
      // 20 days > 14, accuracy 96% > 95%
      const result = await manager.checkReadiness('community-123');

      expect(result.ready).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('should return not ready when shadow days insufficient', async () => {
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // Only 5 days
      );

      const result = await manager.checkReadiness('community-123');

      expect(result.ready).toBe(false);
      expect(result.blockers).toContainEqual(expect.stringContaining('Insufficient shadow days'));
    });

    it('should return not ready when accuracy insufficient', async () => {
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.90, // Below 95%
        totalMembers: 100,
        divergentMembers: 10,
        lastSyncAt: new Date(),
      });

      const result = await manager.checkReadiness('community-123');

      expect(result.ready).toBe(false);
      expect(result.blockers).toContainEqual(expect.stringContaining('Insufficient accuracy'));
    });

    it('should include warnings for high divergence', async () => {
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.96,
        totalMembers: 100,
        divergentMembers: 10, // 10% divergence > 5% threshold
        lastSyncAt: new Date(),
      });

      const result = await manager.checkReadiness('community-123');

      expect(result.warnings).toContainEqual(expect.stringContaining('High divergence rate'));
    });

    it('should return checks array with details', async () => {
      const result = await manager.checkReadiness('community-123');

      expect(result.checks).toHaveLength(2);

      const shadowCheck = result.checks.find((c) => c.name === 'Shadow Mode Duration');
      expect(shadowCheck).toBeDefined();
      expect(shadowCheck!.passed).toBe(true);

      const accuracyCheck = result.checks.find((c) => c.name === 'Shadow Accuracy');
      expect(accuracyCheck).toBeDefined();
      expect(accuracyCheck!.passed).toBe(true);
    });

    it('should handle non-existent community', async () => {
      (verification.getGuildId as Mock).mockResolvedValue(null);

      const result = await manager.checkReadiness('nonexistent');

      expect(result.ready).toBe(false);
      expect(result.blockers).toContain('Community not found');
    });

    it('should record metrics', async () => {
      await manager.checkReadiness('community-123');

      expect(metrics.readinessChecks.inc).toHaveBeenCalledWith({
        community_id: 'community-123',
        result: 'ready',
      });
    });

    it('should record not_ready metrics when not ready', async () => {
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      );

      await manager.checkReadiness('community-123');

      expect(metrics.readinessChecks.inc).toHaveBeenCalledWith({
        community_id: 'community-123',
        result: 'not_ready',
      });
    });
  });

  describe('getRequirements', () => {
    it('should return stored requirements if exists', async () => {
      const storedReqs: MigrationReadinessRequirements = {
        minShadowDays: 7,
        minAccuracy: 0.90,
        requireHealthyIncumbent: true,
        maxDivergenceRate: 0.10,
      };
      (configStore.getRequirements as Mock).mockResolvedValue(storedReqs);

      const result = await manager.getRequirements('community-123');

      expect(result).toEqual(storedReqs);
    });

    it('should return defaults if not stored', async () => {
      const result = await manager.getRequirements('community-123');

      expect(result.minShadowDays).toBe(14);
      expect(result.minAccuracy).toBe(0.95);
    });
  });

  describe('updateRequirements', () => {
    it('should update requirements with partial values', async () => {
      await manager.updateRequirements('community-123', {
        minShadowDays: 7,
      });

      expect(configStore.saveRequirements).toHaveBeenCalledWith(
        'community-123',
        expect.objectContaining({
          minShadowDays: 7,
          minAccuracy: 0.95, // Default preserved
        })
      );
    });
  });

  describe('getShadowDays', () => {
    it('should calculate days since shadow mode start', async () => {
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
      );

      const days = await manager.getShadowDays('community-123');

      expect(days).toBe(15);
    });

    it('should return 0 if no start date', async () => {
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(null);

      const days = await manager.getShadowDays('community-123');

      expect(days).toBe(0);
    });
  });

  describe('getShadowAccuracy', () => {
    it('should return accuracy from shadow stats', async () => {
      const accuracy = await manager.getShadowAccuracy('community-123');

      expect(accuracy).toBe(0.96);
    });

    it('should return 0 if no guild', async () => {
      (verification.getGuildId as Mock).mockResolvedValue(null);

      const accuracy = await manager.getShadowAccuracy('community-123');

      expect(accuracy).toBe(0);
    });
  });

  describe('estimateDaysUntilReady', () => {
    it('should return null when already ready', async () => {
      const result = await manager.estimateDaysUntilReady('community-123');

      // 20 days > 14, 96% > 95%, so ready
      expect(result).toBeNull();
    });

    it('should estimate based on shadow days needed', async () => {
      (verification.getShadowModeStartDate as Mock).mockResolvedValue(
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      );

      const result = await manager.estimateDaysUntilReady('community-123');

      // Need 14 - 5 = 9 more days
      expect(result).toBe(9);
    });

    it('should estimate based on accuracy improvement when low', async () => {
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.85, // 10% below target
        totalMembers: 100,
        divergentMembers: 15,
        lastSyncAt: new Date(),
      });

      const result = await manager.estimateDaysUntilReady('community-123');

      // 10% gap * 100 * 7 = 70 days estimated
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('getRecommendedStrategy', () => {
    it('should recommend instant for high accuracy', async () => {
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.99,
        totalMembers: 100,
        divergentMembers: 1,
        lastSyncAt: new Date(),
      });

      const strategy = await manager.getRecommendedStrategy('community-123');

      expect(strategy).toBe('instant');
    });

    it('should recommend gradual for good accuracy', async () => {
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.96,
        totalMembers: 100,
        divergentMembers: 4,
        lastSyncAt: new Date(),
      });

      const strategy = await manager.getRecommendedStrategy('community-123');

      expect(strategy).toBe('gradual');
    });

    it('should recommend parallel_forever for lower accuracy', async () => {
      (shadow.getStats as Mock).mockResolvedValue({
        accuracy: 0.90,
        totalMembers: 100,
        divergentMembers: 10,
        lastSyncAt: new Date(),
      });

      const strategy = await manager.getRecommendedStrategy('community-123');

      expect(strategy).toBe('parallel_forever');
    });

    it('should return null for non-existent community', async () => {
      (verification.getGuildId as Mock).mockResolvedValue(null);

      const strategy = await manager.getRecommendedStrategy('nonexistent');

      expect(strategy).toBeNull();
    });
  });
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createGlimpseManager', () => {
  it('should create a GlimpseManager instance', () => {
    const manager = createGlimpseManager(
      createMockLeaderboard(),
      createMockProfiles(),
      createMockBadges(),
      createMockVerification(),
      createMockShadow(),
      createMockConfigStore(),
      createMockMetrics(),
      createMockLogger()
    );

    expect(manager).toBeInstanceOf(GlimpseManager);
  });

  it('should accept custom options', () => {
    const manager = createGlimpseManager(
      createMockLeaderboard(),
      createMockProfiles(),
      createMockBadges(),
      createMockVerification(),
      createMockShadow(),
      createMockConfigStore(),
      createMockMetrics(),
      createMockLogger(),
      {
        defaultLeaderboardLimit: 50,
        defaultProfileLimit: 30,
      }
    );

    expect(manager).toBeInstanceOf(GlimpseManager);
  });
});
