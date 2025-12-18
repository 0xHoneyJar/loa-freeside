/**
 * Role Manager Service
 *
 * Handles automatic Discord role assignment/removal based on badges and tenure.
 *
 * Dynamic Roles:
 * - @Engaged: 5+ badges OR activity balance > 200
 * - @Veteran: 90+ days tenure
 * - @Trusted: 10+ badges OR has Helper badge
 * - @Onboarded: Completed onboarding flow
 *
 * Role check runs:
 * - On badge award
 * - On onboarding completion
 * - Periodically via scheduled task (daily)
 */

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { checkRoleUpgrades } from './badge.js';
import { discordService } from './discord.js';
import {
  getMemberProfileById,
  getDatabase,
  logAuditEvent,
} from '../db/queries.js';

/**
 * Role ID mapping from config
 */
function getRoleId(roleName: string): string | undefined {
  switch (roleName) {
    case 'engaged':
      return config.discord.roles.engaged;
    case 'veteran':
      return config.discord.roles.veteran;
    case 'trusted':
      return config.discord.roles.trusted;
    case 'onboarded':
      return config.discord.roles.onboarded;
    default:
      return undefined;
  }
}

/**
 * Check if dynamic roles are configured
 */
export function isDynamicRolesEnabled(): boolean {
  const { engaged, veteran, trusted, onboarded } = config.discord.roles;
  return !!(engaged || veteran || trusted || onboarded);
}

/**
 * Sync roles for a single member
 * Returns object with assigned and removed roles
 */
export async function syncMemberRoles(
  memberId: string
): Promise<{ assigned: string[]; removed: string[] }> {
  const profile = getMemberProfileById(memberId);
  if (!profile || !profile.onboardingComplete) {
    return { assigned: [], removed: [] };
  }

  const discordUserId = profile.discordUserId;
  const qualifiedRoles = checkRoleUpgrades(memberId);

  const assigned: string[] = [];
  const removed: string[] = [];

  // Get current member roles from Discord
  const member = await discordService.getMemberById(discordUserId);
  if (!member) {
    logger.warn({ memberId, discordUserId }, 'Could not fetch Discord member for role sync');
    return { assigned: [], removed: [] };
  }

  const currentRoles = member.roles.cache;

  // Check each dynamic role
  const dynamicRoles = ['engaged', 'veteran', 'trusted'] as const;

  for (const roleName of dynamicRoles) {
    const roleId = getRoleId(roleName);
    if (!roleId) continue; // Role not configured

    const hasRole = currentRoles.has(roleId);
    const qualifies = qualifiedRoles.includes(roleName);

    if (qualifies && !hasRole) {
      // Assign role
      const success = await discordService.assignRole(discordUserId, roleId);
      if (success) {
        assigned.push(roleName);
        logger.info({ memberId, discordUserId, roleName }, 'Assigned dynamic role');
        logAuditEvent('role_assigned', {
          memberId,
          discordUserId,
          roleName,
          reason: 'qualification_met',
        });
      }
    } else if (!qualifies && hasRole && roleName !== 'veteran') {
      // Remove role (except veteran - tenure roles are permanent)
      const success = await discordService.removeRole(discordUserId, roleId);
      if (success) {
        removed.push(roleName);
        logger.info({ memberId, discordUserId, roleName }, 'Removed dynamic role');
        logAuditEvent('role_removed', {
          memberId,
          discordUserId,
          roleName,
          reason: 'qualification_lost',
        });
      }
    }
  }

  return { assigned, removed };
}

/**
 * Assign onboarded role to a member
 * Called after successful onboarding completion
 */
export async function assignOnboardedRole(discordUserId: string): Promise<boolean> {
  const roleId = config.discord.roles.onboarded;
  if (!roleId) {
    logger.debug('Onboarded role not configured, skipping');
    return true; // Not a failure, just not configured
  }

  const success = await discordService.assignRole(discordUserId, roleId);
  if (success) {
    logger.info({ discordUserId }, 'Assigned onboarded role');
    logAuditEvent('role_assigned', {
      discordUserId,
      roleName: 'onboarded',
      reason: 'onboarding_complete',
    });
  }
  return success;
}

/**
 * Run role sync task for all onboarded members (batch operation)
 * Called by scheduled task daily
 */
export async function runRoleSyncTask(): Promise<{
  membersChecked: number;
  rolesAssigned: number;
  rolesRemoved: number;
  rolesByType: Record<string, number>;
}> {
  if (!isDynamicRolesEnabled()) {
    logger.info('Dynamic roles not configured, skipping role sync task');
    return {
      membersChecked: 0,
      rolesAssigned: 0,
      rolesRemoved: 0,
      rolesByType: {},
    };
  }

  const database = getDatabase();

  // Get all onboarded members
  const members = database
    .prepare(
      `
    SELECT member_id FROM member_profiles
    WHERE onboarding_complete = 1
  `
    )
    .all() as Array<{ member_id: string }>;

  let rolesAssigned = 0;
  let rolesRemoved = 0;
  const rolesByType: Record<string, number> = {};

  for (const member of members) {
    try {
      const result = await syncMemberRoles(member.member_id);
      rolesAssigned += result.assigned.length;
      rolesRemoved += result.removed.length;

      for (const role of result.assigned) {
        rolesByType[`assigned_${role}`] = (rolesByType[`assigned_${role}`] ?? 0) + 1;
      }
      for (const role of result.removed) {
        rolesByType[`removed_${role}`] = (rolesByType[`removed_${role}`] ?? 0) + 1;
      }
    } catch (error) {
      logger.error({ error, memberId: member.member_id }, 'Failed to sync roles for member');
    }
  }

  logger.info(
    { membersChecked: members.length, rolesAssigned, rolesRemoved, rolesByType },
    'Completed role sync task'
  );

  return {
    membersChecked: members.length,
    rolesAssigned,
    rolesRemoved,
    rolesByType,
  };
}

/**
 * Sync roles for a member after badge award
 * Should be called whenever a badge is awarded
 */
export async function onBadgeAwarded(memberId: string): Promise<void> {
  if (!isDynamicRolesEnabled()) return;

  try {
    await syncMemberRoles(memberId);
  } catch (error) {
    logger.error({ error, memberId }, 'Failed to sync roles after badge award');
  }
}

/**
 * Sync roles for a member after activity update
 * Should be called periodically or on significant activity changes
 */
export async function onActivityUpdated(memberId: string): Promise<void> {
  if (!isDynamicRolesEnabled()) return;

  try {
    await syncMemberRoles(memberId);
  } catch (error) {
    logger.error({ error, memberId }, 'Failed to sync roles after activity update');
  }
}
