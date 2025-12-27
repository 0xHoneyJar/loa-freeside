import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { SCHEMA_SQL, CLEANUP_OLD_SNAPSHOTS_SQL, SOCIAL_LAYER_SCHEMA_SQL, BILLING_SCHEMA_SQL, BADGES_SCHEMA_SQL, BOOSTS_SCHEMA_SQL, TELEGRAM_IDENTITY_SAFE_SQL } from './schema.js';
import type {
  EligibilityEntry,
  SerializedEligibilityEntry,
  HealthStatus,
  AdminOverride,
  AuditLogEntry,
  WalletMapping,
  MemberProfile,
  PublicProfile,
  Badge,
  PublicBadge,
  MemberBadge,
  MemberActivity,
  DirectoryFilters,
  DirectoryResult,
  ProfileUpdateRequest,
  WaitlistRegistration,
  ThresholdSnapshot,
  NotificationPreferences,
  AlertFrequency,
  AlertRecord,
  AlertType,
  AlertData,
} from '../types/index.js';

let db: Database.Database | null = null;

/**
 * Default story fragments for seeding (Sprint 21)
 * Cryptic Dune-themed narratives for elite member joins
 */
const DEFAULT_STORY_FRAGMENTS = {
  fedaykin_join: [
    `The desert wind carried whispers of a new arrival.
One who had held their water, never trading the sacred spice.
The sietch grows stronger.`,
    `Footsteps in the sand revealed a traveler from distant dunes.
They bore no marks of the water sellers.
A new Fedaykin has earned their place.`,
    `The winds shifted across the Great Bled.
A new figure emerged from the dancing sands,
their stillsuit bearing the marks of deep desert travel.

The watermasters took note.
Another has proven their worth in the spice trade.

A new Fedaykin walks among us.`,
    `Beneath the twin moons, a shadow moved with purpose.
The sand gave no resistance to their practiced steps.
One more keeper of the ancient way has joined our ranks.`,
    `The sietch's heartbeat grows louder.
Another warrior of the deep desert approaches,
their loyalty to the spice unbroken, their resolve unshaken.`,
  ],
  naib_join: [
    `The council chamber stirred.
A presence of great weight approached -
one whose reserves of melange could shift the balance.
A new voice joins the Naib.`,
    `The sands trembled with significance.
One of profound holdings has crossed the threshold,
their wisdom forged in the crucible of scarcity.
The Naib Council is complete once more.`,
    `Ancient traditions speak of leaders rising from the dunes.
Today, the prophecy continues.
A new Naib takes their seat among the watermasters.`,
  ],
};

/**
 * Seed default story fragments if table is empty
 * This is called automatically during database initialization
 * Idempotent - only seeds if table is empty
 */
function seedDefaultStoryFragments(database: Database.Database): void {
  // Check if fragments already exist
  const existingCount = database
    .prepare('SELECT COUNT(*) as count FROM story_fragments')
    .get() as { count: number };

  if (existingCount.count > 0) {
    logger.debug(
      { count: existingCount.count },
      'Story fragments already seeded, skipping'
    );
    return;
  }

  logger.info('Seeding default story fragments...');

  const insertStmt = database.prepare(
    `INSERT INTO story_fragments (id, category, content, used_count) VALUES (?, ?, ?, ?)`
  );

  let totalInserted = 0;

  // Insert Fedaykin fragments
  for (const content of DEFAULT_STORY_FRAGMENTS.fedaykin_join) {
    insertStmt.run(randomUUID(), 'fedaykin_join', content, 0);
    totalInserted++;
  }

  // Insert Naib fragments
  for (const content of DEFAULT_STORY_FRAGMENTS.naib_join) {
    insertStmt.run(randomUUID(), 'naib_join', content, 0);
    totalInserted++;
  }

  logger.info(
    {
      totalInserted,
      fedaykin: DEFAULT_STORY_FRAGMENTS.fedaykin_join.length,
      naib: DEFAULT_STORY_FRAGMENTS.naib_join.length,
    },
    'Default story fragments seeded successfully'
  );
}

/**
 * Initialize the database connection
 */
export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  // Ensure data directory exists
  const dbPath = config.database.path;
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    logger.info({ path: dbDir }, 'Created database directory');
  }

  // Create database connection
  db = new Database(dbPath);
  logger.info({ path: dbPath }, 'Database connection established');

  // Enable WAL mode and run schema
  db.exec(SCHEMA_SQL);
  logger.info('Database schema initialized');

  // Run social layer schema (v2.0)
  db.exec(SOCIAL_LAYER_SCHEMA_SQL);
  logger.info('Social layer schema initialized');

  // Run billing schema (v4.0 - Sprint 23)
  db.exec(BILLING_SCHEMA_SQL);
  logger.info('Billing schema initialized');

  // Run badge schema (v4.0 - Sprint 27)
  db.exec(BADGES_SCHEMA_SQL);
  logger.info('Badge schema initialized');

  // Run boosts schema (v4.0 - Sprint 28)
  db.exec(BOOSTS_SCHEMA_SQL);
  logger.info('Boosts schema initialized');

  // Run telegram identity schema (v4.1 - Sprint 30)
  // Uses safe SQL that handles existing columns gracefully
  try {
    db.exec(TELEGRAM_IDENTITY_SAFE_SQL);
    logger.info('Telegram identity schema initialized');
  } catch (error) {
    // Ignore errors for existing columns (SQLite limitation)
    logger.debug({ error }, 'Telegram schema migration note (may be already applied)');
  }

  // Add telegram columns if they don't exist (safe migration)
  // SQLite doesn't have ADD COLUMN IF NOT EXISTS, so we handle manually
  try {
    const columnExists = db.prepare(
      "SELECT COUNT(*) as count FROM pragma_table_info('member_profiles') WHERE name = 'telegram_user_id'"
    ).get() as { count: number };

    if (columnExists.count === 0) {
      db.exec('ALTER TABLE member_profiles ADD COLUMN telegram_user_id TEXT UNIQUE');
      db.exec('ALTER TABLE member_profiles ADD COLUMN telegram_linked_at INTEGER');
      logger.info('Added telegram columns to member_profiles');
    }
  } catch (error) {
    // Column might already exist
    logger.debug({ error }, 'Telegram column migration note');
  }

  // Seed default story fragments if table is empty (v3.0 - Sprint 21)
  seedDefaultStoryFragments(db);

  return db;
}

/**
 * Get the database instance (must call initDatabase first)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

// =============================================================================
// Eligibility Snapshot Queries
// =============================================================================

/**
 * Save a new eligibility snapshot
 */
export function saveEligibilitySnapshot(entries: EligibilityEntry[]): number {
  const database = getDatabase();

  // Serialize entries for JSON storage
  const serialized: SerializedEligibilityEntry[] = entries.map((entry) => ({
    address: entry.address.toLowerCase(),
    bgtClaimed: entry.bgtClaimed.toString(),
    bgtBurned: entry.bgtBurned.toString(),
    bgtHeld: entry.bgtHeld.toString(),
    rank: entry.rank,
    role: entry.role,
  }));

  const stmt = database.prepare(`
    INSERT INTO eligibility_snapshots (data)
    VALUES (?)
  `);

  const result = stmt.run(JSON.stringify(serialized));

  // Also update current_eligibility table
  updateCurrentEligibility(entries);

  logger.info({ snapshotId: result.lastInsertRowid, count: entries.length }, 'Saved eligibility snapshot');

  return result.lastInsertRowid as number;
}

/**
 * Update current_eligibility table with latest entries
 */
function updateCurrentEligibility(entries: EligibilityEntry[]): void {
  const database = getDatabase();

  // Use a transaction for atomicity
  const transaction = database.transaction((eligibleEntries: EligibilityEntry[]) => {
    // Clear existing entries
    database.prepare('DELETE FROM current_eligibility').run();

    // Insert new entries
    const insertStmt = database.prepare(`
      INSERT INTO current_eligibility (address, rank, bgt_held, role, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);

    for (const entry of eligibleEntries) {
      if (entry.rank !== undefined && entry.rank <= 69) {
        insertStmt.run(
          entry.address.toLowerCase(),
          entry.rank,
          entry.bgtHeld.toString(),
          entry.role
        );
      }
    }
  });

  transaction(entries);
}

/**
 * Get the latest eligibility snapshot
 */
export function getLatestEligibilitySnapshot(): EligibilityEntry[] {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT data FROM eligibility_snapshots
    ORDER BY created_at DESC
    LIMIT 1
  `).get() as { data: string } | undefined;

  if (!row) {
    return [];
  }

  const serialized = JSON.parse(row.data) as SerializedEligibilityEntry[];

  return serialized.map((entry) => ({
    address: entry.address as `0x${string}`,
    bgtClaimed: BigInt(entry.bgtClaimed),
    bgtBurned: BigInt(entry.bgtBurned),
    bgtHeld: BigInt(entry.bgtHeld),
    rank: entry.rank,
    role: entry.role,
  }));
}

/**
 * Get current eligibility for a specific address
 */
export function getEligibilityByAddress(address: string): EligibilityEntry | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT address, rank, bgt_held, role
    FROM current_eligibility
    WHERE address = ?
  `).get(address.toLowerCase()) as {
    address: string;
    rank: number;
    bgt_held: string;
    role: 'naib' | 'fedaykin' | 'none';
  } | undefined;

  if (!row) {
    return null;
  }

  return {
    address: row.address as `0x${string}`,
    bgtClaimed: 0n, // Not stored in current_eligibility
    bgtBurned: 0n, // Not stored in current_eligibility
    bgtHeld: BigInt(row.bgt_held),
    rank: row.rank,
    role: row.role,
  };
}

/**
 * Get all current eligible entries (top 69)
 */
export function getCurrentEligibility(): EligibilityEntry[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT address, rank, bgt_held, role
    FROM current_eligibility
    ORDER BY rank ASC
  `).all() as Array<{
    address: string;
    rank: number;
    bgt_held: string;
    role: 'naib' | 'fedaykin' | 'none';
  }>;

  return rows.map((row) => ({
    address: row.address as `0x${string}`,
    bgtClaimed: 0n,
    bgtBurned: 0n,
    bgtHeld: BigInt(row.bgt_held),
    rank: row.rank,
    role: row.role,
  }));
}

