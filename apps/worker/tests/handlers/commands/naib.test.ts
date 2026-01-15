/**
 * Naib Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createNaibHandler } from '../../../src/handlers/commands/naib.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  getCurrentNaib: vi.fn(),
  getFormerNaib: vi.fn(),
  getEmptyNaibSeatCount: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getCurrentNaib,
  getFormerNaib,
  getEmptyNaibSeatCount,
} from '../../../src/data/index.js';

describe('naib command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createNaibHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'naib',
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
    walletAddress: '0x123',
    tier: 'fedaykin',
    convictionScore: 100,
    activityScore: 50,
    currentRank: 25,
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { displayName: 'TestUser', bio: 'Test bio' },
  };

  const mockCurrentNaib = [
    { nym: 'Leader1', rank: 1, seatNumber: 1, seatedAt: new Date(), isFounding: true, pfpUrl: 'https://example.com/1.png' },
    { nym: 'Leader2', rank: 2, seatNumber: 2, seatedAt: new Date(), isFounding: true, pfpUrl: null },
    { nym: 'Leader3', rank: 3, seatNumber: 3, seatedAt: new Date(), isFounding: false, pfpUrl: null },
  ];

  const mockFormerNaib = [
    { nym: 'Former1', totalTenureMs: 86400000 * 30, seatCount: 2, lastUnseatedAt: new Date() },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferReply: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createNaibHandler(mockDiscord);
  });

  it('should show naib council with full seats', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getCurrentNaib).mockResolvedValue([...mockCurrentNaib, ...Array(4).fill(null).map((_, i) => ({
      nym: `Leader${i + 4}`,
      rank: i + 4,
      seatNumber: i + 4,
      seatedAt: new Date(),
      isFounding: false,
      pfpUrl: null,
    }))]);
    vi.mocked(getFormerNaib).mockResolvedValue(mockFormerNaib);
    vi.mocked(getEmptyNaibSeatCount).mockResolvedValue(0);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', false);
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining('Naib'),
          }),
        ]),
      })
    );
  });

  it('should show naib council with empty seats', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getCurrentNaib).mockResolvedValue(mockCurrentNaib);
    vi.mocked(getFormerNaib).mockResolvedValue([]);
    vi.mocked(getEmptyNaibSeatCount).mockResolvedValue(4);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(getEmptyNaibSeatCount).toHaveBeenCalledWith('comm-123');
    expect(mockDiscord.editOriginal).toHaveBeenCalled();
  });

  it('should show former naib section when available', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getCurrentNaib).mockResolvedValue(mockCurrentNaib);
    vi.mocked(getFormerNaib).mockResolvedValue(mockFormerNaib);
    vi.mocked(getEmptyNaibSeatCount).mockResolvedValue(4);

    await handler(basePayload, mockLogger);

    expect(getFormerNaib).toHaveBeenCalledWith('comm-123');
    expect(mockDiscord.editOriginal).toHaveBeenCalled();
  });

  it('should show error when community not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('not configured'),
          }),
        ]),
      })
    );
  });

  it('should return ack when missing interaction credentials', async () => {
    const payloadNoInteraction = { ...basePayload, interactionId: undefined };

    const result = await handler(payloadNoInteraction, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.deferReply).not.toHaveBeenCalled();
  });

  it('should return ack when missing guild ID', async () => {
    const payloadNoGuild = { ...basePayload, guildId: undefined };

    const result = await handler(payloadNoGuild, mockLogger);

    expect(result).toBe('ack');
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
          expect.objectContaining({
            title: 'Error',
          }),
        ]),
      })
    );
  });

  it('should log naib displayed on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getCurrentNaib).mockResolvedValue(mockCurrentNaib);
    vi.mocked(getFormerNaib).mockResolvedValue([]);
    vi.mocked(getEmptyNaibSeatCount).mockResolvedValue(4);

    await handler(basePayload, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ memberCount: 3, formerCount: 0 }),
      'Naib served'
    );
  });
});
