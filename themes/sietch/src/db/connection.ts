/**
 * Database Connection Module
 *
 * Handles database lifecycle: initialization, connection management, and shutdown.
 * Extracted from queries.ts as part of Sprint 54 code organization refactor.
 *
 * @module db/connection
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  SCHEMA_SQL,
  SOCIAL_LAYER_SCHEMA_SQL,
  BILLING_SCHEMA_SQL,
  BADGES_SCHEMA_SQL,
  BOOSTS_SCHEMA_SQL,
  TELEGRAM_IDENTITY_SAFE_SQL
} from './schema.js';

let db: Database.Database | null = null;

/**
 * Default story fragments for seeding (Sprint 21)
 * Cryptic Dune-themed narratives for elite member joins
 */
const DEFAULT_STORY_FRAGMENTS = {
  fedaykin_join: [
    `The desert wind carried whispers of a new arrival.
One who had held their water, never trading the sacred spice.
The sietch grows stronger.`,
    `Footsteps in the sand revealed a traveler from distant dunes.
They bore no marks of the water sellers.
A new Fedaykin has earned their place.`,
    `The winds shifted across the Great Bled.
A new figure emerged from the dancing sands,
their stillsuit bearing the marks of deep desert travel.

The watermasters took note.
Another has proven their worth in the spice trade.

A new Fedaykin walks among us.`,
    `Beneath the twin moons, a shadow moved with purpose.
The sand gave no resistance to their practiced steps.
One more keeper of the ancient way has joined our ranks.`,
    `The sietch's heartbeat grows louder.
Another warrior of the deep desert approaches,
their loyalty to the spice unbroken, their resolve unshaken.`,
  ],
  naib_join: [
    `The council chamber stirred.
A presence of great weight approached -
one whose reserves of melange could shift the balance.
A new voice joins the Naib.`,
    `The sands trembled with significance.
One of profound holdings has crossed the threshold,
their wisdom forged in the crucible of scarcity.
The Naib Council is complete once more.`,
    `Ancient traditions speak of leaders rising from the dunes.
Today, the prophecy continues.
A new Naib takes their seat among the watermasters.`,
  ],
};

/**
 * Seed default story fragments if table exists and is empty
 * This is called automatically during database initialization
 * Idempotent - only seeds if table exists and is empty
 *
 * NOTE: The story_fragments table is defined in 006_tier_system migration
 * which may not be applied in all contexts (e.g., in-memory SQLite for
 * PostgreSQL-primary deployments). We gracefully skip seeding if the table
 * doesn't exist.
 */
function seedDefaultStoryFragments(database: Database.Database): void {
  // Check if story_fragments table exists
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='story_fragments'")
    .get();

  if (!tableExists) {
    logger.debug('story_fragments table does not exist, skipping seed');
    return;
  }

  // Check if fragments already exist
  const existingCount = database
    .prepare('SELECT COUNT(*) as count FROM story_fragments')
    .get() as { count: number };

  if (existingCount.count > 0) {
    logger.debug(
      { count: existingCount.count },
      'Story fragments already seeded, skipping'
    );
    return;
  }

  logger.info('Seeding default story fragments...');

  const insertStmt = database.prepare(
    `INSERT INTO story_fragments (id, category, content, used_count) VALUES (?, ?, ?, ?)`
  );

  let totalInserted = 0;

  // Insert Fedaykin fragments
  for (const content of DEFAULT_STORY_FRAGMENTS.fedaykin_join) {
    insertStmt.run(randomUUID(), 'fedaykin_join', content, 0);
    totalInserted++;
  }

  // Insert Naib fragments
  for (const content of DEFAULT_STORY_FRAGMENTS.naib_join) {
    insertStmt.run(randomUUID(), 'naib_join', content, 0);
    totalInserted++;
  }

  logger.info(
    {
      totalInserted,
      fedaykin: DEFAULT_STORY_FRAGMENTS.fedaykin_join.length,
      naib: DEFAULT_STORY_FRAGMENTS.naib_join.length,
    },
    'Default story fragments seeded successfully'
  );
}

/**
 * Initialize the database connection
 *
 * When DATABASE_URL (PostgreSQL) is configured without DATABASE_PATH,
 * uses an in-memory SQLite for local caching. Production data should
 * be accessed via DrizzleStorageAdapter with PostgreSQL.
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // Sprint 70: database.path is now optional (PostgreSQL is preferred)
  // When PostgreSQL is configured, use in-memory SQLite as fallback for legacy code
  let dbPath = config.database.path;
  if (!dbPath) {
    if (config.database.url) {
      // PostgreSQL is primary storage - use in-memory SQLite for legacy compatibility
      dbPath = ':memory:';
      logger.info('PostgreSQL configured - using in-memory SQLite for legacy code paths');
    } else {
      throw new Error(
        'No database configured. Set DATABASE_URL (PostgreSQL recommended) or DATABASE_PATH (SQLite deprecated).'
      );
    }
  }

  // For file-based SQLite, ensure data directory exists
  if (dbPath !== ':memory:') {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
      logger.info({ path: dbDir }, 'Created database directory');
    }
  }

  // Create database connection
  db = new Database(dbPath);
  logger.info({ path: dbPath }, 'Database connection established');

  // Enable WAL mode and run schema
  db.exec(SCHEMA_SQL);
  logger.info('Database schema initialized');

  // Run social layer schema (v2.0)
  db.exec(SOCIAL_LAYER_SCHEMA_SQL);
  logger.info('Social layer schema initialized');

  // Run billing schema (v4.0 - Sprint 23)
  db.exec(BILLING_SCHEMA_SQL);
  logger.info('Billing schema initialized');

  // Run badge schema (v4.0 - Sprint 27)
  db.exec(BADGES_SCHEMA_SQL);
  logger.info('Badge schema initialized');

  // Run boosts schema (v4.0 - Sprint 28)
  db.exec(BOOSTS_SCHEMA_SQL);
  logger.info('Boosts schema initialized');

  // Run telegram identity schema (v4.1 - Sprint 30)
  // Uses safe SQL that handles existing columns gracefully
  try {
    db.exec(TELEGRAM_IDENTITY_SAFE_SQL);
    logger.info('Telegram identity schema initialized');
  } catch (error) {
    // Ignore errors for existing columns (SQLite limitation)
    logger.debug({ error }, 'Telegram schema migration note (may be already applied)');
  }

  // Add telegram columns if they don't exist (safe migration)
  // SQLite doesn't have ADD COLUMN IF NOT EXISTS, so we handle manually
  try {
    const columnExists = db.prepare(
      "SELECT COUNT(*) as count FROM pragma_table_info('member_profiles') WHERE name = 'telegram_user_id'"
    ).get() as { count: number };

    if (columnExists.count === 0) {
      db.exec('ALTER TABLE member_profiles ADD COLUMN telegram_user_id TEXT UNIQUE');
      db.exec('ALTER TABLE member_profiles ADD COLUMN telegram_linked_at INTEGER');
      // Create index after column exists
      db.exec(`CREATE INDEX IF NOT EXISTS idx_member_profiles_telegram
        ON member_profiles(telegram_user_id)`);
      logger.info('Added telegram columns to member_profiles');
    }
  } catch (error) {
    // Column might already exist
    logger.debug({ error }, 'Telegram column migration note');
  }

  // Seed default story fragments if table is empty (v3.0 - Sprint 21)
  seedDefaultStoryFragments(db);

  return db;
}

/**
 * Get the database instance (must call initDatabase first)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

// Re-export Database type for consumers
export type { Database };
