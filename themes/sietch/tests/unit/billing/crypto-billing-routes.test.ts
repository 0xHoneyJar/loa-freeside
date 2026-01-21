/**
 * Crypto Billing Routes Unit Tests (Sprint 158: NOWPayments Integration)
 *
 * Tests for route registration and middleware
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing routes
vi.mock('../../../src/config.js', () => ({
  config: {
    baseUrl: 'https://test.example.com',
    nowpayments: {
      apiKey: 'test-api-key',
      ipnSecretKey: 'test-ipn-secret',
      environment: 'sandbox',
      defaultPayCurrency: 'btc',
      paymentExpirationMinutes: 20,
    },
    features: {
      cryptoPaymentsEnabled: true,
    },
  },
  isCryptoPaymentsEnabled: vi.fn().mockReturnValue(true),
  getNOWPaymentsClientConfig: vi.fn().mockReturnValue({
    apiKey: 'test-api-key',
    ipnSecretKey: 'test-ipn-secret',
    environment: 'sandbox',
    defaultPayCurrency: 'btc',
    paymentExpirationMinutes: 20,
    apiUrl: 'https://api-sandbox.nowpayments.io/v1',
  }),
  SUBSCRIPTION_TIERS: {
    basic: { name: 'Basic', price: 29 },
    premium: { name: 'Premium', price: 99 },
    exclusive: { name: 'Exclusive', price: 199 },
    elite: { name: 'Elite', price: 499 },
    enterprise: { name: 'Enterprise', price: 999 },
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/services/cache/RedisService.js', () => ({
  redisService: {
    isConnected: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../../src/packages/adapters/billing/index.js', () => ({
  createCryptoPaymentProvider: vi.fn(),
}));

vi.mock('../../../src/services/billing/index.js', () => ({
  cryptoWebhookService: {
    setCryptoProvider: vi.fn(),
    verifySignature: vi.fn(),
    processEvent: vi.fn(),
  },
}));

vi.mock('../../../src/db/billing-queries.js', () => ({
  createCryptoPayment: vi.fn(),
  getCryptoPaymentByPaymentId: vi.fn(),
  getCryptoPaymentByOrderId: vi.fn(),
  logBillingAuditEvent: vi.fn(),
}));

import { cryptoBillingRouter } from '../../../src/api/crypto-billing.routes.js';

describe('Crypto Billing Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('router registration', () => {
    it('should export cryptoBillingRouter', () => {
      expect(cryptoBillingRouter).toBeDefined();
    });

    it('should have routes registered', () => {
      // Express routers have a stack property containing middleware and routes
      const stack = (cryptoBillingRouter as any).stack;
      expect(Array.isArray(stack)).toBe(true);
      expect(stack.length).toBeGreaterThan(0);
    });

    it('should have payment route', () => {
      const stack = (cryptoBillingRouter as any).stack;
      const routes = stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/payment',
          methods: expect.arrayContaining(['post']),
        })
      );
    });

    it('should have payment/:paymentId route', () => {
      const stack = (cryptoBillingRouter as any).stack;
      const routes = stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/payment/:paymentId',
          methods: expect.arrayContaining(['get']),
        })
      );
    });

    it('should have currencies route', () => {
      const stack = (cryptoBillingRouter as any).stack;
      const routes = stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/currencies',
          methods: expect.arrayContaining(['get']),
        })
      );
    });

    it('should have estimate route', () => {
      const stack = (cryptoBillingRouter as any).stack;
      const routes = stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/estimate',
          methods: expect.arrayContaining(['get']),
        })
      );
    });

    it('should have webhook route', () => {
      const stack = (cryptoBillingRouter as any).stack;
      const routes = stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          methods: Object.keys(layer.route.methods),
        }));

      expect(routes).toContainEqual(
        expect.objectContaining({
          path: '/webhook',
          methods: expect.arrayContaining(['post']),
        })
      );
    });
  });
});
