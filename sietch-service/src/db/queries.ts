import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { SCHEMA_SQL, CLEANUP_OLD_SNAPSHOTS_SQL } from './schema.js';
import type {
  EligibilityEntry,
  SerializedEligibilityEntry,
  HealthStatus,
  AdminOverride,
  AuditLogEntry,
  WalletMapping,
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
