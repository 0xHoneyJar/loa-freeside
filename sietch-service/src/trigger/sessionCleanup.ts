/**
 * Session Cleanup Scheduled Task (v4.1 - Sprint 31)
 *
 * Runs every hour to clean up expired Telegram verification sessions.
 * This prevents database bloat from abandoned verification attempts.
 */

import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { initDatabase } from '../db/index.js';
import { identityService } from '../services/IdentityService.js';

/**
 * Scheduled task to clean up expired verification sessions
 *
 * Runs every hour at minute 15 (offset from other tasks)
 */
export const sessionCleanupTask = schedules.task({
  id: 'telegram-session-cleanup',
  cron: '15 * * * *', // Every hour at minute 15
  run: async () => {
    triggerLogger.info('Starting Telegram session cleanup task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // Clean up expired sessions
      const cleanedCount = await identityService.cleanupExpiredSessions();

      triggerLogger.info('Session cleanup completed', {
        cleaned: cleanedCount,
      });

      return {
        success: true,
        cleaned: cleanedCount,
      };
    } catch (error) {
      triggerLogger.error('Session cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
