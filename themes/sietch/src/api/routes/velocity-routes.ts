/**
 * Velocity API — Community Velocity Snapshot
 *
 * GET /api/communities/:communityId/velocity
 *   Auth: requireAuth (member, operator, admin) (AC-3.6.3)
 *   Returns: VelocitySnapshot with BigInt values as strings (AC-3.6.1)
 *   Cache: Redis 60s TTL with DB fallback (AC-3.6.2)
 *
 * @see SDD §4.5 Temporal Dimension
 * @see Sprint 3, Task 3.6
 * @module api/routes/velocity-routes
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { memberRateLimiter } from '../middleware.js';
import { serializeBigInt } from '../../packages/core/protocol/arrakis-arithmetic.js';
import { getLatestSnapshot } from '../../../../packages/services/velocity-service.js';
import { isFeatureEnabled } from '../../../../packages/services/feature-flags.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Router Setup
// =============================================================================

export const velocityRouter = Router();

// =============================================================================
// Dependencies
// =============================================================================

let pgPool: Pool | null = null;
let redisClient: { get: (key: string) => Promise<string | null>; set: (key: string, value: string, mode: string, ttl: number) => Promise<unknown> } | null = null;

export function setVelocityPool(pool: Pool): void {
  pgPool = pool;
}

export function setVelocityRedis(client: typeof redisClient): void {
  redisClient = client;
}

function getPool(): Pool {
  if (!pgPool) throw new Error('Velocity pool not initialized');
  return pgPool;
}

// =============================================================================
// Configuration
// =============================================================================

const CACHE_TTL_SECONDS = 60;
const CACHE_PREFIX = 'velocity:snapshot:';

// =============================================================================
// Validation
// =============================================================================

const communityIdSchema = z.object({
  communityId: z.string().uuid(),
});

// =============================================================================
// Role Enforcement Middleware (AC-3.6.3)
// =============================================================================

const ALLOWED_VELOCITY_ROLES = ['member', 'operator', 'admin', 'qa_admin'];

/**
 * Enforce member/operator/admin role requirement.
 * AC-3.6.3: Only these roles may access velocity data.
 */
function requireVelocityRole(
  req: AuthenticatedRequest,
  res: Response,
  next: () => void,
): void {
  const roles = req.caller?.roles ?? [];
  const allowed = roles.some((r: string) => ALLOWED_VELOCITY_ROLES.includes(r));

  if (!allowed) {
    res.status(403).json({ error: 'Insufficient role for velocity access' });
    return;
  }

  next();
}

// =============================================================================
// Community Match Middleware (AC-3.6.4)
// =============================================================================

/**
 * Verify the caller has access to the requested community.
 *
 * AC-3.6.4: requireCommunityMatch — ensures the authenticated caller
 * is a member/operator/admin of the community being queried.
 *
 * In the Arrakis model, community membership is verified by checking
 * the caller's community scope against the requested community ID.
 */
async function requireCommunityMatch(
  req: AuthenticatedRequest,
  res: Response,
  next: () => void,
): Promise<void> {
  const { communityId } = req.params;

  if (!communityId) {
    res.status(400).json({ error: 'Missing communityId parameter' });
    return;
  }

  if (!req.caller) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Admins can query any community
  const roles = req.caller?.roles ?? [];
  const isAdmin = roles.some((r: string) => r === 'admin' || r === 'qa_admin');
  if (isAdmin) {
    return next();
  }

  // For non-admin callers, verify community membership via DB
  try {
    const pool = getPool();
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM community_members
        WHERE community_id = $1 AND user_id = $2
      ) AS exists`,
      [communityId, req.caller.userId],
    );

    if (!result.rows[0]?.exists) {
      res.status(403).json({ error: 'Not a member of this community' });
      return;
    }

    next();
  } catch (err) {
    logger.error({ event: 'velocity.community_match.error', err }, 'Community match check failed');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// =============================================================================
// GET /communities/:communityId/velocity (AC-3.6.1)
// =============================================================================

velocityRouter.get(
  '/communities/:communityId/velocity',
  requireAuth,
  memberRateLimiter,
  requireVelocityRole,
  requireCommunityMatch,
  async (req: AuthenticatedRequest, res: Response) => {
    // Validate communityId format
    const parsed = communityIdSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { communityId } = parsed.data;

    // Feature flag check
    if (!isFeatureEnabled('FEATURE_VELOCITY_ALERTS')) {
      res.status(404).json({ error: 'Velocity not available' });
      return;
    }

    try {
      // Step 1: Try Redis cache (AC-3.6.2)
      const cached = await getCachedSnapshot(communityId);
      if (cached) {
        res.json(cached);
        return;
      }

      // Step 2: DB fallback
      const pool = getPool();
      const snapshot = await getLatestSnapshot(pool, communityId);

      if (!snapshot) {
        res.status(404).json({ error: 'No velocity snapshot available for this community' });
        return;
      }

      // AC-3.6.1: Serialize BigInt values as strings
      const serialized = serializeBigInt({
        communityId: snapshot.communityId,
        computedAt: snapshot.computedAt.toISOString(),
        windowHours: snapshot.windowHours,
        velocityMicroPerHour: snapshot.velocityMicroPerHour,
        accelerationMicroPerHour2: snapshot.accelerationMicroPerHour2,
        availableBalanceMicro: snapshot.availableBalanceMicro,
        estimatedExhaustionHours: snapshot.estimatedExhaustionHours,
        confidence: snapshot.confidence,
        bucketCount: snapshot.bucketCount,
      });

      // Cache in Redis (AC-3.6.2)
      await cacheSnapshot(communityId, serialized);

      res.json(serialized);
    } catch (err) {
      logger.error(
        { event: 'velocity.get.error', communityId, err },
        'Failed to retrieve velocity snapshot',
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// Redis Cache Helpers
// =============================================================================

async function getCachedSnapshot(communityId: string): Promise<Record<string, unknown> | null> {
  if (!redisClient) return null;

  try {
    const cached = await redisClient.get(`${CACHE_PREFIX}${communityId}`);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch {
    // Redis failure is non-fatal — fall through to DB
  }

  return null;
}

async function cacheSnapshot(communityId: string, data: unknown): Promise<void> {
  if (!redisClient) return;

  try {
    await redisClient.set(
      `${CACHE_PREFIX}${communityId}`,
      JSON.stringify(data),
      'EX',
      CACHE_TTL_SECONDS,
    );
  } catch {
    // Redis failure is non-fatal — snapshot was already returned from DB
  }
}
