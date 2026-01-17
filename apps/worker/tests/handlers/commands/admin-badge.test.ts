/**
 * Admin Badge Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import {
  createAdminBadgeHandler,
  createAdminBadgeAutocompleteHandler,
} from '../../../src/handlers/commands/admin-badge.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  getProfileByNym: vi.fn(),
  searchProfilesByNym: vi.fn(),
  getAllBadgeDefinitions: vi.fn(),
  profileHasBadge: vi.fn(),
  awardBadge: vi.fn(),
  revokeBadge: vi.fn(),
  getProfileBadgesByType: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getProfileByNym,
  searchProfilesByNym,
  getAllBadgeDefinitions,
  profileHasBadge,
  awardBadge,
  revokeBadge,
  getProfileBadgesByType,
} from '../../../src/data/index.js';

describe('admin-badge command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createAdminBadgeHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'admin-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'admin-badge',
    data: {
      // SEC-1: Include admin permissions for authorization check
      member: {
        permissions: '8', // ADMINISTRATOR bit
      },
      options: [
        {
          name: 'award',
          options: [
            { name: 'nym', value: 'TestUser' },
            { name: 'badge', value: 'helper' },
            { name: 'reason', value: 'Great community support' },
          ],
        },
      ],
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

  const mockTargetProfile = {
    id: 'profile-456',
    communityId: 'comm-123',
    discordId: 'user-456',
    walletAddress: '0x456',
    tier: 'fedaykin',
    convictionScore: 100,
    activityScore: 50,
    currentRank: 25,
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { displayName: 'TestUser' },
  };

  const mockAdminProfile = {
    id: 'admin-profile-123',
    communityId: 'comm-123',
    discordId: 'admin-123',
    walletAddress: '0x123',
    tier: 'naib',
    convictionScore: 5000,
    activityScore: 100,
    currentRank: 1,
    joinedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { displayName: 'Admin' },
  };

  const mockBadges = [
    { badgeId: 'helper', name: 'Helper', description: 'Helps others', emoji: '🤝', category: 'contribution' },
    { badgeId: 'builder', name: 'Builder', description: 'Builds things', emoji: '🔨', category: 'contribution' },
    { badgeId: 'og', name: 'OG', description: 'Original member', emoji: '🏛️', category: 'tenure' },
  ];

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

    handler = createAdminBadgeHandler(mockDiscord);
  });

  describe('award subcommand', () => {
    it('should award badge to member', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByNym).mockResolvedValue(mockTargetProfile);
      vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);
      vi.mocked(profileHasBadge).mockResolvedValue(false);
      vi.mocked(getProfileByDiscordId).mockResolvedValue(mockAdminProfile);
      vi.mocked(awardBadge).mockResolvedValue('badge-id-123');

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(awardBadge).toHaveBeenCalledWith(
        'comm-123',
        'profile-456',
        'helper',
        'admin-profile-123',
        'Great community support'
      );
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              color: expect.any(Number),
              description: expect.stringContaining('Awarded'),
            }),
          ]),
        })
      );
    });

    it('should reject awarding non-contribution badge', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByNym).mockResolvedValue(mockTargetProfile);
      vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);

      const payloadTenureBadge = {
        ...basePayload,
        data: {
          member: { permissions: '8' }, // Admin permissions
          options: [
            {
              name: 'award',
              options: [
                { name: 'nym', value: 'TestUser' },
                { name: 'badge', value: 'og' },
                { name: 'reason', value: 'Trying to award tenure badge' },
              ],
            },
          ],
        },
      };

      await handler(payloadTenureBadge, mockLogger);

      expect(awardBadge).not.toHaveBeenCalled();
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('Cannot manually award'),
            }),
          ]),
        })
      );
    });

    it('should reject if member already has badge', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByNym).mockResolvedValue(mockTargetProfile);
      vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);
      vi.mocked(profileHasBadge).mockResolvedValue(true);

      await handler(basePayload, mockLogger);

      expect(awardBadge).not.toHaveBeenCalled();
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('already has'),
            }),
          ]),
        })
      );
    });

    it('should show error when member not found', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByNym).mockResolvedValue(null);

      await handler(basePayload, mockLogger);

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

  describe('revoke subcommand', () => {
    const revokePayload: DiscordEventPayload = {
      ...basePayload,
      data: {
        member: { permissions: '8' }, // Admin permissions
        options: [
          {
            name: 'revoke',
            options: [
              { name: 'nym', value: 'TestUser' },
              { name: 'badge', value: 'helper' },
            ],
          },
        ],
      },
    };

    it('should revoke badge from member', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByNym).mockResolvedValue(mockTargetProfile);
      vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);
      vi.mocked(profileHasBadge).mockResolvedValue(true);
      vi.mocked(revokeBadge).mockResolvedValue(true);

      const result = await handler(revokePayload, mockLogger);

      expect(result).toBe('ack');
      expect(revokeBadge).toHaveBeenCalledWith('profile-456', 'helper');
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('Revoked'),
            }),
          ]),
        })
      );
    });

    it('should show error if member does not have badge', async () => {
      vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
      vi.mocked(getProfileByNym).mockResolvedValue(mockTargetProfile);
      vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);
      vi.mocked(profileHasBadge).mockResolvedValue(false);

      await handler(revokePayload, mockLogger);

      expect(revokeBadge).not.toHaveBeenCalled();
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('does not have'),
            }),
          ]),
        })
      );
    });
  });

  describe('error handling', () => {
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

    it('should handle database errors gracefully', async () => {
      vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

      const result = await handler(basePayload, mockLogger);

      expect(result).toBe('ack');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    // SEC-1.3: Test unauthorized access (Finding H-2)
    it('should reject non-administrator users', async () => {
      const nonAdminPayload = {
        ...basePayload,
        data: {
          member: {
            permissions: '2048', // SEND_MESSAGES only, no ADMINISTRATOR
          },
          options: basePayload.data?.['options'],
        },
      };

      const result = await handler(nonAdminPayload, mockLogger);

      expect(result).toBe('ack');
      expect(getCommunityByGuildId).not.toHaveBeenCalled();
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('Administrator permissions'),
            }),
          ]),
        })
      );
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should reject users with missing permissions', async () => {
      const noPermissionsPayload = {
        ...basePayload,
        data: {
          options: basePayload.data?.['options'],
        },
      };

      const result = await handler(noPermissionsPayload, mockLogger);

      expect(result).toBe('ack');
      expect(getCommunityByGuildId).not.toHaveBeenCalled();
      expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
        'token-123',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              description: expect.stringContaining('Administrator permissions'),
            }),
          ]),
        })
      );
    });
  });
});

describe('admin-badge autocomplete handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createAdminBadgeAutocompleteHandler>;

  const mockCommunity = {
    id: 'comm-123',
    name: 'Test Community',
    discordGuildId: 'guild-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    apiKeyHash: null,
    settings: null,
  };

  const mockBadges = [
    { badgeId: 'helper', name: 'Helper', description: 'Helps others', emoji: '🤝', category: 'contribution' },
    { badgeId: 'builder', name: 'Builder', description: 'Builds things', emoji: '🔨', category: 'contribution' },
    { badgeId: 'og', name: 'OG', description: 'Original member', emoji: '🏛️', category: 'tenure' },
  ];

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

    handler = createAdminBadgeAutocompleteHandler(mockDiscord);
  });

  it('should respond with matching profiles for nym autocomplete', async () => {
    const payload: DiscordEventPayload = {
      eventId: 'evt-123',
      eventType: 'interaction',
      timestamp: Date.now(),
      guildId: 'guild-123',
      interactionId: 'int-123',
      interactionToken: 'token-123',
      commandName: 'admin-badge',
      data: {
        options: [
          {
            name: 'award',
            options: [{ name: 'nym', value: 'test', focused: true }],
          },
        ],
      },
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(searchProfilesByNym).mockResolvedValue([
      { nym: 'TestUser', tier: 'fedaykin' },
      { nym: 'Tester', tier: 'naib' },
    ]);

    const result = await handler(payload, mockLogger);

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

  it('should respond with contribution badges for award autocomplete', async () => {
    const payload: DiscordEventPayload = {
      eventId: 'evt-123',
      eventType: 'interaction',
      timestamp: Date.now(),
      guildId: 'guild-123',
      interactionId: 'int-123',
      interactionToken: 'token-123',
      commandName: 'admin-badge',
      data: {
        options: [
          {
            name: 'award',
            options: [
              { name: 'nym', value: 'TestUser' },
              { name: 'badge', value: '', focused: true },
            ],
          },
        ],
      },
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);

    const result = await handler(payload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith(
      'int-123',
      'token-123',
      expect.arrayContaining([
        expect.objectContaining({ value: 'helper' }),
        expect.objectContaining({ value: 'builder' }),
      ])
    );
    // Should NOT include tenure badges
    const calls = vi.mocked(mockDiscord.respondAutocomplete).mock.calls;
    const choices = calls[0][2];
    expect(choices.find((c: { value: string }) => c.value === 'og')).toBeUndefined();
  });

  it('should respond with member badges for revoke autocomplete', async () => {
    const payload: DiscordEventPayload = {
      eventId: 'evt-123',
      eventType: 'interaction',
      timestamp: Date.now(),
      guildId: 'guild-123',
      interactionId: 'int-123',
      interactionToken: 'token-123',
      commandName: 'admin-badge',
      data: {
        options: [
          {
            name: 'revoke',
            options: [
              { name: 'nym', value: 'TestUser' },
              { name: 'badge', value: '', focused: true },
            ],
          },
        ],
      },
    };

    const mockProfile = {
      id: 'profile-456',
      communityId: 'comm-123',
      discordId: 'user-456',
      walletAddress: '0x456',
      tier: 'fedaykin',
      convictionScore: 100,
      activityScore: 50,
      currentRank: 25,
      joinedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { displayName: 'TestUser' },
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getAllBadgeDefinitions).mockResolvedValue(mockBadges);
    vi.mocked(getProfileByNym).mockResolvedValue(mockProfile);
    vi.mocked(getProfileBadgesByType).mockResolvedValue(['helper']);

    const result = await handler(payload, mockLogger);

    expect(result).toBe('ack');
    expect(getProfileBadgesByType).toHaveBeenCalledWith('profile-456');
    // Should only show badges the member has
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith(
      'int-123',
      'token-123',
      expect.arrayContaining([
        expect.objectContaining({ value: 'helper' }),
      ])
    );
  });

  it('should return empty choices when community not found', async () => {
    const payload: DiscordEventPayload = {
      eventId: 'evt-123',
      eventType: 'interaction',
      timestamp: Date.now(),
      guildId: 'guild-123',
      interactionId: 'int-123',
      interactionToken: 'token-123',
      commandName: 'admin-badge',
      data: {
        options: [
          {
            name: 'award',
            options: [{ name: 'nym', value: 'test', focused: true }],
          },
        ],
      },
    };

    vi.mocked(getCommunityByGuildId).mockResolvedValue(null);

    const result = await handler(payload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith('int-123', 'token-123', []);
  });

  it('should return empty choices on error', async () => {
    const payload: DiscordEventPayload = {
      eventId: 'evt-123',
      eventType: 'interaction',
      timestamp: Date.now(),
      guildId: 'guild-123',
      interactionId: 'int-123',
      interactionToken: 'token-123',
      commandName: 'admin-badge',
      data: {
        options: [
          {
            name: 'award',
            options: [{ name: 'nym', value: 'test', focused: true }],
          },
        ],
      },
    };

    vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

    const result = await handler(payload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.respondAutocomplete).toHaveBeenCalledWith('int-123', 'token-123', []);
  });
});
