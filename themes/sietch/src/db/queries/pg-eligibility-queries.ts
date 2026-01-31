/**
 * PostgreSQL Eligibility Queries (Sprint 175)
 *
 * PostgreSQL implementations of eligibility queries, replacing SQLite.
 * These queries operate on global tables (no RLS, no community_id).
 *
 * @module db/queries/pg-eligibility-queries
 */

import { eq, desc, and, gt, isNull, or, sql as drizzleSql } from 'drizzle-orm';
import postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { logger } from '../../utils/logger.js';
import type { EligibilityEntry, AdminOverride, SerializedEligibilityEntry } from '../../types/index.js';
import {
  eligibilityCurrent,
  eligibilitySnapshots,
  eligibilityAdminOverrides,
  eligibilityHealthStatus,
  walletVerifications,
} from '../pg-schema.js';

// =============================================================================
// Database Instance Management
// =============================================================================

let pgDb: PostgresJsDatabase | null = null;
let pgSql: ReturnType<typeof postgres> | null = null;

/**
 * Set the PostgreSQL database instance for eligibility queries
 */
export function setEligibilityPgDb(db: PostgresJsDatabase, rawSql?: ReturnType<typeof postgres>): void {
  pgDb = db;
  pgSql = rawSql ?? null;
  logger.info('PostgreSQL database set for eligibility queries');
}

/**
 * Set the raw postgres client for direct SQL operations
 */
export function setEligibilityPgSql(rawSql: ReturnType<typeof postgres>): void {
  pgSql = rawSql;
  logger.info('Raw postgres client set for eligibility queries');
}

/**
 * Get the PostgreSQL database instance
 * @throws Error if database not initialized
 */
export function getEligibilityPgDb(): PostgresJsDatabase {
  if (!pgDb) {
    throw new Error('PostgreSQL database not initialized for eligibility queries. Call setEligibilityPgDb() first.');
  }
  return pgDb;
}

/**
 * Check if PostgreSQL database is initialized
 */
export function isEligibilityPgDbInitialized(): boolean {
  return pgDb !== null;
}

// =============================================================================
// Snapshot Queries
// =============================================================================

/**
 * Save a new eligibility snapshot and update current eligibility table
 *
 * This is an atomic operation:
 * 1. Insert snapshot JSON into eligibility_snapshots
 * 2. Clear and repopulate eligibility_current with top 69 entries
 *
 * @param entries - Eligibility entries to save
 * @returns Snapshot ID
 */
export async function saveEligibilitySnapshotPg(entries: EligibilityEntry[]): Promise<number> {
  const db = getEligibilityPgDb();

  // Serialize entries for JSON storage (bigint -> string)
  const serialized: SerializedEligibilityEntry[] = entries.map((entry) => ({
    address: entry.address.toLowerCase(),
    bgtClaimed: entry.bgtClaimed.toString(),
    bgtBurned: entry.bgtBurned.toString(),
    bgtHeld: entry.bgtHeld.toString(),
    rank: entry.rank,
    role: entry.role,
  }));

  // Use transaction for atomicity
  const snapshotId = await db.transaction(async (tx) => {
    // 1. Insert snapshot
    const [snapshot] = await tx
      .insert(eligibilitySnapshots)
      .values({
        data: serialized,
      })
      .returning({ id: eligibilitySnapshots.id });

    if (!snapshot) {
      throw new Error('Failed to create eligibility snapshot');
    }

    // 2. Clear current eligibility
    await tx.delete(eligibilityCurrent);

    // 3. Insert current eligibility (only rank <= 69)
    // Note: Use NUMERIC for BigInt values - BIGINT overflows with wei amounts (18 decimals)
    const eligibleEntries = entries.filter((e) => e.rank !== undefined && e.rank <= 69);
    if (eligibleEntries.length > 0) {
      // Build VALUES clause with NUMERIC casting (handles arbitrary precision)
      const values = eligibleEntries.map((entry) =>
        `('${entry.address.toLowerCase()}', ${entry.rank}, ${entry.bgtClaimed.toString()}::numeric, ${entry.bgtBurned.toString()}::numeric, ${entry.bgtHeld.toString()}::numeric, '${entry.role}', NOW())`
      ).join(', ');

      await tx.execute(drizzleSql.raw(`
        INSERT INTO eligibility_current (address, rank, bgt_claimed, bgt_burned, bgt_held, role, updated_at)
        VALUES ${values}
      `));
    }

    return snapshot.id;
  });

  logger.info({ snapshotId, count: entries.length }, 'Saved eligibility snapshot to PostgreSQL');
  return snapshotId;
}

