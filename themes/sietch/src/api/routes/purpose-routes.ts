/**
 * Purpose Breakdown Routes — Economic Memory API (F-1)
 *
 * GET /admin/billing/purpose-breakdown
 *   Query: communityId (required), from (ISO date), to (ISO date)
 *   Auth: Admin JWT
 *   Returns: Purpose breakdown by day with spend totals
 *
 * GET /admin/billing/purpose-unclassified-rate
 *   Query: communityId (required), windowHours (default: 24)
 *   Auth: Admin JWT
 *   Returns: Unclassified rate for observability
 *
 * @see SDD §4.4 Economic Memory
 * @see Sprint 2, Task 2.4
 * @module api/routes/purpose-routes
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import { getPurposeBreakdown, getUnclassifiedRate } from '../../../../packages/services/purpose-service.js';
import { serializeBigInt } from '../../packages/core/protocol/arrakis-arithmetic.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Router Setup
// =============================================================================

export const purposeRouter = Router();

// =============================================================================
// Provider Initialization
// =============================================================================

let pgPool: Pool | null = null;

export function setPurposePool(pool: Pool): void {
  pgPool = pool;
}

function getPool(): Pool {
  if (!pgPool) throw new Error('Purpose routes: PostgreSQL pool not initialized');
  return pgPool;
}

// =============================================================================
// Schemas
// =============================================================================

const breakdownSchema = z.object({
  communityId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const unclassifiedRateSchema = z.object({
  communityId: z.string().uuid(),
  windowHours: z.coerce.number().int().min(1).max(720).default(24),
});

// =============================================================================
// GET /purpose-breakdown (AC-2.4.1)
// =============================================================================

purposeRouter.get(
  '/purpose-breakdown',
  async (req: Request, res: Response) => {
    const parsed = breakdownSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { communityId, from, to } = parsed.data;

    try {
      const rows = await getPurposeBreakdown(getPool(), communityId, from, to);

      res.json(serializeBigInt({
        communityId,
        from: from ?? null,
        to: to ?? null,
        breakdown: rows.map(r => ({
          purpose: r.purpose,
          day: r.day,
          totalMicro: r.totalMicro,
          entryCount: r.entryCount,
        })),
      }));
    } catch (err) {
      logger.error({ event: 'purpose.breakdown.error', communityId, err },
        'Purpose breakdown query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /purpose-unclassified-rate (AC-2.2.3)
// =============================================================================

purposeRouter.get(
  '/purpose-unclassified-rate',
  async (req: Request, res: Response) => {
    const parsed = unclassifiedRateSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { communityId, windowHours } = parsed.data;

    try {
      const result = await getUnclassifiedRate(getPool(), communityId, windowHours);

      res.json(serializeBigInt({
        communityId,
        windowHours,
        totalEntries: result.totalEntries,
        unclassifiedEntries: result.unclassifiedEntries,
        rate: result.rate,
      }));
    } catch (err) {
      logger.error({ event: 'purpose.unclassified_rate.error', communityId, err },
        'Unclassified rate query failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
