/**
 * Constitutional Governance Admin Routes
 *
 * Admin endpoints for constitutional parameter governance:
 *   POST   /admin/config/propose         — propose parameter change
 *   POST   /admin/config/:id/submit      — submit draft for review
 *   POST   /admin/config/:id/approve     — approve pending proposal
 *   POST   /admin/config/:id/reject      — reject proposal
 *   POST   /admin/config/:id/emergency   — emergency override (3+ admins)
 *   GET    /admin/config                 — list active configuration
 *   GET    /admin/config/pending         — list pending proposals
 *   GET    /admin/config/:key/history    — parameter history
 *
 * SDD refs: §5.1 Constitutional Governance Endpoints
 * Sprint refs: Sprint 276, Task 2.5
 *
 * @module api/routes/config-admin-routes
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { logger } from '../../utils/logger.js';
import { requireAdminAuth } from './billing-admin-routes.js';
import type { IConstitutionalGovernanceService } from '../../packages/core/ports/IConstitutionalGovernanceService.js';
import type { EntityType } from '../../packages/core/protocol/billing-types.js';

// =============================================================================
// Router Setup
// =============================================================================

export const configAdminRouter = Router();

let governanceService: IConstitutionalGovernanceService | null = null;

export function setConfigAdminServices(services: {
  governance: IConstitutionalGovernanceService;
}): void {
  governanceService = services.governance;
}

// =============================================================================
// Validation Schemas
// =============================================================================

const proposeSchema = z.object({
  paramKey: z.string().min(1).max(128),
  value: z.union([z.number(), z.string()]),
  entityType: z.string().max(32).optional(),
  justification: z.string().max(1024).optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(1).max(1024),
});

const emergencySchema = z.object({
  approvers: z.array(z.string().min(1)).min(3),
  justification: z.string().min(1).max(2048),
});

// =============================================================================
// Rate Limiters
// =============================================================================

const proposeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req: Request) => (req as any).adminId ?? req.ip ?? 'unknown',
  handler: (_req, res) => { res.status(429).json({ error: 'Too Many Requests — max 10 proposals/hour' }); },
});

const approveRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator: (req: Request) => (req as any).adminId ?? req.ip ?? 'unknown',
  handler: (_req, res) => { res.status(429).json({ error: 'Too Many Requests — max 50 approvals/hour' }); },
});

const emergencyRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req: Request) => (req as any).adminId ?? req.ip ?? 'unknown',
  handler: (_req, res) => { res.status(429).json({ error: 'Too Many Requests — max 3 emergencies/day' }); },
});

// =============================================================================
// Error Handler
// =============================================================================

function handleError(err: unknown, res: Response): void {
  const msg = (err as Error).message;
  const name = (err as Error).name;

  if (name === 'FourEyesViolationError') {
    res.status(409).json({ error: 'four_eyes_violation', message: msg });
  } else if (name === 'SchemaValidationError') {
    res.status(400).json({ error: 'schema_validation', message: msg });
  } else if (name === 'InvalidStateError') {
    res.status(409).json({ error: 'invalid_state', message: msg });
  } else if (msg.includes('not found')) {
    res.status(404).json({ error: 'Not found', message: msg });
  } else {
    logger.error({ event: 'config.admin.error', err }, msg);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function ensureService(res: Response): governanceService is IConstitutionalGovernanceService {
  if (!governanceService) {
    res.status(503).json({ error: 'Governance service not initialized' });
    return false;
  }
  return true;
}

// =============================================================================
// Routes
// =============================================================================

// POST /admin/config/propose
configAdminRouter.post(
  '/propose',
  requireAdminAuth,
  proposeRateLimiter,
  async (req: Request, res: Response) => {
    if (!ensureService(res)) return;

    const parsed = proposeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
      });
      return;
    }

    try {
      const config = await governanceService!.propose(parsed.data.paramKey, parsed.data.value, {
        entityType: (parsed.data.entityType as EntityType) ?? undefined,
        proposerAdminId: (req as any).adminId,
        justification: parsed.data.justification,
      });
      res.status(201).json(config);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /admin/config/:id/submit
configAdminRouter.post(
  '/:id/submit',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    if (!ensureService(res)) return;

    try {
      const config = await governanceService!.submit(req.params.id, (req as any).adminId);
      res.json(config);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /admin/config/:id/approve
configAdminRouter.post(
  '/:id/approve',
  requireAdminAuth,
  approveRateLimiter,
  async (req: Request, res: Response) => {
    if (!ensureService(res)) return;

    try {
      const config = await governanceService!.approve(req.params.id, (req as any).adminId);
      res.json(config);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /admin/config/:id/reject
configAdminRouter.post(
  '/:id/reject',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    if (!ensureService(res)) return;

    const parsed = rejectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation Error', details: parsed.error.issues });
      return;
    }

    try {
      const config = await governanceService!.reject(req.params.id, (req as any).adminId, parsed.data.reason);
      res.json(config);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// POST /admin/config/:id/emergency
configAdminRouter.post(
  '/:id/emergency',
  requireAdminAuth,
  emergencyRateLimiter,
  async (req: Request, res: Response) => {
    if (!ensureService(res)) return;

    const parsed = emergencySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation Error', details: parsed.error.issues });
      return;
    }

    try {
      const config = await governanceService!.emergencyOverride(
        req.params.id,
        parsed.data.approvers,
        parsed.data.justification,
      );
      res.json(config);
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /admin/config
configAdminRouter.get(
  '/',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    if (!ensureService(res)) return;

    try {
      const pending = await governanceService!.getPendingProposals();
      res.json({ configs: pending });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /admin/config/pending
configAdminRouter.get(
  '/pending',
  requireAdminAuth,
  async (_req: Request, res: Response) => {
    if (!ensureService(res)) return;

    try {
      const pending = await governanceService!.getPendingProposals();
      res.json({ proposals: pending });
    } catch (err) {
      handleError(err, res);
    }
  },
);

// GET /admin/config/:key/history
configAdminRouter.get(
  '/:key/history',
  requireAdminAuth,
  async (req: Request, res: Response) => {
    if (!ensureService(res)) return;

    try {
      const history = await governanceService!.getConfigHistory(req.params.key);
      res.json({ history });
    } catch (err) {
      handleError(err, res);
    }
  },
);
