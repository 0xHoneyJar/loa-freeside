/**
 * Position Embed Builders
 *
 * Builds embeds for /position command responses.
 */

import {
  type DiscordEmbed,
  Colors,
  formatBgt,
  createEmbed,
} from './common.js';

/**
 * Position status data
 */
export interface PositionStatusData {
  position: number;
  bgt: number;
  distanceToAbove: number | null;
  distanceToBelow: number | null;
  distanceToEntry: number | null;
  isNaib: boolean;
  isFedaykin: boolean;
  isAtRisk: boolean;
}

/**
 * Build position status embed
 */
export function buildPositionStatusEmbed(data: PositionStatusData): DiscordEmbed {
  const fields: DiscordEmbed['fields'] = [];

  // Determine color based on status
  let color: number;
  if (data.isNaib) {
    color = Colors.GOLD;
  } else if (data.isAtRisk) {
    color = Colors.ORANGE;
  } else if (data.isFedaykin) {
    color = Colors.BLUE;
  } else {
    color = Colors.BROWN;
  }

  // Status line
  let status = '';
  if (data.isNaib) {
    status = '\ud83d\udc51 **Naib** - Top 7 seat holder';
  } else if (data.isAtRisk) {
    status = '\u26a0\ufe0f **At Risk** - Bottom 10% of eligible';
  } else if (data.isFedaykin) {
    status = '\u2694\ufe0f **Fedaykin** - Eligible member';
  } else {
    status = '\u23f3 **Waiting Pool** - Not yet eligible';
  }

  // Position and BGT
  fields.push({
    name: '\ud83d\udcca Position',
    value: `**#${data.position}**`,
    inline: true,
  });

  fields.push({
    name: '\ud83d\udcb0 BGT Holdings',
    value: `**${formatBgt(data.bgt)}** BGT`,
    inline: true,
  });

  // Spacer
  fields.push({ name: '\u200b', value: '\u200b', inline: true });

  // Distances
  if (data.distanceToAbove !== null) {
    fields.push({
      name: '\u2b06\ufe0f To Move Up',
      value: `+**${formatBgt(data.distanceToAbove)}** BGT`,
      inline: true,
    });
  }

  if (data.distanceToBelow !== null) {
    fields.push({
      name: '\u2b07\ufe0f Buffer',
      value: `**${formatBgt(data.distanceToBelow)}** BGT`,
      inline: true,
    });
  }

  if (data.distanceToEntry !== null && !data.isFedaykin) {
    fields.push({
      name: '\ud83d\udeaa To Entry',
      value: `+**${formatBgt(data.distanceToEntry)}** BGT`,
      inline: true,
    });
  }

  return createEmbed({
    title: '\ud83d\udccd Your Position',
    description: status,
    color,
    fields,
    footer: 'Use /alerts to manage position notifications',
  });
}
