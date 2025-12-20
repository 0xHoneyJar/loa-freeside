import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { notificationService } from '../services/notification.js';
import {
  initDatabase,
  updateHealthStatusSuccess,
  logAuditEvent,
} from '../db/index.js';

/**
 * Scheduled task to reset weekly notification counters
 *
 * Runs every Monday at 00:00 UTC
 * - Resets alert counters for all members
 * - Allows fresh notification quota for the week
 */
export const weeklyResetTask = schedules.task({
  id: 'weekly-reset',
  cron: '0 0 * * 1', // Every Monday at 00:00 UTC
  run: async () => {
    triggerLogger.info('Starting weekly counter reset task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // Reset all weekly alert counters
      const resetCount = notificationService.resetWeeklyCounters();

      triggerLogger.info('Weekly counters reset', {
        membersReset: resetCount,
      });

      // Log audit event
      logAuditEvent('weekly_reset', {
        membersReset: resetCount,
        timestamp: new Date().toISOString(),
      });

      // Update health status (optional - confirms task ran)
      updateHealthStatusSuccess();

      triggerLogger.info('Weekly reset completed successfully');

      // Return summary for trigger.dev dashboard
      return {
        success: true,
        membersReset: resetCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      triggerLogger.error('Weekly reset failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
