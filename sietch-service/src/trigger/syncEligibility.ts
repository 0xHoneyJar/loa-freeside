import { schedules, logger as triggerLogger } from '@trigger.dev/sdk/v3';
import { chainService } from '../services/chain.js';
import { eligibilityService } from '../services/eligibility.js';
import { discordService } from '../services/discord.js';
import { naibService } from '../services/naib.js';
import { thresholdService } from '../services/threshold.js';
import { notificationService } from '../services/notification.js';
import {
  initDatabase,
  saveEligibilitySnapshot,
  getLatestEligibilitySnapshot,
  updateHealthStatusSuccess,
  updateHealthStatusFailure,
  logAuditEvent,
  getDiscordIdByWallet,
  getMemberProfileByDiscordId,
} from '../db/index.js';

/**
 * Scheduled task to sync BGT eligibility data from chain
 *
 * Runs every 6 hours
 * - Fetches fresh eligibility data from Berachain RPC
 * - Computes diff from previous snapshot
 * - Stores new snapshot in database
 * - Evaluates Naib seats (v2.1)
 * - Saves threshold snapshot (v2.1)
 * - Checks waitlist eligibility (v2.1)
 * - Processes notifications (v2.1)
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

      // 8. Evaluate Naib seats based on BGT changes (v2.1)
      let naibEvaluation = null;
      try {
        triggerLogger.info('Evaluating Naib seats...');
        naibEvaluation = naibService.evaluateSeats();
        triggerLogger.info('Naib seat evaluation completed', {
          changes: naibEvaluation.changes.length,
          emptySeats: naibEvaluation.emptySeats,
          currentNaib: naibEvaluation.currentNaib.length,
        });

        // Log audit event for Naib changes
        if (naibEvaluation.changes.length > 0) {
          logAuditEvent('naib_seats_evaluated', {
            snapshotId,
            changes: naibEvaluation.changes.map((c) => ({
              type: c.type,
              memberId: c.memberId,
              seatNumber: c.seatNumber,
            })),
          });
        }
      } catch (naibError) {
        triggerLogger.error('Naib evaluation error (non-fatal)', {
          error: naibError instanceof Error ? naibError.message : String(naibError),
        });
      }

      // 9. Save threshold snapshot (v2.1)
      let thresholdSnapshot = null;
      try {
        triggerLogger.info('Saving threshold snapshot...');
        thresholdSnapshot = thresholdService.saveSnapshot();
        triggerLogger.info('Threshold snapshot saved', {
          entryThreshold: thresholdSnapshot.entryThresholdBgt,
          eligibleCount: thresholdSnapshot.eligibleCount,
          waitlistCount: thresholdSnapshot.waitlistCount,
        });
      } catch (thresholdError) {
        triggerLogger.error('Threshold snapshot error (non-fatal)', {
          error: thresholdError instanceof Error ? thresholdError.message : String(thresholdError),
        });
      }

      // 10. Check waitlist eligibility (v2.1)
      let waitlistCheck = null;
      try {
        triggerLogger.info('Checking waitlist eligibility...');
        waitlistCheck = thresholdService.checkWaitlistEligibility();
        triggerLogger.info('Waitlist eligibility check completed', {
          newlyEligible: waitlistCheck.newlyEligible.length,
          droppedOut: waitlistCheck.droppedOut.length,
        });

        // Send notifications to newly eligible waitlist members
        for (const registration of waitlistCheck.newlyEligible) {
          try {
            // Get current position for the wallet
            const currentPos = thresholdService.getWalletPosition(registration.walletAddress);
            const currentBgt = currentPos ? currentPos.bgt : 0;

            await notificationService.sendWaitlistEligible(
              registration.discordUserId,
              {
                previousPosition: registration.positionAtRegistration,
                currentPosition: currentPos?.position ?? 69, // Position or threshold
                bgt: currentBgt,
              }
            );
            thresholdService.markNotified(registration.id);
          } catch (notifyError) {
            triggerLogger.warn('Failed to notify waitlist member', {
              discordUserId: registration.discordUserId,
              error: notifyError instanceof Error ? notifyError.message : String(notifyError),
            });
          }
        }
      } catch (waitlistError) {
        triggerLogger.error('Waitlist check error (non-fatal)', {
          error: waitlistError instanceof Error ? waitlistError.message : String(waitlistError),
        });
      }

      // 11. Process position and at-risk notifications (v2.1)
      let notificationStats = { position: { sent: 0, skipped: 0, failed: 0 }, atRisk: { sent: 0, skipped: 0, failed: 0 } };
      try {
        triggerLogger.info('Processing member notifications...');

        // Process position update notifications
        notificationStats.position = await notificationService.processPositionAlerts();
        triggerLogger.info('Position alerts processed', notificationStats.position);

        // Identify at-risk members (positions 63-69)
        const atRiskMembers = eligibility
          .filter((e) => e.rank && e.rank >= 63 && e.rank <= 69)
          .map((e, _idx, arr) => {
            // Look up member by wallet address
            const discordId = getDiscordIdByWallet(e.address);
            if (!discordId) return null;
            const member = getMemberProfileByDiscordId(discordId);
            if (!member) return null;

            const belowEntry = arr.find((b) => b.rank === (e.rank ?? 0) + 1);
            return {
              memberId: member.memberId,
              position: e.rank ?? 0,
              bgt: Number(BigInt(e.bgtHeld)) / 1e18,
              distanceToBelow: belowEntry
                ? (Number(BigInt(e.bgtHeld)) - Number(BigInt(belowEntry.bgtHeld))) / 1e18
                : 0,
            };
          })
          .filter((m): m is NonNullable<typeof m> => m !== null); // Only members with profiles

        if (atRiskMembers.length > 0) {
          notificationStats.atRisk = await notificationService.processAtRiskAlerts(atRiskMembers);
          triggerLogger.info('At-risk alerts processed', notificationStats.atRisk);
        }
      } catch (notificationError) {
        triggerLogger.error('Notification processing error (non-fatal)', {
          error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
      }

      // 12. Process Discord notifications (non-blocking)
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
        naib: naibEvaluation ? {
          changes: naibEvaluation.changes.length,
          emptySeats: naibEvaluation.emptySeats,
          currentNaib: naibEvaluation.currentNaib.length,
        } : null,
        threshold: thresholdSnapshot ? {
          entryThreshold: thresholdSnapshot.entryThresholdBgt,
          eligibleCount: thresholdSnapshot.eligibleCount,
          waitlistCount: thresholdSnapshot.waitlistCount,
        } : null,
        waitlist: waitlistCheck ? {
          newlyEligible: waitlistCheck.newlyEligible.length,
          droppedOut: waitlistCheck.droppedOut.length,
        } : null,
        notifications: notificationStats,
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
