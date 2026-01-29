/**
 * Identity Service (v4.1 - Sprint 30)
 *
 * Cross-platform identity management for wallet-centric identity model:
 * - Wallet address is the canonical identifier
 * - Platform IDs (Discord, Telegram) link TO the wallet
 * - All services use member_id (derived from wallet)
 *
 * Responsibilities:
 * - Platform → Member lookups
 * - Cross-platform linking
 * - Verification session management
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import {
  VERIFICATION_SESSION_EXPIRY_MS,
  MAX_VERIFICATION_ATTEMPTS_PER_HOUR,
} from '../db/migrations/012_telegram_identity.js';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Platform identifier types
 */
export type Platform = 'discord' | 'telegram';

/**
 * Information about a linked platform
 */
export interface PlatformLink {
  platform: Platform;
  platformUserId: string;
  linkedAt: Date;
}

/**
 * Complete member identity with all linked platforms
 */
export interface MemberIdentity {
  memberId: string;
  walletAddress: string;
  platforms: PlatformLink[];
}

/**
 * Verification session status
 */
export type VerificationSessionStatus = 'pending' | 'completed' | 'expired' | 'failed';

/**
 * Verification session record
 */
export interface VerificationSession {
  id: string;
  telegramUserId: string;
  telegramUsername?: string;
  collablandSessionId?: string;
  status: VerificationSessionStatus;
  walletAddress?: string;
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  errorMessage?: string;
}

/**
 * Platform status for a member
 */
export interface PlatformStatus {
  wallet: string;
  discord: {
    linked: boolean;
    userId?: string;
    linkedAt?: Date;
  };
  telegram: {
    linked: boolean;
    userId?: string;
    linkedAt?: Date;
  };
}

// =============================================================================
// Identity Service Implementation
// =============================================================================

class IdentityService {
  /**
   * Look up a member by any platform ID
   *
   * @param platform - The platform type ('discord' or 'telegram')
   * @param platformUserId - The user ID on that platform
   * @returns MemberIdentity if found, null otherwise
   */
  async getMemberByPlatformId(
    platform: Platform,
    platformUserId: string
  ): Promise<MemberIdentity | null> {
    const db = getDatabase();

    // SECURITY: Use separate prepared statements to avoid SQL injection
    // Template literals with column names are safe here since 'platform' is typed,
    // but using explicit queries is cleaner and more defensive
    type MemberRow = {
      id: string;
      wallet_address: string;
      discord_user_id: string | null;
      telegram_user_id: string | null;
      discord_linked_at: number | null;
      telegram_linked_at: number | null;
    };

    let member: MemberRow | undefined;

    if (platform === 'discord') {
      member = db.prepare(`
        SELECT
          id,
          wallet_address,
          discord_user_id,
          telegram_user_id,
          joined_at as discord_linked_at,
          telegram_linked_at
        FROM member_profiles
        WHERE discord_user_id = ?
      `).get(platformUserId) as MemberRow | undefined;
    } else {
      member = db.prepare(`
        SELECT
          id,
          wallet_address,
          discord_user_id,
          telegram_user_id,
          joined_at as discord_linked_at,
          telegram_linked_at
        FROM member_profiles
        WHERE telegram_user_id = ?
      `).get(platformUserId) as MemberRow | undefined;
    }

    if (!member) {
      return null;
    }

    const platforms: PlatformLink[] = [];

    if (member.discord_user_id) {
      platforms.push({
        platform: 'discord',
        platformUserId: member.discord_user_id,
        linkedAt: new Date(member.discord_linked_at || Date.now()),
      });
    }

    if (member.telegram_user_id) {
      platforms.push({
        platform: 'telegram',
        platformUserId: member.telegram_user_id,
        // telegram_linked_at is stored in seconds, convert to milliseconds for Date
        linkedAt: new Date((member.telegram_linked_at || Math.floor(Date.now() / 1000)) * 1000),
      });
    }

    return {
      memberId: member.id,
      walletAddress: member.wallet_address,
      platforms,
    };
  }

