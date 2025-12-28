/**
 * Migration Utilities
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Exports for data migration from SQLite to PostgreSQL.
 *
 * @module packages/adapters/storage/migration
 */

export {
  SQLiteMigrator,
  createSQLiteMigrator,
  type MigrationOptions,
  type MigrationResult,
  type ValidationResult,
  type SQLiteMemberProfile,
  type SQLiteWalletMapping,
  type SQLiteMemberBadge,
  type SQLiteEligibility,
} from './SQLiteMigrator.js';

export {
  MigrationValidator,
  createMigrationValidator,
  type ValidatorOptions,
  type IntegrityReport,
  type ProfileIntegrity,
  type BadgeIntegrity,
} from './MigrationValidator.js';
