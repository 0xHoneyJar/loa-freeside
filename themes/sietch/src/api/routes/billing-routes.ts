/**
 * Billing Routes Module
 *
 * POST /api/billing/topup — x402 USDC top-up
 * GET /api/billing/balance — caller's credit balance across pools
 * GET /api/billing/history — paginated ledger entries
 * GET /api/billing/pricing — public pricing page data
 * POST /api/internal/billing/finalize — S2S finalize for loa-finn
 * POST /api/internal/billing/verify-anchor — S2S anchor verification
 *
 * SDD refs: §5.2 Balance/History, §5.3 Top-Up Endpoint, §5.7 Auth Model, §6.2 Identity Anchor S2S
 * Sprint refs: Tasks 2.5, 5.1, 5.2; Sprint 253 Task 2.1
 *
 * @module api/routes/billing-routes
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { memberRateLimiter } from '../middleware.js';
import { serializeBigInt } from '../../packages/core/protocol/arithmetic.js';
import { PROTOCOL_VERSION, validateCompatibility } from '../../packages/core/protocol/compatibility.js';
import { verifyIdentityAnchor } from '../../packages/core/protocol/identity-trust.js';
import { fromFinalizeResult } from '../../packages/adapters/billing/billing-entry-mapper.js';
import { s2sFinalizeRequestSchema, historyQuerySchema } from '../../packages/core/contracts/s2s-billing.js';
import { logger } from '../../utils/logger.js';
import type { IPaymentService } from '../../packages/core/ports/IPaymentService.js';
import type { ICreditLedgerService } from '../../packages/core/ports/ICreditLedgerService.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Router Setup
// =============================================================================

export const creditBillingRouter = Router();

// =============================================================================
// Provider Initialization
// =============================================================================

let paymentService: IPaymentService | null = null;
let ledgerService: ICreditLedgerService | null = null;
let billingDb: Database.Database | null = null;

/**
 * Set the payment service instance.
 * Called during server initialization.
 */
export function setCreditBillingPaymentService(service: IPaymentService): void {
  paymentService = service;
}

/**
 * Set the ledger service and DB for dashboard + S2S endpoints.
 * Called during server initialization.
 */
export function setCreditBillingLedgerService(services: {
  ledger: ICreditLedgerService;
  db: Database.Database;
}): void {
  ledgerService = services.ledger;
  billingDb = services.db;
}

function getPaymentService(): IPaymentService {
  if (!paymentService) {
    throw new Error('Payment service not initialized');
  }
  return paymentService;
}

function getLedgerService(): ICreditLedgerService {
  if (!ledgerService) {
    throw new Error('Ledger service not initialized');
  }
  return ledgerService;
}

// =============================================================================
// Billing feature check
// =============================================================================

function requireBillingFeature(_req: Request, res: Response, next: Function): void {
  const enabled = process.env.FEATURE_BILLING_ENABLED === 'true';
  if (!enabled) {
    res.status(503).json({
      error: 'Billing Not Enabled',
      message: 'The credit billing system is not yet enabled.',
    });
    return;
  }
  next();
}

// =============================================================================
// Rate Limiter: 10 per minute per account for top-up
// =============================================================================

import rateLimit from 'express-rate-limit';

const topupRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use account ID from auth, fallback to IP
    return (req as any).accountId ?? req.ip ?? 'unknown';
  },
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Top-up rate limit: maximum 10 requests per minute.',
    });
  },
});

// Public rate limiter: 100 per minute per IP (for unauthenticated endpoints)
const publicRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit: maximum 100 requests per minute.',
    });
  },
});

// =============================================================================
// Schemas
// =============================================================================

const topupSchema = z.object({
  amountUsd: z.number().positive().max(10000, 'Maximum top-up is $10,000'),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
  chainId: z.number().int().positive().default(8453),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid sender address'),
  amount: z.string().min(1, 'Token amount required'),
});

