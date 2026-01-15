/**
 * Alerts Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import {
  createAlertsHandler,
  createAlertsButtonHandler,
  createAlertsSelectHandler,
} from '../../../src/handlers/commands/alerts.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getProfileByDiscordId: vi.fn(),
  getNotificationPreferences: vi.fn(),
  isProfileNaib: vi.fn(),
  updateNotificationPreferences: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
  getNotificationPreferences,
  isProfileNaib,
  updateNotificationPreferences,
} from '../../../src/data/index.js';

describe('alerts command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createAlertsHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'alerts',
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
    metadata: { displayName: 'TestUser' },
  };

  const mockPrefs = {
    positionUpdates: true,
    atRiskWarnings: true,
    naibAlerts: false,
    frequency: '2_per_week' as const,
    alertsSentThisWeek: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferReply: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
      deferUpdate: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createAlertsHandler(mockDiscord);
  });

  it('should show alerts preferences for member', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getNotificationPreferences).mockResolvedValue(mockPrefs);
    vi.mocked(isProfileNaib).mockResolvedValue(false);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', true);
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.any(Array),
        components: expect.any(Array),
      })
    );
  });

  it('should show naib alerts option when user is naib', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({ ...mockProfile, tier: 'naib' });
    vi.mocked(getNotificationPreferences).mockResolvedValue(mockPrefs);
    vi.mocked(isProfileNaib).mockResolvedValue(true);

    await handler(basePayload, mockLogger);

    expect(isProfileNaib).toHaveBeenCalledWith('comm-123', 'profile-123');
    expect(mockDiscord.editOriginal).toHaveBeenCalled();
  });

  it('should show error when profile not found', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(null);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining('not a member'),
          }),
        ]),
      })
    );
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

  it('should handle database errors gracefully', async () => {
    vi.mocked(getCommunityByGuildId).mockRejectedValue(new Error('Database error'));

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('alerts button handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createAlertsButtonHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'alerts',
    customId: 'alerts_toggle_position_profile-123',
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
    metadata: { displayName: 'TestUser' },
  };

  const mockPrefs = {
    positionUpdates: true,
    atRiskWarnings: true,
    naibAlerts: false,
    frequency: '2_per_week' as const,
    alertsSentThisWeek: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferUpdate: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createAlertsButtonHandler(mockDiscord);
  });

  it('should toggle position updates preference', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getNotificationPreferences).mockResolvedValue(mockPrefs);
    vi.mocked(isProfileNaib).mockResolvedValue(false);
    vi.mocked(updateNotificationPreferences).mockResolvedValue();

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(updateNotificationPreferences).toHaveBeenCalledWith(
      'profile-123',
      expect.objectContaining({ positionUpdates: false })
    );
    expect(mockDiscord.editOriginal).toHaveBeenCalled();
  });

  it('should toggle at-risk warnings preference', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getNotificationPreferences).mockResolvedValue(mockPrefs);
    vi.mocked(isProfileNaib).mockResolvedValue(false);
    vi.mocked(updateNotificationPreferences).mockResolvedValue();

    const atRiskPayload = {
      ...basePayload,
      customId: 'alerts_toggle_atrisk_profile-123',
    };

    await handler(atRiskPayload, mockLogger);

    expect(updateNotificationPreferences).toHaveBeenCalledWith(
      'profile-123',
      expect.objectContaining({ atRiskWarnings: false })
    );
  });

  it('should disable all alerts', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getNotificationPreferences).mockResolvedValue(mockPrefs);
    vi.mocked(isProfileNaib).mockResolvedValue(false);
    vi.mocked(updateNotificationPreferences).mockResolvedValue();

    const disableAllPayload = {
      ...basePayload,
      customId: 'alerts_disable_all_profile-123',
    };

    await handler(disableAllPayload, mockLogger);

    expect(updateNotificationPreferences).toHaveBeenCalledWith(
      'profile-123',
      expect.objectContaining({
        positionUpdates: false,
        atRiskWarnings: false,
        naibAlerts: false,
      })
    );
  });

  it('should reject when profile mismatch', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({
      ...mockProfile,
      id: 'different-profile',
    });

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });
});

describe('alerts select handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createAlertsSelectHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'user-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'alerts',
    customId: 'alerts_frequency_profile-123',
    selectedValues: ['daily'],
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
    metadata: { displayName: 'TestUser' },
  };

  const mockPrefs = {
    positionUpdates: true,
    atRiskWarnings: true,
    naibAlerts: false,
    frequency: '2_per_week' as const,
    alertsSentThisWeek: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDiscord = {
      deferUpdate: vi.fn().mockResolvedValue({ success: true }),
      editOriginal: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as DiscordRestService;

    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    handler = createAlertsSelectHandler(mockDiscord);
  });

  it('should update frequency preference', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue(mockProfile);
    vi.mocked(getNotificationPreferences).mockResolvedValue(mockPrefs);
    vi.mocked(isProfileNaib).mockResolvedValue(false);
    vi.mocked(updateNotificationPreferences).mockResolvedValue();

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(updateNotificationPreferences).toHaveBeenCalledWith(
      'profile-123',
      expect.objectContaining({ frequency: 'daily' })
    );
    expect(mockDiscord.editOriginal).toHaveBeenCalled();
  });

  it('should reject when profile mismatch', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getProfileByDiscordId).mockResolvedValue({
      ...mockProfile,
      id: 'different-profile',
    });

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it('should return ack when no selection', async () => {
    const payloadNoSelection = {
      ...basePayload,
      selectedValues: [],
    };

    const result = await handler(payloadNoSelection, mockLogger);

    expect(result).toBe('ack');
  });
});
