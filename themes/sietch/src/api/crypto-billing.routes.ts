/**
 * Crypto Billing API Routes (Sprint 158: NOWPayments Integration)
 *
 * Handles cryptocurrency payment endpoints:
 * - POST /crypto/payment - Create crypto payment
 * - GET /crypto/payment/:paymentId - Get payment status
 * - GET /crypto/currencies - Get supported currencies
 * - GET /crypto/estimate - Get price estimate
 * - POST /crypto/webhook - Handle NOWPayments webhooks
 *
 * All routes except webhook require authentication.
 * Webhook uses HMAC-SHA512 signature verification via ICryptoPaymentProvider.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import type { AuthenticatedRequest, RawBodyRequest } from './middleware.js';
import {
  memberRateLimiter,
  webhookRateLimiter,
  requireApiKey,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import {
  config,
  isCryptoPaymentsEnabled,
  getNOWPaymentsClientConfig,
  SUBSCRIPTION_TIERS,
} from '../config.js';
import { createCryptoPaymentProvider } from '../packages/adapters/billing/index.js';
import type { CryptoCurrency, NOWPaymentsConfig } from '../packages/core/ports/ICryptoPaymentProvider.js';
import { cryptoWebhookService } from '../services/billing/index.js';
import {
  createCryptoPayment,
  getCryptoPaymentByPaymentId,
  getCryptoPaymentByOrderId,
  logBillingAuditEvent,
} from '../db/billing-queries.js';
import { logger } from '../utils/logger.js';
import type { ICryptoPaymentProvider } from '../packages/core/ports/ICryptoPaymentProvider.js';
import type { SubscriptionTier } from '../types/billing.js';

// =============================================================================
// Router Setup
// =============================================================================

export const cryptoBillingRouter = Router();

// Apply rate limiting to all routes
cryptoBillingRouter.use(memberRateLimiter);

// =============================================================================
// Crypto Provider Initialization
// =============================================================================

let cryptoProvider: ICryptoPaymentProvider | null = null;

/**
 * Get or initialize the crypto payment provider
 */
function getCryptoProvider(): ICryptoPaymentProvider {
  if (!cryptoProvider) {
    if (!isCryptoPaymentsEnabled()) {
      throw new Error('Crypto payments are not configured');
    }

    const clientConfig = getNOWPaymentsClientConfig();
    // Convert client config to NOWPaymentsConfig
    const nowpaymentsConfig: NOWPaymentsConfig = {
      apiKey: clientConfig.apiKey,
      ipnSecretKey: clientConfig.ipnSecretKey,
      publicKey: clientConfig.publicKey,
      environment: clientConfig.environment,
      defaultPayCurrency: clientConfig.defaultPayCurrency as CryptoCurrency,
      paymentExpirationMinutes: clientConfig.paymentExpirationMinutes,
    };

    cryptoProvider = createCryptoPaymentProvider({
      provider: 'nowpayments',
      nowpayments: nowpaymentsConfig,
    });

    // Inject provider into webhook service
    cryptoWebhookService.setCryptoProvider(cryptoProvider);
  }
  return cryptoProvider;
}

// =============================================================================
// Middleware: Check Crypto Payments Enabled
// =============================================================================

/**
 * Middleware to check if crypto payments are enabled
 */