/**
 * Get the latest eligibility snapshot
 *
 * @returns Array of eligibility entries, or empty array if no snapshot exists
 */
export async function getLatestEligibilitySnapshotPg(): Promise<EligibilityEntry[]> {
  const db = getEligibilityPgDb();

  const [row] = await db
    .select({ data: eligibilitySnapshots.data })
    .from(eligibilitySnapshots)
    .orderBy(desc(eligibilitySnapshots.createdAt))
    .limit(1);

  if (!row) {
    return [];
  }

  const serialized = row.data as SerializedEligibilityEntry[];
  return serialized.map((entry) => ({
    address: entry.address as `0x${string}`,
    bgtClaimed: BigInt(entry.bgtClaimed),
    bgtBurned: BigInt(entry.bgtBurned),
    bgtHeld: BigInt(entry.bgtHeld),
    rank: entry.rank,
    role: entry.role,
  }));
}

// =============================================================================
// Current Eligibility Queries
// =============================================================================

/**
 * Get current eligibility for a specific wallet address
 *
 * @param address - Wallet address to look up
 * @returns Eligibility entry or null if not found
 */
export async function getEligibilityByAddressPg(address: string): Promise<EligibilityEntry | null> {
  const db = getEligibilityPgDb();

  const [row] = await db
    .select()
    .from(eligibilityCurrent)
    .where(eq(eligibilityCurrent.address, address.toLowerCase()))
    .limit(1);

  if (!row) {
    return null;
  }

  // Convert numeric strings back to BigInt (Drizzle returns strings for numeric type)
  return {
    address: row.address as `0x${string}`,
    bgtClaimed: BigInt(row.bgtClaimed),
    bgtBurned: BigInt(row.bgtBurned),
    bgtHeld: BigInt(row.bgtHeld),
    rank: row.rank,
    role: row.role as 'naib' | 'fedaykin' | 'none',
  };
}

/**
 * Get eligibility info from the latest snapshot for any wallet (including non-top-69)
 *
 * This searches the full snapshot JSON, not just eligibility_current,
 * so it can find rank info for wallets outside the top 69.
 *
 * @param address - Wallet address to look up
 * @returns Eligibility entry or null if not found in any snapshot
 */
export async function getEligibilityFromSnapshotPg(address: string): Promise<EligibilityEntry | null> {
  const db = getEligibilityPgDb();
  const normalizedAddress = address.toLowerCase();

  // Get the latest snapshot
  const [row] = await db
    .select({ data: eligibilitySnapshots.data })
    .from(eligibilitySnapshots)
    .orderBy(desc(eligibilitySnapshots.createdAt))
    .limit(1);

  if (!row) {
    return null;
  }

  const serialized = row.data as SerializedEligibilityEntry[];
  const entry = serialized.find((e) => e.address.toLowerCase() === normalizedAddress);

  if (!entry) {
    return null;
  }

  return {
    address: entry.address as `0x${string}`,
    bgtClaimed: BigInt(entry.bgtClaimed),
    bgtBurned: BigInt(entry.bgtBurned),
    bgtHeld: BigInt(entry.bgtHeld),
    rank: entry.rank,
    role: entry.role,
  };
}

/**
 * Get all current eligible entries (top 69), sorted by rank
 *
 * @returns Array of eligibility entries sorted by rank ascending
 */
