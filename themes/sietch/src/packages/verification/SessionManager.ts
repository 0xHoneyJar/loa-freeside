/**
 * SessionManager - CRUD operations for wallet verification sessions
 *
 * Sprint 78: Database & Session Management
 *
 * Provides session lifecycle management for native wallet verification:
 * - Create new verification sessions with cryptographic nonces
 * - Query sessions by ID, nonce, or user
 * - Track verification attempts
 * - Mark sessions as completed, failed, or expired
 * - Bulk cleanup of expired sessions
 *
 * All operations are scoped to the community (tenant) via RLS policies.
 *
 * @module packages/verification/SessionManager
 */

import { eq, and, lt, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  walletVerificationSessions,
  type WalletVerificationSession,
  type NewWalletVerificationSession,
  type VerificationSessionStatus,
} from '../adapters/storage/schema.js';
import { TenantContext } from '../adapters/storage/TenantContext.js';
import { NonceManager } from './NonceManager.js';

// =============================================================================
// Constants
// =============================================================================

/** Default session TTL in minutes */
const DEFAULT_SESSION_TTL_MINUTES = 15;

/** Maximum verification attempts per session */
const MAX_ATTEMPTS = 3;

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a new verification session
 */
export interface CreateSessionParams {
  /** Discord user ID initiating verification */
  discordUserId: string;
  /** Discord guild ID where verification was initiated */
  discordGuildId: string;
  /** Discord username for display */
  discordUsername: string;
  /** Optional IP address for security tracking */
  ipAddress?: string;
  /** Optional user agent for security tracking */
  userAgent?: string;
}

/**
 * Result of session creation
 */
export interface CreateSessionResult {
  /** The created session */
  session: WalletVerificationSession;
  /** Whether this is a new session or existing pending session was returned */
  isNew: boolean;
}

/**
 * Parameters for marking a session as completed
 */
export interface CompleteSessionParams {
  /** Session ID */
  sessionId: string;
  /** Verified wallet address */
  walletAddress: string;
}

/**
 * Parameters for marking a session as failed
 */
export interface FailSessionParams {
  /** Session ID */
  sessionId: string;
  /** Error message describing the failure */
  errorMessage: string;
}

/**
 * SessionManager configuration options
 */
export interface SessionManagerOptions {
  /** Session TTL in minutes (default: 15) */
  sessionTtlMinutes?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// =============================================================================
// SessionManager
// =============================================================================

/**
 * Manages wallet verification session lifecycle.
 *
 * @example
 * ```typescript
 * const sessionManager = new SessionManager(db, communityId);
 *
 * // Create a new session
 * const { session, isNew } = await sessionManager.create({
 *   discordUserId: '123456',
 *   discordGuildId: '789012',
 *   discordUsername: 'user#1234',
 * });
 *
 * // Complete the session after successful verification
 * await sessionManager.markCompleted({
 *   sessionId: session.id,
 *   walletAddress: '0x1234...',
 * });
 * ```
 */
export class SessionManager {
  private readonly db: PostgresJsDatabase;
  private readonly tenantId: string;
  private readonly tenantContext: TenantContext;
  private readonly nonceManager: NonceManager;
  private readonly sessionTtlMinutes: number;
  private readonly debug: boolean;

  /**
   * Creates a new SessionManager
   *
   * @param db - Drizzle database instance
   * @param tenantId - Community ID for RLS scoping
   * @param options - Configuration options
   */
  constructor(
    db: PostgresJsDatabase,
    tenantId: string,
    options: SessionManagerOptions = {}
  ) {
    this.db = db;
    this.tenantId = tenantId;
    this.tenantContext = new TenantContext(db, { debug: options.debug });
    this.sessionTtlMinutes = options.sessionTtlMinutes ?? DEFAULT_SESSION_TTL_MINUTES;
    this.nonceManager = new NonceManager(this.sessionTtlMinutes);
    this.debug = options.debug ?? false;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Execute a query within tenant context
   */
  private async withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return this.tenantContext.withTenant(this.tenantId, fn);
  }

