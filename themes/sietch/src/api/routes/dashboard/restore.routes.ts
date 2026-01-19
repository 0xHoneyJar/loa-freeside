/**
 * Dashboard Restore Routes
 *
 * Sprint 126: Restore API & CLI
 *
 * REST API endpoints for configuration restore functionality including
 * preview (impact analysis) and execute operations.
 *
 * @see grimoires/loa/sdd.md §4.5 Restore API
 * @module api/routes/dashboard/restore
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { logger } from '../../../utils/logger.js';
import type { IConfigService } from '../../../services/config/ConfigService.js';
import {
  createImpactAnalyzer,
  type IImpactAnalyzer,
  type RestoreImpactReport,
} from '../../../services/restore/ImpactAnalyzer.js';
import type { AuthenticatedDashboardRequest, DashboardAuthMiddleware } from '../../middleware/dashboardAuth.js';
import { NotFoundError, BadRequestError } from '../../errors.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Redis interface for confirmation code storage
 * Sprint 133 (CRIT-001): Secure confirmation code state management
 */
export interface RestoreRedisClient {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, options?: { EX?: number }) => Promise<void>;
  del: (key: string) => Promise<void>;
}

/**
 * Confirmation code attempt tracking
 * Sprint 133 (CRIT-001): Track failed attempts per session
 */
interface ConfirmationAttemptRecord {
  code: string;
  attempts: number;
  createdAt: number;
}

export interface RestoreRoutesDeps {
  /** ConfigService for fetching/updating configuration */
  configService: IConfigService;
  /** Dashboard auth middleware */
  dashboardAuth: DashboardAuthMiddleware;
  /** Optional custom logger */
  logger?: typeof logger;
  /** Optional custom ImpactAnalyzer */
  impactAnalyzer?: IImpactAnalyzer;
  /** Redis client for confirmation code storage (Sprint 133 - CRIT-001) */
  redis?: RestoreRedisClient;
}

interface RestoreRequest extends AuthenticatedDashboardRequest {
  params: {
    serverId: string;
  };
}

// =============================================================================
// Validation Schemas
// =============================================================================

const previewRequestSchema = z.object({
  checkpointId: z.string().min(1, 'Checkpoint ID is required'),
});

const executeRequestSchema = z.object({
  checkpointId: z.string().min(1, 'Checkpoint ID is required'),
  confirmationCode: z.string().min(1, 'Confirmation code is required'),
});

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create restore routes for dashboard API
 */
// =============================================================================
// Constants (Sprint 133 - CRIT-001)
// =============================================================================

/** Confirmation code TTL in seconds (10 minutes) */
const CONFIRMATION_CODE_TTL = 10 * 60;

/** Maximum failed confirmation attempts before invalidation */
const MAX_CONFIRMATION_ATTEMPTS = 3;

/** Redis key prefix for confirmation codes */
const CONFIRMATION_CODE_PREFIX = 'restore:confirm:';

// =============================================================================
// Route Factory
// =============================================================================

