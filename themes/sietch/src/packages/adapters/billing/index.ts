/**
 * Billing Adapters
 *
 * Sprint 1: Paddle Migration - Billing provider implementations
 * Sprint 156: NOWPayments Integration - Crypto payment provider
 *
 * Exports:
 * - PaddleBillingAdapter: Paddle payment provider implementation
 * - NOWPaymentsAdapter: NOWPayments crypto payment provider implementation
 * - createBillingProvider: Factory function for provider instantiation
 * - createCryptoPaymentProvider: Factory function for crypto provider instantiation
 *
 * @module packages/adapters/billing
 */

export { PaddleBillingAdapter } from './PaddleBillingAdapter.js';
export { NOWPaymentsAdapter, createNOWPaymentsAdapter } from './NOWPaymentsAdapter.js';

// Re-export types from port for convenience
export type {
  IBillingProvider,
  BillingProvider,
  SubscriptionTier,
  SubscriptionStatus,
  CreateCheckoutParams,
  CheckoutResult,
  CreateOneTimeCheckoutParams,
  CreatePortalParams,
  PortalResult,
  ProviderSubscription,
  ProviderCustomer,
  WebhookVerificationResult,
  ProviderWebhookEvent,
  NormalizedEventType,
  PaddleConfig,
  BillingConfig,
  BillingProviderFactory,
} from '../../core/ports/IBillingProvider.js';

// Re-export crypto payment types from port for convenience
export type {
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
  CryptoPaymentConfig,
  CryptoPaymentProviderFactory,
} from '../../core/ports/ICryptoPaymentProvider.js';

import type {
  IBillingProvider,
  BillingConfig,
} from '../../core/ports/IBillingProvider.js';
import type {
  ICryptoPaymentProvider,
  CryptoPaymentConfig,
} from '../../core/ports/ICryptoPaymentProvider.js';
import { PaddleBillingAdapter } from './PaddleBillingAdapter.js';
import { NOWPaymentsAdapter } from './NOWPaymentsAdapter.js';

/**
 * Factory function for creating billing providers
 *
 * @param config - Billing configuration
 * @returns Billing provider instance
 * @throws Error if provider is not supported or config is invalid
 *
 * @example
 * ```typescript
 * const provider = createBillingProvider({
 *   provider: 'paddle',
 *   paddle: {
 *     apiKey: process.env.PADDLE_API_KEY,
 *     webhookSecret: process.env.PADDLE_WEBHOOK_SECRET,
 *     environment: 'production',
 *     clientToken: process.env.PADDLE_CLIENT_TOKEN,
 *     priceIds: new Map([['basic', 'pri_xxx']]),
 *     oneTimePriceIds: { badge: 'pri_badge', ... },
 *   },
 * });
 * ```
 */
export function createBillingProvider(config: BillingConfig): IBillingProvider {
  switch (config.provider) {
    case 'paddle':
      if (!config.paddle) {
        throw new Error('Paddle configuration required when provider is paddle');
      }
      return new PaddleBillingAdapter(config.paddle);

    case 'stripe':
      // Stripe support removed - keeping case for error message clarity
      throw new Error(
        'Stripe provider is no longer supported. Please use Paddle.'
      );

    default:
      throw new Error(`Unsupported billing provider: ${config.provider}`);
  }
}

/**
 * Factory function for creating crypto payment providers
 *
 * @param config - Crypto payment configuration
 * @returns Crypto payment provider instance
 * @throws Error if provider is not supported or config is invalid
 *
 * @example
 * ```typescript
 * const provider = createCryptoPaymentProvider({
 *   provider: 'nowpayments',
 *   nowpayments: {
 *     apiKey: process.env.NOWPAYMENTS_API_KEY,
 *     ipnSecretKey: process.env.NOWPAYMENTS_IPN_SECRET,
 *     environment: 'production',
 *     defaultPayCurrency: 'btc',
 *     paymentExpirationMinutes: 20,
 *   },
 * });
 * ```
 */
export function createCryptoPaymentProvider(
  config: CryptoPaymentConfig
): ICryptoPaymentProvider {
  switch (config.provider) {
    case 'nowpayments':
      if (!config.nowpayments) {
        throw new Error(
          'NOWPayments configuration required when provider is nowpayments'
        );
      }
      return new NOWPaymentsAdapter(config.nowpayments);

    default:
      throw new Error(`Unsupported crypto payment provider: ${config.provider}`);
  }
}
