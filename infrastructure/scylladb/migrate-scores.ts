/**
 * Score Migration Script
 * Sprint S-3: ScyllaDB & Observability Foundation
 *
 * Migrates scores from PostgreSQL to ScyllaDB
 *
 * Usage:
 *   npx tsx infrastructure/scylladb/migrate-scores.ts [--dry-run] [--batch-size=1000]
 */

import { Client } from 'cassandra-driver';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

// Configuration from environment
const POSTGRES_URL = process.env['DATABASE_URL'] || 'postgresql://localhost:5432/arrakis';
const SCYLLA_CONTACT_POINTS = process.env['SCYLLA_CONTACT_POINTS']?.split(',') || ['localhost'];
const SCYLLA_KEYSPACE = process.env['SCYLLA_KEYSPACE'] || 'arrakis';
const SCYLLA_USERNAME = process.env['SCYLLA_USERNAME'] || 'cassandra';
const SCYLLA_PASSWORD = process.env['SCYLLA_PASSWORD'] || 'cassandra';
const SCYLLA_LOCAL_DC = process.env['SCYLLA_LOCAL_DC'] || 'datacenter1';

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 1000;

interface ProfileScore {
  id: string;
  community_id: string;
  discord_id: string;
  conviction_score: string;
  activity_score: string;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Score Migration: PostgreSQL → ScyllaDB');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Batch Size: ${batchSize}`);
  console.log('');

  // Connect to PostgreSQL
  console.log('Connecting to PostgreSQL...');
  const pgPool = new Pool({ connectionString: POSTGRES_URL });
  const db = drizzle(pgPool);

  // Connect to ScyllaDB (skip in dry-run)
  let scyllaClient: Client | null = null;

  if (!dryRun) {
    console.log('Connecting to ScyllaDB...');
    scyllaClient = new Client({
      contactPoints: SCYLLA_CONTACT_POINTS,
      localDataCenter: SCYLLA_LOCAL_DC,
      keyspace: SCYLLA_KEYSPACE,
      credentials: { username: SCYLLA_USERNAME, password: SCYLLA_PASSWORD },
    });
    await scyllaClient.connect();
    console.log('ScyllaDB connected');
  }

  try {
    // Count total profiles with scores
    console.log('\nCounting profiles with scores...');
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM profiles WHERE conviction_score IS NOT NULL OR activity_score IS NOT NULL
    `);
    const totalCount = parseInt(countResult.rows[0]?.count as string, 10) || 0;
    console.log(`Found ${totalCount} profiles with scores`);

    if (totalCount === 0) {
      console.log('No scores to migrate. Exiting.');
      return;
    }

    // Migrate in batches
    let migrated = 0;
    let failed = 0;
    let offset = 0;

    console.log('\nStarting migration...');
    const startTime = Date.now();

    while (offset < totalCount) {
      // Fetch batch from PostgreSQL
      const profiles = await db.execute<ProfileScore>(sql`
        SELECT id, community_id, discord_id,
               COALESCE(conviction_score, '0') as conviction_score,
               COALESCE(activity_score, '0') as activity_score
        FROM profiles
        WHERE conviction_score IS NOT NULL OR activity_score IS NOT NULL
        ORDER BY created_at
        LIMIT ${batchSize} OFFSET ${offset}
      `);

      if (profiles.rows.length === 0) break;

      // Prepare batch for ScyllaDB
      const queries = profiles.rows.flatMap((profile, index) => {
        const rank = offset + index + 1; // Simple rank based on order
        const now = new Date();

        return [
          {
            query: `INSERT INTO scores (community_id, profile_id, conviction_score, activity_score, current_rank, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`,
            params: [
              profile.community_id,
              profile.id,
              profile.conviction_score,
              profile.activity_score,
              rank,
              now,
            ],
          },
          {
            query: `INSERT INTO scores_by_profile (community_id, profile_id, conviction_score, activity_score, current_rank, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`,
            params: [
              profile.community_id,
              profile.id,
              profile.conviction_score,
              profile.activity_score,
              rank,
              now,
            ],
          },
        ];
      });

      // Execute batch (or log in dry-run)
      if (dryRun) {
        console.log(`[DRY RUN] Would migrate ${profiles.rows.length} profiles (offset ${offset})`);
        migrated += profiles.rows.length;
      } else if (scyllaClient) {
        try {
          // Execute in smaller sub-batches for ScyllaDB limits
          const subBatchSize = 50;
          for (let i = 0; i < queries.length; i += subBatchSize) {
            const subBatch = queries.slice(i, i + subBatchSize);
            await scyllaClient.batch(subBatch, { prepare: true });
          }
          migrated += profiles.rows.length;
        } catch (error) {
          console.error(`Batch failed at offset ${offset}:`, error);
          failed += profiles.rows.length;
        }
      }

      offset += batchSize;
      const progress = Math.min(100, Math.round((offset / totalCount) * 100));
      process.stdout.write(`\rProgress: ${progress}% (${migrated}/${totalCount})`);
    }

    const duration = Date.now() - startTime;
    console.log('\n');
    console.log('='.repeat(60));
    console.log('Migration Complete');
    console.log('='.repeat(60));
    console.log(`Total Profiles: ${totalCount}`);
    console.log(`Migrated: ${migrated}`);
    console.log(`Failed: ${failed}`);
    console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
    console.log(`Rate: ${Math.round(migrated / (duration / 1000))} profiles/sec`);

    if (failed > 0) {
      console.log('\nWARNING: Some profiles failed to migrate. Check logs above.');
      process.exit(1);
    }

  } finally {
    // Cleanup
    await pgPool.end();
    if (scyllaClient) {
      await scyllaClient.shutdown();
    }
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
