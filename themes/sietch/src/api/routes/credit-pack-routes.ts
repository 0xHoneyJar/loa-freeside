/**
 * Credit Pack Purchase Routes
 *
 * POST /api/billing/credit-packs/purchase — Buy a credit pack
 *
 * Flow:
 *   1. Validate packId against tier definitions
 *   2. Verify payment proof via IPaymentVerifier
 *   3. Check idempotency: SHA-256(reference + recipient + amount + accountId)
 *   4. If duplicate → return existing lot (HTTP 200)
 *   5. If new → create credit lot, record purchase (HTTP 201)
 *
 * SDD refs: §4.4 Credit Pack Purchase
 * Sprint refs: Task 4.4
 *
 * @module api/routes/credit-pack-routes
 */

import { Router, type Request, type Response } from 'express';
import { createHash } from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { memberRateLimiter } from '../middleware.js';
import { serializeBigInt } from '../../packages/core/protocol/arrakis-arithmetic.js';
import {
  resolveCreditPack,
  DEFAULT_MARKUP_FACTOR,
  CREDIT_PACK_TIERS,
} from '../../packages/core/billing/credit-packs.js';
import type { IPaymentVerifier, PaymentProof } from '../../packages/core/ports/IPaymentVerifier.js';
import type { ICreditLedgerService } from '../../packages/core/ports/ICreditLedgerService.js';
import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Router Setup
// =============================================================================

export const creditPackRouter = Router();

// =============================================================================
// Provider Initialization
// =============================================================================

let verifier: IPaymentVerifier | null = null;
let ledgerService: ICreditLedgerService | null = null;
let billingDb: Database.Database | null = null;
let markupFactor: number = DEFAULT_MARKUP_FACTOR;

/**
 * Initialize credit pack route dependencies.
 */
export function setCreditPackDependencies(deps: {
  verifier: IPaymentVerifier;
  ledger: ICreditLedgerService;
  db: Database.Database;
  markupFactor?: number;
}): void {
  verifier = deps.verifier;
  ledgerService = deps.ledger;
  billingDb = deps.db;
  if (deps.markupFactor !== undefined) {
    markupFactor = deps.markupFactor;
  }
}

function getVerifier(): IPaymentVerifier {
  if (!verifier) throw new Error('Payment verifier not initialized');
  return verifier;
}

function getLedger(): ICreditLedgerService {
  if (!ledgerService) throw new Error('Ledger service not initialized');
  return ledgerService;
}

function getDb(): Database.Database {
  if (!billingDb) throw new Error('Billing database not initialized');
  return billingDb;
}

// =============================================================================
// Schemas
// =============================================================================

const purchaseSchema = z.object({
  packId: z.string().min(1),
  paymentProof: z.object({
    reference: z.string().min(1),
    recipient_address: z.string().min(1),
    amount_micro: z.union([z.string(), z.number()])
      .transform((val) => BigInt(val)),
    payer: z.string().min(1),
    chain_id: z.number().int().positive(),
  }),
});

// =============================================================================
// Idempotency Key Generation
// =============================================================================

function generateIdempotencyKey(
  reference: string,
  recipientAddress: string,
  amountMicro: bigint,
  accountId: string,
): string {
  return createHash('sha256')
    .update(`${reference}:${recipientAddress}:${amountMicro.toString()}:${accountId}`)
    .digest('hex');
}

// =============================================================================
// POST /purchase — Buy a Credit Pack
// =============================================================================

creditPackRouter.post(
  '/purchase',
  memberRateLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const accountId = (req as any).accountId;
    if (!accountId) {
      res.status(401).json({ error: 'Account not identified' });
      return;
    }

    // Parse and validate body
    const parsed = purchaseSchema.safeParse(req.body);
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

    const { packId, paymentProof } = parsed.data;

    // 1. Validate packId
    const resolved = resolveCreditPack(packId, markupFactor, CREDIT_PACK_TIERS);
    if (!resolved) {
      res.status(400).json({
        error: 'Invalid Pack',
        message: `Unknown credit pack: "${packId}". Valid packs: ${CREDIT_PACK_TIERS.map(t => t.id).join(', ')}`,
      });
      return;
    }

    // 2. Verify payment proof
    const proof: PaymentProof = {
      reference: paymentProof.reference,
      recipient_address: paymentProof.recipient_address,
      amount_micro: paymentProof.amount_micro,
      payer: paymentProof.payer,
      chain_id: paymentProof.chain_id,
    };

    try {
      const v = getVerifier();
      const verification = await v.verify(proof);
      if (!verification.valid) {
        res.status(402).json({
          error: 'Payment Verification Failed',
          message: verification.reason ?? 'Payment proof invalid',
        });
        return;
      }
    } catch (err) {
      logger.error({ event: 'credit-pack.verify.error', err }, 'Payment verification error');
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    // 3. Check idempotency
    const idempotencyKey = generateIdempotencyKey(
      proof.reference,
      proof.recipient_address,
      proof.amount_micro,
      accountId,
    );

    const db = getDb();
    const existing = db.prepare(
      `SELECT lot_id, amount_micro FROM credit_lot_purchases WHERE idempotency_key = ?`,
    ).get(idempotencyKey) as { lot_id: string; amount_micro: string | number } | undefined;

    if (existing) {
      // 4. Duplicate → return existing lot
      const ledger = getLedger();
      const balance = await ledger.getBalance(accountId);

      logger.info({
        event: 'credit-pack.purchase.duplicate',
        accountId,
        packId,
        lotId: existing.lot_id,
      }, 'Duplicate purchase — returning existing lot');

      res.status(200).json(serializeBigInt({
        lotId: existing.lot_id,
        packId,
        creditsMicro: BigInt(existing.amount_micro),
        balance: {
          availableMicro: balance.availableMicro,
          reservedMicro: balance.reservedMicro,
        },
        duplicate: true,
      }));
      return;
    }

    // 5. Create credit lot
    try {
      const ledger = getLedger();
      const lot = await ledger.mintLot(
        accountId,
        resolved.creditsMicro,
        'purchase',
        {
          poolId: 'general',
          description: `Credit pack purchase: ${resolved.tier.name} (${packId})`,
        },
      );

      // 6. Record purchase
      const purchaseId = `pur_${createHash('sha256')
        .update(`${accountId}:${idempotencyKey}:${Date.now()}`)
        .digest('hex')
        .substring(0, 16)}`;

      db.prepare(`
        INSERT INTO credit_lot_purchases (id, account_id, pack_id, payment_reference, idempotency_key, lot_id, amount_micro)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        purchaseId,
        accountId,
        packId,
        proof.reference,
        idempotencyKey,
        lot.id,
        resolved.creditsMicro.toString(),
      );

      // 7. Return result
      const balance = await ledger.getBalance(accountId);

      logger.info({
        event: 'credit-pack.purchase.success',
        accountId,
        packId,
        purchaseId,
        lotId: lot.id,
        creditsMicro: resolved.creditsMicro.toString(),
      }, 'Credit pack purchased');

      res.status(201).json(serializeBigInt({
        lotId: lot.id,
        packId,
        creditsMicro: resolved.creditsMicro,
        balance: {
          availableMicro: balance.availableMicro,
          reservedMicro: balance.reservedMicro,
        },
        duplicate: false,
      }));
    } catch (err) {
      logger.error({
        event: 'credit-pack.purchase.error',
        accountId,
        packId,
        err,
      }, 'Credit pack purchase failed');

      res.status(500).json({ error: 'Internal server error' });
    }
  },
);
