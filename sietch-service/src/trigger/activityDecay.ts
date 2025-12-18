/**
 * Activity Decay Scheduled Task
 *
 * Runs every 6 hours to apply demurrage decay to all member activity balances.
 * Default decay: 10% every 6 hours (configurable)
 */

import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { initDatabase } from '../db/index.js';
import { runDecayTask, cleanupRateLimitCache } from '../services/activity.js';

/**
 * Scheduled task to apply activity decay
 *
 * Runs every 6 hours at minute 30 (offset from eligibility sync)
 */
export const activityDecayTask = schedules.task({
  id: 'activity-decay',
  cron: '30 */6 * * *', // Every 6 hours at minute 30
  run: async () => {
    triggerLogger.info('Starting activity decay task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // Run the decay task
      const result = await runDecayTask();

      triggerLogger.info('Activity decay completed', {
        processed: result.processed,
        decayed: result.decayed,
      });

      // Clean up rate limit cache
      cleanupRateLimitCache();
      triggerLogger.info('Cleaned up rate limit cache');

      return {
        success: true,
        processed: result.processed,
        decayed: result.decayed,
      };
    } catch (error) {
      triggerLogger.error('Activity decay failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
