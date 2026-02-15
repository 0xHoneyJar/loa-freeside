/**
 * x402 Express Middleware
 *
 * Parses X-402-Payment header and delegates verification to X402PaymentAdapter.
 * Returns 402 Payment Required with facilitator details when payment is missing/insufficient.
 *
 * SDD refs: §1.8 x402 Verification
 * Sprint refs: Task 2.4
 *
 * @module api/middleware/x402-middleware
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Configuration
// =============================================================================

/** Environment variables for x402 facilitator info */
const X402_FACILITATOR_ADDRESS = process.env.X402_FACILITATOR_ADDRESS ?? '';
const X402_USDC_CONTRACT = process.env.X402_USDC_CONTRACT ?? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const X402_CHAIN_ID = Number(process.env.X402_CHAIN_ID ?? '8453');

// =============================================================================
// Request Schema
// =============================================================================

const x402PaymentSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
  chainId: z.number().int().positive(),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid sender address'),
  amount: z.string().min(1, 'Amount required'),
});

// =============================================================================
// Middleware Types
// =============================================================================

export interface X402MiddlewareOptions {
  /** Facilitator address that receives payments */
  facilitatorAddress?: string;
  /** USDC contract address on Base */
  usdcContract?: string;
  /** Chain ID */
  chainId?: number;
}

/**
 * Extend Express Request with verified x402 payment data.
 */
export interface X402Request extends Request {
  x402Payment?: {
    txHash: string;
    chainId: number;
    from: string;
    amount: string;
  };
}

// =============================================================================
// Middleware Factory
// =============================================================================

/**
 * Create x402 payment gate middleware.
 *
 * If the X-402-Payment header is present and valid, attaches parsed payment
 * to req.x402Payment and calls next(). If missing, returns 402 with
 * facilitator details.
 */
export function createX402Middleware(options?: X402MiddlewareOptions) {
  const facilitator = options?.facilitatorAddress ?? X402_FACILITATOR_ADDRESS;
  const usdc = options?.usdcContract ?? X402_USDC_CONTRACT;
  const chainId = options?.chainId ?? X402_CHAIN_ID;

  if (!facilitator) {
    logger.warn({
      event: 'billing.x402.no_facilitator',
    }, 'X402_FACILITATOR_ADDRESS not configured — x402 middleware will reject all requests');
  }

  return function x402Gate(req: X402Request, res: Response, next: NextFunction): void {
    const paymentHeader = req.headers['x-402-payment'];

    if (!paymentHeader || typeof paymentHeader !== 'string') {
      res.status(402).json({
        error: 'Payment Required',
        message: 'x402 payment required. Include X-402-Payment header with transaction details.',
        facilitator: {
          address: facilitator,
          chain: 'base',
          chainId,
          token: 'USDC',
          contract: usdc,
        },
      });
      return;
    }

    // Parse the payment header (JSON-encoded)
    let parsed: unknown;
    try {
      parsed = JSON.parse(paymentHeader);
    } catch {
      res.status(400).json({
        error: 'Invalid X-402-Payment header',
        message: 'X-402-Payment must be valid JSON',
      });
      return;
    }

    const result = x402PaymentSchema.safeParse(parsed);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid X-402-Payment data',
        details: result.error.issues.map(i => i.message),
      });
      return;
    }

    // Attach verified payment data to request
    req.x402Payment = result.data;
    next();
  };
}

/**
 * Optional x402 middleware — allows requests without payment header.
 * If present, validates and attaches. If absent, continues without error.
 */
export function createOptionalX402Middleware(options?: X402MiddlewareOptions) {
  const facilitator = options?.facilitatorAddress ?? X402_FACILITATOR_ADDRESS;
  const usdc = options?.usdcContract ?? X402_USDC_CONTRACT;
  const chainId = options?.chainId ?? X402_CHAIN_ID;

  return function x402Optional(req: X402Request, res: Response, next: NextFunction): void {
    const paymentHeader = req.headers['x-402-payment'];

    if (!paymentHeader || typeof paymentHeader !== 'string') {
      // No payment — continue without x402 data
      next();
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(paymentHeader);
    } catch {
      res.status(400).json({
        error: 'Invalid X-402-Payment header',
        message: 'X-402-Payment must be valid JSON',
      });
      return;
    }

    const result = x402PaymentSchema.safeParse(parsed);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid X-402-Payment data',
        details: result.error.issues.map(i => i.message),
      });
      return;
    }

    req.x402Payment = result.data;
    next();
  };
}
