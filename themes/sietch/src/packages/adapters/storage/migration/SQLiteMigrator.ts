/**
 * SQLite to PostgreSQL Data Migrator
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Migrates data from the legacy SQLite database (profiles.db) to PostgreSQL
 * with automatic community_id backfill for multi-tenant support.
 *
 * Features:
 * - Reads from SQLite member_profiles, member_badges, wallet_mappings tables
 * - Creates a default community for existing data
 * - Maps SQLite member_id to PostgreSQL profile.id
 * - Preserves badge timestamps and relationships
 * - Validates data integrity (row counts, relationships)
 *
 * @module packages/adapters/storage/migration/SQLiteMigrator
 */

import Database from 'better-sqlite3';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

import {
  communities,
  profiles,
  badges,
  type NewCommunity,
  type NewProfile,
  type NewBadge,
  type ProfileMetadata,
  type BadgeMetadata,
} from '../schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * SQLite member_profile row structure
 */
export interface SQLiteMemberProfile {
  member_id: string;
  discord_user_id: string;
  nym: string;
  bio: string | null;
  pfp_url: string | null;
  pfp_type: string | null;
  tier: string;
  created_at: string;
  updated_at: string;
  nym_last_changed: string | null;
  onboarding_complete: number;
  onboarding_step: number;
}

/**
 * SQLite wallet_mappings row structure
 */
export interface SQLiteWalletMapping {
  discord_user_id: string;
  wallet_address: string;
  verified_at: string;
}

/**
 * SQLite member_badges row structure
 */
export interface SQLiteMemberBadge {
  id: number;
  member_id: string;
  badge_id: string;
  awarded_at: string;
  awarded_by: string | null;
  award_reason: string | null;
  revoked: number;
  revoked_at: string | null;
  revoked_by: string | null;
}

/**
 * SQLite current_eligibility row structure
 */
export interface SQLiteEligibility {
  address: string;
  rank: number;
  bgt_held: string;
  role: string;
  updated_at: string;
}

/**
 * Migration result statistics
 */
export interface MigrationResult {
  success: boolean;
  communityId: string;
  profilesCreated: number;
  badgesCreated: number;
  walletsProcessed: number;
  errors: string[];
  duration: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  sqliteCounts: {
    profiles: number;
    badges: number;
    wallets: number;
  };
  postgresCounts: {
    profiles: number;
    badges: number;
  };
  mismatches: string[];
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /** SQLite database file path */
  sqliteDbPath: string;
  /** Community name for backfill (default: 'Legacy Community') */
  communityName?: string;
  /** Theme ID for community (default: 'sietch') */
  themeId?: string;
  /** Discord guild ID if known */
  discordGuildId?: string;
  /** Enable verbose logging */
  debug?: boolean;
  /** Batch size for inserts (default: 100) */
  batchSize?: number;
}

// =============================================================================
// SQLite Migrator
// =============================================================================

/**
 * SQLiteMigrator handles the one-time migration from SQLite to PostgreSQL.
 *
 * @example
 * ```typescript
 * const migrator = new SQLiteMigrator(postgresDb, {
 *   sqliteDbPath: './profiles.db',
 *   communityName: 'The HoneyJar',
 *   discordGuildId: '123456789',
 * });
 *
 * const result = await migrator.migrate();
 * console.log(`Migrated ${result.profilesCreated} profiles`);
 * ```
 */
export class SQLiteMigrator {
  private readonly db: PostgresJsDatabase;
  private readonly options: Required<MigrationOptions>;
  private sqliteDb: Database.Database | null = null;

  // ID mapping: SQLite member_id -> PostgreSQL profile.id
  private memberIdMap: Map<string, string> = new Map();

  constructor(db: PostgresJsDatabase, options: MigrationOptions) {
    this.db = db;
    this.options = {
      sqliteDbPath: options.sqliteDbPath,
      communityName: options.communityName ?? 'Legacy Community',
      themeId: options.themeId ?? 'sietch',
      discordGuildId: options.discordGuildId ?? '',
      debug: options.debug ?? false,
      batchSize: options.batchSize ?? 100,
    };
  }

