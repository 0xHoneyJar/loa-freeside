/**
 * Events API — Community Event Stream & Consistency Verification
 *
 * GET  /api/communities/:communityId/events
 *   Paginated by sequence number (not offset). Returns has_more flag.
 *   Auth: operator + admin (AC-4.7.5)
 *
 * POST /api/communities/:communityId/events/verify
 *   Dispatches async consistency verification job. Returns job ID.
 *   Rate-limited: max 1 per community per 5 minutes (AC-4.7.4).
 *   Auth: admin only (AC-4.7.5)
 *
 * @see SDD §4.6 Event Formalization
 * @see Sprint 4, Task 4.7
 * @module api/routes/events-routes
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { memberRateLimiter } from '../middleware.js';
import { isFeatureEnabled } from '../../../../packages/services/feature-flags.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Router Setup
// =============================================================================

export const eventsRouter = Router();

// =============================================================================
// Dependencies (setter-based DI)
// =============================================================================

let pgPool: Pool | null = null;

export function setEventsPool(pool: Pool): void {
  pgPool = pool;
}

function getPool(): Pool {
  if (!pgPool) throw new Error('Events pool not initialized');
  return pgPool;
}

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/** AC-4.7.4: Rate limit window for verify endpoint (5 minutes) */
const VERIFY_COOLDOWN_MS = 5 * 60 * 1000;

/** In-memory rate limit tracking for verify (per community) */
const verifyCooldowns = new Map<string, number>();

// =============================================================================
// Validation Schemas
// =============================================================================

const communityIdSchema = z.object({
  communityId: z.string().uuid(),
});

/** AC-4.7.1: Pagination uses from_sequence + limit, not offset */
const eventsQuerySchema = z.object({
  from_sequence: z.string().regex(/^\d+$/, 'Must be a non-negative integer').optional().default('0'),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT),
});

// =============================================================================
// Role Enforcement Middleware (AC-4.7.5)
// =============================================================================

const ALLOWED_EVENTS_ROLES = ['operator', 'admin', 'qa_admin'];
const ALLOWED_VERIFY_ROLES = ['admin', 'qa_admin'];

function requireEventsRole(
  req: AuthenticatedRequest,
  res: Response,
  next: () => void,
): void {
  const roles = req.caller?.roles ?? [];
  const allowed = roles.some((r: string) => ALLOWED_EVENTS_ROLES.includes(r));

  if (!allowed) {
    res.status(403).json({ error: 'Insufficient role for events access' });
    return;
  }

  next();
}

function requireVerifyRole(
  req: AuthenticatedRequest,
  res: Response,
  next: () => void,
): void {
  const roles = req.caller?.roles ?? [];
  const allowed = roles.some((r: string) => ALLOWED_VERIFY_ROLES.includes(r));

  if (!allowed) {
    res.status(403).json({ error: 'Admin role required for verification' });
    return;
  }

  next();
}

