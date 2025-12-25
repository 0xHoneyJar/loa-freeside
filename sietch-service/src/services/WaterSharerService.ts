/**
 * Water Sharer Service (v3.0 - Sprint 17)
 *
 * Manages the Water Sharer badge sharing system.
 *
 * Key Concepts:
 * - Water Sharer badge holders can share their badge with ONE other existing member
 * - This is NOT an invite system - recipients must already be onboarded members
 * - Badge lineage is tracked for audit and cascade revocation purposes
 *
 * Rules:
 * - Granter must have the Water Sharer badge
 * - Granter can only share once (one active grant at a time)
 * - Recipient must be an existing onboarded member
 * - Recipient cannot already have the Water Sharer badge
 * - Recipient can only receive the badge once (ever)
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/queries.js';
import { logger } from '../utils/logger.js';
import { memberHasBadge, getMemberProfileById, getMemberProfileByDiscordId, logAuditEvent } from '../db/queries.js';
import { awardBadge, BADGE_IDS } from './badge.js';
import type { WaterSharerGrant, WaterSharerStatus, MemberProfile } from '../types/index.js';

/**
 * Error codes for Water Sharer operations
 */
export const WATER_SHARER_ERRORS = {
  GRANTER_NOT_FOUND: 'GRANTER_NOT_FOUND',
  GRANTER_NO_BADGE: 'GRANTER_NO_BADGE',
  GRANTER_ALREADY_SHARED: 'GRANTER_ALREADY_SHARED',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  RECIPIENT_NOT_ONBOARDED: 'RECIPIENT_NOT_ONBOARDED',
  RECIPIENT_ALREADY_HAS_BADGE: 'RECIPIENT_ALREADY_HAS_BADGE',
  RECIPIENT_ALREADY_RECEIVED: 'RECIPIENT_ALREADY_RECEIVED',
  CANNOT_SHARE_TO_SELF: 'CANNOT_SHARE_TO_SELF',
  GRANT_NOT_FOUND: 'GRANT_NOT_FOUND',
} as const;

export type WaterSharerError = typeof WATER_SHARER_ERRORS[keyof typeof WATER_SHARER_ERRORS];

/**
 * Result of a share operation
 */
export interface ShareResult {
  success: boolean;
  grant?: WaterSharerGrant;
  error?: WaterSharerError;
  errorMessage?: string;
}

/**
 * Check if a member can share their Water Sharer badge
 *
 * @param memberId - The member ID to check
 * @returns Object with canShare boolean and reason if false
 */
export function canShare(memberId: string): { canShare: boolean; reason?: string } {
  const db = getDatabase();

  // Check if member exists
  const profile = getMemberProfileById(memberId);
  if (!profile) {
    return { canShare: false, reason: 'Member not found' };
  }

  // Check if member has Water Sharer badge
  const hasBadge = memberHasBadge(memberId, BADGE_IDS.waterSharer);
  if (!hasBadge) {
    return { canShare: false, reason: 'You do not have the Water Sharer badge' };
  }

  // Check if member has already shared (has active grant)
  const existingGrant = db.prepare(`
    SELECT id FROM water_sharer_grants
    WHERE granter_member_id = ? AND revoked_at IS NULL
  `).get(memberId) as { id: string } | undefined;

  if (existingGrant) {
    return { canShare: false, reason: 'You have already shared your badge' };
  }

  return { canShare: true };
}

/**
 * Share the Water Sharer badge with another member
 *
 * @param granterMemberId - The member sharing the badge
 * @param recipientMemberId - The member receiving the badge
 * @returns ShareResult with success status and grant or error
 */