// =============================================================================
// Health Status Queries
// =============================================================================

/**
 * Get current health status
 */
export function getHealthStatus(): HealthStatus {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT last_successful_query, last_query_attempt, consecutive_failures, in_grace_period
    FROM health_status
    WHERE id = 1
  `).get() as {
    last_successful_query: string | null;
    last_query_attempt: string | null;
    consecutive_failures: number;
    in_grace_period: number;
  };

  return {
    lastSuccessfulQuery: row.last_successful_query ? new Date(row.last_successful_query) : null,
    lastQueryAttempt: row.last_query_attempt ? new Date(row.last_query_attempt) : null,
    consecutiveFailures: row.consecutive_failures,
    inGracePeriod: row.in_grace_period === 1,
  };
}

/**
 * Update health status after successful query
 */
export function updateHealthStatusSuccess(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET last_successful_query = datetime('now'),
        last_query_attempt = datetime('now'),
        consecutive_failures = 0,
        in_grace_period = 0,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();
}

/**
 * Update health status after failed query
 */
export function updateHealthStatusFailure(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET last_query_attempt = datetime('now'),
        consecutive_failures = consecutive_failures + 1,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();

  // Check if we should enter grace period
  const health = getHealthStatus();
  if (health.lastSuccessfulQuery) {
    const hoursSinceSuccess =
      (Date.now() - health.lastSuccessfulQuery.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSuccess >= config.gracePeriod.hours && !health.inGracePeriod) {
      enterGracePeriod();
    }
  }
}

/**
 * Enter grace period
 */
export function enterGracePeriod(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET in_grace_period = 1,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();

  logAuditEvent('grace_period_entered', { timestamp: new Date().toISOString() });
  logger.warn('Entered grace period - no revocations will occur');
}

/**
 * Exit grace period
 */
export function exitGracePeriod(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET in_grace_period = 0,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();

  logAuditEvent('grace_period_exited', { timestamp: new Date().toISOString() });
  logger.info('Exited grace period');
}

// =============================================================================
// Admin Override Queries
// =============================================================================

/**
 * Create a new admin override
 */
export function createAdminOverride(override: Omit<AdminOverride, 'id' | 'createdAt' | 'active'>): number {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO admin_overrides (address, action, reason, created_by, expires_at, active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const result = stmt.run(
    override.address.toLowerCase(),
    override.action,
    override.reason,
    override.createdBy,
    override.expiresAt?.toISOString() ?? null
  );

  logAuditEvent('admin_override', {
    overrideId: result.lastInsertRowid,
    address: override.address,
    action: override.action,
    reason: override.reason,
    createdBy: override.createdBy,
  });

  return result.lastInsertRowid as number;
}

/**
 * Get all active admin overrides
 */
export function getActiveAdminOverrides(): AdminOverride[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT id, address, action, reason, created_by, created_at, expires_at, active
    FROM admin_overrides
    WHERE active = 1
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).all() as Array<{
    id: number;
    address: string;
    action: 'add' | 'remove';
    reason: string;
    created_by: string;
    created_at: string;
    expires_at: string | null;
    active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    address: row.address,
    action: row.action,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    active: row.active === 1,
  }));
}

/**
 * Deactivate an admin override
 */
export function deactivateAdminOverride(id: number): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE admin_overrides
    SET active = 0
    WHERE id = ?
  `).run(id);

  return result.changes > 0;
}

// =============================================================================
// Audit Log Queries
// =============================================================================

/**
 * Log an audit event
 */
export function logAuditEvent(
  eventType: AuditLogEntry['eventType'],
  eventData: Record<string, unknown>
): number {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO audit_log (event_type, event_data)
    VALUES (?, ?)
  `);

  const result = stmt.run(eventType, JSON.stringify(eventData));
  return result.lastInsertRowid as number;
}

/**
 * Get audit log entries
 */
export function getAuditLog(options: {
  limit?: number;
  eventType?: AuditLogEntry['eventType'];
  since?: Date;
} = {}): AuditLogEntry[] {
  const database = getDatabase();

  let sql = 'SELECT id, event_type, event_data, created_at FROM audit_log WHERE 1=1';
  const params: unknown[] = [];

  if (options.eventType) {
    sql += ' AND event_type = ?';
    params.push(options.eventType);
  }

  if (options.since) {
    sql += ' AND created_at >= ?';
    params.push(options.since.toISOString());
  }

  sql += ' ORDER BY created_at DESC';

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  const rows = database.prepare(sql).all(...params) as Array<{
    id: number;
    event_type: AuditLogEntry['eventType'];
    event_data: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    eventData: JSON.parse(row.event_data) as Record<string, unknown>,
    createdAt: new Date(row.created_at),
  }));
}

// =============================================================================
// Wallet Mapping Queries
// =============================================================================

/**
 * Save or update a wallet mapping
 */
export function saveWalletMapping(discordUserId: string, walletAddress: string): void {
  const database = getDatabase();

  database.prepare(`
    INSERT OR REPLACE INTO wallet_mappings (discord_user_id, wallet_address, verified_at)
    VALUES (?, ?, datetime('now'))
  `).run(discordUserId, walletAddress.toLowerCase());
}

/**
 * Get wallet address for a Discord user
 */
export function getWalletByDiscordId(discordUserId: string): string | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT wallet_address FROM wallet_mappings
    WHERE discord_user_id = ?
  `).get(discordUserId) as { wallet_address: string } | undefined;

  return row?.wallet_address ?? null;
}

/**
 * Get Discord user ID for a wallet address
 */
export function getDiscordIdByWallet(walletAddress: string): string | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT discord_user_id FROM wallet_mappings
    WHERE wallet_address = ?
  `).get(walletAddress.toLowerCase()) as { discord_user_id: string } | undefined;

  return row?.discord_user_id ?? null;
}

/**
 * Delete a wallet mapping
 */
export function deleteWalletMapping(discordUserId: string): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    DELETE FROM wallet_mappings
    WHERE discord_user_id = ?
  `).run(discordUserId);

  return result.changes > 0;
}

// =============================================================================
// Maintenance Queries
// =============================================================================

/**
 * Clean up old snapshots (keep last 30 days)
 */
export function cleanupOldSnapshots(): number {
  const database = getDatabase();

  const result = database.prepare(CLEANUP_OLD_SNAPSHOTS_SQL.trim()).run();

  if (result.changes > 0) {
    logger.info({ deleted: result.changes }, 'Cleaned up old eligibility snapshots');
  }

  return result.changes;
}

// =============================================================================
// Event Cache Queries
// =============================================================================

/**
 * Cached claim event for storage
 */
export interface CachedClaimEvent {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  address: string;
  amount: bigint;
  vaultAddress: string;
}

/**
 * Cached burn event for storage
 */
export interface CachedBurnEvent {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  fromAddress: string;
  amount: bigint;
}

/**
 * Get the last synced block number
 */
export function getLastSyncedBlock(): bigint | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT last_synced_block FROM health_status WHERE id = 1
  `).get() as { last_synced_block: string | null };

  return row.last_synced_block ? BigInt(row.last_synced_block) : null;
}

/**
 * Update the last synced block number
 */
export function updateLastSyncedBlock(blockNumber: bigint): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET last_synced_block = ?, updated_at = datetime('now')
    WHERE id = 1
  `).run(blockNumber.toString());
}

/**
 * Save cached claim events (batch insert)
 */
