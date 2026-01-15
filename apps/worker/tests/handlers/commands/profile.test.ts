/**
 * Profile Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createProfileHandler, createProfileAutocompleteHandler } from '../../../src/handlers/commands/profile.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getOwnProfile: vi.fn(),
  getPublicProfile: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  searchProfilesByNym: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getOwnProfile,
  getPublicProfile,
  getProfileByDiscordId,
  searchProfilesByNym,
} from '../../../src/data/index.js';

describe('profile command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createProfileHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'profile',
    data: {
      options: [{ name: 'view', options: [] }],
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

  const mockOwnProfile = {
    profileId: 'profile-123',
    nym: 'TestUser',
    bio: 'Test bio',
    pfpUrl: 'https://example.com/avatar.png',
    tier: 'fedaykin',
    onboardingComplete: true,
    createdAt: new Date(),
    nymLastChanged: null,
  };

  const mockPublicProfile = {
    profileId: 'profile-456',
    nym: 'OtherUser',
    bio: 'Other bio',
    pfpUrl: 'https://example.com/other.png',
    tier: 'naib',
    tenureCategory: 'veteran',
    badgeCount: 5,
    joinedAt: new Date(),
    badges: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferReply: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
      sendFollowup: vi.fn().mockResolvedValue({ success: true }),
      sendDM: vi.fn().mockResolvedValue({ success: true }),
      respondAutocomplete: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createProfileHandler(mockDiscord);
  });

  describe('view subcommand', () => {
    it('should show own profile when no nym provided', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getOwnProfile).mockResolvedValue(mockOwnProfile);

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', true);
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: expect.stringContaining('TestUser'),
            }),
          ]),
        })
      );
    });

    it('should show public profile when nym provided', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getPublicProfile).mockResolvedValue(mockPublicProfile);

      const payloadWithNym = {
        ...basePayload,
        data: {
          options: [{ name: 'view', options: [{ name: 'nym', value: 'OtherUser' }] }],
        },
      };

      const result = await handler(payloadWithNym, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', false);
      expect(getPublicProfile).toHaveBeenCalledWith('comm-123', 'OtherUser');
    });

    it('should show error when own profile not found', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getOwnProfile).mockResolvedValue(null);

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

    it('should show error when public profile not found', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getPublicProfile).mockResolvedValue(null);

      const payloadWithNym = {
        ...basePayload,
        data: {
          options: [{ name: 'view', options: [{ name: 'nym', value: 'Unknown' }] }],
        },
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

  describe('edit subcommand', () => {
    it('should send DM when profile exists', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue({
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
      });

      const editPayload = {
        ...basePayload,
        data: {
          options: [{ name: 'edit', options: [] }],
        },
      };

      const result = await handler(editPayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockDiscord.sendDM).toHaveBeenCalledWith('user-123', expect.any(Object));
    });

    it('should show error when profile not found for edit', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(null);

      const editPayload = {
        ...basePayload,
        data: {
          options: [{ name: 'edit', options: [] }],
        },
      };

      await handler(editPayload, mockLogger);

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

describe('profile autocomplete handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createProfileAutocompleteHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'profile',
    data: {
      options: [{ name: 'view', options: [{ name: 'nym', value: 'test', focused: true }] }],
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

    handler = createProfileAutocompleteHandler(mockDiscord);
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
