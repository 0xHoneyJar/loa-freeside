/**
 * /stats Command Handler
 *
 * Displays personal activity statistics including:
 * - Tier and progression
 * - Activity this week and streaks
 * - Badges earned
 * - Member tenure
 *
 * Ephemeral - only visible to the user.
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getMemberStats,
} from '../../data/index.js';
import {
  buildPersonalStatsEmbed,
  createErrorEmbed,
  type PersonalStatsData,
} from '../../embeds/index.js';

/**
 * Handle /stats command
 */
export function createStatsHandler(discord: DiscordRestService) {
  return async function handleStats(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId } = payload;

    if (!interactionId || !interactionToken) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction credentials');
      return 'ack';
    }

    if (!userId) {
      logger.error({ eventId: payload.eventId }, 'Missing user ID');
      return 'ack';
    }

    if (!guildId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild ID');
      return 'ack';
    }

    const log = logger.child({ command: 'stats', userId, guildId });

    try {
      // Step 1: Defer reply (ephemeral - private to user)
      const deferResult = await discord.deferReply(interactionId, interactionToken, true);
      if (!deferResult.success) {
        log.error({ error: deferResult.error }, 'Failed to defer reply');
        return 'ack';
      }

      // Step 2: Get community from guild ID
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured. Please contact an administrator.')],
        });
        return 'ack';
      }

      // Step 3: Get member stats
      const stats = await getMemberStats(community.id, userId);
      if (!stats) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            "You haven't completed onboarding yet. " +
            "Please complete the onboarding process first to view your stats."
          )],
        });
        return 'ack';
      }

      // Step 4: Build stats data from profile and badges
      const profile = stats.profile;
      const metadata = profile.metadata ?? {};

      // Calculate tenure category based on join date
      const tenureCategory = calculateTenureCategory(profile.joinedAt);

      // Map badges to embed format
      const badgeList = stats.badges.map((badge) => ({
        name: badge.metadata?.badgeName ?? badge.badgeType,
        emoji: badge.metadata?.emoji,
      }));

      // Build tier progress (simplified - Worker doesn't have full tier config)
      const tierProgress = {
        nextTier: getNextTier(profile.tier),
        isRankBased: profile.tier === 'fedaykin' || profile.tier === 'naib',
        bgtToNextTierFormatted: undefined, // Would need BGT data
      };

      const statsData: PersonalStatsData = {
        nym: metadata.displayName ?? metadata.username ?? `User#${userId.slice(-4)}`,
        tier: profile.tier ?? 'initiate',
        tenureCategory,
        memberSince: profile.joinedAt,
        badgeCount: stats.badgeCount,
        messagesThisWeek: profile.activityScore, // Approximate with activity score
        currentStreak: 0, // Would need activity tracking
        longestStreak: 0, // Would need activity tracking
        badges: badgeList,
        tierProgress,
        pfpUrl: metadata.avatarUrl,
      };

      // Step 5: Send embed response
      const embed = buildPersonalStatsEmbed(statsData);
      await discord.editOriginal(interactionToken, {
        embeds: [embed],
      });

      log.info({ memberId: profile.id, tier: profile.tier }, 'Stats served');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /stats command');

      // Try to send error response if we deferred
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while fetching your stats. Please try again.')],
        });
      }

      return 'ack';
    }
  };
}

/**
 * Calculate tenure category based on join date
 */
function calculateTenureCategory(joinedAt: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - joinedAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays >= 365) return 'og';
  if (diffDays >= 180) return 'veteran';
  if (diffDays >= 90) return 'elder';
  return 'member';
}

/**
 * Get next tier in progression
 */
function getNextTier(currentTier: string | null): string | null {
  const tierOrder = ['waiting', 'initiate', 'acolyte', 'fedaykin', 'naib'];
  const currentIndex = tierOrder.indexOf(currentTier ?? 'waiting');

  if (currentIndex === -1 || currentIndex >= tierOrder.length - 1) {
    return null;
  }

  return tierOrder[currentIndex + 1] ?? null;
}
