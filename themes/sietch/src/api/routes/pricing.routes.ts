/**
 * Pricing Routes — Pool-Aware Model Pricing API
 *
 * GET /api/pricing/models — Returns per-model pricing aligned with Finn routing pools
 *
 * Public endpoint (no auth required) — pricing is not sensitive.
 * Implements: loa-freeside#147, Bridgebuilder finding 3 (pool-aware pricing)
 *
 * @module api/routes/pricing.routes
 */

import { Router, type Request, type Response } from 'express';

export const pricingRouter = Router();

// =============================================================================
// Pool-Aware Pricing (Bridgebuilder finding 3)
// =============================================================================
// Maps to Finn's 5 routing pools per Hounfour RFC (loa-finn#31):
//   cheap, fast-code, reviewer, reasoning, architect
//
// Prices are per-token in USD. Updated manually for now.
// TODO: Pull from provider APIs dynamically.

interface ModelPricing {
  modelId: string;
  pool: string;
  inputPricePerToken: number;
  outputPricePerToken: number;
  currency: 'USD';
  updatedAt: string;
}

const MODEL_PRICING: ModelPricing[] = [
  {
    modelId: 'gpt-4o-mini',
    pool: 'cheap',
    inputPricePerToken: 0.15 / 1_000_000,
    outputPricePerToken: 0.60 / 1_000_000,
    currency: 'USD',
    updatedAt: '2026-03-26T00:00:00Z',
  },
  {
    modelId: 'qwen3-coder-next',
    pool: 'fast-code',
    inputPricePerToken: 0.50 / 1_000_000,
    outputPricePerToken: 1.50 / 1_000_000,
    currency: 'USD',
    updatedAt: '2026-03-26T00:00:00Z',
  },
  {
    modelId: 'gpt-4o',
    pool: 'reviewer',
    inputPricePerToken: 2.50 / 1_000_000,
    outputPricePerToken: 10.0 / 1_000_000,
    currency: 'USD',
    updatedAt: '2026-03-26T00:00:00Z',
  },
  {
    modelId: 'kimi-k2-thinking',
    pool: 'reasoning',
    inputPricePerToken: 5.00 / 1_000_000,
    outputPricePerToken: 20.0 / 1_000_000,
    currency: 'USD',
    updatedAt: '2026-03-26T00:00:00Z',
  },
  {
    modelId: 'claude-opus-4-6',
    pool: 'architect',
    inputPricePerToken: 15.0 / 1_000_000,
    outputPricePerToken: 75.0 / 1_000_000,
    currency: 'USD',
    updatedAt: '2026-03-26T00:00:00Z',
  },
];

const PRICING_VERSION = '1.0.0';

// =============================================================================
// Routes
// =============================================================================

// GET /api/pricing/models
pricingRouter.get('/models', (_req: Request, res: Response) => {
  res.status(200).json({
    models: MODEL_PRICING,
    version: PRICING_VERSION,
  });
});
