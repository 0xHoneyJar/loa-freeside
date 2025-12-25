/**
 * StripeService Unit Tests (v4.0 - Sprint 23)
 *
 * Tests for Stripe integration service with mocked Stripe SDK.
 * Covers checkout sessions, portal sessions, subscription management,
 * webhook verification, and retry logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock functions that persist across module resets
const mockFns = {
  customersSearch: vi.fn(),
  customersRetrieve: vi.fn(),
  customersCreate: vi.fn(),
  checkoutSessionsCreate: vi.fn(),
  billingPortalSessionsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  webhooksConstructEvent: vi.fn(),
};

// Mock the entire stripe module - hoisted to top
vi.mock('stripe', () => {
  // Create a class that uses our shared mock functions
  class MockStripe {
    customers = {
      search: mockFns.customersSearch,
      retrieve: mockFns.customersRetrieve,
      create: mockFns.customersCreate,
    };
    checkout = {
      sessions: {
        create: mockFns.checkoutSessionsCreate,
      },
    };
    billingPortal = {
      sessions: {
        create: mockFns.billingPortalSessionsCreate,
      },
    };
    subscriptions = {
      retrieve: mockFns.subscriptionsRetrieve,
      update: mockFns.subscriptionsUpdate,
    };
    webhooks = {
      constructEvent: mockFns.webhooksConstructEvent,
    };

    constructor(_apiKey: string, _options?: any) {
      // Constructor does nothing - mocks are already set up
    }
  }

  // Add errors namespace for error type checking
  (MockStripe as any).errors = {
    StripeError: class StripeError extends Error {
      type: string;
      code?: string;
      constructor(params: { message: string; type?: string; code?: string }) {
        super(params.message);
        this.type = params.type || 'api_error';
        this.code = params.code;
        this.name = 'StripeError';
      }
    },
  };

  return { default: MockStripe };
});

// Mock config
vi.mock('../../../src/config.js', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_mock_key',
      webhookSecret: 'whsec_test_secret',
      priceIds: new Map([
        ['basic', 'price_basic_123'],
        ['premium', 'price_premium_456'],
        ['exclusive', 'price_exclusive_789'],
        ['elite', 'price_elite_012'],
      ]),
    },
  },
  getStripePriceId: vi.fn((tier: string) => {
    const priceIds: Record<string, string> = {
      basic: 'price_basic_123',
      premium: 'price_premium_456',
      exclusive: 'price_exclusive_789',
      elite: 'price_elite_012',
    };
    return priceIds[tier];
  }),
  SUBSCRIPTION_TIERS: {
    starter: { name: 'Starter', maxMembers: 100 },
    basic: { name: 'Basic', maxMembers: 250 },
    premium: { name: 'Premium', maxMembers: 500 },
    exclusive: { name: 'Exclusive', maxMembers: 1000 },
    elite: { name: 'Elite', maxMembers: 2500 },
    enterprise: { name: 'Enterprise', maxMembers: 10000 },
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock billing queries for portal session
vi.mock('../../../src/db/billing-queries.js', () => ({
  getSubscriptionByCommunityId: vi.fn(),
}));

describe('StripeService', () => {
  let stripeService: typeof import('../../../src/services/billing/StripeService.js').stripeService;

  beforeEach(async () => {
    // Clear all mock call history
    Object.values(mockFns).forEach((fn) => fn.mockClear());

    // Reset module cache to get fresh instance
    vi.resetModules();

    // Re-import to get fresh instance with mocks
    const module = await import('../../../src/services/billing/StripeService.js');
    stripeService = module.stripeService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Customer Management Tests
  // ===========================================================================

  describe('getOrCreateCustomer', () => {
    it('should return existing customer ID when customer exists', async () => {
      const mockCustomer = {
        id: 'cus_existing123',
        metadata: { community_id: 'test-community' },
      };

      mockFns.customersSearch.mockResolvedValueOnce({
        data: [mockCustomer],
      });

      const result = await stripeService.getOrCreateCustomer('test-community');

      expect(result).toBe('cus_existing123');
      expect(mockFns.customersSearch).toHaveBeenCalledWith({
        query: "metadata['community_id']:'test-community'",
        limit: 1,
      });
      expect(mockFns.customersCreate).not.toHaveBeenCalled();
    });

    it('should create new customer when none exists', async () => {
      mockFns.customersSearch.mockResolvedValueOnce({
        data: [],
      });

      mockFns.customersCreate.mockResolvedValueOnce({
        id: 'cus_new456',
      });

      const result = await stripeService.getOrCreateCustomer(
        'new-community',
        'test@example.com',
        'Test Community'
      );

      expect(result).toBe('cus_new456');
      expect(mockFns.customersCreate).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test Community',
        metadata: {
          community_id: 'new-community',
        },
      });
    });

    it('should escape single quotes in communityId to prevent injection', async () => {
      mockFns.customersSearch.mockResolvedValueOnce({
        data: [],
      });

      mockFns.customersCreate.mockResolvedValueOnce({
        id: 'cus_test',
      });

      await stripeService.getOrCreateCustomer("test'community");

      // Verify the query has escaped single quotes
      expect(mockFns.customersSearch).toHaveBeenCalledWith({
        query: "metadata['community_id']:'test\\'community'",
        limit: 1,
      });
    });
  });

  describe('getCustomer', () => {
    it('should return customer when found', async () => {
      const mockCustomer = {
        id: 'cus_123',
        email: 'test@example.com',
        deleted: false,
      };

      mockFns.customersRetrieve.mockResolvedValueOnce(mockCustomer);

      const result = await stripeService.getCustomer('cus_123');

      expect(result).toEqual(mockCustomer);
      expect(mockFns.customersRetrieve).toHaveBeenCalledWith('cus_123');
    });

    it('should return null for deleted customer', async () => {
      mockFns.customersRetrieve.mockResolvedValueOnce({
        id: 'cus_123',
        deleted: true,
      });

      const result = await stripeService.getCustomer('cus_123');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // Checkout Session Tests
  // ===========================================================================

  describe('createCheckoutSession', () => {
    it('should create checkout session with correct parameters', async () => {
      // Mock getOrCreateCustomer flow
      mockFns.customersSearch.mockResolvedValueOnce({
        data: [{ id: 'cus_existing' }],
      });

      const mockSession = {
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      };

      mockFns.checkoutSessionsCreate.mockResolvedValueOnce(mockSession);

      const result = await stripeService.createCheckoutSession({
        communityId: 'test-community',
        tier: 'premium',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(result).toEqual({
        sessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      });

      expect(mockFns.checkoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          customer: 'cus_existing',
          line_items: [
            {
              price: 'price_premium_456',
              quantity: 1,
            },
          ],
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
          metadata: expect.objectContaining({
            community_id: 'test-community',
            tier: 'premium',
          }),
          allow_promotion_codes: true,
          billing_address_collection: 'auto',
        })
      );
    });

    it('should throw error when session has no URL', async () => {
      mockFns.customersSearch.mockResolvedValueOnce({
        data: [{ id: 'cus_existing' }],
      });

      mockFns.checkoutSessionsCreate.mockResolvedValueOnce({
        id: 'cs_test_no_url',
        url: null,
      });

      await expect(
        stripeService.createCheckoutSession({
          communityId: 'test',
          tier: 'basic',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow('Stripe Checkout session created without URL');
    });

    it('should throw error for invalid tier', async () => {
      await expect(
        stripeService.createCheckoutSession({
          communityId: 'test',
          tier: 'invalid_tier' as any,
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        })
      ).rejects.toThrow('No Stripe price ID configured for tier');
    });

    it('should use provided customerId if available', async () => {
      const mockSession = {
        id: 'cs_test_456',
        url: 'https://checkout.stripe.com/custom',
      };

      mockFns.checkoutSessionsCreate.mockResolvedValueOnce(mockSession);

      const result = await stripeService.createCheckoutSession({
        communityId: 'test-community',
        tier: 'basic',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerId: 'cus_provided',
      });

      expect(result.sessionId).toBe('cs_test_456');
      expect(mockFns.customersSearch).not.toHaveBeenCalled();
      expect(mockFns.checkoutSessionsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_provided',
        })
      );
    });
  });

  // ===========================================================================
  // Subscription Management Tests
  // ===========================================================================

  describe('getStripeSubscription', () => {
    it('should return subscription when found', async () => {
      const mockSubscription = {
        id: 'sub_123',
        status: 'active',
        current_period_end: 1735689600,
      };

      mockFns.subscriptionsRetrieve.mockResolvedValueOnce(mockSubscription);

      const result = await stripeService.getStripeSubscription('sub_123');

      expect(result).toEqual(mockSubscription);
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription at period end', async () => {
      const mockSubscription = {
        id: 'sub_123',
        cancel_at_period_end: true,
      };

      mockFns.subscriptionsUpdate.mockResolvedValueOnce(mockSubscription);

      const result = await stripeService.cancelSubscription('sub_123');

      expect(result.cancel_at_period_end).toBe(true);
      expect(mockFns.subscriptionsUpdate).toHaveBeenCalledWith('sub_123', {
        cancel_at_period_end: true,
      });
    });
  });

  describe('resumeSubscription', () => {
    it('should resume canceled subscription', async () => {
      const mockSubscription = {
        id: 'sub_123',
        cancel_at_period_end: false,
      };

      mockFns.subscriptionsUpdate.mockResolvedValueOnce(mockSubscription);

      const result = await stripeService.resumeSubscription('sub_123');

      expect(result.cancel_at_period_end).toBe(false);
      expect(mockFns.subscriptionsUpdate).toHaveBeenCalledWith('sub_123', {
        cancel_at_period_end: false,
      });
    });
  });

  describe('updateSubscriptionTier', () => {
    it('should update subscription to new tier', async () => {
      mockFns.subscriptionsRetrieve.mockResolvedValueOnce({
        id: 'sub_123',
        items: {
          data: [{ id: 'si_item_123' }],
        },
      });

      const mockUpdatedSubscription = {
        id: 'sub_123',
        metadata: { tier: 'premium' },
      };

      mockFns.subscriptionsUpdate.mockResolvedValueOnce(mockUpdatedSubscription);

      const result = await stripeService.updateSubscriptionTier('sub_123', 'premium');

      expect(result.metadata?.tier).toBe('premium');
      expect(mockFns.subscriptionsUpdate).toHaveBeenCalledWith('sub_123', {
        items: [
          {
            id: 'si_item_123',
            price: 'price_premium_456',
          },
        ],
        metadata: { tier: 'premium' },
        proration_behavior: 'create_prorations',
      });
    });

    it('should throw error if no subscription item found', async () => {
      mockFns.subscriptionsRetrieve.mockResolvedValueOnce({
        id: 'sub_123',
        items: {
          data: [],
        },
      });

      await expect(
        stripeService.updateSubscriptionTier('sub_123', 'premium')
      ).rejects.toThrow('No subscription item found');
    });
  });

  // ===========================================================================
  // Webhook Helper Tests
  // ===========================================================================

  describe('constructWebhookEvent', () => {
    it('should verify webhook signature and return event', () => {
      const mockEvent = {
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        data: { object: {} },
      };

      mockFns.webhooksConstructEvent.mockReturnValueOnce(mockEvent);

      const result = stripeService.constructWebhookEvent(
        '{"id":"evt_test"}',
        'whsec_signature'
      );

      expect(result).toEqual(mockEvent);
      expect(mockFns.webhooksConstructEvent).toHaveBeenCalledWith(
        '{"id":"evt_test"}',
        'whsec_signature',
        'whsec_test_secret'
      );
    });

    it('should throw on invalid signature', () => {
      mockFns.webhooksConstructEvent.mockImplementationOnce(() => {
        throw new Error('Invalid signature');
      });

      expect(() =>
        stripeService.constructWebhookEvent('invalid_body', 'bad_signature')
      ).toThrow('Invalid signature');
    });
  });

  describe('mapSubscriptionStatus', () => {
    it('should map Stripe statuses correctly', () => {
      expect(stripeService.mapSubscriptionStatus('active')).toBe('active');
      expect(stripeService.mapSubscriptionStatus('past_due')).toBe('past_due');
      expect(stripeService.mapSubscriptionStatus('canceled')).toBe('canceled');
      expect(stripeService.mapSubscriptionStatus('trialing')).toBe('trialing');
      expect(stripeService.mapSubscriptionStatus('unpaid')).toBe('unpaid');
      expect(stripeService.mapSubscriptionStatus('incomplete')).toBe('unpaid');
      expect(stripeService.mapSubscriptionStatus('incomplete_expired')).toBe('unpaid');
      expect(stripeService.mapSubscriptionStatus('paused')).toBe('unpaid');
    });
  });

  describe('extractTierFromSubscription', () => {
    it('should extract tier from metadata', () => {
      const subscription = {
        id: 'sub_123',
        metadata: { tier: 'premium' },
        items: { data: [] },
      } as any;

      const result = stripeService.extractTierFromSubscription(subscription);

      expect(result).toBe('premium');
    });

    it('should extract tier from price ID when metadata missing', () => {
      const subscription = {
        id: 'sub_123',
        metadata: {},
        items: {
          data: [
            {
              price: { id: 'price_basic_123' },
            },
          ],
        },
      } as any;

      const result = stripeService.extractTierFromSubscription(subscription);

      expect(result).toBe('basic');
    });

    it('should return null when tier cannot be determined', () => {
      const subscription = {
        id: 'sub_123',
        metadata: {},
        items: {
          data: [
            {
              price: { id: 'price_unknown' },
            },
          ],
        },
      } as any;

      const result = stripeService.extractTierFromSubscription(subscription);

      expect(result).toBeNull();
    });
  });
});
