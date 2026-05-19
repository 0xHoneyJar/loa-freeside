/**
 * ShadowSyncJob Tests
 *
 * Sprint S-25: Shadow Sync Job & Verification Tiers
 *
 * Tests for 6-hour periodic shadow comparison, cursor-based pagination,
 * accuracy calculation, and digest notification.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { Logger } from 'pino';
import {
  ShadowSyncJob,
  type IDiscordMemberService,
  type ICommunityRepository,
  type IEligibilityChecker,
  type INatsPublisher,
  type IMetricsClient,
  type GuildMemberData,
  type EligibilityRule,
} from './shadow-sync-job.js';
import type { IShadowLedger } from '@freeside/core/ports';
import type { VerificationTier, ArrakisEligibilityResult } from '@freeside/core/domain';

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

function createMockDiscord(): IDiscordMemberService {
  return {
    getGuildMembers: vi.fn(),
  };
}

function createMockShadowLedger(): IShadowLedger {
  return {
    getMemberState: vi.fn(),
    getGuildStates: vi.fn(),
    getDivergentMembers: vi.fn(),
    saveMemberState: vi.fn(),
    saveMemberStates: vi.fn(),
    deleteMemberState: vi.fn(),
    deleteGuildStates: vi.fn(),
    recordDivergence: vi.fn(),
    getDivergences: vi.fn(),
    resolveDivergence: vi.fn(),
    getDivergenceCounts: vi.fn(),
    recordPrediction: vi.fn(),
    getPredictions: vi.fn(),
    getUnverifiedPredictions: vi.fn(),
    verifyPrediction: vi.fn(),
    verifyPredictions: vi.fn(),
    calculateAccuracy: vi.fn(),
    getAccuracyTrend: vi.fn(),
    getStats: vi.fn(),
  };
}

function createMockCommunities(): ICommunityRepository {
  return {
    getCommunity: vi.fn(),
    getVerifiedWallet: vi.fn(),
    getIncumbentRoleIds: vi.fn(),
    getEligibilityRules: vi.fn(),
    getShadowModeCommunities: vi.fn(),
    updateCoexistenceConfig: vi.fn(),
    updateVerificationTier: vi.fn(),
  };
}

function createMockEligibility(): IEligibilityChecker {
  return {
    checkEligibility: vi.fn(),
  };
}

function createMockNats(): INatsPublisher {
  return {
    publish: vi.fn(),
  };
}

function createMockMetrics(): IMetricsClient {
  return {
    shadowSyncDuration: { observe: vi.fn() },
    shadowSyncAccuracy: { set: vi.fn() },
    shadowDivergences: { inc: vi.fn() },
  };
}

// =============================================================================
// ShadowSyncJob Tests
// =============================================================================

describe('ShadowSyncJob', () => {
  let discord: IDiscordMemberService;
  let shadowLedger: IShadowLedger;
  let communities: ICommunityRepository;
  let eligibility: IEligibilityChecker;
  let nats: INatsPublisher;
  let metrics: IMetricsClient;
  let logger: Logger;
  let syncJob: ShadowSyncJob;

  beforeEach(() => {
    discord = createMockDiscord();
    shadowLedger = createMockShadowLedger();
    communities = createMockCommunities();
    eligibility = createMockEligibility();
    nats = createMockNats();
    metrics = createMockMetrics();
    logger = createMockLogger();

    syncJob = new ShadowSyncJob(
      discord,
      shadowLedger,
      communities,
      eligibility,
      nats,
      metrics,
      logger
    );
  });

  // ===========================================================================
  // Core Sync Tests
  // ===========================================================================

  describe('sync', () => {
    const communityId = 'community-123';
    const guildId = 'guild-456';

    beforeEach(() => {
      (communities.getEligibilityRules as Mock).mockResolvedValue([
        { ruleType: 'nft_ownership', chainId: 'berachain', contractAddress: '0x123' },
      ]);
      (communities.getIncumbentRoleIds as Mock).mockResolvedValue(['role-holder']);
      (shadowLedger.getUnverifiedPredictions as Mock).mockResolvedValue([]);
      (shadowLedger.calculateAccuracy as Mock).mockResolvedValue(0.95);
    });

    it('should process members and return sync result', async () => {
      const members: GuildMemberData[] = [
        { user: { id: 'user-1' }, roles: ['role-holder'] },
        { user: { id: 'user-2' }, roles: [] },
      ];

      (discord.getGuildMembers as Mock).mockResolvedValueOnce(members).mockResolvedValueOnce([]);
      (communities.getVerifiedWallet as Mock).mockResolvedValue('0xwallet');
      (eligibility.checkEligibility as Mock).mockResolvedValue({
        eligible: true,
        tier: 'gold',
        score: 85,
      } as ArrakisEligibilityResult);

      const result = await syncJob.sync(communityId, guildId);

      expect(result.communityId).toBe(communityId);
      expect(result.guildId).toBe(guildId);
      expect(result.membersProcessed).toBe(2);
      expect(result.accuracy).toBe(0.95);
    });

    it('should detect divergences when incumbent and Arrakis disagree', async () => {
      const members: GuildMemberData[] = [
        { user: { id: 'user-1' }, roles: ['role-holder'] }, // Has incumbent role
      ];

      (discord.getGuildMembers as Mock).mockResolvedValueOnce(members).mockResolvedValueOnce([]);
      (communities.getVerifiedWallet as Mock).mockResolvedValue('0xwallet');
      (eligibility.checkEligibility as Mock).mockResolvedValue({
        eligible: false, // Arrakis says not eligible
        tier: null,
        score: 10,
      } as ArrakisEligibilityResult);

      const result = await syncJob.sync(communityId, guildId);

      expect(result.divergencesFound).toBe(1);
      expect(shadowLedger.recordDivergence).toHaveBeenCalledWith(
        guildId,
        'user-1',
        expect.objectContaining({ hasRole: true }),
        expect.objectContaining({ eligible: false })
      );
      expect(metrics.shadowDivergences.inc).toHaveBeenCalledWith({
        community_id: communityId,
        type: 'false_positive',
      });
    });

    it('should skip members without verified wallets', async () => {
      const members: GuildMemberData[] = [
        { user: { id: 'user-1' }, roles: [] },
      ];

      (discord.getGuildMembers as Mock).mockResolvedValueOnce(members).mockResolvedValueOnce([]);
      (communities.getVerifiedWallet as Mock).mockResolvedValue(null);

      const result = await syncJob.sync(communityId, guildId);

      expect(result.membersProcessed).toBe(0);
      expect(eligibility.checkEligibility).not.toHaveBeenCalled();
    });

    it('should respect maxMembers option', async () => {
      const members: GuildMemberData[] = Array.from({ length: 100 }, (_, i) => ({
        user: { id: `user-${i}` },
        roles: [],
      }));

      (discord.getGuildMembers as Mock).mockResolvedValueOnce(members).mockResolvedValueOnce([]);
      (communities.getVerifiedWallet as Mock).mockResolvedValue('0xwallet');
      (eligibility.checkEligibility as Mock).mockResolvedValue({
        eligible: true,
        tier: 'gold',
        score: 85,
      } as ArrakisEligibilityResult);

      const result = await syncJob.sync(communityId, guildId, { maxMembers: 10 });

      expect(result.membersProcessed).toBe(10);
    });

    it('should publish sync complete event', async () => {
      (discord.getGuildMembers as Mock).mockResolvedValue([]);

      await syncJob.sync(communityId, guildId);

      expect(nats.publish).toHaveBeenCalledWith(
        'coexist.shadow.sync.complete',
        expect.objectContaining({
          communityId,
          guildId,
          result: expect.any(Object),
        })
      );
    });

    it('should record metrics', async () => {
      (discord.getGuildMembers as Mock).mockResolvedValue([]);

      await syncJob.sync(communityId, guildId);

      expect(metrics.shadowSyncDuration.observe).toHaveBeenCalledWith(
        { community_id: communityId },
        expect.any(Number)
      );
      expect(metrics.shadowSyncAccuracy.set).toHaveBeenCalledWith(
        { community_id: communityId },
        0.95
      );
    });
  });

  // ===========================================================================
  // Cursor-Based Pagination Tests
  // ===========================================================================

  describe('fetchMembers', () => {
    it('should fetch members with cursor', async () => {
      const members: GuildMemberData[] = [
        { user: { id: 'user-1' }, roles: [] },
        { user: { id: 'user-2' }, roles: [] },
      ];

      (discord.getGuildMembers as Mock).mockResolvedValue(members);

      const result = await syncJob.fetchMembers('guild-123');

      expect(result.members).toHaveLength(2);
      expect(result.nextCursor).toBe('user-2');
      expect(result.hasMore).toBe(false); // Less than batch size
    });

    it('should indicate hasMore when batch is full', async () => {
      const members: GuildMemberData[] = Array.from({ length: 1000 }, (_, i) => ({
        user: { id: `user-${i}` },
        roles: [],
      }));

      (discord.getGuildMembers as Mock).mockResolvedValue(members);

      const result = await syncJob.fetchMembers('guild-123', { batchSize: 1000 });

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('user-999');
    });

    it('should pass after cursor to Discord API', async () => {
      (discord.getGuildMembers as Mock).mockResolvedValue([]);

      await syncJob.fetchMembers('guild-123', { after: 'user-500' });

      expect(discord.getGuildMembers).toHaveBeenCalledWith('guild-123', {
        limit: 1000,
        after: 'user-500',
      });
    });
  });

  describe('fetchMembersIterator', () => {
    it('should iterate through all pages', async () => {
      const page1: GuildMemberData[] = [
        { user: { id: 'user-1' }, roles: [] },
        { user: { id: 'user-2' }, roles: [] },
      ];
      const page2: GuildMemberData[] = [
        { user: { id: 'user-3' }, roles: [] },
      ];

      (discord.getGuildMembers as Mock)
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce([]);

      const batches: GuildMemberData[][] = [];
      for await (const batch of syncJob.fetchMembersIterator<GuildMemberData>('guild-123', 2)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(2);
      expect(batches[0]).toEqual(page1);
      expect(batches[1]).toEqual(page2);
    });

    it('should stop when empty batch returned', async () => {
      (discord.getGuildMembers as Mock).mockResolvedValue([]);

      const batches: GuildMemberData[][] = [];
      for await (const batch of syncJob.fetchMembersIterator<GuildMemberData>('guild-123')) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Sync Scheduling Tests
  // ===========================================================================

  describe('isSyncDue', () => {
    it('should return true if no previous sync', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: null,
      });

      const isDue = await syncJob.isSyncDue('community-123');

      expect(isDue).toBe(true);
    });

    it('should return true if interval has elapsed', async () => {
      const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: sevenHoursAgo,
        totalMembers: 100,
        divergentMembers: 5,
        verifiedPredictions: 10,
        accuracy: 0.95,
      });

      const isDue = await syncJob.isSyncDue('community-123');

      expect(isDue).toBe(true);
    });

    it('should return false if interval has not elapsed', async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: oneHourAgo,
        totalMembers: 100,
        divergentMembers: 5,
        verifiedPredictions: 10,
        accuracy: 0.95,
      });

      const isDue = await syncJob.isSyncDue('community-123');

      expect(isDue).toBe(false);
    });
  });

  describe('syncAll', () => {
    it('should sync all eligible communities', async () => {
      (communities.getShadowModeCommunities as Mock).mockResolvedValue([
        'community-1',
        'community-2',
      ]);
      (communities.getCommunity as Mock).mockImplementation((id) => ({
        id,
        guildId: `guild-${id}`,
        verificationTier: 'incumbent_only' as VerificationTier,
        coexistenceMode: 'shadow',
        shadowDays: 7,
        digestEnabled: false,
      }));
      (shadowLedger.getStats as Mock).mockResolvedValue({ lastSyncAt: null });
      (communities.getEligibilityRules as Mock).mockResolvedValue([]);
      (communities.getIncumbentRoleIds as Mock).mockResolvedValue([]);
      (discord.getGuildMembers as Mock).mockResolvedValue([]);
      (shadowLedger.getUnverifiedPredictions as Mock).mockResolvedValue([]);
      (shadowLedger.calculateAccuracy as Mock).mockResolvedValue(0.95);

      const results = await syncJob.syncAll();

      expect(results).toHaveLength(2);
    });

    it('should skip communities not due for sync', async () => {
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
      (communities.getShadowModeCommunities as Mock).mockResolvedValue(['community-1']);
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-1',
        guildId: 'guild-1',
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: oneHourAgo,
        totalMembers: 100,
        divergentMembers: 5,
        verifiedPredictions: 10,
        accuracy: 0.95,
      });

      const results = await syncJob.syncAll();

      expect(results).toHaveLength(0);
    });

    it('should continue with other communities on error', async () => {
      (communities.getShadowModeCommunities as Mock).mockResolvedValue([
        'community-1',
        'community-2',
      ]);
      (communities.getCommunity as Mock).mockImplementation((id) => ({
        id,
        guildId: `guild-${id}`,
        verificationTier: 'incumbent_only' as VerificationTier,
        coexistenceMode: 'shadow',
        shadowDays: 7,
        digestEnabled: false,
      }));
      (shadowLedger.getStats as Mock).mockResolvedValue({ lastSyncAt: null });
      (communities.getEligibilityRules as Mock)
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce([]);
      (communities.getIncumbentRoleIds as Mock).mockResolvedValue([]);
      (discord.getGuildMembers as Mock).mockResolvedValue([]);
      (shadowLedger.getUnverifiedPredictions as Mock).mockResolvedValue([]);
      (shadowLedger.calculateAccuracy as Mock).mockResolvedValue(0.95);

      const results = await syncJob.syncAll();

      // Only second community should succeed
      expect(results).toHaveLength(1);
    });
  });

  // ===========================================================================
  // Verification Tier Tests
  // ===========================================================================

  describe('getVerificationStatus', () => {
    it('should return verification status with upgrade requirements', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        verificationTier: 'incumbent_only' as VerificationTier,
        shadowDays: 10,
        digestEnabled: true,
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: new Date(),
        accuracy: 0.92,
      });

      const status = await syncJob.getVerificationStatus('community-123');

      expect(status).not.toBeNull();
      expect(status!.tier).toBe('incumbent_only');
      expect(status!.nextTierRequirements).not.toBeNull();
      expect(status!.nextTierRequirements!.targetTier).toBe('arrakis_basic');
      expect(status!.nextTierRequirements!.requirementsMet).toBe(false);
    });

    it('should show requirements met when eligible for upgrade', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        verificationTier: 'incumbent_only' as VerificationTier,
        shadowDays: 15,
        digestEnabled: true,
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: new Date(),
        accuracy: 0.96,
      });

      const status = await syncJob.getVerificationStatus('community-123');

      expect(status!.nextTierRequirements!.requirementsMet).toBe(true);
    });

    it('should return null for non-existent community', async () => {
      (communities.getCommunity as Mock).mockResolvedValue(null);

      const status = await syncJob.getVerificationStatus('nonexistent');

      expect(status).toBeNull();
    });
  });

  describe('upgradeTier', () => {
    it('should upgrade tier when eligible', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        verificationTier: 'incumbent_only' as VerificationTier,
        shadowDays: 15,
        digestEnabled: true,
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: new Date(),
        accuracy: 0.96,
      });

      const newTier = await syncJob.upgradeTier('community-123');

      expect(newTier).toBe('arrakis_basic');
      expect(communities.updateVerificationTier).toHaveBeenCalledWith(
        'community-123',
        'arrakis_basic'
      );
      expect(nats.publish).toHaveBeenCalledWith(
        'coexist.tier.upgraded',
        expect.objectContaining({
          communityId: 'community-123',
          oldTier: 'incumbent_only',
          newTier: 'arrakis_basic',
        })
      );
    });

    it('should return null when not eligible', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        verificationTier: 'incumbent_only' as VerificationTier,
        shadowDays: 5, // Not enough days
        digestEnabled: true,
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: new Date(),
        accuracy: 0.80, // Not enough accuracy
      });

      const newTier = await syncJob.upgradeTier('community-123');

      expect(newTier).toBeNull();
      expect(communities.updateVerificationTier).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Digest Notification Tests
  // ===========================================================================

  describe('generateDigest', () => {
    it('should generate digest with divergence summary', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        verificationTier: 'incumbent_only' as VerificationTier,
        shadowDays: 10,
        digestEnabled: true,
      });
      (shadowLedger.getStats as Mock).mockResolvedValue({
        lastSyncAt: new Date(),
        totalMembers: 100,
        divergentMembers: 5,
        verifiedPredictions: 20,
        accuracy: 0.95,
      });
      (shadowLedger.getDivergenceCounts as Mock).mockResolvedValue({
        false_positive: 3,
        false_negative: 2,
      });
      (shadowLedger.getAccuracyTrend as Mock).mockResolvedValue([
        { date: new Date(), accuracy: 0.93, sampleSize: 50 },
        { date: new Date(), accuracy: 0.95, sampleSize: 60 },
      ]);

      const digest = await syncJob.generateDigest('community-123');

      expect(digest).not.toBeNull();
      expect(digest!.divergenceSummary.falsePositives).toBe(3);
      expect(digest!.divergenceSummary.falseNegatives).toBe(2);
      expect(digest!.accuracyTrend).toHaveLength(2);
      expect(digest!.tierStatus.currentTier).toBe('incumbent_only');
    });

    it('should return null for non-existent community', async () => {
      (communities.getCommunity as Mock).mockResolvedValue(null);

      const digest = await syncJob.generateDigest('nonexistent');

      expect(digest).toBeNull();
    });
  });

  describe('sendDigestNotification', () => {
    it('should publish digest to NATS', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        adminChannelId: 'channel-admin',
      });

      const digest = {
        communityId: 'community-123',
        guildId: 'guild-456',
        syncResult: {} as any,
        divergenceSummary: { falsePositives: 1, falseNegatives: 2, newDivergences: 3 },
        accuracyTrend: [],
        tierStatus: { currentTier: 'incumbent_only' as VerificationTier, daysUntilUpgradeEligible: 4, accuracyNeeded: 0.03 },
        generatedAt: new Date(),
      };

      const result = await syncJob.sendDigestNotification('community-123', digest);

      expect(result).toBe(true);
      expect(nats.publish).toHaveBeenCalledWith(
        'coexist.shadow.digest.send',
        expect.objectContaining({
          communityId: 'community-123',
          channelId: 'channel-admin',
          digest,
        })
      );
    });

    it('should return false if no admin channel configured', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        id: 'community-123',
        guildId: 'guild-456',
        // No adminChannelId
      });

      const result = await syncJob.sendDigestNotification('community-123', {} as any);

      expect(result).toBe(false);
    });
  });

  describe('isDigestEnabled', () => {
    it('should return true if digest is enabled', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        digestEnabled: true,
      });

      const enabled = await syncJob.isDigestEnabled('community-123');

      expect(enabled).toBe(true);
    });

    it('should return false if digest is disabled', async () => {
      (communities.getCommunity as Mock).mockResolvedValue({
        digestEnabled: false,
      });

      const enabled = await syncJob.isDigestEnabled('community-123');

      expect(enabled).toBe(false);
    });

    it('should return false if community not found', async () => {
      (communities.getCommunity as Mock).mockResolvedValue(null);

      const enabled = await syncJob.isDigestEnabled('nonexistent');

      expect(enabled).toBe(false);
    });
  });
});