// =============================================================================
// Community Match Middleware (AC-4.7.6)
// =============================================================================

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

  // Validate UUID format before any DB query
  const idParsed = z.string().uuid().safeParse(communityId);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid communityId format' });
    return;
  }

  const validatedCommunityId = idParsed.data;

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

  try {
    const pool = getPool();
    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
        SELECT 1 FROM community_members
        WHERE community_id = $1 AND user_id = $2
      ) AS exists`,
      [validatedCommunityId, req.caller.userId],
    );

    if (!result.rows[0]?.exists) {
      res.status(403).json({ error: 'Not a member of this community' });
      return;
    }

    next();
  } catch (err) {
    logger.error({ event: 'events.community_match.error', err }, 'Community match check failed');
    res.status(500).json({ error: 'Internal server error' });
  }
}

// =============================================================================
// GET /communities/:communityId/events (AC-4.7.1, AC-4.7.2)
// =============================================================================

eventsRouter.get(
  '/communities/:communityId/events',
  requireAuth,
  memberRateLimiter,
  requireEventsRole,
  requireCommunityMatch,
  async (req: AuthenticatedRequest, res: Response) => {
    const paramsParsed = communityIdSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: paramsParsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const queryParsed = eventsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: queryParsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { communityId } = paramsParsed.data;
    const { from_sequence, limit } = queryParsed.data;

    if (!isFeatureEnabled('FEATURE_EVENT_SOURCING')) {
      res.status(404).json({ error: 'Event sourcing not available' });
      return;
    }

    try {
      const pool = getPool();

      // AC-4.7.1: Pagination by from_sequence + limit (not offset)
      // Fetch limit+1 to determine has_more
      const result = await pool.query<{
        id: string;
        lot_id: string;
        community_id: string;
        entry_type: string;
        amount_micro: string;
        sequence_number: string;
        correlation_id: string;
        causation_id: string;
        created_at: string;
      }>(
        `SELECT id, lot_id, community_id, entry_type,
                amount_micro::text, sequence_number::text,
                correlation_id, causation_id, created_at
         FROM lot_entries
         WHERE community_id = $1
           AND sequence_number IS NOT NULL
           AND sequence_number >= $2
         ORDER BY sequence_number ASC
         LIMIT $3`,
        [communityId, from_sequence.toString(), limit + 1],
      );

      // AC-4.7.2: has_more based on existence of higher sequences
      const hasMore = result.rows.length > limit;
      const events = hasMore ? result.rows.slice(0, limit) : result.rows;

      const nextSequence = events.length > 0
        ? BigInt(events[events.length - 1].sequence_number) + 1n
        : null;

      res.json({
        community_id: communityId,
        events: events.map((row) => ({
          id: row.id,
          lot_id: row.lot_id,
          entry_type: row.entry_type,
          amount_micro: row.amount_micro,
          sequence_number: row.sequence_number,
          correlation_id: row.correlation_id,
          causation_id: row.causation_id,
          created_at: row.created_at,
        })),
        pagination: {
          from_sequence,
          limit,
          has_more: hasMore,
          next_sequence: nextSequence !== null ? nextSequence.toString() : null,
          count: events.length,
        },
      });
    } catch (err) {
      logger.error(
        { event: 'events.list.error', communityId, err },
        'Failed to retrieve events',
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// POST /communities/:communityId/events/verify (AC-4.7.3, AC-4.7.4)
// =============================================================================

eventsRouter.post(
  '/communities/:communityId/events/verify',
  requireAuth,
  requireVerifyRole,
  requireCommunityMatch,
  async (req: AuthenticatedRequest, res: Response) => {
    const paramsParsed = communityIdSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: paramsParsed.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { communityId } = paramsParsed.data;

    if (!isFeatureEnabled('FEATURE_EVENT_SOURCING')) {
      res.status(404).json({ error: 'Event sourcing not available' });
      return;
    }

    // AC-4.7.4: Rate limit — max 1 per community per 5 minutes
    const lastVerify = verifyCooldowns.get(communityId);
    if (lastVerify && Date.now() - lastVerify < VERIFY_COOLDOWN_MS) {
      const remainingMs = VERIFY_COOLDOWN_MS - (Date.now() - lastVerify);
      const remainingSec = Math.ceil(remainingMs / 1000);
      res.status(429).json({
        error: 'Verification rate limit exceeded',
        retry_after_seconds: remainingSec,
      });
      return;
    }

    try {
      // Record the verification request timestamp
      verifyCooldowns.set(communityId, Date.now());

      // AC-4.7.3: Dispatch async job — return job ID for polling
      // Generate a job ID and start the verification asynchronously
      const jobId = `verify-${communityId}-${Date.now()}`;

      // Fire-and-forget: the verification runs in the background
      const pool = getPool();
      runVerificationAsync(pool, communityId, jobId).catch((err) => {
        logger.error(
          { event: 'events.verify.background_error', communityId, jobId, err },
          'Background verification failed',
        );
      });

      res.status(202).json({
        job_id: jobId,
        community_id: communityId,
        status: 'pending',
        message: 'Consistency verification dispatched. Poll for results.',
      });
    } catch (err) {
      logger.error(
        { event: 'events.verify.error', communityId, err },
        'Failed to dispatch verification',
      );
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// Background Verification (AC-4.7.3)
// =============================================================================

/**
 * Run consistency verification asynchronously.
 * Results are stored in community_verification_jobs for polling.
 */
async function runVerificationAsync(
  pool: Pool,
  communityId: string,
  jobId: string,
): Promise<void> {
  const { verifyConsistency } = await import(
    '../../../../packages/services/event-sourcing-service.js'
  );

  try {
    // Store job as pending
    await pool.query(
      `INSERT INTO community_verification_jobs (job_id, community_id, status, created_at)
       VALUES ($1, $2, 'running', NOW())
       ON CONFLICT (job_id) DO NOTHING`,
      [jobId, communityId],
    );

    const result = await verifyConsistency(pool, communityId);

    // Store completed result
    await pool.query(
      `UPDATE community_verification_jobs
       SET status = 'completed',
           result = $2,
           completed_at = NOW()
       WHERE job_id = $1`,
      [jobId, JSON.stringify({
        lots_checked: result.lotsChecked,
        lots_consistent: result.lotsConsistent,
        lots_drifted: result.lotsDrifted,
        total_drift_micro: result.totalDriftMicro.toString(),
        drifts: result.drifts.map((d: { lotId: string; replayedRemaining: bigint; actualRemaining: bigint; driftMicro: bigint }) => ({
          lot_id: d.lotId,
          replayed_remaining: d.replayedRemaining.toString(),
          actual_remaining: d.actualRemaining.toString(),
          drift_micro: d.driftMicro.toString(),
        })),
      })],
    );

    logger.info(
      { event: 'events.verify.complete', communityId, jobId, lotsDrifted: result.lotsDrifted },
      'Verification completed',
    );
  } catch (err) {
    // Store failed result
    await pool.query(
      `UPDATE community_verification_jobs
       SET status = 'failed',
           result = $2,
           completed_at = NOW()
       WHERE job_id = $1`,
      [jobId, JSON.stringify({ error: err instanceof Error ? err.message : String(err) })],
    ).catch(() => { /* best-effort */ });

    throw err;
  }
}