// =============================================================================
// POST /api/billing/topup — x402 USDC Top-Up
// =============================================================================

creditBillingRouter.post(
  '/topup',
  requireBillingFeature,
  memberRateLimiter,
  requireAuth,
  topupRateLimiter,
  async (req: Request, res: Response) => {
    const result = topupSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { amountUsd, txHash, chainId, from, amount } = result.data;

    // Check Idempotency-Key header
    const idempotencyKey = req.headers['idempotency-key'];
    if (idempotencyKey && typeof idempotencyKey !== 'string') {
      res.status(400).json({
        error: 'Invalid Idempotency-Key header',
      });
      return;
    }

    try {
      const service = getPaymentService();

      // Get account ID from auth context
      const accountId = (req as any).accountId;
      if (!accountId) {
        res.status(401).json({ error: 'Account not identified' });
        return;
      }

      const topupResult = await service.createTopUp(accountId, amountUsd, {
        txHash,
        chainId,
        from,
        amount,
      });

      logger.info({
        event: 'billing.topup.success',
        paymentId: topupResult.paymentId,
        accountId: topupResult.accountId,
        amountUsdMicro: topupResult.amountUsdMicro.toString(),
      }, 'Top-up successful');

      res.status(201).json(serializeBigInt({
        paymentId: topupResult.paymentId,
        accountId: topupResult.accountId,
        lotId: topupResult.lotId,
        amountUsdMicro: topupResult.amountUsdMicro,
        provider: topupResult.provider,
      }));
    } catch (err) {
      logger.error({
        event: 'billing.topup.error',
        txHash,
        err,
      }, 'Top-up failed');

      if (err instanceof Error && err.message.includes('verification failed')) {
        res.status(402).json({
          error: 'Payment Verification Failed',
          message: err.message,
        });
        return;
      }
      if (err instanceof Error && err.message.includes('already used')) {
        res.status(409).json({
          error: 'Duplicate Payment',
          message: 'This transaction has already been used for a top-up.',
        });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// S2S Internal JWT Auth (loa-finn → arrakis)
// =============================================================================

interface InternalTokenPayload {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
}

/**
 * Verify internal S2S JWT with HS256.
 * Expects iss=loa-finn, aud=arrakis-internal, max 5min TTL.
 */
function verifyInternalToken(token: string): InternalTokenPayload | null {
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
    const sigBuf = Buffer.from(signature, 'utf8');
    const provBuf = Buffer.from(provided, 'utf8');
    if (!timingSafeEqual(sigBuf, provBuf)) return null;

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    ) as InternalTokenPayload;

    if (payload.aud !== 'arrakis-internal') return null;
    if (payload.iss !== 'loa-finn') return null;

    const now = Math.floor(Date.now() / 1000);
    const clockSkew = 30;
    if (!Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) return null;
    if (payload.iat > now + clockSkew) return null;
    if (payload.exp < now - clockSkew) return null;
    if (payload.exp - payload.iat > 5 * 60) return null;

    return payload;
  } catch {
    return null;
  }
}

function requireInternalAuth(req: Request, res: Response, next: Function): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authorization required' });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyInternalToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired internal token' });
    return;
  }

  (req as any).internalServiceId = payload.sub;
  next();
}

// =============================================================================
// S2S Rate Limiting (Sprint 252, Task 1.3)
//
// S2S routes use a higher rate limit (200 req/min) than public/admin routes
// because they serve inter-service communication (loa-finn → arrakis) where:
//   1. Authentication is via BILLING_INTERNAL_JWT_SECRET (HS256 JWT, not API key)
//   2. Callers are trusted internal services, not external users
//   3. Burst patterns differ: finalize calls come in batches after agent work
//   4. The threat model is service impersonation (mitigated by JWT), not brute-force
//
// The 200 req/min limit prevents runaway service loops while allowing legitimate
// burst traffic from concurrent agent finalizations.
// =============================================================================
const s2sRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as any).internalServiceId ?? req.ip ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'S2S rate limit: maximum 200 requests per minute.',
    });
  },
});

