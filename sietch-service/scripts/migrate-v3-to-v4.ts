#!/usr/bin/env npx tsx

/**
 * V3 to V4 Migration Script (Sprint 29)
 *
 * Migrates existing single-tenant v3.0 data to v4.0 multi-tenant structure:
 * - Creates 'default' community record
 * - Assigns existing members to default community
 * - Sets default subscription to 'enterprise' (internal waiver)
 * - Verifies data integrity post-migration
 *
 * Usage:
 *   npx tsx scripts/migrate-v3-to-v4.ts [--dry-run] [--backup]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 *   --backup     Create database backup before migration
 */

import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
config({ path: '.env.local' });
config();

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COMMUNITY_ID = 'default';
const DEFAULT_COMMUNITY_NAME = 'Sietch Primary';
const DEFAULT_DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DATABASE_PATH = process.env.DATABASE_PATH || '/data/sietch.db';
const BACKUP_DIR = process.env.BACKUP_DIR || '/backups';

// =============================================================================
// Types
// =============================================================================

interface MigrationStats {
  membersProcessed: number;
  membersUpdated: number;
  communityCreated: boolean;
  subscriptionCreated: boolean;
  waiverGranted: boolean;
  errors: string[];
}

interface PreMigrationCounts {
  members: number;
  eligibleMembers: number;
  tierChanges: number;
  naibHistory: number;
}

// =============================================================================
// Migration Functions
// =============================================================================

async function createBackup(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `sietch.db.${timestamp}.bak`);

  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // Copy database file
  fs.copyFileSync(DATABASE_PATH, backupPath);

  console.log(`✓ Backup created: ${backupPath}`);
  return backupPath;
}

async function getPreMigrationCounts(db: any): Promise<PreMigrationCounts> {
  const memberCount = db.prepare('SELECT COUNT(*) as count FROM member_profiles').get() as { count: number };
  const eligibleCount = db.prepare('SELECT COUNT(*) as count FROM eligibility_snapshot').get() as { count: number };
  const tierChangeCount = db.prepare('SELECT COUNT(*) as count FROM tier_change_history').get() as { count: number };

  let naibHistoryCount = { count: 0 };
  try {
    naibHistoryCount = db.prepare('SELECT COUNT(*) as count FROM naib_history').get() as { count: number };
  } catch {
    // Table may not exist
  }

  return {
    members: memberCount.count,
    eligibleMembers: eligibleCount.count,
    tierChanges: tierChangeCount.count,
    naibHistory: naibHistoryCount.count,
  };
}

async function verifyPostMigration(db: any, preCounts: PreMigrationCounts): Promise<boolean> {
  const postCounts = await getPreMigrationCounts(db);

  console.log('\n=== Post-Migration Verification ===');
  console.log(`Members: ${preCounts.members} → ${postCounts.members} (expected: same)`);
  console.log(`Eligible: ${preCounts.eligibleMembers} → ${postCounts.eligibleMembers} (expected: same)`);
  console.log(`Tier Changes: ${preCounts.tierChanges} → ${postCounts.tierChanges} (expected: same)`);

  // Verify community assignment
  const membersWithCommunity = db
    .prepare('SELECT COUNT(*) as count FROM member_profiles WHERE community_id IS NOT NULL')
    .get() as { count: number };
  console.log(`Members with community: ${membersWithCommunity.count}/${postCounts.members}`);

  // All counts should match
  const countsMatch =
    preCounts.members === postCounts.members &&
    preCounts.eligibleMembers === postCounts.eligibleMembers &&
    preCounts.tierChanges === postCounts.tierChanges;

  // All members should have community
  const allMembersHaveCommunity = membersWithCommunity.count === postCounts.members;

  return countsMatch && allMembersHaveCommunity;
}

