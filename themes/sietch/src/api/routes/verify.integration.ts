/**
 * Verification Routes Integration
 * Sprint 79: API Routes & Discord Integration
 *
 * Provides dependency injection setup for verification routes.
 * Creates database helpers needed for session lookup and service instantiation.
 *
 * @security Sprint 79 Security Hardening:
 * - HIGH-2: Constant-time responses to prevent timing attacks
 *
 * @module api/routes/verify.integration
 */

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Address, Hex } from 'viem';

import {
  walletVerificationSessions,
} from '../../packages/adapters/storage/schema.js';
import { WalletVerificationService } from '../../packages/verification/VerificationService.js';
import { MessageBuilder } from '../../packages/verification/MessageBuilder.js';
import { createVerifyRouter } from './verify.routes.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Security Constants
// =============================================================================

/**
 * Minimum response time in ms for constant-time responses (timing attack mitigation)
 * Applied at the database query level for getCommunityIdForSession
 */
const MIN_DB_RESPONSE_TIME_MS = 50;

// =============================================================================
// Types
// =============================================================================

/**
 * Database dependencies for verification integration
 */
export interface VerificationIntegrationDeps {
  /** Drizzle database instance */
  db: PostgresJsDatabase;
  /** Optional callback when wallet is linked */
  onWalletLinked?: (params: {
    communityId: string;
    discordUserId: string;
    walletAddress: string;
    /** Discord username (Sprint 176: User Registry) */
    discordUsername?: string;
    /** Signature used for verification (Sprint 176: User Registry) */
    signature?: string;
    /** Message that was signed (Sprint 176: User Registry) */
    message?: string;
  }) => Promise<void>;
  /** Optional audit event callback */
  onAuditEvent?: (event: {
    type: string;
    communityId: string;
    sessionId: string;
    discordUserId: string;
    data?: Record<string, unknown>;
  }) => Promise<void>;
}

/**
 * Service cache to avoid recreating services for the same community
 */
interface ServiceCacheEntry {
  service: WalletVerificationService;
  createdAt: number;
}

// =============================================================================
// Integration Factory
// =============================================================================

/**
 * Creates the verification router with all dependencies wired up
 *
 * @param deps - Database and callback dependencies
 * @returns Configured Express router
 */
export function createVerifyIntegration(deps: VerificationIntegrationDeps) {
  const { db, onWalletLinked, onAuditEvent } = deps;

  // Cache services per community (10 minute TTL)
  const serviceCache = new Map<string, ServiceCacheEntry>();
  const CACHE_TTL_MS = 10 * 60 * 1000;

  /**
   * Get community ID for a session (bypasses RLS for lookup)
   * This is safe because session IDs are cryptographically random UUIDs
   *
   * @security HIGH-2: Constant-time response to prevent timing attacks
   * Ensures minimum response time regardless of whether session exists
   */
  async function getCommunityIdForSession(sessionId: string): Promise<string | null> {
    const startTime = Date.now();

    try {
      // Direct query without tenant context - only returns community_id
      // This is a controlled bypass since we only expose community_id, not session data
      const result = await db
        .select({ communityId: walletVerificationSessions.communityId })
        .from(walletVerificationSessions)
        .where(eq(walletVerificationSessions.id, sessionId))
        .limit(1);

      // HIGH-2: Constant-time response - always wait minimum time
      // This prevents attackers from detecting valid session IDs via timing
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_DB_RESPONSE_TIME_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_DB_RESPONSE_TIME_MS - elapsed));
      }

      return result[0]?.communityId ?? null;
    } catch (error) {
      // HIGH-2: Constant-time even on errors
      const elapsed = Date.now() - startTime;
      if (elapsed < MIN_DB_RESPONSE_TIME_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_DB_RESPONSE_TIME_MS - elapsed));
      }

      logger.error({ sessionId, error }, 'Failed to lookup community for session');
      return null;
    }
  }

  /**
   * Get or create a verification service for a community
   */
  function getVerificationService(communityId: string): WalletVerificationService {
    // Check cache
    const cached = serviceCache.get(communityId);
    const now = Date.now();

    if (cached && now - cached.createdAt < CACHE_TTL_MS) {
      return cached.service;
    }

    // Create new service - WalletVerificationService constructor: (db, communityId, options)
    const service = new WalletVerificationService(db, communityId, {
      onWalletLink: onWalletLinked
        ? async ({ discordUserId, walletAddress, discordUsername, signature, message }) => {
            await onWalletLinked({
              communityId,
              discordUserId,
              walletAddress,
              // Sprint 176: Additional fields for User Registry
              discordUsername,
              signature,
              message,
            });
          }
        : undefined,
      onAuditEvent: onAuditEvent
        ? async (event) => {
            await onAuditEvent({
              type: event.type,
              communityId,
              sessionId: event.sessionId,
              discordUserId: event.discordUserId,
              data: {
                walletAddress: event.walletAddress,
                success: event.success,
                error: event.error,
                ipAddress: event.ipAddress,
                userAgent: event.userAgent,
                ...event.metadata,
              },
            });
          }
        : undefined,
    });

    // Cache it
    serviceCache.set(communityId, { service, createdAt: now });

    // Clean up old cache entries
    if (serviceCache.size > 100) {
      for (const [key, entry] of serviceCache.entries()) {
        if (now - entry.createdAt > CACHE_TTL_MS) {
          serviceCache.delete(key);
        }
      }
    }

    return service;
  }

  /**
   * Get the signing message for a session
   * Note: We need to query the database directly to get the nonce, since
   * SessionInfo doesn't expose the nonce field (for security reasons)
   */
  async function getSigningMessage(sessionId: string): Promise<string | null> {
    try {
      // Query the session directly to get nonce and discordUsername
      const result = await db
        .select({
          nonce: walletVerificationSessions.nonce,
          discordUsername: walletVerificationSessions.discordUsername,
          status: walletVerificationSessions.status,
        })
        .from(walletVerificationSessions)
        .where(eq(walletVerificationSessions.id, sessionId))
        .limit(1);

      const session = result[0];
      if (!session || session.status !== 'pending') {
        return null;
      }

      // Rebuild the message from the nonce
      // The message format is defined in MessageBuilder.buildFromNonce
      const messageBuilder = new MessageBuilder();
      return messageBuilder.buildFromNonce(session.nonce, session.discordUsername);
    } catch (error) {
      logger.error({ sessionId, error }, 'Failed to get signing message');
      return null;
    }
  }

  // Create and return the router
  return createVerifyRouter({
    getVerificationService: (communityId: string) => {
      const service = getVerificationService(communityId);
      return {
        getSession: async (sessionId: string) => {
          const session = await service.getSession(sessionId);
          if (!session) return null;
          // SessionInfo uses 'id' not 'sessionId'
          return {
            id: session.id,
            status: session.status,
            discordUserId: session.discordUserId,
            discordUsername: session.discordUsername,
            walletAddress: session.walletAddress,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            completedAt: session.completedAt,
            attempts: session.attempts,
            errorMessage: session.errorMessage,
          };
        },
        verifySignature: async (params: {
          sessionId: string;
          signature: Hex;
          walletAddress: Address;
          ipAddress?: string;
          userAgent?: string;
        }) => {
          return service.verifySignature(params);
        },
      };
    },
    getCommunityIdForSession,
    getSigningMessage,
    maxAttempts: 3,
  });
}

/**
 * Export for type inference
 */
export type VerifyIntegration = ReturnType<typeof createVerifyIntegration>;
