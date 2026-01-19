/**
 * Simulation Routes Module
 *
 * Sprint 110: REST API for QA Sandbox Testing System
 * Sprint 111: Security Remediation (CRITICAL-002 - Authentication)
 * Sprint 112: Security Remediation (HIGH-002 - Rate Limiting)
 *
 * Provides REST endpoints for simulation operations within sandbox environments.
 * All routes are scoped to a specific sandbox and user.
 *
 * Security:
 * - All routes require authentication via API key or Bearer token
 * - Sandbox access is verified for each request
 * - User operations require self-or-admin authorization
 * - Rate limiting applied to prevent abuse
 *
 * @module api/routes/simulation
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import {
  SimulationService,
  createSimulationService,
  SimulationErrorCode,
  type TierId,
  type BadgeId,
  type MinimalRedis,
} from '../../services/sandbox/index.js';
import { isValidTierId } from '../../services/sandbox/simulation-context.js';
import {
  requireAuth,
  requireSandboxAccess,
  requireSelfOrAdmin,
  requireQARole,
  type AuthenticatedRequest,
} from '../middleware/auth.js';
import {
  generalRateLimiter,
  writeRateLimiter,
  expensiveRateLimiter,
} from '../middleware/rate-limit.js';
import {
  sanitizeAndLogError,
  sanitizeValidationErrors,
} from '../utils/error-sanitizer.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Extended request with simulation context and authentication
 */
interface SimulationRequest extends AuthenticatedRequest {
  simulationService?: SimulationService;
}

/**
 * Dependencies for simulation router factory
 */
export interface SimulationRouterDeps {
  redis: MinimalRedis;
  getSandboxIdForGuild?: (guildId: string) => Promise<string | null>;
}

// =============================================================================
// Validation Schemas
// =============================================================================

/**
 * Sprint 112 (HIGH-003): Schemas now require version for optimistic locking
 */
const assumeRoleSchema = z.object({
  tierId: z.string().refine((val) => isValidTierId(val as TierId), {
    message: 'Invalid tier ID',
  }),
  rank: z.number().int().min(1).max(10000).optional(),
  badges: z.array(z.string()).optional(),
  note: z.string().max(200).optional(),
  version: z.number().int().min(0).optional(), // Required for existing contexts
});

const updateStateSchema = z.object({
  bgtBalance: z.number().min(0).optional(),
  engagementStage: z.enum(['free', 'engaged', 'verified']).optional(),
  engagementPoints: z.number().min(0).optional(),
  activityScore: z.number().min(0).optional(),
  convictionScore: z.number().min(0).optional(),
  tenureDays: z.number().min(0).optional(),
  isVerified: z.boolean().optional(),
  version: z.number().int().min(0), // Required for optimistic locking
});

const checkSchema = z.object({
  type: z.enum(['channel', 'feature', 'tier', 'badges']),
  target: z.string().optional(),
});

const thresholdOverridesSchema = z.object({
  naib: z.number().positive().optional(),
  fedaykin: z.number().positive().optional(),
  usul: z.number().positive().optional(),
  sayyadina: z.number().positive().optional(),
  mushtamal: z.number().positive().optional(),
  sihaya: z.number().positive().optional(),
  qanat: z.number().positive().optional(),
  ichwan: z.number().positive().optional(),
  hajra: z.number().positive().optional(),
  version: z.number().int().min(0), // Required for optimistic locking
});

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Map simulation error codes to HTTP status codes
 */
function getHttpStatus(code: SimulationErrorCode): number {
  switch (code) {
    case SimulationErrorCode.NOT_FOUND:
      return 404;
    case SimulationErrorCode.VALIDATION_ERROR:
      return 400;
    case SimulationErrorCode.VERSION_CONFLICT:
      return 409;
    case SimulationErrorCode.SANDBOX_INACTIVE:
      return 403;
    case SimulationErrorCode.STORAGE_ERROR:
    default:
      return 500;
  }
}

/**
 * Async handler wrapper
 */
function asyncHandler(
  fn: (req: SimulationRequest, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as SimulationRequest, res, next)).catch(next);
  };
}

// =============================================================================
// Router Factory
// =============================================================================

/**
 * Create simulation router with injected dependencies
 *
 * @param deps - Required dependencies (redis)
 * @returns Express router for simulation endpoints
 */
