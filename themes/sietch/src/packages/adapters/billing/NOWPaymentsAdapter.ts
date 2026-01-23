/**
 * NOWPaymentsAdapter - NOWPayments Crypto Payment Implementation
 *
 * Sprint 156: NOWPayments Integration - Implements ICryptoPaymentProvider
 *
 * Features:
 * - Create crypto payments with unique blockchain addresses
 * - Price estimation for fiat-to-crypto conversion
 * - Webhook signature verification (HMAC-SHA512)
 * - Payment status polling
 * - Exponential backoff retry for network errors
 *
 * NOWPayments API: https://documenter.getpostman.com/view/7907941/S1a32n38
 *
 * @module packages/adapters/billing/NOWPaymentsAdapter
 */

import { createHmac } from 'crypto';
import { randomUUID } from 'crypto';
import type {
  ICryptoPaymentProvider,
  CryptoPaymentProvider,
  CryptoCurrency,
  CryptoPaymentStatus,
  CreateCryptoPaymentParams,
  CryptoPaymentResult,
  EstimatePriceParams,
  PriceEstimate,
  CryptoWebhookEvent,
  CryptoWebhookVerificationResult,
  NOWPaymentsConfig,
} from '../../core/ports/ICryptoPaymentProvider.js';
import { logger } from '../../../utils/logger.js';
import { getCryptoPaymentPrice } from '../../../config.js';
import {
  createCryptoPayment,
  getCryptoPaymentByPaymentId,
} from '../../../db/billing-queries.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum retry attempts for network errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1000;

/** Request timeout (ms) */
const REQUEST_TIMEOUT_MS = 30000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is a network error that should be retried
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('econnrefused') ||
      message.includes('enotfound') ||
      message.includes('etimedout') ||
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('aborted')
    );
  }
  return false;
}

/**
 * Execute a function with exponential backoff retry
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operation: string
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const error = err as Error;
      lastError = error;

      if (isNetworkError(err) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { operation, attempt, error: error.message, delay },
          'Network error, retrying NOWPayments operation'
        );
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  logger.error(
    { operation, error: lastError?.message },
    'NOWPayments operation failed after max retries'
  );
  throw lastError;
}

// =============================================================================
// NOWPayments API Response Types
// =============================================================================

interface NOWPaymentsPaymentResponse {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id?: string;
  order_description?: string;
  ipn_callback_url?: string;
  created_at?: string;
  updated_at?: string;
  actually_paid?: number;
  expiration_estimate_date?: string;
}

interface NOWPaymentsEstimateResponse {
  currency_from: string;
  currency_to: string;
  amount_from: number;
  estimated_amount: number;
}

interface NOWPaymentsCurrencyResponse {
  currencies: string[];
}

interface NOWPaymentsMinAmountResponse {
  currency_from: string;
  currency_to: string;
  min_amount: number;
}

interface NOWPaymentsStatusResponse {
  message: string;
}

interface NOWPaymentsWebhookPayload {
  payment_id: string;
  payment_status: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  order_description?: string;
  actually_paid: number;
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// NOWPaymentsAdapter Class
// =============================================================================

/**
 * NOWPayments implementation of ICryptoPaymentProvider
 *
 * Provides cryptocurrency payment processing via NOWPayments API.
 * Each payment generates a unique blockchain address for receiving funds.
 */
export class NOWPaymentsAdapter implements ICryptoPaymentProvider {
  readonly provider: CryptoPaymentProvider = 'nowpayments';

  private readonly config: NOWPaymentsConfig;
  private readonly apiUrl: string;

  constructor(config: NOWPaymentsConfig) {
    this.config = config;
    this.apiUrl =
      config.environment === 'sandbox'
        ? 'https://api-sandbox.nowpayments.io/v1'
        : 'https://api.nowpayments.io/v1';
  }

  // ---------------------------------------------------------------------------
  // Payment Operations
  // ---------------------------------------------------------------------------

