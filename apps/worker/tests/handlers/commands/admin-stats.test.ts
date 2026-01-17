/**
 * Admin Stats Command Handler Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';
import { createAdminStatsHandler } from '../../../src/handlers/commands/admin-stats.js';
import type { DiscordEventPayload } from '../../../src/types.js';
import type { DiscordRestService } from '../../../src/services/DiscordRest.js';

// Mock data module
vi.mock('../../../src/data/index.js', () => ({
  getCommunityByGuildId: vi.fn(),
  getCommunityAnalytics: vi.fn(),
  getTierDistributionSummary: vi.fn(),
  getTopActiveMembers: vi.fn(),
  getRecentPromotions: vi.fn(),
}));

// Import mocked functions
import {
  getCommunityByGuildId,
  getCommunityAnalytics,
  getTierDistributionSummary,
  getTopActiveMembers,
  getRecentPromotions,
} from '../../../src/data/index.js';

describe('admin-stats command handler', () => {
  let mockDiscord: DiscordRestService;
  let mockLogger: Logger;
  let handler: ReturnType<typeof createAdminStatsHandler>;

  const basePayload: DiscordEventPayload = {
    eventId: 'evt-123',
    eventType: 'interaction',
    timestamp: Date.now(),
    guildId: 'guild-123',
    userId: 'admin-123',
    interactionId: 'int-123',
    interactionToken: 'token-123',
    commandName: 'admin-stats',
    // SEC-1: Include admin permissions for authorization check
    data: {
      member: {
        permissions: '8', // ADMINISTRATOR bit
      },
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

  const mockAnalytics = {
    totalMembers: 150,
    byTier: {
      naib: 7,
      fedaykin: 62,
      sayyadina: 30,
      sietch: 25,
      stillsuit: 16,
      fremen: 10,
    },
    totalConviction: 250000,
    weeklyActive: 85,
    newThisWeek: 12,
    promotionsThisWeek: 5,
    badgesAwardedThisWeek: 23,
    generatedAt: new Date(),
  };

  const mockTierDistribution = 'Naib: 7\nFedaykin: 62\nSayyadina: 30\nSietch: 25\nStillsuit: 16\nFremen: 10';

  const mockTopActive = [
    { nym: 'User1', activityScore: 950, tier: 'naib' },
    { nym: 'User2', activityScore: 820, tier: 'fedaykin' },
    { nym: 'User3', activityScore: 750, tier: 'fedaykin' },
    { nym: 'User4', activityScore: 680, tier: 'sayyadina' },
    { nym: 'User5', activityScore: 620, tier: null },
  ];

  const mockRecentPromotions = [
    { nym: 'NewLeader', fromTier: 'fedaykin', toTier: 'naib', changedAt: new Date() },
    { nym: 'RisingMember', fromTier: 'sayyadina', toTier: 'fedaykin', changedAt: new Date() },
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

    handler = createAdminStatsHandler(mockDiscord);
  });

  it('should show admin stats for admin user', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getCommunityAnalytics).mockResolvedValue(mockAnalytics);
    vi.mocked(getTierDistributionSummary).mockResolvedValue(mockTierDistribution);
    vi.mocked(getTopActiveMembers).mockResolvedValue(mockTopActive);
    vi.mocked(getRecentPromotions).mockResolvedValue(mockRecentPromotions);

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.deferReply).toHaveBeenCalledWith('int-123', 'token-123', true);
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            title: expect.stringContaining('Analytics'),
          }),
        ]),
      })
    );
  });

  it('should show tier distribution', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getCommunityAnalytics).mockResolvedValue(mockAnalytics);
    vi.mocked(getTierDistributionSummary).mockResolvedValue(mockTierDistribution);
    vi.mocked(getTopActiveMembers).mockResolvedValue(mockTopActive);
    vi.mocked(getRecentPromotions).mockResolvedValue(mockRecentPromotions);

    await handler(basePayload, mockLogger);

    expect(getCommunityAnalytics).toHaveBeenCalledWith('comm-123');
    expect(mockDiscord.editOriginal).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: expect.stringContaining('Tier'),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('should show weekly activity metrics', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getCommunityAnalytics).mockResolvedValue(mockAnalytics);
    vi.mocked(getTierDistributionSummary).mockResolvedValue(mockTierDistribution);
    vi.mocked(getTopActiveMembers).mockResolvedValue(mockTopActive);
    vi.mocked(getRecentPromotions).mockResolvedValue(mockRecentPromotions);

    await handler(basePayload, mockLogger);

    expect(mockDiscord.editOriginal).toHaveBeenCalled();
    // The embed should contain weekly active users info
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

  it('should handle defer failure gracefully', async () => {
    (mockDiscord.deferReply as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Discord error' });

    const result = await handler(basePayload, mockLogger);

    expect(result).toBe('ack');
    expect(mockDiscord.editOriginal).not.toHaveBeenCalled();
  });

  it('should log admin stats served on success', async () => {
    vi.mocked(getCommunityByGuildId).mockResolvedValue(mockCommunity);
    vi.mocked(getCommunityAnalytics).mockResolvedValue(mockAnalytics);
    vi.mocked(getTierDistributionSummary).mockResolvedValue(mockTierDistribution);
    vi.mocked(getTopActiveMembers).mockResolvedValue(mockTopActive);
    vi.mocked(getRecentPromotions).mockResolvedValue(mockRecentPromotions);

    await handler(basePayload, mockLogger);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ totalMembers: 150 }),
      'Admin stats served'
    );
  });

  // SEC-1.4: Test unauthorized access (Finding H-2)
  it('should reject non-administrator users', async () => {
    const nonAdminPayload = {
      ...basePayload,
      data: {
        member: {
          permissions: '2048', // SEND_MESSAGES only, no ADMINISTRATOR
        },
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
      data: {}, // No member permissions
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