function requireCryptoEnabled(req: Request, res: Response, next: Function) {
  if (!isCryptoPaymentsEnabled()) {
    res.status(503).json({
      error: 'Crypto payments not enabled',
      message: 'Cryptocurrency payment processing is currently disabled',
    });
    return;
  }
  next();
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Create crypto payment schema
 */
const createCryptoPaymentSchema = z.object({
  tier: z.enum(['basic', 'premium', 'exclusive', 'elite', 'enterprise']),
  community_id: z
    .string()
    .min(1, 'Community ID required')
    .max(128, 'Community ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Community ID must be alphanumeric'),
  pay_currency: z
    .string()
    .min(2, 'Currency code too short')
    .max(10, 'Currency code too long')
    .regex(/^[a-zA-Z0-9]+$/, 'Currency must be alphanumeric')
    .optional(),
});

/**
 * Price estimate schema
 */
const priceEstimateSchema = z.object({
  tier: z.enum(['basic', 'premium', 'exclusive', 'elite', 'enterprise']),
  pay_currency: z
    .string()
    .min(2, 'Currency code too short')
    .max(10, 'Currency code too long')
    .regex(/^[a-zA-Z0-9]+$/, 'Currency must be alphanumeric'),
});

/**
 * Payment ID path parameter schema
 */
const paymentIdSchema = z.object({
  paymentId: z
    .string()
    .min(1, 'Payment ID required')
    .max(64, 'Payment ID too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Payment ID must be alphanumeric'),
});

// =============================================================================
// Routes
// =============================================================================

/**
 * POST /crypto/payment
 * Create a crypto payment for subscription purchase
 */
cryptoBillingRouter.post(
  '/payment',
  requireCryptoEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const result = createCryptoPaymentSchema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { tier, community_id, pay_currency } = result.data;

    try {
      const provider = getCryptoProvider();

      // Get tier pricing from config
      const tierInfo = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS];
      if (!tierInfo) {
        throw new ValidationError(`Invalid tier: ${tier}`);
      }

      // Build IPN callback URL
      const baseUrl = config.baseUrl || 'http://localhost:3000';
      const ipnCallbackUrl = `${baseUrl}/api/crypto/webhook`;

      // Create payment with NOWPayments
      const paymentResult = await provider.createPayment({
        communityId: community_id,
        tier: tier as SubscriptionTier,
        payCurrency: pay_currency as CryptoCurrency | undefined,
        ipnCallbackUrl,
      });

      // Store payment in database (priceCurrency is always USD, implied)
      createCryptoPayment({
        paymentId: paymentResult.paymentId,
        communityId: community_id,
        tier: tier as SubscriptionTier,
        priceAmount: paymentResult.priceAmount,
        payCurrency: paymentResult.payCurrency,
        payAmount: paymentResult.payAmount,
        payAddress: paymentResult.payAddress,
        expiresAt: paymentResult.expiresAt,
      });

      // Log audit event
      logBillingAuditEvent(
        'crypto_payment_created',
        {
          tier,
          communityId: community_id,
          paymentId: paymentResult.paymentId,
          payCurrency: paymentResult.payCurrency,
          payAmount: paymentResult.payAmount,
          priceAmount: paymentResult.priceAmount,
          provider: 'nowpayments',
        },
        community_id,
        req.adminName
      );

      res.json({
        payment_id: paymentResult.paymentId,
        pay_address: paymentResult.payAddress,
        pay_amount: paymentResult.payAmount,
        pay_currency: paymentResult.payCurrency,
        price_amount: paymentResult.priceAmount,
        price_currency: paymentResult.priceCurrency,
        expires_at: paymentResult.expiresAt.toISOString(),
        status: paymentResult.status,
      });
    } catch (error) {
      logger.error(
        { error, tier, communityId: community_id },
        'Failed to create crypto payment'
      );
      throw error;
    }
  }
);

/**
 * GET /crypto/payment/:paymentId
 * Get crypto payment status
 */
