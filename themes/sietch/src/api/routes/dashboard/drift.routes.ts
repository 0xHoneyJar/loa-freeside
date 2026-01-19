/**
 * Dashboard Drift Detection Routes
 *
 * Sprint 124: Drift API & Scheduled Check
 *
 * Exposes drift detection via REST API. Returns ghost roles and renamed
 * roles for dashboard display and alerting.
 *
 * @see grimoires/loa/sdd.md §4.3 DriftDetector
 * @module api/routes/dashboard/drift
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Guild } from 'discord.js';
import { z } from 'zod';
import { logger } from '../../../utils/logger.js';
import type { IConfigService } from '../../../services/config/ConfigService.js';
import {
  createDriftDetector,
  type DriftReport,
  type IDriftDetector,
} from '../../../services/config/DriftDetector.js';
import type { AuthenticatedDashboardRequest, DashboardAuthMiddleware } from '../../middleware/dashboardAuth.js';
import { NotFoundError, InternalServerError } from '../../errors.js';

// =============================================================================
// Types
// =============================================================================

export interface DriftRoutesDeps {
  /** Discord guild for role lookups */
  guild: Guild;
  /** ConfigService for fetching configuration */
  configService: IConfigService;
  /** Dashboard auth middleware */
  dashboardAuth: DashboardAuthMiddleware;
  /** Optional custom logger */
  logger?: typeof logger;
}

interface DriftRequest extends AuthenticatedDashboardRequest {
  params: {
    serverId: string;
  };
}

// =============================================================================
// Response Formatting
// =============================================================================

/**
 * Format drift report for API response
 */
function formatDriftResponse(report: DriftReport) {
  return {
    serverId: report.serverId,
    checkedAt: report.checkedAt.toISOString(),
    status: report.hasDrift ? 'drift_detected' : 'healthy',
    summary: {
      totalIssues: report.totalDriftCount,
      deletedRoles: report.deletedRolesCount,
      renamedRoles: report.renamedRolesCount,
      healthyRoles: report.healthyRolesCount,
    },
    issues: report.items.map((item) => ({
      type: item.type,
      severity: item.severity,
      roleId: item.roleId,
      configRoleName: item.configRoleName,
      currentRoleName: item.currentRoleName,
      tierId: item.tierId,
      suggestion: item.suggestion,
    })),
    // Alert status based on sprint requirements
    alert: report.deletedRolesCount > 0
      ? {
          level: 'info',
          message: `${report.deletedRolesCount} ghost role(s) detected - these Discord roles have been deleted`,
        }
      : null,
  };
}

// =============================================================================
// Route Factory
// =============================================================================

/**
 * Create drift detection routes
 */
export function createDriftRoutes(deps: DriftRoutesDeps): Router {
  const router = Router();
  const log = deps.logger ?? logger;
  const { requireDashboardAuth, requireServerAccess } = deps.dashboardAuth;

  // Create drift detector
  const driftDetector = createDriftDetector({
    guild: deps.guild,
    logger: log,
  });

  /**
   * GET /servers/:serverId/drift
   *
   * Returns drift report for a server. Detects ghost roles (deleted from
   * Discord but still in config) and renamed roles.
   *
   * Response:
   * - 200: Drift report
   * - 401: Not authenticated
   * - 403: No access to server
   * - 404: Server config not found
   * - 500: Internal error
   */
  router.get(
    '/servers/:serverId/drift',
    requireDashboardAuth,
    requireServerAccess,
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const driftReq = req as DriftRequest;
      const { serverId } = driftReq.params;

      try {
        log.debug(
          { serverId, userId: driftReq.dashboardSession?.userId },
          'Drift check requested'
        );

        // Get current config
        const config = await deps.configService.getCurrentConfiguration(serverId);
        if (!config) {
          throw new NotFoundError('Server configuration', serverId);
        }

        // Check for drift
        const report = await driftDetector.checkServerDrift(serverId, config);

        // Log if drift detected
        if (report.hasDrift) {
          log.info(
            {
              serverId,
              deletedRoles: report.deletedRolesCount,
              renamedRoles: report.renamedRolesCount,
              userId: driftReq.dashboardSession?.userId,
            },
            'Drift detected via API'
          );
        }

        res.json(formatDriftResponse(report));
      } catch (error) {
        log.error({ error, serverId }, 'Drift check failed');
        next(error);
      }
    }
  );

  /**
   * POST /servers/:serverId/drift/clear-cache
   *
   * Clears cached drift report for a server. Call after updating role
   * mappings to force fresh check on next request.
   *
   * Response:
   * - 200: Cache cleared
   * - 401: Not authenticated
   * - 403: No access to server
   */
  router.post(
    '/servers/:serverId/drift/clear-cache',
    requireDashboardAuth,
    requireServerAccess,
    async (req: Request, res: Response): Promise<void> => {
      const driftReq = req as DriftRequest;
      const { serverId } = driftReq.params;

      driftDetector.clearCache(serverId);

      log.debug(
        { serverId, userId: driftReq.dashboardSession?.userId },
        'Drift cache cleared via API'
      );

      res.json({
        success: true,
        message: 'Drift cache cleared. Next request will perform fresh check.',
      });
    }
  );

  return router;
}

// =============================================================================
// Exports
// =============================================================================

export type { DriftReport } from '../../../services/config/DriftDetector.js';
