/**
 * Billing Adapters
 *
 * Sprint 1: Paddle Migration - Billing provider implementations
 *
 * Exports:
 * - PaddleBillingAdapter: Paddle payment provider implementation
 * - createBillingProvider: Factory function for provider instantiation
 *
 * @module packages/adapters/billing
 */

export { PaddleBillingAdapter } from './PaddleBillingAdapter.js';

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

import type {
  IBillingProvider,
  BillingConfig,
} from '../../core/ports/IBillingProvider.js';
import { PaddleBillingAdapter } from './PaddleBillingAdapter.js';

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
