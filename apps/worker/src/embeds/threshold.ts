/**
 * Threshold Embed Builders
 *
 * Builds embeds for /threshold command responses.
 */

import {
  type DiscordEmbed,
  Colors,
  formatBgt,
  createEmbed,
} from './common.js';

/**
 * Threshold data structure
 */
export interface ThresholdData {
  entryThreshold: number;
  eligibleCount: number;
  waitlistCount: number;
  gapToEntry: number | null;
  updatedAt: Date;
}

/**
 * Waitlist position data
 */
export interface WaitlistPosition {
  position: number;
  addressDisplay: string;
  bgt: number;
  distanceToEntry: number;
  isRegistered: boolean;
}

/**
 * Build threshold embed
 */
export function buildThresholdEmbed(
  data: ThresholdData,
  topWaitlist: WaitlistPosition[]
): DiscordEmbed {
  const fields: DiscordEmbed['fields'] = [];

  // Entry threshold field
  fields.push({
    name: '\ud83d\udeaa Entry Requirement',
    value: `**${formatBgt(data.entryThreshold)} BGT**\nPosition #69 threshold`,
    inline: true,
  });

  // Statistics field
  fields.push({
    name: '\ud83d\udcca Statistics',
    value: `Eligible: **${data.eligibleCount}** members\nWaiting: **${data.waitlistCount}** positions`,
    inline: true,
  });

  // Gap to entry (if applicable)
  if (data.gapToEntry !== null && data.gapToEntry > 0) {
    fields.push({
      name: '\ud83d\udccf Gap to Entry',
      value: `**${formatBgt(data.gapToEntry)} BGT**\nDistance from #70 to entry`,
      inline: true,
    });
  }

  // Top waitlist positions
  if (topWaitlist.length > 0) {
    const waitlistLines = topWaitlist.map((pos) => {
      const registered = pos.isRegistered ? ' \ud83d\udcec' : '';
      return (
        `**#${pos.position}** ${pos.addressDisplay}${registered}\n` +
        `\u2514 ${formatBgt(pos.bgt)} BGT \u2022 +${formatBgt(pos.distanceToEntry)} to entry`
      );
    });

    fields.push({
      name: '\u23f3 Waiting Pool (Top 5)',
      value: waitlistLines.join('\n\n'),
      inline: false,
    });
  } else {
    fields.push({
      name: '\u23f3 Waiting Pool',
      value: 'No wallets currently in positions 70-100',
      inline: false,
    });
  }

  return createEmbed({
    title: '\u26e9\ufe0f The Threshold',
    description:
      'The entry requirements for joining the Sietch. ' +
      'Those who hold sufficient BGT may pass through and join the Fedaykin.',
    color: Colors.BROWN,
    fields,
    footer: '\ud83d\udcec = Registered for alerts \u2022 Use /register-waitlist to sign up',
  });
}