export async function getCurrentEligibilityPg(): Promise<EligibilityEntry[]> {
  const db = getEligibilityPgDb();

  const rows = await db
    .select()
    .from(eligibilityCurrent)
    .orderBy(eligibilityCurrent.rank);

  // Convert numeric strings back to BigInt (Drizzle returns strings for numeric type)
  return rows.map((row) => ({
    address: row.address as `0x${string}`,
    bgtClaimed: BigInt(row.bgtClaimed),
    bgtBurned: BigInt(row.bgtBurned),
    bgtHeld: BigInt(row.bgtHeld),
    rank: row.rank,
    role: row.role as 'naib' | 'fedaykin' | 'none',
  }));
}

// =============================================================================
// Health Status Queries
// =============================================================================

/**
 * Update health status after successful sync
 *
 * @param lastSyncedBlock - Optional block number of last synced block
 */
export async function updateHealthStatusSuccessPg(lastSyncedBlock?: bigint): Promise<void> {
  const db = getEligibilityPgDb();

  await db
    .update(eligibilityHealthStatus)
    .set({
      lastSuccess: new Date(),
      consecutiveFailures: 0,
      inGracePeriod: false,
      lastSyncedBlock: lastSyncedBlock ?? null,
      updatedAt: new Date(),
    })
    .where(eq(eligibilityHealthStatus.id, 1));
}

/**
 * Update health status after failed sync
 */