export function saveCachedClaimEvents(events: CachedClaimEvent[]): number {
  if (events.length === 0) return 0;

  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO cached_claim_events
    (tx_hash, log_index, block_number, address, amount, vault_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((evts: CachedClaimEvent[]) => {
    let inserted = 0;
    for (const evt of evts) {
      const result = stmt.run(
        evt.txHash,
        evt.logIndex,
        evt.blockNumber.toString(),
        evt.address.toLowerCase(),
        evt.amount.toString(),
        evt.vaultAddress.toLowerCase()
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const count = insertMany(events);
  if (count > 0) {
    logger.debug({ count }, 'Cached new claim events');
  }
  return count;
}

/**
 * Save cached burn events (batch insert)
 */
export function saveCachedBurnEvents(events: CachedBurnEvent[]): number {
  if (events.length === 0) return 0;

  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO cached_burn_events
    (tx_hash, log_index, block_number, from_address, amount)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((evts: CachedBurnEvent[]) => {
    let inserted = 0;
    for (const evt of evts) {
      const result = stmt.run(
        evt.txHash,
        evt.logIndex,
        evt.blockNumber.toString(),
        evt.fromAddress.toLowerCase(),
        evt.amount.toString()
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const count = insertMany(events);
  if (count > 0) {
    logger.debug({ count }, 'Cached new burn events');
  }
  return count;
}

/**
 * Get all cached claim events
 */
export function getCachedClaimEvents(): CachedClaimEvent[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tx_hash, log_index, block_number, address, amount, vault_address
    FROM cached_claim_events
  `).all() as Array<{
    tx_hash: string;
    log_index: number;
    block_number: string;
    address: string;
    amount: string;
    vault_address: string;
  }>;

  return rows.map((row) => ({
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: BigInt(row.block_number),
    address: row.address,
    amount: BigInt(row.amount),
    vaultAddress: row.vault_address,
  }));
}

/**
 * Get all cached burn events
 */
export function getCachedBurnEvents(): CachedBurnEvent[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tx_hash, log_index, block_number, from_address, amount
    FROM cached_burn_events
  `).all() as Array<{
    tx_hash: string;
    log_index: number;
    block_number: string;
    from_address: string;
    amount: string;
  }>;

  return rows.map((row) => ({
    txHash: row.tx_hash,
    logIndex: row.log_index,
    blockNumber: BigInt(row.block_number),
    fromAddress: row.from_address,
    amount: BigInt(row.amount),
  }));
}

/**
 * Clear all cached events (for full resync)
 */
export function clearEventCache(): void {
  const database = getDatabase();

  database.transaction(() => {
    database.prepare('DELETE FROM cached_claim_events').run();
    database.prepare('DELETE FROM cached_burn_events').run();
    database.prepare(`
      UPDATE health_status SET last_synced_block = NULL WHERE id = 1
    `).run();
  })();

  logger.info('Cleared event cache for full resync');
}

// =============================================================================
// Member Profile Queries (Social Layer v2.0)
// =============================================================================

/**
 * Database row shape for member_profiles table
 */
interface MemberProfileRow {
  member_id: string;
  discord_user_id: string;
  nym: string;
  bio: string | null;
  pfp_url: string | null;
  pfp_type: 'custom' | 'generated' | 'none';
  tier: 'naib' | 'fedaykin';
  created_at: string;
  updated_at: string;
  nym_last_changed: string | null;
  onboarding_complete: number;
  onboarding_step: number;
}

/**
 * Convert database row to MemberProfile
 */
function rowToMemberProfile(row: MemberProfileRow): MemberProfile {
  return {
    memberId: row.member_id,
    discordUserId: row.discord_user_id,
    nym: row.nym,
    bio: row.bio,
    pfpUrl: row.pfp_url,
    pfpType: row.pfp_type,
    tier: row.tier,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    nymLastChanged: row.nym_last_changed ? new Date(row.nym_last_changed) : null,
    onboardingComplete: row.onboarding_complete === 1,
    onboardingStep: row.onboarding_step,
  };
}

/**
 * Create a new member profile
 */
export function createMemberProfile(profile: {
  memberId: string;
  discordUserId: string;
  nym: string;
  tier: 'naib' | 'fedaykin';
  bio?: string | null;
  pfpUrl?: string | null;
  pfpType?: 'custom' | 'generated' | 'none';
}): MemberProfile {
  const database = getDatabase();

  database.prepare(`
    INSERT INTO member_profiles (member_id, discord_user_id, nym, tier, bio, pfp_url, pfp_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.memberId,
    profile.discordUserId,
    profile.nym,
    profile.tier,
    profile.bio ?? null,
    profile.pfpUrl ?? null,
    profile.pfpType ?? 'none'
  );

  // Also create activity record
  database.prepare(`
    INSERT INTO member_activity (member_id)
    VALUES (?)
  `).run(profile.memberId);

  logger.info({ memberId: profile.memberId, nym: profile.nym }, 'Created member profile');

  return getMemberProfileById(profile.memberId)!;
}

/**
 * Get member profile by member ID
 */
export function getMemberProfileById(memberId: string): MemberProfile | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_profiles WHERE member_id = ?
  `).get(memberId) as MemberProfileRow | undefined;

  return row ? rowToMemberProfile(row) : null;
}

/**
 * Get member profile by Discord user ID
 */
export function getMemberProfileByDiscordId(discordUserId: string): MemberProfile | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_profiles WHERE discord_user_id = ?
  `).get(discordUserId) as MemberProfileRow | undefined;

  return row ? rowToMemberProfile(row) : null;
}

/**
 * Get member profile by nym (case-insensitive)
 */
export function getMemberProfileByNym(nym: string): MemberProfile | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_profiles WHERE nym = ? COLLATE NOCASE
  `).get(nym) as MemberProfileRow | undefined;

  return row ? rowToMemberProfile(row) : null;
}

/**
 * Check if a nym is available (case-insensitive)
 */
export function isNymAvailable(nym: string, excludeMemberId?: string): boolean {
  const database = getDatabase();

  let sql = 'SELECT 1 FROM member_profiles WHERE nym = ? COLLATE NOCASE';
  const params: unknown[] = [nym];

  if (excludeMemberId) {
    sql += ' AND member_id != ?';
    params.push(excludeMemberId);
  }

  const row = database.prepare(sql).get(...params);
  return !row;
}

/**
 * Update member profile
 */
export function updateMemberProfile(
  memberId: string,
  updates: ProfileUpdateRequest & {
    tier?: 'naib' | 'fedaykin';
    onboardingComplete?: boolean;
    onboardingStep?: number;
  }
): MemberProfile | null {
  const database = getDatabase();

  const setClauses: string[] = ['updated_at = datetime(\'now\')'];
  const params: unknown[] = [];

  if (updates.nym !== undefined) {
    setClauses.push('nym = ?', 'nym_last_changed = datetime(\'now\')');
    params.push(updates.nym);
  }

  if (updates.bio !== undefined) {
    setClauses.push('bio = ?');
    params.push(updates.bio);
  }

  if (updates.pfpUrl !== undefined) {
    setClauses.push('pfp_url = ?');
    params.push(updates.pfpUrl);
  }

  if (updates.pfpType !== undefined) {
    setClauses.push('pfp_type = ?');
    params.push(updates.pfpType);
  }

  if (updates.tier !== undefined) {
    setClauses.push('tier = ?');
    params.push(updates.tier);
  }

  if (updates.onboardingComplete !== undefined) {
    setClauses.push('onboarding_complete = ?');
    params.push(updates.onboardingComplete ? 1 : 0);
  }

  if (updates.onboardingStep !== undefined) {
    setClauses.push('onboarding_step = ?');
    params.push(updates.onboardingStep);
  }

  params.push(memberId);

  const result = database.prepare(`
    UPDATE member_profiles
    SET ${setClauses.join(', ')}
    WHERE member_id = ?
  `).run(...params);

  if (result.changes === 0) {
    return null;
  }

  logger.info({ memberId, updates: Object.keys(updates) }, 'Updated member profile');
  return getMemberProfileById(memberId);
}

/**
 * Delete member profile (cascades to badges, activity, perks)
 */
export function deleteMemberProfile(memberId: string): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    DELETE FROM member_profiles WHERE member_id = ?
  `).run(memberId);

  if (result.changes > 0) {
    logger.info({ memberId }, 'Deleted member profile');
  }

  return result.changes > 0;
}

/**
 * Calculate tenure category based on membership duration
 */
export function calculateTenureCategory(
  createdAt: Date,
  launchDate: Date = new Date('2025-01-01')
): 'og' | 'veteran' | 'elder' | 'member' {
  const now = new Date();
  const membershipDays = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  // OG: joined within first 30 days of launch
  const launchWindow = 30;
  const daysAfterLaunch = Math.floor((createdAt.getTime() - launchDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysAfterLaunch <= launchWindow) {
    return 'og';
  }

  if (membershipDays >= 180) {
    return 'elder';
  }

  if (membershipDays >= 90) {
    return 'veteran';
  }

  return 'member';
}

/**
 * Get public profile (privacy-filtered) by member ID
 */
export function getPublicProfile(memberId: string): PublicProfile | null {
  const profile = getMemberProfileById(memberId);
  if (!profile) return null;

  const badges = getMemberBadges(memberId);
  const tenureCategory = calculateTenureCategory(profile.createdAt);

  return {
    memberId: profile.memberId,
    nym: profile.nym,
    bio: profile.bio,
    pfpUrl: profile.pfpUrl,
    pfpType: profile.pfpType,
    tier: profile.tier,
    tenureCategory,
    badges: badges.map((b) => ({
      badgeId: b.badgeId,
      name: b.name,
      description: b.description,
      category: b.category,
      emoji: b.emoji,
      awardedAt: b.awardedAt,
    })),
    badgeCount: badges.length,
    memberSince: profile.createdAt,
  };
}

// =============================================================================
// Badge Queries (Social Layer v2.0)
// =============================================================================

/**
 * Database row shape for badges table
 */
interface BadgeRow {
  badge_id: string;
  name: string;
  description: string;
  category: 'tenure' | 'engagement' | 'contribution' | 'special';
  emoji: string | null;
  auto_criteria_type: 'tenure_days' | 'activity_balance' | 'badge_count' | null;
  auto_criteria_value: number | null;
  display_order: number;
  created_at: string;
}

/**
 * Convert database row to Badge
 */
function rowToBadge(row: BadgeRow): Badge {
  return {
    badgeId: row.badge_id,
    name: row.name,
    description: row.description,
    category: row.category,
    emoji: row.emoji,
    autoCriteriaType: row.auto_criteria_type,
    autoCriteriaValue: row.auto_criteria_value,
    displayOrder: row.display_order,
  };
}

/**
 * Get all badge definitions
 */
export function getAllBadges(): Badge[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM badges ORDER BY category, display_order
  `).all() as BadgeRow[];

  return rows.map(rowToBadge);
}

/**
 * Get badge by ID
 */
export function getBadgeById(badgeId: string): Badge | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM badges WHERE badge_id = ?
  `).get(badgeId) as BadgeRow | undefined;

  return row ? rowToBadge(row) : null;
}

/**
 * Get badges by category
 */
export function getBadgesByCategory(category: Badge['category']): Badge[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM badges WHERE category = ? ORDER BY display_order
  `).all(category) as BadgeRow[];

  return rows.map(rowToBadge);
}

/**
 * Extended badge info with award date for member queries
 */
interface MemberBadgeWithInfo extends Badge {
  awardedAt: Date;
  awardedBy: string | null;
  awardReason: string | null;
}

/**
 * Get all badges for a member (non-revoked)
 */
export function getMemberBadges(memberId: string): MemberBadgeWithInfo[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT b.*, mb.awarded_at, mb.awarded_by, mb.award_reason
    FROM member_badges mb
    JOIN badges b ON mb.badge_id = b.badge_id
    WHERE mb.member_id = ? AND mb.revoked = 0
    ORDER BY b.category, b.display_order
  `).all(memberId) as Array<BadgeRow & {
    awarded_at: string;
    awarded_by: string | null;
    award_reason: string | null;
  }>;

  return rows.map((row) => ({
    ...rowToBadge(row),
    awardedAt: new Date(row.awarded_at),
    awardedBy: row.awarded_by,
    awardReason: row.award_reason,
  }));
}

/**
 * Check if member has a specific badge
 */
export function memberHasBadge(memberId: string, badgeId: string): boolean {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT 1 FROM member_badges
    WHERE member_id = ? AND badge_id = ? AND revoked = 0
  `).get(memberId, badgeId);

  return !!row;
}

/**
 * Award a badge to a member
 */
export function awardBadge(
  memberId: string,
  badgeId: string,
  options: { awardedBy?: string; reason?: string } = {}
): MemberBadge | null {
  const database = getDatabase();

  // Check if badge exists
  const badge = getBadgeById(badgeId);
  if (!badge) {
    logger.warn({ badgeId }, 'Attempted to award non-existent badge');
    return null;
  }

  // Check if already has badge (including revoked - we'll un-revoke)
  const existing = database.prepare(`
    SELECT id, revoked FROM member_badges
    WHERE member_id = ? AND badge_id = ?
  `).get(memberId, badgeId) as { id: number; revoked: number } | undefined;

  if (existing) {
    if (existing.revoked === 0) {
      // Already has active badge
      return null;
    }

    // Un-revoke the badge
    database.prepare(`
      UPDATE member_badges
      SET revoked = 0, revoked_at = NULL, revoked_by = NULL,
          awarded_at = datetime('now'), awarded_by = ?, award_reason = ?
      WHERE id = ?
    `).run(options.awardedBy ?? null, options.reason ?? null, existing.id);

    logger.info({ memberId, badgeId }, 'Re-awarded previously revoked badge');
  } else {
    // Insert new badge
    database.prepare(`
      INSERT INTO member_badges (member_id, badge_id, awarded_by, award_reason)
      VALUES (?, ?, ?, ?)
    `).run(memberId, badgeId, options.awardedBy ?? null, options.reason ?? null);

    logger.info({ memberId, badgeId }, 'Awarded badge');
  }

  // Return the badge record
  const row = database.prepare(`
    SELECT * FROM member_badges
    WHERE member_id = ? AND badge_id = ?
  `).get(memberId, badgeId) as {
    id: number;
    member_id: string;
    badge_id: string;
    awarded_at: string;
    awarded_by: string | null;
    award_reason: string | null;
    revoked: number;
    revoked_at: string | null;
    revoked_by: string | null;
  };

  return {
    id: row.id,
    memberId: row.member_id,
    badgeId: row.badge_id,
    awardedAt: new Date(row.awarded_at),
    awardedBy: row.awarded_by,
    awardReason: row.award_reason,
    revoked: row.revoked === 1,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    revokedBy: row.revoked_by,
  };
}

/**
 * Revoke a badge from a member
 */
export function revokeBadge(
  memberId: string,
  badgeId: string,
  revokedBy: string
): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE member_badges
    SET revoked = 1, revoked_at = datetime('now'), revoked_by = ?
    WHERE member_id = ? AND badge_id = ? AND revoked = 0
  `).run(revokedBy, memberId, badgeId);

  if (result.changes > 0) {
    logger.info({ memberId, badgeId, revokedBy }, 'Revoked badge');
  }

  return result.changes > 0;
}

/**
 * Get count of badges for a member
 */
export function getMemberBadgeCount(memberId: string): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM member_badges
    WHERE member_id = ? AND revoked = 0
  `).get(memberId) as { count: number };

  return row.count;
}

