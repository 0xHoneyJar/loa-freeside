/**
 * Migration Data Validator
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Validates data integrity after migration from SQLite to PostgreSQL.
 * Performs deep comparison of row counts, relationships, and data consistency.
 *
 * @module packages/adapters/storage/migration/MigrationValidator
 */

import Database from 'better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';

import { communities, profiles, badges } from '../schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Validator configuration options
 */
export interface ValidatorOptions {
  /** SQLite database file path */
  sqliteDbPath: string;
  /** Community ID to validate */
  communityId: string;
  /** Enable verbose logging */
  debug?: boolean;
}

/**
 * Profile integrity check result
 */
export interface ProfileIntegrity {
  discordId: string;
  sqliteExists: boolean;
  postgresExists: boolean;
  walletMatch: boolean;
  tierMatch: boolean;
  issues: string[];
}

/**
 * Badge integrity check result
 */
export interface BadgeIntegrity {
  badgeType: string;
  profileId: string;
  sqliteExists: boolean;
  postgresExists: boolean;
  timestampMatch: boolean;
  issues: string[];
}

/**
 * Full integrity report
 */
export interface IntegrityReport {
  valid: boolean;
  timestamp: Date;
  communityId: string;
  summary: {
    totalProfiles: {
      sqlite: number;
      postgres: number;
    };
    totalBadges: {
      sqlite: number;
      postgres: number;
    };
    profilesValidated: number;
    badgesValidated: number;
    issuesFound: number;
  };
  profileIssues: ProfileIntegrity[];
  badgeIssues: BadgeIntegrity[];
  errors: string[];
}

// =============================================================================
// Migration Validator
// =============================================================================

/**
 * MigrationValidator performs deep validation of migrated data.
 *
 * @example
 * ```typescript
 * const validator = new MigrationValidator(postgresDb, {
 *   sqliteDbPath: './profiles.db',
 *   communityId: 'uuid-here',
 * });
 *
 * const report = await validator.validate();
 * if (!report.valid) {
 *   console.error('Validation failed:', report.errors);
 * }
 * ```
 */
export class MigrationValidator {
  private readonly db: PostgresJsDatabase;
  private readonly options: Required<ValidatorOptions>;
  private sqliteDb: Database.Database | null = null;

  constructor(db: PostgresJsDatabase, options: ValidatorOptions) {
    this.db = db;
    this.options = {
      sqliteDbPath: options.sqliteDbPath,
      communityId: options.communityId,
      debug: options.debug ?? false,
    };
  }

