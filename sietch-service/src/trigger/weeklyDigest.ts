import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { digestService } from '../services/DigestService.js';
import { initDatabase, updateHealthStatusSuccess, logAuditEvent } from '../db/index.js';
import { config } from '../config.js';
import { discordService } from '../services/discord.js';

/**
 * Scheduled task to generate and post weekly community digest
 *
 * Runs every Monday at 00:00 UTC
 * - Collects weekly stats (members, BGT, tiers, promotions, badges)
 * - Formats digest with Dune theme
 * - Posts to announcements channel
 * - Stores digest record in database
 *
 * Graceful degradation:
 * - If announcements channel not configured, logs warning and skips posting
 * - If Discord client unavailable, logs error and skips posting
 * - Stats collection always completes even if posting fails
 */
export const weeklyDigestTask = schedules.task({
  id: 'weekly-digest',
  cron: '0 0 * * 1', // Every Monday at 00:00 UTC
  run: async () => {
    triggerLogger.info('Starting weekly digest task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // Collect weekly stats
      const stats = digestService.collectWeeklyStats();

      triggerLogger.info('Weekly stats collected', {
        weekIdentifier: stats.weekIdentifier,
        totalMembers: stats.totalMembers,
        newMembers: stats.newMembers,
        promotionsCount: stats.promotionsCount,
      });

      // Check if digest already exists for this week (prevent duplicates)
      if (digestService.digestExistsForWeek(stats.weekIdentifier)) {
        triggerLogger.warn('Digest already exists for this week, skipping post', {
          weekIdentifier: stats.weekIdentifier,
        });

        logAuditEvent('weekly_digest_skipped', {
          weekIdentifier: stats.weekIdentifier,
          reason: 'digest_already_exists',
          totalMembers: stats.totalMembers,
        });

        return {
          success: true,
          skipped: true,
          reason: 'Digest already exists',
          weekIdentifier: stats.weekIdentifier,
        };
      }

      // Check if announcements channel is configured
      const announcementsChannelId = config.discord.channels.announcements;

      if (!announcementsChannelId) {
        triggerLogger.warn('DISCORD_ANNOUNCEMENTS_CHANNEL_ID not configured, skipping digest post');

        // Log audit event (stats collected but not posted)
        logAuditEvent('weekly_digest_skipped', {
          weekIdentifier: stats.weekIdentifier,
          reason: 'announcements_channel_not_configured',
          stats: {
            totalMembers: stats.totalMembers,
            newMembers: stats.newMembers,
            promotionsCount: stats.promotionsCount,
          },
        });

        return {
          success: true,
          posted: false,
          reason: 'Announcements channel not configured',
          stats,
        };
      }

      // Get Discord client
      const discordClient = discordService.getClient();

      if (!discordClient) {
        triggerLogger.error('Discord client not available, cannot post digest');

        // Log audit event (stats collected but not posted)
        logAuditEvent('weekly_digest_failed', {
          weekIdentifier: stats.weekIdentifier,
          reason: 'discord_client_unavailable',
          stats: {
            totalMembers: stats.totalMembers,
            newMembers: stats.newMembers,
            promotionsCount: stats.promotionsCount,
          },
        });

        return {
          success: false,
          posted: false,
          reason: 'Discord client unavailable',
          stats,
        };
      }

      // Post digest to Discord
      const postResult = await digestService.postDigest(
        stats,
        discordClient,
        announcementsChannelId
      );

      if (postResult.success) {
        triggerLogger.info('Weekly digest posted successfully', {
          weekIdentifier: stats.weekIdentifier,
          messageId: postResult.messageId,
          channelId: postResult.channelId,
        });

        // Update health status (confirms task ran successfully)
        updateHealthStatusSuccess();

        return {
          success: true,
          posted: true,
          weekIdentifier: stats.weekIdentifier,
          messageId: postResult.messageId,
          channelId: postResult.channelId,
          stats: {
            totalMembers: stats.totalMembers,
            newMembers: stats.newMembers,
            totalBgt: stats.totalBgt,
            promotionsCount: stats.promotionsCount,
            badgesAwarded: stats.badgesAwarded,
          },
        };
      } else {
        triggerLogger.error('Failed to post digest', {
          weekIdentifier: stats.weekIdentifier,
          error: postResult.error,
        });

        // Log audit event (failure)
        logAuditEvent('weekly_digest_failed', {
          weekIdentifier: stats.weekIdentifier,
          reason: postResult.error,
          stats: {
            totalMembers: stats.totalMembers,
            newMembers: stats.newMembers,
            promotionsCount: stats.promotionsCount,
          },
        });

        return {
          success: false,
          posted: false,
          weekIdentifier: stats.weekIdentifier,
          error: postResult.error,
          stats,
        };
      }
    } catch (error) {
      triggerLogger.error('Weekly digest task failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Log audit event (unexpected error)
      logAuditEvent('weekly_digest_error', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
