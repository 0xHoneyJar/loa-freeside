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

import { config, getTierRoleId, getMissingTierRoles } from '../config.js';
import { logger } from '../utils/logger.js';
import { checkRoleUpgrades } from './badge.js';
import { discordService } from './discord.js';
import {
  getMemberProfileById,
  getDatabase,
  logAuditEvent,
} from '../db/queries.js';
import type { Tier } from '../types/index.js';
import { TIER_ORDER } from './TierService.js';

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

// =============================================================================
// Naib Role Management (v2.1 - Sprint 11)
// =============================================================================

/**
 * Assign @Naib role to a member (removes @Fedaykin)
 * Called when a member takes a Naib seat
 */
export async function assignNaibRole(discordUserId: string): Promise<boolean> {
  const naibRoleId = config.discord.roles.naib;
  const fedaykinRoleId = config.discord.roles.fedaykin;

  // Assign @Naib
  const naibSuccess = await discordService.assignRole(discordUserId, naibRoleId);
  if (!naibSuccess) {
    logger.error({ discordUserId }, 'Failed to assign Naib role');
    return false;
  }

  // Remove @Fedaykin (Naib is exclusive)
  await discordService.removeRole(discordUserId, fedaykinRoleId);

  logger.info({ discordUserId }, 'Assigned Naib role, removed Fedaykin');
  logAuditEvent('role_assigned', {
    discordUserId,
    roleName: 'naib',
    reason: 'naib_seat_taken',
  });

  return true;
}

/**
 * Assign @Former Naib role to a member (adds @Fedaykin, removes @Naib)
 * Called when a Naib member is bumped from their seat
 */
export async function assignFormerNaibRole(discordUserId: string): Promise<boolean> {
  const naibRoleId = config.discord.roles.naib;
  const fedaykinRoleId = config.discord.roles.fedaykin;
  const formerNaibRoleId = config.discord.roles.formerNaib;

  // Remove @Naib first
  await discordService.removeRole(discordUserId, naibRoleId);

  // Add @Fedaykin (they're still eligible, just not in top 7)
  const fedaykinSuccess = await discordService.assignRole(discordUserId, fedaykinRoleId);
  if (!fedaykinSuccess) {
    logger.warn({ discordUserId }, 'Failed to assign Fedaykin role to former Naib');
  }

  // Add @Former Naib if configured
  if (formerNaibRoleId) {
    const formerNaibSuccess = await discordService.assignRole(discordUserId, formerNaibRoleId);
    if (!formerNaibSuccess) {
      logger.warn({ discordUserId }, 'Failed to assign Former Naib role (role may not exist)');
    }
  } else {
    logger.debug('Former Naib role not configured, skipping');
  }

  logger.info({ discordUserId }, 'Assigned Former Naib + Fedaykin roles, removed Naib');
  logAuditEvent('role_assigned', {
    discordUserId,
    roleName: 'former_naib',
    reason: 'naib_seat_bumped',
  });

  return true;
}

/**
 * Remove @Naib role from a member (adds @Fedaykin)
 * Called for non-bump demotions (e.g., left server, became ineligible)
 */
export async function removeNaibRole(discordUserId: string): Promise<boolean> {
  const naibRoleId = config.discord.roles.naib;
  const fedaykinRoleId = config.discord.roles.fedaykin;

  // Remove @Naib
  const removeSuccess = await discordService.removeRole(discordUserId, naibRoleId);
  if (!removeSuccess) {
    logger.warn({ discordUserId }, 'Failed to remove Naib role');
  }

  // Add @Fedaykin (if they're still eligible)
  await discordService.assignRole(discordUserId, fedaykinRoleId);

  logger.info({ discordUserId }, 'Removed Naib role, added Fedaykin');
  logAuditEvent('role_removed', {
    discordUserId,
    roleName: 'naib',
    reason: 'naib_seat_lost',
  });

  return true;
}

/**
 * Check if Naib roles are properly configured
 */
export function isNaibRolesConfigured(): boolean {
  return !!(config.discord.roles.naib && config.discord.roles.fedaykin);
}

/**
 * Check if Former Naib role is configured
 */
