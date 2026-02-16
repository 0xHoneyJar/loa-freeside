/**
 * Peer Transfer API Routes
 *
 * POST /api/transfers         — Execute a peer-to-peer credit transfer
 * GET  /api/transfers/:id     — Get transfer by ID
 * GET  /api/transfers         — List transfers for an account
 *
 * SDD refs: §5.1 Transfer API
 * PRD refs: FR-1.1, FR-1.2, FR-1.9
 * Sprint refs: Sprint 286, Task 3.5
 *
 * @module api/routes/transfer.routes
 */

import { Router, type Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import type { IPeerTransferService, TransferDirection } from '../../packages/core/ports/IPeerTransferService.js';

// =============================================================================
// Router Setup
// =============================================================================

export const transferRouter = Router();

// =============================================================================
// Service Injection
// =============================================================================

let transferService: IPeerTransferService | null = null;

export function setTransferService(service: IPeerTransferService): void {
  transferService = service;
}

function getService(): IPeerTransferService {
  if (!transferService) {
    throw Object.assign(
      new Error('Transfer service not initialized'),
      { statusCode: 503 },
    );
  }
  return transferService;
}

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /transfers — Execute a peer-to-peer credit transfer
 *
 * JWT claim account_id must match fromAccountId (enforced here).
 * Body: { fromAccountId, toAccountId, amountMicro, idempotencyKey, metadata?, correlationId? }
 *
 * Responses:
 *   200 — Transfer completed or idempotent replay
 *   400 — Invalid input
 *   402 — Budget exceeded
 *   403 — Provenance failed or unauthorized
 *   409 — Governance limit exceeded
 */
transferRouter.post(
  '/',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const callerId = req.caller!.userId;

    // Input validation
    const { fromAccountId, toAccountId, amountMicro, idempotencyKey, metadata, correlationId } = req.body;

    if (!fromAccountId || typeof fromAccountId !== 'string') {
      res.status(400).json({ error: 'fromAccountId is required and must be a string' });
      return;
    }
    if (!toAccountId || typeof toAccountId !== 'string') {
      res.status(400).json({ error: 'toAccountId is required and must be a string' });
      return;
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      res.status(400).json({ error: 'idempotencyKey is required and must be a string' });
      return;
    }

    // amountMicro: accept number or string, convert to bigint
    let amount: bigint;
    try {
      amount = BigInt(amountMicro);
      if (amount <= 0n) {
        res.status(400).json({ error: 'amountMicro must be positive' });
        return;
      }
    } catch {
      res.status(400).json({ error: 'amountMicro must be a valid integer' });
      return;
    }

    // Authorization: caller must be the sender
    if (callerId !== fromAccountId) {
      res.status(403).json({ error: 'Caller account_id does not match fromAccountId' });
      return;
    }

    try {
      const result = await service.transfer(fromAccountId, toAccountId, amount, {
        idempotencyKey,
        metadata: metadata ?? undefined,
        correlationId: correlationId ?? undefined,
      });

      // Map rejection reasons to HTTP status codes
      if (result.status === 'rejected') {
        const statusCode = rejectionToStatusCode(result.rejectionReason);
        res.status(statusCode).json({ transfer: serializeResult(result) });
        return;
      }

      res.status(200).json({ transfer: serializeResult(result) });
    } catch (err) {
      logger.error({ err, fromAccountId, toAccountId }, 'Transfer request failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /transfers/:id — Get transfer by ID
 *
 * JWT claim must match sender or recipient.
 */
transferRouter.get(
  '/:id',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const callerId = req.caller!.userId;
    const transferId = req.params.id;

    try {
      const result = await service.getTransfer(transferId);

      if (!result) {
        res.status(404).json({ error: 'Transfer not found' });
        return;
      }

      // Authorization: caller must be sender or recipient
      if (callerId !== result.fromAccountId && callerId !== result.toAccountId) {
        res.status(403).json({ error: 'Not authorized to view this transfer' });
        return;
      }

      res.status(200).json({ transfer: serializeResult(result) });
    } catch (err) {
      logger.error({ err, transferId }, 'Transfer lookup failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /transfers — List transfers for an account
 *
 * Query params: accountId, direction (sent|received|all), limit, offset
 * JWT claim must match accountId.
 */
transferRouter.get(
  '/',
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const service = getService();
    const callerId = req.caller!.userId;

    const accountId = req.query.accountId as string | undefined;
    if (!accountId) {
      res.status(400).json({ error: 'accountId query parameter is required' });
      return;
    }

    // Authorization: caller must match queried account
    if (callerId !== accountId) {
      res.status(403).json({ error: 'Caller account_id does not match accountId' });
      return;
    }

    const direction = (req.query.direction as string) ?? 'all';
    if (!['sent', 'received', 'all'].includes(direction)) {
      res.status(400).json({ error: 'direction must be sent, received, or all' });
      return;
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit < 1)) {
      res.status(400).json({ error: 'limit must be a positive integer' });
      return;
    }
    if (offset !== undefined && (isNaN(offset) || offset < 0)) {
      res.status(400).json({ error: 'offset must be a non-negative integer' });
      return;
    }

    try {
      const transfers = await service.listTransfers(accountId, {
        direction: direction as TransferDirection,
        limit,
        offset,
      });

      res.status(200).json({
        transfers: transfers.map(serializeResult),
        total: transfers.length,
      });
    } catch (err) {
      logger.error({ err, accountId }, 'Transfer listing failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// =============================================================================
// Internal: Serialization
// =============================================================================

/**
 * Serialize a TransferResult for JSON response.
 * BigInt → string conversion (JSON.stringify cannot handle BigInt).
 */
function serializeResult(result: { transferId: string; fromAccountId: string; toAccountId: string; amountMicro: bigint; status: string; rejectionReason?: string; correlationId: string | null; completedAt: string | null }) {
  return {
    transferId: result.transferId,
    fromAccountId: result.fromAccountId,
    toAccountId: result.toAccountId,
    amountMicro: result.amountMicro.toString(),
    status: result.status,
    rejectionReason: result.rejectionReason ?? null,
    correlationId: result.correlationId,
    completedAt: result.completedAt,
  };
}

/**
 * Map rejection reasons to HTTP status codes per SDD §5.1.
 */
function rejectionToStatusCode(reason?: string): number {
  switch (reason) {
    case 'budget_exceeded':
      return 402; // Payment Required
    case 'provenance_failed':
      return 403; // Forbidden
    case 'governance_limit_exceeded':
    case 'governance_limit_exceeded: max_single_micro':
    case 'governance_limit_exceeded: daily_limit_micro':
      return 409; // Conflict (governance constraint)
    case 'insufficient_balance':
      return 402; // Payment Required
    case 'self_transfer':
      return 400; // Bad Request
    default:
      return 400;
  }
}
