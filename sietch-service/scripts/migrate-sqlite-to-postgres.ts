#!/usr/bin/env npx tsx

/**
 * SQLite to PostgreSQL Migration Script
 *
 * Sprint 41: Data Migration & SQLite Removal
 *
 * Migrates existing data from SQLite (profiles.db) to PostgreSQL with
 * automatic community_id backfill for multi-tenant support.
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --sqlite-path ./profiles.db --community-name "The HoneyJar"
 *
 * Options:
 *   --sqlite-path <path>       Path to SQLite database file (required)
 *   --community-name <name>    Community name for backfill (required)
 *   --discord-guild-id <id>    Discord guild ID (optional)
 *   --batch-size <n>           Batch size for inserts (default: 100)
 *   --dry-run                  Validate only, don't migrate (optional)
 *   --debug                    Enable verbose logging (optional)
 *
 * Examples:
 *   # Dry run to validate SQLite data
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --sqlite-path ./profiles.db --community-name "THJ" --dry-run
 *
 *   # Full migration with debug logging
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --sqlite-path ./profiles.db --community-name "THJ" --discord-guild-id "123456" --debug
 *
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *
 * @module scripts/migrate-sqlite-to-postgres
 */

import { config } from 'dotenv';
import { parseArgs } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  createSQLiteMigrator,
  createMigrationValidator,
} from '../src/packages/adapters/storage/migration/index.js';

// Load environment variables
config({ path: '.env.local' });
config();

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  sqlitePath: string;
  communityName: string;
  discordGuildId?: string;
  batchSize: number;
  dryRun: boolean;
  debug: boolean;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      'sqlite-path': { type: 'string' },
      'community-name': { type: 'string' },
      'discord-guild-id': { type: 'string' },
      'batch-size': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'debug': { type: 'boolean', default: false },
      'help': { type: 'boolean', default: false },
    },
  });

  if (values['help']) {
    printUsage();
    process.exit(0);
  }

  const sqlitePath = values['sqlite-path'];
  const communityName = values['community-name'];

  if (!sqlitePath) {
    console.error('Error: --sqlite-path is required');
    printUsage();
    process.exit(1);
  }

  if (!communityName) {
    console.error('Error: --community-name is required');
    printUsage();
    process.exit(1);
  }

  return {
    sqlitePath,
    communityName,
    discordGuildId: values['discord-guild-id'],
    batchSize: values['batch-size'] ? parseInt(values['batch-size'], 10) : 100,
    dryRun: values['dry-run'] ?? false,
    debug: values['debug'] ?? false,
  };
}

function printUsage(): void {
  console.log(`
SQLite to PostgreSQL Migration Script

Usage:
  npx tsx scripts/migrate-sqlite-to-postgres.ts [options]

Required Options:
  --sqlite-path <path>       Path to SQLite database file
  --community-name <name>    Community name for backfill

Optional Options:
  --discord-guild-id <id>    Discord guild ID
  --batch-size <n>           Batch size for inserts (default: 100)
  --dry-run                  Validate only, don't migrate
  --debug                    Enable verbose logging
  --help                     Show this help message

Environment Variables:
  DATABASE_URL               PostgreSQL connection string (required)

Examples:
  # Dry run
  npx tsx scripts/migrate-sqlite-to-postgres.ts --sqlite-path ./profiles.db --community-name "THJ" --dry-run

  # Full migration
  npx tsx scripts/migrate-sqlite-to-postgres.ts --sqlite-path ./profiles.db --community-name "THJ" --discord-guild-id "123456"
`);
}

// =============================================================================
// Pre-flight Checks
// =============================================================================

function preflightChecks(args: CliArgs): boolean {
  console.log('Running pre-flight checks...');
  let passed = true;

  // Check SQLite file exists
  if (!fs.existsSync(args.sqlitePath)) {
    console.error(`  [FAIL] SQLite file not found: ${args.sqlitePath}`);
    passed = false;
  } else {
    const stats = fs.statSync(args.sqlitePath);
    console.log(`  [OK] SQLite file found: ${args.sqlitePath} (${(stats.size / 1024).toFixed(2)} KB)`);
  }

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('  [FAIL] DATABASE_URL environment variable not set');
    passed = false;
  } else {
    const masked = process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`  [OK] DATABASE_URL configured: ${masked}`);
  }

  // Validate batch size
  if (args.batchSize < 1 || args.batchSize > 10000) {
    console.error(`  [FAIL] Invalid batch size: ${args.batchSize} (must be 1-10000)`);
    passed = false;
  } else {
    console.log(`  [OK] Batch size: ${args.batchSize}`);
  }

  console.log();
  return passed;
}

