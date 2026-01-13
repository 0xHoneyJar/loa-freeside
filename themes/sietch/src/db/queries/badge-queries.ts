// =============================================================================
// Badge Queries (Social Layer v2.0)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { Badge, MemberBadge } from '../../types/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Database row shape for badges table
 */
interface BadgeRow {
  badge_id: string;
  name: string;
  description: string;
  category: 'tenure' | 'engagement' | 'contribution' | 'special';
  emoji: string | null;
  auto_criteria_type: 'tenure_days' | 'activity_balance' | 'badge_count' | null;
  auto_criteria_value: number | null;
  display_order: number;
  created_at: string;
}

/**
 * Convert database row to Badge
 */
function rowToBadge(row: BadgeRow): Badge {
  return {
    badgeId: row.badge_id,
    name: row.name,
    description: row.description,
    category: row.category,
    emoji: row.emoji,
    autoCriteriaType: row.auto_criteria_type,
    autoCriteriaValue: row.auto_criteria_value,
    displayOrder: row.display_order,
  };
}

/**
 * Get all badge definitions
 */
export function getAllBadges(): Badge[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM badges ORDER BY category, display_order
  `).all() as BadgeRow[];

  return rows.map(rowToBadge);
}

/**
 * Get badge by ID
 */
export function getBadgeById(badgeId: string): Badge | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM badges WHERE badge_id = ?
  `).get(badgeId) as BadgeRow | undefined;

  return row ? rowToBadge(row) : null;
}

/**
 * Get badges by category
 */
export function getBadgesByCategory(category: Badge['category']): Badge[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM badges WHERE category = ? ORDER BY display_order
  `).all(category) as BadgeRow[];

  return rows.map(rowToBadge);
}

/**
 * Extended badge info with award date for member queries
 */
interface MemberBadgeWithInfo extends Badge {
  awardedAt: Date;
  awardedBy: string | null;
  awardReason: string | null;
}

/**
 * Get all badges for a member (non-revoked)
 */
export function getMemberBadges(memberId: string): MemberBadgeWithInfo[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT b.*, mb.awarded_at, mb.awarded_by, mb.award_reason
    FROM member_badges mb
    JOIN badges b ON mb.badge_id = b.badge_id
    WHERE mb.member_id = ? AND mb.revoked = 0
    ORDER BY b.category, b.display_order
  `).all(memberId) as Array<BadgeRow & {
    awarded_at: string;
    awarded_by: string | null;
    award_reason: string | null;
  }>;

  return rows.map((row) => ({
    ...rowToBadge(row),
    awardedAt: new Date(row.awarded_at),
    awardedBy: row.awarded_by,
    awardReason: row.award_reason,
  }));
}

/**
 * Check if member has a specific badge
 */
export function memberHasBadge(memberId: string, badgeId: string): boolean {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT 1 FROM member_badges
    WHERE member_id = ? AND badge_id = ? AND revoked = 0
  `).get(memberId, badgeId);

  return !!row;
}

/**
 * Award a badge to a member
 */
export function awardBadge(
  memberId: string,
  badgeId: string,
  options: { awardedBy?: string; reason?: string } = {}
): MemberBadge | null {
  const database = getDatabase();

  // Check if badge exists
  const badge = getBadgeById(badgeId);
  if (!badge) {
    logger.warn({ badgeId }, 'Attempted to award non-existent badge');
    return null;
  }

  // Check if already has badge (including revoked - we'll un-revoke)
  const existing = database.prepare(`
    SELECT id, revoked FROM member_badges
    WHERE member_id = ? AND badge_id = ?
  `).get(memberId, badgeId) as { id: number; revoked: number } | undefined;

  if (existing) {
    if (existing.revoked === 0) {
      // Already has active badge
      return null;
    }

    // Un-revoke the badge
    database.prepare(`
      UPDATE member_badges
      SET revoked = 0, revoked_at = NULL, revoked_by = NULL,
          awarded_at = datetime('now'), awarded_by = ?, award_reason = ?
      WHERE id = ?
    `).run(options.awardedBy ?? null, options.reason ?? null, existing.id);

    logger.info({ memberId, badgeId }, 'Re-awarded previously revoked badge');
  } else {
    // Insert new badge
    database.prepare(`
      INSERT INTO member_badges (member_id, badge_id, awarded_by, award_reason)
      VALUES (?, ?, ?, ?)
    `).run(memberId, badgeId, options.awardedBy ?? null, options.reason ?? null);

    logger.info({ memberId, badgeId }, 'Awarded badge');
  }

  // Return the badge record
  const row = database.prepare(`
    SELECT * FROM member_badges
    WHERE member_id = ? AND badge_id = ?
  `).get(memberId, badgeId) as {
    id: number;
    member_id: string;
    badge_id: string;
    awarded_at: string;
    awarded_by: string | null;
    award_reason: string | null;
    revoked: number;
    revoked_at: string | null;
    revoked_by: string | null;
  };

  return {
    id: row.id,
    memberId: row.member_id,
    badgeId: row.badge_id,
    awardedAt: new Date(row.awarded_at),
    awardedBy: row.awarded_by,
    awardReason: row.award_reason,
    revoked: row.revoked === 1,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedBy: row.revoked_by,
  };
}

/**
 * Revoke a badge from a member
 */
export function revokeBadge(
  memberId: string,
  badgeId: string,
  revokedBy: string
): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE member_badges
    SET revoked = 1, revoked_at = datetime('now'), revoked_by = ?
    WHERE member_id = ? AND badge_id = ? AND revoked = 0
  `).run(revokedBy, memberId, badgeId);

  if (result.changes > 0) {
    logger.info({ memberId, badgeId, revokedBy }, 'Revoked badge');
  }

  return result.changes > 0;
}

/**
 * Get count of badges for a member
 */
export function getMemberBadgeCount(memberId: string): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM member_badges
    WHERE member_id = ? AND revoked = 0
  `).get(memberId) as { count: number };

  return row.count;
}
