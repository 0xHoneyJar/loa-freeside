// =============================================================================
// Tier System Queries (v3.0 - Sprint 15: Tier Foundation)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { TierHistoryEntry, TierDistribution, MemberProfile, Tier } from '../../types/index.js';

/**
 * Database row for tier_history table
 */
interface TierHistoryRow {
  id: number;
  member_id: string;
  old_tier: string | null;
  new_tier: string;
  bgt_at_change: string;
  rank_at_change: number | null;
  changed_at: string;
}

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
 * Convert tier history row to TierHistoryEntry
 */
function rowToTierHistoryEntry(row: TierHistoryRow): TierHistoryEntry {
  return {
    id: row.id,
    memberId: row.member_id,
    oldTier: row.old_tier as Tier | null,
    newTier: row.new_tier as Tier,
    bgtAtChange: row.bgt_at_change,
    rankAtChange: row.rank_at_change,
    changedAt: new Date(row.changed_at),
  };
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
 * Update member's tier in member_profiles
 *
 * @param memberId - Member ID
 * @param newTier - New tier
 */
export function updateMemberTier(memberId: string, newTier: string): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE member_profiles
    SET tier = ?,
        tier_updated_at = datetime('now')
    WHERE member_id = ?
  `).run(newTier, memberId);
}

/**
 * Insert tier change record into tier_history
 *
 * @param memberId - Member ID
 * @param oldTier - Previous tier (null for initial assignment)
 * @param newTier - New tier
 * @param bgtAtChange - BGT holdings at time of change (wei as string)
 * @param rankAtChange - Eligibility rank at time of change
 * @returns Inserted record ID
 */
export function insertTierHistory(
  memberId: string,
  oldTier: string | null,
  newTier: string,
  bgtAtChange: string,
  rankAtChange: number | null
): number {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO tier_history (member_id, old_tier, new_tier, bgt_at_change, rank_at_change)
    VALUES (?, ?, ?, ?, ?)
  `).run(memberId, oldTier, newTier, bgtAtChange, rankAtChange);

  return result.lastInsertRowid as number;
}

/**
 * Get tier history for a specific member
 *
 * @param memberId - Member ID
 * @returns Array of tier history entries
 */
export function getTierHistory(memberId: string): TierHistoryEntry[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM tier_history
    WHERE member_id = ?
    ORDER BY changed_at DESC
  `).all(memberId) as TierHistoryRow[];

  return rows.map(rowToTierHistoryEntry);
}

/**
 * Get recent tier changes across all members
 *
 * @param limit - Maximum number of records to return
 * @returns Array of tier history entries
 */
export function getRecentTierChanges(limit: number = 50): TierHistoryEntry[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM tier_history
    ORDER BY changed_at DESC
    LIMIT ?
  `).all(limit) as TierHistoryRow[];

  return rows.map(rowToTierHistoryEntry);
}

/**
 * Get tier distribution (count of members in each tier)
 *
 * @returns Object with tier counts
 */
export function getTierDistribution(): TierDistribution {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tier, COUNT(*) as count
    FROM member_profiles
    WHERE onboarding_complete = 1
    GROUP BY tier
  `).all() as Array<{ tier: string; count: number }>;

  // Initialize all tiers to 0
  const distribution: TierDistribution = {
    hajra: 0,
    ichwan: 0,
    qanat: 0,
    sihaya: 0,
    mushtamal: 0,
    sayyadina: 0,
    usul: 0,
    fedaykin: 0,
    naib: 0,
  };

  // Populate with actual counts
  for (const row of rows) {
    distribution[row.tier as keyof typeof distribution] = row.count;
  }

  return distribution;
}

/**
 * Get tier changes within a date range
 * Useful for weekly digest and analytics
 *
 * @param startDate - Start date (ISO string or Date)
 * @param endDate - End date (ISO string or Date)
 * @returns Array of tier history entries
 */
export function getTierChangesInDateRange(
  startDate: string | Date,
  endDate: string | Date
): TierHistoryEntry[] {
  const database = getDatabase();

  const startStr = startDate instanceof Date ? startDate.toISOString() : startDate;
  const endStr = endDate instanceof Date ? endDate.toISOString() : endDate;

  const rows = database.prepare(`
    SELECT * FROM tier_history
    WHERE changed_at >= ? AND changed_at <= ?
    ORDER BY changed_at DESC
  `).all(startStr, endStr) as TierHistoryRow[];

  return rows.map(rowToTierHistoryEntry);
}

/**
 * Count tier promotions within a date range
 * A promotion is when new_tier is higher in TIER_ORDER than old_tier
 *
 * @param startDate - Start date (ISO string or Date)
 * @param endDate - End date (ISO string or Date)
 * @returns Count of promotions
 */
export function countTierPromotions(
  startDate: string | Date,
  endDate: string | Date
): number {
  const database = getDatabase();

  const startStr = startDate instanceof Date ? startDate.toISOString() : startDate;
  const endStr = endDate instanceof Date ? endDate.toISOString() : endDate;

  const result = database.prepare(`
    SELECT COUNT(*) as count
    FROM tier_history
    WHERE changed_at >= ? AND changed_at <= ?
      AND old_tier IS NOT NULL
  `).get(startStr, endStr) as { count: number };

  return result.count;
}

/**
 * Get members by tier
 *
 * @param tier - Tier to filter by
 * @returns Array of member profiles
 */
export function getMembersByTier(tier: string): MemberProfile[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM member_profiles
    WHERE tier = ? AND onboarding_complete = 1
    ORDER BY tier_updated_at DESC
  `).all(tier) as MemberProfileRow[];

  return rows.map(rowToMemberProfile);
}
