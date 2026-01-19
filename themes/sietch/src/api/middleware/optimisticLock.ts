/**
 * Optimistic Locking Middleware
 *
 * Sprint 122: Optimistic Locking
 *
 * Extracts expectedVersion from request header or body, validates it,
 * and handles version conflict errors with proper 409 responses.
 *
 * The version can be provided via:
 * 1. `X-Expected-Version` header (recommended)
 * 2. `expectedVersion` field in request body
 * 3. `version` field in request body (fallback)
 *
 * @see grimoires/loa/sdd.md §4.2 Optimistic Locking
 * @module api/middleware/optimisticLock
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedDashboardRequest } from './dashboardAuth.js';
import { ConflictError, toApiError, isApiError } from '../errors.js';
import { logger } from '../../utils/logger.js';
import {
  recordVersionConflict,
  recordVersionCheck,
  getOptimisticLockMetricsPrometheus,
} from './optimisticLockMetrics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Request with optimistic lock context
 */
export interface OptimisticLockRequest extends AuthenticatedDashboardRequest {
  /** Expected version from client */
  expectedVersion: number;
}

/**
 * Options for optimistic lock middleware
 */
export interface OptimisticLockOptions {
  /** Header name for expected version (default: X-Expected-Version) */
  headerName?: string;
  /** Body field name (default: expectedVersion) */
  bodyField?: string;
  /** Fallback body field (default: version) */
  fallbackField?: string;
  /** Whether version is required (default: true) */
  required?: boolean;
  /** Custom logger */
  logger?: typeof logger;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_HEADER_NAME = 'x-expected-version';
const DEFAULT_BODY_FIELD = 'expectedVersion';
const DEFAULT_FALLBACK_FIELD = 'version';

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create optimistic lock middleware.
 *
 * This middleware extracts the expected version from the request and
 * attaches it to the request object. It also provides an error handler
 * for version conflicts.
 *
 * @param options - Middleware options
 * @returns Express middleware function
 */
export function createOptimisticLockMiddleware(options: OptimisticLockOptions = {}) {
  const {
    headerName = DEFAULT_HEADER_NAME,
    bodyField = DEFAULT_BODY_FIELD,
    fallbackField = DEFAULT_FALLBACK_FIELD,
    required = true,
    logger: log = logger,
  } = options;

  /**
   * Extract expected version from request.
   *
   * Looks for version in:
   * 1. X-Expected-Version header
   * 2. expectedVersion body field
   * 3. version body field (fallback)
   */
  function extractVersion(req: Request): number | null {
    // Try header first
    const headerValue = req.headers[headerName];
    if (headerValue) {
      const version = parseInt(String(headerValue), 10);
      if (!isNaN(version) && version >= 0) {
        return version;
      }
    }

    // Try body field
    const body = req.body as Record<string, unknown> | undefined;
    if (body) {
      if (typeof body[bodyField] === 'number') {
        return body[bodyField] as number;
      }
      if (typeof body[bodyField] === 'string') {
        const version = parseInt(body[bodyField] as string, 10);
        if (!isNaN(version) && version >= 0) {
          return version;
        }
      }

      // Try fallback field
      if (typeof body[fallbackField] === 'number') {
        return body[fallbackField] as number;
      }
      if (typeof body[fallbackField] === 'string') {
        const version = parseInt(body[fallbackField] as string, 10);
        if (!isNaN(version) && version >= 0) {
          return version;
        }
      }
    }

    return null;
  }

  /**
   * Optimistic lock middleware.
   *
   * Extracts expected version and attaches to request.
   * Returns 400 Bad Request if version is required but not provided.
   */
  async function optimisticLock(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const version = extractVersion(req);

      if (version === null) {
        if (required) {
          res.status(400).json({
            error: 'VERSION_REQUIRED',
            message: 'Expected version is required. Provide X-Expected-Version header or expectedVersion in request body.',
          });
          return;
        }
        // Not required, continue without version
        return next();
      }

      // Record version check metric
      recordVersionCheck();

      // Attach version to request
      (req as OptimisticLockRequest).expectedVersion = version;

      log.debug(
        { expectedVersion: version, path: req.path },
        'Extracted expected version'
      );

      next();
    } catch (error) {
      log.error({ error }, 'Optimistic lock middleware error');
      res.status(500).json({
        error: 'VERSION_CHECK_ERROR',
        message: 'Failed to validate version',
      });
    }
  }

  /**
   * Error handler for optimistic lock conflicts.
   *
   * Converts OptimisticLockError to proper 409 Conflict response.
   * Should be used as an error middleware.
   */
  function handleVersionConflict(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    // Check if this is a version conflict error
    if (error.name === 'OptimisticLockError') {
      const optimisticReq = req as OptimisticLockRequest;
      const serverId = optimisticReq.serverId ?? 'unknown';
      const expectedVersion = optimisticReq.expectedVersion ?? 0;

      // Parse actual version from error message
      const match = error.message.match(/got (\d+)/);
      const actualVersion = match && match[1] ? parseInt(match[1], 10) : 0;

      // Record metric
      recordVersionConflict();

      // Log the conflict
      log.warn(
        {
          serverId,
          expectedVersion,
          actualVersion,
          userId: optimisticReq.dashboardSession?.userId,
        },
        'Version conflict detected'
      );

      // Return 409 Conflict
      const conflictError = new ConflictError(
        serverId,
        actualVersion,
        expectedVersion
      );

      res.status(409).json(conflictError.toJSON());
      return;
    }

    // Check if this is already an API error
    if (isApiError(error)) {
      res.status(error.statusCode).json(error.toJSON());
      return;
    }

    // Pass to next error handler
    next(error);
  }

  return {
    optimisticLock,
    handleVersionConflict,
    extractVersion,
  };
}

// =============================================================================
// Convenience Exports
// =============================================================================

/**
 * Default optimistic lock middleware instance
 */
const defaultMiddleware = createOptimisticLockMiddleware();

export const optimisticLock = defaultMiddleware.optimisticLock;
export const handleVersionConflict = defaultMiddleware.handleVersionConflict;

// Re-export metrics
export { getOptimisticLockMetricsPrometheus } from './optimisticLockMetrics.js';
