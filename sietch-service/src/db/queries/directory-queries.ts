// =============================================================================
// Directory Queries (Social Layer v2.0)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { PublicProfile, PublicBadge, DirectoryFilters, DirectoryResult } from '../../types/index.js';
import { calculateTenureCategory } from './profile-queries.js';
import { getPublicProfile } from './profile-queries.js';

/**
 * Database row shape for member_profiles table
 */
interface MemberProfileRow {
  member_id: string;
  discord_user_id: string;
  nym: string;
  bio: string | null;
  pfp_url: string | null;
  pfp_type: 'custom' | 'generated' | 'none';
  tier: 'naib' | 'fedaykin';
  created_at: string;
  updated_at: string;
  nym_last_changed: string | null;
  onboarding_complete: number;
  onboarding_step: number;
}

/**
 * Convert database row to internal profile structure
 */
function rowToMemberProfile(row: MemberProfileRow) {
  return {
    memberId: row.member_id,
    discordUserId: row.discord_user_id,
    nym: row.nym,
    bio: row.bio,
    pfpUrl: row.pfp_url,
    pfpType: row.pfp_type,
    tier: row.tier,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    nymLastChanged: row.nym_last_changed ? new Date(row.nym_last_changed) : null,
    onboardingComplete: row.onboarding_complete === 1,
    onboardingStep: row.onboarding_step,
  };
}

/**
 * Get badges for multiple members in a single query (batch optimization)
 * Avoids N+1 query issue when fetching directory
 */
export function getBatchMemberBadges(memberIds: string[]): Map<string, PublicBadge[]> {
  if (memberIds.length === 0) {
    return new Map();
  }

  const database = getDatabase();

  // Build placeholder string for IN clause
  const placeholders = memberIds.map(() => '?').join(', ');

  const rows = database.prepare(`
    SELECT
      mb.member_id,
      b.badge_id,
      b.name,
      b.description,
      b.category,
      b.emoji,
      mb.awarded_at
    FROM member_badges mb
    JOIN badges b ON mb.badge_id = b.badge_id
    WHERE mb.member_id IN (${placeholders})
      AND mb.revoked = 0
    ORDER BY mb.member_id, b.category, b.display_order
  `).all(...memberIds) as Array<{
    member_id: string;
    badge_id: string;
    name: string;
    description: string;
    category: 'tenure' | 'engagement' | 'contribution' | 'special';
    emoji: string | null;
    awarded_at: string;
  }>;

  // Group badges by member_id
  const badgeMap = new Map<string, PublicBadge[]>();

  // Initialize empty arrays for all members (some may have no badges)
  for (const memberId of memberIds) {
    badgeMap.set(memberId, []);
  }

  for (const row of rows) {
    const badges = badgeMap.get(row.member_id) || [];
    badges.push({
      badgeId: row.badge_id,
      name: row.name,
      description: row.description,
      category: row.category,
      emoji: row.emoji,
      awardedAt: new Date(row.awarded_at),
    });
    badgeMap.set(row.member_id, badges);
  }

  return badgeMap;
}

/**
 * Get member directory with filters and pagination
 * Optimized to use batch badge fetching to avoid N+1 queries
 */
export function getMemberDirectory(filters: DirectoryFilters = {}): DirectoryResult {
  const database = getDatabase();

  const whereClauses: string[] = ['mp.onboarding_complete = 1'];
  const params: unknown[] = [];

  // Filter by tier
  if (filters.tier) {
    whereClauses.push('mp.tier = ?');
    params.push(filters.tier);
  }

  // Filter by badge
  if (filters.badge) {
    whereClauses.push(`
      EXISTS (
        SELECT 1 FROM member_badges mb
        WHERE mb.member_id = mp.member_id
        AND mb.badge_id = ?
        AND mb.revoked = 0
      )
    `);
    params.push(filters.badge);
  }

  // Build ORDER BY clause
  let orderBy = 'mp.created_at DESC'; // Default sort
  switch (filters.sortBy) {
    case 'nym':
      orderBy = `mp.nym ${filters.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
      break;
    case 'tenure':
      orderBy = `mp.created_at ${filters.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
      break;
    case 'badgeCount':
      orderBy = `badge_count ${filters.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
      break;
  }

  // Count total results
  const countRow = database.prepare(`
    SELECT COUNT(*) as total
    FROM member_profiles mp
    WHERE ${whereClauses.join(' AND ')}
  `).get(...params) as { total: number };

  const total = countRow.total;
  const pageSize = filters.pageSize ?? 20;
  const page = filters.page ?? 1;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get paginated results with badge count
  const rows = database.prepare(`
    SELECT
      mp.*,
      COALESCE((
        SELECT COUNT(*) FROM member_badges mb
        WHERE mb.member_id = mp.member_id AND mb.revoked = 0
      ), 0) as badge_count
    FROM member_profiles mp
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<MemberProfileRow & { badge_count: number }>;

  // Batch fetch badges for all members in a single query (avoids N+1)
  const memberIds = rows.map((row) => row.member_id);
  const badgeMap = getBatchMemberBadges(memberIds);

  // Convert to PublicProfile
  const members: PublicProfile[] = rows.map((row) => {
    const badges = badgeMap.get(row.member_id) || [];
    const tenureCategory = calculateTenureCategory(new Date(row.created_at));

    return {
      memberId: row.member_id,
      nym: row.nym,
      bio: row.bio,
      pfpUrl: row.pfp_url,
      pfpType: row.pfp_type,
      tier: row.tier,
      tenureCategory,
      badges,
      badgeCount: row.badge_count,
      memberSince: new Date(row.created_at),
    };
  });

  // Filter by tenure category (post-query since it's computed)
  const filteredMembers = filters.tenureCategory
    ? members.filter((m) => m.tenureCategory === filters.tenureCategory)
    : members;

  return {
    members: filteredMembers,
    total: filters.tenureCategory ? filteredMembers.length : total,
    page,
    pageSize,
    totalPages: filters.tenureCategory
      ? Math.ceil(filteredMembers.length / pageSize)
      : totalPages,
  };
}

/**
 * Get total member count
 */
export function getMemberCount(): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM member_profiles
    WHERE onboarding_complete = 1
  `).get() as { count: number };

  return row.count;
}

/**
 * Get member count by tier
 */
export function getMemberCountByTier(): { naib: number; fedaykin: number } {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tier, COUNT(*) as count
    FROM member_profiles
    WHERE onboarding_complete = 1
    GROUP BY tier
  `).all() as Array<{ tier: 'naib' | 'fedaykin'; count: number }>;

  const counts = { naib: 0, fedaykin: 0 };
  for (const row of rows) {
    counts[row.tier] = row.count;
  }

  return counts;
}

/**
 * Search members by nym (partial match, case-insensitive)
 */
export function searchMembersByNym(query: string, limit: number = 10): PublicProfile[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM member_profiles
    WHERE nym LIKE ? COLLATE NOCASE
    AND onboarding_complete = 1
    ORDER BY nym ASC
    LIMIT ?
  `).all(`%${query}%`, limit) as MemberProfileRow[];

  return rows.map((row) => {
    const profile = rowToMemberProfile(row);
    return getPublicProfile(profile.memberId)!;
  });
}
