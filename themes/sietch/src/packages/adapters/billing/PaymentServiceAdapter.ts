/**
 * PaymentServiceAdapter - Payment Orchestration
 *
 * Delegates to NOWPayments and x402 adapters, wires successful payments
 * to the credit ledger (lot creation + deposit entries).
 *
 * Refund flow: LIFO clawback → reversing ledger entries → debt for consumed portion.
 *
 * SDD refs: §5.3 Top-Up, §5.4 Payment State Machine
 * Sprint refs: Task 2.2
 *
 * @module packages/adapters/billing/PaymentServiceAdapter
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  IPaymentService,
  PaymentProvider,
  PaymentStatus,
  WebhookProcessResult,
  TopUpResult,
  RefundResult,
  X402Payment,
  ALLOWED_TRANSITIONS,
  TERMINAL_STATUSES,
} from '../../core/ports/IPaymentService.js';
import {
  ALLOWED_TRANSITIONS as TRANSITIONS,
  TERMINAL_STATUSES as TERMINALS,
} from '../../core/ports/IPaymentService.js';
import type { ICreditLedgerService } from '../../core/ports/ICreditLedgerService.js';
import type { ICryptoPaymentProvider } from '../../core/ports/ICryptoPaymentProvider.js';
import type { X402PaymentAdapter, X402VerificationResult } from './X402PaymentAdapter.js';
import { dollarsToMicro } from '../../core/protocol/arithmetic.js';
import { logger } from '../../../utils/logger.js';

import { sqliteTimestamp } from './protocol/timestamps';

const sqliteNow = sqliteTimestamp;

// =============================================================================
// Row Types
// =============================================================================

interface CryptoPaymentRow {
  id: string;
  provider: string;
  provider_payment_id: string;
  payment_id: string;
  status: string;
  account_id: string | null;
  amount_usd_micro: number | null;
  lot_id: string | null;
  community_id: string | null;
  price_amount: number | null;
}

// =============================================================================
// PaymentServiceAdapter
// =============================================================================

export class PaymentServiceAdapter implements IPaymentService {
  private db: Database.Database;
  private ledger: ICreditLedgerService;
  private nowPayments: ICryptoPaymentProvider | null;
  private x402: X402PaymentAdapter | null;

  constructor(
    db: Database.Database,
    ledger: ICreditLedgerService,
    options?: {
      nowPayments?: ICryptoPaymentProvider;
      x402?: X402PaymentAdapter;
    },
  ) {
    this.db = db;
    this.ledger = ledger;
    this.nowPayments = options?.nowPayments ?? null;
    this.x402 = options?.x402 ?? null;
  }

  // ---------------------------------------------------------------------------
  // processWebhook
  // ---------------------------------------------------------------------------

  async processWebhook(
    provider: PaymentProvider,
    rawBody: Buffer | string,
    signature: string,
  ): Promise<WebhookProcessResult> {
    if (provider === 'nowpayments') {
      return this.processNOWPaymentsWebhook(rawBody, signature);
    }

    throw new Error(`Unsupported webhook provider: ${provider}`);
  }

  private async processNOWPaymentsWebhook(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<WebhookProcessResult> {
    if (!this.nowPayments) {
      throw new Error('NOWPayments provider not configured');
    }

    // Verify webhook signature
    const verification = this.nowPayments.verifyWebhook(rawBody, signature);
    if (!verification.valid || !verification.event) {
      throw new Error(`Webhook signature verification failed: ${verification.error}`);
    }

    const event = verification.event;
    const providerPaymentId = event.paymentId;
    const newStatus = event.status as PaymentStatus;

    // Find existing payment record
    const existing = this.db.prepare(
      `SELECT * FROM crypto_payments
       WHERE provider = 'nowpayments' AND provider_payment_id = ?`
    ).get(providerPaymentId) as CryptoPaymentRow | undefined;

    if (!existing) {
      logger.warn({
        event: 'billing.webhook.unknown_payment',
        provider: 'nowpayments',
        providerPaymentId,
      }, 'Webhook for unknown payment');
      throw new Error(`Unknown payment: ${providerPaymentId}`);
    }

    // Validate state transition
    const currentStatus = existing.status as PaymentStatus;
    if (!this.isValidTransition(currentStatus, newStatus)) {
      logger.warn({
        event: 'billing.webhook.invalid_transition',
        paymentId: existing.id,
        from: currentStatus,
        to: newStatus,
      }, `Invalid status transition: ${currentStatus} → ${newStatus}`);

      // Return existing state (idempotent for same status)
      if (currentStatus === newStatus) {
        return {
          paymentId: existing.id,
          providerPaymentId,
          status: currentStatus,
          lotId: existing.lot_id,
          amountUsdMicro: existing.amount_usd_micro ? BigInt(existing.amount_usd_micro) : null,
          duplicate: true,
        };
      }

      throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
    }

    const now = sqliteNow();
    let lotId: string | null = existing.lot_id;
    let amountUsdMicro: bigint | null = existing.amount_usd_micro
      ? BigInt(existing.amount_usd_micro)
      : null;

    // On 'finished': create credit lot
    if (newStatus === 'finished' && !existing.lot_id) {
      const priceUsd = event.priceAmount ?? existing.price_amount ?? 0;
      amountUsdMicro = dollarsToMicro(priceUsd);

      // Get or create account for the community
      if (existing.community_id) {
        const account = await this.ledger.getOrCreateAccount('community', existing.community_id);
        const lot = await this.ledger.mintLot(account.id, amountUsdMicro, 'deposit', {
          sourceId: `nowpay-${providerPaymentId}`,
          poolId: 'general',
          idempotencyKey: `webhook:nowpay:${providerPaymentId}`,
          description: `NOWPayments deposit (${event.payCurrency})`,
        });
        lotId = lot.id;

        // Update payment record with account and lot
        this.db.prepare(
          `UPDATE crypto_payments
           SET account_id = ?, amount_usd_micro = ?, lot_id = ?,
               status = ?, finished_at = ?, updated_at = ?,
               raw_payload = ?
           WHERE id = ?`
        ).run(account.id, amountUsdMicro.toString(), lotId,
          newStatus, now, now, JSON.stringify(event.rawData), existing.id);
      }
    } else if (newStatus === 'refunded') {
      // Handle refund via the refund() method
      if (existing.lot_id) {
        try {
          await this.refund(existing.id);
        } catch (err) {
          logger.error({
            event: 'billing.webhook.refund_error',
            paymentId: existing.id,
            err,
          }, 'Failed to process refund from webhook');
        }
      }
      this.db.prepare(
        `UPDATE crypto_payments SET status = ?, updated_at = ?, raw_payload = ? WHERE id = ?`
      ).run(newStatus, now, JSON.stringify(event.rawData), existing.id);
    } else {
      // Update status only
      this.db.prepare(
        `UPDATE crypto_payments SET status = ?, updated_at = ?, raw_payload = ? WHERE id = ?`
      ).run(newStatus, now, JSON.stringify(event.rawData), existing.id);
    }

    return {
      paymentId: existing.id,
      providerPaymentId,
      status: newStatus,
      lotId,
      amountUsdMicro,
      duplicate: false,
    };
  }

  // ---------------------------------------------------------------------------
  // createTopUp (x402)
  // ---------------------------------------------------------------------------

  async createTopUp(
    accountId: string,
    amountUsd: number,
    x402Payment: X402Payment,
  ): Promise<TopUpResult> {
    if (!this.x402) {
      throw new Error('x402 provider not configured');
    }

    const expectedMicro = dollarsToMicro(amountUsd);

    // Verify on-chain payment
    const verification = await this.x402.verifyPayment(x402Payment.txHash, expectedMicro);
    if (!verification.valid) {
      throw new Error(`x402 verification failed: ${verification.failureReason}`);
    }

    // Credit the full verified amount (over-payment credits full amount)
    const creditMicro = verification.amountUsdMicro;

    // Create credit lot
    const lot = await this.ledger.mintLot(accountId, creditMicro, 'deposit', {
      sourceId: `x402-${x402Payment.txHash}`,
      poolId: 'general',
      idempotencyKey: `x402:${x402Payment.txHash}`,
      description: `x402 USDC top-up (Base)`,
    });

    // Record in crypto_payments table
    const paymentId = `cp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = sqliteNow();

    this.db.prepare(
      `INSERT INTO crypto_payments
       (id, provider, provider_payment_id, payment_id,
        status, account_id, amount_usd_micro, lot_id,
        pay_amount, pay_currency, pay_address,
        price_amount, price_currency,
        actually_paid, raw_payload,
        created_at, updated_at, finished_at)
       VALUES (?, 'x402', ?, ?, 'finished', ?, ?, ?, ?, 'usdc', ?, ?, 'usd', ?, ?, ?, ?, ?)`
    ).run(
      paymentId,
      x402Payment.txHash.toLowerCase(),
      x402Payment.txHash.toLowerCase(),
      accountId,
      creditMicro.toString(),
      lot.id,
      x402Payment.amount,
      verification.to,
      amountUsd,
      x402Payment.amount,
      JSON.stringify({
        chainId: x402Payment.chainId,
        from: verification.from,
        to: verification.to,
        blockNumber: verification.blockNumber.toString(),
        confirmations: verification.confirmations.toString(),
      }),
      now, now, now,
    );

    logger.info({
      event: 'billing.x402.topup',
      paymentId,
      accountId,
      lotId: lot.id,
      amountUsdMicro: creditMicro.toString(),
      txHash: x402Payment.txHash,
    }, 'x402 top-up credited');

    return {
      paymentId,
      accountId,
      lotId: lot.id,
      amountUsdMicro: creditMicro,
      provider: 'x402',
    };
  }

  // ---------------------------------------------------------------------------
  // getStatus
  // ---------------------------------------------------------------------------

  async getStatus(paymentId: string): Promise<{
    paymentId: string;
    provider: PaymentProvider;
    status: PaymentStatus;
    amountUsdMicro: bigint | null;
  } | null> {
    const row = this.db.prepare(
      `SELECT id, provider, status, amount_usd_micro FROM crypto_payments WHERE id = ?`
    ).get(paymentId) as CryptoPaymentRow | undefined;

    if (!row) return null;

    return {
      paymentId: row.id,
      provider: row.provider as PaymentProvider,
      status: row.status as PaymentStatus,
      amountUsdMicro: row.amount_usd_micro ? BigInt(row.amount_usd_micro) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // refund (LIFO clawback)
  // ---------------------------------------------------------------------------

  async refund(paymentId: string): Promise<RefundResult> {
    const payment = this.db.prepare(
      `SELECT * FROM crypto_payments WHERE id = ?`
    ).get(paymentId) as CryptoPaymentRow | undefined;

    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    if (!payment.lot_id || !payment.account_id) {
      throw new Error(`Payment ${paymentId} has no associated lot`);
    }

    // Get lot state
    const lot = this.db.prepare(
      `SELECT available_micro, reserved_micro, consumed_micro
       FROM credit_lots WHERE id = ?`
    ).get(payment.lot_id) as {
      available_micro: string;
      reserved_micro: string;
      consumed_micro: string;
    } | undefined;

    if (!lot) {
      throw new Error(`Lot ${payment.lot_id} not found`);
    }

    const availableMicro = BigInt(lot.available_micro);
    const consumedMicro = BigInt(lot.consumed_micro);
    const now = sqliteNow();

    // Clawback available portion
    if (availableMicro > 0n) {
      this.db.prepare(
        `UPDATE credit_lots
         SET original_micro = original_micro - available_micro,
             available_micro = 0
         WHERE id = ?`
      ).run(payment.lot_id);
    }

    // Create debt for consumed portion
    let debtId: string | null = null;
    if (consumedMicro > 0n) {
      debtId = randomUUID();
      this.db.prepare(
        `INSERT INTO credit_debts (id, account_id, pool_id, debt_micro, source_payment_id, created_at)
         VALUES (?, ?, 'general', ?, ?, ?)`
      ).run(debtId, payment.account_id, consumedMicro.toString(), paymentId, now);
    }

    logger.info({
      event: 'billing.refund',
      paymentId,
      lotId: payment.lot_id,
      clawbackMicro: availableMicro.toString(),
      debtMicro: consumedMicro.toString(),
    }, 'Refund processed');

    return {
      paymentId,
      lotId: payment.lot_id,
      clawbackMicro: availableMicro,
      debtId,
      debtMicro: consumedMicro,
    };
  }

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------

  isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean {
    if (from === to) return true; // Idempotent
    const allowed = TRANSITIONS[from];
    return allowed?.includes(to) ?? false;
  }
}