export function shareBadge(granterMemberId: string, recipientMemberId: string): ShareResult {
  const db = getDatabase();

  // Cannot share to self
  if (granterMemberId === recipientMemberId) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.CANNOT_SHARE_TO_SELF,
      errorMessage: 'You cannot share the badge with yourself',
    };
  }

  // Validate granter exists
  const granter = getMemberProfileById(granterMemberId);
  if (!granter) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.GRANTER_NOT_FOUND,
      errorMessage: 'Granter member not found',
    };
  }

  // Validate granter has Water Sharer badge
  const granterHasBadge = memberHasBadge(granterMemberId, BADGE_IDS.waterSharer);
  if (!granterHasBadge) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.GRANTER_NO_BADGE,
      errorMessage: 'You do not have the Water Sharer badge',
    };
  }

  // Check if granter has already shared
  const existingGranterGrant = db.prepare(`
    SELECT id FROM water_sharer_grants
    WHERE granter_member_id = ? AND revoked_at IS NULL
  `).get(granterMemberId) as { id: string } | undefined;

  if (existingGranterGrant) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.GRANTER_ALREADY_SHARED,
      errorMessage: 'You have already shared your badge with someone',
    };
  }

  // Validate recipient exists
  const recipient = getMemberProfileById(recipientMemberId);
  if (!recipient) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.RECIPIENT_NOT_FOUND,
      errorMessage: 'Recipient member not found',
    };
  }

  // Validate recipient has completed onboarding
  if (!recipient.onboardingComplete) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.RECIPIENT_NOT_ONBOARDED,
      errorMessage: 'Recipient has not completed onboarding',
    };
  }

  // Check if recipient already has Water Sharer badge
  const recipientHasBadge = memberHasBadge(recipientMemberId, BADGE_IDS.waterSharer);
  if (recipientHasBadge) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.RECIPIENT_ALREADY_HAS_BADGE,
      errorMessage: 'Recipient already has the Water Sharer badge',
    };
  }

  // Check if recipient has ever received the badge (even if revoked)
  const existingRecipientGrant = db.prepare(`
    SELECT id FROM water_sharer_grants
    WHERE recipient_member_id = ?
  `).get(recipientMemberId) as { id: string } | undefined;

  if (existingRecipientGrant) {
    return {
      success: false,
      error: WATER_SHARER_ERRORS.RECIPIENT_ALREADY_RECEIVED,
      errorMessage: 'Recipient has already received this badge from someone else',
    };
  }

  // All validations passed - create the grant
  const grantId = randomUUID();
  const grantedAt = Date.now();

  try {
    db.prepare(`
      INSERT INTO water_sharer_grants (id, granter_member_id, recipient_member_id, granted_at)
      VALUES (?, ?, ?, ?)
    `).run(grantId, granterMemberId, recipientMemberId, grantedAt);

    // Award the badge to the recipient
    const badgeResult = awardBadge(recipientMemberId, BADGE_IDS.waterSharer, {
      awardedBy: granterMemberId,
      reason: `Shared by ${granter.nym} via Water Sharer badge`,
    });

    if (!badgeResult) {
      // This shouldn't happen since we checked, but rollback if it does
      db.prepare(`DELETE FROM water_sharer_grants WHERE id = ?`).run(grantId);
      logger.error(
        { granterMemberId, recipientMemberId },
        'Failed to award Water Sharer badge after creating grant'
      );
      return {
        success: false,
        error: WATER_SHARER_ERRORS.RECIPIENT_ALREADY_HAS_BADGE,
        errorMessage: 'Failed to award badge to recipient',
      };
    }

    // Log audit event
    logAuditEvent('water_sharer_grant', {
      grantId,
      granterMemberId,
      granterNym: granter.nym,
      recipientMemberId,
      recipientNym: recipient.nym,
      grantedAt,
    });

    logger.info(
      { grantId, granterMemberId, granterNym: granter.nym, recipientMemberId, recipientNym: recipient.nym },
      'Water Sharer badge shared successfully'
    );

    const grant: WaterSharerGrant = {
      id: grantId,
      granterMemberId,
      recipientMemberId,
      grantedAt: new Date(grantedAt),
      revokedAt: null,
    };

    return { success: true, grant };
  } catch (error) {
    logger.error({ error, granterMemberId, recipientMemberId }, 'Failed to share Water Sharer badge');
    throw error;
  }
}

/**
 * Get the sharing status for a member
 *
 * @param memberId - The member ID to check
 * @returns WaterSharerStatus with badge and sharing information
 */
export function getShareStatus(memberId: string): WaterSharerStatus | null {
  const db = getDatabase();

  const profile = getMemberProfileById(memberId);
  if (!profile) {
    return null;
  }

  const hasBadge = memberHasBadge(memberId, BADGE_IDS.waterSharer);

  // Check if member has shared their badge
  let sharedWith: WaterSharerStatus['sharedWith'] = null;
  const grantGiven = db.prepare(`
    SELECT wsg.recipient_member_id, wsg.granted_at, mp.nym
    FROM water_sharer_grants wsg
    JOIN member_profiles mp ON mp.member_id = wsg.recipient_member_id
    WHERE wsg.granter_member_id = ? AND wsg.revoked_at IS NULL
  `).get(memberId) as { recipient_member_id: string; granted_at: number; nym: string } | undefined;

  if (grantGiven) {
    sharedWith = {
      memberId: grantGiven.recipient_member_id,
      nym: grantGiven.nym,
      grantedAt: new Date(grantGiven.granted_at),
    };
  }

  // Check if member received badge via sharing
  let receivedFrom: WaterSharerStatus['receivedFrom'] = null;
  const grantReceived = db.prepare(`
    SELECT wsg.granter_member_id, wsg.granted_at, mp.nym
    FROM water_sharer_grants wsg
    JOIN member_profiles mp ON mp.member_id = wsg.granter_member_id
    WHERE wsg.recipient_member_id = ? AND wsg.revoked_at IS NULL
  `).get(memberId) as { granter_member_id: string; granted_at: number; nym: string } | undefined;

  if (grantReceived) {
    receivedFrom = {
      memberId: grantReceived.granter_member_id,
      nym: grantReceived.nym,
      grantedAt: new Date(grantReceived.granted_at),
    };
  }

  // Can share if has badge AND hasn't shared yet
  const canShareBadge = hasBadge && !sharedWith;

  return {
    hasBadge,
    canShare: canShareBadge,
    sharedWith,
    receivedFrom,
  };
}

