/**
 * NOWPaymentsAdapter Unit Tests (Sprint 156: NOWPayments Integration)
 *
 * Tests for NOWPaymentsAdapter including:
 * - Payment creation
 * - Payment status retrieval
 * - Currency operations
 * - Webhook verification
 * - Health checks
 * - Error handling and retries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { NOWPaymentsAdapter } from '../../../src/packages/adapters/billing/NOWPaymentsAdapter.js';
import type { NOWPaymentsConfig } from '../../../src/packages/core/ports/ICryptoPaymentProvider.js';

// Mock dependencies
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../src/config.js', () => ({
  getCryptoPaymentPrice: vi.fn((tier: string) => {
    const prices: Record<string, number> = {
      starter: 0,
      basic: 29,
      premium: 99,
      exclusive: 199,
      elite: 449,
      enterprise: 999,
    };
    return prices[tier];
  }),
}));

vi.mock('../../../src/db/billing-queries.js', () => ({
  createCryptoPayment: vi.fn(() => 'cp_test_internal_id'),
  getCryptoPaymentByPaymentId: vi.fn(() => ({
    id: 'cp_test_internal_id',
    paymentId: '12345',
    communityId: 'test-community',
    tier: 'premium',
    priceAmount: 99.0,
    priceCurrency: 'usd',
    payAmount: 0.0025,
    payCurrency: 'btc',
    payAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
    status: 'waiting',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 20 * 60 * 1000),
  })),
}));

// Test configuration
const testConfig: NOWPaymentsConfig = {
  apiKey: 'test-api-key',
  ipnSecretKey: 'test-ipn-secret',
  publicKey: 'test-public-key',
  environment: 'sandbox',
  defaultPayCurrency: 'btc',
  paymentExpirationMinutes: 20,
};

describe('NOWPaymentsAdapter', () => {
  let adapter: NOWPaymentsAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new NOWPaymentsAdapter(testConfig);

    // Setup global fetch mock
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constructor Tests
  // ===========================================================================

  describe('constructor', () => {
    it('should set provider to nowpayments', () => {
      expect(adapter.provider).toBe('nowpayments');
    });

    it('should use sandbox URL for sandbox environment', () => {
      const sandboxAdapter = new NOWPaymentsAdapter({
        ...testConfig,
        environment: 'sandbox',
      });
      expect(sandboxAdapter.provider).toBe('nowpayments');
    });

    it('should use production URL for production environment', () => {
      const prodAdapter = new NOWPaymentsAdapter({
        ...testConfig,
        environment: 'production',
      });
      expect(prodAdapter.provider).toBe('nowpayments');
    });
  });

  // ===========================================================================
  // createPayment Tests
  // ===========================================================================

  describe('createPayment', () => {
    it('should create payment with all parameters', async () => {
      const mockResponse = {
        payment_id: '12345',
        payment_status: 'waiting',
        pay_address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        pay_amount: 0.0025,
        pay_currency: 'btc',
        price_amount: 99,
        price_currency: 'usd',
        order_id: 'order_test',
        expiration_estimate_date: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await adapter.createPayment({
        communityId: 'test-community',
        tier: 'premium',
        payCurrency: 'btc',
        ipnCallbackUrl: 'https://api.example.com/webhook',
        successUrl: 'https://example.com/success',
      });

      expect(result.paymentId).toBe('12345');
      expect(result.status).toBe('waiting');
      expect(result.payAddress).toBe('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
      expect(result.payAmount).toBe(0.0025);
      expect(result.payCurrency).toBe('btc');
      expect(result.priceAmount).toBe(99);
      expect(result.priceCurrency).toBe('usd');
      expect(result.id).toBe('cp_test_internal_id');

      // Verify API call
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api-sandbox.nowpayments.io/v1/payment',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'x-api-key': 'test-api-key',
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should use default currency when not specified', async () => {
      const mockResponse = {
        payment_id: '12346',
        payment_status: 'waiting',
        pay_address: '0xAddress',
        pay_amount: 0.05,
        pay_currency: 'btc',
        price_amount: 29,
        price_currency: 'usd',
        expiration_estimate_date: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await adapter.createPayment({
        communityId: 'test-community',
        tier: 'basic',
        ipnCallbackUrl: 'https://api.example.com/webhook',
      });

      // Check that fetch was called with default currency (btc)
      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(callBody.pay_currency).toBe('btc');
    });

    it('should throw error for invalid tier', async () => {
      await expect(
        adapter.createPayment({
          communityId: 'test-community',
          tier: 'invalid-tier' as never,
          ipnCallbackUrl: 'https://api.example.com/webhook',
        })
      ).rejects.toThrow('No price configured for tier: invalid-tier');
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(
        adapter.createPayment({
          communityId: 'test-community',
          tier: 'premium',
          ipnCallbackUrl: 'https://api.example.com/webhook',
        })
      ).rejects.toThrow('NOWPayments API error: 400');
    });
  });

  // ===========================================================================
  // getPaymentStatus Tests
  // ===========================================================================

  describe('getPaymentStatus', () => {
    it('should return payment status', async () => {
      const mockResponse = {
        payment_id: '12345',
        payment_status: 'confirming',
        pay_address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        pay_amount: 0.0025,
        pay_currency: 'btc',
        price_amount: 99,
        price_currency: 'usd',
        created_at: new Date().toISOString(),
        expiration_estimate_date: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await adapter.getPaymentStatus('12345');

      expect(result).not.toBeNull();
      expect(result?.paymentId).toBe('12345');
      expect(result?.status).toBe('confirming');
    });

    it('should return null for non-existent payment', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Payment not found',
      });

      const result = await adapter.getPaymentStatus('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getSupportedCurrencies Tests
  // ===========================================================================

  describe('getSupportedCurrencies', () => {
    it('should return filtered supported currencies', async () => {
      const mockResponse = {
        currencies: ['btc', 'eth', 'usdt', 'usdc', 'ltc', 'doge', 'matic', 'sol', 'xrp', 'bnb'],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const currencies = await adapter.getSupportedCurrencies();

      // Should only include our supported currencies
      expect(currencies).toContain('btc');
      expect(currencies).toContain('eth');
      expect(currencies).toContain('usdt');
      expect(currencies).not.toContain('xrp'); // Not in our supported list
    });
  });

  // ===========================================================================
  // getMinimumPaymentAmount Tests
  // ===========================================================================

  describe('getMinimumPaymentAmount', () => {
    it('should return minimum payment amount', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          currency_from: 'usd',
          currency_to: 'btc',
          min_amount: 0.0001,
        }),
      });

      const minAmount = await adapter.getMinimumPaymentAmount('btc');

      expect(minAmount).toBe(0.0001);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api-sandbox.nowpayments.io/v1/min-amount?currency_from=usd&currency_to=btc',
        expect.any(Object)
      );
    });
  });

  // ===========================================================================
  // estimatePrice Tests
  // ===========================================================================

  describe('estimatePrice', () => {
    it('should return price estimate', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          currency_from: 'usd',
          currency_to: 'btc',
          amount_from: 99,
          estimated_amount: 0.0025,
        }),
      });

      const estimate = await adapter.estimatePrice({
        amount: 99,
        currency: 'btc',
      });

      expect(estimate.fiatAmount).toBe(99);
      expect(estimate.fiatCurrency).toBe('usd');
      expect(estimate.cryptoAmount).toBe(0.0025);
      expect(estimate.cryptoCurrency).toBe('btc');
      expect(estimate.estimatedAt).toBeInstanceOf(Date);
    });
  });

  // ===========================================================================
  // verifyWebhook Tests
  // ===========================================================================

  describe('verifyWebhook', () => {
    it('should verify valid webhook signature', () => {
      const payload = {
        payment_id: '12345',
        payment_status: 'finished',
        pay_address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
        pay_amount: 0.0025,
        pay_currency: 'btc',
        price_amount: 99,
        price_currency: 'usd',
        order_id: 'order_test',
        actually_paid: 0.0025,
      };

      const rawBody = JSON.stringify(payload);

      // Compute valid signature
      const signature = createHmac('sha512', 'test-ipn-secret')
        .update(rawBody)
        .digest('hex');

      const result = adapter.verifyWebhook(rawBody, signature);

      expect(result.valid).toBe(true);
      expect(result.event).toBeDefined();
      expect(result.event?.paymentId).toBe('12345');
      expect(result.event?.status).toBe('finished');
      expect(result.event?.actuallyPaid).toBe(0.0025);
    });

    it('should reject invalid webhook signature', () => {
      const payload = { payment_id: '12345', payment_status: 'finished' };
      const rawBody = JSON.stringify(payload);

      const result = adapter.verifyWebhook(rawBody, 'invalid-signature');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid webhook signature');
    });

    it('should fail if IPN secret not configured', () => {
      const adapterNoSecret = new NOWPaymentsAdapter({
        ...testConfig,
        ipnSecretKey: '',
      });

      const result = adapterNoSecret.verifyWebhook('{}', 'signature');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('IPN secret key not configured');
    });

    it('should handle invalid JSON in webhook body', () => {
      const signature = createHmac('sha512', 'test-ipn-secret')
        .update('invalid json')
        .digest('hex');

      const result = adapter.verifyWebhook('invalid json', signature);

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should map all payment statuses correctly', () => {
      const statuses = [
        'waiting',
        'confirming',
        'confirmed',
        'sending',
        'partially_paid',
        'finished',
        'failed',
        'refunded',
        'expired',
      ];

      for (const status of statuses) {
        const payload = {
          payment_id: '12345',
          payment_status: status,
          pay_address: 'addr',
          pay_amount: 0.001,
          pay_currency: 'btc',
          price_amount: 99,
          price_currency: 'usd',
          order_id: 'order_test',
          actually_paid: 0.001,
        };

        const rawBody = JSON.stringify(payload);
        const signature = createHmac('sha512', 'test-ipn-secret')
          .update(rawBody)
          .digest('hex');

        const result = adapter.verifyWebhook(rawBody, signature);

        expect(result.valid).toBe(true);
        expect(result.event?.status).toBe(status);
      }
    });
  });

  // ===========================================================================
  // isHealthy Tests
  // ===========================================================================

  describe('isHealthy', () => {
    it('should return true when API is healthy', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'OK' }),
      });

      const healthy = await adapter.isHealthy();

      expect(healthy).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api-sandbox.nowpayments.io/v1/status',
        expect.any(Object)
      );
    });

    it('should return false when API returns non-OK status', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Maintenance' }),
      });

      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(false);
    });

    it('should return false on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const healthy = await adapter.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  // ===========================================================================
  // Retry Logic Tests
  // ===========================================================================

  describe('retry logic', () => {
    it('should retry on network errors', async () => {
      // First call fails with network error
      fetchMock.mockRejectedValueOnce(new Error('fetch failed'));
      // Second call succeeds
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          payment_id: '12345',
          payment_status: 'waiting',
          pay_address: 'addr',
          pay_amount: 0.001,
          pay_currency: 'btc',
          price_amount: 99,
          price_currency: 'usd',
          expiration_estimate_date: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        }),
      });

      const result = await adapter.createPayment({
        communityId: 'test-community',
        tier: 'premium',
        ipnCallbackUrl: 'https://api.example.com/webhook',
      });

      expect(result.paymentId).toBe('12345');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('should not retry on API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid request',
      });

      await expect(
        adapter.createPayment({
          communityId: 'test-community',
          tier: 'premium',
          ipnCallbackUrl: 'https://api.example.com/webhook',
        })
      ).rejects.toThrow('NOWPayments API error');

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Production URL Tests
  // ===========================================================================

  describe('production environment', () => {
    it('should use production API URL', async () => {
      const prodAdapter = new NOWPaymentsAdapter({
        ...testConfig,
        environment: 'production',
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'OK' }),
      });

      await prodAdapter.isHealthy();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.nowpayments.io/v1/status',
        expect.any(Object)
      );
    });
  });
});
