/**
 * Verification Routes Module
 * Sprint 79: API Routes & Discord Integration - Native Wallet Verification
 *
 * Provides REST endpoints for the wallet verification flow:
 * - GET /verify/:sessionId - Get session info or serve verification page
 * - POST /verify/:sessionId - Submit signature for verification
 * - GET /verify/:sessionId/status - Poll verification status
 *
 * All endpoints require a valid session ID (UUID format).
 */

import { Router } from 'express';
import type { Response, Request, NextFunction } from 'express';
import { z } from 'zod';
import type { Address, Hex } from 'viem';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from '../../utils/logger.js';
import { ValidationError, NotFoundError } from '../middleware.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Verification session response
 */
interface VerificationSessionResponse {
  sessionId: string;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  message?: string;
  expiresAt: string;
  attemptsRemaining: number;
  discordUsername: string;
  walletAddress?: string;
  completedAt?: string;
}

/**
 * Signature submission response
 */
interface VerifySignatureResponse {
  success: boolean;
  error?: string;
  errorCode?: string;
  walletAddress?: string;
  sessionStatus: string;
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Session ID parameter validation
 */
const sessionIdSchema = z.string().uuid('Invalid session ID format');

/**
 * Signature submission body validation
 */
const submitSignatureSchema = z.object({
  signature: z
    .string()
    .regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format (must be 0x-prefixed 65-byte hex)')
    .transform((s) => s as Hex),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i, 'Invalid wallet address format')
    .transform((s) => s.toLowerCase() as Address),
});

// =============================================================================
// Router Factory
// =============================================================================

/**
 * Create verification router with injected dependencies
 *
 * @param deps - Dependencies for the router
 * @returns Express router
 */
export function createVerifyRouter(deps: {
  getVerificationService: (communityId: string) => {
    getSession: (sessionId: string) => Promise<{
      id: string;
      status: string;
      discordUserId: string;
      discordUsername: string;
      walletAddress?: string;
      createdAt: Date;
      expiresAt: Date;
      completedAt?: Date;
      attempts: number;
      errorMessage?: string;
    } | null>;
    verifySignature: (params: {
      sessionId: string;
      signature: Hex;
      walletAddress: Address;
      ipAddress?: string;
      userAgent?: string;
    }) => Promise<{
      success: boolean;
      error?: string;
      errorCode?: string;
      walletAddress?: string;
      sessionStatus: string;
    }>;
  };
  getCommunityIdForSession: (sessionId: string) => Promise<string | null>;
  getSigningMessage: (sessionId: string) => Promise<string | null>;
  maxAttempts?: number;
}): Router {
  const router = Router();
  const MAX_ATTEMPTS = deps.maxAttempts ?? 3;

  // Get __dirname equivalent for ESM
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  /**
   * GET /verify/:sessionId
   * Returns session data as JSON or serves verification HTML page
   *
   * Query params:
   * - format=json - Force JSON response
   * - format=html - Force HTML response (default for browsers)
   */
  router.get('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate session ID
      const parseResult = sessionIdSchema.safeParse(req.params.sessionId);
      if (!parseResult.success) {
        throw new ValidationError('Invalid session ID format');
      }
      const sessionId = parseResult.data;

      // Get community ID for this session
      const communityId = await deps.getCommunityIdForSession(sessionId);
      if (!communityId) {
        throw new NotFoundError('Session not found');
      }

      // Get verification service for this community
      const service = deps.getVerificationService(communityId);
      const session = await service.getSession(sessionId);

      if (!session) {
        throw new NotFoundError('Session not found');
      }

      // Determine response format
      const format = req.query.format as string | undefined;
      const acceptsHtml = req.accepts('html');
      const wantsJson = format === 'json' || (!format && !acceptsHtml);

      if (wantsJson) {
        // Return JSON response
        const response: VerificationSessionResponse = {
          sessionId: session.id,
          status: session.status as VerificationSessionResponse['status'],
          expiresAt: session.expiresAt.toISOString(),
          attemptsRemaining: Math.max(0, MAX_ATTEMPTS - session.attempts),
          discordUsername: session.discordUsername,
          walletAddress: session.walletAddress,
          completedAt: session.completedAt?.toISOString(),
        };

        // Add signing message for pending sessions
        if (session.status === 'pending') {
          const message = await deps.getSigningMessage(sessionId);
          if (message) {
            response.message = message;
          }
        }

        res.json(response);
      } else {
        // Serve HTML verification page
        // The page will fetch session data via API
        const staticPath = path.resolve(__dirname, '../../static/verify.html');
        res.sendFile(staticPath);
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /verify/:sessionId
   * Submit a signature for verification
   */
  router.post('/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate session ID
      const sessionParseResult = sessionIdSchema.safeParse(req.params.sessionId);
      if (!sessionParseResult.success) {
        throw new ValidationError('Invalid session ID format');
      }
      const sessionId = sessionParseResult.data;

      // Validate request body
      const bodyParseResult = submitSignatureSchema.safeParse(req.body);
      if (!bodyParseResult.success) {
        const errors = bodyParseResult.error.errors.map((e) => e.message).join(', ');
        throw new ValidationError(`Invalid request body: ${errors}`);
      }
      const { signature, walletAddress } = bodyParseResult.data;

      // Get community ID for this session
      const communityId = await deps.getCommunityIdForSession(sessionId);
      if (!communityId) {
        throw new NotFoundError('Session not found');
      }

      // Get verification service and verify signature
      const service = deps.getVerificationService(communityId);
      const result = await service.verifySignature({
        sessionId,
        signature,
        walletAddress,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });

      logger.info(
        {
          sessionId,
          success: result.success,
          errorCode: result.errorCode,
          walletAddress: result.walletAddress,
        },
        'Verification attempt'
      );

      const response: VerifySignatureResponse = {
        success: result.success,
        error: result.error,
        errorCode: result.errorCode,
        walletAddress: result.walletAddress,
        sessionStatus: result.sessionStatus,
      };

      // Set appropriate status code
      if (result.success) {
        res.status(200).json(response);
      } else if (result.errorCode === 'SESSION_NOT_FOUND') {
        res.status(404).json(response);
      } else if (
        result.errorCode === 'INVALID_SIGNATURE' ||
        result.errorCode === 'ADDRESS_MISMATCH'
      ) {
        res.status(400).json(response);
      } else if (result.errorCode === 'MAX_ATTEMPTS_EXCEEDED') {
        res.status(429).json(response);
      } else {
        res.status(400).json(response);
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /verify/:sessionId/status
   * Poll verification status (lightweight endpoint for polling)
   */
  router.get('/:sessionId/status', async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate session ID
      const parseResult = sessionIdSchema.safeParse(req.params.sessionId);
      if (!parseResult.success) {
        throw new ValidationError('Invalid session ID format');
      }
      const sessionId = parseResult.data;

      // Get community ID for this session
      const communityId = await deps.getCommunityIdForSession(sessionId);
      if (!communityId) {
        throw new NotFoundError('Session not found');
      }

      // Get verification service
      const service = deps.getVerificationService(communityId);
      const session = await service.getSession(sessionId);

      if (!session) {
        throw new NotFoundError('Session not found');
      }

      // Return minimal status response
      res.json({
        status: session.status,
        walletAddress: session.walletAddress,
        completedAt: session.completedAt?.toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

/**
 * Export router type for testing
 */
export type VerifyRouter = ReturnType<typeof createVerifyRouter>;