  /**
   * Get a member by wallet address
   *
   * @param walletAddress - The wallet address (case-insensitive)
   * @returns MemberIdentity if found, null otherwise
   */
  async getMemberByWallet(walletAddress: string): Promise<MemberIdentity | null> {
    const db = getDatabase();

    const member = db.prepare(`
      SELECT
        id,
        wallet_address,
        discord_user_id,
        telegram_user_id,
        joined_at as discord_linked_at,
        telegram_linked_at
      FROM member_profiles
      WHERE LOWER(wallet_address) = LOWER(?)
    `).get(walletAddress) as {
      id: string;
      wallet_address: string;
      discord_user_id: string | null;
      telegram_user_id: string | null;
      discord_linked_at: number | null;
      telegram_linked_at: number | null;
    } | undefined;

    if (!member) {
      return null;
    }

    const platforms: PlatformLink[] = [];

    if (member.discord_user_id) {
      platforms.push({
        platform: 'discord',
        platformUserId: member.discord_user_id,
        linkedAt: new Date(member.discord_linked_at || Date.now()),
      });
    }

    if (member.telegram_user_id) {
      platforms.push({
        platform: 'telegram',
        platformUserId: member.telegram_user_id,
        // telegram_linked_at is stored in seconds, convert to milliseconds for Date
        linkedAt: new Date((member.telegram_linked_at || Math.floor(Date.now() / 1000)) * 1000),
      });
    }

    return {
      memberId: member.id,
      walletAddress: member.wallet_address,
      platforms,
    };
  }

  /**
   * Link a Telegram account to an existing member
   *
   * @param memberId - The member's ID
   * @param telegramUserId - The Telegram user ID
   * @throws Error if Telegram account is already linked to another wallet
   *
   * NOTE: telegram_linked_at is stored in SECONDS (Unix timestamp) to match
   * the telegram_verification_sessions table. Discord's joined_at uses
   * milliseconds for backwards compatibility.
   */
  async linkTelegram(memberId: string, telegramUserId: string): Promise<void> {
    const db = getDatabase();

    // Check if this Telegram account is already linked to a different member
    const existing = db.prepare(`
      SELECT id FROM member_profiles WHERE telegram_user_id = ?
    `).get(telegramUserId) as { id: string } | undefined;

    if (existing && existing.id !== memberId) {
      throw new Error('Telegram account already linked to another wallet');
    }

    // Update the member profile with Telegram link
    // Use seconds for telegram_linked_at (matching verification sessions table)
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = db.prepare(`
      UPDATE member_profiles
      SET telegram_user_id = ?, telegram_linked_at = ?
      WHERE id = ?
    `).run(telegramUserId, nowSeconds, memberId);

    if (result.changes === 0) {
      throw new Error('Member not found');
    }

    logger.info(
      { memberId, telegramUserId },
      'Telegram account linked to member'
    );
  }

  /**
   * Unlink a Telegram account from a member
   *
   * @param memberId - The member's ID
   */
  async unlinkTelegram(memberId: string): Promise<void> {
    const db = getDatabase();

    const result = db.prepare(`
      UPDATE member_profiles
      SET telegram_user_id = NULL, telegram_linked_at = NULL
      WHERE id = ?
    `).run(memberId);

    if (result.changes === 0) {
      throw new Error('Member not found');
    }

    logger.info({ memberId }, 'Telegram account unlinked from member');
  }