  /**
   * Log debug messages
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[SessionManager] ${message}`, data ?? '');
    }
  }

  // ===========================================================================
  // Create Operations
  // ===========================================================================

  /**
   * Create a new verification session or return existing pending session
   *
   * If the user already has a pending session that hasn't expired,
   * returns that session instead of creating a new one.
   *
   * @param params - Session creation parameters
   * @returns Created or existing session with isNew flag
   */
  async create(params: CreateSessionParams): Promise<CreateSessionResult> {
    this.log('create', params);

    return this.withTenant(async () => {
      // Check for existing pending session
      const existing = await this.getPendingForUser(params.discordUserId);
      if (existing) {
        this.log('create - returning existing session', { sessionId: existing.id });
        return { session: existing, isNew: false };
      }

      // Generate new nonce
      const nonce = this.nonceManager.generate();

      // Create session
      const sessionData: NewWalletVerificationSession = {
        communityId: this.tenantId,
        discordUserId: params.discordUserId,
        discordGuildId: params.discordGuildId,
        discordUsername: params.discordUsername,
        nonce: nonce.value,
        status: 'pending',
        expiresAt: nonce.expiresAt,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      };

      const result = await this.db
        .insert(walletVerificationSessions)
        .values(sessionData)
        .returning();

      const createdSession = result[0];
      if (!createdSession) {
        throw new Error('Failed to create verification session');
      }

      this.log('create - new session created', { sessionId: createdSession.id });
      return { session: createdSession, isNew: true };
    });
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Get a session by ID
   *
   * @param sessionId - Session ID
   * @returns Session if found, null otherwise
   */
  async getById(sessionId: string): Promise<WalletVerificationSession | null> {
    this.log('getById', { sessionId });

    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(walletVerificationSessions)
        .where(eq(walletVerificationSessions.id, sessionId))
        .limit(1);

      return result[0] ?? null;
    });
  }

