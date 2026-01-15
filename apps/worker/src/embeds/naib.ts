/**
 * Naib Embed Builder
 *
 * Creates Discord embeds for Naib council display.
 * All displayed data is privacy-filtered (no wallet addresses).
 */

import { Colors, createEmbed, type DiscordEmbed } from './common.js';
import type { PublicNaibMember, PublicFormerNaib } from '../data/index.js';

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
): DiscordEmbed {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  if (members.length === 0 && emptySeats === 7) {
    fields.push({
      name: 'No Current Naib',
      value: 'All 7 seats are open. Complete onboarding to claim a seat!',
      inline: false,
    });

    return createEmbed({
      title: '👑 Naib Council',
      description:
        'The 7 members with the highest BGT holdings.\n' +
        'Seats are defended by BGT amount, with tenure as tie-breaker.',
      color: Colors.GOLD,
      fields,
      timestamp: true,
    });
  }

  // Build member list
  const memberLines = members.map((member, index) => {
    const seatEmoji = SEAT_EMOJI[index] ?? `#${index + 1}`;
    const foundingBadge = member.isFounding ? ' 🏛️' : '';
    const seatedDate =
      member.seatedAt instanceof Date ? member.seatedAt : new Date(member.seatedAt);
    const tenureDays = Math.floor((Date.now() - seatedDate.getTime()) / (1000 * 60 * 60 * 24));

    return `${seatEmoji} **${member.nym}**${foundingBadge}\n   └ Rank #${member.rank} • ${tenureDays}d tenure`;
  });

  fields.push({
    name: `Active Seats (${members.length}/7)`,
    value: memberLines.join('\n\n') || '_None_',
    inline: false,
  });

  // Show empty seats if any
  if (emptySeats > 0) {
    fields.push({
      name: '🪑 Empty Seats',
      value:
        `${emptySeats} seat${emptySeats > 1 ? 's' : ''} available. ` +
        'Complete onboarding as a top 69 BGT holder to claim!',
      inline: false,
    });
  }

  return createEmbed({
    title: '👑 Naib Council',
    description:
      'The 7 members with the highest BGT holdings.\n' +
      'Seats are defended by BGT amount, with tenure as tie-breaker.',
    color: Colors.GOLD,
    fields,
    footer: '🏛️ = Founding Naib (first 7 members)',
    timestamp: true,
  });
}

/**
 * Build former Naib list embed
 */
export function buildFormerNaibEmbed(members: PublicFormerNaib[]): DiscordEmbed {
  if (members.length === 0) {
    return createEmbed({
      title: '📜 Former Naib',
      description:
        'Members who previously held Naib seats. ' +
        'Their service is honored with the Former Naib distinction.',
      color: Colors.SILVER,
      fields: [
        {
          name: 'No Former Naib Yet',
          value: 'No members have been bumped from Naib seats yet.',
          inline: false,
        },
      ],
      timestamp: true,
    });
  }

  // Build member list (sorted by total tenure)
  const memberLines = members.map((member, index) => {
    const tenureStr = formatDuration(member.totalTenureMs);
    const lastUnseated =
      member.lastUnseatedAt instanceof Date
        ? member.lastUnseatedAt
        : new Date(member.lastUnseatedAt);
    const daysSince = Math.floor((Date.now() - lastUnseated.getTime()) / (1000 * 60 * 60 * 24));

    return (
      `${index + 1}. **${member.nym}**\n` +
      `   └ ${tenureStr} total tenure • ${member.seatCount} term${member.seatCount > 1 ? 's' : ''} • left ${daysSince}d ago`
    );
  });

  // Split into fields if too many (Discord field limit is 1024 chars)
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  const chunkSize = 5;

  for (let i = 0; i < memberLines.length; i += chunkSize) {
    const chunk = memberLines.slice(i, i + chunkSize);
    fields.push({
      name: i === 0 ? `Former Members (${members.length})` : '\u200b',
      value: chunk.join('\n\n'),
      inline: false,
    });
  }

  return createEmbed({
    title: '📜 Former Naib',
    description:
      'Members who previously held Naib seats. ' +
      'Their service is honored with the Former Naib distinction.',
    color: Colors.SILVER,
    fields,
    footer: 'Ranked by total time served as Naib',
    timestamp: true,
  });
}

/**
 * Build combined Naib overview embed
 */
export function buildNaibOverviewEmbed(
  current: PublicNaibMember[],
  former: PublicFormerNaib[],
  emptySeats: number
): DiscordEmbed {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  // Current Naib summary
  if (current.length > 0) {
    const currentLines = current.slice(0, 7).map((member, index) => {
      const seatEmoji = SEAT_EMOJI[index] ?? `#${index + 1}`;
      const foundingBadge = member.isFounding ? ' 🏛️' : '';
      return `${seatEmoji} **${member.nym}**${foundingBadge} (Rank #${member.rank})`;
    });

    fields.push({
      name: `Current Council (${current.length}/7)`,
      value: currentLines.join('\n'),
      inline: false,
    });
  } else {
    fields.push({
      name: 'Current Council (0/7)',
      value: '_All seats empty_',
      inline: false,
    });
  }

  // Empty seats
  if (emptySeats > 0) {
    fields.push({
      name: '🪑 Available',
      value: `${emptySeats} seat${emptySeats > 1 ? 's' : ''} open`,
      inline: true,
    });
  }

  // Former Naib summary
  if (former.length > 0) {
    const formerList = former
      .slice(0, 5)
      .map((m) => m.nym)
      .join(', ');
    const moreCount = former.length > 5 ? ` +${former.length - 5} more` : '';

    fields.push({
      name: `📜 Former Naib (${former.length})`,
      value: formerList + moreCount,
      inline: false,
    });
  }

  return createEmbed({
    title: '👑 Naib Council Overview',
    description:
      'The Naib Council comprises the top 7 BGT holders. ' +
      'Seats can be challenged by newcomers with higher BGT holdings.\n\n' +
      '🏛️ = Founding Naib',
    color: Colors.GOLD,
    fields,
    footer: 'Use /naib current or /naib former for detailed views',
    timestamp: true,
  });
}
