/**
 * Eligibility Change Processor
 *
 * Processes eligibility changes and triggers appropriate notifications/announcements.
 */

import type { Guild, GuildMember, TextChannel } from 'discord.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';
import { logAuditEvent } from '../../../db/index.js';
import type { EligibilityEntry, EligibilityDiff } from '../../../types/index.js';
import { findMemberByWallet, getTextChannel } from '../operations/index.js';
import { postToChannel } from '../operations/NotificationOps.js';
import {
  buildRemovalDMEmbed,
  buildNaibDemotionDMEmbed,
  buildNaibPromotionDMEmbed,
  buildDepartureAnnouncementEmbed,
  buildNaibDemotionAnnouncementEmbed,
  buildNaibPromotionAnnouncementEmbed,
  buildNewEligibleAnnouncementEmbed,
} from '../embeds/index.js';

/**
 * Process eligibility changes and send notifications
 */
export async function processEligibilityChanges(
  guild: Guild | null,
  diff: EligibilityDiff,
  postLeaderboard: () => Promise<void>
): Promise<void> {
  if (!guild) {
    logger.warn('Cannot process eligibility changes: Discord not connected');
    return;
  }

  const errors: Error[] = [];

  // Get #the-door channel
  const theDoorChannel = await getTextChannel(guild, config.discord.channels.theDoor);

  // Handle removals (most sensitive - DM + announcement)
  for (const entry of diff.removed) {
    try {
      await handleMemberRemoval(guild, entry, theDoorChannel);
    } catch (error) {
      errors.push(error as Error);
      logger.error({ error, address: entry.address }, 'Failed to handle member removal');
    }
  }

  // Handle Naib demotions (DM + announcement)
  for (const entry of diff.demotedFromNaib) {
    try {
      await handleNaibDemotion(guild, entry, theDoorChannel);
    } catch (error) {
      errors.push(error as Error);
      logger.error({ error, address: entry.address }, 'Failed to handle Naib demotion');
    }
  }

  // Handle Naib promotions (DM + announcement)
  for (const entry of diff.promotedToNaib) {
    try {
      await handleNaibPromotion(guild, entry, theDoorChannel);
    } catch (error) {
      errors.push(error as Error);
      logger.error({ error, address: entry.address }, 'Failed to handle Naib promotion');
    }
  }

  // Handle new additions (announcement only - Collab.Land handles actual access)
  for (const entry of diff.added) {
    try {
      await announceNewEligible(entry, theDoorChannel);
    } catch (error) {
      errors.push(error as Error);
      logger.error({ error, address: entry.address }, 'Failed to announce new eligible');
    }
  }

  // Post updated leaderboard
  try {
    await postLeaderboard();
  } catch (error) {
    errors.push(error as Error);
    logger.error({ error }, 'Failed to post leaderboard after changes');
  }

  // Log summary
  logger.info({
    added: diff.added.length,
    removed: diff.removed.length,
    promotedToNaib: diff.promotedToNaib.length,
    demotedFromNaib: diff.demotedFromNaib.length,
    errors: errors.length,
  }, 'Processed eligibility changes');
}

/**
 * Handle member removal (lost eligibility)
 */
async function handleMemberRemoval(
  guild: Guild,
  entry: EligibilityEntry,
  theDoorChannel: TextChannel | null
): Promise<void> {
  const member = await findMemberByWallet(guild, entry.address);

  // Send DM if we can find the member
  if (member) {
    try {
      const dmEmbed = buildRemovalDMEmbed(entry);
      await member.send({ embeds: [dmEmbed] });
      logger.info({ address: entry.address, userId: member.id }, 'Sent removal DM');
    } catch (error) {
      // User may have DMs disabled - log but continue
      logger.warn({ address: entry.address, error }, 'Could not DM removed member (DMs may be disabled)');
    }
  }

  // Post to #the-door
  if (theDoorChannel) {
    const announcementEmbed = buildDepartureAnnouncementEmbed(entry);
    await postToChannel(theDoorChannel, announcementEmbed);
  }

  // Log audit event
  logAuditEvent('member_removed', {
    address: entry.address,
    previousRank: entry.rank,
    reason: 'rank_change',
  });
}

/**
 * Handle Naib demotion (left top 7)
 */
async function handleNaibDemotion(
  guild: Guild,
  entry: EligibilityEntry,
  theDoorChannel: TextChannel | null
): Promise<void> {
  const member = await findMemberByWallet(guild, entry.address);

  // Send DM if we can find the member
  if (member) {
    try {
      const dmEmbed = buildNaibDemotionDMEmbed(entry);
      await member.send({ embeds: [dmEmbed] });
      logger.info({ address: entry.address, userId: member.id }, 'Sent Naib demotion DM');
    } catch (error) {
      logger.warn({ address: entry.address, error }, 'Could not DM demoted Naib (DMs may be disabled)');
    }
  }

  // Post to #the-door
  if (theDoorChannel) {
    const announcementEmbed = buildNaibDemotionAnnouncementEmbed(entry);
    await postToChannel(theDoorChannel, announcementEmbed);
  }

  // Log audit event
  logAuditEvent('naib_demotion', {
    address: entry.address,
    newRank: entry.rank,
  });
}

/**
 * Handle Naib promotion (entered top 7)
 */
async function handleNaibPromotion(
  guild: Guild,
  entry: EligibilityEntry,
  theDoorChannel: TextChannel | null
): Promise<void> {
  const member = await findMemberByWallet(guild, entry.address);

  // Send DM if we can find the member
  if (member) {
    try {
      const dmEmbed = buildNaibPromotionDMEmbed(entry);
      await member.send({ embeds: [dmEmbed] });
      logger.info({ address: entry.address, userId: member.id }, 'Sent Naib promotion DM');
    } catch (error) {
      logger.warn({ address: entry.address, error }, 'Could not DM promoted Naib (DMs may be disabled)');
    }
  }

  // Post to #the-door
  if (theDoorChannel) {
    const announcementEmbed = buildNaibPromotionAnnouncementEmbed(entry);
    await postToChannel(theDoorChannel, announcementEmbed);
  }

  // Log audit event
  logAuditEvent('naib_promotion', {
    address: entry.address,
    newRank: entry.rank,
  });
}

/**
 * Announce new eligible member
 */
async function announceNewEligible(
  entry: EligibilityEntry,
  theDoorChannel: TextChannel | null
): Promise<void> {
  if (theDoorChannel) {
    const announcementEmbed = buildNewEligibleAnnouncementEmbed(entry);
    await postToChannel(theDoorChannel, announcementEmbed);
  }

  // Log audit event
  logAuditEvent('member_added', {
    address: entry.address,
    rank: entry.rank,
    role: entry.role,
  });
}