// =============================================================================
// Member Activity Queries (Social Layer v2.0)
// =============================================================================

/**
 * Database row shape for member_activity table
 */
interface MemberActivityRow {
  member_id: string;
  activity_balance: number;
  last_decay_at: string;
  total_messages: number;
  total_reactions_given: number;
  total_reactions_received: number;
  last_active_at: string | null;
  peak_balance: number;
  updated_at: string;
}

/**
 * Convert database row to MemberActivity
 */
function rowToMemberActivity(row: MemberActivityRow): MemberActivity {
  return {
    memberId: row.member_id,
    activityBalance: row.activity_balance,
    lastDecayAt: new Date(row.last_decay_at),
    totalMessages: row.total_messages,
    totalReactionsGiven: row.total_reactions_given,
    totalReactionsReceived: row.total_reactions_received,
    lastActiveAt: row.last_active_at ? new Date(row.last_active_at) : null,
    peakBalance: row.peak_balance,
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get member activity record
 */
export function getMemberActivity(memberId: string): MemberActivity | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM member_activity WHERE member_id = ?
  `).get(memberId) as MemberActivityRow | undefined;

  return row ? rowToMemberActivity(row) : null;
}

/**
 * Apply decay to activity balance based on time elapsed
 * Default: 10% decay every 6 hours
 */
export function applyActivityDecay(
  memberId: string,
  decayRate: number = 0.1,
  decayPeriodHours: number = 6
): MemberActivity | null {
  const database = getDatabase();

  const activity = getMemberActivity(memberId);
  if (!activity) return null;

  const now = new Date();
  const hoursSinceDecay = (now.getTime() - activity.lastDecayAt.getTime()) / (1000 * 60 * 60);
  const decayPeriods = Math.floor(hoursSinceDecay / decayPeriodHours);

  if (decayPeriods <= 0) {
    return activity; // No decay needed
  }

  // Apply compound decay: balance * (1 - decayRate)^periods
  const decayMultiplier = Math.pow(1 - decayRate, decayPeriods);
  const newBalance = Math.max(0, activity.activityBalance * decayMultiplier);

  database.prepare(`
    UPDATE member_activity
    SET activity_balance = ?,
        last_decay_at = datetime('now'),
        updated_at = datetime('now')
    WHERE member_id = ?
  `).run(newBalance, memberId);

  return getMemberActivity(memberId);
}

/**
 * Add activity points to a member
 */
export function addActivityPoints(
  memberId: string,
  points: number,
  type: 'message' | 'reaction_given' | 'reaction_received'
): MemberActivity | null {
  const database = getDatabase();

  // First apply any pending decay
  applyActivityDecay(memberId);

  const activity = getMemberActivity(memberId);
  if (!activity) return null;

  const newBalance = activity.activityBalance + points;
  const newPeak = Math.max(activity.peakBalance, newBalance);

  const updateClauses = [
    'activity_balance = ?',
    'peak_balance = ?',
    'last_active_at = datetime(\'now\')',
    'updated_at = datetime(\'now\')',
  ];
  const params: unknown[] = [newBalance, newPeak];

  // Update lifetime stats
  switch (type) {
    case 'message':
      updateClauses.push('total_messages = total_messages + 1');
      break;
    case 'reaction_given':
      updateClauses.push('total_reactions_given = total_reactions_given + 1');
      break;
    case 'reaction_received':
      updateClauses.push('total_reactions_received = total_reactions_received + 1');
      break;
  }

  params.push(memberId);

  database.prepare(`
    UPDATE member_activity
    SET ${updateClauses.join(', ')}
    WHERE member_id = ?
  `).run(...params);

  return getMemberActivity(memberId);
}

/**
 * Get activity leaderboard (top N by activity balance)
 */
export function getActivityLeaderboard(limit: number = 10): Array<{
  memberId: string;
  nym: string;
  activityBalance: number;
  tier: 'naib' | 'fedaykin';
}> {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT ma.member_id, mp.nym, ma.activity_balance, mp.tier
    FROM member_activity ma
    JOIN member_profiles mp ON ma.member_id = mp.member_id
    WHERE mp.onboarding_complete = 1
    ORDER BY ma.activity_balance DESC
    LIMIT ?
  `).all(limit) as Array<{
    member_id: string;
    nym: string;
    activity_balance: number;
    tier: 'naib' | 'fedaykin';
  }>;

  return rows.map((row) => ({
    memberId: row.member_id,
    nym: row.nym,
    activityBalance: row.activity_balance,
    tier: row.tier,
  }));
}

// =============================================================================
// Directory Queries (Social Layer v2.0)
// =============================================================================

/**
 * Get badges for multiple members in a single query (batch optimization)
 * Avoids N+1 query issue when fetching directory
 */
export function getBatchMemberBadges(memberIds: string[]): Map<string, PublicBadge[]> {
  if (memberIds.length === 0) {
    return new Map();
  }

  const database = getDatabase();

  // Build placeholder string for IN clause
  const placeholders = memberIds.map(() => '?').join(', ');

  const rows = database.prepare(`
    SELECT
      mb.member_id,
      b.badge_id,
      b.name,
      b.description,
      b.category,
      b.emoji,
      mb.awarded_at
    FROM member_badges mb
    JOIN badges b ON mb.badge_id = b.badge_id
    WHERE mb.member_id IN (${placeholders})
      AND mb.revoked = 0
    ORDER BY mb.member_id, b.category, b.display_order
  `).all(...memberIds) as Array<{
    member_id: string;
    badge_id: string;
    name: string;
    description: string;
    category: 'tenure' | 'engagement' | 'contribution' | 'special';
    emoji: string | null;
    awarded_at: string;
  }>;

  // Group badges by member_id
  const badgeMap = new Map<string, PublicBadge[]>();

  // Initialize empty arrays for all members (some may have no badges)
  for (const memberId of memberIds) {
    badgeMap.set(memberId, []);
  }

  for (const row of rows) {
    const badges = badgeMap.get(row.member_id) || [];
    badges.push({
      badgeId: row.badge_id,
      name: row.name,
      description: row.description,
      category: row.category,
      emoji: row.emoji,
      awardedAt: new Date(row.awarded_at),
    });
    badgeMap.set(row.member_id, badges);
  }

  return badgeMap;
}

