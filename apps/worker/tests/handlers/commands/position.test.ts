/**
 * Position Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createPositionHandler } from '../../../src/handlers/commands/position.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  getPositionData: vi.fn(),
}));

// Import mocked functions
import { getCommunityByGuildId, getProfileByDiscordId, getPositionData } from '../../../src/data/index.js';

describe('position command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createPositionHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'position',
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

  const mockPositionData = {
    position: 25,
    convictionScore: 1500,
    distanceToAbove: 50,
    distanceToBelow: 30,
    distanceToEntry: null,
    isNaib: false,
    isFedaykin: true,
    isAtRisk: false,
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

    handler = createPositionHandler(mockDiscord);
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(mockPositionData);

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
          expect.objectContaining({
            title: 'Error',
            description: expect.stringContaining('not configured'),
          }),
        ]),
      })
    );
  });

  it('should send error embed when profile not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: 'Error',
            description: expect.stringContaining('onboard'),
          }),
        ]),
      })
    );
  });

  it('should send error embed when position data not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: 'Error',
            description: expect.stringContaining('position'),
          }),
        ]),
      })
    );
  });

  it('should send position embed on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(mockPositionData);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining('Position'),
          }),
        ]),
      })
    );
  });

  it('should log position served on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(mockPositionData);

    await handler(basePayload, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: 'profile-123',
        position: 25,
        isFedaykin: true,
      }),
      'Position served'
    );
  });

  it('should handle naib position correctly', async () => {
    const naibPositionData = {
      ...mockPositionData,
      position: 3,
      isNaib: true,
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(naibPositionData);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('Naib'),
          }),
        ]),
      })
    );
  });

  it('should handle at-risk position correctly', async () => {
    const atRiskPositionData = {
      ...mockPositionData,
      position: 65,
      isAtRisk: true,
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(atRiskPositionData);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('At Risk'),
          }),
        ]),
      })
    );
  });

  it('should handle waitlist position correctly', async () => {
    const waitlistPositionData = {
      ...mockPositionData,
      position: 75,
      isFedaykin: false,
      distanceToEntry: 100,
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getPositionData).mockResolvedValue(waitlistPositionData);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('Waiting Pool'),
          }),
        ]),
      })
    );
  });

  it('should handle database errors gracefully', async () => {
    vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
