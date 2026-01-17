/**
 * Authorization utilities for Discord permission checks
 *
 * Sprint SEC-1: Critical & High Priority Security Fixes
 * Finding H-2: Admin commands lack server-side authorization
 *
 * Discord permissions are sent as a string representation of a bitfield.
 * We verify the ADMINISTRATOR bit (0x8) server-side rather than trusting
 * that Discord's client-side checks were applied.
 */

import type { DiscordEventPayload } from '../types.js';

/**
 * Discord permission flags
 * @see https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
 */
export const DiscordPermissions = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,        // 0x8
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

/**
 * Extract member permissions from a Discord event payload
 *
 * @param payload - The Discord event payload
 * @returns The permissions as a bigint, or 0n if not available
 */
export function getMemberPermissions(payload: DiscordEventPayload): bigint {
  // Permissions come from data.member.permissions as a string
  const member = payload.data?.['member'] as { permissions?: string } | undefined;
  const permissionString = member?.permissions;

  if (!permissionString || typeof permissionString !== 'string') {
    return 0n;
  }

  try {
    return BigInt(permissionString);
  } catch {
    // Invalid permission string
    return 0n;
  }
}

/**
 * Check if a permission bitfield includes a specific permission
 *
 * @param permissions - The permission bitfield
 * @param permission - The permission to check for
 * @returns True if the permission is present
 */
export function hasPermission(permissions: bigint, permission: bigint): boolean {
  return (permissions & permission) === permission;
}

/**
 * Check if a Discord event payload has administrator permissions
 *
 * @param payload - The Discord event payload
 * @returns True if the user has administrator permissions
 */
export function hasAdministratorPermission(payload: DiscordEventPayload): boolean {
  const permissions = getMemberPermissions(payload);
  return hasPermission(permissions, DiscordPermissions.ADMINISTRATOR);
}

/**
 * Check if a Discord event payload has any of the specified permissions
 *
 * @param payload - The Discord event payload
 * @param requiredPermissions - Array of permission flags to check
 * @returns True if the user has any of the specified permissions
 */
export function hasAnyPermission(
  payload: DiscordEventPayload,
  requiredPermissions: bigint[]
): boolean {
  const permissions = getMemberPermissions(payload);

  // Administrator always grants all permissions
  if (hasPermission(permissions, DiscordPermissions.ADMINISTRATOR)) {
    return true;
  }

  return requiredPermissions.some(perm => hasPermission(permissions, perm));
}

/**
 * Check if a Discord event payload has all of the specified permissions
 *
 * @param payload - The Discord event payload
 * @param requiredPermissions - Array of permission flags to check
 * @returns True if the user has all of the specified permissions
 */
export function hasAllPermissions(
  payload: DiscordEventPayload,
  requiredPermissions: bigint[]
): boolean {
  const permissions = getMemberPermissions(payload);

  // Administrator always grants all permissions
  if (hasPermission(permissions, DiscordPermissions.ADMINISTRATOR)) {
    return true;
  }

  return requiredPermissions.every(perm => hasPermission(permissions, perm));
}

/**
 * Authorization result for use in handlers
 */
export interface AuthorizationResult {
  authorized: boolean;
  reason?: string;
}

/**
 * Require administrator permission, returning a result object
 *
 * @param payload - The Discord event payload
 * @returns Authorization result with reason if unauthorized
 */
export function requireAdministrator(payload: DiscordEventPayload): AuthorizationResult {
  if (hasAdministratorPermission(payload)) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: 'This command requires Administrator permissions.',
  };
}