/**
 * Get member directory with filters and pagination
 * Optimized to use batch badge fetching to avoid N+1 queries
 */
export function getMemberDirectory(filters: DirectoryFilters = {}): DirectoryResult {
  const database = getDatabase();

  const whereClauses: string[] = ['mp.onboarding_complete = 1'];
  const params: unknown[] = [];

  // Filter by tier
  if (filters.tier) {
    whereClauses.push('mp.tier = ?');
    params.push(filters.tier);
  }

  // Filter by badge
  if (filters.badge) {
    whereClauses.push(`
      EXISTS (
        SELECT 1 FROM member_badges mb
        WHERE mb.member_id = mp.member_id
        AND mb.badge_id = ?
        AND mb.revoked = 0
      )
    `);
    params.push(filters.badge);
  }

  // Build ORDER BY clause
  let orderBy = 'mp.created_at DESC'; // Default sort
  switch (filters.sortBy) {
    case 'nym':
      orderBy = `mp.nym ${filters.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
      break;
    case 'tenure':
      orderBy = `mp.created_at ${filters.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
      break;
    case 'badgeCount':
      orderBy = `badge_count ${filters.sortDir === 'desc' ? 'DESC' : 'ASC'}`;
      break;
  }

  // Count total results
  const countRow = database.prepare(`
    SELECT COUNT(*) as total
    FROM member_profiles mp
    WHERE ${whereClauses.join(' AND ')}
  `).get(...params) as { total: number };

  const total = countRow.total;
  const pageSize = filters.pageSize ?? 20;
  const page = filters.page ?? 1;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  // Get paginated results with badge count
  const rows = database.prepare(`
    SELECT
      mp.*,
      COALESCE((
        SELECT COUNT(*) FROM member_badges mb
        WHERE mb.member_id = mp.member_id AND mb.revoked = 0
      ), 0) as badge_count
    FROM member_profiles mp
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as Array<MemberProfileRow & { badge_count: number }>;

  // Batch fetch badges for all members in a single query (avoids N+1)
  const memberIds = rows.map((row) => row.member_id);
  const badgeMap = getBatchMemberBadges(memberIds);

  // Convert to PublicProfile
  const members: PublicProfile[] = rows.map((row) => {
    const badges = badgeMap.get(row.member_id) || [];
    const tenureCategory = calculateTenureCategory(new Date(row.created_at));

    return {
      memberId: row.member_id,
      nym: row.nym,
      bio: row.bio,
      pfpUrl: row.pfp_url,
      pfpType: row.pfp_type,
      tier: row.tier,
      tenureCategory,
      badges,
      badgeCount: row.badge_count,
      memberSince: new Date(row.created_at),
    };
  });

  // Filter by tenure category (post-query since it's computed)
  const filteredMembers = filters.tenureCategory
    ? members.filter((m) => m.tenureCategory === filters.tenureCategory)
    : members;

  return {
    members: filteredMembers,
    total: filters.tenureCategory ? filteredMembers.length : total,
    page,
    pageSize,
    totalPages: filters.tenureCategory
      ? Math.ceil(filteredMembers.length / pageSize)
      : totalPages,
  };
}

/**
 * Get total member count
 */
export function getMemberCount(): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM member_profiles
    WHERE onboarding_complete = 1
  `).get() as { count: number };

  return row.count;
}

/**
 * Get member count by tier
 */
export function getMemberCountByTier(): { naib: number; fedaykin: number } {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tier, COUNT(*) as count
    FROM member_profiles
    WHERE onboarding_complete = 1
    GROUP BY tier
  `).all() as Array<{ tier: 'naib' | 'fedaykin'; count: number }>;

  const counts = { naib: 0, fedaykin: 0 };
  for (const row of rows) {
    counts[row.tier] = row.count;
  }

  return counts;
}

/**
 * Search members by nym (partial match, case-insensitive)
 */
export function searchMembersByNym(query: string, limit: number = 10): PublicProfile[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM member_profiles
    WHERE nym LIKE ? COLLATE NOCASE
    AND onboarding_complete = 1
    ORDER BY nym ASC
    LIMIT ?
  `).all(`%${query}%`, limit) as MemberProfileRow[];

  return rows.map((row) => {
    const profile = rowToMemberProfile(row);
    return getPublicProfile(profile.memberId)!;
  });
}

// =============================================================================
// Naib Seat Queries (v2.1 - Sprint 11)
// =============================================================================

import type {
  NaibSeat,
  UnseatReason,
} from '../types/index.js';
import { NAIB_THRESHOLD_SCHEMA_SQL } from './schema.js';

/**
 * Initialize Naib/Threshold schema (call after social layer schema)
 */
export function initNaibThresholdSchema(): void {
  const database = getDatabase();
  database.exec(NAIB_THRESHOLD_SCHEMA_SQL);
  logger.info('Naib/Threshold schema initialized');
}

/**
 * Database row shape for naib_seats table
 */
interface NaibSeatRow {
  id: number;
  seat_number: number;
  member_id: string;
  seated_at: string;
  unseated_at: string | null;
  unseat_reason: UnseatReason | null;
  bumped_by_member_id: string | null;
  bgt_at_seating: string;
  bgt_at_unseating: string | null;
}

/**
 * Convert database row to NaibSeat
 */
function rowToNaibSeat(row: NaibSeatRow): NaibSeat {
  return {
    id: row.id,
    seatNumber: row.seat_number,
    memberId: row.member_id,
    seatedAt: new Date(row.seated_at),
    unseatedAt: row.unseated_at ? new Date(row.unseated_at) : null,
    unseatReason: row.unseat_reason,
    bumpedByMemberId: row.bumped_by_member_id,
    bgtAtSeating: row.bgt_at_seating,
    bgtAtUnseating: row.bgt_at_unseating,
  };
}

/**
 * Insert a new Naib seat record
 */
export function insertNaibSeat(params: {
  seatNumber: number;
  memberId: string;
  bgtAtSeating: string;
}): NaibSeat {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT INTO naib_seats (seat_number, member_id, bgt_at_seating)
    VALUES (?, ?, ?)
  `);

  const result = stmt.run(params.seatNumber, params.memberId, params.bgtAtSeating);

  logger.info(
    { seatNumber: params.seatNumber, memberId: params.memberId },
    'Inserted Naib seat'
  );

  return getNaibSeatById(result.lastInsertRowid as number)!;
}

/**
 * Get a Naib seat by ID
 */
export function getNaibSeatById(id: number): NaibSeat | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM naib_seats WHERE id = ?
  `).get(id) as NaibSeatRow | undefined;

  return row ? rowToNaibSeat(row) : null;
}

/**
 * Update a Naib seat (for unseating)
 */
export function updateNaibSeat(
  id: number,
  updates: {
    unseatedAt?: Date;
    unseatReason?: UnseatReason;
    bumpedByMemberId?: string;
    bgtAtUnseating?: string;
  }
): NaibSeat | null {
  const database = getDatabase();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.unseatedAt !== undefined) {
    setClauses.push('unseated_at = ?');
    params.push(updates.unseatedAt.toISOString());
  }

  if (updates.unseatReason !== undefined) {
    setClauses.push('unseat_reason = ?');
    params.push(updates.unseatReason);
  }

  if (updates.bumpedByMemberId !== undefined) {
    setClauses.push('bumped_by_member_id = ?');
    params.push(updates.bumpedByMemberId);
  }

  if (updates.bgtAtUnseating !== undefined) {
    setClauses.push('bgt_at_unseating = ?');
    params.push(updates.bgtAtUnseating);
  }

  if (setClauses.length === 0) {
    return getNaibSeatById(id);
  }

  params.push(id);

  const result = database.prepare(`
    UPDATE naib_seats
    SET ${setClauses.join(', ')}
    WHERE id = ?
  `).run(...params);

  if (result.changes === 0) {
    return null;
  }

  return getNaibSeatById(id);
}

/**
 * Get all currently active Naib seats (unseated_at IS NULL)
 */
export function getCurrentNaibSeats(): NaibSeat[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM naib_seats
    WHERE unseated_at IS NULL
    ORDER BY seat_number ASC
  `).all() as NaibSeatRow[];

  return rows.map(rowToNaibSeat);
}

/**
 * Get active Naib seat for a specific member
 */
export function getActiveSeatByMember(memberId: string): NaibSeat | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM naib_seats
    WHERE member_id = ? AND unseated_at IS NULL
  `).get(memberId) as NaibSeatRow | undefined;

  return row ? rowToNaibSeat(row) : null;
}

/**
 * Get all seat history for a member (past and present)
 */
export function getNaibSeatsByMember(memberId: string): NaibSeat[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM naib_seats
    WHERE member_id = ?
    ORDER BY seated_at DESC
  `).all(memberId) as NaibSeatRow[];

  return rows.map(rowToNaibSeat);
}

/**
 * Count currently active Naib seats
 */
export function countActiveNaibSeats(): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM naib_seats
    WHERE unseated_at IS NULL
  `).get() as { count: number };

  return row.count;
}

/**
 * Get the next available seat number (1-7)
 * Returns null if all seats are filled
 */
export function getNextAvailableSeatNumber(): number | null {
  const database = getDatabase();

  // Get all currently occupied seat numbers
  const rows = database.prepare(`
    SELECT seat_number FROM naib_seats
    WHERE unseated_at IS NULL
    ORDER BY seat_number ASC
  `).all() as Array<{ seat_number: number }>;

  const occupied = new Set(rows.map((r) => r.seat_number));

  // Find first available seat (1-7)
  for (let i = 1; i <= 7; i++) {
    if (!occupied.has(i)) {
      return i;
    }
  }

  return null; // All seats occupied
}

