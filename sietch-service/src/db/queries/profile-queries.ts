// =============================================================================
// Member Profile Queries (Social Layer v2.0)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { MemberProfile, PublicProfile, ProfileUpdateRequest } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { getMemberBadges } from './badge-queries.js';

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
 * Convert database row to MemberProfile
 */
function rowToMemberProfile(row: MemberProfileRow): MemberProfile {
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
 * Create a new member profile
 */
export function createMemberProfile(profile: {
  memberId: string;
  discordUserId: string;
  nym: string;
  tier: 'naib' | 'fedaykin';
  bio?: string | null;
  pfpUrl?: string | null;
  pfpType?: 'custom' | 'generated' | 'none';
}): MemberProfile {
  const database = getDatabase();

  database.prepare(`
    INSERT INTO member_profiles (member_id, discord_user_id, nym, tier, bio, pfp_url, pfp_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.memberId,
    profile.discordUserId,
    profile.nym,
    profile.tier,
    profile.bio ?? null,
    profile.pfpUrl ?? null,
    profile.pfpType ?? 'none'
  );

  // Also create activity record
  database.prepare(`
    INSERT INTO member_activity (member_id)
    VALUES (?)
  `).run(profile.memberId);

  logger.info({ memberId: profile.memberId, nym: profile.nym }, 'Created member profile');

  return getMemberProfileById(profile.memberId)!;
}

/**
 * Get member profile by member ID
 */
export function getMemberProfileById(memberId: string): MemberProfile | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_profiles WHERE member_id = ?
  `).get(memberId) as MemberProfileRow | undefined;

  return row ? rowToMemberProfile(row) : null;
}

/**
 * Get member profile by Discord user ID
 */
export function getMemberProfileByDiscordId(discordUserId: string): MemberProfile | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_profiles WHERE discord_user_id = ?
  `).get(discordUserId) as MemberProfileRow | undefined;

  return row ? rowToMemberProfile(row) : null;
}

/**
 * Get member profile by nym (case-insensitive)
 */
export function getMemberProfileByNym(nym: string): MemberProfile | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_profiles WHERE nym = ? COLLATE NOCASE
  `).get(nym) as MemberProfileRow | undefined;

  return row ? rowToMemberProfile(row) : null;
}

/**
 * Check if a nym is available (case-insensitive)
 */
export function isNymAvailable(nym: string, excludeMemberId?: string): boolean {
  const database = getDatabase();

  let sql = 'SELECT 1 FROM member_profiles WHERE nym = ? COLLATE NOCASE';
  const params: unknown[] = [nym];

  if (excludeMemberId) {
    sql += ' AND member_id != ?';
    params.push(excludeMemberId);
  }

  const row = database.prepare(sql).get(...params);
  return !row;
}

/**
 * Update member profile
 */
export function updateMemberProfile(
  memberId: string,
  updates: ProfileUpdateRequest & {
    tier?: 'naib' | 'fedaykin';
    onboardingComplete?: boolean;
    onboardingStep?: number;
  }
): MemberProfile | null {
  const database = getDatabase();

  const setClauses: string[] = ['updated_at = datetime(\'now\')'];
  const params: unknown[] = [];

  if (updates.nym !== undefined) {
    setClauses.push('nym = ?', 'nym_last_changed = datetime(\'now\')');
    params.push(updates.nym);
  }

  if (updates.bio !== undefined) {
    setClauses.push('bio = ?');
    params.push(updates.bio);
  }

  if (updates.pfpUrl !== undefined) {
    setClauses.push('pfp_url = ?');
    params.push(updates.pfpUrl);
  }

  if (updates.pfpType !== undefined) {
    setClauses.push('pfp_type = ?');
    params.push(updates.pfpType);
  }

  if (updates.tier !== undefined) {
    setClauses.push('tier = ?');
    params.push(updates.tier);
  }

  if (updates.onboardingComplete !== undefined) {
    setClauses.push('onboarding_complete = ?');
    params.push(updates.onboardingComplete ? 1 : 0);
  }

  if (updates.onboardingStep !== undefined) {
    setClauses.push('onboarding_step = ?');
    params.push(updates.onboardingStep);
  }

  params.push(memberId);

  const result = database.prepare(`
    UPDATE member_profiles
    SET ${setClauses.join(', ')}
    WHERE member_id = ?
  `).run(...params);

  if (result.changes === 0) {
    return null;
  }

  logger.info({ memberId, updates: Object.keys(updates) }, 'Updated member profile');
  return getMemberProfileById(memberId);
}

/**
 * Delete member profile (cascades to badges, activity, perks)
 */
export function deleteMemberProfile(memberId: string): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    DELETE FROM member_profiles WHERE member_id = ?
  `).run(memberId);

  if (result.changes > 0) {
    logger.info({ memberId }, 'Deleted member profile');
  }

  return result.changes > 0;
}

/**
 * Calculate tenure category based on membership duration
 */
export function calculateTenureCategory(
  createdAt: Date,
  launchDate: Date = new Date('2025-01-01')
): 'og' | 'veteran' | 'elder' | 'member' {
  const now = new Date();
  const membershipDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  // OG: joined within first 30 days of launch
  const launchWindow = 30;
  const daysAfterLaunch = Math.floor((createdAt.getTime() - launchDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysAfterLaunch <= launchWindow) {
    return 'og';
  }

  if (membershipDays >= 180) {
    return 'elder';
  }

  if (membershipDays >= 90) {
    return 'veteran';
  }

  return 'member';
}

/**
 * Get public profile (privacy-filtered) by member ID
 */
export function getPublicProfile(memberId: string): PublicProfile | null {
  const profile = getMemberProfileById(memberId);
  if (!profile) return null;

  const badges = getMemberBadges(memberId);
  const tenureCategory = calculateTenureCategory(profile.createdAt);

  return {
    memberId: profile.memberId,
    nym: profile.nym,
    bio: profile.bio,
    pfpUrl: profile.pfpUrl,
    pfpType: profile.pfpType,
    tier: profile.tier,
    tenureCategory,
    badges: badges.map((b) => ({
      badgeId: b.badgeId,
      name: b.name,
      description: b.description,
      category: b.category,
      emoji: b.emoji,
      awardedAt: b.awardedAt,
    })),
    badgeCount: badges.length,
    memberSince: profile.createdAt,
  };
}
