/**
 * WalletVerificationService - Orchestration for native wallet verification
 *
 * Sprint 78: Database & Session Management
 *
 * Coordinates the complete wallet verification flow:
 * 1. Create session with cryptographic nonce
 * 2. Build signing message
 * 3. Verify EIP-191 signature
 * 4. Link wallet to Discord user
 * 5. Log audit events
 *
 * This service provides the high-level API for wallet verification,
 * delegating to SessionManager for persistence and SignatureVerifier
 * for cryptographic operations.
 *
 * @module packages/verification/VerificationService
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Address, Hex } from 'viem';

import { SessionManager } from './SessionManager.js';
import { SignatureVerifier } from './SignatureVerifier.js';
import { MessageBuilder } from './MessageBuilder.js';
import type {
  WalletVerificationSession,
  VerificationSessionStatus,
} from '../adapters/storage/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for creating a verification session
 */
export interface CreateVerificationSessionParams {
  /** Discord user ID initiating verification */
  discordUserId: string;
  /** Discord guild ID where verification was initiated */
  discordGuildId: string;
  /** Discord username for display */
  discordUsername: string;
  /** Community name for signing message */
  communityName: string;
  /** Optional IP address for security tracking */
  ipAddress?: string;
  /** Optional user agent for security tracking */
  userAgent?: string;
}

/**
 * Result of session creation
 */
export interface CreateVerificationSessionResult {
  /** The session ID */
  sessionId: string;
  /** The nonce to include in signing message */
  nonce: string;
  /** The message to be signed */
  message: string;
  /** Session expiry time */
  expiresAt: Date;
  /** Whether a new session was created (false if returning existing) */
  isNew: boolean;
}

/**
 * Parameters for verifying a signature
 */
export interface VerifySignatureParams {
  /** Session ID */
  sessionId: string;
  /** The signature from the user's wallet */
  signature: Hex;
  /** The wallet address claiming ownership */
  walletAddress: Address;
  /** Optional IP address for audit */
  ipAddress?: string;
  /** Optional user agent for audit */
  userAgent?: string;
}

/**
 * Result of signature verification
 */
export interface VerifySignatureResult {
  /** Whether verification succeeded */
  success: boolean;
  /** Error message if verification failed */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: VerificationErrorCode;
  /** The verified wallet address (if success) */
  walletAddress?: string;
  /** The session status after verification */
  sessionStatus: VerificationSessionStatus;
}

/**
 * Error codes for verification failures
 */
export type VerificationErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'SESSION_ALREADY_COMPLETED'
  | 'SESSION_FAILED'
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'INVALID_SIGNATURE'
  | 'ADDRESS_MISMATCH'
  | 'INTERNAL_ERROR';

/**
 * Session information for API responses
 */
export interface SessionInfo {
  /** Session ID */
  id: string;
  /** Current session status */
  status: VerificationSessionStatus;
  /** Discord user ID */
  discordUserId: string;
  /** Discord username */
  discordUsername: string;
  /** Linked wallet address (if completed) */
  walletAddress?: string;
  /** Session creation time */
  createdAt: Date;
  /** Session expiry time */
  expiresAt: Date;
  /** Session completion time (if completed) */
  completedAt?: Date;
  /** Number of verification attempts */
  attempts: number;
  /** Error message (if failed) */
  errorMessage?: string;
}

/**
 * Audit event types for verification
 */
export type VerificationAuditEventType =
  | 'SESSION_CREATED'
  | 'SIGNATURE_SUBMITTED'
  | 'VERIFICATION_COMPLETED'
  | 'VERIFICATION_FAILED'
  | 'VERIFICATION_EXPIRED'
  | 'SESSION_RESET';

/**
 * Audit event callback
 */
