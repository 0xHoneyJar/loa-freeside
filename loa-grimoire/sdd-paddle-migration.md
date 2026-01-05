# Software Design Document: Stripe to Paddle Payment Migration

**Version**: 1.0
**Date**: January 4, 2026
**Status**: READY FOR SPRINT PLANNING
**Branch**: `feature/replace-stripe-with-paddle`
**Parent PRD**: `loa-grimoire/prd-paddle-migration.md`

---

## Document Traceability

| Section | Source |
|---------|--------|
| Architecture Patterns | Existing `IChainProvider` hexagonal port pattern |
| Billing Types | `sietch-service/src/types/billing.ts` |
| Webhook Patterns | `sietch-service/src/services/billing/WebhookService.ts` |
| Database Schema | `sietch-service/src/db/billing-queries.ts` |
| PRD Requirements | `loa-grimoire/prd-paddle-migration.md` |

---

## 1. Executive Summary

### 1.1 Overview

This document specifies the technical architecture for replacing Stripe with Paddle as Arrakis's payment provider. The migration follows hexagonal architecture principles to create a provider-agnostic billing layer.

### 1.2 Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Hexagonal Port/Adapter Pattern** | Matches existing `IChainProvider` architecture; enables future provider changes |
| **In-place Replacement** | No existing subscribers; clean cut-over is safest |
| **Provider-agnostic Schema** | Rename `stripe_*` columns to `payment_*` for flexibility |
| **Preserve API Surface** | Maintain existing route handlers; only adapter changes |

### 1.3 Migration Scope

| Component | Action |
|-----------|--------|
| `StripeService.ts` | Replace with `PaddleBillingAdapter.ts` |
| `WebhookService.ts` | Update event handlers for Paddle events |
| `billing-queries.ts` | Rename columns, update row types |
| `billing.ts` types | Add Paddle-specific types |
| `config.ts` | Replace Stripe config with Paddle config |
| Database schema | Migration script for column renames |

---

## 2. Architecture Overview

### 2.1 Hexagonal Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APPLICATION CORE                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │  GatekeeperSvc  │    │   BoostService  │    │   BadgeService  │  │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘  │
│           │                      │                      │            │
│           └──────────────────────┼──────────────────────┘            │
│                                  │                                   │
│                        ┌─────────▼─────────┐                        │
│                        │ IBillingProvider  │  ◄── PORT              │
│                        │     (interface)   │                        │
│                        └─────────┬─────────┘                        │
└──────────────────────────────────┼──────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
          ┌─────────▼─────────┐        ┌─────────▼─────────┐
          │ PaddleBillingAdapter│       │  (Future Provider) │  ◄── ADAPTERS
          │    (concrete)      │        │                    │
          └─────────┬─────────┘        └────────────────────┘
                    │
          ┌─────────▼─────────┐
          │   Paddle API      │  ◄── EXTERNAL SERVICE
          │   (HTTP + SDK)    │
          └───────────────────┘
```

### 2.2 Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             BILLING SYSTEM                                │
│                                                                          │
│  ┌────────────────────┐    ┌────────────────────┐    ┌─────────────────┐│
│  │   IBillingProvider │    │  IWebhookProcessor │    │  IBillingQueries││
│  │       (port)       │    │      (port)        │    │     (port)      ││
│  └──────────┬─────────┘    └──────────┬─────────┘    └────────┬────────┘│
│             │                         │                       │         │
│  ┌──────────▼─────────┐    ┌──────────▼─────────┐    ┌───────▼────────┐│
│  │PaddleBillingAdapter│    │ PaddleWebhookProc  │    │ BillingQueries ││
│  │                    │◄───│                    │───►│   (SQLite)     ││
│  └──────────┬─────────┘    └──────────┬─────────┘    └───────┬────────┘│
│             │                         │                       │         │
│  ┌──────────▼─────────┐    ┌──────────▼─────────┐    ┌───────▼────────┐│
│  │   Paddle SDK       │    │  HMAC Verification │    │  SQLite + RLS  ││
│  │ @paddle-node-sdk   │    │                    │    │                ││
│  └────────────────────┘    └────────────────────┘    └────────────────┘│
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Interface Definitions

### 3.1 IBillingProvider Interface

**File**: `sietch-service/src/packages/core/ports/IBillingProvider.ts`

```typescript
/**
 * IBillingProvider - Billing Provider Port
 *
 * Provider-agnostic interface for payment processing.
 * Follows hexagonal architecture pattern established by IChainProvider.
 *
 * @module packages/core/ports/IBillingProvider
 */

import type { SubscriptionTier, SubscriptionStatus } from '../../types/billing.js';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Supported billing providers
 */
export type BillingProvider = 'paddle' | 'stripe';

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
  /** Optional client token for embedded checkout */
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

/**
 * Provider subscription data
 */
