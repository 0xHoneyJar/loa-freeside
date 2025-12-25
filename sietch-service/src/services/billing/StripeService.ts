/**
 * Stripe Service (v4.0 - Sprint 23)
 *
 * Handles all Stripe integration for the billing system:
 * - Checkout session creation for subscription purchases
 * - Customer portal session generation
 * - Subscription management (retrieve, cancel)
 * - Customer management (lookup, creation)
 *
 * Implements exponential backoff retry for network errors.
 */

import Stripe from 'stripe';
import { config, getStripePriceId, SUBSCRIPTION_TIERS } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type {
  SubscriptionTier,
  CreateCheckoutParams,
  CheckoutResult,
  CreatePortalParams,
  PortalResult,
  Subscription,
  SubscriptionStatus,
} from '../../types/billing.js';

// =============================================================================
// Constants
// =============================================================================

/** Maximum retry attempts for network errors */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BASE_DELAY_MS = 1000;

/** Stripe API version */
const STRIPE_API_VERSION = '2024-11-20.acacia';

// =============================================================================
// Stripe Client Initialization
// =============================================================================

/**
 * Get initialized Stripe client
 * Lazy initialization to allow config validation first
 */
function getStripeClient(): Stripe {
  if (!config.stripe.secretKey) {
    throw new Error('Stripe secret key not configured');
  }

  return new Stripe(config.stripe.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });
}

// =============================================================================
// Retry Logic
// =============================================================================

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

      // Don't retry on Stripe API errors (only network errors)
      if (err instanceof Stripe.errors.StripeError) {
        // Retry on rate limit or network errors
        if (
          err.type === 'StripeRateLimitError' ||
          err.type === 'StripeConnectionError' ||
          err.type === 'StripeAPIError'
        ) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          logger.warn(
            { operation, attempt, error: err.message, delay },
            'Stripe operation failed, retrying'
          );
          await sleep(delay);
          continue;
        }
        // Don't retry on other Stripe errors (invalid request, auth, etc.)
        throw err;
      }

      // Retry on generic network errors
      if (isNetworkError(err)) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { operation, attempt, error: error.message, delay },
          'Network error, retrying Stripe operation'
        );
        await sleep(delay);
        continue;
      }

      // Don't retry on other errors
      throw err;
    }
  }

  logger.error(
    { operation, error: lastError?.message },
    'Stripe operation failed after max retries'
  );
  throw lastError;
}

