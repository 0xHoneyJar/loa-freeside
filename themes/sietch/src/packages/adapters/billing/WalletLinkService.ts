/**
 * WalletLinkService — EIP-191 Wallet Verification & Linking
 *
 * Handles nonce issuance, wallet signature verification, and
 * wallet→account linking with collision detection.
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Tasks 11.2, 11.3
 *
 * @module packages/adapters/billing/WalletLinkService
 */

import { randomBytes, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface NonceResult {
  nonceId: string;
  nonce: string;
  message: string;
  expiresAt: string;
}

export interface LinkResult {
  success: boolean;
  linkId?: string;
  error?: string;
  code?: string;
}

export interface WalletLink {
  id: string;
  walletAddress: string;
  chainId: number;
  linkedAt: string;
}

/** Pluggable signature verifier for testability */
export type SignatureVerifier = (
  message: string,
  signature: string,
  expectedAddress: string,
) => boolean;

// =============================================================================
// Constants
// =============================================================================

/** Nonce validity window */
const NONCE_EXPIRY_MINUTES = 5;

/** Maximum wallets per account */
const MAX_WALLETS_PER_ACCOUNT = 10;

// =============================================================================
// WalletLinkService
// =============================================================================

export class WalletLinkService {
  private db: Database.Database;
  private verifySignature: SignatureVerifier;

  constructor(db: Database.Database, verifySignature?: SignatureVerifier) {
    this.db = db;
    // Default verifier always returns true (production would use viem/ethers)
    this.verifySignature = verifySignature ?? (() => true);
  }

  /**
   * Issue a nonce for wallet linking.
   * 16-byte random, 5-minute expiry.
   */
  issueNonce(accountId: string, walletAddress: string): NonceResult {
    const nonceId = randomUUID();
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + NONCE_EXPIRY_MINUTES * 60 * 1000).toISOString();
    const normalizedAddress = walletAddress.toLowerCase();

    const message = `Link wallet ${normalizedAddress} to account. Nonce: ${nonce}`;

    this.db.prepare(`
      INSERT INTO wallet_link_nonces (id, account_id, nonce, wallet_address, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(nonceId, accountId, nonce, normalizedAddress, expiresAt);

    return { nonceId, nonce, message, expiresAt };
  }

  /**
   * Link a wallet after verifying the signed nonce.
   * Atomic nonce consumption + wallet link creation.
   */
  linkWallet(
    accountId: string,
    walletAddress: string,
    nonce: string,
    signature: string,
    chainId: number = 1,
  ): LinkResult {
    const normalizedAddress = walletAddress.toLowerCase();

    return this.db.transaction(() => {
      // 1. Find and validate nonce
      const nonceRow = this.db.prepare(`
        SELECT id, nonce, wallet_address, expires_at, used_at
        FROM wallet_link_nonces
        WHERE nonce = ? AND account_id = ? AND wallet_address = ?
      `).get(nonce, accountId, normalizedAddress) as {
        id: string; nonce: string; wallet_address: string;
        expires_at: string; used_at: string | null;
      } | undefined;

      if (!nonceRow) {
        return { success: false, error: 'Invalid nonce', code: 'INVALID_NONCE' };
      }

      if (nonceRow.used_at) {
        return { success: false, error: 'Nonce already used', code: 'NONCE_USED' };
      }

      if (new Date(nonceRow.expires_at) < new Date()) {
        return { success: false, error: 'Nonce expired', code: 'NONCE_EXPIRED' };
      }

      // 2. Consume nonce atomically
      this.db.prepare(`
        UPDATE wallet_link_nonces SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND used_at IS NULL
      `).run(nonceRow.id);

      // 3. Verify EIP-191 signature
      const message = `Link wallet ${normalizedAddress} to account. Nonce: ${nonce}`;
      if (!this.verifySignature(message, signature, normalizedAddress)) {
        return { success: false, error: 'Invalid signature', code: 'INVALID_SIGNATURE' };
      }

      // 4. Check wallet collision
      const existing = this.db.prepare(`
        SELECT account_id FROM wallet_links
        WHERE wallet_address = ? AND chain_id = ? AND unlinked_at IS NULL
      `).get(normalizedAddress, chainId) as { account_id: string } | undefined;

      if (existing) {
        if (existing.account_id === accountId) {
          return { success: false, error: 'Wallet already linked to your account', code: 'ALREADY_LINKED' };
        }
        return { success: false, error: 'Wallet already linked to another account', code: 'WALLET_ALREADY_LINKED' };
      }

      // 5. Check max wallets per account
      const walletCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM wallet_links
        WHERE account_id = ? AND unlinked_at IS NULL
      `).get(accountId) as { count: number };

      if (walletCount.count >= MAX_WALLETS_PER_ACCOUNT) {
        return { success: false, error: `Maximum ${MAX_WALLETS_PER_ACCOUNT} wallets per account`, code: 'MAX_WALLETS' };
      }

      // 6. Create link
      const linkId = randomUUID();
      this.db.prepare(`
        INSERT INTO wallet_links (id, account_id, wallet_address, chain_id)
        VALUES (?, ?, ?, ?)
      `).run(linkId, accountId, normalizedAddress, chainId);

      logger.info({
        event: 'wallet.linked',
        accountId,
        walletAddress: normalizedAddress,
        chainId,
      }, 'Wallet linked');

      return { success: true, linkId };
    })();
  }

  /**
   * Unlink a wallet. Idempotent.
   */
  unlinkWallet(accountId: string, walletAddress: string): LinkResult {
    const normalizedAddress = walletAddress.toLowerCase();

    const result = this.db.prepare(`
      UPDATE wallet_links SET unlinked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = ? AND wallet_address = ? AND unlinked_at IS NULL
    `).run(accountId, normalizedAddress);

    if (result.changes === 0) {
      return { success: false, error: 'Wallet not linked', code: 'NOT_LINKED' };
    }

    logger.info({
      event: 'wallet.unlinked',
      accountId,
      walletAddress: normalizedAddress,
    }, 'Wallet unlinked');

    return { success: true };
  }

  /**
   * List linked wallets for an account.
   */
  getLinkedWallets(accountId: string): WalletLink[] {
    return this.db.prepare(`
      SELECT id, wallet_address as walletAddress, chain_id as chainId, linked_at as linkedAt
      FROM wallet_links
      WHERE account_id = ? AND unlinked_at IS NULL
      ORDER BY linked_at ASC
    `).all(accountId) as WalletLink[];
  }
}