export function createRestoreRoutes(deps: RestoreRoutesDeps): Router {
  const router = Router();
  const log = deps.logger ?? logger;
  const impactAnalyzer = deps.impactAnalyzer ?? createImpactAnalyzer();
  const redis = deps.redis;
  const { requireDashboardAuth, requireServerAccess } = deps.dashboardAuth;

  /**
   * Generate confirmation code Redis key
   * Sprint 133 (CRIT-001): Unique per server, user, and checkpoint
   */
  function getConfirmationCodeKey(serverId: string, userId: string, checkpointId: string): string {
    return `${CONFIRMATION_CODE_PREFIX}${serverId}:${userId}:${checkpointId}`;
  }

  /**
   * Store confirmation code in Redis with TTL
   * Sprint 133 (CRIT-001): Secure confirmation code state management
   */
  async function storeConfirmationCode(
    serverId: string,
    userId: string,
    checkpointId: string,
    code: string
  ): Promise<void> {
    if (!redis) {
      log.warn('Redis not available, confirmation code cannot be stored securely');
      return;
    }

    const key = getConfirmationCodeKey(serverId, userId, checkpointId);
    const record: ConfirmationAttemptRecord = {
      code,
      attempts: 0,
      createdAt: Date.now(),
    };

    await redis.set(key, JSON.stringify(record), { EX: CONFIRMATION_CODE_TTL });
    log.debug({ serverId, userId, checkpointId }, 'Confirmation code stored');
  }

  /**
   * Validate confirmation code with constant-time comparison
   * Sprint 133 (CRIT-001): Secure validation with attempt tracking
   *
   * @returns true if valid, throws BadRequestError if invalid
   */
  async function validateConfirmationCode(
    serverId: string,
    userId: string,
    checkpointId: string,
    submittedCode: string
  ): Promise<void> {
    if (!redis) {
      // Fallback: Accept code if Redis is not available (log warning)
      log.warn(
        { serverId, userId, checkpointId },
        'Redis not available, skipping secure confirmation code validation'
      );
      if (!submittedCode || submittedCode.length < 6) {
        throw new BadRequestError('Confirmation code required for high-impact restores');
      }
      return;
    }

    const key = getConfirmationCodeKey(serverId, userId, checkpointId);
    const stored = await redis.get(key);

    if (!stored) {
      log.warn(
        { serverId, userId, checkpointId },
        'Confirmation code validation failed: code not found or expired'
      );
      throw new BadRequestError(
        'Confirmation code expired or not found. Please request a new preview.'
      );
    }

    const record: ConfirmationAttemptRecord = JSON.parse(stored);

    // Check if max attempts exceeded
    if (record.attempts >= MAX_CONFIRMATION_ATTEMPTS) {
      await redis.del(key);
      log.warn(
        { serverId, userId, checkpointId, attempts: record.attempts },
        'Confirmation code validation failed: max attempts exceeded'
      );
      throw new BadRequestError(
        'Maximum confirmation attempts exceeded. Please request a new preview.'
      );
    }

    // Constant-time comparison to prevent timing attacks
    const storedBuffer = Buffer.from(record.code, 'utf8');
    const submittedBuffer = Buffer.from(submittedCode, 'utf8');

    // Pad to same length for constant-time comparison
    const maxLength = Math.max(storedBuffer.length, submittedBuffer.length);
    const paddedStored = Buffer.alloc(maxLength);
    const paddedSubmitted = Buffer.alloc(maxLength);
    storedBuffer.copy(paddedStored);
    submittedBuffer.copy(paddedSubmitted);

    const isValid = crypto.timingSafeEqual(paddedStored, paddedSubmitted);

    if (!isValid) {
      // Increment attempt counter
      record.attempts += 1;
      await redis.set(key, JSON.stringify(record), { EX: CONFIRMATION_CODE_TTL });

      log.warn(
        { serverId, userId, checkpointId, attempts: record.attempts },
        'Confirmation code validation failed: invalid code'
      );
      throw new BadRequestError('Invalid confirmation code');
    }

    // Valid code - delete it (single use)
    await redis.del(key);
    log.info({ serverId, userId, checkpointId }, 'Confirmation code validated successfully');
  }

  /**
   * GET /servers/:serverId/restore/checkpoints
   *
   * Lists available checkpoints for a server.
   *
   * Response:
   * - 200: List of checkpoints
   * - 401: Not authenticated
   * - 403: No access to server
   */
  router.get(
    '/servers/:serverId/restore/checkpoints',
    requireDashboardAuth,
    requireServerAccess,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const restoreReq = req as RestoreRequest;
      const { serverId } = restoreReq.params;

      try {
        log.debug(
          { serverId, userId: restoreReq.dashboardSession?.userId },
          'Listing restore checkpoints'
        );

        // Get config history filtered to CheckpointSnapshot records
        const history = await deps.configService.getConfigHistory({
          serverId,
          recordableType: 'CheckpointSnapshot',
          limit: 50,
        });

        const checkpoints = history.records.map((record) => ({
          id: record.recordableId,
          createdAt: record.createdAt.toISOString(),
          triggerCommand: (record.payload as any).triggerCommand,
          userId: record.userId,
        }));

        res.json({
          serverId,
          checkpoints,
          total: history.total,
        });
      } catch (error) {
        log.error({ error, serverId }, 'Failed to list checkpoints');
        next(error);
      }
    }
  );

  /**
   * POST /servers/:serverId/restore/preview
   *
   * Previews the impact of restoring to a checkpoint.
   *
   * Request Body:
   * - checkpointId: ID of the checkpoint to preview
   *
   * Response:
   * - 200: Impact analysis report
   * - 400: Invalid request body
   * - 401: Not authenticated
   * - 403: No access to server
   * - 404: Checkpoint not found
   */
  router.post(
    '/servers/:serverId/restore/preview',
    requireDashboardAuth,
    requireServerAccess,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const restoreReq = req as RestoreRequest;
      const { serverId } = restoreReq.params;

      try {
        // Validate request body
        const parseResult = previewRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          throw new BadRequestError(parseResult.error.issues[0]?.message ?? 'Validation error');
        }

        const { checkpointId } = parseResult.data;

        log.debug(
          {
            serverId,
            checkpointId,
            userId: restoreReq.dashboardSession?.userId,
          },
          'Previewing restore impact'
        );

        // Get current configuration
        const currentConfig = await deps.configService.getCurrentConfiguration(serverId);
        if (!currentConfig) {
          throw new NotFoundError('Server configuration', serverId);
        }

        // Get checkpoint from history
        const checkpoint = await getCheckpointById(deps.configService, serverId, checkpointId);
        if (!checkpoint) {
          throw new NotFoundError('Checkpoint', checkpointId);
        }

        // Analyze impact
        const report = impactAnalyzer.analyzeCheckpointRestore(currentConfig, checkpoint);

        // Generate confirmation code if high-impact
        // Sprint 133 (CRIT-001): Use crypto.randomBytes instead of Math.random
        let confirmationCode: string | null = null;
        if (report.isHighImpact) {
          confirmationCode = generateConfirmationCode();
          const userId = restoreReq.dashboardSession?.userId ?? 'unknown';

          // Store code in Redis with TTL (Sprint 133 - CRIT-001)
          await storeConfirmationCode(serverId, userId, checkpointId, confirmationCode);
        }

        res.json({
          ...formatImpactReport(report),
          confirmationCode,
          confirmationRequired: report.isHighImpact,
        });

        log.info(
          {
            serverId,
            checkpointId,
            isHighImpact: report.isHighImpact,
            totalChanges: report.summary.totalChanges,
          },
          'Restore preview completed'
        );
      } catch (error) {
        log.error({ error, serverId }, 'Restore preview failed');
        next(error);
      }
    }
  );

  /**
   * POST /servers/:serverId/restore/execute
   *
   * Executes a restore to a checkpoint.
   *
   * Request Body:
   * - checkpointId: ID of the checkpoint to restore to
   * - confirmationCode: Required for high-impact restores
   *
   * Response:
   * - 200: Restore result
   * - 400: Invalid request body or wrong confirmation code
   * - 401: Not authenticated
   * - 403: No access to server
   * - 404: Checkpoint not found
   */
  router.post(
    '/servers/:serverId/restore/execute',
    requireDashboardAuth,
    requireServerAccess,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const restoreReq = req as RestoreRequest;
      const { serverId } = restoreReq.params;
      const userId = restoreReq.dashboardSession?.userId ?? 'unknown';

      try {
        // Validate request body
        const parseResult = executeRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          throw new BadRequestError(parseResult.error.issues[0]?.message ?? 'Validation error');
        }

        const { checkpointId, confirmationCode } = parseResult.data;

        log.info(
          {
            serverId,
            checkpointId,
            userId,
          },
          'Executing restore'
        );

        // Get current configuration
        const currentConfig = await deps.configService.getCurrentConfiguration(serverId);
        if (!currentConfig) {
          throw new NotFoundError('Server configuration', serverId);
        }

        // Get checkpoint
        const checkpoint = await getCheckpointById(deps.configService, serverId, checkpointId);
        if (!checkpoint) {
          throw new NotFoundError('Checkpoint', checkpointId);
        }

        // Analyze impact to check if confirmation is required
        const report = impactAnalyzer.analyzeCheckpointRestore(currentConfig, checkpoint);

        // Verify confirmation code for high-impact restores
        // Sprint 133 (CRIT-001): Secure validation with Redis state
        if (report.isHighImpact) {
          if (!confirmationCode || confirmationCode.length < 6) {
            throw new BadRequestError(
              'Confirmation code required for high-impact restores'
            );
          }
          // Validate code with constant-time comparison (Sprint 133 - CRIT-001)
          await validateConfirmationCode(serverId, userId, checkpointId, confirmationCode);
        }

        // Execute the restore by updating all configuration sections
        const targetState = checkpoint.fullStateJson;

        // Get current version for optimistic locking
        const currentVersion = currentConfig.version;

        // Update thresholds
        if (targetState.thresholds) {
          await deps.configService.updateThresholds(
            serverId,
            userId,
            targetState.thresholds as unknown as Parameters<typeof deps.configService.updateThresholds>[2],
            currentVersion
          );
        }

        // Update feature gates
        if (targetState.featureGates) {
          await deps.configService.updateFeatureGates(
            serverId,
            userId,
            targetState.featureGates as unknown as Parameters<typeof deps.configService.updateFeatureGates>[2],
            currentVersion
          );
        }

        // Update role mappings
        if (targetState.roleMappings) {
          await deps.configService.updateRoleMappings(
            serverId,
            userId,
            targetState.roleMappings as unknown as Parameters<typeof deps.configService.updateRoleMappings>[2],
            currentVersion
          );
        }

        log.info(
          {
            serverId,
            checkpointId,
            userId,
            totalChanges: report.summary.totalChanges,
          },
          'Restore completed successfully'
        );

        res.json({
          success: true,
          serverId,
          checkpointId,
          restoredAt: new Date().toISOString(),
          changes: report.summary,
          message: `Configuration restored from checkpoint ${checkpointId}`,
        });
      } catch (error) {
        log.error({ error, serverId }, 'Restore execution failed');
        next(error);
      }
    }
  );

  return router;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a checkpoint by ID from config history
 */
