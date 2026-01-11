// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * Coexistence Routes Module
 * Sprint 65: Full Social Layer & Polish - API Endpoints
 *
 * Provides REST API endpoints for coexistence management:
 * - GET /coexistence/:guildId/status - Community coexistence status
 * - POST /coexistence/:guildId/mode - Transition coexistence mode
 * - POST /coexistence/:guildId/rollback - Initiate rollback
 * - GET /coexistence/:guildId/shadow/divergences - Shadow mode divergences
 * - POST /coexistence/:guildId/emergency-backup - Emergency backup activation
 *
 * @module api/routes/coexistence.routes
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  adminRateLimiter,
  requireApiKey,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import { logAuditEvent } from '../../db/index.js';
import type { CoexistenceMode } from '../../packages/adapters/storage/schema.js';
import type { ICoexistenceStorage } from '../../packages/core/ports/ICoexistenceStorage.js';
import type { SocialLayerService } from '../../packages/core/services/SocialLayerService.js';
import type { MigrationEngine } from '../../packages/adapters/coexistence/MigrationEngine.js';
import type { IncumbentHealthMonitor } from '../../packages/adapters/coexistence/IncumbentHealthMonitor.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Coexistence router dependencies
 */
export interface CoexistenceRouterDeps {
  storage: ICoexistenceStorage;
  socialLayerService: SocialLayerService;
  migrationEngine?: MigrationEngine;
  healthMonitor?: IncumbentHealthMonitor;
}

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Guild ID parameter validation
 */
const guildIdParamSchema = z.object({
  guildId: z.string().min(1, 'Guild ID is required'),
});

/**
 * Mode transition request body
 */
const modeTransitionSchema = z.object({
  targetMode: z.enum(['shadow', 'parallel', 'primary', 'exclusive']),
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long').optional(),
  force: z.boolean().optional().default(false),
});

/**
 * Rollback request body
 */
const rollbackSchema = z.object({
  targetMode: z.enum(['shadow', 'parallel', 'primary']),
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long'),
});

/**
 * Divergences query parameters
 */
const divergencesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum(['match', 'arrakis_higher', 'arrakis_lower', 'mismatch']).optional(),
  unresolved: z.coerce.boolean().optional(),
});

/**
 * Emergency backup request body
 */
const emergencyBackupSchema = z.object({
  adminId: z.string().min(1, 'Admin ID is required'),
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long').optional(),
});

// =============================================================================
// Router Factory
// =============================================================================

/**
 * Create coexistence router with injected dependencies
 *
 * @param deps - Router dependencies
 * @returns Express router
 */
