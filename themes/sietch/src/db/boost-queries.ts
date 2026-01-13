/**
 * Boost Database Queries (v4.0 - Sprint 28)
 *
 * Database operations for the community boost system:
 * - Boost purchase CRUD operations
 * - Community boost aggregation
 * - Booster listing and lookup
 * - Stats caching
 */

import { randomUUID } from 'crypto';
import { getDatabase } from './connection.js';
import { logger } from '../utils/logger.js';
import type {
  BoostPurchase,
  CreateBoostPurchaseParams,
  Booster,
  BoostLevel,
} from '../types/billing.js';
import { DEFAULT_BOOST_THRESHOLDS } from './migrations/011_boosts.js';

// =============================================================================
// Row Type Definitions
// =============================================================================

interface BoostPurchaseRow {
  id: string;
  member_id: string;
  community_id: string;
  payment_id: string | null;
  months_purchased: number;
  amount_paid_cents: number;
  purchased_at: string;
  expires_at: string;
  is_active: number;
  created_at: string;
}

interface CommunityBoostStatsRow {
  community_id: string;
  total_boosters: number;
  total_boost_months: number;
  current_level: number;
  last_calculated_at: string;
  updated_at: string;
}

interface BoosterAggregateRow {
  member_id: string;
  first_boost: string;
  last_boost: string;
  total_months: number;
  latest_expiry: string | null;
  is_active: number;
}

// =============================================================================
// Row to Object Converters
// =============================================================================

function rowToBoostPurchase(row: BoostPurchaseRow): BoostPurchase {
  return {
    id: row.id,
    memberId: row.member_id,
    communityId: row.community_id,
    paymentId: row.payment_id ?? undefined,
    monthsPurchased: row.months_purchased,
    amountPaidCents: row.amount_paid_cents,
    purchasedAt: new Date(row.purchased_at),
    expiresAt: new Date(row.expires_at),
    isActive: row.is_active === 1,
    createdAt: new Date(row.created_at),
  };
}

function rowToBooster(row: BoosterAggregateRow): Booster {
  return {
    memberId: row.member_id,
    firstBoostDate: new Date(row.first_boost),
    lastBoostDate: new Date(row.last_boost),
    totalMonthsBoosted: row.total_months,
    currentBoostExpiry: row.latest_expiry ? new Date(row.latest_expiry) : undefined,
    isActive: row.is_active === 1,
  };
}

// =============================================================================
// Boost Purchase Queries
// =============================================================================

/**
 * Create a new boost purchase
 */
export function createBoostPurchase(params: CreateBoostPurchaseParams): string {
  const db = getDatabase();
  const id = randomUUID();

  // Calculate expiry date based on months purchased
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + params.monthsPurchased);

  db.prepare(`
    INSERT INTO boost_purchases (
      id, member_id, community_id, payment_id, months_purchased,
      amount_paid_cents, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.memberId,
    params.communityId,
    params.paymentId ?? null,
    params.monthsPurchased,
    params.amountPaidCents,
    expiresAt.toISOString()
  );

  logger.info(
    { id, memberId: params.memberId, communityId: params.communityId, months: params.monthsPurchased },
    'Created boost purchase'
  );

  // Update community stats cache
  updateCommunityBoostStats(params.communityId);

  return id;
}

/**
 * Get boost purchase by ID
 */
export function getBoostPurchaseById(id: string): BoostPurchase | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM boost_purchases WHERE id = ?')
    .get(id) as BoostPurchaseRow | undefined;

  return row ? rowToBoostPurchase(row) : null;
}

/**
 * Get boost purchase by payment ID
 */
export function getBoostPurchaseByPaymentId(paymentId: string): BoostPurchase | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM boost_purchases WHERE payment_id = ?')
    .get(paymentId) as BoostPurchaseRow | undefined;

  return row ? rowToBoostPurchase(row) : null;
}

/**
 * Get all boost purchases for a member in a community
 */
export function getMemberBoostPurchases(
  memberId: string,
  communityId: string
): BoostPurchase[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM boost_purchases
      WHERE member_id = ? AND community_id = ?
      ORDER BY purchased_at DESC
    `)
    .all(memberId, communityId) as BoostPurchaseRow[];

  return rows.map(rowToBoostPurchase);
}

