/**
 * x402 Routes — Conservative-Quote-Settle Micropayment Endpoints
 *
 * GET  /x402/quote                    — Price quote for agent pool
 * POST /x402/agents/:agentId/chat     — Agent chat with x402 payment
 *
 * Flow:
 *   1. Client calls GET /x402/quote → receives price_micro, nonce
 *   2. Client pays on-chain (Base USDC) with nonce binding
 *   3. Client calls POST /x402/agents/:agentId/chat with X-402-Payment header
 *   4. Server verifies proof, mints lot, runs inference, settles
 *   5. Response includes x-402-settled and x-402-credited headers
 *
 * Feature flag: FEATURE_X402_ENABLED must be true.
 *
 * @see x402-settlement.ts for settlement logic
 * @see Sprint 2, Task 2.3 (F-20)
 * @module packages/routes/x402.routes
 */

import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import {
  generateQuote,
  settle,
  verifyNonceUnique,
  type PoolCostConfig,
  type X402PaymentProof,
} from '../services/x402-settlement.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Minimal logger interface */
interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/** Dependencies injected at server init */
export interface X402RouteDeps {
  pool: Pool;
  redis: Redis;
  logger: Logger;
  featureX402Enabled: boolean;
  /** Pool cost configuration (pool_id → cost config) */
  poolCosts: Map<string, PoolCostConfig>;
  /** Facilitator address for 402 responses */
  facilitatorAddress: string;
  /** Chain ID (default: 8453 for Base) */
  chainId?: number;
  /** Mock inference handler (for testing) — returns actual cost in micro-USD */
  inferenceHandler?: (agentId: string, communityId: string, message: string) => Promise<{
    response: string;
    actualCostMicro: bigint;
    reservationId: string;
  }>;
}

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------

