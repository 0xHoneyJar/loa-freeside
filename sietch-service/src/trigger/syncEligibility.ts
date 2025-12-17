import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { chainService } from '../services/chain.js';
import { eligibilityService } from '../services/eligibility.js';
import { discordService } from '../services/discord.js';
import {
  initDatabase,
  saveEligibilitySnapshot,
  getLatestEligibilitySnapshot,
  updateHealthStatusSuccess,
  updateHealthStatusFailure,
  logAuditEvent,
} from '../db/index.js';

/**
 * Scheduled task to sync BGT eligibility data from chain
 *
 * Runs every 6 hours
 * - Fetches fresh eligibility data from Berachain RPC
 * - Computes diff from previous snapshot
 * - Stores new snapshot in database
 * - Updates health status
 */
export const syncEligibilityTask = schedules.task({
  id: 'sync-eligibility',
  cron: '0 */6 * * *', // Every 6 hours at minute 0
  run: async () => {
    triggerLogger.info('Starting eligibility sync task');

    // Initialize database (idempotent)
    initDatabase();

    try {
      // 1. Get previous snapshot for diff computation
      const previousSnapshot = getLatestEligibilitySnapshot();
      triggerLogger.info(`Previous snapshot has ${previousSnapshot.length} entries`);

      // 2. Fetch fresh eligibility data from chain
      triggerLogger.info('Fetching eligibility data from Berachain RPC...');
      const rawEligibility = await chainService.fetchEligibilityData();
      triggerLogger.info(`Fetched ${rawEligibility.length} wallets from chain`);

      // 3. Apply admin overrides
      const eligibility = await eligibilityService.applyAdminOverrides(rawEligibility);
      triggerLogger.info(`After overrides: ${eligibility.length} entries`);

      // 4. Compute diff from previous snapshot
      const diff = eligibilityService.computeDiff(previousSnapshot, eligibility);

      triggerLogger.info('Eligibility diff computed', {
        added: diff.added.length,
        removed: diff.removed.length,
        promotedToNaib: diff.promotedToNaib.length,
        demotedFromNaib: diff.demotedFromNaib.length,
      });

      // 5. Save new snapshot
      const snapshotId = saveEligibilitySnapshot(eligibility);
      triggerLogger.info(`Saved eligibility snapshot #${snapshotId}`);

      // 6. Update health status - success
      updateHealthStatusSuccess();

      // 7. Log audit event
      logAuditEvent('eligibility_update', {
        snapshotId,
        totalEligible: eligibility.filter((e) => e.rank && e.rank <= 69).length,
        added: diff.added.length,
        removed: diff.removed.length,
        promotedToNaib: diff.promotedToNaib.length,
        demotedFromNaib: diff.demotedFromNaib.length,
      });

      // 8. Process Discord notifications (non-blocking)
      // Errors in Discord don't fail the sync
      try {
        if (discordService.isConnected()) {
          triggerLogger.info('Processing Discord notifications...');
          await discordService.processEligibilityChanges(diff);
          triggerLogger.info('Discord notifications processed');
        } else {
          triggerLogger.warn('Discord not connected, skipping notifications');
        }
      } catch (discordError) {
        triggerLogger.error('Discord notification error (non-fatal)', {
          error: discordError instanceof Error ? discordError.message : String(discordError),
        });
        // Don't re-throw - Discord errors shouldn't fail the sync
      }

      triggerLogger.info('Eligibility sync completed successfully');

      // Return summary for trigger.dev dashboard
      return {
        success: true,
        snapshotId,
        stats: {
          totalWallets: rawEligibility.length,
          eligibleWallets: eligibility.filter((e) => e.rank && e.rank <= 69).length,
          naibCount: eligibility.filter((e) => e.role === 'naib').length,
          fedaykinCount: eligibility.filter((e) => e.role === 'fedaykin').length,
        },
        diff: {
          added: diff.added.length,
          removed: diff.removed.length,
          promotedToNaib: diff.promotedToNaib.length,
          demotedFromNaib: diff.demotedFromNaib.length,
        },
      };
    } catch (error) {
      // Update health status - failure
      updateHealthStatusFailure();

      triggerLogger.error('Eligibility sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Re-throw to trigger retry logic
      throw error;
    }
  },
});