/**
 * Get active boost for a member in a community
 */
export function getMemberActiveBoost(
  memberId: string,
  communityId: string
): BoostPurchase | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT * FROM boost_purchases
      WHERE member_id = ? AND community_id = ?
        AND is_active = 1 AND expires_at > ?
      ORDER BY expires_at DESC
      LIMIT 1
    `)
    .get(memberId, communityId, now) as BoostPurchaseRow | undefined;

  return row ? rowToBoostPurchase(row) : null;
}

/**
 * Check if a member is currently boosting a community
 */
export function isMemberBoosting(memberId: string, communityId: string): boolean {
  return getMemberActiveBoost(memberId, communityId) !== null;
}

/**
 * Extend an existing boost (add months to current expiry)
 */
export function extendMemberBoost(
  memberId: string,
  communityId: string,
  additionalMonths: number,
  amountPaidCents: number,
  paymentId?: string
): string {
  const db = getDatabase();
  const id = randomUUID();

  // Get current active boost to determine expiry base
  const activeBoost = getMemberActiveBoost(memberId, communityId);

  let expiresAt: Date;
  if (activeBoost) {
    // Extend from current expiry
    expiresAt = new Date(activeBoost.expiresAt);
  } else {
    // New boost from now
    expiresAt = new Date();
  }
  expiresAt.setMonth(expiresAt.getMonth() + additionalMonths);

  db.prepare(`
    INSERT INTO boost_purchases (
      id, member_id, community_id, payment_id, months_purchased,
      amount_paid_cents, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    memberId,
    communityId,
    paymentId ?? null,
    additionalMonths,
    amountPaidCents,
    expiresAt.toISOString()
  );

  logger.info(
    { id, memberId, communityId, additionalMonths, newExpiry: expiresAt.toISOString() },
    'Extended member boost'
  );

  // Update community stats cache
  updateCommunityBoostStats(communityId);

  return id;
}

/**
 * Deactivate expired boosts
 * Should be run periodically via a scheduled task
 */
export function deactivateExpiredBoosts(): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db
    .prepare(`
      UPDATE boost_purchases
      SET is_active = 0
      WHERE is_active = 1 AND expires_at <= ?
    `)
    .run(now);

  if (result.changes > 0) {
    logger.info({ count: result.changes }, 'Deactivated expired boosts');
  }

  return result.changes;
}

// =============================================================================
// Community Boost Aggregation Queries
// =============================================================================

/**
 * Get count of active boosters for a community
 */
export function getActiveBoosterCount(communityId: string): number {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db
    .prepare(`
      SELECT COUNT(DISTINCT member_id) as count
      FROM boost_purchases
      WHERE community_id = ? AND is_active = 1 AND expires_at > ?
    `)
    .get(communityId, now) as { count: number };

  return result.count;
}

/**
 * Get total boost months for a community
 */
export function getTotalBoostMonths(communityId: string): number {
  const db = getDatabase();

  const result = db
    .prepare(`
      SELECT COALESCE(SUM(months_purchased), 0) as total
      FROM boost_purchases
      WHERE community_id = ?
    `)
    .get(communityId) as { total: number };

  return result.total;
}

/**
 * Calculate boost level from booster count
 */
export function calculateBoostLevel(
  boosterCount: number,
  thresholds = DEFAULT_BOOST_THRESHOLDS
): BoostLevel | 0 {
  if (boosterCount >= thresholds.level3) return 3;
  if (boosterCount >= thresholds.level2) return 2;
  if (boosterCount >= thresholds.level1) return 1;
  return 0;
}

/**
 * Calculate progress to next level
 */