export function createX402Router(deps: X402RouteDeps): Router {
  const router = Router();
  const {
    pool,
    redis,
    logger,
    featureX402Enabled,
    poolCosts,
    facilitatorAddress,
    chainId = 8453,
  } = deps;

  /**
   * GET /x402/quote — Price quote for agent pool
   *
   * Query params:
   *   - pool: Pool ID (e.g., 'cheap', 'reasoning', 'architect')
   *
   * Response:
   *   - price_micro: Maximum cost in micro-USD
   *   - pool: Pool identifier
   *   - valid_for_s: Quote validity in seconds
   *   - nonce: Replay-prevention nonce (bind to payment)
   *   - facilitator: Payment details (address, chain, token)
   */
  router.get('/quote', (req: Request, res: Response) => {
    if (!featureX402Enabled) {
      res.status(503).json({ error: 'x402 payments not enabled' });
      return;
    }

    const poolId = (req.query.pool as string) || 'cheap';

    try {
      const quote = generateQuote(poolCosts, poolId);

      res.status(200).json({
        price_micro: quote.price_micro.toString(),
        pool: quote.pool,
        valid_for_s: quote.valid_for_s,
        nonce: quote.nonce,
        created_at: quote.created_at,
        facilitator: {
          address: facilitatorAddress,
          chain: 'base',
          chain_id: chainId,
          token: 'USDC',
        },
      });
    } catch (err) {
      logger.warn({ poolId, err }, 'Failed to generate x402 quote');
      res.status(400).json({
        error: 'Invalid pool',
        message: (err as Error).message,
        available_pools: Array.from(poolCosts.keys()),
      });
    }
  });

  /**
   * POST /x402/agents/:agentId/chat — Agent chat with x402 payment
   *
   * Headers:
   *   - X-402-Payment: JSON payment proof
   *
   * Body:
   *   - message: Chat message
   *   - community_id: Community UUID
   *
   * Response headers:
   *   - x-402-settled: Actual cost settled (micro-USD)
   *   - x-402-credited: Amount credited back (micro-USD)
   */
  router.post('/agents/:agentId/chat', async (req: Request, res: Response) => {
    if (!featureX402Enabled) {
      res.status(503).json({ error: 'x402 payments not enabled' });
      return;
    }

    const { agentId } = req.params;
    const { message, community_id: communityId } = req.body;

    if (!message || !communityId) {
      res.status(400).json({ error: 'message and community_id required' });
      return;
    }

    // -------------------------------------------------------------------
    // Step 1: Parse X-402-Payment header
    // -------------------------------------------------------------------
    const paymentHeader = req.headers['x-402-payment'] as string | undefined;

    if (!paymentHeader) {
      // Return 402 with facilitator details
      const defaultPool = poolCosts.get('cheap') || poolCosts.values().next().value;
      res.status(402).json({
        error: 'Payment Required',
        message: 'Include X-402-Payment header with payment proof',
        quote_url: '/x402/quote',
        facilitator: {
          address: facilitatorAddress,
          chain: 'base',
          chain_id: chainId,
          token: 'USDC',
          estimated_cost_micro: defaultPool?.max_cost_micro.toString(),
        },
      });
      return;
    }

    let proof: X402PaymentProof;
    try {
      const parsed = JSON.parse(paymentHeader);
      proof = {
        tx_hash: parsed.txHash || parsed.tx_hash,
        chain_id: parsed.chainId || parsed.chain_id,
        from: parsed.from,
        amount_micro: BigInt(parsed.amount || parsed.amount_micro),
        nonce: parsed.nonce,
        agent_id: agentId,
        community_id: communityId,
      };

      if (!proof.tx_hash || !proof.nonce || !proof.from) {
        throw new Error('Missing required fields: txHash, nonce, from');
      }
    } catch (err) {
      res.status(400).json({
        error: 'Invalid X-402-Payment header',
        message: (err as Error).message,
      });
      return;
    }

    // -------------------------------------------------------------------
    // Step 2: Verify nonce uniqueness (replay prevention)
    // -------------------------------------------------------------------
    const nonceValid = await verifyNonceUnique(pool, proof.nonce);
    if (!nonceValid) {
      res.status(400).json({
        error: 'Nonce replay detected',
        message: 'This payment proof has already been used',
      });
      return;
    }

    // -------------------------------------------------------------------
    // Step 3: Run inference (or mock for now)
    // -------------------------------------------------------------------
    let inferenceResult: {
      response: string;
      actualCostMicro: bigint;
      reservationId: string;
    };

    if (deps.inferenceHandler) {
      inferenceResult = await deps.inferenceHandler(agentId, communityId, message);
    } else {
      // Default: use quoted amount as actual (no savings — conservative)
      const poolConfig = poolCosts.get('cheap');
      inferenceResult = {
        response: 'Inference handler not configured',
        actualCostMicro: poolConfig?.typical_cost_micro ?? proof.amount_micro,
        reservationId: `x402:${proof.nonce}`,
      };
    }

    // -------------------------------------------------------------------
    // Step 4: Settle — conservative-quote-settle
    // -------------------------------------------------------------------
    try {
      const settlement = await settle(
        pool,
        redis,
        proof,
        proof.amount_micro, // quoted = what client paid
        inferenceResult.actualCostMicro,
        inferenceResult.reservationId,
      );

      logger.info({
        agentId,
        communityId,
        lotId: settlement.lot_id,
        quotedMicro: settlement.quoted_micro.toString(),
        actualMicro: settlement.actual_micro.toString(),
        creditedBack: settlement.credited_back_micro.toString(),
      }, 'x402 settlement complete');

      // Set response headers
      res.setHeader('x-402-settled', settlement.actual_micro.toString());
      res.setHeader('x-402-credited', settlement.credited_back_micro.toString());

      res.status(200).json({
        response: inferenceResult.response,
        settlement: {
          lot_id: settlement.lot_id,
          quoted_micro: settlement.quoted_micro.toString(),
          actual_micro: settlement.actual_micro.toString(),
          credited_back_micro: settlement.credited_back_micro.toString(),
        },
      });
    } catch (err) {
      logger.error({ agentId, communityId, err }, 'x402 settlement failed');

      // Fallback: return fixed-price tier options
      res.status(500).json({
        error: 'Settlement failed',
        message: (err as Error).message,
        fallback: {
          message: 'x402 payment proof could not be settled. Consider using fixed-price tiers.',
          tiers_url: '/api/billing/tiers',
        },
      });
    }
  });

  return router;
}