  async createPayment(
    params: CreateCryptoPaymentParams
  ): Promise<CryptoPaymentResult> {
    const { communityId, tier, payCurrency, ipnCallbackUrl, successUrl, metadata } =
      params;

    // Get price for the tier
    const priceAmount = getCryptoPaymentPrice(tier);
    if (!priceAmount) {
      throw new Error(`No price configured for tier: ${tier}`);
    }

    // Generate order ID for tracking
    const orderId = `order_${randomUUID()}`;

    return withRetry(async () => {
      const response = await this.apiRequest<NOWPaymentsPaymentResponse>(
        '/payment',
        'POST',
        {
          price_amount: priceAmount,
          price_currency: 'usd',
          pay_currency: payCurrency || this.config.defaultPayCurrency,
          ipn_callback_url: ipnCallbackUrl,
          order_id: orderId,
          order_description: `Subscription: ${tier} tier for ${communityId}`,
          success_url: successUrl,
          // Additional metadata stored in order_description
          ...(metadata && {
            order_description: `${tier}|${communityId}|${JSON.stringify(metadata)}`,
          }),
        }
      );

      // Calculate expiration timestamp
      const expiresAt = response.expiration_estimate_date
        ? new Date(response.expiration_estimate_date)
        : new Date(Date.now() + this.config.paymentExpirationMinutes * 60 * 1000);

      // Store payment in our database
      const internalId = createCryptoPayment({
        paymentId: String(response.payment_id),
        communityId,
        tier,
        priceAmount: response.price_amount,
        payAmount: response.pay_amount,
        payCurrency: response.pay_currency as CryptoCurrency,
        payAddress: response.pay_address,
        orderId,
        expiresAt,
      });

      logger.info(
        {
          internalId,
          paymentId: response.payment_id,
          communityId,
          tier,
          payCurrency: response.pay_currency,
        },
        'Created NOWPayments payment'
      );

      return {
        id: internalId,
        paymentId: String(response.payment_id),
        status: this.mapPaymentStatus(response.payment_status),
        payAddress: response.pay_address,
        payAmount: response.pay_amount,
        payCurrency: response.pay_currency as CryptoCurrency,
        priceAmount: response.price_amount,
        priceCurrency: 'usd',
        expiresAt,
        createdAt: new Date(),
      };
    }, 'createPayment');
  }

  async getPaymentStatus(paymentId: string): Promise<CryptoPaymentResult | null> {
    return withRetry(async () => {
      try {
        const response = await this.apiRequest<NOWPaymentsPaymentResponse>(
          `/payment/${paymentId}`,
          'GET'
        );

        // Get internal record if exists
        const internalPayment = getCryptoPaymentByPaymentId(paymentId);

        return {
          id: internalPayment?.id || `unknown_${paymentId}`,
          paymentId: String(response.payment_id),
          status: this.mapPaymentStatus(response.payment_status),
          payAddress: response.pay_address,
          payAmount: response.pay_amount,
          payCurrency: response.pay_currency as CryptoCurrency,
          priceAmount: response.price_amount,
          priceCurrency: 'usd',
          expiresAt: response.expiration_estimate_date
            ? new Date(response.expiration_estimate_date)
            : internalPayment?.expiresAt || new Date(),
          createdAt: response.created_at
            ? new Date(response.created_at)
            : internalPayment?.createdAt || new Date(),
        };
      } catch (err) {
        const error = err as Error;
        // Return null for 404 errors
        if (error.message?.includes('404') || error.message?.includes('not found')) {
          return null;
        }
        throw err;
      }
    }, 'getPaymentStatus');
  }

  // ---------------------------------------------------------------------------
  // Currency Operations
  // ---------------------------------------------------------------------------

  async getSupportedCurrencies(): Promise<CryptoCurrency[]> {
    return withRetry(async () => {
      const response = await this.apiRequest<NOWPaymentsCurrencyResponse>(
        '/currencies',
        'GET'
      );

      // Filter to supported currencies that we handle
      const supportedCurrencies: CryptoCurrency[] = [
        'btc',
        'eth',
        'usdt',
        'usdc',
        'ltc',
        'doge',
        'matic',
        'sol',
      ];

      return response.currencies.filter((c) =>
        supportedCurrencies.includes(c.toLowerCase() as CryptoCurrency)
      ) as CryptoCurrency[];
    }, 'getSupportedCurrencies');
  }