export type AuditEventCallback = (event: {
  type: VerificationAuditEventType;
  sessionId: string;
  discordUserId: string;
  walletAddress?: string;
  success?: boolean;
  error?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

/**
 * Wallet link callback (called on successful verification)
 */
export type WalletLinkCallback = (params: {
  discordUserId: string;
  discordGuildId: string;
  walletAddress: string;
  /** Discord username (Sprint 176: User Registry) */
  discordUsername?: string;
  /** Signature used for verification (Sprint 176: User Registry) */
  signature?: string;
  /** Message that was signed (Sprint 176: User Registry) */
  message?: string;
}) => Promise<void>;

/**
 * VerificationService configuration options
 */
export interface VerificationServiceOptions {
  /** Session TTL in minutes (default: 15) */
  sessionTtlMinutes?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Callback for audit events */
  onAuditEvent?: AuditEventCallback;
  /** Callback for wallet linking */
  onWalletLink?: WalletLinkCallback;
}

// =============================================================================
// VerificationService
// =============================================================================

/**
 * Orchestrates the complete wallet verification flow.
 *
 * @example
 * ```typescript
 * const service = new WalletVerificationService(db, communityId, {
 *   onAuditEvent: async (event) => auditLogger.log(event),
 *   onWalletLink: async ({ discordUserId, walletAddress }) => {
 *     await profileService.linkWallet(discordUserId, walletAddress);
 *   },
 * });
 *
 * // Create session
 * const { sessionId, message, nonce } = await service.createSession({
 *   discordUserId: '123456',
 *   discordGuildId: '789012',
 *   discordUsername: 'user#1234',
 *   communityName: 'My Community',
 * });
 *
 * // User signs message and submits signature...
 *
 * // Verify signature
 * const result = await service.verifySignature({
 *   sessionId,
 *   signature: '0x...',
 *   walletAddress: '0x...',
 * });
 * ```
 */
export class WalletVerificationService {
  private readonly sessionManager: SessionManager;
  private readonly signatureVerifier: SignatureVerifier;
  private readonly messageBuilder: MessageBuilder;
  private readonly communityId: string;
  private readonly debug: boolean;
  private readonly onAuditEvent?: AuditEventCallback;
  private readonly onWalletLink?: WalletLinkCallback;

  /**
   * Creates a new WalletVerificationService
   *
   * @param db - Drizzle database instance
   * @param communityId - Community ID for RLS scoping
   * @param options - Configuration options
   */
  constructor(
    db: PostgresJsDatabase,
    communityId: string,
    options: VerificationServiceOptions = {}
  ) {
    this.communityId = communityId;
    this.debug = options.debug ?? false;
    this.onAuditEvent = options.onAuditEvent;
    this.onWalletLink = options.onWalletLink;

    this.sessionManager = new SessionManager(db, communityId, {
      sessionTtlMinutes: options.sessionTtlMinutes,
      debug: options.debug,
    });
    this.signatureVerifier = new SignatureVerifier();
    this.messageBuilder = new MessageBuilder();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Log debug messages
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[WalletVerificationService] ${message}`, data ?? '');
    }
  }

  /**
   * Emit an audit event
   */
  private async emitAuditEvent(
    type: VerificationAuditEventType,
    sessionId: string,
    discordUserId: string,
    data?: {
      walletAddress?: string;
      success?: boolean;
      error?: string;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.onAuditEvent) return;

    try {
      await this.onAuditEvent({
        type,
        sessionId,
        discordUserId,
        ...data,
      });
    } catch (error) {
      this.log('Failed to emit audit event', { type, error });
    }
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Create a new verification session or return existing pending session
   *
   * @param params - Session creation parameters
   * @returns Session details including the message to sign
   */
  async createSession(
    params: CreateVerificationSessionParams
  ): Promise<CreateVerificationSessionResult> {
    this.log('createSession', {
      discordUserId: params.discordUserId,
      discordGuildId: params.discordGuildId,
    });

    // Create or get existing session
    const { session, isNew } = await this.sessionManager.create({
      discordUserId: params.discordUserId,
      discordGuildId: params.discordGuildId,
      discordUsername: params.discordUsername,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });

    // Build the signing message using nonce-only format
    // (wallet address is unknown until user submits signature)
    const message = this.messageBuilder.buildFromNonce(
      session.nonce,
      params.discordUsername
    );

    // Emit audit event for new sessions
    if (isNew) {
      await this.emitAuditEvent('SESSION_CREATED', session.id, params.discordUserId, {
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        metadata: {
          discordGuildId: params.discordGuildId,
          communityName: params.communityName,
        },
      });
    }

    return {
      sessionId: session.id,
      nonce: session.nonce,
      message,
      expiresAt: session.expiresAt,
      isNew,
    };
  }

  /**
   * Verify a signature submission
   *
   * @param params - Verification parameters
   * @returns Verification result
   */
  async verifySignature(
    params: VerifySignatureParams
  ): Promise<VerifySignatureResult> {
    this.log('verifySignature', { sessionId: params.sessionId });

    // Get the session
    const session = await this.sessionManager.getById(params.sessionId);

    // Validate session state
    const validation = this.sessionManager.validateSession(session);
    if (!validation.valid) {
      const errorCode = this.getErrorCode(session, validation.error);
      await this.emitAuditEvent(
        'SIGNATURE_SUBMITTED',
        params.sessionId,
        session?.discordUserId ?? 'unknown',
        {
          walletAddress: params.walletAddress,
          success: false,
          error: validation.error,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        }
      );

      return {
        success: false,
        error: validation.error,
        errorCode,
        sessionStatus: (session?.status ?? 'failed') as VerificationSessionStatus,
      };
    }

    // Increment attempts (this will fail if at max attempts)
    const updatedSession = await this.sessionManager.incrementAttempts(params.sessionId);
    if (!updatedSession) {
      await this.sessionManager.markFailed({
        sessionId: params.sessionId,
        errorMessage: 'Maximum verification attempts exceeded',
      });

      await this.emitAuditEvent(
        'VERIFICATION_FAILED',
        params.sessionId,
        session!.discordUserId,
        {
          walletAddress: params.walletAddress,
          success: false,
          error: 'Maximum verification attempts exceeded',
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
        }
      );

      return {
        success: false,
        error: 'Maximum verification attempts exceeded',
        errorCode: 'MAX_ATTEMPTS_EXCEEDED',
        sessionStatus: 'failed',
      };
    }

    // Build the expected message
    // Note: We need the community name, which we'll store in metadata in future sprints
    // For now, we'll extract the nonce and build a generic message
    const message = this.messageBuilder.buildFromNonce(session!.nonce, session!.discordUsername);

    // Verify the signature
    const verificationResult = await this.signatureVerifier.verifyAddress(
      message,
      params.signature,
      params.walletAddress
    );

    if (!verificationResult.valid) {
      await this.emitAuditEvent(
        'SIGNATURE_SUBMITTED',
        params.sessionId,
        session!.discordUserId,
        {
          walletAddress: params.walletAddress,
          success: false,
          error: verificationResult.error,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: {
            recoveredAddress: verificationResult.recoveredAddress,
          },
        }
      );

      const errorCode: VerificationErrorCode =
        verificationResult.error === 'Signature address does not match expected address'
          ? 'ADDRESS_MISMATCH'
          : 'INVALID_SIGNATURE';

      return {
        success: false,
        error: verificationResult.error,
        errorCode,
        sessionStatus: 'pending',
      };
    }

    // Mark session as completed
    const completedSession = await this.sessionManager.markCompleted({
      sessionId: params.sessionId,
      walletAddress: params.walletAddress,
    });

    if (!completedSession) {
      return {
        success: false,
        error: 'Failed to update session',
        errorCode: 'INTERNAL_ERROR',
        sessionStatus: 'pending',
      };
    }

    // Call wallet link callback
    if (this.onWalletLink) {
      try {
        // Build the signing message for User Registry (Sprint 176)
        const message = this.messageBuilder.buildFromNonce(
          session!.nonce,
          session!.discordUsername
        );

        await this.onWalletLink({
          discordUserId: session!.discordUserId,
          discordGuildId: session!.discordGuildId,
          walletAddress: params.walletAddress,
          // Sprint 176: Additional fields for User Registry
          discordUsername: session!.discordUsername,
          signature: params.signature,
          message,
        });
      } catch (error) {
        this.log('Failed to call onWalletLink', { error });
        // Don't fail the verification - the wallet is already verified
      }
    }

    // Emit success event
    await this.emitAuditEvent(
      'VERIFICATION_COMPLETED',
      params.sessionId,
      session!.discordUserId,
      {
        walletAddress: params.walletAddress,
        success: true,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      }
    );

    return {
      success: true,
      walletAddress: params.walletAddress.toLowerCase(),
      sessionStatus: 'completed',
    };
  }

  /**
   * Get session information
   *
   * @param sessionId - Session ID
   * @returns Session info if found, null otherwise
   */
  async getSession(sessionId: string): Promise<SessionInfo | null> {
    const session = await this.sessionManager.getById(sessionId);
    if (!session) return null;

    return this.mapSessionToInfo(session);
  }

  /**
   * Get session by nonce
   *
   * @param nonce - Session nonce
   * @returns Session info if found, null otherwise
   */
  async getSessionByNonce(nonce: string): Promise<SessionInfo | null> {
    const session = await this.sessionManager.getByNonce(nonce);
    if (!session) return null;

    return this.mapSessionToInfo(session);
  }

  /**
   * Clean up expired sessions
   *
   * @returns Number of sessions expired
   */
  async cleanupExpiredSessions(): Promise<number> {
    return this.sessionManager.expireOldSessions();
  }

  /**
   * Get pending session for a user
   *
   * @param discordUserId - Discord user ID
   * @returns Session info if found, null otherwise
   */
  async getPendingSession(discordUserId: string): Promise<SessionInfo | null> {
    const session = await this.sessionManager.getPendingForUser(discordUserId);
    if (!session) return null;

    return this.mapSessionToInfo(session);
  }

  /**
   * Get the most recent session for a user (any status)
   *
   * @param discordUserId - Discord user ID
   * @returns Session info if found, null otherwise
   */
  async getLatestSession(discordUserId: string): Promise<SessionInfo | null> {
    const session = await this.sessionManager.getLatestForUser(discordUserId);
    if (!session) return null;

    return this.mapSessionToInfo(session);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Map database session to API response
   */
  private mapSessionToInfo(session: WalletVerificationSession): SessionInfo {
    return {
      id: session.id,
      status: session.status as VerificationSessionStatus,
      discordUserId: session.discordUserId,
      discordUsername: session.discordUsername,
      walletAddress: session.walletAddress ?? undefined,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt ?? undefined,
      attempts: session.attempts,
      errorMessage: session.errorMessage ?? undefined,
    };
  }

  /**
   * Get error code from validation error
   */
  private getErrorCode(
    session: WalletVerificationSession | null,
    error?: string
  ): VerificationErrorCode {
    if (!session) return 'SESSION_NOT_FOUND';

    switch (session.status) {
      case 'completed':
        return 'SESSION_ALREADY_COMPLETED';
      case 'expired':
        return 'SESSION_EXPIRED';
      case 'failed':
        return 'SESSION_FAILED';
    }

    if (error?.includes('expired')) return 'SESSION_EXPIRED';
    if (error?.includes('attempts')) return 'MAX_ATTEMPTS_EXCEEDED';

    return 'INTERNAL_ERROR';
  }
}