async function runMigration(dryRun: boolean): Promise<MigrationStats> {
  const stats: MigrationStats = {
    membersProcessed: 0,
    membersUpdated: 0,
    communityCreated: false,
    subscriptionCreated: false,
    waiverGranted: false,
    errors: [],
  };

  // Import database after env is loaded
  const { initDatabase, getDatabase } = await import('../src/db/index.js');

  // Initialize database
  initDatabase();
  const db = getDatabase();

  // Get pre-migration counts
  const preCounts = await getPreMigrationCounts(db);
  console.log('\n=== Pre-Migration Counts ===');
  console.log(`Total members: ${preCounts.members}`);
  console.log(`Eligible members: ${preCounts.eligibleMembers}`);
  console.log(`Tier change history: ${preCounts.tierChanges}`);
  console.log(`Naib history: ${preCounts.naibHistory}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would perform the following:');
  }

  // Step 1: Add community_id column if not exists
  console.log('\n--- Step 1: Ensure community_id column exists ---');
  try {
    const columns = db.prepare("PRAGMA table_info('member_profiles')").all() as { name: string }[];
    const hasCommunityId = columns.some((c) => c.name === 'community_id');

    if (!hasCommunityId) {
      if (!dryRun) {
        db.prepare('ALTER TABLE member_profiles ADD COLUMN community_id TEXT').run();
      }
      console.log(`${dryRun ? '[DRY RUN] Would add' : '✓ Added'} community_id column to member_profiles`);
    } else {
      console.log('✓ community_id column already exists');
    }
  } catch (error) {
    const msg = `Error adding community_id column: ${error}`;
    stats.errors.push(msg);
    console.error(msg);
  }

  // Step 2: Create default community in communities table
  console.log('\n--- Step 2: Create default community ---');
  try {
    // Check if communities table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='communities'").all();

    if (tables.length === 0) {
      // Create communities table if it doesn't exist
      if (!dryRun) {
        db.prepare(`
          CREATE TABLE IF NOT EXISTS communities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            discord_guild_id TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `).run();
      }
      console.log(`${dryRun ? '[DRY RUN] Would create' : '✓ Created'} communities table`);
    }

    // Check if default community exists
    const existing = db.prepare('SELECT id FROM communities WHERE id = ?').get(DEFAULT_COMMUNITY_ID);

    if (!existing) {
      if (!dryRun) {
        db.prepare(`
          INSERT INTO communities (id, name, discord_guild_id)
          VALUES (?, ?, ?)
        `).run(DEFAULT_COMMUNITY_ID, DEFAULT_COMMUNITY_NAME, DEFAULT_DISCORD_GUILD_ID);
      }
      stats.communityCreated = true;
      console.log(`${dryRun ? '[DRY RUN] Would create' : '✓ Created'} default community: ${DEFAULT_COMMUNITY_NAME}`);
    } else {
      console.log('✓ Default community already exists');
    }
  } catch (error) {
    const msg = `Error creating community: ${error}`;
    stats.errors.push(msg);
    console.error(msg);
  }

  // Step 3: Assign all members to default community
  console.log('\n--- Step 3: Assign members to default community ---');
  try {
    const members = db.prepare('SELECT member_id, community_id FROM member_profiles').all() as {
      member_id: string;
      community_id: string | null;
    }[];

    stats.membersProcessed = members.length;
    let needsUpdate = 0;

    for (const member of members) {
      if (!member.community_id) {
        needsUpdate++;
        if (!dryRun) {
          db.prepare('UPDATE member_profiles SET community_id = ? WHERE member_id = ?').run(
            DEFAULT_COMMUNITY_ID,
            member.member_id
          );
        }
      }
    }

    stats.membersUpdated = needsUpdate;
    console.log(
      `${dryRun ? '[DRY RUN] Would update' : '✓ Updated'} ${needsUpdate}/${members.length} members with community_id`
    );
  } catch (error) {
    const msg = `Error assigning members: ${error}`;
    stats.errors.push(msg);
    console.error(msg);
  }

  // Step 4: Create default subscription (enterprise tier via waiver)
  console.log('\n--- Step 4: Create enterprise waiver for default community ---');
  try {
    // Check if waiver already exists
    const existingWaiver = db
      .prepare('SELECT id FROM fee_waivers WHERE community_id = ? AND revoked_at IS NULL')
      .get(DEFAULT_COMMUNITY_ID);

    if (!existingWaiver) {
      if (!dryRun) {
        const waiverId = `waiver_migration_${Date.now()}`;
        const expiresAt = new Date('2099-12-31T23:59:59Z');

        db.prepare(`
          INSERT INTO fee_waivers (id, community_id, tier, reason, granted_by, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(waiverId, DEFAULT_COMMUNITY_ID, 'enterprise', 'V3 to V4 Migration - Internal Community', 'system', expiresAt.toISOString());
      }
      stats.waiverGranted = true;
      console.log(
        `${dryRun ? '[DRY RUN] Would grant' : '✓ Granted'} enterprise waiver to default community (expires 2099)`
      );
    } else {
      console.log('✓ Enterprise waiver already exists');
    }
  } catch (error) {
    const msg = `Error creating waiver: ${error}`;
    stats.errors.push(msg);
    console.error(msg);
  }

  // Step 5: Update eligibility_snapshot with community_id
  console.log('\n--- Step 5: Update eligibility snapshot ---');
  try {
    const columns = db.prepare("PRAGMA table_info('eligibility_snapshot')").all() as { name: string }[];
    const hasCommunityId = columns.some((c) => c.name === 'community_id');

    if (!hasCommunityId) {
      if (!dryRun) {
        db.prepare('ALTER TABLE eligibility_snapshot ADD COLUMN community_id TEXT DEFAULT ?').run(DEFAULT_COMMUNITY_ID);
        db.prepare('UPDATE eligibility_snapshot SET community_id = ? WHERE community_id IS NULL').run(
          DEFAULT_COMMUNITY_ID
        );
      }
      console.log(
        `${dryRun ? '[DRY RUN] Would add' : '✓ Added'} community_id to eligibility_snapshot`
      );
    } else {
      console.log('✓ eligibility_snapshot already has community_id');
    }
  } catch (error) {
    // Table may not exist or already have column
    console.log('Note: eligibility_snapshot migration skipped (may not need update)');
  }

  // Step 6: Verify migration
  if (!dryRun) {
    console.log('\n--- Step 6: Verify migration ---');
    const verified = await verifyPostMigration(db, preCounts);

    if (verified) {
      console.log('\n✓ Migration verified successfully');
    } else {
      stats.errors.push('Post-migration verification failed');
      console.error('\n✗ Migration verification failed');
    }
  }

  return stats;
}