/**
 * Get share status by Discord ID
 *
 * @param discordUserId - The Discord user ID to check
 * @returns WaterSharerStatus with badge and sharing information
 */
export function getShareStatusByDiscordId(discordUserId: string): WaterSharerStatus | null {
  const profile = getMemberProfileByDiscordId(discordUserId);
  if (!profile) {
    return null;
  }
  return getShareStatus(profile.memberId);
}

/**
 * Get all grants made by a member (for admin/debugging)
 *
 * @param granterMemberId - The member ID to check
 * @returns Array of grants made by this member
 */
export function getGrantsByGranter(granterMemberId: string): WaterSharerGrant[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, granter_member_id, recipient_member_id, granted_at, revoked_at
    FROM water_sharer_grants
    WHERE granter_member_id = ?
    ORDER BY granted_at DESC
  `).all(granterMemberId) as Array<{
    id: string;
    granter_member_id: string;
    recipient_member_id: string;
    granted_at: number;
    revoked_at: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    granterMemberId: row.granter_member_id,
    recipientMemberId: row.recipient_member_id,
    grantedAt: new Date(row.granted_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  }));
}

/**
 * Revoke a Water Sharer grant (admin operation)
 * This will cascade and also revoke any downstream grants
 *
 * @param grantId - The grant ID to revoke
 * @param revokedBy - The admin who revoked (Discord user ID)
 * @returns Number of grants revoked (including cascaded)
 */
export function revokeGrant(grantId: string, revokedBy: string): number {
  const db = getDatabase();
  const revokedAt = Date.now();
  let revokeCount = 0;

  // Get the grant to revoke
  const grant = db.prepare(`
    SELECT id, granter_member_id, recipient_member_id
    FROM water_sharer_grants
    WHERE id = ? AND revoked_at IS NULL
  `).get(grantId) as { id: string; granter_member_id: string; recipient_member_id: string } | undefined;

  if (!grant) {
    return 0;
  }

  // Cascade revocation: find all downstream grants from this recipient
  const cascadeRevoke = (recipientId: string): void => {
    // Find grants given by this recipient
    const downstreamGrants = db.prepare(`
      SELECT id, recipient_member_id
      FROM water_sharer_grants
      WHERE granter_member_id = ? AND revoked_at IS NULL
    `).all(recipientId) as Array<{ id: string; recipient_member_id: string }>;

    for (const downstream of downstreamGrants) {
      // Recursively revoke downstream grants first
      cascadeRevoke(downstream.recipient_member_id);

      // Revoke this grant
      db.prepare(`
        UPDATE water_sharer_grants
        SET revoked_at = ?
        WHERE id = ?
      `).run(revokedAt, downstream.id);

      revokeCount++;

      logger.info(
        { grantId: downstream.id, recipientMemberId: downstream.recipient_member_id },
        'Cascade revoked Water Sharer grant'
      );
    }
  };

  // Start cascade from the recipient of the grant being revoked
  cascadeRevoke(grant.recipient_member_id);

  // Revoke the original grant
  db.prepare(`
    UPDATE water_sharer_grants
    SET revoked_at = ?
    WHERE id = ?
  `).run(revokedAt, grantId);

  revokeCount++;

  // Log audit event
  logAuditEvent('water_sharer_revoke', {
    grantId,
    granterMemberId: grant.granter_member_id,
    recipientMemberId: grant.recipient_member_id,
    revokedBy,
    cascadeCount: revokeCount - 1,
    revokedAt,
  });

  logger.info(
    { grantId, revokedBy, cascadeCount: revokeCount - 1 },
    'Revoked Water Sharer grant with cascade'
  );

  return revokeCount;
}

/**
 * List all active Water Sharer grants (for admin/debugging)
 *
 * @returns Array of all active grants with granter and recipient info
 */
export function listAllActiveGrants(): Array<{
  grant: WaterSharerGrant;
  granter: { memberId: string; nym: string };
  recipient: { memberId: string; nym: string };
}> {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT
      wsg.id, wsg.granter_member_id, wsg.recipient_member_id, wsg.granted_at,
      granter.nym as granter_nym,
      recipient.nym as recipient_nym
    FROM water_sharer_grants wsg
    JOIN member_profiles granter ON granter.member_id = wsg.granter_member_id
    JOIN member_profiles recipient ON recipient.member_id = wsg.recipient_member_id
    WHERE wsg.revoked_at IS NULL
    ORDER BY wsg.granted_at DESC
  `).all() as Array<{
    id: string;
    granter_member_id: string;
    recipient_member_id: string;
    granted_at: number;
    granter_nym: string;
    recipient_nym: string;
  }>;

  return rows.map((row) => ({
    grant: {
      id: row.id,
      granterMemberId: row.granter_member_id,
      recipientMemberId: row.recipient_member_id,
      grantedAt: new Date(row.granted_at),
      revokedAt: null,
    },
    granter: { memberId: row.granter_member_id, nym: row.granter_nym },
    recipient: { memberId: row.recipient_member_id, nym: row.recipient_nym },
  }));
}