cryptoBillingRouter.get(
  '/payment/:paymentId',
  requireCryptoEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const pathResult = paymentIdSchema.safeParse(req.params);

    if (!pathResult.success) {
      const errors = pathResult.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { paymentId } = pathResult.data;

    try {
      // First check local database
      const localPayment = getCryptoPaymentByPaymentId(paymentId);

      if (!localPayment) {
        throw new NotFoundError(`Payment not found: ${paymentId}`);
      }

      // Get live status from NOWPayments
      const provider = getCryptoProvider();
      const liveStatus = await provider.getPaymentStatus(paymentId);

      // Use live status if available, otherwise fall back to local status
      const currentStatus = liveStatus?.status ?? localPayment.status;

      res.json({
        payment_id: localPayment.paymentId,
        community_id: localPayment.communityId,
        tier: localPayment.tier,
        status: currentStatus,
        pay_address: localPayment.payAddress,
        pay_amount: localPayment.payAmount,
        pay_currency: localPayment.payCurrency,
        actually_paid: localPayment.actuallyPaid,
        price_amount: localPayment.priceAmount,
        price_currency: localPayment.priceCurrency,
        created_at: localPayment.createdAt?.toISOString(),
        finished_at: localPayment.finishedAt?.toISOString(),
        expires_at: localPayment.expiresAt?.toISOString(),
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error({ error, paymentId }, 'Failed to get crypto payment status');
      throw error;
    }
  }
);

/**
 * GET /crypto/currencies
 * Get supported cryptocurrencies for payments
 */
cryptoBillingRouter.get(
  '/currencies',
  requireCryptoEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const provider = getCryptoProvider();
      const currencies = await provider.getSupportedCurrencies();

      res.json({
        currencies,
        count: currencies.length,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get supported currencies');
      throw error;
    }
  }
);

/**
 * GET /crypto/estimate
 * Get price estimate in cryptocurrency
 */
cryptoBillingRouter.get(
  '/estimate',
  requireCryptoEnabled,
  requireApiKey,
  async (req: AuthenticatedRequest, res: Response) => {
    const result = priceEstimateSchema.safeParse(req.query);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      throw new ValidationError(errors);
    }

    const { tier, pay_currency } = result.data;

    try {
      // Get tier pricing
      const tierInfo = SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS];
      if (!tierInfo) {
        throw new ValidationError(`Invalid tier: ${tier}`);
      }

      const provider = getCryptoProvider();
      const estimate = await provider.estimatePrice({
        amount: tierInfo.price,
        currency: pay_currency as CryptoCurrency,
      });

      res.json({
        tier,
        tier_name: tierInfo.name,
        price_amount: tierInfo.price,
        price_currency: 'usd',
        estimated_amount: estimate.cryptoAmount,
        pay_currency: pay_currency,
      });
    } catch (error) {
      logger.error({ error, tier, payCurrency: pay_currency }, 'Failed to estimate price');
      throw error;
    }
  }
);

/**
 * POST /crypto/webhook
 * Handle NOWPayments webhooks
 *
 * SECURITY REQUIREMENTS:
 * 1. Raw body middleware MUST be configured in server.ts for this route
 * 2. Signature verification uses HMAC-SHA512 via ICryptoPaymentProvider
 * 3. Content-Type must be application/json
 * 4. Rate limited to 1000 req/min per IP
 *
 * Configure Express with: express.raw({ type: 'application/json' }) for /crypto/webhook
 */
cryptoBillingRouter.post('/webhook', webhookRateLimiter, async (req: Request, res: Response) => {
  // Webhook doesn't require crypto to be fully enabled
  // (we want to process events even if feature flags are off)

  // Security: Validate Content-Type header
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    res.status(400).json({ error: 'Invalid Content-Type - must be application/json' });
    return;
  }

  // NOWPayments uses x-nowpayments-sig header for signature
  const signature = req.headers['x-nowpayments-sig'];

  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ error: 'Missing x-nowpayments-sig header' });
    return;
  }

  try {
    // Ensure crypto provider is initialized for webhook processing
    getCryptoProvider();

    // Get raw body for signature verification
    const rawBody = (req as RawBodyRequest).rawBody;

    if (!rawBody) {
      logger.error('Crypto webhook received without raw body - check middleware configuration');
      res.status(500).json({
        error: 'Internal server error',
        message: 'Server misconfiguration - raw body not available',
      });
      return;
    }

    // Verify signature and parse event
    const event = cryptoWebhookService.verifySignature(rawBody, signature);

    // Process the event through CryptoWebhookService (handles LVVER pattern)
    const result = await cryptoWebhookService.processEvent(event);

    // Return appropriate response
    res.json({
      received: true,
      status: result.status,
      payment_id: result.paymentId,
      payment_status: result.paymentStatus,
      message: result.message,
    });
  } catch (error) {
    logger.warn({ error }, 'Crypto webhook processing failed at handler level');
    res.status(400).json({
      error: 'Webhook processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