// =============================================================================
// Schemas (Sprint 5)
// =============================================================================

// Schemas imported from packages/core/contracts/s2s-billing.ts (Task 9.2)
const finalizeSchema = s2sFinalizeRequestSchema;

// =============================================================================
// POST /api/internal/billing/finalize — S2S Finalize (Task 5.1)
// =============================================================================

creditBillingRouter.post(
  '/internal/finalize',
  requireBillingFeature,
  requireInternalAuth,
  s2sRateLimiter,
  async (req: Request, res: Response) => {
    const ledger = getLedgerService();

    const result = finalizeSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { reservationId, actualCostMicro, accountId, identity_anchor } = result.data;

    // Protocol version compatibility check (Sprint 10, Task 1.4)
    const remoteVersion = req.headers['x-protocol-version'] as string | undefined;
    if (remoteVersion) {
      const compat = validateCompatibility(PROTOCOL_VERSION, remoteVersion);
      if (!compat.compatible) {
        logger.warn({
          event: 'billing.s2s.finalize.version_mismatch',
          localVersion: PROTOCOL_VERSION,
          remoteVersion,
          level: compat.level,
        }, compat.message);
        res.status(422).json({
          error: 'Protocol Version Mismatch',
          message: compat.message,
          localVersion: PROTOCOL_VERSION,
          remoteVersion,
        });
        return;
      }
      if (compat.level === 'minor_compatible') {
        logger.info({
          event: 'billing.s2s.finalize.version_drift',
          localVersion: PROTOCOL_VERSION,
          remoteVersion,
        }, compat.message);
      }
    }

    // Task 7.1: Confused deputy prevention — verify account ownership
    if (accountId && billingDb) {
      const reservation = billingDb.prepare(
        `SELECT account_id FROM credit_reservations WHERE id = ?`
      ).get(reservationId) as { account_id: string } | undefined;

      if (reservation && reservation.account_id !== accountId) {
        logger.warn({
          event: 'billing.s2s.finalize.confused_deputy',
          reservationId,
          claimedAccountId: accountId,
          actualAccountId: reservation.account_id,
          serviceId: (req as any).internalServiceId,
        }, 'Confused deputy: account mismatch on finalize');

        res.status(403).json({
          error: 'Forbidden',
          message: 'Account mismatch: reservation belongs to a different account',
        });
        return;
      }
    }

    // Sprint 243, Task 5.3: Identity anchor verification for agent accounts
    if (billingDb) {
      // Derive accountId from reservation if not provided
      const derivedAccountId = (() => {
        if (accountId) return accountId;
        const row = billingDb.prepare(
          `SELECT account_id FROM credit_reservations WHERE id = ?`
        ).get(reservationId) as { account_id: string } | undefined;
        return row?.account_id ?? null;
      })();

      if (derivedAccountId) {
        try {
          const anchorRow = billingDb.prepare(
            `SELECT identity_anchor FROM agent_identity_anchors WHERE agent_account_id = ?`
          ).get(derivedAccountId) as { identity_anchor: string } | undefined;

          if (anchorRow) {
            // Agent account has a stored anchor — verification required
            if (!identity_anchor) {
              logger.warn({
                event: 'billing.s2s.finalize.anchor_missing',
                reservationId,
                accountId: derivedAccountId,
              }, 'Identity anchor required but not provided');
              res.status(403).json({
                error: 'Forbidden',
                message: 'Identity anchor required for agent account',
              });
              return;
            }
            if (identity_anchor !== anchorRow.identity_anchor) {
              logger.warn({
                event: 'billing.s2s.finalize.anchor_mismatch',
                reservationId,
                accountId: derivedAccountId,
              }, 'Identity anchor mismatch');
              res.status(403).json({
                error: 'Forbidden',
                message: 'Identity anchor mismatch',
              });
              return;
            }
          }
          // No stored anchor → skip verification (non-agent account)
        } catch {
          // agent_identity_anchors table may not exist — skip verification
        }
      }
    }

    try {
      const finalizeResult = await ledger.finalize(
        reservationId,
        BigInt(actualCostMicro),
      );

      logger.info({
        event: 'billing.s2s.finalize',
        reservationId,
        actualCostMicro,
        serviceId: (req as any).internalServiceId,
      }, 'S2S finalize successful');

      // ADR (Sprint 255, Task 4.4): Protocol adoption at boundary, not rewrite.
      // When format=loh is requested, include the loa-hounfour BillingEntry alongside
      // the native format. This lets consuming services progressively adopt the protocol
      // without requiring arrakis to change its internal representation.
      const nativeResponse = serializeBigInt({
        reservationId: finalizeResult.reservationId,
        accountId: finalizeResult.accountId,
        finalizedMicro: finalizeResult.actualCostMicro,
        releasedMicro: finalizeResult.surplusReleasedMicro,
        overrunMicro: finalizeResult.overrunMicro,
        billingMode: 'live',
        finalizedAt: finalizeResult.finalizedAt,
      });

      if (req.query.format === 'loh') {
        const billingEntry = fromFinalizeResult(finalizeResult);
        res.json({ ...nativeResponse, billing_entry: billingEntry });
      } else {
        res.json(nativeResponse);
      }
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ event: 'billing.s2s.finalize.error', reservationId, err }, msg);

      if (msg.includes('not found')) {
        res.status(404).json({ error: 'Reservation not found' });
      } else if (msg.includes('Conflict')) {
        res.status(409).json({ error: 'Conflict', message: msg });
      } else if (msg.includes('Invalid state')) {
        res.status(409).json({ error: 'Invalid reservation state', message: msg });
      } else {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  },
);

