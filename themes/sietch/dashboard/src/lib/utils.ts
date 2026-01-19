import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get Discord avatar URL
 */
export function getAvatarUrl(userId: string, avatarHash: string | null, size = 64): string {
  if (avatarHash) {
    const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
  }
  // Default Discord avatar
  const defaultIndex = (BigInt(userId) >> BigInt(22)) % BigInt(6);
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

/**
 * Get Discord guild icon URL
 */
export function getGuildIconUrl(guildId: string, iconHash: string | null, size = 64): string {
  if (iconHash) {
    const ext = iconHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
  }
  return '';
}

/**
 * Format date for display
 */
export function formatDate(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