  /**
   * Run full validation
   */
  async validate(): Promise<IntegrityReport> {
    const errors: string[] = [];
    const profileIssues: ProfileIntegrity[] = [];
    const badgeIssues: BadgeIntegrity[] = [];
    let sqliteProfileCount = 0;
    let sqliteBadgeCount = 0;
    let postgresProfileCount = 0;
    let postgresBadgeCount = 0;

    try {
      this.log('Starting migration validation...');

      // Open SQLite database
      this.sqliteDb = new Database(this.options.sqliteDbPath, { readonly: true });

      // Get SQLite counts
      sqliteProfileCount = (
        this.sqliteDb.prepare('SELECT COUNT(*) as count FROM member_profiles').get() as { count: number }
      ).count;

      sqliteBadgeCount = (
        this.sqliteDb.prepare('SELECT COUNT(*) as count FROM member_badges WHERE revoked = 0').get() as { count: number }
      ).count;

      // Get PostgreSQL counts
      const pgProfiles = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(profiles)
        .where(eq(profiles.communityId, this.options.communityId));
      postgresProfileCount = Number(pgProfiles[0]?.count ?? 0);

      const pgBadges = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(badges)
        .where(eq(badges.communityId, this.options.communityId));
      postgresBadgeCount = Number(pgBadges[0]?.count ?? 0);

      // Validate count matches
      if (sqliteProfileCount !== postgresProfileCount) {
        errors.push(
          `Profile count mismatch: SQLite=${sqliteProfileCount}, PostgreSQL=${postgresProfileCount}`
        );
      }

      if (sqliteBadgeCount !== postgresBadgeCount) {
        errors.push(
          `Badge count mismatch: SQLite=${sqliteBadgeCount}, PostgreSQL=${postgresBadgeCount}`
        );
      }

      // Validate individual profiles (sample)
      const profileValidation = await this.validateProfiles();
      profileIssues.push(...profileValidation);

      // Validate individual badges (sample)
      const badgeValidation = await this.validateBadges();
      badgeIssues.push(...badgeValidation);

      this.log('Validation complete');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Validation error: ${message}`);
    } finally {
      if (this.sqliteDb) {
        this.sqliteDb.close();
        this.sqliteDb = null;
      }
    }

    return {
      valid: errors.length === 0 && profileIssues.length === 0 && badgeIssues.length === 0,
      timestamp: new Date(),
      communityId: this.options.communityId,
      summary: {
        totalProfiles: {
          sqlite: sqliteProfileCount,
          postgres: postgresProfileCount,
        },
        totalBadges: {
          sqlite: sqliteBadgeCount,
          postgres: postgresBadgeCount,
        },
        profilesValidated: sqliteProfileCount,
        badgesValidated: sqliteBadgeCount,
        issuesFound: errors.length + profileIssues.length + badgeIssues.length,
      },
      profileIssues,
      badgeIssues,
      errors,
    };
  }

  /**
   * Validate profile data integrity
   */
  private async validateProfiles(): Promise<ProfileIntegrity[]> {
    if (!this.sqliteDb) throw new Error('SQLite database not open');

    const issues: ProfileIntegrity[] = [];

    // Get all SQLite profiles
    const sqliteProfiles = this.sqliteDb
      .prepare(`
        SELECT mp.member_id, mp.discord_user_id, mp.tier,
               wm.wallet_address
        FROM member_profiles mp
        LEFT JOIN wallet_mappings wm ON wm.discord_user_id = mp.discord_user_id
      `)
      .all() as Array<{
        member_id: string;
        discord_user_id: string;
        tier: string;
        wallet_address: string | null;
      }>;

    // Check each profile exists in PostgreSQL
    for (const sqliteProfile of sqliteProfiles) {
      const pgProfiles = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.discordId, sqliteProfile.discord_user_id))
        .limit(1);

      const pgProfile = pgProfiles[0];

      const profileCheck: ProfileIntegrity = {
        discordId: sqliteProfile.discord_user_id,
        sqliteExists: true,
        postgresExists: !!pgProfile,
        walletMatch: true,
        tierMatch: true,
        issues: [],
      };

      if (!pgProfile) {
        profileCheck.issues.push('Profile not found in PostgreSQL');
        issues.push(profileCheck);
        continue;
      }

      // Check wallet match
      const sqliteWallet = sqliteProfile.wallet_address?.toLowerCase() ?? null;
      const pgWallet = pgProfile.walletAddress?.toLowerCase() ?? null;
      if (sqliteWallet !== pgWallet) {
        profileCheck.walletMatch = false;
        profileCheck.issues.push(
          `Wallet mismatch: SQLite=${sqliteWallet}, PostgreSQL=${pgWallet}`
        );
      }

      // Check tier match
      if (sqliteProfile.tier !== pgProfile.tier) {
        profileCheck.tierMatch = false;
        profileCheck.issues.push(
          `Tier mismatch: SQLite=${sqliteProfile.tier}, PostgreSQL=${pgProfile.tier}`
        );
      }

      if (profileCheck.issues.length > 0) {
        issues.push(profileCheck);
      }
    }

    return issues;
  }

  /**
   * Validate badge data integrity
   */
  private async validateBadges(): Promise<BadgeIntegrity[]> {
    if (!this.sqliteDb) throw new Error('SQLite database not open');

    const issues: BadgeIntegrity[] = [];

    // Get all SQLite badges (non-revoked)
    const sqliteBadges = this.sqliteDb
      .prepare(`
        SELECT mb.badge_id, mb.member_id, mb.awarded_at, mp.discord_user_id
        FROM member_badges mb
        JOIN member_profiles mp ON mp.member_id = mb.member_id
        WHERE mb.revoked = 0
      `)
      .all() as Array<{
        badge_id: string;
        member_id: string;
        awarded_at: string;
        discord_user_id: string;
      }>;

    // Check each badge exists in PostgreSQL
    for (const sqliteBadge of sqliteBadges) {
      // First find the PostgreSQL profile
      const pgProfiles = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.discordId, sqliteBadge.discord_user_id))
        .limit(1);

      const pgProfile = pgProfiles[0];
      if (!pgProfile) {
        issues.push({
          badgeType: sqliteBadge.badge_id,
          profileId: sqliteBadge.member_id,
          sqliteExists: true,
          postgresExists: false,
          timestampMatch: false,
          issues: ['Parent profile not found in PostgreSQL'],
        });
        continue;
      }

      // Find the badge
      const pgBadges = await this.db
        .select()
        .from(badges)
        .where(eq(badges.profileId, pgProfile.id))
        .limit(100);

      const badgeType = sqliteBadge.badge_id.toLowerCase().replace(/[- ]/g, '_');
      const pgBadge = pgBadges.find((b) => b.badgeType === badgeType);

      const badgeCheck: BadgeIntegrity = {
        badgeType: sqliteBadge.badge_id,
        profileId: sqliteBadge.member_id,
        sqliteExists: true,
        postgresExists: !!pgBadge,
        timestampMatch: true,
        issues: [],
      };

      if (!pgBadge) {
        badgeCheck.postgresExists = false;
        badgeCheck.issues.push('Badge not found in PostgreSQL');
        issues.push(badgeCheck);
        continue;
      }

      // Check timestamp (within 1 second tolerance)
      const sqliteTime = new Date(sqliteBadge.awarded_at).getTime();
      const pgTime = pgBadge.awardedAt.getTime();
      if (Math.abs(sqliteTime - pgTime) > 1000) {
        badgeCheck.timestampMatch = false;
        badgeCheck.issues.push(
          `Timestamp mismatch: SQLite=${sqliteBadge.awarded_at}, PostgreSQL=${pgBadge.awardedAt.toISOString()}`
        );
      }

      if (badgeCheck.issues.length > 0) {
        issues.push(badgeCheck);
      }
    }

    return issues;
  }

  /**
   * Generate summary report
   */
  async generateReport(): Promise<string> {
    const report = await this.validate();

    const lines: string[] = [
      '# Migration Validation Report',
      '',
      `**Date**: ${report.timestamp.toISOString()}`,
      `**Community ID**: ${report.communityId}`,
      `**Status**: ${report.valid ? 'VALID' : 'ISSUES FOUND'}`,
      '',
      '## Summary',
      '',
      '| Metric | SQLite | PostgreSQL | Match |',
      '|--------|--------|------------|-------|',
      `| Profiles | ${report.summary.totalProfiles.sqlite} | ${report.summary.totalProfiles.postgres} | ${report.summary.totalProfiles.sqlite === report.summary.totalProfiles.postgres ? '✅' : '❌'} |`,
      `| Badges | ${report.summary.totalBadges.sqlite} | ${report.summary.totalBadges.postgres} | ${report.summary.totalBadges.sqlite === report.summary.totalBadges.postgres ? '✅' : '❌'} |`,
      '',
    ];

    if (report.errors.length > 0) {
      lines.push('## Errors', '');
      for (const error of report.errors) {
        lines.push(`- ${error}`);
      }
      lines.push('');
    }

    if (report.profileIssues.length > 0) {
      lines.push('## Profile Issues', '');
      for (const issue of report.profileIssues) {
        lines.push(`- **${issue.discordId}**: ${issue.issues.join(', ')}`);
      }
      lines.push('');
    }

    if (report.badgeIssues.length > 0) {
      lines.push('## Badge Issues', '');
      for (const issue of report.badgeIssues) {
        lines.push(`- **${issue.badgeType}** (${issue.profileId}): ${issue.issues.join(', ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Log message
   */
  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[MigrationValidator] ${message}`);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new MigrationValidator instance
 */
export function createMigrationValidator(
  db: PostgresJsDatabase,
  options: ValidatorOptions
): MigrationValidator {
  return new MigrationValidator(db, options);
}
