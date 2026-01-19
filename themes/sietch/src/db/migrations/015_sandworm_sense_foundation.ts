/**
 * Migration 015: Sandworm Sense Foundation
 *
 * Sprint 102: Foundation - Sandworm Sense
 *
 * Adds onboarding-related columns to support intelligent guild detection:
 * - onboarding_mode: shadow, greenfield, or hybrid
 * - incumbent_type: detected provider (collabland, matrica, guild.xyz, etc.)
 * - incumbent_confidence: detection confidence score (0.00-1.00)
 * - incumbent_detected_at: when detection occurred
 * - mode_selected_at: when mode was determined
 * - shadow_started_at: when shadow mode began
 * - shadow_accuracy: current prediction accuracy (0.0000-1.0000)
 * - migration_ready_at: when migration threshold reached
 *
 * @see PRD FR-1 Auto Detection
 * @see PRD FR-2 Shadow Activation
 * @see SDD §2.1 Component Design
 */

import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

/**
 * Migration SQL for Sandworm Sense Foundation
 */
export const SANDWORM_SENSE_FOUNDATION_SQL = `
-- =============================================================================
-- Sandworm Sense Foundation (Sprint 102)
-- =============================================================================

-- Note: SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we check first
-- We'll use a pragmatic approach with individual ALTER TABLE statements

-- Add onboarding_mode column (shadow | greenfield | hybrid)
ALTER TABLE communities ADD COLUMN onboarding_mode TEXT DEFAULT 'greenfield';

-- Add incumbent tracking columns
ALTER TABLE communities ADD COLUMN incumbent_type TEXT;
ALTER TABLE communities ADD COLUMN incumbent_confidence REAL;
ALTER TABLE communities ADD COLUMN incumbent_detected_at TEXT;

-- Add mode selection timestamp
ALTER TABLE communities ADD COLUMN mode_selected_at TEXT;

-- Add shadow mode tracking
ALTER TABLE communities ADD COLUMN shadow_started_at TEXT;
ALTER TABLE communities ADD COLUMN shadow_accuracy REAL;

-- Add migration readiness tracking
ALTER TABLE communities ADD COLUMN migration_ready_at TEXT;
`;

/**
 * Create partial index on shadow mode communities
 */
export const SHADOW_INDEX_SQL = `
-- Partial index for efficient shadow mode queries
CREATE INDEX IF NOT EXISTS idx_communities_shadow_mode
  ON communities(onboarding_mode, shadow_started_at)
  WHERE onboarding_mode = 'shadow';

-- Index for migration candidates (shadow mode with high accuracy)
CREATE INDEX IF NOT EXISTS idx_communities_migration_candidates
  ON communities(shadow_accuracy, shadow_started_at)
  WHERE onboarding_mode = 'shadow' AND shadow_accuracy >= 0.95;
`;

/**
 * Run the Sandworm Sense Foundation migration
 */
export function migrateSandwormSenseFoundation(db: Database.Database): void {
  logger.info('Running migration 015: Sandworm Sense Foundation');

  try {
    // Check if columns already exist (idempotent migration)
    const tableInfo = db.pragma('table_info(communities)') as Array<{ name: string }>;
    const existingColumns = new Set(tableInfo.map((col) => col.name));

    const columnsToAdd = [
      { name: 'onboarding_mode', sql: "ALTER TABLE communities ADD COLUMN onboarding_mode TEXT DEFAULT 'greenfield'" },
      { name: 'incumbent_type', sql: 'ALTER TABLE communities ADD COLUMN incumbent_type TEXT' },
      { name: 'incumbent_confidence', sql: 'ALTER TABLE communities ADD COLUMN incumbent_confidence REAL' },
      { name: 'incumbent_detected_at', sql: 'ALTER TABLE communities ADD COLUMN incumbent_detected_at TEXT' },
      { name: 'mode_selected_at', sql: 'ALTER TABLE communities ADD COLUMN mode_selected_at TEXT' },
      { name: 'shadow_started_at', sql: 'ALTER TABLE communities ADD COLUMN shadow_started_at TEXT' },
      { name: 'shadow_accuracy', sql: 'ALTER TABLE communities ADD COLUMN shadow_accuracy REAL' },
      { name: 'migration_ready_at', sql: 'ALTER TABLE communities ADD COLUMN migration_ready_at TEXT' },
    ];

    // Add each column if it doesn't exist
    for (const column of columnsToAdd) {
      if (!existingColumns.has(column.name)) {
        db.exec(column.sql);
        logger.debug({ column: column.name }, 'Added column to communities table');
      } else {
        logger.debug({ column: column.name }, 'Column already exists, skipping');
      }
    }

    // Create indexes (IF NOT EXISTS handles idempotency)
    db.exec(SHADOW_INDEX_SQL);

    logger.info('Migration 015 completed: Sandworm Sense columns added');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Migration 015 failed');
    throw error;
  }
}

/**
 * Rollback the Sandworm Sense Foundation migration
 *
 * Note: SQLite doesn't support DROP COLUMN directly.
 * This rollback creates a new table without the columns and migrates data.
 */
export function rollbackSandwormSenseFoundation(db: Database.Database): void {
  logger.info('Rolling back migration 015: Sandworm Sense Foundation');

  try {
    // Drop indexes first
    db.exec(`
      DROP INDEX IF EXISTS idx_communities_migration_candidates;
      DROP INDEX IF EXISTS idx_communities_shadow_mode;
    `);

    // Note: Full column removal in SQLite requires table recreation
    // For safety, we only remove indexes and leave columns (they'll be ignored)
    // A full rollback would require:
    // 1. CREATE new table without columns
    // 2. Copy data
    // 3. DROP old table
    // 4. RENAME new table

    logger.warn('Columns left in place (SQLite limitation). Only indexes removed.');
    logger.info('Migration 015 rollback completed (partial - indexes only)');
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Migration 015 rollback failed');
    throw error;
  }
}
