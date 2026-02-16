/**
 * IPayoutProvider — Payout Provider Port
 *
 * Provider-agnostic interface for cryptocurrency payouts to creators.
 * Follows hexagonal architecture pattern established by ICryptoPaymentProvider.
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Task 8.2
 *
 * @module packages/core/ports/IPayoutProvider
 */

// =============================================================================
// Types
// =============================================================================

export interface PayoutRequest {
  /** Idempotency key (deterministic per payout request) */
  idempotencyKey: string;
  /** Amount in crypto to pay out */
  amount: number;
  /** Crypto currency (e.g., 'usdc', 'usdt') */
  currency: string;
  /** Destination wallet address */
  address: string;
  /** Optional callback URL for status updates */
  ipnCallbackUrl?: string;
}

export interface PayoutResult {
  /** Provider-assigned payout ID */
  providerPayoutId: string;
  /** Current status */
  status: PayoutStatus;
  /** Amount sent */
  amount: number;
  /** Currency */
  currency: string;
  /** Destination address */
  address: string;
  /** Transaction hash (if completed) */
  hash?: string;
  /** Error message (if failed) */
  error?: string;
  /** Created timestamp */
  createdAt: Date;
}

export type PayoutStatus =
  | 'waiting'
  | 'confirming'
  | 'sending'
  | 'finished'
  | 'failed'
  | 'expired'
  | 'unknown';

export interface PayoutQuote {
  /** Estimated fee in crypto */
  feeCrypto: number;
  /** Estimated fee in USD micro-units */
  feeUsdMicro: number;
  /** Quote currency */
  currency: string;
  /** Quote valid until */
  expiresAt: Date;
}

// =============================================================================
// IPayoutProvider Interface
// =============================================================================

export interface IPayoutProvider {
  /**
   * Create a payout to a destination address.
   * Uses idempotency key for safe retry.
   */
  createPayout(request: PayoutRequest): Promise<PayoutResult>;

  /**
   * Get current payout status from provider.
   * Used for reconciliation polling.
   */
  getPayoutStatus(providerPayoutId: string): Promise<PayoutResult | null>;

  /**
   * Get fee estimate for a payout.
   * Returns quote with TTL for UI display.
   */
  getEstimate(amount: number, currency: string): Promise<PayoutQuote>;
}
