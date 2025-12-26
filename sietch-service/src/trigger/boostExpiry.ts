import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { boostService } from '../services/boost/BoostService.js';
import {
  initDatabase,
  updateHealthStatusSuccess,
  logAuditEvent,
} from '../db/index.js';

/**
 * Scheduled task to deactivate expired boosts
 *
 * Runs daily at 00:05 UTC
 * - Deactivates all expired boosts
 * - Updates community boost statistics
 */
export const boostExpiryTask = schedules.task({
  id: 'boost-expiry',
  cron: '5 0 * * *', // Every day at 00:05 UTC
  run: async () => {
    triggerLogger.info('Starting boost expiry check task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // Run maintenance to deactivate expired boosts
      const result = await boostService.runMaintenanceTasks();

      triggerLogger.info('Boost expiry check completed', {
        expiredCount: result.expiredCount,
      });

      // Log audit event
      logAuditEvent('boost_expiry_check', {
        expiredCount: result.expiredCount,
        timestamp: new Date().toISOString(),
      });

      // Update health status
      updateHealthStatusSuccess();

      // Return summary for trigger.dev dashboard
      return {
        success: true,
        expiredCount: result.expiredCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      triggerLogger.error('Boost expiry check failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
