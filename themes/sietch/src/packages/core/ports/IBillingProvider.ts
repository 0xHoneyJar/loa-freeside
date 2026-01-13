/**
 * IBillingProvider - Billing Provider Port
 *
 * Sprint 1: Paddle Migration - Phase 1 of payment provider replacement
 *
 * Architecture:
 * - Provider-agnostic interface for payment processing
 * - Follows hexagonal architecture pattern established by IChainProvider
 * - Enables future provider changes without domain modifications
 *
 * @module packages/core/ports/IBillingProvider
 */

// =============================================================================
// Provider Types
// =============================================================================

/**
 * Supported billing providers
 */
export type BillingProvider = 'paddle' | 'stripe';

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Available subscription tiers
 * Ordered from lowest to highest access level
 */
export type SubscriptionTier =
  | 'starter'     // Free tier - 100 members
  | 'basic'       // $29/mo - 500 members
  | 'premium'     // $99/mo - 1000 members
  | 'exclusive'   // $199/mo - 2500 members
  | 'elite'       // $449/mo - 10000 members
  | 'enterprise'; // Custom - unlimited

/**
 * Subscription status
 */
export type SubscriptionStatus =
  | 'active'      // Paid and current
  | 'past_due'    // Payment failed, in grace period
  | 'canceled'    // Will not renew
  | 'trialing'    // Trial period
  | 'unpaid';     // Grace period expired

// =============================================================================
// Checkout Types
// =============================================================================

/**
 * Checkout session creation parameters
 */
export interface CreateCheckoutParams {
  /** Community identifier */
  communityId: string;
  /** Target subscription tier */
  tier: SubscriptionTier;
  /** URL to redirect after successful checkout */
  successUrl: string;
  /** URL to redirect if checkout is canceled */
  cancelUrl: string;
  /** Existing customer ID (optional) */
  customerId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Checkout session result
 */
export interface CheckoutResult {
  /** Provider checkout session ID */
  sessionId: string;
  /** Checkout URL to redirect user to */
  url: string;
  /** Optional client token for embedded checkout (Paddle.js) */
  clientToken?: string;
}

/**
 * One-time payment checkout parameters
 */
export interface CreateOneTimeCheckoutParams {
  /** Existing customer ID */
  customerId: string;
  /** Product/price identifier */
  priceId: string;
  /** URL to redirect after successful checkout */
  successUrl: string;
  /** URL to redirect if checkout is canceled */
  cancelUrl: string;
  /** Payment metadata */
  metadata: Record<string, string>;
}

// =============================================================================
// Customer Portal Types
// =============================================================================

/**
 * Customer portal session parameters
 */
export interface CreatePortalParams {
  /** Community identifier */
  communityId: string;
  /** URL to redirect after leaving portal */
  returnUrl: string;
}

/**
 * Customer portal result
 */
export interface PortalResult {
  /** Portal URL to redirect user to */
  url: string;
}

// =============================================================================
// Subscription Types
// =============================================================================

/**
 * Provider subscription data (normalized from provider-specific format)
 */
export interface ProviderSubscription {
  /** Provider subscription ID */
  id: string;
  /** Provider customer ID */
  customerId: string;
  /** Subscription status */
  status: SubscriptionStatus;
  /** Subscription tier (null if not determinable) */
  tier: SubscriptionTier | null;
  /** Current period start */
  currentPeriodStart: Date;
  /** Current period end */
  currentPeriodEnd: Date;
  /** Whether subscription will cancel at period end */
  cancelAtPeriodEnd: boolean;
  /** Raw provider metadata */
  metadata: Record<string, string>;
}

/**
 * Customer data (normalized from provider-specific format)
 */
export interface ProviderCustomer {
  /** Provider customer ID */
  id: string;
  /** Customer email */
  email?: string;
  /** Customer name */
  name?: string;
  /** Custom metadata */
  metadata: Record<string, string>;
}

// =============================================================================
// Webhook Types
// =============================================================================

/**
 * Normalized webhook event types
 * Provider-specific events are mapped to these normalized types
 */
export type NormalizedEventType =
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'payment.completed'
  | 'payment.failed';

/**
 * Provider-agnostic webhook event
 */
export interface ProviderWebhookEvent {
  /** Provider event ID */
  id: string;
  /** Event type (normalized) */
  type: NormalizedEventType;
  /** Raw provider event type */
  rawType: string;
  /** Event data */
  data: Record<string, unknown>;
  /** Event timestamp */
  timestamp: Date;
}

/**
 * Webhook event verification result
 */
export interface WebhookVerificationResult {
  /** Whether signature is valid */
  valid: boolean;
  /** Parsed event (if valid) */
  event?: ProviderWebhookEvent;
  /** Error message (if invalid) */
  error?: string;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Paddle-specific configuration
 *
 * Note: Fields are optional to support gradual configuration.
 * The adapter validates required fields at initialization time.
 */
export interface PaddleConfig {
  /** Paddle API key */
  apiKey?: string;
  /** Webhook signature secret */
  webhookSecret?: string;
  /** Environment (sandbox or production) */
  environment: 'sandbox' | 'production';
  /** Client-side token for Paddle.js */
  clientToken?: string;
  /** Price IDs for subscription tiers (string key for flexibility) */
  priceIds: Map<string, string>;
  /** One-time product price IDs (all optional) */
  oneTimePriceIds: {
    badge?: string;
    boost?: string;
    boost1Month?: string;
    boost3Month?: string;
    boost6Month?: string;
    boost12Month?: string;
  };
}

/**
 * Billing provider configuration
 */
export interface BillingConfig {
  /** Active provider */
  provider: BillingProvider;
  /** Paddle configuration (if provider is paddle) */
  paddle?: PaddleConfig;
}

// =============================================================================
// IBillingProvider Interface
// =============================================================================

/**
 * IBillingProvider - Billing Provider Port
 *
 * Provider-agnostic interface for payment processing.
 * Follows hexagonal architecture pattern established by IChainProvider.
 *
 * Implementations:
 * - PaddleBillingAdapter (primary)
 * - Future: Other payment providers
 */
export interface IBillingProvider {
  /**
   * Get the provider identifier
   */
  readonly provider: BillingProvider;

