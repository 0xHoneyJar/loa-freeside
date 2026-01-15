/**
 * Common embed utilities for Worker command handlers
 *
 * These embeds are built as plain objects (not discord.js EmbedBuilder)
 * since Worker uses the Discord REST API directly.
 */

/**
 * Discord embed structure
 */
export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
    icon_url?: string;
  };
  thumbnail?: {
    url: string;
  };
  timestamp?: string;
}

// Sietch brand colors
export const Colors = {
  GOLD: 0xd4af37,
  SILVER: 0xc0c0c0,
  BLUE: 0x4169e1,
  GREEN: 0x2e8b57,
  ORANGE: 0xff8c00,
  RED: 0xdc143c,
  PURPLE: 0x9b59b6,
  BROWN: 0x8b4513,
  AQUA: 0x00d4ff,
} as const;

/**
 * Format BGT amount for display
 */
export function formatBgt(amount: number): string {
  if (amount >= 1000) {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (amount >= 1) {
    return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return amount.toFixed(6);
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Create a basic embed with standard fields
 */
export function createEmbed(options: {
  title: string;
  description?: string;
  color: number;
  fields?: DiscordEmbed['fields'];
  footer?: string;
  thumbnail?: string;
  timestamp?: boolean;
}): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: options.title,
    color: options.color,
  };

  // Add timestamp if requested (default: true)
  if (options.timestamp !== false) {
    embed.timestamp = new Date().toISOString();
  }

  if (options.description) {
    embed.description = options.description;
  }

  if (options.fields && options.fields.length > 0) {
    embed.fields = options.fields;
  }

  if (options.footer) {
    embed.footer = { text: options.footer };
  }

  if (options.thumbnail) {
    embed.thumbnail = { url: options.thumbnail };
  }

  return embed;
}

/**
 * Create an error embed
 */
export function createErrorEmbed(message: string): DiscordEmbed {
  return createEmbed({
    title: 'Error',
    description: message,
    color: Colors.RED,
  });
}

/**
 * Create a success embed
 */
export function createSuccessEmbed(message: string): DiscordEmbed {
  return createEmbed({
    title: 'Success',
    description: message,
    color: Colors.GREEN,
  });
}