export function calculateProgressToNextLevel(
  boosterCount: number,
  thresholds = DEFAULT_BOOST_THRESHOLDS
): { progressPercent: number; boostersNeeded: number } {
  const currentLevel = calculateBoostLevel(boosterCount, thresholds);

  if (currentLevel === 3) {
    // Max level reached
    return { progressPercent: 100, boostersNeeded: 0 };
  }

  let nextThreshold: number;
  let currentThreshold: number;

  if (currentLevel === 0) {
    currentThreshold = 0;
    nextThreshold = thresholds.level1;
  } else if (currentLevel === 1) {
    currentThreshold = thresholds.level1;
    nextThreshold = thresholds.level2;
  } else {
    currentThreshold = thresholds.level2;
    nextThreshold = thresholds.level3;
  }

  const progress = boosterCount - currentThreshold;
  const range = nextThreshold - currentThreshold;
  const progressPercent = Math.min(100, Math.floor((progress / range) * 100));
  const boostersNeeded = nextThreshold - boosterCount;

  return { progressPercent, boostersNeeded };
}

/**
 * Update community boost stats cache
 */
export function updateCommunityBoostStats(communityId: string): void {
  const db = getDatabase();

  const totalBoosters = getActiveBoosterCount(communityId);
  const totalBoostMonths = getTotalBoostMonths(communityId);
  const currentLevel = calculateBoostLevel(totalBoosters);

  db.prepare(`
    INSERT INTO community_boost_stats (
      community_id, total_boosters, total_boost_months, current_level,
      last_calculated_at, updated_at
    ) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(community_id) DO UPDATE SET
      total_boosters = excluded.total_boosters,
      total_boost_months = excluded.total_boost_months,
      current_level = excluded.current_level,
      last_calculated_at = excluded.last_calculated_at,
      updated_at = excluded.updated_at
  `).run(communityId, totalBoosters, totalBoostMonths, currentLevel);

  logger.debug(
    { communityId, totalBoosters, totalBoostMonths, currentLevel },
    'Updated community boost stats'
  );
}

/**
 * Get cached community boost stats
 */
export function getCommunityBoostStats(communityId: string): {
  totalBoosters: number;
  totalBoostMonths: number;
  currentLevel: BoostLevel | 0;
  lastCalculatedAt: Date;
} | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM community_boost_stats WHERE community_id = ?')
    .get(communityId) as CommunityBoostStatsRow | undefined;

  if (!row) return null;

  return {
    totalBoosters: row.total_boosters,
    totalBoostMonths: row.total_boost_months,
    currentLevel: row.current_level as BoostLevel | 0,
    lastCalculatedAt: new Date(row.last_calculated_at),
  };
}

/**
 * Get community boost level (with optional cache refresh)
 */
export function getCommunityBoostLevel(
  communityId: string,
  refreshCache = false
): BoostLevel | 0 {
  if (refreshCache) {
    updateCommunityBoostStats(communityId);
  }

  const stats = getCommunityBoostStats(communityId);
  if (stats) {
    return stats.currentLevel;
  }

  // No cached stats, calculate fresh
  const boosterCount = getActiveBoosterCount(communityId);
  return calculateBoostLevel(boosterCount);
}

// =============================================================================
// Booster Listing Queries
// =============================================================================

/**
 * Get all boosters for a community (aggregated by member)
 */
