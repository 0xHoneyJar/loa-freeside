#!/usr/bin/env npx tsx

/**
 * Initial Tier Assignment Script (Sprint 16: S16-T4)
 *
 * Assigns tiers to all existing onboarded members based on their current BGT holdings and rank.
 * This script is idempotent - safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/assign-initial-tiers.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 */

import { config } from 'dotenv';
import { initDatabase, getDatabase, getLatestEligibilitySnapshot, getDiscordIdByWallet, getMemberProfileByDiscordId } from '../src/db/index.js';
import { tierService, syncTierRole, assignTierRolesUpTo, isTierRolesConfigured } from '../src/services/index.js';
import { discordService } from '../src/services/discord.js';
import type { Tier } from '../src/types/index.js';
import { logger } from '../src/utils/logger.js';

// Load environment variables
config({ path: '.env.local' });
config();

interface TierAssignment {
  memberId: string;
  discordId: string;
  discordUsername?: string;
  oldTier: Tier | null;
  newTier: Tier;
  bgt: number;
  rank: number | null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(60));
  console.log('Initial Tier Assignment Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log('');

  // Initialize database
  console.log('Initializing database...');
  initDatabase();

  // Check if tier roles are configured
  if (!dryRun && !isTierRolesConfigured()) {
    console.warn('WARNING: Tier roles not fully configured. Some Discord role assignments may fail.');
    console.warn('Configure DISCORD_ROLE_* environment variables for all tiers.');
    console.warn('');
  }

  // Get latest eligibility snapshot
  console.log('Loading latest eligibility snapshot...');
  const eligibility = getLatestEligibilitySnapshot();
  console.log(`Found ${eligibility.length} entries in eligibility snapshot`);

  // Build wallet-to-entry map
  const walletToEntry = new Map<string, typeof eligibility[0]>();
  for (const entry of eligibility) {
    walletToEntry.set(entry.address.toLowerCase(), entry);
  }

  // Get all onboarded members
  console.log('Loading onboarded members...');
  const db = getDatabase();
  const members = db.prepare(`
    SELECT member_id, discord_user_id, tier, wallet_address
    FROM member_profiles
    WHERE onboarding_complete = 1
  `).all() as Array<{
    member_id: string;
    discord_user_id: string;
    tier: string | null;
    wallet_address: string | null;
  }>;

  console.log(`Found ${members.length} onboarded members`);
  console.log('');

  // Track assignments
  const assignments: TierAssignment[] = [];
  const skipped: { memberId: string; reason: string }[] = [];
  const errors: { memberId: string; error: string }[] = [];

  // Calculate tier for each member
  console.log('Calculating tiers...');
  for (const member of members) {
    try {
      // Look up wallet in eligibility
      const wallet = member.wallet_address?.toLowerCase();
      if (!wallet) {
        skipped.push({ memberId: member.member_id, reason: 'No wallet address' });
        continue;
      }

      const entry = walletToEntry.get(wallet);
      if (!entry) {
        skipped.push({ memberId: member.member_id, reason: 'Wallet not in eligibility snapshot' });
        continue;
      }

      // Calculate tier
      const newTier = tierService.calculateTier(entry.bgtHeld, entry.rank ?? null);
      const oldTier = member.tier as Tier | null;

      // Check if tier needs to be assigned or changed
      if (oldTier !== newTier) {
        assignments.push({
          memberId: member.member_id,
          discordId: member.discord_user_id,
          oldTier,
          newTier,
          bgt: Number(BigInt(entry.bgtHeld)) / 1e18,
          rank: entry.rank ?? null,
        });
      } else {
        skipped.push({ memberId: member.member_id, reason: 'Already at correct tier' });
      }
    } catch (error) {
      errors.push({
        memberId: member.member_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Report summary
  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Total members:      ${members.length}`);
  console.log(`To be assigned:     ${assignments.length}`);
  console.log(`Skipped:            ${skipped.length}`);
  console.log(`Errors:             ${errors.length}`);
  console.log('');

  // Show assignments by tier
  const byTier = new Map<Tier, number>();
  for (const a of assignments) {
    byTier.set(a.newTier, (byTier.get(a.newTier) ?? 0) + 1);
  }
  console.log('Assignments by tier:');
  for (const [tier, count] of byTier) {
    console.log(`  ${tier.padEnd(12)}: ${count}`);
  }
  console.log('');

  // Show errors if any
  if (errors.length > 0) {
    console.log('Errors:');
    for (const { memberId, error } of errors) {
      console.log(`  ${memberId}: ${error}`);
    }
    console.log('');
  }

  if (dryRun) {
    console.log('DRY RUN - No changes made.');
    console.log('');
    console.log('Sample assignments:');
    for (const a of assignments.slice(0, 10)) {
      console.log(`  ${a.memberId}: ${a.oldTier ?? 'none'} -> ${a.newTier} (BGT: ${a.bgt.toFixed(2)}, Rank: ${a.rank ?? 'N/A'})`);
    }
    if (assignments.length > 10) {
      console.log(`  ... and ${assignments.length - 10} more`);
    }
    return;
  }

  // Apply assignments
  console.log('Applying tier assignments...');
  let applied = 0;
  let rolesSynced = 0;

  // Connect Discord if not already connected
  if (!discordService.isConnected()) {
    console.log('Connecting to Discord...');
    try {
      await discordService.connect();
      console.log('Discord connected');
    } catch (error) {
      console.warn('Failed to connect to Discord - role sync will be skipped');
    }
  }

  for (const assignment of assignments) {
    try {
      // Update tier in database
      const updated = await tierService.updateMemberTier(
        assignment.memberId,
        assignment.newTier,
        (assignment.bgt * 1e18).toString(),
        assignment.rank,
        assignment.oldTier
      );

      if (updated) {
        applied++;

        // Sync Discord roles
        if (discordService.isConnected()) {
          try {
            const roleResult = await assignTierRolesUpTo(assignment.discordId, assignment.newTier);
            if (roleResult > 0) {
              rolesSynced++;
            }
          } catch (roleError) {
            console.warn(`  Failed to sync roles for ${assignment.memberId}: ${roleError}`);
          }
        }

        // Progress indicator
        if (applied % 10 === 0) {
          console.log(`  Processed ${applied}/${assignments.length}...`);
        }
      }
    } catch (error) {
      console.error(`  Failed to assign tier for ${assignment.memberId}: ${error}`);
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Complete');
  console.log('='.repeat(60));
  console.log(`Tiers assigned:     ${applied}`);
  console.log(`Roles synced:       ${rolesSynced}`);
  console.log('');
  console.log('Run the eligibility sync task to assign Discord roles to any remaining members.');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
