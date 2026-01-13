/**
 * PaddleBillingAdapter - Paddle Billing Implementation
 *
 * Sprint 1: Paddle Migration - Implements IBillingProvider for Paddle
 *
 * Features:
 * - Checkout session creation (subscription + one-time)
 * - Customer management with metadata
 * - Webhook signature verification (HMAC-SHA256)
 * - Subscription lifecycle management
 * - Exponential backoff retry for network errors
 *
 * @module packages/adapters/billing/PaddleBillingAdapter
 */

import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import type {
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
} from '../../core/ports/IBillingProvider.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum retry attempts for network errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1000;

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
      message.includes('fetch failed')
    );
  }
  return false;
}

/**
 * Execute a function with exponential backoff retry
 *
 * @param fn - Async function to execute
 * @param operation - Operation name for logging
 * @returns Result of the function
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

      // Retry on network errors
      if (isNetworkError(err)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { operation, attempt, error: error.message, delay },
          'Network error, retrying Paddle operation'
        );
        await sleep(delay);
        continue;
      }

      // Don't retry on other errors (API errors, validation, etc.)
      throw err;
    }
  }

  logger.error(
    { operation, error: lastError?.message },
    'Paddle operation failed after max retries'
  );
  throw lastError;
}

// =============================================================================
// Paddle Event Types (for type safety)
// =============================================================================

interface PaddleWebhookEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

interface PaddleSubscription {
  id: string;
  customerId: string;
  status: string;
  customData?: Record<string, unknown>;
  items?: Array<{ price?: { id: string } }>;
  currentBillingPeriod: {
    startsAt: string;
    endsAt: string;
  };
  scheduledChange?: {
    action: string;
  } | null;
}

interface PaddleCustomer {
  id: string;
  email: string;
  name?: string;
  customData?: Record<string, unknown>;
}

interface PaddleTransaction {
  id: string;
  checkout?: {
    url: string;
  };
}

// =============================================================================
// PaddleBillingAdapter Class
// =============================================================================

/**
 * Paddle implementation of IBillingProvider
 *
 * Uses official @paddle/paddle-node-sdk for API interactions.
 */
export class PaddleBillingAdapter implements IBillingProvider {
  readonly provider: BillingProvider = 'paddle';

  private paddle: Paddle | null = null;
  private readonly config: PaddleConfig;

  constructor(config: PaddleConfig) {
    this.config = config;
  }

  /**
   * Get or initialize Paddle client (lazy initialization)
   */
  private getClient(): Paddle {
    if (!this.paddle) {
      if (!this.config.apiKey) {
        throw new Error('Paddle API key not configured');
      }

      this.paddle = new Paddle(this.config.apiKey, {
        environment:
          this.config.environment === 'production'
            ? Environment.production
            : Environment.sandbox,
      });
    }
    return this.paddle;
  }

  // ---------------------------------------------------------------------------
  // Customer Management
  // ---------------------------------------------------------------------------

  async getOrCreateCustomer(
    communityId: string,
    email?: string,
    name?: string
  ): Promise<string> {
    const paddle = this.getClient();

    return withRetry(async () => {
      // List customers and find one with matching community_id in customData
      // Paddle doesn't have a search by metadata, so we need to iterate
      // In practice, we'd store the mapping in our database
      const customersCollection = paddle.customers.list();

      for await (const customer of customersCollection) {
        const customData = customer.customData as Record<string, string> | undefined;
        if (customData?.community_id === communityId) {
          logger.debug(
            { communityId, customerId: customer.id },
            'Found existing Paddle customer'
          );
          return customer.id;
        }
      }

      // Create new customer if not found
      const customer = await paddle.customers.create({
        email: email || `community-${communityId}@arrakis.thj.bot`,
        name,
        customData: {
          community_id: communityId,
        },
      });

      logger.info(
        { communityId, customerId: customer.id },
        'Created new Paddle customer'
      );

      return customer.id;
    }, 'getOrCreateCustomer');
  }

