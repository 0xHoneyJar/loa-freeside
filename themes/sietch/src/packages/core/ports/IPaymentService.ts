/**
 * IPaymentService - Payment Orchestration Port
 *
 * Orchestrates payment processing across providers (NOWPayments, x402).
 * Delegates to provider-specific adapters and creates credit lots on success.
 *
 * SDD refs: §5.3 Top-Up Endpoint, §5.4 Payment State Machine
 * Sprint refs: Task 2.2
 *
 * @module packages/core/ports/IPaymentService
 */

import type { PaymentState } from '../protocol/index.js';
import { PAYMENT_MACHINE, isValidTransition as protocolIsValid } from '../protocol/index.js';

// =============================================================================
// Provider Types
// =============================================================================

/** Supported payment providers */
export type PaymentProvider = 'nowpayments' | 'x402';

// =============================================================================
// Payment Status & State Machine
// =============================================================================

/**
 * Unified payment status across providers.
 * State machine: waiting → confirming → confirmed → finished
 *                                   ↘ failed
 *                                   ↘ expired
 * Terminal states: finished, failed, refunded, expired
 */
export type PaymentStatus =
  | 'waiting'
  | 'confirming'
  | 'confirmed'
  | 'sending'
  | 'partially_paid'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired';

/** Terminal payment statuses — no further transitions allowed */
export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  'finished', 'failed', 'refunded', 'expired',
]);

/**
 * Allowed status transitions per SDD §5.4.
 * Forward jumps are allowed (e.g., waiting → finished).
 * Regression transitions are rejected (e.g., finished → confirming).
 */
export const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  waiting: ['confirming', 'confirmed', 'sending', 'finished', 'failed', 'expired', 'partially_paid'],
  confirming: ['confirmed', 'sending', 'finished', 'failed'],
  confirmed: ['sending', 'finished', 'failed'],
  sending: ['finished', 'failed'],
  partially_paid: ['confirming', 'confirmed', 'sending', 'finished', 'failed', 'expired'],
  finished: ['refunded'],
  failed: [],
  refunded: [],
  expired: [],
};

// =============================================================================
// Webhook Types
// =============================================================================

export interface WebhookProcessResult {
  /** Payment internal ID */
  paymentId: string;
  /** Provider-specific payment ID */
  providerPaymentId: string;
  /** Updated status */
  status: PaymentStatus;
  /** Credit lot created (if finished) */
  lotId: string | null;
  /** Amount in micro-USD (if finished) */
  amountUsdMicro: bigint | null;
  /** Whether this was a duplicate webhook (idempotent) */
  duplicate: boolean;
}

// =============================================================================
// Top-Up Types
// =============================================================================

export interface X402Payment {
  /** Transaction hash on Base chain */
  txHash: string;
  /** Chain ID (8453 for Base) */
  chainId: number;
  /** Sender address */
  from: string;
  /** USDC amount (in token decimals) */
  amount: string;
}

export interface TopUpResult {
  /** Internal payment ID */
  paymentId: string;
  /** Credit account ID */
  accountId: string;
  /** Credit lot ID */
  lotId: string;
  /** Amount credited in micro-USD */
  amountUsdMicro: bigint;
  /** Provider used */
  provider: PaymentProvider;
}

// =============================================================================
// Refund Types
// =============================================================================

export interface RefundResult {
  /** Payment being refunded */
  paymentId: string;
  /** Lot that was clawed back */
  lotId: string;
  /** Amount available that was clawed back */
  clawbackMicro: bigint;
  /** Debt created for consumed portion */
  debtId: string | null;
  /** Debt amount (consumed portion that can't be returned) */
  debtMicro: bigint;
}

// =============================================================================
// IPaymentService Interface
// =============================================================================

export interface IPaymentService {
  /**
   * Process a webhook from a payment provider.
   * On 'finished' status: creates credit lot + deposit ledger entry.
   * On 'refunded' status: triggers clawback + debt creation.
   * Idempotent — duplicate webhooks return existing result.
   */
  processWebhook(
    provider: PaymentProvider,
    rawBody: Buffer | string,
    signature: string,
  ): Promise<WebhookProcessResult>;

  /**
   * Process an x402 top-up payment.
   * Verifies on-chain transaction, creates lot on success.
   */
  createTopUp(
    accountId: string,
    amountUsd: number,
    x402Payment: X402Payment,
  ): Promise<TopUpResult>;

  /**
   * Get payment status by internal payment ID.
   */
  getStatus(paymentId: string): Promise<{
    paymentId: string;
    provider: PaymentProvider;
    status: PaymentStatus;
    amountUsdMicro: bigint | null;
  } | null>;

  /**
   * Process a refund for a payment.
   * Claws back lot in LIFO order; creates debt for consumed portion.
   */
  refund(paymentId: string): Promise<RefundResult>;

  /**
   * Validate a status transition.
   * Returns true if the transition is allowed per the state machine.
   */
  isValidTransition(from: PaymentStatus, to: PaymentStatus): boolean;
}