export function createCoexistenceRouter(deps: CoexistenceRouterDeps): Router {
  const router = Router();
  const { storage, socialLayerService, migrationEngine, healthMonitor } = deps;

  // Apply rate limiting and authentication
  router.use(adminRateLimiter);
  router.use(requireApiKey);

  // =========================================================================
  // GET /coexistence/:guildId/status (TASK-65.4)
  // =========================================================================

  /**
   * Get coexistence status for a community
   *
   * Returns:
   * - Current mode
   * - Migration state details
   * - Incumbent configuration
   * - Social layer status
   * - Health status
   */
  router.get('/:guildId/status', async (req: AuthenticatedRequest, res: Response) => {
    const paramsResult = guildIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ValidationError(paramsResult.error.issues.map(i => i.message).join(', '));
    }

    const { guildId } = paramsResult.data;

    // Look up community by guild ID
    const community = await storage.getCommunity(guildId);
    if (!community) {
      throw new NotFoundError('Community not found for this guild');
    }

    // Get migration state
    const migrationState = await storage.getMigrationState(community.id);

    // Get incumbent config
    const incumbentConfig = await storage.getIncumbentConfig(community.id);

    // Get social layer status
    const socialStatus = await socialLayerService.getSocialLayerStatus(community.id);

    // Get parallel role config if in parallel+ mode
    let parallelConfig = null;
    if (migrationState && ['parallel', 'primary', 'exclusive'].includes(migrationState.currentMode)) {
      parallelConfig = await storage.getParallelRoleConfig(community.id);
    }

    res.json({
      communityId: community.id,
      guildId: guildId,
      currentMode: migrationState?.currentMode ?? 'shadow',
      targetMode: migrationState?.targetMode ?? null,
      strategy: migrationState?.strategy ?? null,
      timestamps: {
        shadowStartedAt: migrationState?.shadowStartedAt?.toISOString() ?? null,
        parallelEnabledAt: migrationState?.parallelEnabledAt?.toISOString() ?? null,
        primaryEnabledAt: migrationState?.primaryEnabledAt?.toISOString() ?? null,
        exclusiveEnabledAt: migrationState?.exclusiveEnabledAt?.toISOString() ?? null,
      },
      readiness: {
        checkPassed: migrationState?.readinessCheckPassed ?? false,
        accuracyPercent: migrationState?.accuracyPercent ?? null,
        shadowDays: migrationState?.shadowDays ?? 0,
      },
      rollback: {
        count: migrationState?.rollbackCount ?? 0,
        lastAt: migrationState?.lastRollbackAt?.toISOString() ?? null,
        lastReason: migrationState?.lastRollbackReason ?? null,
      },
      incumbent: incumbentConfig
        ? {
            provider: incumbentConfig.provider,
            botId: incumbentConfig.botId,
            botUsername: incumbentConfig.botUsername,
            healthStatus: incumbentConfig.healthStatus,
            lastHealthCheck: incumbentConfig.lastHealthCheck?.toISOString() ?? null,
            confidence: incumbentConfig.confidence,
          }
        : null,
      socialLayer: socialStatus
        ? {
            fullyUnlocked: socialStatus.fullyUnlocked,
            unlockProgress: socialStatus.unlockProgress,
            featuresUnlocked: socialStatus.features.filter(f => f.unlocked).length,
            totalFeatures: socialStatus.features.length,
            nextMilestone: socialStatus.nextMilestone ?? null,
          }
        : null,
      parallelRoles: parallelConfig
        ? {
            enabled: parallelConfig.enabled,
            namespace: parallelConfig.namespace,
            rolesCreated: parallelConfig.totalRolesCreated,
            setupCompletedAt: parallelConfig.setupCompletedAt?.toISOString() ?? null,
          }
        : null,
    });
  });

  // =========================================================================
  // POST /coexistence/:guildId/mode (TASK-65.5)
  // =========================================================================

  /**
   * Transition coexistence mode
   *
   * Valid transitions:
   * - shadow -> parallel
   * - parallel -> primary
   * - primary -> exclusive
   */
  router.post('/:guildId/mode', async (req: AuthenticatedRequest, res: Response) => {
    const paramsResult = guildIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ValidationError(paramsResult.error.issues.map(i => i.message).join(', '));
    }

    const bodyResult = modeTransitionSchema.safeParse(req.body);
    if (!bodyResult.success) {
      throw new ValidationError(bodyResult.error.issues.map(i => i.message).join(', '));
    }

    const { guildId } = paramsResult.data;
    const { targetMode, reason, force } = bodyResult.data;

    // Look up community
    const community = await storage.getCommunity(guildId);
    if (!community) {
      throw new NotFoundError('Community not found for this guild');
    }

    // Get current state
    const currentMode = await storage.getCurrentMode(community.id);

    // Validate transition
    const validTransitions: Record<CoexistenceMode, CoexistenceMode[]> = {
      shadow: ['parallel'],
      parallel: ['primary'],
      primary: ['exclusive'],
      exclusive: [],
    };

    if (!force && !validTransitions[currentMode].includes(targetMode)) {
      throw new ValidationError(
        `Invalid transition from ${currentMode} to ${targetMode}. ` +
        `Valid transitions from ${currentMode}: ${validTransitions[currentMode].join(', ') || 'none'}`
      );
    }

    // Check readiness for non-forced transitions
    if (!force) {
      const migrationState = await storage.getMigrationState(community.id);

      // Shadow -> Parallel requires readiness check
      if (currentMode === 'shadow' && targetMode === 'parallel') {
        if (!migrationState?.readinessCheckPassed) {
          throw new ValidationError(
            'Cannot transition to parallel mode: readiness check not passed. ' +
            'Run shadow mode longer or use force=true to override.'
          );
        }
      }
    }

    // Execute transition
    if (migrationEngine) {
      await migrationEngine.transitionMode(community.id, targetMode, reason);
    } else {
      // Fallback to direct storage update
      await storage.updateMode(community.id, targetMode, reason);
    }

    // Notify social layer of mode change
    await socialLayerService.onModeChange(community.id, currentMode, targetMode);

    // Log audit event
    logAuditEvent('coexistence_mode_change', {
      communityId: community.id,
      guildId,
      previousMode: currentMode,
      newMode: targetMode,
      reason,
      forced: force,
      triggeredBy: req.adminName,
    });

    res.json({
      success: true,
      communityId: community.id,
      previousMode: currentMode,
      currentMode: targetMode,
      message: `Successfully transitioned from ${currentMode} to ${targetMode}`,
    });
  });

  // =========================================================================
  // POST /coexistence/:guildId/rollback (TASK-65.6)
  // =========================================================================

  /**
   * Rollback to a previous coexistence mode
   *
   * Valid rollback targets:
   * - From exclusive -> primary, parallel, or shadow
   * - From primary -> parallel or shadow
   * - From parallel -> shadow
   */
  router.post('/:guildId/rollback', async (req: AuthenticatedRequest, res: Response) => {
    const paramsResult = guildIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ValidationError(paramsResult.error.issues.map(i => i.message).join(', '));
    }

    const bodyResult = rollbackSchema.safeParse(req.body);
    if (!bodyResult.success) {
      throw new ValidationError(bodyResult.error.issues.map(i => i.message).join(', '));
    }

    const { guildId } = paramsResult.data;
    const { targetMode, reason } = bodyResult.data;

    // Look up community
    const community = await storage.getCommunity(guildId);
    if (!community) {
      throw new NotFoundError('Community not found for this guild');
    }

    // Get current state
    const currentMode = await storage.getCurrentMode(community.id);

    // Validate rollback target is "earlier" in the progression
    const modeOrder: CoexistenceMode[] = ['shadow', 'parallel', 'primary', 'exclusive'];
    const currentIndex = modeOrder.indexOf(currentMode);
    const targetIndex = modeOrder.indexOf(targetMode);

    if (targetIndex >= currentIndex) {
      throw new ValidationError(
        `Cannot rollback from ${currentMode} to ${targetMode}. ` +
        `Target mode must be earlier in progression.`
      );
    }

    // Execute rollback
    await storage.recordRollback(community.id, reason, targetMode);

    // Notify social layer of mode change (potential feature lock)
    await socialLayerService.onModeChange(community.id, currentMode, targetMode);

    // Log audit event
    logAuditEvent('coexistence_rollback', {
      communityId: community.id,
      guildId,
      previousMode: currentMode,
      rollbackTo: targetMode,
      reason,
      triggeredBy: req.adminName,
    });

    res.json({
      success: true,
      communityId: community.id,
      previousMode: currentMode,
      currentMode: targetMode,
      message: `Successfully rolled back from ${currentMode} to ${targetMode}`,
    });
  });

  // =========================================================================
  // GET /coexistence/:guildId/shadow/divergences (TASK-65.7)
  // =========================================================================

  /**
   * Get shadow mode divergences
   *
   * Returns divergences between Arrakis calculations and incumbent bot.
   */
  router.get('/:guildId/shadow/divergences', async (req: AuthenticatedRequest, res: Response) => {
    const paramsResult = guildIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ValidationError(paramsResult.error.issues.map(i => i.message).join(', '));
    }

    const queryResult = divergencesQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      throw new ValidationError(queryResult.error.issues.map(i => i.message).join(', '));
    }

    const { guildId } = paramsResult.data;
    const { limit, offset, type, unresolved } = queryResult.data;

    // Look up community
    const community = await storage.getCommunity(guildId);
    if (!community) {
      throw new NotFoundError('Community not found for this guild');
    }

    // Get divergence summary
    const summary = await storage.getDivergenceSummary(community.id);

    // Get divergences with pagination
    const divergences = await storage.getDivergences(community.id, {
      limit,
      offset,
      divergenceType: type,
      unresolved,
    });

    res.json({
      communityId: community.id,
      guildId,
      summary: {
        totalMembers: summary.totalMembers,
        matchCount: summary.matchCount,
        arrakisHigherCount: summary.arrakisHigherCount,
        arrakisLowerCount: summary.arrakisLowerCount,
        mismatchCount: summary.mismatchCount,
        accuracyPercent: summary.accuracyPercent,
      },
      divergences: divergences.map(d => ({
        id: d.id,
        memberId: d.memberId,
        type: d.divergenceType,
        incumbentState: d.incumbentState,
        arrakisState: d.arrakisState,
        reason: d.reason,
        detectedAt: d.detectedAt.toISOString(),
        resolvedAt: d.resolvedAt?.toISOString() ?? null,
        resolutionType: d.resolutionType,
      })),
      pagination: {
        limit,
        offset,
        total: summary.totalMembers,
      },
    });
  });

  // =========================================================================
  // POST /coexistence/:guildId/emergency-backup (TASK-65.8)
  // =========================================================================

  /**
   * Activate emergency backup
   *
   * Immediately transitions from shadow to parallel mode when incumbent
   * bot is detected as offline/degraded.
   */
  router.post('/:guildId/emergency-backup', async (req: AuthenticatedRequest, res: Response) => {
    const paramsResult = guildIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      throw new ValidationError(paramsResult.error.issues.map(i => i.message).join(', '));
    }

    const bodyResult = emergencyBackupSchema.safeParse(req.body);
    if (!bodyResult.success) {
      throw new ValidationError(bodyResult.error.issues.map(i => i.message).join(', '));
    }

    const { guildId } = paramsResult.data;
    const { adminId, reason } = bodyResult.data;

    // Look up community
    const community = await storage.getCommunity(guildId);
    if (!community) {
      throw new NotFoundError('Community not found for this guild');
    }

    // Check current mode
    const currentMode = await storage.getCurrentMode(community.id);
    if (currentMode !== 'shadow') {
      throw new ValidationError(
        `Emergency backup only available in shadow mode. Current mode: ${currentMode}`
      );
    }

    // Use health monitor if available, otherwise direct transition
    let result: { success: boolean; error?: string; newMode?: CoexistenceMode };

    if (healthMonitor) {
      result = await healthMonitor.activateEmergencyBackup(
        community.id,
        guildId,
        adminId
      );
    } else {
      // Direct transition without health monitor
      await storage.updateMode(community.id, 'parallel', `Emergency backup: ${reason ?? 'Manual activation'}`);
      result = { success: true, newMode: 'parallel' };
    }

    if (!result.success) {
      throw new ValidationError(result.error ?? 'Failed to activate emergency backup');
    }

    // Notify social layer of mode change
    await socialLayerService.onModeChange(community.id, 'shadow', 'parallel');

    // Log audit event
    logAuditEvent('coexistence_emergency_backup', {
      communityId: community.id,
      guildId,
      activatedBy: adminId,
      reason,
      previousMode: 'shadow',
      newMode: result.newMode,
      triggeredBy: req.adminName,
    });

    res.json({
      success: true,
      communityId: community.id,
      previousMode: 'shadow',
      currentMode: result.newMode,
      message: 'Emergency backup activated. Arrakis is now providing parallel token-gating.',
    });
  });

  return router;
}

// =============================================================================
// Default Export
// =============================================================================

export { createCoexistenceRouter as default };
