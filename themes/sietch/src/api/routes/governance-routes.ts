/**
 * Governance API Routes — Policy Lifecycle Endpoints
 *
 * REST endpoints for the governance policy lifecycle:
 *   POST /communities/:communityId/governance/proposals
 *   POST /communities/:communityId/governance/proposals/:policyId/approve
 *   POST /communities/:communityId/governance/proposals/:policyId/reject
 *   GET  /communities/:communityId/governance/policies
 *
 * @see SDD §3.5 API Endpoints
 * @see Sprint 5, Task 5.8 (AC-5.8.1 through AC-5.8.6)
 * @module themes/sietch/src/api/routes/governance-routes
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface Actor {
  id: string;
  role: 'member' | 'operator' | 'admin' | 'agent';
  community_id: string;
}

interface GovernanceServicePort {
  propose(communityId: string, actor: Actor, proposal: {
    policy_type: string;
    policy_value: { limit_micro: string };
    proposal_reason?: string;
    approval_method: string;
  }): Promise<Record<string, unknown>>;

  approve(communityId: string, actor: Actor, policyId: string): Promise<Record<string, unknown>>;

  reject(communityId: string, actor: Actor, policyId: string, reason: string): Promise<Record<string, unknown>>;

  listPolicies(communityId: string, options?: {
    policy_type?: string;
    include_history?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<Record<string, unknown>[]>;
}

interface RateLimiterPort {
  checkRateLimit(actor: Actor): Promise<{
    allowed: boolean;
    retryAfterSeconds?: number;
    reason?: string;
  }>;
}

// --------------------------------------------------------------------------
// Validation Schemas — AC-5.8.1
// --------------------------------------------------------------------------

const ProposalSchema = z.object({
  policy_type: z.enum(['budget_limit']),
  policy_value: z.object({
    limit_micro: z.string().regex(/^\d+$/, 'limit_micro must be a non-negative integer string'),
  }),
  proposal_reason: z.string().max(500).optional(),
  approval_method: z.enum(['admin', 'conviction']),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

const ListPoliciesSchema = z.object({
  policy_type: z.enum(['budget_limit']).optional(),
  include_history: z.enum(['true', 'false']).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

const UuidSchema = z.string().uuid();

// --------------------------------------------------------------------------
// Setter-based DI
// --------------------------------------------------------------------------

let _governanceService: GovernanceServicePort | null = null;
let _rateLimiter: RateLimiterPort | null = null;

export function setGovernanceService(svc: GovernanceServicePort): void {
  _governanceService = svc;
}

export function setGovernanceRateLimiter(rl: RateLimiterPort): void {
  _rateLimiter = rl;
}

function getGovernanceService(): GovernanceServicePort {
  if (!_governanceService) throw new Error('GovernanceService not initialized');
  return _governanceService;
}

function getRateLimiter(): RateLimiterPort {
  if (!_rateLimiter) throw new Error('GovernanceRateLimiter not initialized');
  return _rateLimiter;
}

// --------------------------------------------------------------------------
// Middleware — AC-5.8.5
// --------------------------------------------------------------------------

/** Validate communityId is a UUID */
function validateCommunityId(req: Request, res: Response, next: NextFunction): void {
  const result = UuidSchema.safeParse(req.params.communityId);
  if (!result.success) {
    res.status(400).json({
      error: { code: 'INVALID_COMMUNITY_ID', message: 'communityId must be a valid UUID' },
    });
    return;
  }
  next();
}

/** Validate policyId is a UUID */
function validatePolicyId(req: Request, res: Response, next: NextFunction): void {
  const result = UuidSchema.safeParse(req.params.policyId);
  if (!result.success) {
    res.status(400).json({
      error: { code: 'INVALID_POLICY_ID', message: 'policyId must be a valid UUID' },
    });
    return;
  }
  next();
}

