/**
 * Badges Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createBadgesHandler, createBadgesAutocompleteHandler } from '../../../src/handlers/commands/badges.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getOwnBadges: vi.fn(),
  getPublicBadges: vi.fn(),
  searchProfilesByNym: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getOwnBadges,
  getPublicBadges,
  searchProfilesByNym,
} from '../../../src/data/index.js';

describe('badges command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createBadgesHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'badges',
    data: { options: [] },
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

  const mockOwnBadges = {
    nym: 'TestUser',
    pfpUrl: 'https://example.com/avatar.png',
    badges: [
      { id: 'badge-1', name: 'Early Bird', description: 'Joined early', emoji: '🐦', category: 'tenure', awardedAt: new Date(), awardedBy: null, awardReason: null },
      { id: 'badge-2', name: 'Helper', description: 'Helped others', emoji: '🤝', category: 'contribution', awardedAt: new Date(), awardedBy: 'admin-123', awardReason: 'Great support' },
    ],
  };

  const mockPublicBadges = {
    nym: 'OtherUser',
    tier: 'naib',
    pfpUrl: 'https://example.com/other.png',
    badges: [
      { id: 'badge-3', name: 'OG', description: 'Original member', emoji: '🏛️', category: 'tenure', awardedAt: new Date(), awardedBy: null, awardReason: null },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferReply: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
      respondAutocomplete: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createBadgesHandler(mockDiscord);
  });

  describe('own badges view', () => {
    it('should show own badges when no nym provided', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getOwnBadges).mockResolvedValue(mockOwnBadges);

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', true);
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              // Title contains the nym and badge count
              title: expect.stringContaining('TestUser'),
            }),
          ]),
        })
      );
    });

    it('should show error when own badges not found', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getOwnBadges).mockResolvedValue(null);

      await handler(basePayload, mockLogger);

      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('onboarding'),
            }),
          ]),
        })
      );
    });
  });

  describe('public badges view', () => {
    it('should show public badges when nym provided', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getPublicBadges).mockResolvedValue(mockPublicBadges);

      const payloadWithNym = {
        ...basePayload,
        data: { options: [{ name: 'nym', value: 'OtherUser' }] },
      };

      const result = await handler(payloadWithNym, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', false);
      expect(getPublicBadges).toHaveBeenCalledWith('comm-123', 'OtherUser');
    });

    it('should show error when public badges not found', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getPublicBadges).mockResolvedValue(null);

      const payloadWithNym = {
        ...basePayload,
        data: { options: [{ name: 'nym', value: 'Unknown' }] },
      };

      await handler(payloadWithNym, mockLogger);

      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('No member found'),
            }),
          ]),
        })
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

    it('should return ack when missing user ID', async () => {
      const payloadNoUser = { ...basePayload, userId: undefined };

      const result = await handler(payloadNoUser, mockLogger);

      expect(result).toBe('ack');
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

    it('should handle database errors gracefully', async () => {
      vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});

describe('badges autocomplete handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createBadgesAutocompleteHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'badges',
    data: {
      options: [{ name: 'nym', value: 'test', focused: true }],
    },
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

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      respondAutocomplete: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createBadgesAutocompleteHandler(mockDiscord);
  });

  it('should respond with matching profiles', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(searchProfilesByNym).mockResolvedValue([
      { nym: 'TestUser', tier: 'fedaykin' },
      { nym: 'Tester', tier: 'naib' },
    ]);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith(
      'int-123',
      'token-123',
      expect.arrayContaining([
        expect.objectContaining({ value: 'TestUser' }),
        expect.objectContaining({ value: 'Tester' }),
      ])
    );
  });

  it('should return empty choices when community not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(null);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith('int-123', 'token-123', []);
  });

  it('should return empty choices on error', async () => {
    vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith('int-123', 'token-123', []);
  });

  it('should return ack when missing interaction credentials', async () => {
    const payloadNoInteraction = { ...basePayload, interactionId: undefined };

    const result = await handler(payloadNoInteraction, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).not.toHaveBeenCalled();
  });
});
