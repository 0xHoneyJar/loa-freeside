/**
 * Initial database migration
 *
 * Creates all tables and indexes as defined in schema.ts
 */

import type Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../schema.js';

export const version = 1;
export const name = '001_initial';

export function up(db: Database.Database): void {
  // Execute the full schema SQL
  // Split by semicolon to handle multiple statements
  db.exec(SCHEMA_SQL);
}

export function down(db: Database.Database): void {
  // Drop all tables in reverse order of dependencies
  db.exec(`
    DROP TABLE IF EXISTS wallet_mappings;
    DROP TABLE IF EXISTS health_status;
    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS admin_overrides;
    DROP TABLE IF EXISTS current_eligibility;
    DROP TABLE IF EXISTS eligibility_snapshots;
  `);
}