  async getMinimumPaymentAmount(currency: CryptoCurrency): Promise<number> {
    return withRetry(async () => {
      const response = await this.apiRequest<NOWPaymentsMinAmountResponse>(
        '/min-amount',
        'GET',
        undefined,
        { currency_from: 'usd', currency_to: currency }
      );

      return response.min_amount;
    }, 'getMinimumPaymentAmount');
  }

  async estimatePrice(params: EstimatePriceParams): Promise<PriceEstimate> {
    const { amount, currency } = params;

    return withRetry(async () => {
      const response = await this.apiRequest<NOWPaymentsEstimateResponse>(
        '/estimate',
        'GET',
        undefined,
        {
          amount: String(amount),
          currency_from: 'usd',
          currency_to: currency,
        }
      );

      return {
        fiatAmount: amount,
        fiatCurrency: 'usd',
        cryptoAmount: response.estimated_amount,
        cryptoCurrency: currency,
        estimatedAt: new Date(),
      };
    }, 'estimatePrice');
  }

  // ---------------------------------------------------------------------------
  // Webhook Processing
  // ---------------------------------------------------------------------------

  verifyWebhook(
    rawBody: string | Buffer,
    signature: string
  ): CryptoWebhookVerificationResult {
    // Validate IPN secret is configured
    if (!this.config.ipnSecretKey) {
      return {
        valid: false,
        error: 'IPN secret key not configured',
      };
    }

    try {
      const bodyString = rawBody.toString();

      // NOWPayments uses HMAC-SHA512 for webhook verification
      // The signature is computed over the raw JSON body (sorted keys)
      const computedSignature = createHmac('sha512', this.config.ipnSecretKey)
        .update(bodyString)
        .digest('hex');

      if (computedSignature !== signature) {
        logger.warn({ received: signature }, 'Invalid NOWPayments webhook signature');
        return {
          valid: false,
          error: 'Invalid webhook signature',
        };
      }

      // Parse the payload
      const payload: NOWPaymentsWebhookPayload = JSON.parse(bodyString);

      // Normalize the event
      const event: CryptoWebhookEvent = {
        paymentId: String(payload.payment_id),
        status: this.mapPaymentStatus(payload.payment_status),
        actuallyPaid: payload.actually_paid,
        payCurrency: payload.pay_currency.toLowerCase() as CryptoCurrency,
        priceAmount: payload.price_amount,
        orderId: payload.order_id,
        orderDescription: payload.order_description,
        timestamp: payload.updated_at ? new Date(payload.updated_at) : new Date(),
        rawData: payload as unknown as Record<string, unknown>,
      };

      logger.debug(
        { paymentId: event.paymentId, status: event.status },
        'Verified NOWPayments webhook'
      );

      return {
        valid: true,
        event,
      };
    } catch (err) {
      const error = err as Error;
      logger.warn({ error: error.message }, 'Error verifying NOWPayments webhook');
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.apiRequest<NOWPaymentsStatusResponse>(
        '/status',
        'GET'
      );
      return response.message === 'OK';
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Make an API request to NOWPayments
   */
  private async apiRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<T> {
    let url = `${this.apiUrl}${endpoint}`;

    // Add query parameters for GET requests
    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      url = `${url}?${params.toString()}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { endpoint, status: response.status, error: errorText },
          'NOWPayments API error'
        );
        throw new Error(`NOWPayments API error: ${response.status} - ${errorText}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map NOWPayments status to normalized CryptoPaymentStatus
   */
  private mapPaymentStatus(providerStatus: string): CryptoPaymentStatus {
    const statusMap: Record<string, CryptoPaymentStatus> = {
      waiting: 'waiting',
      confirming: 'confirming',
      confirmed: 'confirmed',
      sending: 'sending',
      partially_paid: 'partially_paid',
      finished: 'finished',
      failed: 'failed',
      refunded: 'refunded',
      expired: 'expired',
    };

    return statusMap[providerStatus.toLowerCase()] || 'waiting';
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a NOWPaymentsAdapter instance
 */
export function createNOWPaymentsAdapter(
  config: NOWPaymentsConfig
): ICryptoPaymentProvider {
  return new NOWPaymentsAdapter(config);
}
