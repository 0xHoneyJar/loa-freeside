/**
 * Naib Embed Builders
 *
 * Creates Discord embeds for Naib council display.
 * All displayed data is privacy-filtered (no wallet addresses).
 */

import { EmbedBuilder, type ColorResolvable } from 'discord.js';
import type {
  PublicNaibMember,
  PublicFormerNaib,
} from '../../types/index.js';

/**
 * Colors for Naib embeds
 */
const COLORS = {
  naib: 0xffd700 as ColorResolvable, // Gold for Naib
  formerNaib: 0xc0c0c0 as ColorResolvable, // Silver for Former Naib
};

/**
 * Seat emojis (1-7)
 */
const SEAT_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

/**
 * Format duration from milliseconds to human readable string
 */
function formatDuration(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const remainingDays = days % 365;
    return `${years}y ${remainingDays}d`;
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return `${months}mo ${remainingDays}d`;
  }
  return `${days}d`;
}

/**
 * Build current Naib council embed
 */
export function buildNaibCouncilEmbed(
  members: PublicNaibMember[],
  emptySeats: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.naib)
    .setTitle('👑 Naib Council')
    .setDescription(
      'The 7 members with the highest BGT holdings.\n' +
      'Seats are defended by BGT amount, with tenure as tie-breaker.'
    )
    .setTimestamp();

  if (members.length === 0 && emptySeats === 7) {
    embed.addFields({
      name: 'No Current Naib',
      value: 'All 7 seats are open. Complete onboarding to claim a seat!',
      inline: false,
    });
    return embed;
  }

  // Build member list (already sorted by BGT)
  const memberLines = members.map((member, index) => {
    const seatEmoji = SEAT_EMOJI[index] || `#${index + 1}`;
    const foundingBadge = member.isFounding ? ' 🏛️' : '';
    const seatedDate = member.seatedAt instanceof Date
      ? member.seatedAt
      : new Date(member.seatedAt);
    const tenureDays = Math.floor(
      (Date.now() - seatedDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return `${seatEmoji} **${member.nym}**${foundingBadge}\n` +
           `   └ Rank #${member.rank} • ${tenureDays}d tenure`;
  });

  embed.addFields({
    name: `Active Seats (${members.length}/7)`,
    value: memberLines.join('\n\n') || '_None_',
    inline: false,
  });

  // Show empty seats if any
  if (emptySeats > 0) {
    embed.addFields({
      name: '🪑 Empty Seats',
      value: `${emptySeats} seat${emptySeats > 1 ? 's' : ''} available. ` +
             'Complete onboarding as a top 69 BGT holder to claim!',
      inline: false,
    });
  }

  embed.setFooter({
    text: '🏛️ = Founding Naib (first 7 members)',
  });

  return embed;
}

/**
 * Build former Naib list embed
 */
export function buildFormerNaibEmbed(
  members: PublicFormerNaib[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.formerNaib)
    .setTitle('📜 Former Naib')
    .setDescription(
      'Members who previously held Naib seats. ' +
      'Their service is honored with the Former Naib distinction.'
    )
    .setTimestamp();

  if (members.length === 0) {
    embed.addFields({
      name: 'No Former Naib Yet',
      value: 'No members have been bumped from Naib seats yet.',
      inline: false,
    });
    return embed;
  }

  // Build member list (sorted by total tenure)
  const memberLines = members.map((member, index) => {
    const tenureStr = formatDuration(member.totalTenureMs);
    const lastUnseated = member.lastUnseatedAt instanceof Date
      ? member.lastUnseatedAt
      : new Date(member.lastUnseatedAt);
    const daysSince = Math.floor(
      (Date.now() - lastUnseated.getTime()) / (1000 * 60 * 60 * 24)
    );

    return `${index + 1}. **${member.nym}**\n` +
           `   └ ${tenureStr} total tenure • ${member.seatCount} term${member.seatCount > 1 ? 's' : ''} • left ${daysSince}d ago`;
  });

  // Split into chunks if needed (Discord field limit is 1024 chars)
  const chunkSize = 5;
  for (let i = 0; i < memberLines.length; i += chunkSize) {
    const chunk = memberLines.slice(i, i + chunkSize);
    embed.addFields({
      name: i === 0 ? `Former Members (${members.length})` : '\u200b',
      value: chunk.join('\n\n'),
      inline: false,
    });
  }

  embed.setFooter({
    text: 'Ranked by total time served as Naib',
  });

  return embed;
}

/**
 * Build combined Naib overview embed (for /naib command)
 */
export function buildNaibOverviewEmbed(
  current: PublicNaibMember[],
  former: PublicFormerNaib[],
  emptySeats: number
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLORS.naib)
    .setTitle('👑 Naib Council Overview')
    .setTimestamp();

  // Current Naib summary
  if (current.length > 0) {
    const currentLines = current.slice(0, 7).map((member, index) => {
      const seatEmoji = SEAT_EMOJI[index] || `#${index + 1}`;
      const foundingBadge = member.isFounding ? ' 🏛️' : '';
      return `${seatEmoji} **${member.nym}**${foundingBadge} (Rank #${member.rank})`;
    });

    embed.addFields({
      name: `Current Council (${current.length}/7)`,
      value: currentLines.join('\n'),
      inline: false,
    });
  } else {
    embed.addFields({
      name: 'Current Council (0/7)',
      value: '_All seats empty_',
      inline: false,
    });
  }

  // Empty seats
  if (emptySeats > 0) {
    embed.addFields({
      name: '🪑 Available',
      value: `${emptySeats} seat${emptySeats > 1 ? 's' : ''} open`,
      inline: true,
    });
  }

  // Former Naib summary
  if (former.length > 0) {
    const formerList = former.slice(0, 5).map((m) => m.nym).join(', ');
    const moreCount = former.length > 5 ? ` +${former.length - 5} more` : '';

    embed.addFields({
      name: `📜 Former Naib (${former.length})`,
      value: formerList + moreCount,
      inline: false,
    });
  }

  embed.setDescription(
    'The Naib Council comprises the top 7 BGT holders. ' +
    'Seats can be challenged by newcomers with higher BGT holdings.\n\n' +
    '🏛️ = Founding Naib'
  );

  embed.setFooter({
    text: 'Use /naib current or /naib former for detailed views',
  });

  return embed;
}

/**
 * Build Naib seat detail embed (for viewing a specific seat)
 */
export function buildNaibSeatEmbed(
  member: PublicNaibMember
): EmbedBuilder {
  const seatIndex = member.seatNumber - 1;
  const seatEmoji = SEAT_EMOJI[seatIndex] || `#${member.seatNumber}`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.naib)
    .setTitle(`${seatEmoji} Seat ${member.seatNumber} — ${member.nym}`);

  // Seated date and tenure
  const seatedDate = member.seatedAt instanceof Date
    ? member.seatedAt
    : new Date(member.seatedAt);
  const tenureDays = Math.floor(
    (Date.now() - seatedDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  embed.addFields(
    {
      name: '📊 Rank',
      value: `#${member.rank}`,
      inline: true,
    },
    {
      name: '📅 Tenure',
      value: `${tenureDays} days`,
      inline: true,
    },
    {
      name: '🏛️ Founding',
      value: member.isFounding ? 'Yes' : 'No',
      inline: true,
    }
  );

  embed.setFooter({
    text: `Seated on ${seatedDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`,
  });

  if (member.pfpUrl) {
    embed.setThumbnail(member.pfpUrl);
  }

  return embed;
}
