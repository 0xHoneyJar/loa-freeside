/**
 * Settlement Routes — Dixie x402 Integration
 *
 * POST /api/settlement/quote   — Reserve credits, return quote with expiry
 * POST /api/settlement/settle  — Finalize quote with actual usage
 * GET  /api/settlement/quote/:id — Query quote state
 *
 * Auth: S2S JWT (HS256 shared secret, same as Finn S2S)
 * Issuer: loa-dixie (iss=loa-dixie, aud=arrakis-internal)
 *
 * Implements: loa-freeside#147, Dixie PR#83 SettlementClient contract
 * Bridgebuilder findings: state machine, signature, idempotency
 *
 * @module api/routes/settlement.routes
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createHmac, timingSafeEqual, randomUUID, sign } from 'crypto';
import { logger } from '../../utils/logger.js';
import type { ICreditLedgerService } from '../../packages/core/ports/ICreditLedgerService.js';

export const settlementRouter = Router();

// =============================================================================
// Types
// =============================================================================

type QuoteState = 'PENDING' | 'SETTLING' | 'SETTLED' | 'EXPIRED' | 'FAILED';

interface QuoteRecord {
  quoteId: string;
  state: QuoteState;
  amountMicroUsd: bigint;
  walletAddress: string;
  model: string;
  estimatedTokens: number;
  reservationId: string | null;
  expiresAt: Date;
  createdAt: Date;
  settledAt: Date | null;
  receiptId: string | null;
  idempotencyKey: string | null;
}

// =============================================================================
// In-Memory Quote Store (production: migrate to Redis/Postgres)
// =============================================================================

const quotes = new Map<string, QuoteRecord>();
const idempotencyKeys = new Map<string, { quoteId: string; expiresAt: number }>();

// Quote expiry: 5 minutes
const QUOTE_TTL_MS = 5 * 60 * 1000;
// Idempotency window: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// Cleanup expired quotes every 60s
setInterval(() => {
  const now = Date.now();
  for (const [id, quote] of quotes) {
    if (quote.state === 'PENDING' && quote.expiresAt.getTime() < now) {
      quote.state = 'EXPIRED';
    }
  }
  for (const [key, entry] of idempotencyKeys) {
    if (entry.expiresAt < now) {
      idempotencyKeys.delete(key);
    }
  }
}, 60_000);

// =============================================================================
// Provider Injection
// =============================================================================

let ledger: ICreditLedgerService | null = null;

export function setSettlementLedger(l: ICreditLedgerService): void {
  ledger = l;
}

// =============================================================================
// S2S Auth Middleware (accepts both loa-finn and loa-dixie)
// =============================================================================

function verifyS2SToken(req: Request): { sub: string; iss: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const secret = process.env.BILLING_INTERNAL_JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const headerPayload = `${parts[0]}.${parts[1]}`;
    const signature = createHmac('sha256', secret)
      .update(headerPayload)
      .digest('base64url');

    const provided = parts[2];
    if (signature.length !== provided.length) return null;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(provided))) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as { sub: string; iss: string; aud: string; exp: number; iat: number };

    if (payload.aud !== 'arrakis-internal') return null;
    if (!['loa-finn', 'loa-dixie'].includes(payload.iss)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now - 30 || payload.iat > now + 30) return null;
    if (payload.exp - payload.iat > 5 * 60) return null;

    return { sub: payload.sub, iss: payload.iss };
  } catch {
    return null;
  }
}

function requireS2S(req: Request, res: Response, next: () => void): void {
  const auth = verifyS2SToken(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing S2S JWT' });
    return;
  }
  (req as any).s2sAuth = auth;
  next();
}

// =============================================================================
// Schemas
// =============================================================================

const quoteRequestSchema = z.object({
  model: z.string().min(1),
  estimatedTokens: z.number().int().positive(),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

const settleRequestSchema = z.object({
  quoteId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(128),
  actualInputTokens: z.number().int().nonneg(),
  actualOutputTokens: z.number().int().nonneg(),
});

// =============================================================================
// Pricing Helpers
// =============================================================================

interface ModelPricing {
  inputPricePerToken: number;
  outputPricePerToken: number;
}

function getModelPricing(model: string): ModelPricing {
  // Pool-aware pricing (per Bridgebuilder finding 3)
  const POOL_PRICING: Record<string, ModelPricing> = {
    'gpt-4o-mini':       { inputPricePerToken: 0.15 / 1_000_000, outputPricePerToken: 0.60 / 1_000_000 },
    'qwen3-coder-next':  { inputPricePerToken: 0.50 / 1_000_000, outputPricePerToken: 1.50 / 1_000_000 },
    'gpt-4o':            { inputPricePerToken: 2.50 / 1_000_000, outputPricePerToken: 10.0 / 1_000_000 },
    'kimi-k2-thinking':  { inputPricePerToken: 5.00 / 1_000_000, outputPricePerToken: 20.0 / 1_000_000 },
    'claude-opus-4-6':   { inputPricePerToken: 15.0 / 1_000_000, outputPricePerToken: 75.0 / 1_000_000 },
  };

  // Default fallback (from issue #147: $3/1M input, $15/1M output)
  return POOL_PRICING[model] ?? { inputPricePerToken: 3.0 / 1_000_000, outputPricePerToken: 15.0 / 1_000_000 };
}

function estimateCostMicroUsd(model: string, tokens: number): bigint {
  const pricing = getModelPricing(model);
  // Estimate: assume 70% input, 30% output for quotes
  const inputTokens = Math.floor(tokens * 0.7);
  const outputTokens = Math.floor(tokens * 0.3);
  const costUsd = (inputTokens * pricing.inputPricePerToken) + (outputTokens * pricing.outputPricePerToken);
  // Convert to micro-USD (1 USD = 1,000,000 micro-USD), add 20% buffer for safety
  return BigInt(Math.ceil(costUsd * 1_000_000 * 1.2));
}

function calculateActualCostMicroUsd(model: string, inputTokens: number, outputTokens: number): bigint {
  const pricing = getModelPricing(model);
  const costUsd = (inputTokens * pricing.inputPricePerToken) + (outputTokens * pricing.outputPricePerToken);
  return BigInt(Math.ceil(costUsd * 1_000_000));
}

// =============================================================================
// Quote Signature (Bridgebuilder finding 2)
// =============================================================================

function signQuote(quoteId: string, amountMicroUsd: bigint, expiresAt: string): string {
  const secret = process.env.BILLING_INTERNAL_JWT_SECRET;
  if (!secret) return '';
  // Canonical format: quoteId|amountMicroUsd|expiresAt
  const canonical = `${quoteId}|${amountMicroUsd.toString()}|${expiresAt}`;
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

// =============================================================================
// Routes
// =============================================================================

// POST /api/settlement/quote
settlementRouter.post('/quote', requireS2S, async (req: Request, res: Response) => {
  const parse = quoteRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.issues });
    return;
  }

  const { model, estimatedTokens, walletAddress } = parse.data;
  const amountMicroUsd = estimateCostMicroUsd(model, estimatedTokens);
  const quoteId = randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);

  // Reserve credits in the ledger if available
  let reservationId: string | null = null;
  if (ledger) {
    try {
      const reservation = await ledger.reserve(walletAddress, null, amountMicroUsd);
      reservationId = reservation.reservationId;
    } catch (err: any) {
      if (err.message?.includes('insufficient') || err.code === 'INSUFFICIENT_FUNDS') {
        res.status(402).json({ error: 'Insufficient funds', message: 'Not enough credits to cover estimated cost' });
        return;
      }
      throw err;
    }
  }

  const quote: QuoteRecord = {
    quoteId,
    state: 'PENDING',
    amountMicroUsd,
    walletAddress,
    model,
    estimatedTokens,
    reservationId,
    expiresAt,
    createdAt: new Date(),
    settledAt: null,
    receiptId: null,
    idempotencyKey: null,
  };

  quotes.set(quoteId, quote);

  const expiresAtIso = expiresAt.toISOString();
  const signature = signQuote(quoteId, amountMicroUsd, expiresAtIso);

  logger.info({ event: 'settlement.quote.created', quoteId, model, amountMicroUsd: amountMicroUsd.toString(), walletAddress: walletAddress.slice(0, 10) + '...' }, 'Quote created');

  res.status(200).json({
    quoteId,
    amountMicroUsd: Number(amountMicroUsd),
    expiresAt: expiresAtIso,
    signature,
  });
});

// POST /api/settlement/settle
settlementRouter.post('/settle', requireS2S, async (req: Request, res: Response) => {
  const parse = settleRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Validation error', details: parse.error.issues });
    return;
  }

  const { quoteId, idempotencyKey, actualInputTokens, actualOutputTokens } = parse.data;

  // Idempotency check
  const existing = idempotencyKeys.get(idempotencyKey);
  if (existing) {
    const existingQuote = quotes.get(existing.quoteId);
    if (existingQuote?.state === 'SETTLED') {
      res.status(200).json({
        receiptId: existingQuote.receiptId,
        transactionHash: `0x${existingQuote.receiptId?.replace(/-/g, '')}`,
        amountMicroUsd: Number(existingQuote.amountMicroUsd),
        settledAt: existingQuote.settledAt?.toISOString(),
      });
      return;
    }
    res.status(409).json({ error: 'Duplicate idempotency key', quoteId: existing.quoteId });
    return;
  }

  const quote = quotes.get(quoteId);
  if (!quote) {
    res.status(404).json({ error: 'Quote not found' });
    return;
  }

  if (quote.state === 'EXPIRED') {
    res.status(422).json({ error: 'Quote expired', expiresAt: quote.expiresAt.toISOString() });
    return;
  }

  if (quote.state !== 'PENDING') {
    res.status(409).json({ error: 'Quote not in PENDING state', state: quote.state });
    return;
  }

  // Transition: PENDING → SETTLING
  quote.state = 'SETTLING';
  quote.idempotencyKey = idempotencyKey;

  try {
    const actualCostMicroUsd = calculateActualCostMicroUsd(quote.model, actualInputTokens, actualOutputTokens);

    // Finalize in the ledger
    if (ledger && quote.reservationId) {
      await ledger.finalize(quote.reservationId, actualCostMicroUsd);
    }

    const receiptId = randomUUID();
    quote.state = 'SETTLED';
    quote.settledAt = new Date();
    quote.receiptId = receiptId;
    quote.amountMicroUsd = actualCostMicroUsd;

    // Store idempotency key
    idempotencyKeys.set(idempotencyKey, {
      quoteId,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });

    logger.info({
      event: 'settlement.settled',
      quoteId,
      receiptId,
      actualCostMicroUsd: actualCostMicroUsd.toString(),
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
    }, 'Settlement complete');

    res.status(200).json({
      receiptId,
      transactionHash: `0x${receiptId.replace(/-/g, '')}`,
      amountMicroUsd: Number(actualCostMicroUsd),
      settledAt: quote.settledAt.toISOString(),
    });
  } catch (err: any) {
    quote.state = 'FAILED';
    logger.error({ event: 'settlement.failed', quoteId, err: err.message }, 'Settlement failed');
    res.status(503).json({ error: 'Settlement failed', message: err.message });
  }
});

// GET /api/settlement/quote/:id (Bridgebuilder finding 1)
settlementRouter.get('/quote/:id', requireS2S, (req: Request, res: Response) => {
  const quote = quotes.get(req.params.id);
  if (!quote) {
    res.status(404).json({ error: 'Quote not found' });
    return;
  }

  // Check expiry
  if (quote.state === 'PENDING' && quote.expiresAt.getTime() < Date.now()) {
    quote.state = 'EXPIRED';
  }

  res.status(200).json({
    quoteId: quote.quoteId,
    state: quote.state,
    amountMicroUsd: Number(quote.amountMicroUsd),
    model: quote.model,
    walletAddress: quote.walletAddress,
    expiresAt: quote.expiresAt.toISOString(),
    createdAt: quote.createdAt.toISOString(),
    settledAt: quote.settledAt?.toISOString() ?? null,
    receiptId: quote.receiptId,
  });
});