/**
 * Get a grant by ID
 *
 * @param grantId - The grant ID to fetch
 * @returns Grant with granter and recipient info, or null if not found
 */
export function getGrantById(grantId: string): {
  grant: WaterSharerGrant;
  granter: { memberId: string; nym: string };
  recipient: { memberId: string; nym: string };
} | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT
      wsg.id, wsg.granter_member_id, wsg.recipient_member_id, wsg.granted_at, wsg.revoked_at,
      granter.nym as granter_nym,
      recipient.nym as recipient_nym
    FROM water_sharer_grants wsg
    JOIN member_profiles granter ON granter.member_id = wsg.granter_member_id
    JOIN member_profiles recipient ON recipient.member_id = wsg.recipient_member_id
    WHERE wsg.id = ?
  `).get(grantId) as {
    id: string;
    granter_member_id: string;
    recipient_member_id: string;
    granted_at: number;
    revoked_at: number | null;
    granter_nym: string;
    recipient_nym: string;
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    grant: {
      id: row.id,
      granterMemberId: row.granter_member_id,
      recipientMemberId: row.recipient_member_id,
      grantedAt: new Date(row.granted_at),
      revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    },
    granter: { memberId: row.granter_member_id, nym: row.granter_nym },
    recipient: { memberId: row.recipient_member_id, nym: row.recipient_nym },
  };
}

/**
 * Get the full badge lineage for a member (who they received from, who they shared to)
 *
 * @param memberId - The member ID to check
 * @returns Lineage tree structure
 */
export function getBadgeLineage(memberId: string): {
  member: { memberId: string; nym: string };
  receivedFrom: { memberId: string; nym: string; grantedAt: Date } | null;
  sharedTo: { memberId: string; nym: string; grantedAt: Date } | null;
} | null {
  const db = getDatabase();

  const profile = getMemberProfileById(memberId);
  if (!profile) {
    return null;
  }

  // Get who this member received from
  let receivedFrom: { memberId: string; nym: string; grantedAt: Date } | null = null;
  const grantReceived = db.prepare(`
    SELECT wsg.granter_member_id, wsg.granted_at, mp.nym
    FROM water_sharer_grants wsg
    JOIN member_profiles mp ON mp.member_id = wsg.granter_member_id
    WHERE wsg.recipient_member_id = ? AND wsg.revoked_at IS NULL
  `).get(memberId) as { granter_member_id: string; granted_at: number; nym: string } | undefined;

  if (grantReceived) {
    receivedFrom = {
      memberId: grantReceived.granter_member_id,
      nym: grantReceived.nym,
      grantedAt: new Date(grantReceived.granted_at),
    };
  }

  // Get who this member shared to
  let sharedTo: { memberId: string; nym: string; grantedAt: Date } | null = null;
  const grantGiven = db.prepare(`
    SELECT wsg.recipient_member_id, wsg.granted_at, mp.nym
    FROM water_sharer_grants wsg
    JOIN member_profiles mp ON mp.member_id = wsg.recipient_member_id
    WHERE wsg.granter_member_id = ? AND wsg.revoked_at IS NULL
  `).get(memberId) as { recipient_member_id: string; granted_at: number; nym: string } | undefined;

  if (grantGiven) {
    sharedTo = {
      memberId: grantGiven.recipient_member_id,
      nym: grantGiven.nym,
      grantedAt: new Date(grantGiven.granted_at),
    };
  }

  return {
    member: { memberId, nym: profile.nym },
    receivedFrom,
    sharedTo,
  };
}