  async getCustomer(customerId: string): Promise<ProviderCustomer | null> {
    const paddle = this.getClient();

    return withRetry(async () => {
      try {
        const customer = await paddle.customers.get(customerId) as PaddleCustomer;
        return {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          metadata: (customer.customData as Record<string, string>) || {},
        };
      } catch (err) {
        const error = err as Error;
        // Return null if customer not found
        if (
          error.message?.includes('not found') ||
          error.message?.includes('404')
        ) {
          return null;
        }
        throw err;
      }
    }, 'getCustomer');
  }

  // ---------------------------------------------------------------------------
  // Checkout Sessions
  // ---------------------------------------------------------------------------

  async createCheckoutSession(
    params: CreateCheckoutParams
  ): Promise<CheckoutResult> {
    const paddle = this.getClient();
    const { communityId, tier, successUrl, cancelUrl, customerId, metadata } =
      params;

    // Get price ID for the tier
    const priceId = this.config.priceIds.get(tier);
    if (!priceId) {
      throw new Error(`No Paddle price ID configured for tier: ${tier}`);
    }

    // Get or create customer if not provided
    const paddleCustomerId =
      customerId || (await this.getOrCreateCustomer(communityId));

    return withRetry(async () => {
      // Paddle uses transactions for checkout
      const transaction = (await paddle.transactions.create({
        items: [
          {
            priceId,
            quantity: 1,
          },
        ],
        customerId: paddleCustomerId,
        customData: {
          community_id: communityId,
          tier,
          ...metadata,
        },
        checkout: {
          url: successUrl,
        },
      })) as PaddleTransaction;

      if (!transaction.checkout?.url) {
        throw new Error('Paddle transaction created without checkout URL');
      }

      logger.info(
        { communityId, tier, transactionId: transaction.id },
        'Created Paddle checkout session'
      );

      return {
        sessionId: transaction.id,
        url: transaction.checkout.url,
        clientToken: this.config.clientToken,
      };
    }, 'createCheckoutSession');
  }

  async createOneTimeCheckoutSession(
    params: CreateOneTimeCheckoutParams
  ): Promise<CheckoutResult> {
    const paddle = this.getClient();

    return withRetry(async () => {
      const transaction = (await paddle.transactions.create({
        items: [
          {
            priceId: params.priceId,
            quantity: 1,
          },
        ],
        customerId: params.customerId,
        customData: params.metadata,
        checkout: {
          url: params.successUrl,
        },
      })) as PaddleTransaction;

      if (!transaction.checkout?.url) {
        throw new Error('Paddle transaction created without checkout URL');
      }

      logger.info(
        { customerId: params.customerId, transactionId: transaction.id },
        'Created Paddle one-time checkout session'
      );

      return {
        sessionId: transaction.id,
        url: transaction.checkout.url,
        clientToken: this.config.clientToken,
      };
    }, 'createOneTimeCheckoutSession');
  }

  // ---------------------------------------------------------------------------
  // Customer Portal
  // ---------------------------------------------------------------------------