export interface ProviderSubscription {
  /** Provider subscription ID */
  id: string;
  /** Provider customer ID */
  customerId: string;
  /** Subscription status */
  status: SubscriptionStatus;
  /** Subscription tier */
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
 * Normalized webhook event types
 */
export type NormalizedEventType =
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'payment.completed'
  | 'payment.failed';

// =============================================================================
// IBillingProvider Interface
// =============================================================================

/**
 * IBillingProvider - Billing Provider Port
 *
 * Provider-agnostic interface for payment processing.
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
   * @param communityId - Community identifier
   * @param email - Optional customer email
   * @param name - Optional customer name
   * @returns Provider customer ID
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
  getCustomer(customerId: string): Promise<{ id: string; email?: string; metadata: Record<string, string> } | null>;

  // ---------------------------------------------------------------------------
  // Checkout Sessions
  // ---------------------------------------------------------------------------

  /**
   * Create a checkout session for subscription purchase
   *
   * @param params - Checkout creation parameters
   * @returns Checkout session result
   */
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult>;

  /**
   * Create a checkout session for one-time payment
   *
   * @param params - One-time checkout parameters
   * @returns Checkout session result
   */
  createOneTimeCheckoutSession(params: CreateOneTimeCheckoutParams): Promise<CheckoutResult>;

  // ---------------------------------------------------------------------------
  // Customer Portal
  // ---------------------------------------------------------------------------

  /**
   * Create a customer portal session
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
   * @param subscriptionId - Provider subscription ID
   * @returns Updated subscription
   */
  cancelSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /**
   * Resume a canceled subscription (if still in period)
   *
   * @param subscriptionId - Provider subscription ID
   * @returns Updated subscription
   */
  resumeSubscription(subscriptionId: string): Promise<ProviderSubscription>;