export async function updateHealthStatusFailurePg(): Promise<void> {
  const db = getEligibilityPgDb();

  await db
    .update(eligibilityHealthStatus)
    .set({
      lastFailure: new Date(),
      consecutiveFailures: drizzleSql`${eligibilityHealthStatus.consecutiveFailures} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(eligibilityHealthStatus.id, 1));
}

/**
 * Get current health status
 */
export async function getHealthStatusPg(): Promise<{
  lastSuccess: Date | null;
  lastFailure: Date | null;
  consecutiveFailures: number;
  inGracePeriod: boolean;
  lastSyncedBlock: bigint | null;
}> {
  const db = getEligibilityPgDb();

  const [row] = await db
    .select()
    .from(eligibilityHealthStatus)
    .where(eq(eligibilityHealthStatus.id, 1));

  if (!row) {
    // Return defaults if no row exists
    return {
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      inGracePeriod: false,
      lastSyncedBlock: null,
    };
  }

  return {
    lastSuccess: row.lastSuccess,
    lastFailure: row.lastFailure,
    consecutiveFailures: row.consecutiveFailures,
    inGracePeriod: row.inGracePeriod,
    lastSyncedBlock: row.lastSyncedBlock,
  };
}

/**
 * Enter grace period (no revocations during outage)
 */
export async function enterGracePeriodPg(): Promise<void> {
  const db = getEligibilityPgDb();

  await db
    .update(eligibilityHealthStatus)
    .set({
      inGracePeriod: true,
      updatedAt: new Date(),
    })
    .where(eq(eligibilityHealthStatus.id, 1));

  logger.warn('Entered grace period - no revocations will occur');
}

/**
 * Exit grace period
 */
export async function exitGracePeriodPg(): Promise<void> {
  const db = getEligibilityPgDb();

  await db
    .update(eligibilityHealthStatus)
    .set({
      inGracePeriod: false,
      updatedAt: new Date(),
    })
    .where(eq(eligibilityHealthStatus.id, 1));

  logger.info('Exited grace period');
}

// =============================================================================
// Admin Override Queries
// =============================================================================

/**
 * Get all active admin overrides (not expired)
 *
 * @returns Array of active admin overrides
 */
export async function getActiveAdminOverridesPg(): Promise<AdminOverride[]> {
  const db = getEligibilityPgDb();

  const now = new Date();
  const rows = await db
    .select()
    .from(eligibilityAdminOverrides)
    .where(
      and(
        eq(eligibilityAdminOverrides.active, true),
        or(
          isNull(eligibilityAdminOverrides.expiresAt),
          gt(eligibilityAdminOverrides.expiresAt, now)
        )
      )
    );

  return rows.map((row) => ({
    id: row.id,
    address: row.address,
    action: row.action as 'add' | 'remove',
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    active: row.active,
  }));
}

/**
 * Create a new admin override
 *
 * @param override - Override data
 * @returns Created override ID
 */
export async function createAdminOverridePg(override: {
  address: string;
  action: 'add' | 'remove';
  reason: string;
  createdBy: string;
  expiresAt?: Date | null;
}): Promise<number> {
  const db = getEligibilityPgDb();

  const [result] = await db
    .insert(eligibilityAdminOverrides)
    .values({
      address: override.address.toLowerCase(),
      action: override.action,
      reason: override.reason,
      createdBy: override.createdBy,
      expiresAt: override.expiresAt ?? null,
      active: true,
    })
    .returning({ id: eligibilityAdminOverrides.id });

  if (!result) {
    throw new Error('Failed to create admin override');
  }

  logger.info({ overrideId: result.id, address: override.address, action: override.action }, 'Admin override created');
  return result.id;
}

/**
 * Deactivate an admin override
 *
 * @param id - Override ID to deactivate
 * @returns Whether the override was deactivated
 */
export async function deactivateAdminOverridePg(id: number): Promise<boolean> {
  const db = getEligibilityPgDb();

  const result = await db
    .update(eligibilityAdminOverrides)
    .set({ active: false })
    .where(eq(eligibilityAdminOverrides.id, id))
    .returning({ id: eligibilityAdminOverrides.id });

  return result.length > 0;
}

// =============================================================================
// Wallet Verification Queries
// =============================================================================

/**
 * Save a wallet verification mapping
 *
 * @param discordUserId - Discord user ID
 * @param walletAddress - Verified wallet address
 * @param signature - Optional EIP-191 signature
 * @param message - Optional signed message
 */
export async function saveWalletVerificationPg(
  discordUserId: string,
  walletAddress: string,
  signature?: string,
  message?: string
): Promise<void> {
  const db = getEligibilityPgDb();

  await db
    .insert(walletVerifications)
    .values({
      discordUserId,
      walletAddress: walletAddress.toLowerCase(),
      signature: signature ?? null,
      message: message ?? null,
      verifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: walletVerifications.discordUserId,
      set: {
        walletAddress: walletAddress.toLowerCase(),
        signature: signature ?? null,
        message: message ?? null,
        verifiedAt: new Date(),
      },
    });

  logger.info({ discordUserId, walletAddress }, 'Wallet verification saved to PostgreSQL');
}

/**
 * Get wallet address by Discord user ID
 *
 * @param discordUserId - Discord user ID to look up
 * @returns Wallet address or null if not found
 */
export async function getWalletByDiscordIdPg(discordUserId: string): Promise<string | null> {
  const db = getEligibilityPgDb();

  const [row] = await db
    .select({ walletAddress: walletVerifications.walletAddress })
    .from(walletVerifications)
    .where(eq(walletVerifications.discordUserId, discordUserId))
    .limit(1);

  return row?.walletAddress ?? null;
}

/**
 * Get Discord user ID by wallet address
 *
 * @param walletAddress - Wallet address to look up
 * @returns Discord user ID or null if not found
 */
export async function getDiscordIdByWalletPg(walletAddress: string): Promise<string | null> {
  const db = getEligibilityPgDb();

  const [row] = await db
    .select({ discordUserId: walletVerifications.discordUserId })
    .from(walletVerifications)
    .where(eq(walletVerifications.walletAddress, walletAddress.toLowerCase()))
    .limit(1);

  return row?.discordUserId ?? null;
}

/**
 * Delete wallet verification
 *
 * @param discordUserId - Discord user ID to delete
 * @returns Whether the verification was deleted
 */
export async function deleteWalletVerificationPg(discordUserId: string): Promise<boolean> {
  const db = getEligibilityPgDb();

  const result = await db
    .delete(walletVerifications)
    .where(eq(walletVerifications.discordUserId, discordUserId))
    .returning({ discordUserId: walletVerifications.discordUserId });

  return result.length > 0;
}
