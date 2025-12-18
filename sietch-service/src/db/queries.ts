import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { SCHEMA_SQL, CLEANUP_OLD_SNAPSHOTS_SQL, SOCIAL_LAYER_SCHEMA_SQL } from './schema.js';
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
} from '../types/index.js';

let db: Database.Database | null = null;

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
