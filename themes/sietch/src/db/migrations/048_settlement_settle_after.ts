/**
 * Migration 048 — Settlement Hardening: settle_after Column
 *
 * Adds `settle_after` column to `referrer_earnings` for pre-computed
 * settlement eligibility timestamps. Eliminates wall-clock dependency
 * in settlement batch processing.
 *
 * Backfills existing rows: settle_after = created_at + 48 hours.
 * Adds index for efficient batch settlement queries.
 *
 * SDD refs: §4.3 SettlementService
 * Sprint refs: Task 16.1 (BB-67-003)
 *
 * @module db/migrations/048_settlement_settle_after
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

export const SETTLEMENT_SETTLE_AFTER_SQL = `
  -- Add settle_after column for pre-computed settlement eligibility
  ALTER TABLE referrer_earnings ADD COLUMN settle_after TEXT;

  -- Backfill existing rows: settle_after = created_at + 48 hours
  UPDATE referrer_earnings
  SET settle_after = datetime(created_at, '+48 hours')
  WHERE settle_after IS NULL;

  -- Index for efficient batch settlement queries
  CREATE INDEX IF NOT EXISTS idx_referrer_earnings_settle_after
    ON referrer_earnings (settle_after)
    WHERE settled_at IS NULL;
`;

export function up(db: Database.Database): void {
  logger.info({ msg: 'Running migration 048_settlement_settle_after: Adding settle_after column' });

  // Check if column already exists
  const cols = db.prepare('PRAGMA table_info(referrer_earnings)').all() as Array<{ name: string }>;
  const colNames = cols.map(c => c.name);

  if (!colNames.includes('settle_after')) {
    db.exec(`ALTER TABLE referrer_earnings ADD COLUMN settle_after TEXT`);

    db.exec(`
      UPDATE referrer_earnings
      SET settle_after = datetime(created_at, '+48 hours')
      WHERE settle_after IS NULL
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_referrer_earnings_settle_after
        ON referrer_earnings (settle_after)
        WHERE settled_at IS NULL
    `);
  }

  logger.info({ msg: 'Migration 048_settlement_settle_after completed' });
}