  async createPortalSession(params: CreatePortalParams): Promise<PortalResult> {
    // Import dynamically to avoid circular dependencies
    const { getSubscriptionByCommunityId } = await import(
      '../../../db/billing-queries.js'
    );
    const subscription = getSubscriptionByCommunityId(params.communityId);

    // Security: Generic error message to prevent customer enumeration
    // Don't reveal whether community has no subscription vs no customer
    if (!subscription?.paymentCustomerId) {
      throw new Error('Unable to create portal session');
    }

    // Paddle's customer portal is accessed via a URL pattern
    // The portal allows customers to manage subscriptions, update payment methods, etc.
    const portalBaseUrl =
      this.config.environment === 'production'
        ? 'https://customer-portal.paddle.com'
        : 'https://sandbox-customer-portal.paddle.com';

    const portalUrl = `${portalBaseUrl}/cpl_${subscription.paymentCustomerId}`;

    logger.info(
      { communityId: params.communityId, customerId: subscription.paymentCustomerId },
      'Created Paddle Portal session URL'
    );

    return {
      url: portalUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // Subscription Management
  // ---------------------------------------------------------------------------

  async getSubscription(
    subscriptionId: string
  ): Promise<ProviderSubscription | null> {
    const paddle = this.getClient();

    return withRetry(async () => {
      try {
        const subscription = (await paddle.subscriptions.get(
          subscriptionId
        )) as PaddleSubscription;

        return {
          id: subscription.id,
          customerId: subscription.customerId,
          status: this.mapSubscriptionStatus(subscription.status),
          tier: this.extractTierFromSubscription(subscription),
          currentPeriodStart: new Date(subscription.currentBillingPeriod.startsAt),
          currentPeriodEnd: new Date(subscription.currentBillingPeriod.endsAt),
          cancelAtPeriodEnd: subscription.scheduledChange?.action === 'cancel',
          metadata: (subscription.customData as Record<string, string>) || {},
        };
      } catch (err) {
        const error = err as Error;
        if (
          error.message?.includes('not found') ||
          error.message?.includes('404')
        ) {
          return null;
        }
        throw err;
      }
    }, 'getSubscription');
  }

  async cancelSubscription(
    subscriptionId: string
  ): Promise<ProviderSubscription> {
    const paddle = this.getClient();

    return withRetry(async () => {
      const subscription = (await paddle.subscriptions.cancel(subscriptionId, {
        effectiveFrom: 'next_billing_period',
      })) as PaddleSubscription;

      logger.info({ subscriptionId }, 'Canceled Paddle subscription at period end');

      return {
        id: subscription.id,
        customerId: subscription.customerId,
        status: this.mapSubscriptionStatus(subscription.status),
        tier: this.extractTierFromSubscription(subscription),
        currentPeriodStart: new Date(subscription.currentBillingPeriod.startsAt),
        currentPeriodEnd: new Date(subscription.currentBillingPeriod.endsAt),
        cancelAtPeriodEnd: true,
        metadata: (subscription.customData as Record<string, string>) || {},
      };
    }, 'cancelSubscription');
  }

  async resumeSubscription(
    subscriptionId: string
  ): Promise<ProviderSubscription> {
    const paddle = this.getClient();

    return withRetry(async () => {
      // Remove scheduled cancellation by updating with null
      const subscription = (await paddle.subscriptions.update(subscriptionId, {
        scheduledChange: null,
      })) as PaddleSubscription;

      logger.info({ subscriptionId }, 'Resumed Paddle subscription');

      return {
        id: subscription.id,
        customerId: subscription.customerId,
        status: this.mapSubscriptionStatus(subscription.status),
        tier: this.extractTierFromSubscription(subscription),
        currentPeriodStart: new Date(subscription.currentBillingPeriod.startsAt),
        currentPeriodEnd: new Date(subscription.currentBillingPeriod.endsAt),
        cancelAtPeriodEnd: false,
        metadata: (subscription.customData as Record<string, string>) || {},
      };
    }, 'resumeSubscription');
  }

  async updateSubscriptionTier(
    subscriptionId: string,
    newTier: SubscriptionTier
  ): Promise<ProviderSubscription> {
    const paddle = this.getClient();

    const priceId = this.config.priceIds.get(newTier);
    if (!priceId) {
      throw new Error(`No Paddle price ID configured for tier: ${newTier}`);
    }

    return withRetry(async () => {
      const subscription = (await paddle.subscriptions.update(subscriptionId, {
        items: [
          {
            priceId,
            quantity: 1,
          },
        ],
        prorationBillingMode: 'prorated_immediately',
        customData: {
          tier: newTier,
        },
      })) as PaddleSubscription;

      logger.info({ subscriptionId, newTier }, 'Updated Paddle subscription tier');

      return {
        id: subscription.id,
        customerId: subscription.customerId,
        status: this.mapSubscriptionStatus(subscription.status),
        tier: newTier,
        currentPeriodStart: new Date(subscription.currentBillingPeriod.startsAt),
        currentPeriodEnd: new Date(subscription.currentBillingPeriod.endsAt),
        cancelAtPeriodEnd: subscription.scheduledChange?.action === 'cancel',
        metadata: (subscription.customData as Record<string, string>) || {},
      };
    }, 'updateSubscriptionTier');
  }

  // ---------------------------------------------------------------------------
  // Webhook Processing
  // ---------------------------------------------------------------------------

  verifyWebhook(
    rawBody: string | Buffer,
    signature: string
  ): WebhookVerificationResult {
    // Validate webhook secret is configured
    if (!this.config.webhookSecret) {
      return {
        valid: false,
        error: 'Webhook secret not configured',
      };
    }

    const paddle = this.getClient();

    try {
      // Paddle SDK provides webhook verification and parsing
      const event = paddle.webhooks.unmarshal(
        rawBody.toString(),
        this.config.webhookSecret,
        signature
      ) as PaddleWebhookEvent | null;

      if (!event) {
        return {
          valid: false,
          error: 'Invalid webhook signature',
        };
      }

      const normalizedEvent = this.normalizeEvent(event);

      return {
        valid: true,
        event: normalizedEvent,
      };
    } catch (err) {
      const error = err as Error;
      logger.warn(
        { error: error.message },
        'Invalid Paddle webhook signature'
      );
      return {
        valid: false,
        error: error.message,
      };
    }
  }

  mapSubscriptionStatus(providerStatus: string): SubscriptionStatus {
    switch (providerStatus) {
      case 'active':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
        return 'canceled';
      case 'trialing':
        return 'trialing';
      case 'paused':
      default:
        // Per PRD: Paddle 'paused' status will NOT be used
        return 'unpaid';
    }
  }

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    try {
      const paddle = this.getClient();
      // Simple health check - list products with limit 1
      // This validates API key and connectivity
      const products = paddle.products.list({ perPage: 1 });
      // Consume at least one item to verify the API call works
      for await (const _product of products) {
        break;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalize Paddle event to provider-agnostic format
   */
  private normalizeEvent(event: PaddleWebhookEvent): ProviderWebhookEvent {
    return {
      id: event.eventId,
      type: this.normalizeEventType(event.eventType),
      rawType: event.eventType,
      data: event.data,
      timestamp: new Date(event.occurredAt),
    };
  }

  /**
   * Map Paddle event type to normalized type
   */
  private normalizeEventType(paddleType: string): NormalizedEventType {
    const mapping: Record<string, NormalizedEventType> = {
      'subscription.created': 'subscription.created',
      'subscription.activated': 'subscription.activated',
      'subscription.updated': 'subscription.updated',
      'subscription.canceled': 'subscription.canceled',
      'transaction.completed': 'payment.completed',
      'transaction.payment_failed': 'payment.failed',
    };

    return mapping[paddleType] || 'subscription.updated';
  }

  /**
   * Extract tier from Paddle subscription metadata or price lookup
   */
  private extractTierFromSubscription(
    subscription: PaddleSubscription
  ): SubscriptionTier | null {
    // Check customData first (preferred method)
    const customData = subscription.customData as Record<string, string> | undefined;
    if (customData?.tier && this.isValidTier(customData.tier)) {
      return customData.tier as SubscriptionTier;
    }

    // Fallback: Lookup by price ID
    const priceId = subscription.items?.[0]?.price?.id;
    if (priceId) {
      for (const [tier, configuredPriceId] of this.config.priceIds.entries()) {
        if (configuredPriceId === priceId && this.isValidTier(tier)) {
          return tier as SubscriptionTier;
        }
      }
    }

    return null;
  }

  /**
   * Check if a string is a valid subscription tier
   */
  private isValidTier(tier: string): tier is SubscriptionTier {
    const validTiers: SubscriptionTier[] = [
      'starter',
      'basic',
      'premium',
      'exclusive',
      'elite',
      'enterprise',
    ];
    return validTiers.includes(tier as SubscriptionTier);
  }
}