async function getCheckpointById(
  configService: IConfigService,
  serverId: string,
  checkpointId: string
): Promise<import('../../../db/types/config.types.js').CheckpointSnapshot | null> {
  const history = await configService.getConfigHistory({
    serverId,
    recordableType: 'CheckpointSnapshot',
    limit: 100,
  });

  for (const record of history.records) {
    if (record.recordableId === checkpointId) {
      return record.payload as import('../../../db/types/config.types.js').CheckpointSnapshot;
    }
  }

  return null;
}

/**
 * Generate a 6-digit confirmation code
 *
 * Sprint 133 (MED-003): Use crypto.randomBytes instead of Math.random
 * for cryptographically secure random number generation.
 */
function generateConfirmationCode(): string {
  // Generate 4 random bytes and convert to a number
  const randomBytes = crypto.randomBytes(4);
  const randomNumber = randomBytes.readUInt32BE(0);
  // Convert to 6-digit code (100000-999999)
  const code = 100000 + (randomNumber % 900000);
  return code.toString();
}

/**
 * Format impact report for API response
 */
function formatImpactReport(report: RestoreImpactReport) {
  return {
    serverId: report.serverId,
    analyzedAt: report.analyzedAt.toISOString(),
    isHighImpact: report.isHighImpact,
    summary: report.summary,
    userImpact: report.userImpact,
    thresholdChanges: report.thresholdChanges,
    featureChanges: report.featureChanges,
    roleChanges: report.roleChanges,
    humanReadableSummary: report.humanReadableSummary,
    warnings: report.warnings,
  };
}

// =============================================================================
// Exports
// =============================================================================

export type { RestoreImpactReport } from '../../../services/restore/ImpactAnalyzer.js';