/**
 * Get the lowest BGT Naib seat (for bump evaluation)
 * Returns the seat with the lowest BGT holder, using tenure as tie-breaker
 */
export function getLowestBgtNaibSeat(): {
  seat: NaibSeat;
  currentBgt: string;
  memberId: string;
} | null {
  const database = getDatabase();

  // Join with current_eligibility to get current BGT
  // Order by BGT ascending, then by seated_at descending (newer members lose ties)
  const row = database.prepare(`
    SELECT ns.*, ce.bgt_held as current_bgt
    FROM naib_seats ns
    JOIN wallet_mappings wm ON (
      SELECT discord_user_id FROM member_profiles WHERE member_id = ns.member_id
    ) = wm.discord_user_id
    JOIN current_eligibility ce ON ce.address = wm.wallet_address
    WHERE ns.unseated_at IS NULL
    ORDER BY CAST(ce.bgt_held AS INTEGER) ASC, ns.seated_at DESC
    LIMIT 1
  `).get() as (NaibSeatRow & { current_bgt: string }) | undefined;

  if (!row) {
    return null;
  }

  return {
    seat: rowToNaibSeat(row),
    currentBgt: row.current_bgt,
    memberId: row.member_id,
  };
}

/**
 * Update member's is_former_naib status
 */
export function updateMemberFormerNaibStatus(
  memberId: string,
  isFormerNaib: boolean
): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE member_profiles
    SET is_former_naib = ?
    WHERE member_id = ?
  `).run(isFormerNaib ? 1 : 0, memberId);

  return result.changes > 0;
}

/**
 * Get all Former Naib members (is_former_naib = 1 AND not currently seated)
 */
export function getFormerNaibMembers(): MemberProfile[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT mp.* FROM member_profiles mp
    WHERE mp.is_former_naib = 1
    AND NOT EXISTS (
      SELECT 1 FROM naib_seats ns
      WHERE ns.member_id = mp.member_id AND ns.unseated_at IS NULL
    )
    ORDER BY mp.nym ASC
  `).all() as MemberProfileRow[];

  return rows.map(rowToMemberProfile);
}

/**
 * Check if there have been any Naib seats ever (for founding determination)
 */
export function hasAnyNaibSeatsEver(): boolean {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(*) as count FROM naib_seats
  `).get() as { count: number };

  return row.count > 0;
}

/**
 * Get count of total unique members who have held Naib seats
 */
export function getTotalNaibMembersEver(): number {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT COUNT(DISTINCT member_id) as count FROM naib_seats
  `).get() as { count: number };

  return row.count;
}

/**
 * Get Naib seat history with pagination
 */
export function getNaibSeatHistory(options: {
  limit?: number;
  offset?: number;
} = {}): { seats: NaibSeat[]; total: number } {
  const database = getDatabase();

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countRow = database.prepare(`
    SELECT COUNT(*) as total FROM naib_seats
  `).get() as { total: number };

  const rows = database.prepare(`
    SELECT * FROM naib_seats
    ORDER BY seated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as NaibSeatRow[];

  return {
    seats: rows.map(rowToNaibSeat),
    total: countRow.total,
  };
}

/**
 * Get member's BGT from current_eligibility via wallet mapping
 */
export function getMemberCurrentBgt(memberId: string): string | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT ce.bgt_held
    FROM member_profiles mp
    JOIN wallet_mappings wm ON mp.discord_user_id = wm.discord_user_id
    JOIN current_eligibility ce ON ce.address = wm.wallet_address
    WHERE mp.member_id = ?
  `).get(memberId) as { bgt_held: string } | undefined;

  return row?.bgt_held ?? null;
}

/**
 * Get member's eligibility rank from current_eligibility
 */
export function getMemberEligibilityRank(memberId: string): number | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT ce.rank
    FROM member_profiles mp
    JOIN wallet_mappings wm ON mp.discord_user_id = wm.discord_user_id
    JOIN current_eligibility ce ON ce.address = wm.wallet_address
    WHERE mp.member_id = ?
  `).get(memberId) as { rank: number } | undefined;

  return row?.rank ?? null;
}

// =============================================================================
// Waitlist Registration Queries (Sprint 12: Cave Entrance)
// =============================================================================

/**
 * Database row type for waitlist_registrations
 */
interface WaitlistRegistrationRow {
  id: number;
  discord_user_id: string;
  wallet_address: string;
  position_at_registration: number;
  bgt_at_registration: string;
  registered_at: string;
  notified: number;
  notified_at: string | null;
  active: number;
}

/**
 * Convert database row to WaitlistRegistration type
 */
function rowToWaitlistRegistration(row: WaitlistRegistrationRow): WaitlistRegistration {
  return {
    id: row.id,
    discordUserId: row.discord_user_id,
    walletAddress: row.wallet_address,
    positionAtRegistration: row.position_at_registration,
    bgtAtRegistration: row.bgt_at_registration,
    registeredAt: new Date(row.registered_at),
    notified: row.notified === 1,
    notifiedAt: row.notified_at ? new Date(row.notified_at) : null,
    active: row.active === 1,
  };
}

/**
 * Insert a new waitlist registration
 */
export function insertWaitlistRegistration(data: {
  discordUserId: string;
  walletAddress: string;
  position: number;
  bgt: string;
}): WaitlistRegistration {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO waitlist_registrations (
      discord_user_id,
      wallet_address,
      position_at_registration,
      bgt_at_registration
    ) VALUES (?, ?, ?, ?)
  `).run(
    data.discordUserId,
    data.walletAddress.toLowerCase(),
    data.position,
    data.bgt
  );

  const row = database.prepare(`
    SELECT * FROM waitlist_registrations WHERE id = ?
  `).get(result.lastInsertRowid) as WaitlistRegistrationRow;

  return rowToWaitlistRegistration(row);
}

/**
 * Get waitlist registration by Discord user ID
 */
export function getWaitlistRegistrationByDiscord(discordUserId: string): WaitlistRegistration | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM waitlist_registrations
    WHERE discord_user_id = ? AND active = 1
  `).get(discordUserId) as WaitlistRegistrationRow | undefined;

  return row ? rowToWaitlistRegistration(row) : null;
}

/**
 * Get waitlist registration by wallet address
 */
export function getWaitlistRegistrationByWallet(walletAddress: string): WaitlistRegistration | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM waitlist_registrations
    WHERE wallet_address = ? AND active = 1
  `).get(walletAddress.toLowerCase()) as WaitlistRegistrationRow | undefined;

  return row ? rowToWaitlistRegistration(row) : null;
}

/**
 * Update waitlist registration as notified
 */
export function updateWaitlistNotified(registrationId: number): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE waitlist_registrations
    SET notified = 1, notified_at = datetime('now')
    WHERE id = ? AND active = 1
  `).run(registrationId);

  return result.changes > 0;
}

/**
 * Delete (deactivate) a waitlist registration
 */
export function deleteWaitlistRegistration(discordUserId: string): boolean {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE waitlist_registrations
    SET active = 0
    WHERE discord_user_id = ? AND active = 1
  `).run(discordUserId);

  return result.changes > 0;
}

/**
 * Get all active, non-notified waitlist registrations
 */
export function getActiveWaitlistRegistrations(): WaitlistRegistration[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM waitlist_registrations
    WHERE active = 1 AND notified = 0
    ORDER BY position_at_registration ASC
  `).all() as WaitlistRegistrationRow[];

  return rows.map(rowToWaitlistRegistration);
}

/**
 * Get all active waitlist registrations (including notified)
 */
export function getAllActiveWaitlistRegistrations(): WaitlistRegistration[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM waitlist_registrations
    WHERE active = 1
    ORDER BY position_at_registration ASC
  `).all() as WaitlistRegistrationRow[];

  return rows.map(rowToWaitlistRegistration);
}

/**
 * Check if a wallet is already associated with a member
 */
export function isWalletAssociatedWithMember(walletAddress: string): boolean {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT 1 FROM wallet_mappings
    WHERE wallet_address = ?
    LIMIT 1
  `).get(walletAddress.toLowerCase());

  return row !== undefined;
}

// =============================================================================
// Threshold Snapshot Queries (Sprint 12: Cave Entrance)
// =============================================================================

/**
 * Database row type for threshold_snapshots
 */
interface ThresholdSnapshotRow {
  id: number;
  entry_threshold_bgt: string;
  eligible_count: number;
  waitlist_count: number;
  waitlist_top_bgt: string | null;
  waitlist_bottom_bgt: string | null;
  gap_to_entry: string | null;
  snapshot_at: string;
}

/**
 * Convert database row to ThresholdSnapshot type
 */
function rowToThresholdSnapshot(row: ThresholdSnapshotRow): ThresholdSnapshot {
  return {
    id: row.id,
    entryThresholdBgt: row.entry_threshold_bgt,
    eligibleCount: row.eligible_count,
    waitlistCount: row.waitlist_count,
    waitlistTopBgt: row.waitlist_top_bgt,
    waitlistBottomBgt: row.waitlist_bottom_bgt,
    gapToEntry: row.gap_to_entry,
    snapshotAt: new Date(row.snapshot_at),
  };
}

/**
 * Insert a new threshold snapshot
 */
export function insertThresholdSnapshot(data: {
  entryThresholdBgt: string;
  eligibleCount: number;
  waitlistCount: number;
  waitlistTopBgt: string | null;
  waitlistBottomBgt: string | null;
  gapToEntry: string | null;
}): ThresholdSnapshot {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO threshold_snapshots (
      entry_threshold_bgt,
      eligible_count,
      waitlist_count,
      waitlist_top_bgt,
      waitlist_bottom_bgt,
      gap_to_entry
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.entryThresholdBgt,
    data.eligibleCount,
    data.waitlistCount,
    data.waitlistTopBgt,
    data.waitlistBottomBgt,
    data.gapToEntry
  );

  const row = database.prepare(`
    SELECT * FROM threshold_snapshots WHERE id = ?
  `).get(result.lastInsertRowid) as ThresholdSnapshotRow;

  return rowToThresholdSnapshot(row);
}

/**
 * Get the most recent threshold snapshot
 */
export function getLatestThresholdSnapshot(): ThresholdSnapshot | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM threshold_snapshots
    ORDER BY snapshot_at DESC
    LIMIT 1
  `).get() as ThresholdSnapshotRow | undefined;

  return row ? rowToThresholdSnapshot(row) : null;
}

