/**
 * Webhook Routes Tests — NOWPayments IPN durable-capture failure path
 *
 * Regression for the silent-drop money bug (Eileen #326):
 * the webhook_events INSERT is the FIRST durable capture of an IPN event.
 * If that INSERT fails transiently, we must NOT ack with 200 (NOWPayments
 * would never retry → a `finished` payment strands credits). The handler
 * must return a retriable 503 so the provider re-delivers the event.
 *
 * @see webhooks.routes.ts Step 3 (webhook_events INSERT catch)
 */

import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import express from 'express';
import request from 'supertest';

// Mock the credit-ledger handler so its DB-bound deps never load — this test
// only exercises the webhook_events INSERT-failure path (which returns before
// the handler is ever called).
vi.mock('../services/nowpayments-handler.js', () => ({
  processPaymentForLedger: vi.fn(),
  verifyPaymentExists: vi.fn(),
}));

import { createWebhookRouter } from './webhooks.routes.js';

const IPN_SECRET = 'test-ipn-secret';

/** Mirror of the route's canonical key-sort used for HMAC computation. */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function signedBody(payload: Record<string, unknown>): { raw: string; sig: string } {
  const raw = JSON.stringify(sortKeys(payload));
  const sig = createHmac('sha512', IPN_SECRET).update(raw).digest('hex');
  return { raw, sig };
}

describe('POST /webhooks/nowpayments — webhook_events INSERT failure', () => {
  it('returns retriable 503 (NOT 200) so NOWPayments re-delivers the event', async () => {
    // pool.query rejects → the webhook_events INSERT (the first durable capture) fails.
    const pool = { query: vi.fn().mockRejectedValue(new Error('db unavailable')) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const app = express();
    app.use(express.text({ type: 'application/json' }));
    app.use(
      '/webhooks',
      createWebhookRouter({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: pool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        redis: {} as any,
        ipnSecret: IPN_SECRET,
        logger,
        featureBillingEnabled: true,
      }),
    );

    const payload = {
      payment_id: 987654321,
      payment_status: 'finished',
      order_id: 'order-1',
    };
    const { raw, sig } = signedBody(payload);

    const res = await request(app)
      .post('/webhooks/nowpayments')
      .set('x-nowpayments-sig', sig)
      .set('content-type', 'application/json')
      .send(raw);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', reason: 'internal' });
    // Only the webhook_events INSERT was attempted — we bailed on its failure.
    expect(pool.query).toHaveBeenCalledTimes(1);
    // The INSERT must match the LIVE schema — the prior version named a phantom
    // `event_type` column that does not exist, so real IPNs would have failed on it
    // (then this PR's 503 would retry-loop forever). The mock can't hit the DB, so we
    // assert the SQL the handler issues matches the real column set.
    const insertSql = (pool.query as any).mock.calls[0][0] as string;
    expect(insertSql).not.toMatch(/event_type/);
    expect(insertSql).toMatch(/\(provider, event_id, payload, processed_at\)/);
  });

  it('rejects duplicated signature headers before durable capture', async () => {
    const pool = { query: vi.fn() };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const app = express();
    app.use(express.text({ type: 'application/json' }));
    app.use(
      '/webhooks',
      createWebhookRouter({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pool: pool as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        redis: {} as any,
        ipnSecret: IPN_SECRET,
        logger,
        featureBillingEnabled: true,
      }),
    );

    const payload = {
      payment_id: 987654321,
      payment_status: 'finished',
      order_id: 'order-1',
    };
    const { raw, sig } = signedBody(payload);

    const res = await request(app)
      .post('/webhooks/nowpayments')
      .set('x-nowpayments-sig', [sig, sig])
      .set('content-type', 'application/json')
      .send(raw);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ status: 'rejected', reason: 'missing_signature' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
