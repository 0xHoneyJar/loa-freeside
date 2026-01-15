/**
 * Threshold Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createThresholdHandler } from '../../../src/handlers/commands/threshold.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getThresholdData: vi.fn(),
  getTopWaitlistPositions: vi.fn(),
}));

// Import mocked functions
import { getCommunityByGuildId, getThresholdData, getTopWaitlistPositions } from '../../../src/data/index.js';

describe('threshold command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createThresholdHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'threshold',
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

  const mockThresholdData = {
    entryThreshold: 1000,
    eligibleCount: 69,
    waitlistCount: 31,
    gapToEntry: 150,
    updatedAt: new Date(),
  };

  const mockWaitlistPositions = [
    {
      position: 70,
      profile: {
        id: 'profile-70',
        communityId: 'comm-123',
        discordId: 'user-70',
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        tier: 'waiting',
        convictionScore: 950,
        activityScore: 10,
        currentRank: 70,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      },
      distanceToEntry: 50,
    },
    {
      position: 71,
      profile: {
        id: 'profile-71',
        communityId: 'comm-123',
        discordId: 'user-71',
        walletAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
        tier: 'waiting',
        convictionScore: 900,
        activityScore: 5,
        currentRank: 71,
        joinedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
      },
      distanceToEntry: 100,
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

    handler = createThresholdHandler(mockDiscord);
  });

  it('should defer reply WITHOUT ephemeral flag (public)', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    await handler(basePayload, mockLogger);

    // Threshold command is PUBLIC (ephemeral = false)
    expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', false);
  });

  it('should return ack when missing interaction credentials', async () => {
    const payloadNoInteraction = { ...basePayload, interactionId: undefined };

    const result = await handler(payloadNoInteraction, mockLogger);

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

  it('should send threshold embed on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining('Threshold'),
          }),
        ]),
      })
    );
  });

  it('should include entry threshold in embed', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    await handler(basePayload, mockLogger);

    const call = vi.mocked(mockDiscord.editOriginal).mock.calls[0];
    const embeds = call?.[1]?.embeds;
    const embed = embeds?.[0];

    expect(embed?.fields?.some((f: { name: string; value: string }) => f.value.includes('1,000'))).toBe(true);
  });

  it('should include waitlist positions in embed', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    await handler(basePayload, mockLogger);

    const call = vi.mocked(mockDiscord.editOriginal).mock.calls[0];
    const embeds = call?.[1]?.embeds;
    const embed = embeds?.[0];
    const waitlistField = embed?.fields?.find((f: { name: string }) => f.name.includes('Waiting'));

    expect(waitlistField).toBeDefined();
    expect(waitlistField?.value).toContain('#70');
    expect(waitlistField?.value).toContain('#71');
  });

  it('should truncate wallet addresses', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    await handler(basePayload, mockLogger);

    const call = vi.mocked(mockDiscord.editOriginal).mock.calls[0];
    const embeds = call?.[1]?.embeds;
    const embed = embeds?.[0];
    const waitlistField = embed?.fields?.find((f: { name: string }) => f.name.includes('Waiting'));

    // Should show truncated address format 0x1234...5678
    expect(waitlistField?.value).toContain('0x1234');
    expect(waitlistField?.value).toContain('...');
  });

  it('should handle empty waitlist', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue([]);

    await handler(basePayload, mockLogger);

    const call = vi.mocked(mockDiscord.editOriginal).mock.calls[0];
    const embeds = call?.[1]?.embeds;
    const embed = embeds?.[0];
    const waitlistField = embed?.fields?.find((f: { name: string }) => f.name.includes('Waiting'));

    expect(waitlistField?.value).toContain('No wallets');
  });

  it('should log threshold served on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    await handler(basePayload, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        entryThreshold: 1000,
        eligibleCount: 69,
        waitlistCount: 31,
      }),
      'Threshold served'
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

  it('should work without userId (threshold is public)', async () => {
    const payloadNoUser = { ...basePayload, userId: undefined };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getThresholdData).mockResolvedValue(mockThresholdData);
    vi.mocked(getTopWaitlistPositions).mockResolvedValue(mockWaitlistPositions);

    const result = await handler(payloadNoUser, mockLogger);

    // Threshold command doesn't require userId
    expect(result).toBe('ack');
    expect(mockDiscord.editOriginal).toHaveBeenCalled();
  });
});