/** Role-based governance authorization with rate limiting */
function requireGovernanceRole(allowedRoles: Actor['role'][]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const actor = (req as Request & { actor?: Actor }).actor;
    if (!actor) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    if (!allowedRoles.includes(actor.role)) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: `Role '${actor.role}' cannot perform this action` },
      });
      return;
    }

    // Rate limit check
    let rlResult: { allowed: boolean; retryAfterSeconds?: number; reason?: string };
    try {
      const rateLimiter = getRateLimiter();
      rlResult = await rateLimiter.checkRateLimit(actor);
    } catch {
      res.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
      return;
    }

    if (!rlResult.allowed) {
      if (rlResult.retryAfterSeconds) {
        res.setHeader('Retry-After', String(rlResult.retryAfterSeconds));
      }
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: rlResult.reason || 'Too many requests' },
      });
      return;
    }

    next();
  };
}

/** Community match guard */
function requireCommunityMatch(req: Request, res: Response, next: NextFunction): void {
  const actor = (req as Request & { actor?: Actor }).actor;
  if (!actor) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return;
  }

  const pathCommunityId = req.params.communityId;
  if (actor.community_id !== pathCommunityId) {
    res.status(403).json({
      error: { code: 'COMMUNITY_MISMATCH', message: 'Actor community does not match requested community' },
    });
    return;
  }

  next();
}

// --------------------------------------------------------------------------
// Error handler — AC-5.8.6
// --------------------------------------------------------------------------

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof Error) {
    const code = (err as Error & { code?: string }).code;

    switch (code) {
      case 'NOT_FOUND':
        res.status(404).json({ error: { code, message: err.message } });
        return;
      case 'FORBIDDEN':
        res.status(403).json({ error: { code, message: err.message } });
        return;
      case 'VALIDATION_ERROR':
        res.status(400).json({ error: { code, message: err.message } });
        return;
      case 'STALE_VERSION':
        res.status(409).json({ error: { code, message: err.message } });
        return;
      case 'INVALID_TRANSITION':
        res.status(409).json({ error: { code, message: err.message } });
        return;
    }
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------

export const governanceRouter = Router();

// AC-5.8.1: POST /communities/:communityId/governance/proposals
governanceRouter.post(
  '/communities/:communityId/governance/proposals',
  validateCommunityId,
  requireCommunityMatch,
  requireGovernanceRole(['member', 'operator', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const parseResult = ProposalSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid proposal',
          },
        });
        return;
      }

      const actor = (req as Request & { actor: Actor }).actor;
      const service = getGovernanceService();
      const policy = await service.propose(
        req.params.communityId,
        actor,
        parseResult.data,
      );

      res.status(201).json(policy);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

// AC-5.8.2: POST /communities/:communityId/governance/proposals/:policyId/approve
governanceRouter.post(
  '/communities/:communityId/governance/proposals/:policyId/approve',
  validateCommunityId,
  validatePolicyId,
  requireCommunityMatch,
  requireGovernanceRole(['operator', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const actor = (req as Request & { actor: Actor }).actor;
      const service = getGovernanceService();
      const policy = await service.approve(
        req.params.communityId,
        actor,
        req.params.policyId,
      );

      res.status(200).json(policy);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

// AC-5.8.3: POST /communities/:communityId/governance/proposals/:policyId/reject
governanceRouter.post(
  '/communities/:communityId/governance/proposals/:policyId/reject',
  validateCommunityId,
  validatePolicyId,
  requireCommunityMatch,
  requireGovernanceRole(['operator', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const parseResult = RejectSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid rejection',
          },
        });
        return;
      }

      const actor = (req as Request & { actor: Actor }).actor;
      const service = getGovernanceService();
      const policy = await service.reject(
        req.params.communityId,
        actor,
        req.params.policyId,
        parseResult.data.reason,
      );

      res.status(200).json(policy);
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);

// AC-5.8.4: GET /communities/:communityId/governance/policies
governanceRouter.get(
  '/communities/:communityId/governance/policies',
  validateCommunityId,
  requireCommunityMatch,
  requireGovernanceRole(['member', 'operator', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const parseResult = ListPoliciesSchema.safeParse(req.query);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
          },
        });
        return;
      }

      const query = parseResult.data;
      const service = getGovernanceService();
      const policies = await service.listPolicies(req.params.communityId, {
        policy_type: query.policy_type,
        include_history: query.include_history === 'true',
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
        offset: query.offset ? parseInt(query.offset, 10) : undefined,
      });

      res.status(200).json({ policies });
    } catch (err) {
      handleServiceError(err, res);
    }
  },
);