/**
 * Check if an error is a network error
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
      message.includes('network')
    );
  }
  return false;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Stripe Service Class
// =============================================================================

class StripeService {
  private stripe: Stripe | null = null;

  /**
   * Get or initialize Stripe client
   */
  private getClient(): Stripe {
    if (!this.stripe) {
      this.stripe = getStripeClient();
    }
    return this.stripe;
  }

  // ---------------------------------------------------------------------------
  // Customer Management
  // ---------------------------------------------------------------------------

  /**
   * Get or create a Stripe customer for a community
   *
   * @param communityId - Community identifier
   * @param email - Optional email for the customer
   * @param name - Optional name for the customer
   * @returns Stripe customer ID
   */
  async getOrCreateCustomer(
    communityId: string,
    email?: string,
    name?: string
  ): Promise<string> {
    const stripe = this.getClient();

    return withRetry(async () => {
      // Search for existing customer by metadata
      // Escape single quotes to prevent query injection
      const escapedCommunityId = communityId.replace(/'/g, "\\'");
      const existingCustomers = await stripe.customers.search({
        query: `metadata['community_id']:'${escapedCommunityId}'`,
        limit: 1,
      });

      if (existingCustomers.data.length > 0 && existingCustomers.data[0]) {
        const existingCustomer = existingCustomers.data[0];
        logger.debug(
          { communityId, customerId: existingCustomer.id },
          'Found existing Stripe customer'
        );
        return existingCustomer.id;
      }

      // Create new customer
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          community_id: communityId,
        },
      });

      logger.info(
        { communityId, customerId: customer.id },
        'Created new Stripe customer'
      );

      return customer.id;
    }, 'getOrCreateCustomer');
  }

  /**
   * Get customer by Stripe customer ID
   *
   * @param customerId - Stripe customer ID
   * @returns Stripe customer or null if not found
   */
  async getCustomer(customerId: string): Promise<Stripe.Customer | null> {
    const stripe = this.getClient();

    return withRetry(async () => {
      try {
        const customer = await stripe.customers.retrieve(customerId);

        if (customer.deleted) {
          return null;
        }

        return customer as Stripe.Customer;
      } catch (err) {
        if (
          err instanceof Stripe.errors.StripeError &&
          err.code === 'resource_missing'
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

  /**
   * Create a Stripe Checkout session for subscription purchase
   *
   * @param params - Checkout creation parameters
   * @returns Checkout session ID and URL
   */
  async createCheckoutSession(
    params: CreateCheckoutParams
  ): Promise<CheckoutResult> {
    const stripe = this.getClient();

    const { communityId, tier, successUrl, cancelUrl, customerId, metadata } =
      params;

    // Get price ID for the tier
    const priceId = getStripePriceId(tier);
    if (!priceId) {
      throw new Error(`No Stripe price ID configured for tier: ${tier}`);
    }

    // Get or create customer if not provided
    const stripeCustomerId =
      customerId || (await this.getOrCreateCustomer(communityId));

    return withRetry(async () => {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          community_id: communityId,
          tier,
          ...metadata,
        },
        subscription_data: {
          metadata: {
            community_id: communityId,
            tier,
          },
        },
        // Allow promotion codes
        allow_promotion_codes: true,
        // Collect billing address
        billing_address_collection: 'auto',
      });

      if (!session.url) {
        throw new Error('Stripe Checkout session created without URL');
      }

      logger.info(
        { communityId, tier, sessionId: session.id },
        'Created Stripe Checkout session'
      );

      return {
        sessionId: session.id,
        url: session.url,
      };
    }, 'createCheckoutSession');
  }

  // ---------------------------------------------------------------------------
  // Customer Portal
  // ---------------------------------------------------------------------------

  /**
   * Create a Stripe Customer Portal session
   *
   * @param params - Portal creation parameters
   * @returns Portal URL
   */
  async createPortalSession(params: CreatePortalParams): Promise<PortalResult> {
    const stripe = this.getClient();

    const { communityId, returnUrl } = params;

    // Get subscription to find customer ID
    const { getSubscriptionByCommunityId } = await import(
      '../../db/billing-queries.js'
    );
    const subscription = getSubscriptionByCommunityId(communityId);

    if (!subscription?.stripeCustomerId) {
      throw new Error('No Stripe customer found for community');
    }

    return withRetry(async () => {
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId!,
        return_url: returnUrl,
      });

      logger.info(
        { communityId, customerId: subscription.stripeCustomerId },
        'Created Stripe Portal session'
      );

      return {
        url: session.url,
      };
    }, 'createPortalSession');
  }

  // ---------------------------------------------------------------------------
  // Subscription Management
  // ---------------------------------------------------------------------------

  /**
   * Get a Stripe subscription by ID
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Stripe subscription or null if not found
   */
  async getStripeSubscription(
    subscriptionId: string
  ): Promise<Stripe.Subscription | null> {
    const stripe = this.getClient();

    return withRetry(async () => {
      try {
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        return subscription;
      } catch (err) {
        if (
          err instanceof Stripe.errors.StripeError &&
          err.code === 'resource_missing'
        ) {
          return null;
        }
        throw err;
      }
    }, 'getStripeSubscription');
  }

  /**
   * Cancel a subscription at period end
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Updated subscription
   */
  async cancelSubscription(
    subscriptionId: string
  ): Promise<Stripe.Subscription> {
    const stripe = this.getClient();

    return withRetry(async () => {
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });

      logger.info({ subscriptionId }, 'Canceled Stripe subscription at period end');

      return subscription;
    }, 'cancelSubscription');
  }

  /**
   * Resume a canceled subscription (if still in grace period)
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Updated subscription
   */
  async resumeSubscription(
    subscriptionId: string
  ): Promise<Stripe.Subscription> {
    const stripe = this.getClient();

    return withRetry(async () => {
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      logger.info({ subscriptionId }, 'Resumed Stripe subscription');

      return subscription;
    }, 'resumeSubscription');
  }

  /**
   * Update subscription to a different tier
   *
   * @param subscriptionId - Stripe subscription ID
   * @param newTier - New subscription tier
   * @returns Updated subscription
   */
  async updateSubscriptionTier(
    subscriptionId: string,
    newTier: SubscriptionTier
  ): Promise<Stripe.Subscription> {
    const stripe = this.getClient();

    const priceId = getStripePriceId(newTier);
    if (!priceId) {
      throw new Error(`No Stripe price ID configured for tier: ${newTier}`);
    }

    return withRetry(async () => {
      // Get current subscription to find the item ID
      const currentSub = await stripe.subscriptions.retrieve(subscriptionId);
      const itemId = currentSub.items.data[0]?.id;

      if (!itemId) {
        throw new Error('No subscription item found');
      }

      const subscription = await stripe.subscriptions.update(subscriptionId, {
        items: [
          {
            id: itemId,
            price: priceId,
          },
        ],
        metadata: {
          tier: newTier,
        },
        // Prorate the change
        proration_behavior: 'create_prorations',
      });

      logger.info(
        { subscriptionId, newTier },
        'Updated Stripe subscription tier'
      );

      return subscription;
    }, 'updateSubscriptionTier');
  }

  // ---------------------------------------------------------------------------
  // Webhook Helpers
  // ---------------------------------------------------------------------------

  /**
   * Construct and verify a webhook event from raw body
   *
   * @param rawBody - Raw request body
   * @param signature - Stripe signature header
   * @returns Verified Stripe event
   */
  constructWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
    const stripe = this.getClient();

    if (!config.stripe.webhookSecret) {
      throw new Error('Stripe webhook secret not configured');
    }

    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhookSecret
    );
  }

  /**
   * Map Stripe subscription status to internal status
   *
   * @param stripeStatus - Stripe subscription status
   * @returns Internal subscription status
   */
  mapSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
    switch (stripeStatus) {
      case 'active':
        return 'active';
      case 'past_due':
        return 'past_due';
      case 'canceled':
        return 'canceled';
      case 'trialing':
        return 'trialing';
      case 'unpaid':
        return 'unpaid';
      case 'incomplete':
      case 'incomplete_expired':
      case 'paused':
      default:
        return 'unpaid';
    }
  }

  /**
   * Extract tier from Stripe subscription metadata or price lookup
   *
   * @param subscription - Stripe subscription
   * @returns Subscription tier or null if not determinable
   */
  extractTierFromSubscription(
    subscription: Stripe.Subscription
  ): SubscriptionTier | null {
    // First, check metadata
    const tierFromMetadata = subscription.metadata?.tier as SubscriptionTier;
    if (tierFromMetadata && isValidTier(tierFromMetadata)) {
      return tierFromMetadata;
    }

    // Otherwise, lookup by price ID
    const priceId = subscription.items.data[0]?.price?.id;
    if (priceId) {
      for (const [tier, configuredPriceId] of config.stripe.priceIds.entries()) {
        if (configuredPriceId === priceId) {
          return tier as SubscriptionTier;
        }
      }
    }

    return null;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a string is a valid subscription tier
 */
function isValidTier(tier: string): tier is SubscriptionTier {
  return tier in SUBSCRIPTION_TIERS;
}

// =============================================================================
// Export Singleton
// =============================================================================

export const stripeService = new StripeService();