  // ---------------------------------------------------------------------------
  // Customer Management
  // ---------------------------------------------------------------------------

  /**
   * Get or create a customer for a community
   *
   * If a customer with the community_id metadata already exists, returns
   * that customer's ID. Otherwise, creates a new customer.
   *
   * @param communityId - Community identifier
   * @param email - Optional customer email
   * @param name - Optional customer name
   * @returns Provider customer ID
   *
   * @example
   * ```typescript
   * const customerId = await provider.getOrCreateCustomer(
   *   'community-123',
   *   'admin@example.com',
   *   'My Community'
   * );
   * ```
   */
  getOrCreateCustomer(
    communityId: string,
    email?: string,
    name?: string
  ): Promise<string>;

  /**
   * Get customer details by provider customer ID
   *
   * @param customerId - Provider customer ID
   * @returns Customer details or null if not found
   */
  getCustomer(customerId: string): Promise<ProviderCustomer | null>;

  // ---------------------------------------------------------------------------
  // Checkout Sessions
  // ---------------------------------------------------------------------------

  /**
   * Create a checkout session for subscription purchase
   *
   * @param params - Checkout creation parameters
   * @returns Checkout session result with URL
   *
   * @example
   * ```typescript
   * const checkout = await provider.createCheckoutSession({
   *   communityId: 'community-123',
   *   tier: 'premium',
   *   successUrl: 'https://app.example.com/success',
   *   cancelUrl: 'https://app.example.com/cancel',
   * });
   * // Redirect user to checkout.url
   * ```
   */
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult>;

  /**
   * Create a checkout session for one-time payment (badge, boost)
   *
   * @param params - One-time checkout parameters
   * @returns Checkout session result with URL
   *
   * @example
   * ```typescript
   * const checkout = await provider.createOneTimeCheckoutSession({
   *   customerId: 'cus_123',
   *   priceId: 'pri_badge',
   *   successUrl: 'https://app.example.com/success',
   *   cancelUrl: 'https://app.example.com/cancel',
   *   metadata: { type: 'badge_purchase', member_id: 'member-456' },
   * });
   * ```
   */
  createOneTimeCheckoutSession(
    params: CreateOneTimeCheckoutParams
  ): Promise<CheckoutResult>;

  // ---------------------------------------------------------------------------
  // Customer Portal
  // ---------------------------------------------------------------------------

  /**
   * Create a customer portal session
   *
   * The portal allows customers to manage their subscription,
   * update payment methods, and view billing history.
   *
   * @param params - Portal creation parameters
   * @returns Portal URL
   */
  createPortalSession(params: CreatePortalParams): Promise<PortalResult>;

  // ---------------------------------------------------------------------------
  // Subscription Management
  // ---------------------------------------------------------------------------

  /**
   * Get subscription by provider subscription ID
   *
   * @param subscriptionId - Provider subscription ID
   * @returns Provider subscription or null if not found
   */
  getSubscription(subscriptionId: string): Promise<ProviderSubscription | null>;

  /**
   * Cancel subscription at period end
   *
   * The subscription remains active until the current billing period ends,
   * then cancels automatically.
   *
   * @param subscriptionId - Provider subscription ID
   * @returns Updated subscription
   */
  cancelSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /**
   * Resume a canceled subscription (if still in period)
   *
   * Removes the scheduled cancellation so the subscription continues
   * billing at the end of the current period.
   *
   * @param subscriptionId - Provider subscription ID
   * @returns Updated subscription
   */
  resumeSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /**
   * Update subscription to a different tier
   *
   * Handles proration automatically based on provider settings.
   *
   * @param subscriptionId - Provider subscription ID
   * @param newTier - New subscription tier
   * @returns Updated subscription
   */
  updateSubscriptionTier(
    subscriptionId: string,
    newTier: SubscriptionTier
  ): Promise<ProviderSubscription>;

  // ---------------------------------------------------------------------------
  // Webhook Processing
  // ---------------------------------------------------------------------------

  /**
   * Verify and parse webhook payload
   *
   * Validates the signature using the provider's verification method
   * (e.g., HMAC-SHA256 for Paddle) and parses the event.
   *
   * @param rawBody - Raw request body (string or Buffer)
   * @param signature - Signature header value
   * @returns Verification result with parsed event
   *
   * @example
   * ```typescript
   * const result = provider.verifyWebhook(req.body, req.headers['paddle-signature']);
   * if (result.valid && result.event) {
   *   await processEvent(result.event);
   * }
   * ```
   */
  verifyWebhook(
    rawBody: string | Buffer,
    signature: string
  ): WebhookVerificationResult;

  /**
   * Map provider subscription status to internal status
   *
   * @param providerStatus - Provider-specific status string
   * @returns Internal subscription status
   */
  mapSubscriptionStatus(providerStatus: string): SubscriptionStatus;

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------

  /**
   * Check if the billing provider is healthy
   *
   * Makes a lightweight API call to verify connectivity.
   *
   * @returns true if provider is responding
   */
  isHealthy(): Promise<boolean>;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Factory function type for creating billing providers
 */
export type BillingProviderFactory = (config: BillingConfig) => IBillingProvider;
