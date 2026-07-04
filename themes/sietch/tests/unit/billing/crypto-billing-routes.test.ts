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

import express from 'express';
import request from 'supertest';
import { cryptoBillingRouter } from '../../../src/api/crypto-billing.routes.js';
import { cryptoWebhookService } from '../../../src/services/billing/index.js';

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

  // ===========================================================================
  // App-mounted webhook endpoint — hardened-path contract
  //
  // Proves the endpoint production traffic actually hits (server.ts mounts
  // cryptoBillingRouter at /api/crypto with express.raw for /webhook)
  // exercises the hardened semantics: verified events flow through
  // cryptoWebhookService.processEvent, quarantine-record failure is a
  // retriable 503, and durable quarantine is an acked 200.
  // ===========================================================================

  describe('POST /api/crypto/webhook (app-mounted)', () => {
    function makeApp() {
      const app = express();
      // Mirror server.ts raw-body config for the webhook path
      app.use('/api/crypto/webhook', express.raw({
        type: 'application/json',
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }));
      app.use('/api/crypto', cryptoBillingRouter);
      return app;
    }

    const mockedService = vi.mocked(cryptoWebhookService);

    beforeEach(() => {
      mockedService.verifySignature.mockReturnValue({
        paymentId: '12345',
        status: 'finished',
        actuallyPaid: 0.0025,
        payCurrency: 'btc',
        priceAmount: 99,
        orderId: 'order_test',
        timestamp: new Date(),
        rawData: {},
      } as any);
    });

    async function post(app: ReturnType<typeof makeApp>) {
      return request(app)
        .post('/api/crypto/webhook')
        .set('content-type', 'application/json')
        .set('x-nowpayments-sig', 'a'.repeat(128))
        .send(JSON.stringify({ payment_id: 12345, payment_status: 'finished' }));
    }

    it('routes verified events through cryptoWebhookService.processEvent and acks', async () => {
      mockedService.processEvent.mockResolvedValue({
        status: 'processed',
        paymentId: '12345',
        paymentStatus: 'finished',
      } as any);

      const res = await post(makeApp());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true, status: 'processed' });
      expect(mockedService.processEvent).toHaveBeenCalledTimes(1);
    });

    it('acks a durably quarantined stale event with 200', async () => {
      mockedService.processEvent.mockResolvedValue({
        status: 'quarantined',
        paymentId: '12345',
        paymentStatus: 'finished',
        message: 'Event timestamp too old - quarantined for reconciliation',
      } as any);

      const res = await post(makeApp());

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ received: true, status: 'quarantined' });
    });

    it('returns retriable 503 when a stale event cannot be durably recorded', async () => {
      mockedService.processEvent.mockResolvedValue({
        status: 'quarantine_failed',
        paymentId: '12345',
        paymentStatus: 'finished',
        error: 'Stale event could not be durably recorded',
      } as any);

      const res = await post(makeApp());

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ received: false, status: 'quarantine_failed' });
    });
  });
});
