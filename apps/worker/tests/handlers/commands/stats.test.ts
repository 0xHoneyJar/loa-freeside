/**
 * Stats Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createStatsHandler } from '../../../src/handlers/commands/stats.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getMemberStats: vi.fn(),
}));

// Import mocked functions
import { getCommunityByGuildId, getMemberStats } from '../../../src/data/index.js';

describe('stats command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createStatsHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'stats',
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

  const mockStats = {
    profile: {
      id: 'profile-123',
      communityId: 'comm-123',
      discordId: 'user-123',
      walletAddress: '0x1234',
      tier: 'fedaykin',
      convictionScore: 1500,
      activityScore: 42,
      currentRank: 25,
      joinedAt: new Date('2023-06-15'),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { displayName: 'TestUser', avatarUrl: 'https://example.com/avatar.png' },
    },
    badgeCount: 5,
    badges: [
      { id: 'badge-1', profileId: 'profile-123', badgeType: 'early-bird', awardedAt: new Date(), metadata: { badgeName: 'Early Bird', emoji: '\ud83d\udc26' } },
    ],
    rank: 25,
  };

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

    handler = createStatsHandler(mockDiscord);
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getMemberStats).mockResolvedValue(mockStats);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', true);
  });

  it('should return ack when missing interaction credentials', async () => {
    const payloadNoInteraction = { ...basePayload, interactionId: undefined };

    const result = await handler(payloadNoInteraction, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.deferReply).not.toHaveBeenCalled();
  });

  it('should return ack when missing user ID', async () => {
    const payloadNoUser = { ...basePayload, userId: undefined };

    const result = await handler(payloadNoUser, mockLogger);

    expect(result).toBe('ack');
  });

  it('should send error embed when community not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({ title: 'Error' }),
        ]),
      })
    );
  });

  it('should send error embed when member stats not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getMemberStats).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: 'Error',
            description: expect.stringContaining('onboarding'),
          }),
        ]),
      })
    );
  });

  it('should send stats embed on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getMemberStats).mockResolvedValue(mockStats);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining('Stats'),
          }),
        ]),
      })
    );
  });

  it('should log stats served on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getMemberStats).mockResolvedValue(mockStats);

    await handler(basePayload, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'profile-123', tier: 'fedaykin' }),
      'Stats served'
    );
  });

  it('should handle defer failure gracefully', async () => {
    (mockDiscord.deferReply as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Discord error' });

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
        embeds: expect.arrayContaining([
          expect.objectContaining({ title: 'Error' }),
        ]),
      })
    );
  });
});