// =============================================================================
// POST /api/internal/billing/verify-anchor — S2S Anchor Verification (Sprint 253, Task 2.1)
//
// Cross-system identity verification for high-value operations.
// External services (loa-finn) call this endpoint to verify an identity anchor
// against the stored value in arrakis, getting back a SHA-256 hash suitable
// for JWT embedding. See identity-trust.ts module header for the full design.
// =============================================================================

const verifyAnchorSchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  anchor: z.string().min(1, 'anchor is required'),
});

creditBillingRouter.post(
  '/internal/verify-anchor',
  requireInternalAuth,
  s2sRateLimiter,
  (req: Request, res: Response) => {
    const result = verifyAnchorSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    const { accountId, anchor } = result.data;
    const db = billingDb;

    if (!db) {
      res.status(503).json({ error: 'Billing database not initialized' });
      return;
    }

    // Lookup function injected into the pure service layer
    const lookupAnchor = (id: string) => {
      try {
        const row = db.prepare(
          `SELECT identity_anchor FROM agent_identity_anchors WHERE agent_account_id = ?`
        ).get(id) as { identity_anchor: string } | undefined;
        if (!row) return null;
        return { anchor: row.identity_anchor };
      } catch {
        // Table may not exist in non-billing deployments
        return null;
      }
    };

    const verification = verifyIdentityAnchor(accountId, anchor, lookupAnchor);

    logger.info({
      event: 'billing.s2s.verify_anchor',
      accountId,
      verified: verification.verified,
      reason: verification.reason,
      serviceId: (req as any).internalServiceId,
    }, `Anchor verification: ${verification.verified ? 'success' : verification.reason}`);

    if (verification.verified) {
      res.json({
        verified: true,
        anchor_hash: verification.anchorHash,
        checked_at: verification.checkedAt,
      });
    } else {
      res.status(403).json({
        verified: false,
        reason: verification.reason,
        checked_at: verification.checkedAt,
      });
    }
  },
);

// =============================================================================
// GET /api/billing/balance — Credit Balance (Task 5.2)
// =============================================================================

