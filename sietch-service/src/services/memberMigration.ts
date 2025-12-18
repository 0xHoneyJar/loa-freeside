/**
 * Member Migration Service
 *
 * Handles prompting v1.0 members who have placeholder profiles to complete onboarding.
 * Sends DM notifications to pending members with instructions to use /profile command.
 */

import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { discordService } from './discord.js';
import { getDatabase, logAuditEvent } from '../db/queries.js';

/**
 * Get members who have placeholder profiles (haven't completed onboarding)
 */
export function getPendingMigrationMembers(): Array<{
  memberId: string;
  discordUserId: string;
  nym: string;
  tier: 'naib' | 'fedaykin';
  createdAt: Date;
}> {
  const database = getDatabase();

  const rows = database
    .prepare(
      `
    SELECT member_id, discord_user_id, nym, tier, created_at
    FROM member_profiles
    WHERE onboarding_complete = 0
      AND nym LIKE 'Member_%'
    ORDER BY created_at ASC
  `
    )
    .all() as Array<{
    member_id: string;
    discord_user_id: string;
    nym: string;
    tier: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    memberId: row.member_id,
    discordUserId: row.discord_user_id,
    nym: row.nym,
    tier: row.tier as 'naib' | 'fedaykin',
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Build the migration prompt embed
 */
function buildMigrationPromptEmbed(tier: 'naib' | 'fedaykin'): EmbedBuilder {
  const tierName = tier === 'naib' ? 'Naib' : 'Fedaykin';
  const tierEmoji = tier === 'naib' ? '👑' : '⚔️';

  return new EmbedBuilder()
    .setTitle(`${tierEmoji} Welcome to Sietch v2.0!`)
    .setDescription(
      `You've been verified as a **${tierName}** in the Sietch community.\n\n` +
        `To unlock the full social layer experience, please complete your profile setup.`
    )
    .addFields(
      {
        name: 'What\'s New in v2.0',
        value:
          '• **Pseudonymous Profiles** - Choose a unique nym\n' +
          '• **Profile Pictures** - Upload or generate an avatar\n' +
          '• **Badges** - Earn recognition for activity and tenure\n' +
          '• **Directory** - Browse community members\n' +
          '• **Leaderboard** - See top contributors',
      },
      {
        name: 'Complete Setup',
        value:
          'Use the `/profile` command in any Sietch channel to start your profile setup.',
      },
      {
        name: 'Privacy First',
        value:
          'Your wallet address will **never** be publicly linked to your nym. ' +
          'Your identity in Sietch is pseudonymous.',
      }
    )
    .setColor(tier === 'naib' ? 0xf5a623 : 0x3498db)
    .setFooter({ text: 'Sietch Social Layer v2.0' })
    .setTimestamp();
}

/**
 * Send migration prompt to a single member
 */
export async function sendMigrationPrompt(
  discordUserId: string,
  tier: 'naib' | 'fedaykin'
): Promise<boolean> {
  const member = await discordService.getMemberById(discordUserId);
  if (!member) {
    logger.warn({ discordUserId }, 'Could not find Discord member for migration prompt');
    return false;
  }

  const embed = buildMigrationPromptEmbed(tier);

  const success = await discordService.sendDMWithFallback(member.user, {
    embeds: [embed],
  });

  if (success) {
    logAuditEvent('migration_prompt_sent', { discordUserId, tier });
    logger.info({ discordUserId }, 'Sent migration prompt');
  } else {
    logger.warn({ discordUserId }, 'Failed to send migration prompt');
  }

  return success;
}

/**
 * Run migration prompt task
 * Sends DMs to members who haven't completed onboarding
 * Limits to avoid Discord rate limits (max 10 per run)
 */
export async function runMigrationPromptTask(): Promise<{
  totalPending: number;
  prompted: number;
  failed: number;
}> {
  const pendingMembers = getPendingMigrationMembers();

  if (pendingMembers.length === 0) {
    logger.info('No pending migration members to prompt');
    return { totalPending: 0, prompted: 0, failed: 0 };
  }

  // Limit to 10 per run to avoid rate limits
  const toPrompt = pendingMembers.slice(0, 10);

  let prompted = 0;
  let failed = 0;

  for (const member of toPrompt) {
    try {
      const success = await sendMigrationPrompt(member.discordUserId, member.tier);
      if (success) {
        prompted++;
      } else {
        failed++;
      }

      // Small delay between DMs to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error({ error, discordUserId: member.discordUserId }, 'Error sending migration prompt');
      failed++;
    }
  }

  logger.info(
    {
      totalPending: pendingMembers.length,
      prompted,
      failed,
    },
    'Completed migration prompt task'
  );

  return {
    totalPending: pendingMembers.length,
    prompted,
    failed,
  };
}

/**
 * Get migration status summary
 */
export function getMigrationStatus(): {
  totalPlaceholder: number;
  completedOnboarding: number;
  pendingOnboarding: number;
} {
  const database = getDatabase();

  const stats = database
    .prepare(
      `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN onboarding_complete = 1 THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN onboarding_complete = 0 AND nym LIKE 'Member_%' THEN 1 ELSE 0 END) as placeholder
    FROM member_profiles
  `
    )
    .get() as { total: number; completed: number; placeholder: number };

  return {
    totalPlaceholder: stats.placeholder,
    completedOnboarding: stats.completed,
    pendingOnboarding: stats.placeholder,
  };
}
