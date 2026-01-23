/**
 * ICryptoPaymentProvider - Crypto Payment Provider Port
 *
 * Sprint 155: NOWPayments Integration - Phase 1 of crypto payment support
 *
 * Architecture:
 * - Provider-agnostic interface for crypto payment processing
 * - Follows hexagonal architecture pattern established by IBillingProvider
 * - Designed for one-time payments (crypto doesn't support true recurring)
 * - Parallel to IBillingProvider, not replacing it
 *
 * @module packages/core/ports/ICryptoPaymentProvider
 */

import type { SubscriptionTier } from './IBillingProvider.js';

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Supported crypto payment providers
 */
export type CryptoPaymentProvider = 'nowpayments';

// =============================================================================
// Currency Types
// =============================================================================

/**
 * Supported cryptocurrencies for payment
 */
export type CryptoCurrency =
  | 'btc'    // Bitcoin
  | 'eth'    // Ethereum
  | 'usdt'   // Tether (ERC-20)
  | 'usdc'   // USD Coin
  | 'ltc'    // Litecoin
  | 'doge'   // Dogecoin
  | 'matic'  // Polygon
  | 'sol';   // Solana

// =============================================================================
// Payment Status Types
// =============================================================================

/**
 * Crypto payment status (NOWPayments statuses)
 */
export type CryptoPaymentStatus =
  | 'waiting'        // Waiting for customer payment
  | 'confirming'     // Payment received, waiting for confirmations
  | 'confirmed'      // Payment confirmed, not yet credited
  | 'sending'        // Sending funds to merchant
  | 'partially_paid' // Partial payment received
  | 'finished'       // Payment completed successfully
  | 'failed'         // Payment failed
  | 'refunded'       // Payment refunded
  | 'expired';       // Payment expired

// =============================================================================
// Payment Creation Types
// =============================================================================

/**
 * Create crypto payment parameters
 */
export interface CreateCryptoPaymentParams {
  /** Community identifier */
  communityId: string;
  /** Target subscription tier */
  tier: SubscriptionTier;
  /** Preferred crypto currency (optional, defaults to provider default) */
  payCurrency?: CryptoCurrency;
  /** IPN callback URL for webhooks */
  ipnCallbackUrl: string;
  /** Success redirect URL (optional) */
  successUrl?: string;
  /** Cancel redirect URL (optional) */
  cancelUrl?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Crypto payment result
 */
export interface CryptoPaymentResult {
  /** Internal payment ID (UUID, e.g., cp_xxx) */
  id: string;
  /** Provider payment ID (e.g., NOWPayments payment_id) */
  paymentId: string;
  /** Payment status */
  status: CryptoPaymentStatus;
  /** Crypto address to pay to */
  payAddress: string;
  /** Amount in crypto to pay */
  payAmount: number;
  /** Crypto currency */
  payCurrency: CryptoCurrency;
  /** Price in fiat (USD) */
  priceAmount: number;
  /** Price currency (always 'usd') */
  priceCurrency: 'usd';
  /** Expiration timestamp */
  expiresAt: Date;
  /** Created timestamp */
  createdAt: Date;
}

// =============================================================================
// Price Estimation Types
// =============================================================================

/**
 * Price estimate parameters
 */
export interface EstimatePriceParams {
  /** Amount in fiat (USD) */
  amount: number;
  /** Target crypto currency */
  currency: CryptoCurrency;
}

/**
 * Price estimate result
 */
export interface PriceEstimate {
  /** Original fiat amount */
  fiatAmount: number;
  /** Fiat currency */
  fiatCurrency: 'usd';
  /** Estimated crypto amount */
  cryptoAmount: number;
  /** Crypto currency */
  cryptoCurrency: CryptoCurrency;
  /** Estimate timestamp */
  estimatedAt: Date;
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Crypto webhook event (normalized from provider)
 */
export interface CryptoWebhookEvent {
  /** Provider payment ID */
  paymentId: string;
  /** Payment status */
  status: CryptoPaymentStatus;
  /** Amount actually paid (may differ from requested) */
  actuallyPaid: number;
  /** Pay currency */
  payCurrency: CryptoCurrency;
  /** Price amount in fiat */
  priceAmount: number;
  /** Order ID (our internal reference) */
  orderId: string;
  /** Order description */
  orderDescription?: string;
  /** Event timestamp */
  timestamp: Date;
  /** Raw event data for debugging */
  rawData: Record<string, unknown>;
}

/**
 * Webhook verification result
 */
export interface CryptoWebhookVerificationResult {
  /** Whether signature is valid */
  valid: boolean;
  /** Parsed event (if valid) */
  event?: CryptoWebhookEvent;
  /** Error message (if invalid) */
  error?: string;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * NOWPayments-specific configuration
 */
export interface NOWPaymentsConfig {
  /** API key for authentication */
  apiKey: string;
  /** IPN secret key for webhook verification */
  ipnSecretKey: string;
  /** Public key for client-side (optional) */
  publicKey?: string;
  /** Environment */
  environment: 'sandbox' | 'production';
  /** Default payment currency */
  defaultPayCurrency: CryptoCurrency;
  /** Payment expiration in minutes (default: 20) */
  paymentExpirationMinutes: number;
}

/**
 * Crypto payment provider configuration
 */
export interface CryptoPaymentConfig {
  /** Active provider */
  provider: CryptoPaymentProvider;
  /** NOWPayments configuration (if provider is nowpayments) */
  nowpayments?: NOWPaymentsConfig;
}

// =============================================================================
// ICryptoPaymentProvider Interface
// =============================================================================

/**
 * ICryptoPaymentProvider - Crypto Payment Provider Port
 *
 * Provider-agnostic interface for cryptocurrency payment processing.
 * Follows hexagonal architecture pattern established by IBillingProvider.
 *
 * Key differences from IBillingProvider:
 * - One-time payments only (crypto doesn't support true recurring)
 * - Unique payment address per transaction
 * - Price volatility handled via short expiration windows
 *
 * Implementations:
 * - NOWPaymentsAdapter (primary)
 * - Future: Other crypto payment providers
 */
export interface ICryptoPaymentProvider {
  /**
   * Get the provider identifier
   */
  readonly provider: CryptoPaymentProvider;