export function createSimulationRouter(deps: SimulationRouterDeps): Router {
  const router = Router({ mergeParams: true });
  const service = createSimulationService(deps.redis, logger);

  // ===========================================================================
  // Middleware (Sprint 111 - CRITICAL-002 Security, Sprint 112 - HIGH-002 Rate Limiting)
  // ===========================================================================

  /**
   * Authentication - all routes require valid credentials
   */
  router.use(requireAuth);

  /**
   * Sandbox access - verify caller has access to requested sandbox
   * Applied to all routes with :sandboxId parameter
   */
  router.use(requireSandboxAccess);

  /**
   * General rate limiting - 60 requests per minute per user
   * Applied to all routes as baseline protection
   */
  router.use(generalRateLimiter);

  /**
   * Attach simulation service to request
   */
  router.use((req: SimulationRequest, _res: Response, next: NextFunction) => {
    req.simulationService = service;
    next();
  });

  // ===========================================================================
  // Role Assumption Endpoints (T110.2)
  // ===========================================================================

  /**
   * POST /sandbox/:sandboxId/simulation/:userId/assume
   * Assume a role within the simulation
   *
   * Security: Requires self-or-admin authorization
   * Rate limit: 20 write operations per minute
   */
  router.post(
    '/:userId/assume',
    requireSelfOrAdmin,
    writeRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const parseResult = assumeRoleSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: sanitizeValidationErrors(parseResult.error.issues),
        });
        return;
      }

      const { tierId, rank, badges, note, version } = parseResult.data;

      const result = await simulationService!.assumeRole(
        sandboxId ?? '',
        userId ?? '',
        tierId as TierId,
        { rank, badges: badges as BadgeId[] | undefined, note, expectedVersion: version }
      );

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      logger.info({ sandboxId, userId, tierId }, 'Role assumed via REST API');

      res.status(200).json({
        success: true,
        data: {
          assumedRole: result.data!.assumedRole,
          version: result.data!.version,
        },
      });
    })
  );

  /**
   * DELETE /sandbox/:sandboxId/simulation/:userId/assume
   * Clear assumed role
   *
   * Security: Requires self-or-admin authorization
   * Rate limit: 20 write operations per minute
   */
  router.delete(
    '/:userId/assume',
    requireSelfOrAdmin,
    writeRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const result = await simulationService!.clearRole(sandboxId ?? '', userId ?? '');

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      logger.info({ sandboxId, userId }, 'Role cleared via REST API');

      res.status(200).json({
        success: true,
        message: 'Role cleared',
        version: result.data!.version,
      });
    })
  );

  // ===========================================================================
  // State Endpoints (T110.3)
  // ===========================================================================

  /**
   * GET /sandbox/:sandboxId/simulation/:userId/whoami
   * Get full simulation status
   *
   * Security: Requires self-or-admin authorization
   */
  router.get(
    '/:userId/whoami',
    requireSelfOrAdmin,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const result = await simulationService!.whoami(sandboxId ?? '', userId ?? '');

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
      });
    })
  );

  /**
   * GET /sandbox/:sandboxId/simulation/:userId/state
   * Get current member state
   *
   * Security: Requires self-or-admin authorization
   */
  router.get(
    '/:userId/state',
    requireSelfOrAdmin,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const result = await simulationService!.getState(sandboxId ?? '', userId ?? '');

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
      });
    })
  );

  /**
   * PATCH /sandbox/:sandboxId/simulation/:userId/state
   * Update member state
   *
   * Security: Requires self-or-admin authorization
   * Rate limit: 20 write operations per minute
   */
  router.patch(
    '/:userId/state',
    requireSelfOrAdmin,
    writeRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const parseResult = updateStateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: sanitizeValidationErrors(parseResult.error.issues),
        });
        return;
      }

      // Extract version for optimistic locking
      const { version, ...stateUpdates } = parseResult.data;

      const result = await simulationService!.setState(
        sandboxId ?? '',
        userId ?? '',
        stateUpdates,
        { expectedVersion: version }
      );

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      logger.debug(
        { sandboxId, userId, updatedFields: result.data!.updatedFields },
        'State updated via REST API'
      );

      res.status(200).json({
        success: true,
        data: result.data,
      });
    })
  );

  /**
   * DELETE /sandbox/:sandboxId/simulation/:userId
   * Reset/delete simulation context
   *
   * Security: Requires self-or-admin authorization
   * Rate limit: 20 write operations per minute
   */
  router.delete(
    '/:userId',
    requireSelfOrAdmin,
    writeRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const result = await simulationService!.deleteContext(sandboxId ?? '', userId ?? '');

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      logger.info({ sandboxId, userId }, 'Context deleted via REST API');

      res.status(200).json({
        success: true,
        message: 'Simulation context deleted',
      });
    })
  );

  // ===========================================================================
  // Check Endpoints (T110.4)
  // ===========================================================================

  /**
   * POST /sandbox/:sandboxId/simulation/:userId/check
   * Check permissions, tier, or badges
   *
   * Security: Requires self-or-admin authorization
   * Rate limit: 10 expensive operations per minute (tier calculations)
   */
  router.post(
    '/:userId/check',
    requireSelfOrAdmin,
    expensiveRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const parseResult = checkSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: sanitizeValidationErrors(parseResult.error.issues),
        });
        return;
      }

      const { type, target } = parseResult.data;

      let result;
      switch (type) {
        case 'channel':
          if (!target) {
            res.status(400).json({
              error: 'Validation error',
              message: 'target is required for channel check',
            });
            return;
          }
          result = await simulationService!.checkChannelAccess(
            sandboxId ?? '',
            userId ?? '',
            target
          );
          break;

        case 'feature':
          if (!target) {
            res.status(400).json({
              error: 'Validation error',
              message: 'target is required for feature check',
            });
            return;
          }
          result = await simulationService!.checkFeatureAccess(
            sandboxId ?? '',
            userId ?? '',
            target
          );
          break;

        case 'tier':
          result = await simulationService!.checkTier(sandboxId ?? '', userId ?? '');
          break;

        case 'badges':
          result = await simulationService!.checkBadges(sandboxId ?? '', userId ?? '');
          break;

        default:
          res.status(400).json({
            error: 'Validation error',
            message: `Unknown check type: ${type}`,
          });
          return;
      }

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      res.status(200).json({
        success: true,
        type,
        data: result.data,
      });
    })
  );

  // ===========================================================================
  // Threshold Endpoints (T110.6)
  // ===========================================================================

  /**
   * GET /sandbox/:sandboxId/simulation/:userId/thresholds
   * Get current threshold overrides
   *
   * Security: Requires self-or-admin authorization
   */
  router.get(
    '/:userId/thresholds',
    requireSelfOrAdmin,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const result = await simulationService!.getThresholdOverrides(
        sandboxId ?? '',
        userId ?? ''
      );

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: result.data,
        usingDefaults: result.data === null,
      });
    })
  );

  /**
   * PATCH /sandbox/:sandboxId/simulation/:userId/thresholds
   * Set threshold overrides
   *
   * Security: Requires self-or-admin authorization AND QA role
   * Rate limit: 20 write operations per minute
   */
  router.patch(
    '/:userId/thresholds',
    requireSelfOrAdmin,
    requireQARole,
    writeRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const parseResult = thresholdOverridesSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Validation error',
          details: sanitizeValidationErrors(parseResult.error.issues),
        });
        return;
      }

      // Extract version for optimistic locking
      const { version, ...thresholdOverrides } = parseResult.data;

      const result = await simulationService!.setThresholdOverrides(
        sandboxId ?? '',
        userId ?? '',
        thresholdOverrides,
        { expectedVersion: version }
      );

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      logger.info(
        { sandboxId, userId, overrides: parseResult.data },
        'Thresholds set via REST API'
      );

      res.status(200).json({
        success: true,
        data: result.data!.thresholdOverrides,
        version: result.data!.version,
      });
    })
  );

  /**
   * DELETE /sandbox/:sandboxId/simulation/:userId/thresholds
   * Clear threshold overrides (revert to defaults)
   *
   * Security: Requires self-or-admin authorization AND QA role
   * Rate limit: 20 write operations per minute
   */
  router.delete(
    '/:userId/thresholds',
    requireSelfOrAdmin,
    requireQARole,
    writeRateLimiter,
    asyncHandler(async (req: SimulationRequest, res: Response) => {
      const { sandboxId, simulationService } = req;
      const { userId } = req.params;

      const result = await simulationService!.clearThresholdOverrides(
        sandboxId ?? '',
        userId ?? ''
      );

      if (!result.success) {
        res.status(getHttpStatus(result.error!.code)).json({
          error: result.error!.message,
          code: result.error!.code,
          details: result.error!.details,
        });
        return;
      }

      logger.info({ sandboxId, userId }, 'Thresholds cleared via REST API');

      res.status(200).json({
        success: true,
        message: 'Thresholds cleared, using defaults',
        version: result.data!.version,
      });
    })
  );

  // ===========================================================================
  // Error Handler (Sprint 113 - HIGH-004 Security: Error Sanitization)
  // ===========================================================================

  router.use(
    (err: Error, req: Request, res: Response, _next: NextFunction) => {
      const authReq = req as SimulationRequest;

      // Sanitize error and log with full details
      const sanitizedResponse = sanitizeAndLogError(err, {
        path: req.path,
        method: req.method,
        userId: authReq.caller?.userId,
      });

      // Send sanitized response to client
      const responseBody: Record<string, unknown> = {
        error: sanitizedResponse.error,
        errorRef: sanitizedResponse.errorRef,
      };
      if (sanitizedResponse.details) {
        responseBody.details = sanitizedResponse.details;
      }
      res.status(sanitizedResponse.status).json(responseBody);
    }
  );

  return router;
}
