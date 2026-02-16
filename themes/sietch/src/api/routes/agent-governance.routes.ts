/**
 * Agent Governance Routes — Proposal, Voting & Weight API
 *
 * POST /api/agent/governance/propose        — Submit governance proposal (agent JWT)
 * POST /api/agent/governance/vote/:proposalId — Cast vote on proposal (agent JWT)
 * GET  /api/agent/governance/proposals       — List active proposals (agent JWT)
 * GET  /api/agent/governance/weight/:accountId — Get agent weight (agent JWT)
 *
 * SDD refs: §5.3 Governance API
 * PRD refs: FR-3.1 through FR-3.8
 * Sprint refs: Sprint 289 Task 6.5
 *
 * @module api/routes/agent-governance.routes
 */

import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import type { IAgentGovernanceService } from '../../packages/core/ports/IAgentGovernanceService.js';

// =============================================================================
// Router Setup
// =============================================================================

export const agentGovernanceRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let governanceService: IAgentGovernanceService | null = null;

export function setAgentGovernanceService(service: IAgentGovernanceService): void {
  governanceService = service;
}

function getService(): IAgentGovernanceService {
  if (!governanceService) {
    throw Object.assign(
      new Error('Agent governance service not initialized'),
      { statusCode: 503 },
    );
  }
  return governanceService;
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /agent/governance/propose — Submit a governance proposal
 *
 * JWT auth. Caller proposes a parameter change.
 * Body: { paramKey, value, entityType?, justification? }
 *
 * Responses:
 *   201 — Proposal created
 *   400 — Validation error (not in whitelist, invalid value)
 *   403 — Not an agent account
 *   409 — Active proposal already exists for this param
 */
agentGovernanceRouter.post(
  '/propose',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const accountId = req.caller!.userId;

    const { paramKey, value, entityType, justification } = req.body;

    // Input validation
    if (!paramKey || typeof paramKey !== 'string') {
      res.status(400).json({ error: 'paramKey is required and must be a string' });
      return;
    }
    if (paramKey.length > 128) {
      res.status(400).json({ error: 'paramKey must be 128 characters or fewer' });
      return;
    }
    // Defense-in-depth: block sensitive prefixes at route level (service also enforces)
    const BLOCKED_PREFIXES = ['kyc.', 'payout.', 'fraud_rule.', 'settlement.'];
    if (BLOCKED_PREFIXES.some(p => paramKey.startsWith(p))) {
      res.status(400).json({ error: `Parameter '${paramKey}' is not proposable by agents` });
      return;
    }
    if (value === undefined || value === null) {
      res.status(400).json({ error: 'value is required' });
      return;
    }
    if (entityType !== undefined && entityType !== null && typeof entityType !== 'string') {
      res.status(400).json({ error: 'entityType must be a string or null' });
      return;
    }
    if (justification !== undefined && typeof justification !== 'string') {
      res.status(400).json({ error: 'justification must be a string' });
      return;
    }
    if (justification && justification.length > 1024) {
      res.status(400).json({ error: 'justification must be 1024 characters or fewer' });
      return;
    }

    try {
      const proposal = await service.proposeAsAgent(accountId, {
        paramKey,
        value,
        entityType: entityType ?? null,
        justification,
      });

      res.status(201).json({ proposal });
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err.code === 'FORBIDDEN') {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.code === 'CONFLICT') {
        res.status(409).json({ error: err.message });
        return;
      }

      logger.error({ err, accountId, paramKey }, 'Governance proposal failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * POST /agent/governance/vote/:proposalId — Cast a vote on a proposal
 *
 * JWT auth. Caller votes on an existing proposal.
 * Body: { vote: 'support' | 'oppose' }
 *
 * Responses:
 *   200 — Vote recorded
 *   400 — Invalid vote value
 *   403 — Not an agent account
 *   404 — Proposal not found
 *   409 — Already voted or proposal not open
 */
agentGovernanceRouter.post(
  '/vote/:proposalId',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const accountId = req.caller!.userId;
    const { proposalId } = req.params;

    // Validate proposalId format (UUID)
    if (!proposalId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposalId)) {
      res.status(400).json({ error: 'proposalId must be a valid UUID' });
      return;
    }

    const { vote } = req.body;

    if (vote !== 'support' && vote !== 'oppose') {
      res.status(400).json({ error: "vote must be 'support' or 'oppose'" });
      return;
    }

    try {
      const proposal = await service.voteAsAgent(accountId, proposalId, { vote });

      res.status(200).json({ proposal });
    } catch (err: any) {
      if (err.code === 'FORBIDDEN') {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err.code === 'NOT_FOUND') {
        res.status(404).json({ error: err.message });
        return;
      }
      if (err.code === 'CONFLICT') {
        res.status(409).json({ error: err.message });
        return;
      }

      logger.error({ err, accountId, proposalId }, 'Governance vote failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /agent/governance/proposals — List active proposals
 *
 * JWT auth. Returns open and quorum_reached proposals.
 * Query params: limit (default 20, max 100), offset (default 0)
 *
 * Responses:
 *   200 — { proposals: AgentGovernanceProposal[] }
 */
agentGovernanceRouter.get(
  '/proposals',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();

    const limitRaw = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
    const offsetRaw = parseInt(req.query.offset as string, 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const ALLOWED_STATUSES = new Set(['open', 'quorum_reached']);
    if (status && !ALLOWED_STATUSES.has(status)) {
      res.status(400).json({ error: 'status must be one of: open, quorum_reached' });
      return;
    }

    try {
      const proposals = await service.getActiveProposals({ limit, offset });
      const filtered = status ? proposals.filter(p => p.status === status) : proposals;

      res.status(200).json({ proposals: filtered });
    } catch (err: any) {
      logger.error({ err }, 'List governance proposals failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /agent/governance/weight/:accountId — Get agent governance weight
 *
 * JWT auth. Returns computed weight and breakdown for an agent.
 *
 * Responses:
 *   200 — { weight: AgentGovernanceWeightResult }
 *   400 — Invalid accountId
 */
agentGovernanceRouter.get(
  '/weight/:accountId',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const { accountId } = req.params;

    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'accountId is required' });
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) {
      res.status(400).json({ error: 'accountId must be a valid UUID' });
      return;
    }

    try {
      const weight = await service.computeAgentWeight(accountId);

      res.status(200).json({ weight });
    } catch (err: any) {
      logger.error({ err, accountId }, 'Compute governance weight failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
