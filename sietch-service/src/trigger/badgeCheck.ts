/**
 * Badge Check Scheduled Task
 *
 * Runs daily to check and award automatic badges (tenure, activity).
 * - Tenure badges: OG, Veteran, Elder (based on membership duration)
 * - Activity badges: Consistent, Dedicated, Devoted (based on activity balance)
 */

import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { initDatabase } from '../db/index.js';
import { runBadgeCheckTask } from '../services/badge.js';

/**
 * Scheduled task to check and award badges
 *
 * Runs daily at midnight UTC
 */
export const badgeCheckTask = schedules.task({
  id: 'badge-check',
  cron: '0 0 * * *', // Every day at 00:00 UTC
  run: async () => {
    triggerLogger.info('Starting badge check task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // Run the badge check task
      const result = await runBadgeCheckTask();

      triggerLogger.info('Badge check completed', {
        membersChecked: result.membersChecked,
        badgesAwarded: result.badgesAwarded,
        badgesByType: result.badgesByType,
      });

      return {
        success: true,
        membersChecked: result.membersChecked,
        badgesAwarded: result.badgesAwarded,
        badgesByType: result.badgesByType,
      };
    } catch (error) {
      triggerLogger.error('Badge check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