  /**
   * Get a session by nonce
   *
   * @param nonce - Session nonce value
   * @returns Session if found, null otherwise
   */
  async getByNonce(nonce: string): Promise<WalletVerificationSession | null> {
    this.log('getByNonce', { nonce: nonce.slice(0, 8) + '...' });

    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(walletVerificationSessions)
        .where(eq(walletVerificationSessions.nonce, nonce))
        .limit(1);

      return result[0] ?? null;
    });
  }

  /**
   * Get the pending session for a user (if any)
   *
   * Returns the most recent pending session that hasn't expired.
   *
   * @param discordUserId - Discord user ID
   * @returns Pending session if found, null otherwise
   */
  async getPendingForUser(
    discordUserId: string
  ): Promise<WalletVerificationSession | null> {
    this.log('getPendingForUser', { discordUserId });

    return this.withTenant(async () => {
      const now = new Date();

      const result = await this.db
        .select()
        .from(walletVerificationSessions)
        .where(
          and(
            eq(walletVerificationSessions.discordUserId, discordUserId),
            eq(walletVerificationSessions.status, 'pending'),
            gt(walletVerificationSessions.expiresAt, now)
          )
        )
        .limit(1);

      return result[0] ?? null;
    });
  }

  /**
   * Get the most recent session for a user regardless of status
   *
   * Returns the most recent session (pending, completed, failed, or expired).
   * Useful for showing verification status to users.
   *
   * @param discordUserId - Discord user ID
   * @returns Most recent session if found, null otherwise
   */
  async getLatestForUser(
    discordUserId: string
  ): Promise<WalletVerificationSession | null> {
    this.log('getLatestForUser', { discordUserId });

    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(walletVerificationSessions)
        .where(eq(walletVerificationSessions.discordUserId, discordUserId))
        .orderBy(sql`${walletVerificationSessions.createdAt} DESC`)
        .limit(1);

      return result[0] ?? null;
    });
  }

  // ===========================================================================
  // Update Operations
  // ===========================================================================

  /**
   * Mark a session as completed with the verified wallet address
   *
   * @param params - Completion parameters
   * @returns Updated session if found and updated, null otherwise
   */
  async markCompleted(
    params: CompleteSessionParams
  ): Promise<WalletVerificationSession | null> {
    this.log('markCompleted', { sessionId: params.sessionId });

    return this.withTenant(async () => {
      const result = await this.db
        .update(walletVerificationSessions)
        .set({
          status: 'completed' as VerificationSessionStatus,
          walletAddress: params.walletAddress.toLowerCase(),
          completedAt: new Date(),
        })
        .where(
          and(
            eq(walletVerificationSessions.id, params.sessionId),
            eq(walletVerificationSessions.status, 'pending')
          )
        )
        .returning();

      return result[0] ?? null;
    });
  }

  /**
   * Increment the attempt counter for a session
   *
   * Returns null if max attempts exceeded (session should be failed).
   *
   * @param sessionId - Session ID
   * @returns Updated session if under limit, null if at/over limit
   */
  async incrementAttempts(
    sessionId: string
  ): Promise<WalletVerificationSession | null> {
    this.log('incrementAttempts', { sessionId });

    return this.withTenant(async () => {
      // Increment and check in one query
      const result = await this.db
        .update(walletVerificationSessions)
        .set({
          attempts: sql`${walletVerificationSessions.attempts} + 1`,
        })
        .where(
          and(
            eq(walletVerificationSessions.id, sessionId),
            eq(walletVerificationSessions.status, 'pending'),
            sql`${walletVerificationSessions.attempts} < ${MAX_ATTEMPTS}`
          )
        )
        .returning();

      return result[0] ?? null;
    });
  }

  /**
   * Mark a session as failed with an error message
   *
   * @param params - Failure parameters
   * @returns Updated session if found, null otherwise
   */
  async markFailed(
    params: FailSessionParams
  ): Promise<WalletVerificationSession | null> {
    this.log('markFailed', { sessionId: params.sessionId });

    return this.withTenant(async () => {
      const result = await this.db
        .update(walletVerificationSessions)
        .set({
          status: 'failed' as VerificationSessionStatus,
          errorMessage: params.errorMessage,
        })
        .where(
          and(
            eq(walletVerificationSessions.id, params.sessionId),
            eq(walletVerificationSessions.status, 'pending')
          )
        )
        .returning();

      return result[0] ?? null;
    });
  }

  /**
   * Expire all sessions that have passed their expiration time
   *
   * Used by the cleanup job to mark old pending sessions as expired.
   *
   * @returns Number of sessions expired
   */
  async expireOldSessions(): Promise<number> {
    this.log('expireOldSessions');

    return this.withTenant(async () => {
      const now = new Date();

      const result = await this.db
        .update(walletVerificationSessions)
        .set({
          status: 'expired' as VerificationSessionStatus,
        })
        .where(
          and(
            eq(walletVerificationSessions.status, 'pending'),
            lt(walletVerificationSessions.expiresAt, now)
          )
        )
        .returning();

      this.log('expireOldSessions - expired count', { count: result.length });
      return result.length;
    });
  }

  // ===========================================================================
  // Validation Helpers
  // ===========================================================================

  /**
   * Check if a session is valid for verification attempt
   *
   * @param session - Session to validate
   * @returns Object with valid flag and error message if invalid
   */
  validateSession(
    session: WalletVerificationSession | null
  ): { valid: boolean; error?: string } {
    if (!session) {
      return { valid: false, error: 'Session not found' };
    }

    if (session.status !== 'pending') {
      return { valid: false, error: `Session is ${session.status}` };
    }

    if (new Date() > session.expiresAt) {
      return { valid: false, error: 'Session has expired' };
    }

    if (session.attempts >= MAX_ATTEMPTS) {
      return { valid: false, error: 'Maximum verification attempts exceeded' };
    }

    return { valid: true };
  }

  /**
   * Get the maximum number of attempts allowed
   */
  getMaxAttempts(): number {
    return MAX_ATTEMPTS;
  }

  /**
   * Get the session TTL in minutes
   */
  getSessionTtlMinutes(): number {
    return this.sessionTtlMinutes;
  }
}
