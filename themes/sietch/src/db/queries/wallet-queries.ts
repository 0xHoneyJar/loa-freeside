// =============================================================================
// Wallet Mapping Queries
// =============================================================================

import { getDatabase } from '../connection.js';

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