creditBillingRouter.get(
  '/balance',
  requireBillingFeature,
  memberRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const ledger = getLedgerService();
    const accountId = (req as any).accountId;

    if (!accountId) {
      res.status(401).json({ error: 'Account not identified' });
      return;
    }

    try {
      const poolId = req.query.poolId as string | undefined;
      const balance = await ledger.getBalance(accountId, poolId);

      res.json(serializeBigInt({
        accountId: balance.accountId,
        poolId: balance.poolId,
        availableMicro: balance.availableMicro,
        reservedMicro: balance.reservedMicro,
      }));
    } catch (err) {
      logger.error({ event: 'billing.balance.error', accountId, err },
        'Failed to fetch balance');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /api/billing/history — Ledger History (Task 5.2)
// =============================================================================

creditBillingRouter.get(
  '/history',
  requireBillingFeature,
  memberRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const ledger = getLedgerService();
    const accountId = (req as any).accountId;

    if (!accountId) {
      res.status(401).json({ error: 'Account not identified' });
      return;
    }

    const parsed = historyQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Validation Error',
        details: parsed.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
      return;
    }

    try {
      const entries = await ledger.getHistory(accountId, {
        poolId: parsed.data.poolId,
        entryType: parsed.data.entryType as any,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });

      res.json({
        accountId,
        entries: entries.map(e => serializeBigInt({
          id: e.id,
          entryType: e.entryType,
          amountMicro: e.amountMicro,
          poolId: e.poolId,
          reservationId: e.reservationId,
          description: e.description,
          preBalanceMicro: e.preBalanceMicro,
          postBalanceMicro: e.postBalanceMicro,
          createdAt: e.createdAt,
        })),
        pagination: {
          limit: parsed.data.limit,
          offset: parsed.data.offset,
          count: entries.length,
        },
      });
    } catch (err) {
      logger.error({ event: 'billing.history.error', accountId, err },
        'Failed to fetch history');
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// =============================================================================
// GET /api/billing/pricing — Public Pricing Data (Task 5.2)
// =============================================================================

creditBillingRouter.get(
  '/pricing',
  requireBillingFeature,
  publicRateLimiter,
  (_req: Request, res: Response) => {
    // Load pricing from billing_config if available, else return defaults
    const pricing = loadPricingConfig();
    res.json(pricing);
  },
);

function loadPricingConfig(): Record<string, unknown> {
  if (!billingDb) {
    return getDefaultPricing();
  }

  try {
    const rows = billingDb.prepare(
      `SELECT key, value FROM billing_config WHERE key LIKE 'rate_%' OR key LIKE 'tier_%'`
    ).all() as Array<{ key: string; value: string }>;

    if (rows.length === 0) {
      return getDefaultPricing();
    }

    const config: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        config[row.key] = JSON.parse(row.value);
      } catch {
        config[row.key] = row.value;
      }
    }

    return {
      pools: {
        general: {
          name: 'General Credits',
          description: 'Universal credits for any API operation',
        },
      },
      rates: config,
      tiers: [
        { name: 'Free', creditsMicro: '0', description: 'Shadow billing — no charges' },
        { name: 'Starter', creditsMicro: '5000000', description: '$5 credit pack' },
        { name: 'Pro', creditsMicro: '50000000', description: '$50 credit pack' },
      ],
      billingMode: config['billing_mode'] ?? 'shadow',
    };
  } catch (err) {
    logger.error({ err }, 'Failed to load pricing config');
    return getDefaultPricing();
  }
}

function getDefaultPricing(): Record<string, unknown> {
  return {
    pools: {
      general: {
        name: 'General Credits',
        description: 'Universal credits for any API operation',
      },
    },
    rates: {},
    tiers: [
      { name: 'Free', creditsMicro: '0', description: 'Shadow billing — no charges' },
      { name: 'Starter', creditsMicro: '5000000', description: '$5 credit pack' },
      { name: 'Pro', creditsMicro: '50000000', description: '$50 credit pack' },
    ],
    billingMode: 'shadow',
  };
}