/**
 * Get threshold snapshots with pagination
 */
export function getThresholdSnapshots(options: {
  limit?: number;
  since?: Date;
} = {}): ThresholdSnapshot[] {
  const database = getDatabase();

  const limit = options.limit ?? 24; // Default to 24 hours of snapshots (hourly)

  if (options.since) {
    const rows = database.prepare(`
      SELECT * FROM threshold_snapshots
      WHERE snapshot_at >= ?
      ORDER BY snapshot_at DESC
      LIMIT ?
    `).all(options.since.toISOString(), limit) as ThresholdSnapshotRow[];

    return rows.map(rowToThresholdSnapshot);
  }

  const rows = database.prepare(`
    SELECT * FROM threshold_snapshots
    ORDER BY snapshot_at DESC
    LIMIT ?
  `).all(limit) as ThresholdSnapshotRow[];

  return rows.map(rowToThresholdSnapshot);
}

/**
 * Get positions 70-100 from current_eligibility for waitlist display
 * Returns wallets ranked 70-100 with their BGT holdings
 */
export function getWaitlistPositions(): Array<{
  address: string;
  position: number;
  bgt: string;
}> {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT address, rank as position, bgt_held as bgt
    FROM current_eligibility
    WHERE rank >= 70 AND rank <= 100
    ORDER BY rank ASC
  `).all() as Array<{ address: string; position: number; bgt: string }>;

  return rows;
}

/**
 * Get position 69's BGT (entry threshold)
 */
export function getEntryThresholdBgt(): string | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT bgt_held FROM current_eligibility
    WHERE rank = 69
    LIMIT 1
  `).get() as { bgt_held: string } | undefined;

  return row?.bgt_held ?? null;
}

/**
 * Get a wallet's current position and BGT from eligibility
 */
export function getWalletPosition(walletAddress: string): {
  position: number;
  bgt: string;
} | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT rank as position, bgt_held as bgt
    FROM current_eligibility
    WHERE address = ?
  `).get(walletAddress.toLowerCase()) as { position: number; bgt: string } | undefined;

  return row ?? null;
}

// =============================================================================
// Notification Preferences Queries (Sprint 13: Notification System)
// =============================================================================

/**
 * Database row type for notification_preferences table
 */
interface NotificationPreferencesRow {
  id: number;
  member_id: string;
  position_updates: number;
  at_risk_warnings: number;
  naib_alerts: number;
  frequency: string;
  alerts_sent_this_week: number;
  week_start_timestamp: string;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to NotificationPreferences interface
 */
function rowToNotificationPreferences(row: NotificationPreferencesRow): NotificationPreferences {
  return {
    id: row.id,
    memberId: row.member_id,
    positionUpdates: row.position_updates === 1,
    atRiskWarnings: row.at_risk_warnings === 1,
    naibAlerts: row.naib_alerts === 1,
    frequency: row.frequency as AlertFrequency,
    alertsSentThisWeek: row.alerts_sent_this_week,
    weekStartTimestamp: new Date(row.week_start_timestamp),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get notification preferences for a member
 * Returns null if member has no preferences set
 */
export function getNotificationPreferences(memberId: string): NotificationPreferences | null {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT * FROM notification_preferences
    WHERE member_id = ?
  `).get(memberId) as NotificationPreferencesRow | undefined;

  return row ? rowToNotificationPreferences(row) : null;
}

/**
 * Create or update notification preferences for a member
 * Uses upsert pattern (INSERT OR REPLACE)
 */
export function upsertNotificationPreferences(
  memberId: string,
  prefs: {
    positionUpdates?: boolean;
    atRiskWarnings?: boolean;
    naibAlerts?: boolean;
    frequency?: AlertFrequency;
  }
): NotificationPreferences {
  const database = getDatabase();

  // Get existing preferences to merge with new values
  const existing = getNotificationPreferences(memberId);

  const positionUpdates = prefs.positionUpdates ?? existing?.positionUpdates ?? true;
  const atRiskWarnings = prefs.atRiskWarnings ?? existing?.atRiskWarnings ?? true;
  const naibAlerts = prefs.naibAlerts ?? existing?.naibAlerts ?? true;
  const frequency = prefs.frequency ?? existing?.frequency ?? '3_per_week';
  const alertsSentThisWeek = existing?.alertsSentThisWeek ?? 0;
  const weekStartTimestamp = existing?.weekStartTimestamp?.toISOString() ?? new Date().toISOString();

  if (existing) {
    // Update existing
    database.prepare(`
      UPDATE notification_preferences
      SET position_updates = ?,
          at_risk_warnings = ?,
          naib_alerts = ?,
          frequency = ?,
          updated_at = datetime('now')
      WHERE member_id = ?
    `).run(
      positionUpdates ? 1 : 0,
      atRiskWarnings ? 1 : 0,
      naibAlerts ? 1 : 0,
      frequency,
      memberId
    );
  } else {
    // Insert new
    database.prepare(`
      INSERT INTO notification_preferences (
        member_id,
        position_updates,
        at_risk_warnings,
        naib_alerts,
        frequency,
        alerts_sent_this_week,
        week_start_timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      memberId,
      positionUpdates ? 1 : 0,
      atRiskWarnings ? 1 : 0,
      naibAlerts ? 1 : 0,
      frequency,
      alertsSentThisWeek,
      weekStartTimestamp
    );
  }

  return getNotificationPreferences(memberId)!;
}

/**
 * Increment the alert counter for a member
 */
export function incrementAlertCounter(memberId: string): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE notification_preferences
    SET alerts_sent_this_week = alerts_sent_this_week + 1,
        updated_at = datetime('now')
    WHERE member_id = ?
  `).run(memberId);
}

/**
 * Reset weekly alert counters for all members
 * Should be called at the start of each week
 */
export function resetWeeklyAlertCounters(): number {
  const database = getDatabase();

  const result = database.prepare(`
    UPDATE notification_preferences
    SET alerts_sent_this_week = 0,
        week_start_timestamp = datetime('now'),
        updated_at = datetime('now')
  `).run();

  return result.changes;
}

/**
 * Get all members eligible for position alerts
 * Returns members with position_updates enabled who haven't reached their weekly limit
 */
export function getMembersForPositionAlerts(): NotificationPreferences[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM notification_preferences
    WHERE position_updates = 1
    AND (
      (frequency = 'daily') OR
      (frequency = '3_per_week' AND alerts_sent_this_week < 3) OR
      (frequency = '2_per_week' AND alerts_sent_this_week < 2) OR
      (frequency = '1_per_week' AND alerts_sent_this_week < 1)
    )
  `).all() as NotificationPreferencesRow[];

  return rows.map(rowToNotificationPreferences);
}

/**
 * Get all members eligible for at-risk warnings
 * Returns members with at_risk_warnings enabled
 */
export function getMembersForAtRiskAlerts(): NotificationPreferences[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM notification_preferences
    WHERE at_risk_warnings = 1
  `).all() as NotificationPreferencesRow[];

  return rows.map(rowToNotificationPreferences);
}

/**
 * Get notification preferences count by setting
 */
export function getNotificationPreferencesStats(): {
  total: number;
  positionUpdatesEnabled: number;
  atRiskWarningsEnabled: number;
  naibAlertsEnabled: number;
} {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN position_updates = 1 THEN 1 ELSE 0 END) as position_updates_enabled,
      SUM(CASE WHEN at_risk_warnings = 1 THEN 1 ELSE 0 END) as at_risk_warnings_enabled,
      SUM(CASE WHEN naib_alerts = 1 THEN 1 ELSE 0 END) as naib_alerts_enabled
    FROM notification_preferences
  `).get() as {
    total: number;
    position_updates_enabled: number;
    at_risk_warnings_enabled: number;
    naib_alerts_enabled: number;
  };

  return {
    total: row.total,
    positionUpdatesEnabled: row.position_updates_enabled,
    atRiskWarningsEnabled: row.at_risk_warnings_enabled,
    naibAlertsEnabled: row.naib_alerts_enabled,
  };
}

// =============================================================================
// Alert History Queries (Sprint 13: Notification System)
// =============================================================================

/**
 * Database row type for alert_history table
 */
interface AlertHistoryRow {
  id: number;
  recipient_id: string;
  recipient_type: string;
  alert_type: string;
  alert_data: string;
  delivered: number;
  delivery_error: string | null;
  sent_at: string;
}

/**
 * Convert database row to AlertRecord interface
 */
function rowToAlertRecord(row: AlertHistoryRow): AlertRecord {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    recipientType: row.recipient_type as 'member' | 'waitlist',
    alertType: row.alert_type as AlertType,
    alertData: JSON.parse(row.alert_data) as AlertData,
    delivered: row.delivered === 1,
    deliveryError: row.delivery_error,
    sentAt: new Date(row.sent_at),
  };
}

/**
 * Insert a new alert record
 */
export function insertAlertRecord(data: {
  recipientId: string;
  recipientType: 'member' | 'waitlist';
  alertType: AlertType;
  alertData: AlertData;
  delivered: boolean;
  deliveryError?: string;
}): AlertRecord {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO alert_history (
      recipient_id,
      recipient_type,
      alert_type,
      alert_data,
      delivered,
      delivery_error
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.recipientId,
    data.recipientType,
    data.alertType,
    JSON.stringify(data.alertData),
    data.delivered ? 1 : 0,
    data.deliveryError ?? null
  );

  const row = database.prepare(`
    SELECT * FROM alert_history WHERE id = ?
  `).get(result.lastInsertRowid) as AlertHistoryRow;

  return rowToAlertRecord(row);
}

/**
 * Update alert delivery status
 */
export function updateAlertDeliveryStatus(
  alertId: number,
  delivered: boolean,
  deliveryError?: string
): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE alert_history
    SET delivered = ?,
        delivery_error = ?
    WHERE id = ?
  `).run(delivered ? 1 : 0, deliveryError ?? null, alertId);
}

