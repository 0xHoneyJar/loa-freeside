#!/usr/bin/env npx tsx
/**
 * Migrate Existing Wallet Verifications to User Registry
 * Sprint 176: Global User Registry
 *
 * This script migrates existing wallet_verifications records from the
 * legacy table to the new User Registry event-sourced tables.
 *
 * Usage:
 *   npx tsx scripts/migrate-wallet-verifications-to-registry.ts [--dry-run] [--batch-size=100]
 *
 * Options:
 *   --dry-run      Show what would be migrated without making changes
 *   --batch-size   Number of records to process per batch (default: 100)
 *
 * @module scripts/migrate-wallet-verifications-to-registry
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  userIdentities,
  identityEvents,
  identityWallets,
} from '../src/db/pg-schema.js';
import { IdentityEventType } from '../src/services/user-registry/types.js';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const batchSizeArg = args.find((a) => a.startsWith('--batch-size='));
const batchSize = batchSizeArg ? parseInt(batchSizeArg.split('=')[1], 10) : 100;

// Statistics
const stats = {
  totalRecords: 0,
  identitiesCreated: 0,
  walletsLinked: 0,
  eventsRecorded: 0,
  skippedExisting: 0,
  errors: 0,
};

/**
 * Main migration function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('User Registry Migration Script');
  console.log('Sprint 176: Global User Registry');
  console.log('='.repeat(60));
  console.log('');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made');
    console.log('');
  }

  // Check database URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Connect to database
  console.log('Connecting to database...');
  const client = postgres(databaseUrl, { max: 5 });
  const db = drizzle(client) as PostgresJsDatabase;

  try {
    // Get existing wallet verifications count
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM wallet_verifications
      WHERE verified_at IS NOT NULL
    `);
    stats.totalRecords = Number(countResult[0]?.count ?? 0);

    console.log(`Found ${stats.totalRecords} verified wallet records to migrate`);
    console.log(`Processing in batches of ${batchSize}`);
    console.log('');

    if (stats.totalRecords === 0) {
      console.log('✅ No records to migrate');
      return;
    }

    // Process in batches
    let offset = 0;
    let batch = 1;

    while (offset < stats.totalRecords) {
      console.log(`Processing batch ${batch} (offset: ${offset})...`);

      // Fetch batch of wallet verifications
      const verifications = await db.execute(sql`
        SELECT
          discord_user_id,
          wallet_address,
          verified_at,
          signature,
          message
        FROM wallet_verifications
        WHERE verified_at IS NOT NULL
        ORDER BY verified_at ASC
        LIMIT ${batchSize}
        OFFSET ${offset}
      `);

      for (const record of verifications) {
        const discordId = String(record.discord_user_id);
        const walletAddress = String(record.wallet_address).toLowerCase();
        const verifiedAt = record.verified_at as Date;
        const signature = record.signature as string | null;
        const message = record.message as string | null;

        try {
          // Check if identity already exists
          const existingIdentity = await db
            .select({ identityId: userIdentities.identityId })
            .from(userIdentities)
            .where(eq(userIdentities.discordId, discordId))
            .limit(1);

          let identityId: string;

          if (existingIdentity.length > 0 && existingIdentity[0]) {
            identityId = existingIdentity[0].identityId;
            console.log(`  ⏭️  Identity exists for Discord ${discordId}: ${identityId}`);
          } else {
            // Create new identity
            if (!isDryRun) {
              const newIdentity = await db
                .insert(userIdentities)
                .values({
                  discordId,
                  discordUsername: null, // Unknown from legacy data
                  status: 'active',
                  createdAt: verifiedAt,
                  updatedAt: verifiedAt,
                })
                .returning({ identityId: userIdentities.identityId });

              identityId = newIdentity[0]!.identityId;

              // Record identity creation event
              await db.insert(identityEvents).values({
                identityId,
                eventType: IdentityEventType.IDENTITY_CREATED,
                eventData: {
                  discord_id: discordId,
                  migrated_from: 'wallet_verifications',
                },
                occurredAt: verifiedAt,
                source: 'migration',
                actorId: 'migration-script',
              });

              stats.identitiesCreated++;
              stats.eventsRecorded++;
            } else {
              identityId = 'dry-run-id';
            }
            console.log(`  ✨ Created identity for Discord ${discordId}`);
          }

          // Check if wallet already linked
          const existingWallet = await db
            .select()
            .from(identityWallets)
            .where(eq(identityWallets.address, walletAddress))
            .limit(1);

          if (existingWallet.length > 0) {
            console.log(`  ⏭️  Wallet ${walletAddress.slice(0, 10)}... already linked`);
            stats.skippedExisting++;
            continue;
          }

          // Check if this is the first wallet for identity
          const walletCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(identityWallets)
            .where(eq(identityWallets.identityId, identityId));

          const isFirstWallet = Number(walletCount[0]?.count ?? 0) === 0;

          // Link wallet
          if (!isDryRun) {
            await db.insert(identityWallets).values({
              identityId,
              address: walletAddress,
              chainId: 80094, // Berachain
              isPrimary: isFirstWallet,
              verifiedAt,
              verificationSource: 'migration',
              verificationSignature: signature,
              verificationMessage: message,
              status: 'active',
            });

            // Record wallet verification event
            await db.insert(identityEvents).values({
              identityId,
              eventType: IdentityEventType.WALLET_VERIFIED,
              eventData: {
                wallet_address: walletAddress,
                chain_id: 80094,
                is_primary: isFirstWallet,
                verification_source: 'migration',
                migrated_from: 'wallet_verifications',
              },
              occurredAt: verifiedAt,
              source: 'migration',
              actorId: 'migration-script',
            });

            // Update primary wallet on identity if this is first wallet
            if (isFirstWallet) {
              await db
                .update(userIdentities)
                .set({ primaryWallet: walletAddress })
                .where(eq(userIdentities.identityId, identityId));
            }

            stats.walletsLinked++;
            stats.eventsRecorded++;
          }
          console.log(`  🔗 Linked wallet ${walletAddress.slice(0, 10)}... to identity`);

        } catch (error) {
          console.error(`  ❌ Error processing Discord ${discordId}: ${(error as Error).message}`);
          stats.errors++;
        }
      }

      offset += batchSize;
      batch++;
    }

    // Print summary
    console.log('');
    console.log('='.repeat(60));
    console.log('Migration Summary');
    console.log('='.repeat(60));
    console.log(`Total records processed: ${stats.totalRecords}`);
    console.log(`Identities created: ${stats.identitiesCreated}`);
    console.log(`Wallets linked: ${stats.walletsLinked}`);
    console.log(`Events recorded: ${stats.eventsRecorded}`);
    console.log(`Skipped (already migrated): ${stats.skippedExisting}`);
    console.log(`Errors: ${stats.errors}`);
    console.log('');

    if (isDryRun) {
      console.log('🔍 DRY RUN complete - no changes were made');
    } else if (stats.errors > 0) {
      console.log('⚠️  Migration completed with errors');
    } else {
      console.log('✅ Migration completed successfully');
    }

  } catch (error) {
    console.error('❌ Migration failed:', (error as Error).message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run migration
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