  /**
   * Create a verification session for Telegram wallet linking
   *
   * @param telegramUserId - The Telegram user ID initiating verification
   * @param telegramUsername - Optional Telegram username
   * @returns Session ID and verify URL
   */
  async createVerificationSession(
    telegramUserId: string,
    telegramUsername?: string
  ): Promise<{ sessionId: string; verifyUrl: string }> {
    const db = getDatabase();

    // Check rate limiting
    const recentAttempts = db.prepare(`
      SELECT COUNT(*) as count
      FROM telegram_verification_sessions
      WHERE telegram_user_id = ?
        AND created_at > ?
    `).get(telegramUserId, Math.floor(Date.now() / 1000) - 3600) as { count: number };

    if (recentAttempts.count >= MAX_VERIFICATION_ATTEMPTS_PER_HOUR) {
      throw new Error(
        `Too many verification attempts. Please wait and try again later.`
      );
    }

    // Expire any pending sessions for this user
    db.prepare(`
      UPDATE telegram_verification_sessions
      SET status = 'expired'
      WHERE telegram_user_id = ? AND status = 'pending'
    `).run(telegramUserId);

    // Create new session
    const sessionId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + Math.floor(VERIFICATION_SESSION_EXPIRY_MS / 1000);

    db.prepare(`
      INSERT INTO telegram_verification_sessions
        (id, telegram_user_id, telegram_username, status, created_at, expires_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(sessionId, telegramUserId, telegramUsername || null, now, expiresAt);

    // Generate in-house verification URL (Sprint 172 - replaces Collab.Land)
    const baseUrl = config.verification.baseUrl;
    if (!baseUrl) {
      throw new Error('VERIFY_BASE_URL not configured. Set it in environment variables.');
    }
    const verifyUrl = `${baseUrl}/verify/${sessionId}?platform=telegram`;

    logger.info(
      { sessionId, telegramUserId },
      'Created Telegram verification session'
    );

    return { sessionId, verifyUrl };
  }

  /**
   * Get a verification session by ID
   *
   * @param sessionId - The session ID
   * @returns VerificationSession if found, null otherwise
   */
  async getVerificationSession(sessionId: string): Promise<VerificationSession | null> {
    const db = getDatabase();

    const session = db.prepare(`
      SELECT
        id,
        telegram_user_id,
        telegram_username,
        collabland_session_id,
        status,
        wallet_address,
        created_at,
        expires_at,
        completed_at,
        error_message
      FROM telegram_verification_sessions
      WHERE id = ?
    `).get(sessionId) as {
      id: string;
      telegram_user_id: string;
      telegram_username: string | null;
      collabland_session_id: string | null;
      status: VerificationSessionStatus;
      wallet_address: string | null;
      created_at: number;
      expires_at: number;
      completed_at: number | null;
      error_message: string | null;
    } | undefined;

    if (!session) {
      return null;
    }

    return {
      id: session.id,
      telegramUserId: session.telegram_user_id,
      telegramUsername: session.telegram_username || undefined,
      collablandSessionId: session.collabland_session_id || undefined,
      status: session.status,
      walletAddress: session.wallet_address || undefined,
      createdAt: new Date(session.created_at * 1000),
      expiresAt: new Date(session.expires_at * 1000),
      completedAt: session.completed_at ? new Date(session.completed_at * 1000) : undefined,
      errorMessage: session.error_message || undefined,
    };
  }

  /**
   * Complete a verification session (called from Collab.Land webhook)
   *
   * @param sessionId - The session ID
   * @param walletAddress - The verified wallet address
   * @returns The Telegram user ID and member ID
   */
  async completeVerification(
    sessionId: string,
    walletAddress: string
  ): Promise<{ telegramUserId: string; memberId: string }> {
    const db = getDatabase();

    // Get the session first (outside transaction to fail fast)
    const session = db.prepare(`
      SELECT telegram_user_id, status, expires_at
      FROM telegram_verification_sessions
      WHERE id = ?
    `).get(sessionId) as {
      telegram_user_id: string;
      status: string;
      expires_at: number;
    } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'pending') {
      throw new Error('Session already processed');
    }

    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at < now) {
      // Mark as expired
      db.prepare(`
        UPDATE telegram_verification_sessions
        SET status = 'expired'
        WHERE id = ?
      `).run(sessionId);
      throw new Error('Session expired');
    }

    // Use transaction for atomic member creation/linking and session completion
    // This prevents partial state if any step fails
    const completeVerificationTx = db.transaction(() => {
      // Find or create member by wallet
      let member = db.prepare(`
        SELECT id FROM member_profiles WHERE LOWER(wallet_address) = LOWER(?)
      `).get(walletAddress) as { id: string } | undefined;

      if (!member) {
        // Create new member profile
        const memberId = randomUUID();
        db.prepare(`
          INSERT INTO member_profiles (id, wallet_address, joined_at)
          VALUES (?, ?, ?)
        `).run(memberId, walletAddress.toLowerCase(), now);

        member = { id: memberId };
        logger.info(
          { memberId, walletAddress },
          'Created new member profile from Telegram verification'
        );
      }

      // Check if this Telegram account is already linked to a different member
      const existingLink = db.prepare(`
        SELECT id FROM member_profiles WHERE telegram_user_id = ?
      `).get(session.telegram_user_id) as { id: string } | undefined;

      if (existingLink && existingLink.id !== member.id) {
        throw new Error('Telegram account already linked to another wallet');
      }

      // Link Telegram to member (inline to stay in transaction)
      db.prepare(`
        UPDATE member_profiles
        SET telegram_user_id = ?, telegram_linked_at = ?
        WHERE id = ?
      `).run(session.telegram_user_id, now, member.id);

      // Mark session as completed
      db.prepare(`
        UPDATE telegram_verification_sessions
        SET status = 'completed', wallet_address = ?, completed_at = ?
        WHERE id = ?
      `).run(walletAddress.toLowerCase(), now, sessionId);

      return member.id;
    });

    // Execute the transaction
    const memberId = completeVerificationTx();

    logger.info(
      { sessionId, memberId, telegramUserId: session.telegram_user_id },
      'Telegram verification completed'
    );

    return {
      telegramUserId: session.telegram_user_id,
      memberId,
    };
  }

  /**
   * Fail a verification session
   *
   * @param sessionId - The session ID
   * @param errorMessage - The error message
   */
  async failVerification(sessionId: string, errorMessage: string): Promise<void> {
    const db = getDatabase();

    db.prepare(`
      UPDATE telegram_verification_sessions
      SET status = 'failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, sessionId);

    logger.warn({ sessionId, errorMessage }, 'Telegram verification failed');
  }

  /**
   * Get platform status for a member
   *
   * @param memberId - The member's ID
   * @returns PlatformStatus with linked platform information
   */
  async getPlatformStatus(memberId: string): Promise<PlatformStatus> {
    const db = getDatabase();

    const member = db.prepare(`
      SELECT
        wallet_address,
        discord_user_id,
        telegram_user_id,
        joined_at as discord_linked_at,
        telegram_linked_at
      FROM member_profiles
      WHERE id = ?
    `).get(memberId) as {
      wallet_address: string;
      discord_user_id: string | null;
      telegram_user_id: string | null;
      discord_linked_at: number | null;
      telegram_linked_at: number | null;
    } | undefined;

    if (!member) {
      throw new Error('Member not found');
    }

    return {
      wallet: member.wallet_address,
      discord: {
        linked: !!member.discord_user_id,
        userId: member.discord_user_id || undefined,
        linkedAt: member.discord_linked_at
          ? new Date(member.discord_linked_at)
          : undefined,
      },
      telegram: {
        linked: !!member.telegram_user_id,
        userId: member.telegram_user_id || undefined,
        linkedAt: member.telegram_linked_at
          ? new Date(member.telegram_linked_at * 1000)
          : undefined,
      },
    };
  }

  /**
   * Get pending verification session for a Telegram user
   * Used to check if user has an active verification in progress
   *
   * @param telegramUserId - The Telegram user ID
   * @returns VerificationSession if found, null otherwise
   */
  async getPendingSession(telegramUserId: string): Promise<VerificationSession | null> {
    const db = getDatabase();

    const now = Math.floor(Date.now() / 1000);

    const session = db.prepare(`
      SELECT
        id,
        telegram_user_id,
        telegram_username,
        collabland_session_id,
        status,
        wallet_address,
        created_at,
        expires_at,
        completed_at,
        error_message
      FROM telegram_verification_sessions
      WHERE telegram_user_id = ?
        AND status = 'pending'
        AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(telegramUserId, now) as {
      id: string;
      telegram_user_id: string;
      telegram_username: string | null;
      collabland_session_id: string | null;
      status: VerificationSessionStatus;
      wallet_address: string | null;
      created_at: number;
      expires_at: number;
      completed_at: number | null;
      error_message: string | null;
    } | undefined;

    if (!session) {
      return null;
    }

    return {
      id: session.id,
      telegramUserId: session.telegram_user_id,
      telegramUsername: session.telegram_username || undefined,
      collablandSessionId: session.collabland_session_id || undefined,
      status: session.status,
      walletAddress: session.wallet_address || undefined,
      createdAt: new Date(session.created_at * 1000),
      expiresAt: new Date(session.expires_at * 1000),
      completedAt: session.completed_at ? new Date(session.completed_at * 1000) : undefined,
      errorMessage: session.error_message || undefined,
    };
  }

  /**
   * Clean up expired verification sessions
   * Should be called periodically (e.g., by trigger.dev task)
   *
   * @returns Number of sessions cleaned up
   */
  async cleanupExpiredSessions(): Promise<number> {
    const db = getDatabase();

    const now = Math.floor(Date.now() / 1000);

    const result = db.prepare(`
      UPDATE telegram_verification_sessions
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < ?
    `).run(now);

    if (result.changes > 0) {
      logger.info(
        { count: result.changes },
        'Cleaned up expired verification sessions'
      );
    }

    return result.changes;
  }
}

// Export singleton instance
export const identityService = new IdentityService();