/**
 * Get alert history for a recipient
 */
export function getAlertHistory(
  recipientId: string,
  options: {
    limit?: number;
    alertType?: AlertType;
  } = {}
): AlertRecord[] {
  const database = getDatabase();

  const limit = options.limit ?? 50;

  if (options.alertType) {
    const rows = database.prepare(`
      SELECT * FROM alert_history
      WHERE recipient_id = ? AND alert_type = ?
      ORDER BY sent_at DESC
      LIMIT ?
    `).all(recipientId, options.alertType, limit) as AlertHistoryRow[];

    return rows.map(rowToAlertRecord);
  }

  const rows = database.prepare(`
    SELECT * FROM alert_history
    WHERE recipient_id = ?
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(recipientId, limit) as AlertHistoryRow[];

  return rows.map(rowToAlertRecord);
}

/**
 * Count alerts sent to a recipient this week
 */
export function countAlertsThisWeek(recipientId: string): number {
  const database = getDatabase();

  // Get start of current week (Sunday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);

  const row = database.prepare(`
    SELECT COUNT(*) as count
    FROM alert_history
    WHERE recipient_id = ? AND sent_at >= ?
  `).get(recipientId, startOfWeek.toISOString()) as { count: number };

  return row.count;
}

/**
 * Get alert statistics
 */
export function getAlertStats(): {
  totalSent: number;
  sentThisWeek: number;
  byType: Record<string, number>;
  deliveryRate: number;
} {
  const database = getDatabase();

  // Total sent
  const totalRow = database.prepare(`
    SELECT COUNT(*) as count FROM alert_history
  `).get() as { count: number };

  // Sent this week
  const now = new Date();
  const dayOfWeek = now.getDay();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);

  const weekRow = database.prepare(`
    SELECT COUNT(*) as count
    FROM alert_history
    WHERE sent_at >= ?
  `).get(startOfWeek.toISOString()) as { count: number };

  // By type
  const typeRows = database.prepare(`
    SELECT alert_type, COUNT(*) as count
    FROM alert_history
    GROUP BY alert_type
  `).all() as Array<{ alert_type: string; count: number }>;

  const byType: Record<string, number> = {};
  for (const row of typeRows) {
    byType[row.alert_type] = row.count;
  }

  // Delivery rate
  const deliveryRow = database.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN delivered = 1 THEN 1 ELSE 0 END) as delivered
    FROM alert_history
  `).get() as { total: number; delivered: number };

  const deliveryRate = deliveryRow.total > 0
    ? deliveryRow.delivered / deliveryRow.total
    : 1;

  return {
    totalSent: totalRow.count,
    sentThisWeek: weekRow.count,
    byType,
    deliveryRate,
  };
}

/**
 * Get recent alerts across all recipients (for admin)
 */
export function getRecentAlerts(limit: number = 50): AlertRecord[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM alert_history
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit) as AlertHistoryRow[];

  return rows.map(rowToAlertRecord);
}

// =============================================================================
// Tier System Queries (v3.0 - Sprint 15: Tier Foundation)
// =============================================================================

/**
 * Database row for tier_history table
 */
interface TierHistoryRow {
  id: number;
  member_id: string;
  old_tier: string | null;
  new_tier: string;
  bgt_at_change: string;
  rank_at_change: number | null;
  changed_at: string;
}

/**
 * Convert tier history row to TierHistoryEntry
 */
function rowToTierHistoryEntry(row: TierHistoryRow): import('../types/index.js').TierHistoryEntry {
  return {
    id: row.id,
    memberId: row.member_id,
    oldTier: row.old_tier as import('../types/index.js').Tier | null,
    newTier: row.new_tier as import('../types/index.js').Tier,
    bgtAtChange: row.bgt_at_change,
    rankAtChange: row.rank_at_change,
    changedAt: new Date(row.changed_at),
  };
}

/**
 * Update member's tier in member_profiles
 *
 * @param memberId - Member ID
 * @param newTier - New tier
 */
export function updateMemberTier(memberId: string, newTier: string): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE member_profiles
    SET tier = ?,
        tier_updated_at = datetime('now')
    WHERE member_id = ?
  `).run(newTier, memberId);
}

/**
 * Insert tier change record into tier_history
 *
 * @param memberId - Member ID
 * @param oldTier - Previous tier (null for initial assignment)
 * @param newTier - New tier
 * @param bgtAtChange - BGT holdings at time of change (wei as string)
 * @param rankAtChange - Eligibility rank at time of change
 * @returns Inserted record ID
 */
export function insertTierHistory(
  memberId: string,
  oldTier: string | null,
  newTier: string,
  bgtAtChange: string,
  rankAtChange: number | null
): number {
  const database = getDatabase();

  const result = database.prepare(`
    INSERT INTO tier_history (member_id, old_tier, new_tier, bgt_at_change, rank_at_change)
    VALUES (?, ?, ?, ?, ?)
  `).run(memberId, oldTier, newTier, bgtAtChange, rankAtChange);

  return result.lastInsertRowid as number;
}

/**
 * Get tier history for a specific member
 *
 * @param memberId - Member ID
 * @returns Array of tier history entries
 */
export function getTierHistory(memberId: string): import('../types/index.js').TierHistoryEntry[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM tier_history
    WHERE member_id = ?
    ORDER BY changed_at DESC
  `).all(memberId) as TierHistoryRow[];

  return rows.map(rowToTierHistoryEntry);
}

/**
 * Get recent tier changes across all members
 *
 * @param limit - Maximum number of records to return
 * @returns Array of tier history entries
 */
export function getRecentTierChanges(limit: number = 50): import('../types/index.js').TierHistoryEntry[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM tier_history
    ORDER BY changed_at DESC
    LIMIT ?
  `).all(limit) as TierHistoryRow[];

  return rows.map(rowToTierHistoryEntry);
}

/**
 * Get tier distribution (count of members in each tier)
 *
 * @returns Object with tier counts
 */
export function getTierDistribution(): import('../types/index.js').TierDistribution {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT tier, COUNT(*) as count
    FROM member_profiles
    WHERE onboarding_complete = 1
    GROUP BY tier
  `).all() as Array<{ tier: string; count: number }>;

  // Initialize all tiers to 0
  const distribution: import('../types/index.js').TierDistribution = {
    hajra: 0,
    ichwan: 0,
    qanat: 0,
    sihaya: 0,
    mushtamal: 0,
    sayyadina: 0,
    usul: 0,
    fedaykin: 0,
    naib: 0,
  };

  // Populate with actual counts
  for (const row of rows) {
    distribution[row.tier as keyof typeof distribution] = row.count;
  }

  return distribution;
}

/**
 * Get tier changes within a date range
 * Useful for weekly digest and analytics
 *
 * @param startDate - Start date (ISO string or Date)
 * @param endDate - End date (ISO string or Date)
 * @returns Array of tier history entries
 */
export function getTierChangesInDateRange(
  startDate: string | Date,
  endDate: string | Date
): import('../types/index.js').TierHistoryEntry[] {
  const database = getDatabase();

  const startStr = startDate instanceof Date ? startDate.toISOString() : startDate;
  const endStr = endDate instanceof Date ? endDate.toISOString() : endDate;

  const rows = database.prepare(`
    SELECT * FROM tier_history
    WHERE changed_at >= ? AND changed_at <= ?
    ORDER BY changed_at DESC
  `).all(startStr, endStr) as TierHistoryRow[];

  return rows.map(rowToTierHistoryEntry);
}

/**
 * Count tier promotions within a date range
 * A promotion is when new_tier is higher in TIER_ORDER than old_tier
 *
 * @param startDate - Start date (ISO string or Date)
 * @param endDate - End date (ISO string or Date)
 * @returns Count of promotions
 */
export function countTierPromotions(
  startDate: string | Date,
  endDate: string | Date
): number {
  const database = getDatabase();

  const startStr = startDate instanceof Date ? startDate.toISOString() : startDate;
  const endStr = endDate instanceof Date ? endDate.toISOString() : endDate;

  const result = database.prepare(`
    SELECT COUNT(*) as count
    FROM tier_history
    WHERE changed_at >= ? AND changed_at <= ?
      AND old_tier IS NOT NULL
  `).get(startStr, endStr) as { count: number };

  return result.count;
}

/**
 * Get members by tier
 *
 * @param tier - Tier to filter by
 * @returns Array of member profiles
 */
export function getMembersByTier(tier: string): import('../types/index.js').MemberProfile[] {
  const database = getDatabase();

  const rows = database.prepare(`
    SELECT * FROM member_profiles
    WHERE tier = ? AND onboarding_complete = 1
    ORDER BY tier_updated_at DESC
  `).all(tier) as MemberProfileRow[];

  return rows.map(rowToMemberProfile);
}
