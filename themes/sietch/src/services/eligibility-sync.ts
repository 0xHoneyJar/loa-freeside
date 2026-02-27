/**
 * Eligibility Sync Service
 * Sprint 175: Server-side eligibility sync logic
 *
 * This service contains the core eligibility sync logic that runs on ECS.
 * It's called by the internal API endpoint which Trigger.dev invokes via HTTP.
 *
 * The sync logic was originally in the Trigger.dev task but moved here because
 * Trigger.dev workers cannot connect to RDS (VPC isolation). Now the Trigger.dev
 * task just makes an HTTP call to the ECS server which has VPC access.
 */

import { chainService } from './chain.js';
import { eligibilityService } from './eligibility.js';
import { discordService } from './discord.js';
import { naibService } from './naib.js';
import { thresholdService } from './threshold.js';
import { notificationService } from './notification.js';
import { storyService } from './StoryService.js';
import { tierService, syncTierRole, isTierRolesConfigured, TIER_INFO, awardBadge, BADGE_IDS } from './index.js';
import { memberHasBadge } from '../db/index.js';
import {
  logAuditEvent,
  getDiscordIdByWallet,
  getMemberProfileByDiscordId,
  // PostgreSQL queries (Sprint 175 - persistent eligibility)
  isEligibilityPgDbInitialized,
  saveEligibilitySnapshotPg,
  getLatestEligibilitySnapshotPg,
  updateHealthStatusSuccessPg,
  updateHealthStatusFailurePg,
} from '../db/index.js';
import { logger } from '../utils/logger.js';
import type { Tier } from '../types/index.js';

/**
 * Result of running the eligibility sync
 */
export interface EligibilitySyncResult {
  success: boolean;
  snapshotId?: number;
  stats?: {
    totalWallets: number;
    eligibleWallets: number;
    naibCount: number;
    fedaykinCount: number;
  };
  diff?: {
    added: number;
    removed: number;
    promotedToNaib: number;
    demotedFromNaib: number;
  };
  naib?: {
    changes: number;
    emptySeats: number;
    currentNaib: number;
  } | null;
  threshold?: {
    entryThreshold: number;
    eligibleCount: number;
    waitlistCount: number;
  } | null;
  waitlist?: {
    newlyEligible: number;
    droppedOut: number;
  } | null;
  notifications?: {
    position: { sent: number; skipped: number; failed: number };
    atRisk: { sent: number; skipped: number; failed: number };
  };
  tiers?: {
    updated: number;
    promotions: number;
    demotions: number;
    roleChanges: number;
    errors: number;
    dmsSent: number;
  } | null;
  error?: string;
}

/**
 * Run eligibility sync on the server (ECS)
 *
 * This function contains all the sync logic that was previously in the Trigger.dev task.
 * It runs on ECS which has VPC access to RDS.
 *
 * @returns Sync result with statistics
 */
