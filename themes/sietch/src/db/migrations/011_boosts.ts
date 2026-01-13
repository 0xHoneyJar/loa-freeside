/**
 * Migration 011: Community Boosts (v4.0 - Sprint 28)
 *
 * Creates tables for the community boost system:
 * - boost_purchases: Individual boost purchase records
 * - community_boost_stats: Cached community boost aggregations
 *
 * Boosts allow members to support their community and unlock perks.
 * Level thresholds: Level 1 = 2 boosters, Level 2 = 7 boosters, Level 3 = 15 boosters
 */

/**
 * SQL for creating boost tables
 */
export const BOOSTS_SCHEMA_SQL = `
-- Boost purchases (individual member boosts) - Sprint 1: Paddle Migration
CREATE TABLE IF NOT EXISTS boost_purchases (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  payment_id TEXT,
  months_purchased INTEGER NOT NULL CHECK (months_purchased > 0),
  amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
  purchased_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for member boost lookups
CREATE INDEX IF NOT EXISTS idx_boost_purchases_member
  ON boost_purchases(member_id);

-- Index for community boost aggregation
CREATE INDEX IF NOT EXISTS idx_boost_purchases_community
  ON boost_purchases(community_id);

-- Index for active boosts
CREATE INDEX IF NOT EXISTS idx_boost_purchases_active
  ON boost_purchases(is_active, expires_at);

-- Index for payment lookups (webhook handling)
CREATE INDEX IF NOT EXISTS idx_boost_purchases_payment
  ON boost_purchases(payment_id);

-- Combined index for community active boost queries
CREATE INDEX IF NOT EXISTS idx_boost_purchases_community_active
  ON boost_purchases(community_id, is_active, expires_at);

-- Community boost stats cache (for fast level lookups)
CREATE TABLE IF NOT EXISTS community_boost_stats (
  community_id TEXT PRIMARY KEY,
  total_boosters INTEGER NOT NULL DEFAULT 0,
  total_boost_months INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 0 CHECK (current_level >= 0 AND current_level <= 3),
  last_calculated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * SQL for rolling back boost tables
 */
export const BOOSTS_ROLLBACK_SQL = `
DROP TABLE IF EXISTS community_boost_stats;
DROP TABLE IF EXISTS boost_purchases;
`;

/**
 * Default boost level thresholds
 * These can be overridden via environment variables
 */
export const DEFAULT_BOOST_THRESHOLDS = {
  level1: 2,   // 2 boosters for Level 1
  level2: 7,   // 7 boosters for Level 2
  level3: 15,  // 15 boosters for Level 3
};

/**
 * Default boost pricing (in cents)
 */
export const DEFAULT_BOOST_PRICING = {
  pricePerMonthCents: 499, // $4.99/month
  bundles: [
    { months: 1, priceCents: 499, discountPercent: 0 },
    { months: 3, priceCents: 1347, discountPercent: 10 }, // 10% off
    { months: 6, priceCents: 2394, discountPercent: 20 }, // 20% off
    { months: 12, priceCents: 4190, discountPercent: 30 }, // 30% off
  ],
};