// =============================================================================
// Main Migration Function
// =============================================================================

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   SQLite to PostgreSQL Migration - Sprint 41               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();

  // Parse CLI arguments
  const args = parseCliArgs();

  console.log('Configuration:');
  console.log(`  SQLite path:      ${args.sqlitePath}`);
  console.log(`  Community name:   ${args.communityName}`);
  console.log(`  Discord guild ID: ${args.discordGuildId || '(not set)'}`);
  console.log(`  Batch size:       ${args.batchSize}`);
  console.log(`  Dry run:          ${args.dryRun}`);
  console.log(`  Debug:            ${args.debug}`);
  console.log();

  // Run pre-flight checks
  if (!preflightChecks(args)) {
    console.error('Pre-flight checks failed. Aborting migration.');
    process.exit(1);
  }

  console.log('Pre-flight checks passed.');
  console.log();

  // Connect to PostgreSQL
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const db = drizzle(client);

  try {
    // Test PostgreSQL connection
    console.log('Testing PostgreSQL connection...');
    await client`SELECT 1`;
    console.log('  [OK] PostgreSQL connection successful');
    console.log();

    // Create migrator
    const migrator = createSQLiteMigrator(db, {
      sqliteDbPath: args.sqlitePath,
      communityName: args.communityName,
      discordGuildId: args.discordGuildId,
      batchSize: args.batchSize,
      debug: args.debug,
    });

    if (args.dryRun) {
      // Dry run mode - validate only
      console.log('═══════════════════════════════════════════════════════════');
      console.log('DRY RUN MODE - Validation Only');
      console.log('═══════════════════════════════════════════════════════════');
      console.log();
      console.log('This would migrate data from SQLite to PostgreSQL.');
      console.log('No data will be modified in this mode.');
      console.log();

      // We can still open SQLite and show counts
      const Database = (await import('better-sqlite3')).default;
      const sqliteDb = new Database(args.sqlitePath, { readonly: true });

      try {
        const profileCount = (sqliteDb.prepare('SELECT COUNT(*) as count FROM member_profiles').get() as { count: number }).count;
        const badgeCount = (sqliteDb.prepare('SELECT COUNT(*) as count FROM member_badges WHERE revoked = 0').get() as { count: number }).count;
        const walletCount = (sqliteDb.prepare('SELECT COUNT(*) as count FROM wallet_mappings').get() as { count: number }).count;

        console.log('SQLite Data Summary:');
        console.log(`  Profiles:        ${profileCount}`);
        console.log(`  Active badges:   ${badgeCount}`);
        console.log(`  Wallet mappings: ${walletCount}`);
        console.log();
        console.log('Ready to migrate. Run without --dry-run to execute.');
      } finally {
        sqliteDb.close();
      }
    } else {
      // Execute migration
      console.log('═══════════════════════════════════════════════════════════');
      console.log('EXECUTING MIGRATION');
      console.log('═══════════════════════════════════════════════════════════');
      console.log();

      const startTime = Date.now();
      const result = await migrator.migrate();
      const duration = Date.now() - startTime;

      if (!result.success) {
        console.error('');
        console.error('Migration FAILED!');
        console.error('Errors:');
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
        console.error('');
        console.error('No data was committed. Please investigate and retry.');
        process.exit(1);
      }

      console.log('');
      console.log('Migration completed successfully!');
      console.log('');
      console.log('Results:');
      console.log(`  Community ID:      ${result.communityId}`);
      console.log(`  Profiles created:  ${result.profilesCreated}`);
      console.log(`  Badges created:    ${result.badgesCreated}`);
      console.log(`  Wallets processed: ${result.walletsProcessed}`);
      console.log(`  Duration:          ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
      console.log('');

      // Run validation
      console.log('═══════════════════════════════════════════════════════════');
      console.log('VALIDATING MIGRATION');
      console.log('═══════════════════════════════════════════════════════════');
      console.log();

      const validator = createMigrationValidator(db, {
        sqliteDbPath: args.sqlitePath,
        communityId: result.communityId,
        debug: args.debug,
      });

      const report = await validator.generateReport();
      console.log(report);

      // Parse validation result from report
      const validationResult = await validator.validate();

      if (!validationResult.valid) {
        console.error('');
        console.error('VALIDATION FAILED!');
        console.error('');
        console.error('Data integrity issues detected. Consider rolling back:');
        console.error(`  npx tsx scripts/rollback-migration.ts --community-id ${result.communityId}`);
        console.error('');
        process.exit(1);
      }

      console.log('');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('MIGRATION COMPLETE');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('');
      console.log(`Community ID: ${result.communityId}`);
      console.log('');
      console.log('Next steps:');
      console.log('  1. Run full test suite: npm test');
      console.log('  2. Verify application functionality');
      console.log('  3. Remove SQLite dependency: npm uninstall better-sqlite3 @types/better-sqlite3');
      console.log('  4. Update deployment documentation');
      console.log('');
      console.log('To rollback if issues arise:');
      console.log(`  npx tsx scripts/rollback-migration.ts --community-id ${result.communityId}`);
    }
  } catch (error) {
    console.error('');
    console.error('Migration error:', error);
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