export async function runEligibilitySyncOnServer(): Promise<EligibilitySyncResult> {
  logger.info('Starting server-side eligibility sync');

  // Verify PostgreSQL is initialized
  if (!isEligibilityPgDbInitialized()) {
    throw new Error('PostgreSQL database not initialized for eligibility queries');
  }

  try {
    // 1. Get previous snapshot for diff computation (from PostgreSQL)
    const previousSnapshot = await getLatestEligibilitySnapshotPg();
    logger.info({ count: previousSnapshot.length }, 'Previous snapshot loaded');

    // 2. Fetch fresh eligibility data from chain
    logger.info('Fetching eligibility data from Berachain RPC...');
    const rawEligibility = await chainService.fetchEligibilityData();
    logger.info({ count: rawEligibility.length }, 'Fetched wallets from chain');

    // 3. Apply admin overrides
    const eligibility = await eligibilityService.applyAdminOverrides(rawEligibility);
    logger.info({ count: eligibility.length }, 'After overrides');

    // 4. Compute diff from previous snapshot
    const diff = eligibilityService.computeDiff(previousSnapshot, eligibility);
    logger.info({
      added: diff.added.length,
      removed: diff.removed.length,
      promotedToNaib: diff.promotedToNaib.length,
      demotedFromNaib: diff.demotedFromNaib.length,
    }, 'Eligibility diff computed');

    // 5. Save new snapshot (to PostgreSQL)
    const snapshotId = await saveEligibilitySnapshotPg(eligibility);
    logger.info({ snapshotId }, 'Saved eligibility snapshot to PostgreSQL');

    // 6. Update health status - success (in PostgreSQL)
    await updateHealthStatusSuccessPg();

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
      logger.info('Evaluating Naib seats...');
      naibEvaluation = naibService.evaluateSeats();
      logger.info({
        changes: naibEvaluation.changes.length,
        emptySeats: naibEvaluation.emptySeats,
        currentNaib: naibEvaluation.currentNaib.length,
      }, 'Naib seat evaluation completed');

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
      logger.error({ error: naibError instanceof Error ? naibError.message : String(naibError) }, 'Naib evaluation error (non-fatal)');
    }

    // 9. Calculate and sync tier for each member (v3.0)
    const tierStats = { updated: 0, promotions: 0, demotions: 0, roleChanges: 0, errors: 0, dmsSent: 0 };
    if (isTierRolesConfigured()) {
      try {
        logger.info('Processing tier updates for members...');

        // Get all onboarded members with their current BGT and rank
        for (const entry of eligibility) {
          const discordId = getDiscordIdByWallet(entry.address);
          if (!discordId) continue;

          const profile = getMemberProfileByDiscordId(discordId);
          if (!profile || !profile.onboardingComplete) continue;

          try {
            // Calculate new tier based on BGT and rank
            const newTier = tierService.calculateTier(entry.bgtHeld, entry.rank ?? null);
            const oldTier = profile.tier as Tier | null;

            // Check if tier changed
            if (oldTier !== newTier) {
              // Update tier in database
              const updated = await tierService.updateMemberTier(
                profile.memberId,
                newTier,
                entry.bgtHeld.toString(),
                entry.rank ?? null,
                oldTier
              );

              if (updated) {
                tierStats.updated++;

                // Check if promotion or demotion
                const isPromotion = oldTier !== null && tierService.isPromotion(oldTier, newTier);
                if (isPromotion) {
                  tierStats.promotions++;

                  // Send tier promotion DM (Sprint 18)
                  try {
                    const newTierInfo = TIER_INFO[newTier];
                    const isRankBased = newTier === 'naib' || newTier === 'fedaykin';

                    await notificationService.sendTierPromotion(profile.memberId, {
                      oldTier: oldTier,
                      newTier,
                      newTierName: newTierInfo.name,
                      bgtThreshold: newTierInfo.bgtThreshold,
                      isRankBased,
                    });

                    tierStats.dmsSent++;
                  } catch (dmError) {
                    logger.warn({ memberId: profile.memberId, error: dmError instanceof Error ? dmError.message : String(dmError) }, 'Failed to send tier promotion DM');
                  }

                  // Auto-award Usul Ascended badge when promoted to Usul tier (Sprint 18)
                  if (newTier === 'usul' && !memberHasBadge(profile.memberId, BADGE_IDS.usulAscended)) {
                    try {
                      const badge = awardBadge(profile.memberId, BADGE_IDS.usulAscended, {
                        reason: 'Reached Usul tier (1111+ BGT)',
                      });
                      if (badge) {
                        logger.info({ memberId: profile.memberId }, 'Usul Ascended badge awarded');

                        await notificationService.sendBadgeAward(profile.memberId, {
                          badgeId: BADGE_IDS.usulAscended,
                          badgeName: 'Usul Ascended',
                          badgeDescription: 'Reached the Usul tier - the base of the pillar, the innermost identity. 1111+ BGT',
                          badgeEmoji: '\u2B50',
                          awardReason: 'Reached Usul tier (1111+ BGT)',
                          isWaterSharer: false,
                        });
                      }
                    } catch (badgeError) {
                      logger.warn({ memberId: profile.memberId, error: badgeError instanceof Error ? badgeError.message : String(badgeError) }, 'Failed to award Usul Ascended badge');
                    }
                  }
                } else if (oldTier) {
                  tierStats.demotions++;
                }

                // Sync Discord roles
                const roleResult = await syncTierRole(discordId, newTier, oldTier);
                if (roleResult.assigned.length > 0 || roleResult.removed.length > 0) {
                  tierStats.roleChanges++;
                }

                // Post story fragment for elite tier promotions (v3.0 - Sprint 21)
                if (isPromotion && (newTier === 'fedaykin' || newTier === 'naib')) {
                  try {
                    const client = discordService.getClient();
                    if (client) {
                      const fragmentPosted = await storyService.postJoinFragment(client, newTier);
                      if (fragmentPosted) {
                        logger.info({ memberId: profile.memberId, tier: newTier }, 'Story fragment posted for elite promotion');
                      }
                    }
                  } catch (storyError) {
                    logger.warn({ memberId: profile.memberId, tier: newTier, error: storyError instanceof Error ? storyError.message : String(storyError) }, 'Failed to post story fragment');
                  }
                }
              }
            }
          } catch (memberTierError) {
            logger.warn({ discordId, error: memberTierError instanceof Error ? memberTierError.message : String(memberTierError) }, 'Failed to process tier for member');
            tierStats.errors++;
          }
        }

        logger.info(tierStats, 'Tier sync completed');

        // Log audit event for tier sync
        if (tierStats.updated > 0) {
          logAuditEvent('tier_role_sync', {
            snapshotId,
            updated: tierStats.updated,
            promotions: tierStats.promotions,
            demotions: tierStats.demotions,
            roleChanges: tierStats.roleChanges,
            dmsSent: tierStats.dmsSent,
            errors: tierStats.errors,
          });
        }
      } catch (tierError) {
        logger.error({ error: tierError instanceof Error ? tierError.message : String(tierError) }, 'Tier sync error (non-fatal)');
      }
    } else {
      logger.debug('Tier roles not configured, skipping tier sync');
    }

    // 10. Save threshold snapshot (v2.1)
    let thresholdSnapshot = null;
    try {
      logger.info('Saving threshold snapshot...');
      thresholdSnapshot = thresholdService.saveSnapshot();
      const entryThresholdNum = Number(BigInt(thresholdSnapshot.entryThresholdBgt)) / 1e18;
      logger.info({
        entryThreshold: entryThresholdNum,
        eligibleCount: thresholdSnapshot.eligibleCount,
        waitlistCount: thresholdSnapshot.waitlistCount,
      }, 'Threshold snapshot saved');
    } catch (thresholdError) {
      logger.error({ error: thresholdError instanceof Error ? thresholdError.message : String(thresholdError) }, 'Threshold snapshot error (non-fatal)');
    }

    // 11. Check waitlist eligibility (v2.1)
    let waitlistCheck = null;
    try {
      logger.info('Checking waitlist eligibility...');
      waitlistCheck = thresholdService.checkWaitlistEligibility();
      logger.info({
        newlyEligible: waitlistCheck.newlyEligible.length,
        droppedOut: waitlistCheck.droppedOut.length,
      }, 'Waitlist eligibility check completed');

      // Send notifications to newly eligible waitlist members
      for (const registration of waitlistCheck.newlyEligible) {
        try {
          const currentPos = thresholdService.getWalletPosition(registration.walletAddress);
          const currentBgt = currentPos ? currentPos.bgt : 0;

          await notificationService.sendWaitlistEligible(
            registration.discordUserId,
            {
              previousPosition: registration.positionAtRegistration,
              currentPosition: currentPos?.position ?? 69,
              bgt: currentBgt,
            }
          );
          thresholdService.markNotified(registration.id);
        } catch (notifyError) {
          logger.warn({ discordUserId: registration.discordUserId, error: notifyError instanceof Error ? notifyError.message : String(notifyError) }, 'Failed to notify waitlist member');
        }
      }
    } catch (waitlistError) {
      logger.error({ error: waitlistError instanceof Error ? waitlistError.message : String(waitlistError) }, 'Waitlist check error (non-fatal)');
    }

    // 12. Process position and at-risk notifications (v2.1)
    const notificationStats = { position: { sent: 0, skipped: 0, failed: 0 }, atRisk: { sent: 0, skipped: 0, failed: 0 } };
    try {
      logger.info('Processing member notifications...');

      // Process position update notifications
      notificationStats.position = await notificationService.processPositionAlerts();
      logger.info(notificationStats.position, 'Position alerts processed');

      // Identify at-risk members (positions 63-69)
      const atRiskMembers = eligibility
        .filter((e) => e.rank && e.rank >= 63 && e.rank <= 69)
        .map((e, _idx, arr) => {
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
        .filter((m): m is NonNullable<typeof m> => m !== null);

      if (atRiskMembers.length > 0) {
        notificationStats.atRisk = await notificationService.processAtRiskAlerts(atRiskMembers);
        logger.info(notificationStats.atRisk, 'At-risk alerts processed');
      }
    } catch (notificationError) {
      logger.error({ error: notificationError instanceof Error ? notificationError.message : String(notificationError) }, 'Notification processing error (non-fatal)');
    }

    // 13. Process Discord notifications (non-blocking)
    try {
      if (discordService.isConnected()) {
        logger.info('Processing Discord notifications...');
        await discordService.processEligibilityChanges(diff);
        logger.info('Discord notifications processed');
      } else {
        logger.warn('Discord not connected, skipping notifications');
      }
    } catch (discordError) {
      logger.error({ error: discordError instanceof Error ? discordError.message : String(discordError) }, 'Discord notification error (non-fatal)');
    }

    logger.info('Server-side eligibility sync completed successfully');

    // Return summary
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
        entryThreshold: Number(BigInt(thresholdSnapshot.entryThresholdBgt)) / 1e18,
        eligibleCount: thresholdSnapshot.eligibleCount,
        waitlistCount: thresholdSnapshot.waitlistCount,
      } : null,
      waitlist: waitlistCheck ? {
        newlyEligible: waitlistCheck.newlyEligible.length,
        droppedOut: waitlistCheck.droppedOut.length,
      } : null,
      notifications: notificationStats,
      tiers: tierStats.updated > 0 ? tierStats : null,
    };
  } catch (error) {
    // Update health status - failure (in PostgreSQL)
    try {
      await updateHealthStatusFailurePg();
    } catch (healthError) {
      logger.error({ error: healthError instanceof Error ? healthError.message : String(healthError) }, 'Failed to update health status');
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, 'Server-side eligibility sync failed');

    throw error;
  }
}
