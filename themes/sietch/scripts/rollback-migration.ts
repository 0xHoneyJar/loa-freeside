#!/usr/bin/env npx tsx

/**
 * Migration Rollback Script
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Rolls back a SQLite to PostgreSQL migration by deleting all data
 * associated with a community ID.
 *
 * WARNING: This is a destructive operation. Data cannot be recovered
 * once deleted. Ensure you have backups before proceeding.
 *
 * Usage:
 *   npx tsx scripts/rollback-migration.ts --community-id <uuid>
 *
 * Options:
 *   --community-id <uuid>   Community ID to rollback (required)
 *   --confirm               Skip confirmation prompt (for automation)
 *   --debug                 Enable verbose logging
 *
 * @module scripts/rollback-migration
 */

import { config } from 'dotenv';
import { parseArgs } from 'util';
import * as readline from 'readline';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

import { badges, profiles, communities } from '../src/packages/adapters/storage/schema.js';

// Load environment variables
config({ path: '.env.local' });
config();

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  communityId: string;
  confirm: boolean;
  debug: boolean;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      'community-id': { type: 'string' },
      'confirm': { type: 'boolean', default: false },
      'debug': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false },
    },
  });

  if (values['help']) {
    printUsage();
    process.exit(0);
  }

  const communityId = values['community-id'];

  if (!communityId) {
    console.error('Error: --community-id is required');
    printUsage();
    process.exit(1);
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(communityId)) {
    console.error(`Error: Invalid community ID format: ${communityId}`);
    console.error('Expected UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    process.exit(1);
  }

  return {
    communityId,
    confirm: values['confirm'] ?? false,
    debug: values['debug'] ?? false,
  };
}

function printUsage(): void {
  console.log(`
Migration Rollback Script

WARNING: This is a DESTRUCTIVE operation. All data for the specified
community will be permanently deleted.

Usage:
  npx tsx scripts/rollback-migration.ts --community-id <uuid>

Required Options:
  --community-id <uuid>    Community ID to rollback

Optional Options:
  --confirm               Skip confirmation prompt (for automation)
  --debug                 Enable verbose logging
  --help                  Show this help message

Environment Variables:
  DATABASE_URL            PostgreSQL connection string (required)

Example:
  npx tsx scripts/rollback-migration.ts --community-id 123e4567-e89b-12d3-a456-426614174000
`);
}

// =============================================================================
// Confirmation Prompt
// =============================================================================

async function promptConfirmation(communityId: string, counts: { badges: number; profiles: number }): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                   ⚠️  WARNING ⚠️                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('This will permanently delete:');
    console.log(`  - ${counts.badges} badges`);
    console.log(`  - ${counts.profiles} profiles`);
    console.log(`  - 1 community (${communityId})`);
    console.log('');
    console.log('This action CANNOT be undone.');
    console.log('');

    rl.question('Type "DELETE" to confirm rollback: ', (answer) => {
      rl.close();
      resolve(answer === 'DELETE');
    });
  });
}

// =============================================================================
// Main Rollback Function
// =============================================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Migration Rollback - Sprint 41                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Parse CLI arguments
  const args = parseCliArgs();

  console.log('Configuration:');
  console.log(`  Community ID: ${args.communityId}`);
  console.log(`  Auto-confirm: ${args.confirm}`);
  console.log(`  Debug:        ${args.debug}`);
  console.log();

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  // Connect to PostgreSQL
  const connectionString = process.env.DATABASE_URL;
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client);

  try {
    // Test connection
    console.log('Connecting to PostgreSQL...');
    await client`SELECT 1`;
    console.log('  [OK] Connected');
    console.log();

    // Get current counts
    console.log('Checking data to be deleted...');

    const badgeCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(badges)
      .where(sql`community_id = ${args.communityId}::UUID`);
    const badgeCount = Number(badgeCountResult[0]?.count ?? 0);

    const profileCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(profiles)
      .where(sql`community_id = ${args.communityId}::UUID`);
    const profileCount = Number(profileCountResult[0]?.count ?? 0);

    const communityResult = await db
      .select()
      .from(communities)
      .where(sql`id = ${args.communityId}::UUID`)
      .limit(1);
    const communityExists = communityResult.length > 0;

    console.log(`  Badges:    ${badgeCount}`);
    console.log(`  Profiles:  ${profileCount}`);
    console.log(`  Community: ${communityExists ? 'exists' : 'NOT FOUND'}`);
    console.log();

    if (!communityExists && badgeCount === 0 && profileCount === 0) {
      console.log('No data found for this community ID. Nothing to rollback.');
      process.exit(0);
    }

    // Confirm deletion
    if (!args.confirm) {
      const confirmed = await promptConfirmation(args.communityId, { badges: badgeCount, profiles: profileCount });
      if (!confirmed) {
        console.log('');
        console.log('Rollback cancelled.');
        process.exit(0);
      }
    }

    // Execute rollback
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('EXECUTING ROLLBACK');
    console.log('═══════════════════════════════════════════════════════════');
    console.log();

    const startTime = Date.now();

    // Delete in FK order: badges -> profiles -> communities
    if (args.debug) console.log('Deleting badges...');
    await db.delete(badges).where(sql`community_id = ${args.communityId}::UUID`);
    console.log(`  [OK] Deleted ${badgeCount} badges`);

    if (args.debug) console.log('Deleting profiles...');
    await db.delete(profiles).where(sql`community_id = ${args.communityId}::UUID`);
    console.log(`  [OK] Deleted ${profileCount} profiles`);

    if (communityExists) {
      if (args.debug) console.log('Deleting community...');
      await db.delete(communities).where(sql`id = ${args.communityId}::UUID`);
      console.log('  [OK] Deleted community');
    }

    const duration = Date.now() - startTime;

    console.log();
    console.log('═══════════════════════════════════════════════════════════');
    console.log('ROLLBACK COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log();
    console.log(`Duration: ${duration}ms`);
    console.log();
    console.log('Next steps:');
    console.log('  1. Investigate why rollback was needed');
    console.log('  2. Fix migration issues');
    console.log('  3. Re-run migration when ready');
  } catch (error) {
    console.error('');
    console.error('Rollback error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