  // ---------------------------------------------------------------------------
  // Payment Operations
  // ---------------------------------------------------------------------------

  /**
   * Create a crypto payment
   *
   * Generates a unique payment address for the specified amount and currency.
   * The payment expires after the configured duration (default: 20 minutes).
   *
   * @param params - Payment creation parameters
   * @returns Payment result with address and amount
   *
   * @example
   * ```typescript
   * const payment = await provider.createPayment({
   *   communityId: 'community-123',
   *   tier: 'premium',
   *   payCurrency: 'btc',
   *   ipnCallbackUrl: 'https://api.example.com/billing/crypto/webhook',
   * });
   * // User sends payment.payAmount BTC to payment.payAddress
   * ```
   */
  createPayment(params: CreateCryptoPaymentParams): Promise<CryptoPaymentResult>;

  /**
   * Get payment status by provider payment ID
   *
   * @param paymentId - Provider payment ID
   * @returns Current payment status or null if not found
   */
  getPaymentStatus(paymentId: string): Promise<CryptoPaymentResult | null>;

  // ---------------------------------------------------------------------------
  // Currency Operations
  // ---------------------------------------------------------------------------

  /**
   * Get list of supported currencies
   *
   * Returns currencies that are both supported by the provider and
   * configured for this integration.
   *
   * @returns Array of supported currency codes
   */
  getSupportedCurrencies(): Promise<CryptoCurrency[]>;

  /**
   * Get minimum payment amount for a currency
   *
   * Below this amount, payments will fail or be rejected.
   *
   * @param currency - Crypto currency
   * @returns Minimum amount in that currency
   */
  getMinimumPaymentAmount(currency: CryptoCurrency): Promise<number>;

  /**
   * Get price estimate for a payment
   *
   * Converts a fiat amount to the estimated crypto amount.
   * Note: Actual payment amount may differ due to price volatility.
   *
   * @param params - Estimation parameters
   * @returns Price estimate
   *
   * @example
   * ```typescript
   * const estimate = await provider.estimatePrice({
   *   amount: 29,
   *   currency: 'btc',
   * });
   * // estimate.cryptoAmount = 0.00025 (example)
   * ```
   */
  estimatePrice(params: EstimatePriceParams): Promise<PriceEstimate>;

  // ---------------------------------------------------------------------------
  // Webhook Processing
  // ---------------------------------------------------------------------------

  /**
   * Verify webhook signature and parse payload
   *
   * Validates the signature using the provider's verification method
   * (e.g., HMAC-SHA512 for NOWPayments) and parses the event.
   *
   * @param rawBody - Raw request body (string or Buffer)
   * @param signature - Signature header value (e.g., x-nowpayments-sig)
   * @returns Verification result with parsed event
   *
   * @example
   * ```typescript
   * const result = provider.verifyWebhook(req.rawBody, req.headers['x-nowpayments-sig']);
   * if (result.valid && result.event) {
   *   await processEvent(result.event);
   * }
   * ```
   */
  verifyWebhook(
    rawBody: string | Buffer,
    signature: string
  ): CryptoWebhookVerificationResult;

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  /**
   * Check if the payment provider is healthy
   *
   * Makes a lightweight API call to verify connectivity and authentication.
   *
   * @returns true if provider is responding
   */
  isHealthy(): Promise<boolean>;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Factory function type for creating crypto payment providers
 */
export type CryptoPaymentProviderFactory = (
  config: CryptoPaymentConfig
) => ICryptoPaymentProvider;