// =============================================================================
// Rollback Function
// =============================================================================

async function rollback(backupPath: string): Promise<void> {
  console.log('\n=== Rolling back migration ===');

  if (!fs.existsSync(backupPath)) {
    console.error(`Backup file not found: ${backupPath}`);
    return;
  }

  // Restore database from backup
  fs.copyFileSync(backupPath, DATABASE_PATH);
  console.log(`✓ Database restored from: ${backupPath}`);
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const shouldBackup = args.includes('--backup');
  const shouldRollback = args.includes('--rollback');
  const rollbackPath = args.find((a) => a.startsWith('--rollback='))?.split('=')[1];

  console.log('='.repeat(60));
  console.log('Sietch V3 to V4 Migration Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Database: ${DATABASE_PATH}`);
  console.log(`Discord Guild: ${DEFAULT_DISCORD_GUILD_ID || '(not set)'}`);
  console.log('');

  // Handle rollback
  if (shouldRollback && rollbackPath) {
    await rollback(rollbackPath);
    return;
  }

  // Create backup if requested
  let backupPath: string | null = null;
  if (shouldBackup && !dryRun) {
    try {
      backupPath = await createBackup();
    } catch (error) {
      console.error(`Failed to create backup: ${error}`);
      console.error('Migration aborted. Use --dry-run to preview changes.');
      process.exit(1);
    }
  }

  try {
    // Run migration
    const stats = await runMigration(dryRun);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Members processed: ${stats.membersProcessed}`);
    console.log(`Members updated: ${stats.membersUpdated}`);
    console.log(`Community created: ${stats.communityCreated ? 'Yes' : 'No (already existed)'}`);
    console.log(`Subscription created: ${stats.subscriptionCreated ? 'Yes' : 'N/A (using waiver)'}`);
    console.log(`Waiver granted: ${stats.waiverGranted ? 'Yes' : 'No (already existed)'}`);
    console.log(`Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
      console.log('\nErrors:');
      for (const error of stats.errors) {
        console.log(`  - ${error}`);
      }
    }

    if (dryRun) {
      console.log('\n[DRY RUN] No changes were made.');
      console.log('Run without --dry-run to apply changes.');
    } else {
      console.log('\n✓ Migration complete');
      if (backupPath) {
        console.log(`\nTo rollback: npx tsx scripts/migrate-v3-to-v4.ts --rollback=${backupPath}`);
      }
    }
  } catch (error) {
    console.error('\nMigration failed:', error);

    if (backupPath && !dryRun) {
      console.log('\nAttempting automatic rollback...');
      await rollback(backupPath);
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
