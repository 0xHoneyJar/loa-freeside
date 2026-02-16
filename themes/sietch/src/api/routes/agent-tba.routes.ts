/**
 * Agent TBA Routes — Binding + Deposit Bridge API
 *
 * POST /api/agent/tba/bind     — Bind TBA to agent identity (user JWT)
 * POST /api/agent/tba/bridge   — Bridge on-chain deposit (service JWT)
 * GET  /api/agent/tba/deposits  — List deposits for agent (user JWT)
 *
 * SDD refs: §5.2 TBA API
 * PRD refs: FR-2.1, FR-2.3, FR-2.4, FR-2.5
 * Sprint refs: Sprint 287 Task 4.3, Sprint 288 Task 5.4
 *
 * @module api/routes/agent-tba.routes
 */

import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import type { IAgentProvenanceVerifier } from '../../packages/core/ports/IAgentProvenanceVerifier.js';
import type { ITbaDepositBridge, DepositDetection } from '../../packages/core/ports/ITbaDepositBridge.js';

// =============================================================================
// Router Setup
// =============================================================================

export const agentTbaRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let provenanceVerifier: IAgentProvenanceVerifier | null = null;
let depositBridge: ITbaDepositBridge | null = null;

export function setProvenanceVerifier(service: IAgentProvenanceVerifier): void {
  provenanceVerifier = service;
}

export function setDepositBridge(service: ITbaDepositBridge): void {
  depositBridge = service;
}

function getService(): IAgentProvenanceVerifier {
  if (!provenanceVerifier) {
    throw Object.assign(
      new Error('Provenance service not initialized'),
      { statusCode: 503 },
    );
  }
  return provenanceVerifier;
}

function getBridge(): ITbaDepositBridge {
  if (!depositBridge) {
    throw Object.assign(
      new Error('Deposit bridge not initialized'),
      { statusCode: 503 },
    );
  }
  return depositBridge;
}

// =============================================================================
// Internal Service Auth (S2S JWT for bridge endpoint)
// =============================================================================

function requireServiceAuth(req: Request, res: Response, next: Function): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const secret = process.env.BILLING_INTERNAL_JWT_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Service auth not configured' });
    return;
  }

  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as { sub?: string };
    (req as any).internalServiceId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired service token' });
  }
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /agent/tba/bind — Bind TBA to agent identity
 *
 * JWT claim must match agent accountId or creator accountId.
 * Body: { accountId, tbaAddress }
 *
 * Responses:
 *   200 — TBA bound (or idempotent replay of same address)
 *   400 — Invalid address format
 *   404 — No agent identity found
 *   409 — Already bound to a different address
 */
