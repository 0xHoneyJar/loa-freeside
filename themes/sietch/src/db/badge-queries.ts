/**
 * Badge Database Queries (v4.0 - Sprint 27)
 *
 * Database operations for the score badge system:
 * - Badge purchase tracking
 * - Badge settings management
 */

import { randomUUID } from 'crypto';
import { getDatabase } from './connection.js';
import { logger } from '../utils/logger.js';
import {
  getPlatformDisplayColumn,
  validateBadgeSettingsColumn,
} from '../utils/sql-safety.js';
import type {
  BadgePurchase,
  BadgeSettings,
  CreateBadgePurchaseParams,
  UpdateBadgeSettingsParams,
  BadgeStyle,
} from '../types/billing.js';

// =============================================================================
// Row Type Definitions
// =============================================================================

interface BadgePurchaseRow {
  id: string;
  member_id: string;
  payment_id: string | null;
  purchased_at: string;
  created_at: string;
}

interface BadgeSettingsRow {
  member_id: string;
  display_on_discord: number;
  display_on_telegram: number;
  badge_style: string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Row to Object Converters
// =============================================================================

function rowToBadgePurchase(row: BadgePurchaseRow): BadgePurchase {
  return {
    id: row.id,
    memberId: row.member_id,
    paymentId: row.payment_id ?? undefined,
    purchasedAt: new Date(row.purchased_at),
    createdAt: new Date(row.created_at),
  };
}

function rowToBadgeSettings(row: BadgeSettingsRow): BadgeSettings {
  return {
    memberId: row.member_id,
    displayOnDiscord: row.display_on_discord === 1,
    displayOnTelegram: row.display_on_telegram === 1,
    badgeStyle: row.badge_style as BadgeStyle,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// =============================================================================
// Badge Purchase Queries
// =============================================================================

/**
 * Check if a member has purchased a badge
 */
export function hasBadgePurchase(memberId: string): boolean {
  const db = getDatabase();

  const row = db
    .prepare('SELECT 1 FROM badge_purchases WHERE member_id = ?')
    .get(memberId);

  return !!row;
}

/**
 * Get badge purchase by member ID
 */
export function getBadgePurchaseByMember(memberId: string): BadgePurchase | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM badge_purchases WHERE member_id = ?')
    .get(memberId) as BadgePurchaseRow | undefined;

  return row ? rowToBadgePurchase(row) : null;
}

/**
 * Get badge purchase by ID
 */
export function getBadgePurchaseById(id: string): BadgePurchase | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM badge_purchases WHERE id = ?')
    .get(id) as BadgePurchaseRow | undefined;

  return row ? rowToBadgePurchase(row) : null;
}

/**
 * Record a badge purchase
 */
export function createBadgePurchase(params: CreateBadgePurchaseParams): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO badge_purchases (
      id, member_id, payment_id
    ) VALUES (?, ?, ?)
  `).run(id, params.memberId, params.paymentId ?? null);

  logger.info({ id, memberId: params.memberId }, 'Created badge purchase');

  return id;
}

/**
 * Get all badge purchases (for admin reporting)
 */
export function getAllBadgePurchases(limit: number = 100): BadgePurchase[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM badge_purchases
      ORDER BY purchased_at DESC
      LIMIT ?
    `)
    .all(limit) as BadgePurchaseRow[];

  return rows.map(rowToBadgePurchase);
}

/**
 * Get badge purchase count (for metrics)
 */
export function getBadgePurchaseCount(): number {
  const db = getDatabase();

  const row = db
    .prepare('SELECT COUNT(*) as count FROM badge_purchases')
    .get() as { count: number };

  return row.count;
}

// =============================================================================
// Badge Settings Queries
// =============================================================================

/**
 * Get badge settings for a member
 * Returns default settings if none exist
 */
export function getBadgeSettings(memberId: string): BadgeSettings {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM badge_settings WHERE member_id = ?')
    .get(memberId) as BadgeSettingsRow | undefined;

  if (row) {
    return rowToBadgeSettings(row);
  }

  // Return default settings if none exist
  return {
    memberId,
    displayOnDiscord: true,
    displayOnTelegram: false,
    badgeStyle: 'default',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Create or update badge settings for a member
 */
export function upsertBadgeSettings(
  memberId: string,
  params: UpdateBadgeSettingsParams
): void {
  const db = getDatabase();

  // Check if settings exist
  const existing = db
    .prepare('SELECT 1 FROM badge_settings WHERE member_id = ?')
    .get(memberId);

  if (existing) {
    // Update existing settings using column whitelist (CRIT-3 fix)
    const sets: string[] = ["updated_at = datetime('now')"];
    const values: (string | number)[] = [];

    if (params.displayOnDiscord !== undefined) {
      // Validate column name through whitelist
      const col = validateBadgeSettingsColumn('display_on_discord');
      sets.push(`${col} = ?`);
      values.push(params.displayOnDiscord ? 1 : 0);
    }

    if (params.displayOnTelegram !== undefined) {
      // Validate column name through whitelist
      const col = validateBadgeSettingsColumn('display_on_telegram');
      sets.push(`${col} = ?`);
      values.push(params.displayOnTelegram ? 1 : 0);
    }

    if (params.badgeStyle !== undefined) {
      // Validate column name through whitelist
      const col = validateBadgeSettingsColumn('badge_style');
      sets.push(`${col} = ?`);
      values.push(params.badgeStyle);
    }

    values.push(memberId);

    // Safe: all column names are validated through whitelist
    db.prepare(`UPDATE badge_settings SET ${sets.join(', ')} WHERE member_id = ?`).run(
      ...values
    );

    logger.debug({ memberId, params }, 'Updated badge settings');
  } else {
    // Insert new settings
    db.prepare(`
      INSERT INTO badge_settings (
        member_id, display_on_discord, display_on_telegram, badge_style
      ) VALUES (?, ?, ?, ?)
    `).run(
      memberId,
      params.displayOnDiscord ?? 1,
      params.displayOnTelegram ?? 0,
      params.badgeStyle ?? 'default'
    );

    logger.debug({ memberId, params }, 'Created badge settings');
  }
}

/**
 * Delete badge settings for a member
 */
export function deleteBadgeSettings(memberId: string): boolean {
  const db = getDatabase();

  const result = db
    .prepare('DELETE FROM badge_settings WHERE member_id = ?')
    .run(memberId);

  if (result.changes > 0) {
    logger.debug({ memberId }, 'Deleted badge settings');
    return true;
  }

  return false;
}

/**
 * Get all members with badges enabled for a platform
 *
 * Uses column whitelist to prevent SQL injection (CRIT-3 fix)
 */
export function getMembersWithBadgesEnabled(
  platform: 'discord' | 'telegram'
): string[] {
  const db = getDatabase();

  // CRIT-3 FIX: Use validated column name from whitelist
  // This prevents SQL injection if platform value is somehow manipulated
  const column = getPlatformDisplayColumn(platform);

  const rows = db
    .prepare(`SELECT member_id FROM badge_settings WHERE ${column} = 1`)
    .all() as { member_id: string }[];

  return rows.map((row) => row.member_id);
}

/**
 * Get badge settings count (for metrics)
 */
export function getBadgeSettingsCount(): number {
  const db = getDatabase();

  const row = db
    .prepare('SELECT COUNT(*) as count FROM badge_settings')
    .get() as { count: number };

  return row.count;
}