export function isFormerNaibRoleConfigured(): boolean {
  return !!config.discord.roles.formerNaib;
}

// =============================================================================
// Taqwa Role Management (v2.1 - Sprint 12: Cave Entrance)
// =============================================================================

/**
 * Assign @Taqwa role to a user (waitlist registrant)
 * This role grants access to Cave Entrance channels only
 * Called when a user registers for waitlist alerts
 */
export async function assignTaqwaRole(discordUserId: string): Promise<boolean> {
  const taqwaRoleId = config.discord.roles.taqwa;

  if (!taqwaRoleId) {
    logger.debug('Taqwa role not configured, skipping assignment');
    return false;
  }

  const success = await discordService.assignRole(discordUserId, taqwaRoleId);
  if (!success) {
    logger.warn({ discordUserId }, 'Failed to assign Taqwa role (role may not exist)');
    return false;
  }

  logger.info({ discordUserId }, 'Assigned Taqwa role for waitlist registration');
  logAuditEvent('role_assigned', {
    discordUserId,
    roleName: 'taqwa',
    reason: 'waitlist_registration',
  });

  return true;
}

/**
 * Remove @Taqwa role from a user
 * Called when:
 * - User unregisters from waitlist
 * - User becomes eligible (position <= 69)
 * - User completes onboarding (gets Fedaykin role instead)
 */
export async function removeTaqwaRole(discordUserId: string): Promise<boolean> {
  const taqwaRoleId = config.discord.roles.taqwa;

  if (!taqwaRoleId) {
    logger.debug('Taqwa role not configured, skipping removal');
    return false;
  }

  const success = await discordService.removeRole(discordUserId, taqwaRoleId);
  if (!success) {
    logger.warn({ discordUserId }, 'Failed to remove Taqwa role');
    return false;
  }

  logger.info({ discordUserId }, 'Removed Taqwa role');
  logAuditEvent('role_removed', {
    discordUserId,
    roleName: 'taqwa',
    reason: 'waitlist_exit',
  });

  return true;
}

/**
 * Check if Taqwa role is configured
 */
export function isTaqwaRoleConfigured(): boolean {
  return !!config.discord.roles.taqwa;
}

// =============================================================================
// Tier Role Management (v3.0 - Sprint 16: Tier Integration)
// =============================================================================

/**
 * Sync tier role for a member
 * Role assignment is additive - members accumulate roles as they progress
 * If tier decreases, higher tier roles are removed
 *
 * @param discordUserId - Discord user ID
 * @param newTier - The new tier to sync
 * @param oldTier - Optional previous tier for differential role management
 * @returns Object with assigned and removed role names
 */
export async function syncTierRole(
  discordUserId: string,
  newTier: Tier,
  oldTier?: Tier | null
): Promise<{ assigned: string[]; removed: string[] }> {
  const assigned: string[] = [];
  const removed: string[] = [];

  const newTierIndex = TIER_ORDER.indexOf(newTier);
  const oldTierIndex = oldTier ? TIER_ORDER.indexOf(oldTier) : -1;

  // Get current member roles from Discord
  const member = await discordService.getMemberById(discordUserId);
  if (!member) {
    logger.warn({ discordUserId, newTier }, 'Could not fetch Discord member for tier sync');
    return { assigned: [], removed: [] };
  }

  const currentRoles = member.roles.cache;

  // Assign the new tier role
  const newTierRoleId = getTierRoleId(newTier);
  if (newTierRoleId && !currentRoles.has(newTierRoleId)) {
    const success = await discordService.assignRole(discordUserId, newTierRoleId);
    if (success) {
      assigned.push(newTier);
      logger.info({ discordUserId, tier: newTier }, 'Assigned tier role');
    }
  }

  // Handle tier decrease: remove higher tier roles
  if (oldTier && oldTierIndex > newTierIndex) {
    // Member's tier decreased, remove roles for tiers above new tier
    for (let i = newTierIndex + 1; i <= oldTierIndex; i++) {
      const tierToRemove = TIER_ORDER[i];
      if (!tierToRemove) continue;

      const roleIdToRemove = getTierRoleId(tierToRemove);
      if (roleIdToRemove && currentRoles.has(roleIdToRemove)) {
        const success = await discordService.removeRole(discordUserId, roleIdToRemove);
        if (success) {
          removed.push(tierToRemove);
          logger.info({ discordUserId, tier: tierToRemove }, 'Removed tier role (tier decreased)');
        }
      }
    }
  }

  // Log audit event if any changes
  if (assigned.length > 0 || removed.length > 0) {
    logAuditEvent('tier_role_sync', {
      discordUserId,
      newTier,
      oldTier: oldTier ?? null,
      assigned,
      removed,
    });
  }

  return { assigned, removed };
}

