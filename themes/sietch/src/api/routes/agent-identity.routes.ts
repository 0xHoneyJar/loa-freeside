/**
 * Agent Identity & Provenance Routes
 *
 * API endpoints for agent registration, identity lookup, and provenance verification.
 * These are billing-side endpoints (not agent gateway endpoints).
 *
 * SDD refs: §SS5.2
 * Sprint refs: Task 7.4
 *
 * @module api/routes/agent-identity.routes
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { IAgentProvenanceVerifier } from '../../packages/core/ports/IAgentProvenanceVerifier.js';

// =============================================================================
// Types
// =============================================================================

export interface AgentIdentityRoutesDeps {
  provenance: IAgentProvenanceVerifier;
  requireAuth?: (req: Request, res: Response, next: () => void) => void;
}

// =============================================================================
// Routes
// =============================================================================

export function createAgentIdentityRoutes(deps: AgentIdentityRoutesDeps): Router {
  const router = Router();

  /**
   * POST /api/agent/register
   * Register an agent's on-chain identity and link to creator.
   */
  router.post('/register', async (req: Request, res: Response) => {
    try {
      const { agentAccountId, creatorAccountId, chainId, contractAddress, tokenId, creatorSignature } = req.body;

      // Validate required fields
      if (!agentAccountId || !creatorAccountId || chainId == null || !contractAddress || !tokenId) {
        res.status(400).json({
          error: 'Missing required fields',
          required: ['agentAccountId', 'creatorAccountId', 'chainId', 'contractAddress', 'tokenId'],
        });
        return;
      }

      if (typeof chainId !== 'number' || chainId <= 0) {
        res.status(400).json({ error: 'chainId must be a positive integer' });
        return;
      }

      const identity = await deps.provenance.registerAgent({
        agentAccountId,
        creatorAccountId,
        chainId,
        contractAddress,
        tokenId,
        creatorSignature,
      });

      res.status(201).json(identity);
    } catch (err: any) {
      if (err.statusCode === 409) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err.statusCode === 404) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agent/:id/provenance
   * Verify an agent's provenance chain. Returns creator KYC level.
   */
  router.get('/:id/provenance', async (req: Request, res: Response) => {
    try {
      const result = await deps.provenance.verifyProvenance(req.params.id);
      res.json(result);
    } catch (err: any) {
      if (err.statusCode === 404) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agent/:id/identity
   * Get full agent identity record including on-chain anchor.
   */
  router.get('/:id/identity', async (req: Request, res: Response) => {
    try {
      const result = await deps.provenance.verifyProvenance(req.params.id);
      res.json(result);
    } catch (err: any) {
      if (err.statusCode === 404) {
        res.status(404).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
