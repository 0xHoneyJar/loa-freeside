/**
 * Leaderboard Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createLeaderboardHandler } from '../../../src/handlers/commands/leaderboard.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  getBadgeLeaderboard: vi.fn(),
  getMemberBadgeRank: vi.fn(),
  getMemberCount: vi.fn(),
  getTierProgressionLeaderboard: vi.fn(),
  getMemberTierProgressionRank: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getBadgeLeaderboard,
  getMemberBadgeRank,
  getMemberCount,
  getTierProgressionLeaderboard,
  getMemberTierProgressionRank,
} from '../../../src/data/index.js';

describe('leaderboard command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createLeaderboardHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'leaderboard',
    subcommand: 'badges',
  };

  const mockCommunity = {
    id: 'comm-123',
    name: 'Test Community',
    discordGuildId: 'guild-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    apiKeyHash: null,
    settings: null,
  };

  const mockProfile = {
    id: 'profile-123',
    communityId: 'comm-123',
    discordId: 'user-123',
    walletAddress: '0x1234',
    tier: 'fedaykin',
    convictionScore: 1500,
    activityScore: 42,
    currentRank: 25,
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };

  const mockBadgeEntries = [
    {
      rank: 1,
      profileId: 'profile-1',
      discordId: 'user-1',
      badgeCount: 15,
      tier: 'naib',
      tenureCategory: 'og',
      nym: 'TopUser',
      joinedAt: new Date(),
    },
    {
      rank: 2,
      profileId: 'profile-2',
      discordId: 'user-2',
      badgeCount: 12,
      tier: 'fedaykin',
      tenureCategory: 'veteran',
      nym: 'SecondUser',
      joinedAt: new Date(),
    },
  ];

  const mockTierEntries = [
    {
      rank: 1,
      profileId: 'profile-1',
      discordId: 'user-1',
      nym: 'ClosestUser',
      currentTier: 'sietch',
      nextTier: 'sayyadina',
      convictionScore: 900,
      distanceToNextTier: 100,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferReply: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
      sendFollowup: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createLeaderboardHandler(mockDiscord);
  });

  describe('badges subcommand', () => {
    it('should defer reply WITHOUT ephemeral flag (public)', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
      vi.mocked(getBadgeLeaderboard).mockResolvedValue(mockBadgeEntries);
      vi.mocked(getMemberCount).mockResolvedValue(100);
      vi.mocked(getMemberBadgeRank).mockResolvedValue(25);

      await handler(basePayload, mockLogger);

      // Leaderboard is PUBLIC (ephemeral = false)
      expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', false);
    });

    it('should send badge leaderboard embed on success', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
      vi.mocked(getBadgeLeaderboard).mockResolvedValue(mockBadgeEntries);
      vi.mocked(getMemberCount).mockResolvedValue(100);
      vi.mocked(getMemberBadgeRank).mockResolvedValue(25);

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: expect.stringContaining('Engagement Leaderboard'),
            }),
          ]),
        })
      );
    });

    it('should log badge leaderboard served', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
      vi.mocked(getBadgeLeaderboard).mockResolvedValue(mockBadgeEntries);
      vi.mocked(getMemberCount).mockResolvedValue(100);
      vi.mocked(getMemberBadgeRank).mockResolvedValue(25);

      await handler(basePayload, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          entriesCount: 2,
          totalMembers: 100,
          userRank: 25,
        }),
        'Badge leaderboard served'
      );
    });
  });

  describe('tiers subcommand', () => {
    const tiersPayload = { ...basePayload, subcommand: 'tiers' };

    it('should send tier progression embed on success', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
      vi.mocked(getTierProgressionLeaderboard).mockResolvedValue(mockTierEntries);
      vi.mocked(getMemberTierProgressionRank).mockResolvedValue(null);

      const result = await handler(tiersPayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: expect.stringContaining('Tier Progression Leaderboard'),
            }),
          ]),
        })
      );
    });

    it('should log tier leaderboard served', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
      vi.mocked(getTierProgressionLeaderboard).mockResolvedValue(mockTierEntries);
      vi.mocked(getMemberTierProgressionRank).mockResolvedValue(null);

      await handler(tiersPayload, mockLogger);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          entriesCount: 1,
          hasUserEntry: false,
        }),
        'Tier progression leaderboard served'
      );
    });
  });

  describe('error handling', () => {
    it('should return ack when missing interaction credentials', async () => {
      const payloadNoInteraction = { ...basePayload, interactionId: undefined };

      const result = await handler(payloadNoInteraction, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.deferReply).not.toHaveBeenCalled();
    });

    it('should return ack when missing guildId', async () => {
      const payloadNoGuild = { ...basePayload, guildId: undefined };

      const result = await handler(payloadNoGuild, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.deferReply).not.toHaveBeenCalled();
    });

    it('should send error embed when community not found', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(null);

      await handler(basePayload, mockLogger);

      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Error',
              description: expect.stringContaining('not configured'),
            }),
          ]),
        })
      );
    });

    it('should handle unknown subcommand', async () => {
      const payloadUnknown = { ...basePayload, subcommand: 'unknown' };

      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);

      await handler(payloadUnknown, mockLogger);

      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: 'Error',
              description: expect.stringContaining('Unknown subcommand'),
            }),
          ]),
        })
      );
    });

    it('should handle defer failure gracefully', async () => {
      (mockDiscord.deferReply as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Discord error',
      });

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.editOriginal).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([expect.objectContaining({ title: 'Error' })]),
        })
      );
    });
  });

  describe('user context', () => {
    it('should work without userId (anonymous viewing)', async () => {
      const payloadNoUser = { ...basePayload, userId: undefined };

      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getBadgeLeaderboard).mockResolvedValue(mockBadgeEntries);
      vi.mocked(getMemberCount).mockResolvedValue(100);

      const result = await handler(payloadNoUser, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.editOriginal).toHaveBeenCalled();
      // Should not call getProfileByDiscordId when no userId
      expect(getProfileByDiscordId).not.toHaveBeenCalled();
    });

    it('should default to badges subcommand when not specified', async () => {
      const payloadNoSubcommand = { ...basePayload, subcommand: undefined };

      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
      vi.mocked(getBadgeLeaderboard).mockResolvedValue(mockBadgeEntries);
      vi.mocked(getMemberCount).mockResolvedValue(100);
      vi.mocked(getMemberBadgeRank).mockResolvedValue(25);

      await handler(payloadNoSubcommand, mockLogger);

      // Should default to badges
      expect(getBadgeLeaderboard).toHaveBeenCalled();
      expect(getTierProgressionLeaderboard).not.toHaveBeenCalled();
    });
  });
});