agentTbaRouter.post(
  '/bind',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const callerId = req.caller!.userId;

    const { accountId, tbaAddress } = req.body;

    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'accountId is required' });
      return;
    }
    if (!tbaAddress || typeof tbaAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(tbaAddress)) {
      res.status(400).json({ error: 'tbaAddress must be a valid 20-byte address' });
      return;
    }

    // Authorization: caller must be the agent or its creator
    // First check direct match, then check creator relationship
    if (callerId !== accountId) {
      try {
        const creator = await service.getCreator(accountId);
        if (creator.id !== callerId) {
          res.status(403).json({ error: 'Not authorized to bind TBA for this agent' });
          return;
        }
      } catch (err: any) {
        if (err.code === 'NOT_FOUND') {
          res.status(404).json({ error: 'Agent identity not found' });
          return;
        }
        throw err;
      }
    }

    try {
      const identity = await service.bindTBA(accountId, tbaAddress);

      res.status(200).json({
        identity: {
          id: identity.id,
          accountId: identity.accountId,
          chainId: identity.chainId,
          contractAddress: identity.contractAddress,
          tokenId: identity.tokenId,
          tbaAddress: identity.tbaAddress,
          creatorAccountId: identity.creatorAccountId,
          verifiedAt: identity.verifiedAt,
          createdAt: identity.createdAt,
        },
      });
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') {
        res.status(400).json({ error: err.message });
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

      logger.error({ err, accountId }, 'TBA binding failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// =============================================================================
// Deposit Bridge Routes (Sprint 288, Task 5.4)
// =============================================================================

/**
 * POST /agent/tba/bridge — Bridge on-chain deposit to credit lot
 *
 * Service-to-service endpoint (chain watcher → arrakis).
 * Requires BILLING_INTERNAL_JWT_SECRET auth.
 * Body: DepositDetection
 *
 * Responses:
 *   200 — Deposit bridged (or idempotent replay)
 *   400 — Invalid detection data
 *   503 — Bridge service not initialized
 */
agentTbaRouter.post(
  '/bridge',
  requireServiceAuth,
  async (req: Request, res: Response) => {
    const bridge = getBridge();

    const { chainId, txHash, tokenAddress, amountRaw, fromAddress, toAddress, blockNumber, logIndex } = req.body;

    // Input validation
    if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) {
      res.status(400).json({ error: 'chainId must be a positive integer' });
      return;
    }
    if (!txHash || typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      res.status(400).json({ error: 'txHash must be 0x-prefixed 32-byte hex string' });
      return;
    }
    if (!tokenAddress || typeof tokenAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
      res.status(400).json({ error: 'tokenAddress must be a valid 20-byte address' });
      return;
    }
    if (!amountRaw || typeof amountRaw !== 'string' || !/^[0-9]+$/.test(amountRaw)) {
      res.status(400).json({ error: 'amountRaw must be a numeric string' });
      return;
    }
    if (!fromAddress || typeof fromAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(fromAddress)) {
      res.status(400).json({ error: 'fromAddress must be a valid 20-byte address' });
      return;
    }
    if (!toAddress || typeof toAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
      res.status(400).json({ error: 'toAddress must be a valid 20-byte address' });
      return;
    }
    if (typeof blockNumber !== 'number' || !Number.isInteger(blockNumber) || blockNumber < 0) {
      res.status(400).json({ error: 'blockNumber must be a non-negative integer' });
      return;
    }
    if (typeof logIndex !== 'number' || !Number.isInteger(logIndex) || logIndex < 0) {
      res.status(400).json({ error: 'logIndex must be a non-negative integer' });
      return;
    }

    const detection: DepositDetection = {
      chainId,
      txHash,
      tokenAddress,
      amountRaw,
      fromAddress,
      toAddress,
      blockNumber,
      logIndex,
    };

    try {
      const result = await bridge.detectAndBridge(detection);

      // Serialize BigInt for JSON response
      res.status(200).json({
        deposit: {
          ...result,
          amountMicro: result.amountMicro.toString(),
        },
      });
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') {
        res.status(400).json({ error: err.message });
        return;
      }

      logger.error({ err, txHash }, 'TBA deposit bridge failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /agent/tba/deposits — List deposits for an agent account
 *
 * JWT auth. Caller must match the requested accountId.
 * Query params: accountId (required), limit, offset
 *
 * Responses:
 *   200 — { deposits: TbaDeposit[] }
 *   400 — Missing accountId
 *   403 — Not authorized
 */
agentTbaRouter.get(
  '/deposits',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const bridge = getBridge();
    const callerId = req.caller!.userId;

    const accountId = req.query.accountId;
    if (!accountId || typeof accountId !== 'string') {
      res.status(400).json({ error: 'accountId query parameter is required' });
      return;
    }

    // Authorization: caller must be the agent or its creator
    if (callerId !== accountId) {
      try {
        const service = getService();
        const creator = await service.getCreator(accountId);
        if (creator.id !== callerId) {
          res.status(403).json({ error: 'Not authorized to view deposits for this agent' });
          return;
        }
      } catch (err: any) {
        if (err.code === 'NOT_FOUND') {
          res.status(403).json({ error: 'Not authorized to view deposits for this agent' });
          return;
        }
        throw err;
      }
    }

    const limitRaw = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
    const offsetRaw = parseInt(req.query.offset as string, 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    try {
      const deposits = await bridge.listDeposits(accountId, { limit, offset });

      // Serialize BigInt fields for JSON
      res.status(200).json({
        deposits: deposits.map(d => ({
          ...d,
          amountMicro: d.amountMicro.toString(),
        })),
      });
    } catch (err: any) {
      logger.error({ err, accountId }, 'List TBA deposits failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
