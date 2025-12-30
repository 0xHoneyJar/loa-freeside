// =============================================================================
// Waitlist Registration Queries (Sprint 12: Cave Entrance)
// =============================================================================

import { getDatabase } from '../connection.js';
import type { WaitlistRegistration } from '../../types/index.js';

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
