/**
 * Migration 008: Usul Ascended Badge (v3.0 - Sprint 18)
 *
 * Adds the Usul Ascended badge - automatically awarded when a member
 * reaches the Usul tier (1111+ BGT).
 *
 * Sprint 18: Notification Extensions
 */

export const USUL_ASCENDED_SCHEMA_SQL = `
-- =============================================================================
-- Usul Ascended Badge Definition (Sprint 18)
-- =============================================================================
-- Add the Usul Ascended badge to the badges table.
-- This badge is auto-awarded when a member reaches the Usul tier (1111+ BGT).

INSERT OR IGNORE INTO badges (
  badge_id,
  name,
  description,
  category,
  emoji,
  auto_criteria_type,
  auto_criteria_value,
  display_order
) VALUES (
  'usul-ascended',
  'Usul Ascended',
  'Reached the Usul tier - the base of the pillar, the innermost identity. 1111+ BGT',
  'special',
  '⭐',
  'tier',
  'usul',
  4
);
`;

export const USUL_ASCENDED_ROLLBACK_SQL = `
-- Remove the Usul Ascended badge
DELETE FROM badges WHERE badge_id = 'usul-ascended';

-- Note: member_badges entries with this badge_id will remain but be orphaned
-- They will be cleaned up naturally or can be manually removed
`;

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Run migration to add Usul Ascended badge
 */
export function up(db: Database.Database): void {
  logger.info('Running migration 008_usul_ascended: Adding Usul Ascended badge');
  db.exec(USUL_ASCENDED_SCHEMA_SQL);
  logger.info('Migration 008_usul_ascended completed');
}

/**
 * Reverse migration
 */
export function down(db: Database.Database): void {
  logger.info('Reverting migration 008_usul_ascended');
  db.exec(USUL_ASCENDED_ROLLBACK_SQL);
  logger.info('Migration 008_usul_ascended reverted');
}