  /**
   * Update subscription to a different tier
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
   * @param rawBody - Raw request body (string or Buffer)
   * @param signature - Signature header value
   * @returns Verification result with parsed event
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
   */
  isHealthy(): Promise<boolean>;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Paddle-specific configuration
 */
export interface PaddleConfig {
  /** Paddle API key */
  apiKey: string;
  /** Webhook signature secret */
  webhookSecret: string;
  /** Environment (sandbox or production) */
  environment: 'sandbox' | 'production';
  /** Client-side token for Paddle.js */
  clientToken: string;
  /** Price IDs for each tier */
  priceIds: Map<SubscriptionTier, string>;
  /** One-time product price IDs */
  oneTimePriceIds: {
    badge: string;
    boost1Month: string;
    boost3Month: string;
    boost6Month: string;
    boost12Month: string;
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
```

### 3.2 Status Mapping

| Paddle Status | Internal Status | Notes |
|---------------|-----------------|-------|
| `active` | `active` | Subscription is paid and current |
| `past_due` | `past_due` | Payment failed, retrying |
| `canceled` | `canceled` | Subscription ended |
| `trialing` | `trialing` | Trial period (if enabled) |
| `paused` | `unpaid` | NOT USED per user decision |

### 3.3 Event Type Mapping

| Paddle Event | Normalized Type | Action |
|--------------|-----------------|--------|
| `subscription.created` | `subscription.created` | Create subscription record |
| `subscription.activated` | `subscription.activated` | Update status to active |
| `subscription.updated` | `subscription.updated` | Sync tier/status |
| `subscription.canceled` | `subscription.canceled` | Downgrade to starter |
| `transaction.completed` | `payment.completed` | Record payment, grant access |
| `transaction.payment_failed` | `payment.failed` | Start grace period |

---

## 4. Adapter Implementation

### 4.1 PaddleBillingAdapter

**File**: `sietch-service/src/packages/adapters/billing/PaddleBillingAdapter.ts`

```typescript
/**
 * PaddleBillingAdapter - Paddle Billing Implementation
 *
 * Implements IBillingProvider for Paddle payment processing.
 * Uses official @paddle/paddle-node-sdk for API interactions.
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
  CreateCheckoutParams,
  CheckoutResult,
  CreateOneTimeCheckoutParams,
  CreatePortalParams,
  PortalResult,
  ProviderSubscription,
  WebhookVerificationResult,
  ProviderWebhookEvent,
  NormalizedEventType,
  PaddleConfig,
} from '../../core/ports/IBillingProvider.js';
import type { SubscriptionTier, SubscriptionStatus } from '../../../types/billing.js';
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

      // Don't retry on other errors
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
// PaddleBillingAdapter Class
// =============================================================================

export class PaddleBillingAdapter implements IBillingProvider {
  readonly provider: BillingProvider = 'paddle';

  private paddle: Paddle | null = null;
  private config: PaddleConfig;

  constructor(config: PaddleConfig) {
    this.config = config;
  }

  /**
   * Get or initialize Paddle client
   */
  private getClient(): Paddle {
    if (!this.paddle) {
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
      // Search for existing customer by custom_data
      const customers = await paddle.customers.list({
        // Paddle uses custom_data for metadata
      });

      // Find customer with matching community_id in custom_data
      for (const customer of customers) {
        if (customer.customData?.community_id === communityId) {
          logger.debug(
            { communityId, customerId: customer.id },
            'Found existing Paddle customer'
          );
          return customer.id;
        }
      }

      // Create new customer
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

  async getCustomer(customerId: string): Promise<{ id: string; email?: string; metadata: Record<string, string> } | null> {
    const paddle = this.getClient();

    return withRetry(async () => {
      try {
        const customer = await paddle.customers.get(customerId);
        return {
          id: customer.id,
          email: customer.email,
          metadata: (customer.customData as Record<string, string>) || {},
        };
      } catch (err) {
        // Return null if not found
        if ((err as Error).message?.includes('not found')) {
          return null;
        }
        throw err;
      }
    }, 'getCustomer');
  }

  // ---------------------------------------------------------------------------
  // Checkout Sessions
  // ---------------------------------------------------------------------------

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const paddle = this.getClient();
    const { communityId, tier, successUrl, cancelUrl, customerId, metadata } = params;

    // Get price ID for the tier
    const priceId = this.config.priceIds.get(tier);
    if (!priceId) {
      throw new Error(`No Paddle price ID configured for tier: ${tier}`);
    }

    // Get or create customer if not provided
    const paddleCustomerId = customerId || await this.getOrCreateCustomer(communityId);

    return withRetry(async () => {
      // Paddle uses transactions for checkout
      const transaction = await paddle.transactions.create({
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
      });

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

  async createOneTimeCheckoutSession(params: CreateOneTimeCheckoutParams): Promise<CheckoutResult> {
    const paddle = this.getClient();

    return withRetry(async () => {
      const transaction = await paddle.transactions.create({
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
      });

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
    // Paddle provides a customer portal URL that can be constructed
    // or obtained via the API
    const { getSubscriptionByCommunityId } = await import(
      '../../../db/billing-queries.js'
    );
    const subscription = getSubscriptionByCommunityId(params.communityId);

    if (!subscription?.paymentCustomerId) {
      throw new Error('No Paddle customer found for community');
    }

    // Paddle's customer portal is accessed via a URL pattern
    // In production, this would use Paddle's portal session API
    const portalUrl = this.config.environment === 'production'
      ? `https://customer-portal.paddle.com/cpl_${subscription.paymentCustomerId}`
      : `https://sandbox-customer-portal.paddle.com/cpl_${subscription.paymentCustomerId}`;

    logger.info(
      { communityId: params.communityId },
      'Created Paddle Portal session'
    );

    return {
      url: portalUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // Subscription Management
  // ---------------------------------------------------------------------------

  async getSubscription(subscriptionId: string): Promise<ProviderSubscription | null> {
    const paddle = this.getClient();

    return withRetry(async () => {
      try {
        const subscription = await paddle.subscriptions.get(subscriptionId);

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
        if ((err as Error).message?.includes('not found')) {
          return null;
        }
        throw err;
      }
    }, 'getSubscription');
  }

  async cancelSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const paddle = this.getClient();

    return withRetry(async () => {
      const subscription = await paddle.subscriptions.cancel(subscriptionId, {
        effectiveFrom: 'next_billing_period',
      });

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

  async resumeSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const paddle = this.getClient();

    return withRetry(async () => {
      // Remove scheduled cancellation
      const subscription = await paddle.subscriptions.update(subscriptionId, {
        scheduledChange: null,
      });

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
      const subscription = await paddle.subscriptions.update(subscriptionId, {
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
      });

      logger.info(
        { subscriptionId, newTier },
        'Updated Paddle subscription tier'
      );

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

  verifyWebhook(rawBody: string | Buffer, signature: string): WebhookVerificationResult {
    const paddle = this.getClient();

    try {
      const event = paddle.webhooks.unmarshal(
        rawBody.toString(),
        this.config.webhookSecret,
        signature
      );

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
      logger.warn(
        { error: (err as Error).message },
        'Invalid Paddle webhook signature'
      );
      return {
        valid: false,
        error: (err as Error).message,
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
      await paddle.products.list({ perPage: 1 });
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
  private normalizeEvent(event: unknown): ProviderWebhookEvent {
    const paddleEvent = event as {
      eventId: string;
      eventType: string;
      occurredAt: string;
      data: Record<string, unknown>;
    };

    return {
      id: paddleEvent.eventId,
      type: this.normalizeEventType(paddleEvent.eventType),
      rawType: paddleEvent.eventType,
      data: paddleEvent.data,
      timestamp: new Date(paddleEvent.occurredAt),
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
   * Extract tier from Paddle subscription
   */
  private extractTierFromSubscription(subscription: {
    customData?: unknown;
    items?: Array<{ price?: { id: string } }>;
  }): SubscriptionTier | null {
    // Check custom_data first
    const customData = subscription.customData as Record<string, string> | undefined;
    if (customData?.tier) {
      return customData.tier as SubscriptionTier;
    }

    // Lookup by price ID
    const priceId = subscription.items?.[0]?.price?.id;
    if (priceId) {
      for (const [tier, configuredPriceId] of this.config.priceIds.entries()) {
        if (configuredPriceId === priceId) {
          return tier;
        }
      }
    }

    return null;
  }
}
```

---

## 5. Database Schema Changes

### 5.1 Migration Script

**File**: `sietch-service/src/db/migrations/003_paddle_migration.sql`

```sql
-- Migration: Stripe to Paddle (Provider-Agnostic Schema)
-- Version: 003
-- Date: 2026-01-04

-- =============================================================================
-- Step 1: Rename Stripe-specific columns to provider-agnostic names
-- =============================================================================

-- Subscriptions table
ALTER TABLE subscriptions RENAME COLUMN stripe_customer_id TO payment_customer_id;
ALTER TABLE subscriptions RENAME COLUMN stripe_subscription_id TO payment_subscription_id;

-- Add payment provider column
ALTER TABLE subscriptions ADD COLUMN payment_provider TEXT DEFAULT 'paddle';

-- Webhook events table
ALTER TABLE webhook_events RENAME COLUMN stripe_event_id TO provider_event_id;

-- =============================================================================
-- Step 2: Update badge_purchases table
-- =============================================================================

ALTER TABLE badge_purchases RENAME COLUMN stripe_payment_id TO payment_id;

-- =============================================================================
-- Step 3: Update boost_purchases table
-- =============================================================================

ALTER TABLE boost_purchases RENAME COLUMN stripe_payment_id TO payment_id;

-- =============================================================================
-- Step 4: Create indexes for new column names
-- =============================================================================

-- Drop old indexes (if they exist)
DROP INDEX IF EXISTS idx_subscriptions_stripe_customer_id;
DROP INDEX IF EXISTS idx_subscriptions_stripe_subscription_id;
DROP INDEX IF EXISTS idx_webhook_events_stripe_event_id;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_customer_id
  ON subscriptions(payment_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_subscription_id
  ON subscriptions(payment_subscription_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_event_id
  ON webhook_events(provider_event_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_provider
  ON subscriptions(payment_provider);

-- =============================================================================
-- Step 5: Update schema version
-- =============================================================================

INSERT INTO schema_migrations (version, applied_at)
VALUES ('003_paddle_migration', datetime('now'));
```

### 5.2 Updated Row Types

**File**: `sietch-service/src/db/billing-queries.ts` (updated types)

```typescript
// Row type definitions (updated for provider-agnostic naming)

interface SubscriptionRow {
  id: string;
  community_id: string;
  payment_customer_id: string | null;    // Renamed from stripe_customer_id
  payment_subscription_id: string | null; // Renamed from stripe_subscription_id
  payment_provider: string;               // New: 'paddle' or 'stripe'
  tier: string;
  status: string;
  grace_until: number | null;
  current_period_start: number | null;
  current_period_end: number | null;
  created_at: string;
  updated_at: string;
}

interface WebhookEventRow {
  id: string;
  provider_event_id: string;  // Renamed from stripe_event_id
  event_type: string;
  status: string;
  payload: string;
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
}
```

### 5.3 Updated Subscription Interface

**File**: `sietch-service/src/types/billing.ts` (updated interface)

```typescript
/**
 * Subscription record stored in database
 */
export interface Subscription {
  /** Unique subscription ID (UUID) */
  id: string;
  /** Community identifier */
  communityId: string;
  /** Payment provider customer ID */
  paymentCustomerId?: string;      // Renamed from stripeCustomerId
  /** Payment provider subscription ID */
  paymentSubscriptionId?: string;  // Renamed from stripeSubscriptionId
  /** Payment provider ('paddle' or 'stripe') */
  paymentProvider: BillingProvider;
  /** Current subscription tier */
  tier: SubscriptionTier;
  /** Subscription status */
  status: SubscriptionStatus;
  /** Grace period end timestamp (null if not in grace) */
  graceUntil?: Date;
  /** Current billing period start */
  currentPeriodStart?: Date;
  /** Current billing period end */
  currentPeriodEnd?: Date;
  /** Record creation timestamp */
  createdAt: Date;
  /** Record update timestamp */
  updatedAt: Date;
}
```

---

## 6. Webhook Processing Architecture

### 6.1 Updated WebhookService

**File**: `sietch-service/src/services/billing/WebhookService.ts` (updated)

```typescript
/**
 * Webhook Service (v5.0 - Paddle Migration)
 *
 * Processes billing provider webhooks with idempotency guarantees:
 * - Signature verification (provider-specific)
 * - Idempotent event processing (Redis + database deduplication)
 * - Event-specific handlers for subscription lifecycle
 * - Grace period management on payment failures
 * - Entitlement cache invalidation on subscription changes
 *
 * Supported Paddle webhook events:
 * - subscription.created
 * - subscription.activated
 * - subscription.updated
 * - subscription.canceled
 * - transaction.completed
 * - transaction.payment_failed
 */

import type {
  IBillingProvider,
  ProviderWebhookEvent,
  NormalizedEventType,
} from '../../packages/core/ports/IBillingProvider.js';
import { redisService } from '../cache/RedisService.js';
import {
  getSubscriptionByCommunityId,
  getSubscriptionByPaymentId,
  createSubscription,
  updateSubscription,
  isWebhookEventProcessed,
  recordWebhookEvent,
  logBillingAuditEvent,
} from '../../db/billing-queries.js';
import { boostService } from '../boost/BoostService.js';
import { logger } from '../../utils/logger.js';
import type { SubscriptionTier } from '../../types/billing.js';

// =============================================================================
// Constants
// =============================================================================

/** Grace period duration in milliseconds (24 hours) */
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** Supported normalized event types */
const SUPPORTED_EVENTS: NormalizedEventType[] = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'payment.completed',
  'payment.failed',
];

// =============================================================================
// Types
// =============================================================================

export interface WebhookResult {
  status: 'processed' | 'duplicate' | 'skipped' | 'failed';
  eventId: string;
  eventType: string;
  message?: string;
  error?: string;
}

// =============================================================================
// WebhookService Class
// =============================================================================

export class WebhookService {
  private billingProvider: IBillingProvider;

  constructor(billingProvider: IBillingProvider) {
    this.billingProvider = billingProvider;
  }

  /**
   * Verify webhook signature using the billing provider
   */
  verifySignature(payload: string | Buffer, signature: string): ProviderWebhookEvent {
    const result = this.billingProvider.verifyWebhook(payload, signature);

    if (!result.valid || !result.event) {
      throw new Error(result.error || 'Invalid webhook signature');
    }

    return result.event;
  }

  /**
   * Process a webhook event with idempotency
   */
  async processEvent(event: ProviderWebhookEvent): Promise<WebhookResult> {
    const eventId = event.id;
    const eventType = event.type;

    logger.info({ eventId, eventType, rawType: event.rawType }, 'Processing webhook event');

    // Step 1: Check Redis for duplicate (fast path)
    if (await redisService.isEventProcessed(eventId)) {
      logger.debug({ eventId }, 'Event already processed (Redis cache hit)');
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event already processed (Redis)',
      };
    }

    // Step 2: Check database for duplicate (fallback)
    if (isWebhookEventProcessed(eventId)) {
      logger.debug({ eventId }, 'Event already processed (database check)');
      await redisService.markEventProcessed(eventId);
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event already processed (database)',
      };
    }

    // Step 3: Acquire lock for event processing
    const lockAcquired = await redisService.acquireEventLock(eventId);
    if (!lockAcquired) {
      logger.debug({ eventId }, 'Event lock held by another process');
      return {
        status: 'duplicate',
        eventId,
        eventType,
        message: 'Event being processed by another instance',
      };
    }

    try {
      // Step 4: Process event based on type
      if (!this.isSupportedEvent(eventType)) {
        logger.debug({ eventId, eventType }, 'Unsupported event type, skipping');
        return {
          status: 'skipped',
          eventId,
          eventType,
          message: 'Unsupported event type',
        };
      }

      await this.handleEvent(event);

      // Step 5: Record successful processing in database
      recordWebhookEvent(eventId, event.rawType, JSON.stringify(event.data), 'processed');

      // Step 6: Mark event in Redis for deduplication
      await redisService.markEventProcessed(eventId);

      logger.info({ eventId, eventType }, 'Webhook event processed successfully');

      return {
        status: 'processed',
        eventId,
        eventType,
      };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(
        { eventId, eventType, error: errorMessage },
        'Failed to process webhook event'
      );

      recordWebhookEvent(
        eventId,
        event.rawType,
        JSON.stringify(event.data),
        'failed',
        errorMessage
      );

      logBillingAuditEvent('webhook_failed', {
        eventId,
        eventType,
        error: errorMessage,
      });

      return {
        status: 'failed',
        eventId,
        eventType,
        error: errorMessage,
      };
    } finally {
      await redisService.releaseEventLock(eventId);
    }
  }

  // ---------------------------------------------------------------------------
  // Event Routing
  // ---------------------------------------------------------------------------

  private isSupportedEvent(eventType: string): eventType is NormalizedEventType {
    return SUPPORTED_EVENTS.includes(eventType as NormalizedEventType);
  }

  private async handleEvent(event: ProviderWebhookEvent): Promise<void> {
    switch (event.type) {
      case 'subscription.created':
        await this.handleSubscriptionCreated(event);
        break;
      case 'subscription.activated':
        await this.handleSubscriptionActivated(event);
        break;
      case 'subscription.updated':
        await this.handleSubscriptionUpdated(event);
        break;
      case 'subscription.canceled':
        await this.handleSubscriptionCanceled(event);
        break;
      case 'payment.completed':
        await this.handlePaymentCompleted(event);
        break;
      case 'payment.failed':
        await this.handlePaymentFailed(event);
        break;
      default:
        logger.debug({ eventType: event.type }, 'Unhandled webhook event type');
    }
  }

  // ---------------------------------------------------------------------------
  // Event Handlers
  // ---------------------------------------------------------------------------

  private async handleSubscriptionCreated(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      customerId: string;
      customData?: { community_id?: string; tier?: string };
    };

    const communityId = data.customData?.community_id;
    const tier = data.customData?.tier as SubscriptionTier;

    if (!communityId) {
      logger.warn({ eventId: event.id }, 'Subscription missing community_id');
      return;
    }

    // Check if subscription already exists
    const existing = getSubscriptionByCommunityId(communityId);

    if (existing) {
      updateSubscription(communityId, {
        paymentCustomerId: data.customerId,
        paymentSubscriptionId: data.id,
        tier: tier || existing.tier,
        paymentProvider: 'paddle',
      });
    } else {
      createSubscription({
        communityId,
        paymentCustomerId: data.customerId,
        paymentSubscriptionId: data.id,
        tier: tier || 'basic',
        status: 'active',
        paymentProvider: 'paddle',
      });
    }

    await redisService.invalidateEntitlements(communityId);

    logBillingAuditEvent(
      'subscription_created',
      {
        communityId,
        tier,
        paymentCustomerId: data.customerId,
        paymentSubscriptionId: data.id,
        provider: 'paddle',
      },
      communityId
    );

    logger.info({ communityId, tier }, 'Subscription created');
  }

  private async handleSubscriptionActivated(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      customData?: { community_id?: string };
    };

    const communityId = data.customData?.community_id;
    if (!communityId) {
      logger.warn({ eventId: event.id }, 'Subscription missing community_id');
      return;
    }

    updateSubscription(communityId, {
      status: 'active',
      graceUntil: null,
    });

    await redisService.invalidateEntitlements(communityId);

    logger.info({ communityId }, 'Subscription activated');
  }

  private async handleSubscriptionUpdated(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      status: string;
      customData?: { community_id?: string; tier?: string };
      currentBillingPeriod?: { startsAt: string; endsAt: string };
      scheduledChange?: { action: string };
    };

    const communityId = data.customData?.community_id;
    if (!communityId) {
      logger.warn({ eventId: event.id }, 'Subscription missing community_id');
      return;
    }

    const status = this.billingProvider.mapSubscriptionStatus(data.status);
    const tier = data.customData?.tier as SubscriptionTier | undefined;

    updateSubscription(communityId, {
      tier: tier || undefined,
      status,
      currentPeriodStart: data.currentBillingPeriod
        ? new Date(data.currentBillingPeriod.startsAt)
        : undefined,
      currentPeriodEnd: data.currentBillingPeriod
        ? new Date(data.currentBillingPeriod.endsAt)
        : undefined,
      graceUntil: status === 'active' ? null : undefined,
    });

    await redisService.invalidateEntitlements(communityId);

    logBillingAuditEvent(
      'subscription_updated',
      {
        communityId,
        tier,
        status,
        cancelAtPeriodEnd: data.scheduledChange?.action === 'cancel',
      },
      communityId
    );

    logger.info({ communityId, tier, status }, 'Subscription updated');
  }

  private async handleSubscriptionCanceled(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      customData?: { community_id?: string };
    };

    const communityId = data.customData?.community_id;
    if (!communityId) {
      logger.warn({ eventId: event.id }, 'Subscription missing community_id');
      return;
    }

    updateSubscription(communityId, {
      status: 'canceled',
      tier: 'starter',
      graceUntil: null,
    });

    await redisService.invalidateEntitlements(communityId);

    logBillingAuditEvent(
      'subscription_canceled',
      { communityId, canceledAt: new Date().toISOString() },
      communityId
    );

    logger.info({ communityId }, 'Subscription canceled, downgraded to starter');
  }

  private async handlePaymentCompleted(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      customData?: {
        community_id?: string;
        member_id?: string;
        type?: string;
        months?: string;
      };
      details?: { totals?: { total?: string } };
    };

    const paymentType = data.customData?.type;

    // Route to boost payment handler
    if (paymentType === 'boost_purchase') {
      await this.handleBoostPaymentCompleted(event);
      return;
    }

    // Route to badge payment handler
    if (paymentType === 'badge_purchase') {
      await this.handleBadgePaymentCompleted(event);
      return;
    }

    // Default: Subscription payment
    const communityId = data.customData?.community_id;
    if (!communityId) {
      logger.debug({ eventId: event.id }, 'Payment not associated with community');
      return;
    }

    updateSubscription(communityId, {
      status: 'active',
      graceUntil: null,
    });

    await redisService.invalidateEntitlements(communityId);

    logBillingAuditEvent(
      'payment_succeeded',
      {
        communityId,
        transactionId: data.id,
        amount: data.details?.totals?.total,
      },
      communityId
    );

    logger.info({ communityId, transactionId: data.id }, 'Payment completed');
  }

  private async handlePaymentFailed(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      subscriptionId?: string;
      customData?: { community_id?: string };
    };

    const communityId = data.customData?.community_id;
    if (!communityId) {
      logger.debug({ eventId: event.id }, 'Failed payment not associated with community');
      return;
    }

    const graceUntil = new Date(Date.now() + GRACE_PERIOD_MS);

    updateSubscription(communityId, {
      status: 'past_due',
      graceUntil,
    });

    await redisService.invalidateEntitlements(communityId);

    logBillingAuditEvent(
      'payment_failed',
      {
        communityId,
        transactionId: data.id,
        graceUntil: graceUntil.toISOString(),
      },
      communityId
    );

    logBillingAuditEvent(
      'grace_period_started',
      { communityId, graceUntil: graceUntil.toISOString() },
      communityId
    );

    logger.warn({ communityId, graceUntil }, 'Payment failed, grace period started');
  }

  private async handleBoostPaymentCompleted(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      customData?: {
        community_id?: string;
        member_id?: string;
        months?: string;
      };
      details?: { totals?: { total?: string } };
    };

    const communityId = data.customData?.community_id;
    const memberId = data.customData?.member_id;
    const months = parseInt(data.customData?.months || '0', 10);
    const amountPaid = parseInt(data.details?.totals?.total || '0', 10);

    if (!communityId || !memberId || !months) {
      logger.warn({ eventId: event.id }, 'Boost payment missing required metadata');
      return;
    }

    try {
      const purchase = await boostService.processBoostPayment({
        paymentSessionId: event.id,
        paymentId: data.id,
        memberId,
        communityId,
        months,
        amountPaidCents: amountPaid,
      });

      logger.info(
        { communityId, memberId, months, purchaseId: purchase.id },
        'Boost payment processed'
      );
    } catch (error) {
      logger.error(
        { error: (error as Error).message, eventId: event.id },
        'Failed to process boost payment'
      );
      throw error;
    }
  }

  private async handleBadgePaymentCompleted(event: ProviderWebhookEvent): Promise<void> {
    const data = event.data as {
      id: string;
      customData?: {
        community_id?: string;
        member_id?: string;
      };
    };

    const communityId = data.customData?.community_id;
    const memberId = data.customData?.member_id;

    if (!communityId || !memberId) {
      logger.warn({ eventId: event.id }, 'Badge payment missing required metadata');
      return;
    }

    try {
      const { badgeService } = await import('../badge/BadgeService.js');

      badgeService.recordBadgePurchase({
        memberId,
        paymentId: data.id,
      });

      logger.info({ communityId, memberId }, 'Badge payment processed');
    } catch (error) {
      logger.error(
        { error: (error as Error).message, eventId: event.id },
        'Failed to process badge payment'
      );
      throw error;
    }
  }
}
```

---

## 7. Configuration Updates

### 7.1 Environment Variables

**File**: `.env.example` (new variables)

```env
# =============================================================================
# Paddle Configuration (replaces Stripe)
# =============================================================================

# Paddle API key (from Paddle dashboard > Developer Tools > API Keys)
PADDLE_API_KEY=pdl_live_xxx

# Paddle webhook secret (from Paddle dashboard > Developer Tools > Notifications)
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx

# Paddle environment (sandbox or production)
PADDLE_ENVIRONMENT=production

# Paddle client token for Paddle.js (from Paddle dashboard)
PADDLE_CLIENT_TOKEN=live_xxx

# =============================================================================
# Paddle Price IDs (configured in Paddle dashboard > Catalog > Prices)
# =============================================================================

PADDLE_PRICE_STARTER=pri_starter_xxx
PADDLE_PRICE_BASIC=pri_basic_xxx
PADDLE_PRICE_PREMIUM=pri_premium_xxx
PADDLE_PRICE_EXCLUSIVE=pri_exclusive_xxx
PADDLE_PRICE_ELITE=pri_elite_xxx

# =============================================================================
# Paddle One-Time Product Price IDs
# =============================================================================

PADDLE_PRICE_BADGE=pri_badge_xxx
PADDLE_PRICE_BOOST_1_MONTH=pri_boost_1_xxx
PADDLE_PRICE_BOOST_3_MONTH=pri_boost_3_xxx
PADDLE_PRICE_BOOST_6_MONTH=pri_boost_6_xxx
PADDLE_PRICE_BOOST_12_MONTH=pri_boost_12_xxx
```

### 7.2 Config Module Updates

**File**: `sietch-service/src/config.ts` (updated)

```typescript
// Paddle configuration (replaces Stripe)
paddle: {
  apiKey: process.env.PADDLE_API_KEY || '',
  webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || '',
  environment: (process.env.PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
  clientToken: process.env.PADDLE_CLIENT_TOKEN || '',
  priceIds: new Map<SubscriptionTier, string>([
    ['starter', process.env.PADDLE_PRICE_STARTER || ''],
    ['basic', process.env.PADDLE_PRICE_BASIC || ''],
    ['premium', process.env.PADDLE_PRICE_PREMIUM || ''],
    ['exclusive', process.env.PADDLE_PRICE_EXCLUSIVE || ''],
    ['elite', process.env.PADDLE_PRICE_ELITE || ''],
  ]),
  oneTimePriceIds: {
    badge: process.env.PADDLE_PRICE_BADGE || '',
    boost1Month: process.env.PADDLE_PRICE_BOOST_1_MONTH || '',
    boost3Month: process.env.PADDLE_PRICE_BOOST_3_MONTH || '',
    boost6Month: process.env.PADDLE_PRICE_BOOST_6_MONTH || '',
    boost12Month: process.env.PADDLE_PRICE_BOOST_12_MONTH || '',
  },
},
```

---

## 8. API Route Updates

### 8.1 Webhook Endpoint

**File**: `sietch-service/src/api/billing.routes.ts` (webhook handler)

```typescript
/**
 * POST /api/billing/webhook
 *
 * Paddle webhook endpoint
 * - Verifies HMAC-SHA256 signature
 * - Processes events idempotently
 */
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['paddle-signature'] as string;

    if (!signature) {
      return res.status(400).json({ error: 'Missing Paddle-Signature header' });
    }

    try {
      const event = webhookService.verifySignature(req.body, signature);
      const result = await webhookService.processEvent(event);

      if (result.status === 'failed') {
        return res.status(500).json({ error: result.error });
      }

      return res.json({ received: true, ...result });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Webhook processing error');
      return res.status(400).json({ error: (error as Error).message });
    }
  }
);
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

| Component | Test File | Coverage |
|-----------|-----------|----------|
| `PaddleBillingAdapter` | `PaddleBillingAdapter.test.ts` | Customer management, checkout, subscriptions |
| `WebhookService` | `WebhookService.test.ts` | Event processing, idempotency, handlers |
| `IBillingProvider` | `IBillingProvider.test.ts` | Interface contract tests |

### 9.2 Integration Tests

| Scenario | Test |
|----------|------|
| Checkout flow | Create checkout → Complete → Verify subscription |
| Subscription lifecycle | Create → Update tier → Cancel → Verify |
| Payment failure | Simulate failure → Verify grace period |
| Webhook idempotency | Send duplicate events → Verify single processing |

### 9.3 Paddle Sandbox Testing

1. Configure sandbox credentials in `.env.test`
2. Create test products/prices in Paddle sandbox dashboard
3. Use Paddle's test card numbers for checkout testing
4. Simulate webhook events via Paddle dashboard

---

## 10. Migration Plan

### 10.1 Pre-Migration Checklist

- [ ] Set up Paddle account and sandbox environment
- [ ] Create products and prices in Paddle dashboard
- [ ] Configure webhook notification destination
- [ ] Generate API keys and client tokens
- [ ] Update `.env` with Paddle credentials

### 10.2 Implementation Phases

| Phase | Tasks | Sprint |
|-------|-------|--------|
| 1 | Create `IBillingProvider` interface and port | Sprint 1 |
| 2 | Implement `PaddleBillingAdapter` | Sprint 1 |
| 3 | Update database schema (migration) | Sprint 1 |
| 4 | Update `WebhookService` for Paddle events | Sprint 2 |
| 5 | Update API routes and config | Sprint 2 |
| 6 | Remove Stripe code and dependencies | Sprint 2 |
| 7 | Integration testing and validation | Sprint 2 |

### 10.3 Rollback Strategy

If critical issues arise:
1. Revert to previous commit (Stripe code in git history)
2. Restore database schema via rollback migration
3. Update `.env` with Stripe credentials

---

## 11. Security Considerations

### 11.1 Webhook Security

| Control | Implementation |
|---------|----------------|
| Signature verification | HMAC-SHA256 via Paddle SDK |
| Idempotency | Redis lock + database deduplication |
| Audit logging | All events logged to `billing_audit_log` |
| RLS context | Tenant isolation per operation |

### 11.2 API Key Security

| Control | Implementation |
|---------|----------------|
| Storage | Environment variables only |
| Rotation | Support key rotation without downtime |
| Access | Restricted to billing service only |

### 11.3 PCI Compliance

Paddle is PCI DSS Level 1 compliant. As a Merchant of Record:
- Paddle handles all card data
- Arrakis never sees or stores card numbers
- Checkout happens on Paddle's secure page

---

## 12. Observability

### 12.1 Logging

```typescript
// Structured logging with correlation IDs
logger.info({
  communityId,
  transactionId,
  tier,
  provider: 'paddle',
  correlationId,
}, 'Checkout session created');
```

### 12.2 Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `billing.checkout.created` | Counter | Checkout sessions created |
| `billing.checkout.completed` | Counter | Successful checkouts |
| `billing.payment.failed` | Counter | Failed payments |
| `billing.webhook.processed` | Counter | Webhooks processed |
| `billing.webhook.duplicate` | Counter | Duplicate webhooks skipped |
| `billing.webhook.latency` | Histogram | Webhook processing time |

### 12.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| High payment failure rate | >5% failures in 1 hour | Warning |
| Webhook processing errors | >10 failures in 5 minutes | Critical |
| Provider health check failed | 3 consecutive failures | Critical |

---

## 13. Dependencies

### 13.1 Add

```json
{
  "@paddle/paddle-node-sdk": "^1.4.0"
}
```

### 13.2 Remove

```json
{
  "stripe": "^14.x.x"
}
```

---

## 14. File Summary

### 14.1 New Files

| File | Purpose |
|------|---------|
| `src/packages/core/ports/IBillingProvider.ts` | Billing provider interface |
| `src/packages/adapters/billing/PaddleBillingAdapter.ts` | Paddle adapter implementation |
| `src/packages/adapters/billing/index.ts` | Adapter exports |
| `src/db/migrations/003_paddle_migration.sql` | Schema migration |

### 14.2 Modified Files

| File | Changes |
|------|---------|
| `src/services/billing/WebhookService.ts` | Provider-agnostic event handling |
| `src/db/billing-queries.ts` | Renamed columns, updated types |
| `src/types/billing.ts` | Provider-agnostic field names |
| `src/config.ts` | Paddle configuration |
| `src/api/billing.routes.ts` | Paddle webhook signature header |
| `package.json` | Add Paddle SDK, remove Stripe |

### 14.3 Removed Files

| File | Reason |
|------|--------|
| `src/services/billing/StripeService.ts` | Replaced by `PaddleBillingAdapter` |

---

## 15. Success Criteria

- [ ] All subscription tiers purchasable via Paddle
- [ ] Badge and boost one-time payments functional
- [ ] Webhook processing with idempotency
- [ ] Grace period handling on payment failure
- [ ] Customer portal for subscription management
- [ ] Audit trail for all payment events
- [ ] Existing billing tests pass (adapted for Paddle)
- [ ] No Stripe references remain in source code

---

## 16. Next Steps

1. **Run `/sprint-plan`** to create implementation sprints
2. Set up Paddle sandbox account
3. Configure test products in Paddle dashboard
4. Begin Sprint 1 implementation

---

**Document Status**: READY FOR SPRINT PLANNING

**Approval**: Pending user review