  /**
   * Execute the full migration
   */
  async migrate(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let communityId = '';
    let profilesCreated = 0;
    let badgesCreated = 0;
    let walletsProcessed = 0;

    try {
      this.log('Starting SQLite to PostgreSQL migration...');

      // Open SQLite database
      this.sqliteDb = new Database(this.options.sqliteDbPath, { readonly: true });
      this.log(`Opened SQLite database: ${this.options.sqliteDbPath}`);

      // Step 1: Create community for backfill
      communityId = await this.createCommunity();
      this.log(`Created community: ${communityId}`);

      // Step 2: Load wallet mappings
      const walletMap = this.loadWalletMappings();
      walletsProcessed = walletMap.size;
      this.log(`Loaded ${walletsProcessed} wallet mappings`);

      // Step 3: Load eligibility data for rank info
      const eligibilityMap = this.loadEligibilityData();
      this.log(`Loaded ${eligibilityMap.size} eligibility records`);

      // Step 4: Migrate profiles
      profilesCreated = await this.migrateProfiles(communityId, walletMap, eligibilityMap);
      this.log(`Migrated ${profilesCreated} profiles`);

      // Step 5: Migrate badges
      badgesCreated = await this.migrateBadges(communityId);
      this.log(`Migrated ${badgesCreated} badges`);

      this.log('Migration completed successfully!');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      this.log(`Migration failed: ${message}`, 'error');
    } finally {
      // Close SQLite connection
      if (this.sqliteDb) {
        this.sqliteDb.close();
        this.sqliteDb = null;
      }
    }

    return {
      success: errors.length === 0,
      communityId,
      profilesCreated,
      badgesCreated,
      walletsProcessed,
      errors,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate migration results
   */
  async validate(communityId: string): Promise<ValidationResult> {
    const mismatches: string[] = [];

    // Get SQLite counts
    this.sqliteDb = new Database(this.options.sqliteDbPath, { readonly: true });

    const sqliteProfiles = (
      this.sqliteDb.prepare('SELECT COUNT(*) as count FROM member_profiles').get() as { count: number }
    ).count;

    const sqliteBadges = (
      this.sqliteDb.prepare('SELECT COUNT(*) as count FROM member_badges WHERE revoked = 0').get() as { count: number }
    ).count;

    const sqliteWallets = (
      this.sqliteDb.prepare('SELECT COUNT(*) as count FROM wallet_mappings').get() as { count: number }
    ).count;

    this.sqliteDb.close();
    this.sqliteDb = null;

    // Get PostgreSQL counts
    const pgProfiles = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(profiles);
    const pgProfileCount = Number(pgProfiles[0]?.count ?? 0);

    const pgBadges = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(badges);
    const pgBadgeCount = Number(pgBadges[0]?.count ?? 0);

    // Check mismatches
    if (sqliteProfiles !== pgProfileCount) {
      mismatches.push(`Profile count mismatch: SQLite=${sqliteProfiles}, PostgreSQL=${pgProfileCount}`);
    }

    if (sqliteBadges !== pgBadgeCount) {
      mismatches.push(`Badge count mismatch: SQLite=${sqliteBadges}, PostgreSQL=${pgBadgeCount}`);
    }

    return {
      valid: mismatches.length === 0,
      sqliteCounts: {
        profiles: sqliteProfiles,
        badges: sqliteBadges,
        wallets: sqliteWallets,
      },
      postgresCounts: {
        profiles: pgProfileCount,
        badges: pgBadgeCount,
      },
      mismatches,
    };
  }

  /**
   * Rollback migration (delete all data for community)
   */
  async rollback(communityId: string): Promise<void> {
    this.log(`Rolling back migration for community: ${communityId}`);

    // Delete in order (badges -> profiles -> community) due to FKs
    await this.db.delete(badges).where(sql`community_id = ${communityId}::UUID`);
    await this.db.delete(profiles).where(sql`community_id = ${communityId}::UUID`);
    await this.db.delete(communities).where(sql`id = ${communityId}::UUID`);

    this.log('Rollback completed');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Create the community for backfill
   */
  private async createCommunity(): Promise<string> {
    const communityData: NewCommunity = {
      name: this.options.communityName,
      themeId: this.options.themeId,
      subscriptionTier: 'enterprise', // Legacy customers get enterprise
      discordGuildId: this.options.discordGuildId || null,
      isActive: true,
      settings: {
        rolePrefix: '',
        autoSync: true,
        syncInterval: 60,
      },
    };

    const result = await this.db.insert(communities).values(communityData).returning();
    const inserted = result[0];
    if (!inserted) {
      throw new Error('Failed to create community');
    }
    return inserted.id;
  }

  /**
   * Load wallet mappings from SQLite
   */
  private loadWalletMappings(): Map<string, SQLiteWalletMapping> {
    if (!this.sqliteDb) throw new Error('SQLite database not open');

    const walletMap = new Map<string, SQLiteWalletMapping>();

    const rows = this.sqliteDb
      .prepare('SELECT discord_user_id, wallet_address, verified_at FROM wallet_mappings')
      .all() as SQLiteWalletMapping[];

    for (const row of rows) {
      walletMap.set(row.discord_user_id, row);
    }

    return walletMap;
  }

  /**
   * Load eligibility data from SQLite
   */
  private loadEligibilityData(): Map<string, SQLiteEligibility> {
    if (!this.sqliteDb) throw new Error('SQLite database not open');

    const eligibilityMap = new Map<string, SQLiteEligibility>();

    const rows = this.sqliteDb
      .prepare('SELECT address, rank, bgt_held, role, updated_at FROM current_eligibility')
      .all() as SQLiteEligibility[];

    for (const row of rows) {
      // Key by lowercase address for lookup
      eligibilityMap.set(row.address.toLowerCase(), row);
    }

    return eligibilityMap;
  }

  /**
   * Migrate profiles from SQLite to PostgreSQL
   */
  private async migrateProfiles(
    communityId: string,
    walletMap: Map<string, SQLiteWalletMapping>,
    eligibilityMap: Map<string, SQLiteEligibility>
  ): Promise<number> {
    if (!this.sqliteDb) throw new Error('SQLite database not open');

    const rows = this.sqliteDb
      .prepare(`
        SELECT member_id, discord_user_id, nym, bio, pfp_url, pfp_type, tier,
               created_at, updated_at, nym_last_changed, onboarding_complete, onboarding_step
        FROM member_profiles
      `)
      .all() as SQLiteMemberProfile[];

    let created = 0;

    // Process in batches
    for (let i = 0; i < rows.length; i += this.options.batchSize) {
      const batch = rows.slice(i, i + this.options.batchSize);
      const profilesData: NewProfile[] = [];

      for (const row of batch) {
        // Generate new UUID for PostgreSQL
        const newId = randomUUID();
        this.memberIdMap.set(row.member_id, newId);

        // Get wallet from mapping
        const walletMapping = walletMap.get(row.discord_user_id);
        const walletAddress = walletMapping?.wallet_address?.toLowerCase() ?? null;

        // Get eligibility data
        const eligibility = walletAddress ? eligibilityMap.get(walletAddress) : null;

        // Map tier from SQLite format to PostgreSQL format
        const tier = this.mapTier(row.tier);

        // Build metadata
        const metadata: ProfileMetadata = {
          displayName: row.nym,
          username: row.nym,
          avatarUrl: row.pfp_url ?? undefined,
          highestTier: tier ?? undefined,
          highestRank: eligibility?.rank,
          preferences: {
            bio: row.bio,
            pfpType: row.pfp_type,
            onboardingComplete: row.onboarding_complete === 1,
            onboardingStep: row.onboarding_step,
          },
        };

        profilesData.push({
          id: newId,
          communityId,
          discordId: row.discord_user_id,
          telegramId: null,
          walletAddress,
          tier,
          currentRank: eligibility?.rank ?? null,
          activityScore: 0, // Will be recalculated
          convictionScore: 0, // Will be recalculated
          joinedAt: new Date(row.created_at),
          lastSeenAt: new Date(row.updated_at),
          firstClaimAt: null,
          metadata,
        });
      }

      // Insert batch
      if (profilesData.length > 0) {
        await this.db.insert(profiles).values(profilesData);
        created += profilesData.length;
      }

      this.log(`Processed profiles batch ${i / this.options.batchSize + 1}: ${created}/${rows.length}`);
    }

    return created;
  }

  /**
   * Migrate badges from SQLite to PostgreSQL
   */
  private async migrateBadges(communityId: string): Promise<number> {
    if (!this.sqliteDb) throw new Error('SQLite database not open');

    // Only migrate non-revoked badges
    const rows = this.sqliteDb
      .prepare(`
        SELECT id, member_id, badge_id, awarded_at, awarded_by, award_reason,
               revoked, revoked_at, revoked_by
        FROM member_badges
        WHERE revoked = 0
      `)
      .all() as SQLiteMemberBadge[];

    let created = 0;

    // Process in batches
    for (let i = 0; i < rows.length; i += this.options.batchSize) {
      const batch = rows.slice(i, i + this.options.batchSize);
      const badgesData: NewBadge[] = [];

      for (const row of batch) {
        // Map SQLite member_id to PostgreSQL profile.id
        const profileId = this.memberIdMap.get(row.member_id);
        if (!profileId) {
          this.log(`Warning: No profile found for member_id ${row.member_id}`, 'warn');
          continue;
        }

        // Map awarded_by if it exists (for Water Sharer lineage)
        const awardedByProfileId = row.awarded_by
          ? this.memberIdMap.get(row.awarded_by)
          : null;

        // Map badge type from SQLite format to PostgreSQL format
        const badgeType = this.mapBadgeType(row.badge_id);

        // Build metadata
        const metadata: BadgeMetadata = {
          badgeName: row.badge_id,
          context: row.award_reason ? { reason: row.award_reason } : undefined,
        };

        badgesData.push({
          communityId,
          profileId,
          badgeType,
          awardedAt: new Date(row.awarded_at),
          awardedBy: awardedByProfileId ?? null,
          revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
          metadata,
        });
      }

      // Insert batch
      if (badgesData.length > 0) {
        await this.db.insert(badges).values(badgesData);
        created += badgesData.length;
      }

      this.log(`Processed badges batch ${i / this.options.batchSize + 1}: ${created}/${rows.length}`);
    }

    return created;
  }

  /**
   * Map SQLite tier to PostgreSQL tier format
   */
  private mapTier(sqliteTier: string): string | null {
    // SQLite uses 'naib', 'fedaykin'
    // PostgreSQL uses the same but needs to handle edge cases
    const tierMap: Record<string, string> = {
      naib: 'naib',
      fedaykin: 'fedaykin',
      usul: 'usul',
      sayyadina: 'sayyadina',
      mushtamal: 'mushtamal',
      sihaya: 'sihaya',
      qanat: 'qanat',
      ichwan: 'ichwan',
      hajra: 'hajra',
    };

    return tierMap[sqliteTier.toLowerCase()] ?? null;
  }

  /**
   * Map SQLite badge_id to PostgreSQL badge_type format
   */
  private mapBadgeType(sqliteBadgeId: string): string {
    // Normalize badge type to snake_case
    // SQLite uses badge names like 'og', 'veteran', 'water_sharer'
    return sqliteBadgeId.toLowerCase().replace(/[- ]/g, '_');
  }

  /**
   * Log message
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.options.debug && level === 'info') return;

    const prefix = '[SQLiteMigrator]';
    switch (level) {
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new SQLiteMigrator instance
 *
 * @param db - Drizzle PostgresJsDatabase instance
 * @param options - Migration configuration
 * @returns SQLiteMigrator instance
 *
 * @example
 * ```typescript
 * const migrator = createSQLiteMigrator(db, {
 *   sqliteDbPath: './profiles.db',
 *   communityName: 'The HoneyJar',
 *   debug: true,
 * });
 *
 * const result = await migrator.migrate();
 * ```
 */
export function createSQLiteMigrator(
  db: PostgresJsDatabase,
  options: MigrationOptions
): SQLiteMigrator {
  return new SQLiteMigrator(db, options);
}