/**
 * Assign all tier roles up to and including the given tier
 * Used for initial tier assignment of existing members
 *
 * @param discordUserId - Discord user ID
 * @param tier - The tier to assign (will also assign all lower tiers)
 * @returns Number of roles assigned
 */
export async function assignTierRolesUpTo(
  discordUserId: string,
  tier: Tier
): Promise<number> {
  const tierIndex = TIER_ORDER.indexOf(tier);
  if (tierIndex === -1) {
    logger.warn({ tier }, 'Unknown tier, cannot assign roles');
    return 0;
  }

  // Get current member roles
  const member = await discordService.getMemberById(discordUserId);
  if (!member) {
    logger.warn({ discordUserId }, 'Could not fetch Discord member for tier role assignment');
    return 0;
  }

  const currentRoles = member.roles.cache;
  let assigned = 0;

  // Assign roles for all tiers up to and including current tier
  // Note: For BGT-based tiers only (not Fedaykin/Naib which are rank-based)
  for (let i = 0; i <= tierIndex; i++) {
    const tierName = TIER_ORDER[i];
    if (!tierName) continue;

    // Skip rank-based tiers in this function - they're handled separately
    if (tierName === 'fedaykin' || tierName === 'naib') {
      continue;
    }

    const roleId = getTierRoleId(tierName);
    if (roleId && !currentRoles.has(roleId)) {
      const success = await discordService.assignRole(discordUserId, roleId);
      if (success) {
        assigned++;
        logger.debug({ discordUserId, tier: tierName }, 'Assigned tier role');
      }
    }
  }

  if (assigned > 0) {
    logger.info({ discordUserId, tier, rolesAssigned: assigned }, 'Assigned tier roles');
    logAuditEvent('tier_roles_assigned', {
      discordUserId,
      tier,
      rolesAssigned: assigned,
      reason: 'tier_assignment',
    });
  }

  return assigned;
}

/**
 * Remove all tier roles from a member
 * Used when a member becomes ineligible
 *
 * @param discordUserId - Discord user ID
 * @returns Number of roles removed
 */
export async function removeAllTierRoles(discordUserId: string): Promise<number> {
  const member = await discordService.getMemberById(discordUserId);
  if (!member) {
    logger.warn({ discordUserId }, 'Could not fetch Discord member for tier role removal');
    return 0;
  }

  const currentRoles = member.roles.cache;
  let removed = 0;

  for (const tierName of TIER_ORDER) {
    const roleId = getTierRoleId(tierName);
    if (roleId && currentRoles.has(roleId)) {
      const success = await discordService.removeRole(discordUserId, roleId);
      if (success) {
        removed++;
        logger.debug({ discordUserId, tier: tierName }, 'Removed tier role');
      }
    }
  }

  if (removed > 0) {
    logger.info({ discordUserId, rolesRemoved: removed }, 'Removed all tier roles');
    logAuditEvent('tier_roles_removed', {
      discordUserId,
      rolesRemoved: removed,
      reason: 'ineligible',
    });
  }

  return removed;
}

/**
 * Check if tier roles are configured
 * Returns true if at least some tier roles are configured
 */
export function isTierRolesConfigured(): boolean {
  const missing = getMissingTierRoles();
  // Consider configured if we have at least naib and fedaykin (the rank-based ones)
  return !missing.includes('naib') && !missing.includes('fedaykin');
}

/**
 * Get list of unconfigured tier roles
 * Useful for admin diagnostics
 */
export function getUnconfiguredTierRoles(): string[] {
  return getMissingTierRoles();
}