export function getCommunityBoosters(
  communityId: string,
  options: { activeOnly?: boolean; limit?: number; offset?: number } = {}
): Booster[] {
  const db = getDatabase();
  const { activeOnly = false, limit = 100, offset = 0 } = options;
  const now = new Date().toISOString();

  let query = `
    SELECT
      member_id,
      MIN(purchased_at) as first_boost,
      MAX(purchased_at) as last_boost,
      SUM(months_purchased) as total_months,
      MAX(CASE WHEN is_active = 1 AND expires_at > ? THEN expires_at ELSE NULL END) as latest_expiry,
      MAX(CASE WHEN is_active = 1 AND expires_at > ? THEN 1 ELSE 0 END) as is_active
    FROM boost_purchases
    WHERE community_id = ?
  `;

  const params: (string | number)[] = [now, now, communityId];

  if (activeOnly) {
    query += ' AND is_active = 1 AND expires_at > ?';
    params.push(now);
  }

  query += `
    GROUP BY member_id
    ORDER BY total_months DESC, first_boost ASC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as BoosterAggregateRow[];

  return rows.map(rowToBooster);
}

/**
 * Get booster info for a specific member
 */
export function getMemberBoosterInfo(
  memberId: string,
  communityId: string
): Booster | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT
        member_id,
        MIN(purchased_at) as first_boost,
        MAX(purchased_at) as last_boost,
        SUM(months_purchased) as total_months,
        MAX(CASE WHEN is_active = 1 AND expires_at > ? THEN expires_at ELSE NULL END) as latest_expiry,
        MAX(CASE WHEN is_active = 1 AND expires_at > ? THEN 1 ELSE 0 END) as is_active
      FROM boost_purchases
      WHERE member_id = ? AND community_id = ?
      GROUP BY member_id
    `)
    .get(now, now, memberId, communityId) as BoosterAggregateRow | undefined;

  return row ? rowToBooster(row) : null;
}

/**
 * Get top boosters (by total months) for a community
 */
export function getTopBoosters(
  communityId: string,
  limit: number = 10
): Booster[] {
  return getCommunityBoosters(communityId, { limit, activeOnly: false });
}

/**
 * Get recently expired boosters (for re-engagement notifications)
 */
export function getRecentlyExpiredBoosters(
  communityId: string,
  withinDays: number = 7
): Booster[] {
  const db = getDatabase();
  const now = new Date();
  const cutoff = new Date(now.getTime() - withinDays * 24 * 60 * 60 * 1000);

  const rows = db
    .prepare(`
      SELECT
        member_id,
        MIN(purchased_at) as first_boost,
        MAX(purchased_at) as last_boost,
        SUM(months_purchased) as total_months,
        MAX(expires_at) as latest_expiry,
        0 as is_active
      FROM boost_purchases
      WHERE community_id = ?
        AND expires_at BETWEEN ? AND ?
        AND member_id NOT IN (
          SELECT DISTINCT member_id
          FROM boost_purchases
          WHERE community_id = ? AND is_active = 1 AND expires_at > ?
        )
      GROUP BY member_id
      ORDER BY latest_expiry DESC
    `)
    .all(
      communityId,
      cutoff.toISOString(),
      now.toISOString(),
      communityId,
      now.toISOString()
    ) as BoosterAggregateRow[];

  return rows.map(rowToBooster);
}

// =============================================================================
// Analytics Queries
// =============================================================================

/**
 * Get boost purchase statistics for a community
 */
export function getBoostPurchaseStats(communityId: string): {
  totalPurchases: number;
  totalRevenueCents: number;
  averagePurchaseMonths: number;
  uniqueBoosters: number;
} {
  const db = getDatabase();

  const result = db
    .prepare(`
      SELECT
        COUNT(*) as total_purchases,
        COALESCE(SUM(amount_paid_cents), 0) as total_revenue,
        COALESCE(AVG(months_purchased), 0) as avg_months,
        COUNT(DISTINCT member_id) as unique_boosters
      FROM boost_purchases
      WHERE community_id = ?
    `)
    .get(communityId) as {
      total_purchases: number;
      total_revenue: number;
      avg_months: number;
      unique_boosters: number;
    };

  return {
    totalPurchases: result.total_purchases,
    totalRevenueCents: result.total_revenue,
    averagePurchaseMonths: Math.round(result.avg_months * 10) / 10,
    uniqueBoosters: result.unique_boosters,
  };
}

/**
 * Get all communities with active boosts
 */
export function getCommunitiesWithActiveBoosts(): string[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const rows = db
    .prepare(`
      SELECT DISTINCT community_id
      FROM boost_purchases
      WHERE is_active = 1 AND expires_at > ?
    `)
    .all(now) as { community_id: string }[];

  return rows.map((r) => r.community_id);
}
