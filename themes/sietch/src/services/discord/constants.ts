/**
 * Discord Service Constants and Utilities
 *
 * Shared constants and helper functions for Discord operations.
 */

import type { ColorResolvable } from 'discord.js';

/**
 * Discord embed colors
 */
export const COLORS = {
  GOLD: 0xf5a623 as ColorResolvable, // Naib / Premium
  BLUE: 0x3498db as ColorResolvable, // Fedaykin / Standard
  RED: 0xe74c3c as ColorResolvable, // Removal / Warning
  GREEN: 0x2ecc71 as ColorResolvable, // Success / New member
  PURPLE: 0x9b59b6 as ColorResolvable, // Promotion
  GRAY: 0x95a5a6 as ColorResolvable, // Neutral
};

/**
 * Truncate an Ethereum address for display
 */
export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format BGT amount for display with commas and 2 decimal places
 */
export function formatBGT(amount: bigint): string {
  const value = Number(amount) / 1e18;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Split a string into chunks for Discord field limits (1024 chars)
 */
export function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  const lines = str.split('\n');
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > size) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}
