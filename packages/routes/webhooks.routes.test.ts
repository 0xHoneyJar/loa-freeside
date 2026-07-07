/**
 * Webhook Routes Tests — NOWPayments IPN hardening
 *
 * Regression coverage for the webhook audit cluster:
 *   - #324 dedupe keyed on (payment_id, status): status progression cannot
 *     block credit minting; duplicate finished stays idempotent; unknown
 *     payments are never terminally deduped.
 *   - #325 HMAC over exact raw bytes, fail closed when raw body missing,
 *     duplicated signature headers rejected.
 *   - #326 webhook_events INSERT failure returns retriable 503 (not 200),
 *     and a provider retry after the transient failure mints credits.
 *   - #327 webhook freshness window enforced: stale events quarantined,
 *     missing timestamps accepted (documented), invalid timestamps rejected.
 *
 * @see webhooks.routes.ts
 * @see docs/runbook/nowpayments-webhook-reliability.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import express from 'express';
import request from 'supertest';

// Mock the credit-ledger handler so its DB-bound deps never load.
vi.mock('../services/nowpayments-handler.js', () => ({
  processPaymentForLedger: vi.fn(),
  verifyPaymentExists: vi.fn(),
}));

import { createWebhookRouter, captureRawBody } from './webhooks.routes.js';
import { processPaymentForLedger, verifyPaymentExists } from '../services/nowpayments-handler.js';

const IPN_SECRET = 'test-ipn-secret';

const PAYMENT_ROW = { community_id: 'community-1', tier: 'pro', price_amount: 100 };

/** Mirror of the route's canonical key-sort (NOWPayments signing rule). */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function hmac(raw: string): string {
  return createHmac('sha512', IPN_SECRET).update(raw).digest('hex');
}

/** Sign the exact raw string (byte-exact verification path). */
function signedBody(payload: Record<string, unknown>): { raw: string; sig: string } {
  const raw = JSON.stringify(sortKeys(payload));
  return { raw, sig: hmac(raw) };
}

/**
 * In-memory fake pg pool: enforces the webhook_events UNIQUE(provider,
 * event_id) constraint and tracks crypto_payments status transitions.
 */
function makeFakePool(opts: { status?: string; failInsertTimes?: number; selectStatus?: () => string } = {}) {
  const webhookEvents = new Set<string>();
  const state = { status: opts.status ?? 'waiting', failInsertTimes: opts.failInsertTimes ?? 0 };

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (/INSERT INTO webhook_events/.test(sql)) {
      if (state.failInsertTimes > 0) {
        state.failInsertTimes -= 1;
        throw new Error('db unavailable');
      }
      const key = `nowpayments:${params?.[0]}`;
      if (webhookEvents.has(key)) return { rows: [] };
      webhookEvents.add(key);
      return { rows: [{ id: `evt-${webhookEvents.size}` }] };
    }
    if (/SELECT status FROM crypto_payments/.test(sql)) {
      return { rows: [{ status: opts.selectStatus ? opts.selectStatus() : state.status }] };
    }
    if (/UPDATE crypto_payments/.test(sql)) {
      // Emulate the atomic monotonicity guard in the route's UPDATE:
      // terminal rows never change; non-terminal-failure transitions must
      // strictly increase the status ordinal.
      const ORD: Record<string, number> = {
        waiting: 0, confirming: 1, partially_paid: 1, confirmed: 2, sending: 3,
      };
      const incoming = params?.[1] as string;
      const isTerminalFailure = params?.[4] as boolean;
      const incomingOrdinal = params?.[5] as number;
      const terminal = ['finished', 'failed', 'refunded', 'expired'];
      if (terminal.includes(state.status)) return { rows: [], rowCount: 0 };
      if (!(isTerminalFailure || (ORD[state.status] ?? -1) < incomingOrdinal)) {
        return { rows: [], rowCount: 0 };
      }
      state.status = incoming;
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO billing_audit_log/.test(sql)) {
      return { rows: [] };
    }
    throw new Error(`unexpected sql in fake pool: ${sql}`);
  });

  return { pool: { query }, webhookEvents, state };
}

type AppOpts = {
  pool: { query: ReturnType<typeof vi.fn> };
  rawBodyMode?: 'verify-hook' | 'raw-buffer' | 'parsed-json-only';
  webhookMaxAgeMs?: number;
};

function makeApp(opts: AppOpts) {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const app = express();

  const mode = opts.rawBodyMode ?? 'verify-hook';
  if (mode === 'verify-hook') {
    app.use(express.json({ verify: captureRawBody }));
  } else if (mode === 'raw-buffer') {
    app.use(express.raw({ type: 'application/json' }));
  } else {
    // Misconfigured server: JSON parsing without raw-body capture.
    app.use(express.json());
  }

  app.use(
    '/webhooks',
    createWebhookRouter({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pool: opts.pool as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      redis: {} as any,
      ipnSecret: IPN_SECRET,
      logger,
      featureBillingEnabled: true,
      webhookMaxAgeMs: opts.webhookMaxAgeMs,
    }),
  );

  return { app, logger };
}

function post(app: express.Express, raw: string, sig: string | string[]) {
  return request(app)
    .post('/webhooks/nowpayments')
    .set('content-type', 'application/json')
    .set('x-nowpayments-sig', sig as string)
    .send(raw);
}

beforeEach(() => {
  vi.mocked(verifyPaymentExists).mockReset();
  vi.mocked(processPaymentForLedger).mockReset();
  vi.mocked(verifyPaymentExists).mockResolvedValue(PAYMENT_ROW);
  vi.mocked(processPaymentForLedger).mockResolvedValue({
    lotId: 'lot-1',
    amountUsdMicro: 100_000_000n,
    minted: true,
    redisAdjusted: true,
  });
});

// ---------------------------------------------------------------------------
// #325 — raw-body HMAC verification, fail closed
// ---------------------------------------------------------------------------

describe('POST /webhooks/nowpayments — raw body HMAC (#325)', () => {
  const payload = {
    payment_id: 111,
    payment_status: 'confirming',
    order_id: 'order-1',
    updated_at: new Date().toISOString(),
  };

  it('returns 500 (fail closed) when raw-body middleware is not installed', async () => {
    const { pool } = makeFakePool();
    const { app, logger } = makeApp({ pool, rawBodyMode: 'parsed-json-only' });
    const { raw, sig } = signedBody(payload);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ status: 'error', reason: 'raw_body_unavailable' });
    // Never touched the DB, never re-serialized req.body for HMAC.
    expect(pool.query).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('verifies signature over the exact raw string body (verify-hook middleware)', async () => {
    const { pool } = makeFakePool();
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(payload);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
  });

  it('verifies signature when the body arrives as a Buffer (express.raw)', async () => {
    const { pool } = makeFakePool();
    const { app } = makeApp({ pool, rawBodyMode: 'raw-buffer' });
    const { raw, sig } = signedBody(payload);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
  });

  it('accepts byte-different JSON only when the signature matches the provider sorted-key rule', async () => {
    // Raw body has UNSORTED keys; signature is over the canonical sorted form
    // (NOWPayments documented signing rule). Byte-exact check fails, canonical
    // check derived from the same raw bytes passes.
    const unsortedRaw = JSON.stringify(payload); // insertion order, not sorted
    const canonicalSig = hmac(JSON.stringify(sortKeys(payload)));
    expect(unsortedRaw).not.toBe(JSON.stringify(sortKeys(payload)));

    const { pool } = makeFakePool();
    const { app } = makeApp({ pool });

    const res = await post(app, unsortedRaw, canonicalSig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
  });

  it('rejects a body whose signature matches neither raw bytes nor the sorted-key rule', async () => {
    const { sig } = signedBody(payload);
    const tampered = JSON.stringify(sortKeys({ ...payload, payment_status: 'finished' }));

    const { pool } = makeFakePool();
    const { app } = makeApp({ pool });

    const res = await post(app, tampered, sig);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ status: 'rejected', reason: 'invalid_signature' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects duplicated x-nowpayments-sig headers (type confusion)', async () => {
    const { pool } = makeFakePool();
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(payload);

    // Node's HTTP server joins duplicated custom headers into a single
    // comma-separated string; the route's array-rejection branch is
    // defense-in-depth for runtimes that surface arrays. Either way the
    // request must be rejected before any DB work.
    const res = await post(app, raw, [sig, sig]);

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('rejected');
    expect(['invalid_signature', 'invalid_signature_header']).toContain(res.body.reason);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// #327 — webhook freshness enforcement
// ---------------------------------------------------------------------------

describe('POST /webhooks/nowpayments — timestamp freshness (#327)', () => {
  it('quarantines a stale (old but validly signed) event without processing it', async () => {
    const stale = {
      payment_id: 222,
      payment_status: 'finished',
      order_id: 'order-2',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old
    };
    const { pool, webhookEvents } = makeFakePool();
    const { app, logger } = makeApp({ pool }); // default 15 min window
    const { raw, sig } = signedBody(stale);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'quarantined', reason: 'stale_timestamp' });
    // Durable quarantine record in a distinct dedupe slot.
    expect(webhookEvents.has('nowpayments:222:finished:stale')).toBe(true);
    // No status update, no mint.
    expect(processPaymentForLedger).not.toHaveBeenCalled();
    const updateCalls = pool.query.mock.calls.filter(([sql]) => /UPDATE crypto_payments/.test(sql as string));
    expect(updateCalls).toHaveLength(0);
    // Audit log carries provider timestamp, receipt timestamp, and verdict.
    const staleLog = logger.warn.mock.calls.find(([, msg]) => /quarantined/.test(msg as string));
    expect(staleLog?.[0]).toMatchObject({ freshness: 'stale', providerTimestamp: stale.updated_at });
    expect(staleLog?.[0]).toHaveProperty('receivedAt');
  });

  it('returns retriable 503 when the stale quarantine record cannot be written', async () => {
    const stale = {
      payment_id: 224,
      payment_status: 'finished',
      order_id: 'order-2b',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    const { pool, webhookEvents } = makeFakePool({ failInsertTimes: 1 });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(stale);

    const res1 = await post(app, raw, sig);
    expect(res1.status).toBe(503);
    expect(res1.body).toEqual({ status: 'error', reason: 'quarantine_record_failed' });
    expect(webhookEvents.has('nowpayments:224:finished:stale')).toBe(false);

    // Provider retry after the transient failure records the quarantine.
    const res2 = await post(app, raw, sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'quarantined', reason: 'stale_timestamp' });
    expect(webhookEvents.has('nowpayments:224:finished:stale')).toBe(true);
    expect(processPaymentForLedger).not.toHaveBeenCalled();
  });

  it('processes an event with a missing timestamp (documented policy) and logs the verdict', async () => {
    const noTs = { payment_id: 223, payment_status: 'confirming', order_id: 'order-3' };
    const { pool } = makeFakePool();
    const { app, logger } = makeApp({ pool });
    const { raw, sig } = signedBody(noTs);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
    const verdictLog = logger.info.mock.calls.find(([obj]) => (obj as Record<string, unknown>).freshness === 'missing_timestamp');
    expect(verdictLog).toBeDefined();
  });

  it('processes a fresh valid webhook and logs a fresh verdict', async () => {
    const fresh = {
      payment_id: 224,
      payment_status: 'confirming',
      order_id: 'order-4',
      updated_at: new Date().toISOString(),
    };
    const { pool } = makeFakePool();
    const { app, logger } = makeApp({ pool });
    const { raw, sig } = signedBody(fresh);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
    const verdictLog = logger.info.mock.calls.find(([obj]) => (obj as Record<string, unknown>).freshness === 'fresh');
    expect(verdictLog).toBeDefined();
  });

  it('rejects a present-but-invalid updated_at explicitly', async () => {
    const bad = {
      payment_id: 225,
      payment_status: 'waiting',
      order_id: 'order-5',
      updated_at: 'not-a-timestamp',
    };
    const { pool } = makeFakePool();
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(bad);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ignored', reason: 'invalid_timestamp' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('respects a configurable freshness window', async () => {
    const payload = {
      payment_id: 226,
      payment_status: 'waiting',
      order_id: 'order-6',
      updated_at: new Date(Date.now() - 2_000).toISOString(), // 2s old
    };
    const { pool } = makeFakePool();
    const { app } = makeApp({ pool, webhookMaxAgeMs: 1_000 }); // 1s window
    const { raw, sig } = signedBody(payload);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'quarantined', reason: 'stale_timestamp' });
  });
});

// ---------------------------------------------------------------------------
// #324 — dedupe keyed on (payment_id, status)
// ---------------------------------------------------------------------------

describe('POST /webhooks/nowpayments — status-progression dedupe (#324)', () => {
  function event(status: string, paymentId = 333) {
    return {
      payment_id: paymentId,
      payment_status: status,
      order_id: 'order-7',
      updated_at: new Date().toISOString(),
    };
  }

  it('waiting then finished mints exactly one credit lot (progression not deduped)', async () => {
    const { pool, state } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });

    const w = signedBody(event('waiting'));
    // waiting → skipped (backward/equal transition), but NOT duplicate
    const res1 = await post(app, w.raw, w.sig);
    expect(res1.status).toBe(200);
    expect(res1.body).toEqual({ status: 'skipped', reason: 'backward_transition' });

    const f = signedBody(event('finished'));
    const res2 = await post(app, f.raw, f.sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'processed' });
    expect(state.status).toBe('finished');
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });

  it('duplicate finished webhooks stay idempotent (single mint, then duplicate)', async () => {
    const { pool } = makeFakePool({ status: 'confirmed' });
    const { app } = makeApp({ pool });

    const f = signedBody(event('finished', 334));
    const res1 = await post(app, f.raw, f.sig);
    expect(res1.body).toEqual({ status: 'processed' });

    const res2 = await post(app, f.raw, f.sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'duplicate' });
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });

  it('unknown-payment webhook gets a retriable 404 and does not block the later retry', async () => {
    const { pool, webhookEvents } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });
    const f = signedBody(event('finished', 335));

    // Payment row does not exist yet (webhook raced payment creation).
    vi.mocked(verifyPaymentExists).mockResolvedValueOnce(null);
    const res1 = await post(app, f.raw, f.sig);
    expect(res1.status).toBe(404);
    expect(res1.body).toEqual({ status: 'error', reason: 'unknown_payment' });
    // Nothing recorded — the event is NOT terminally deduped.
    expect(webhookEvents.size).toBe(0);
    expect(processPaymentForLedger).not.toHaveBeenCalled();

    // Provider retries after the crypto_payments row exists → mints.
    const res2 = await post(app, f.raw, f.sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'processed' });
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// #326 — durable-capture failure returns retriable 503; retry mints
// ---------------------------------------------------------------------------

describe('POST /webhooks/nowpayments — webhook_events INSERT failure (#326)', () => {
  const payload = {
    payment_id: 987654321,
    payment_status: 'finished',
    order_id: 'order-8',
    updated_at: new Date().toISOString(),
  };

  it('returns retriable 503 (NOT 200) so NOWPayments re-delivers the event', async () => {
    const { pool } = makeFakePool({ status: 'confirmed', failInsertTimes: 1 });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(payload);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', reason: 'internal' });
    expect(processPaymentForLedger).not.toHaveBeenCalled();
    // The INSERT must match the LIVE schema — no phantom `event_type` column
    // (regression from PR #373).
    const insertCall = pool.query.mock.calls.find(([sql]) => /INSERT INTO webhook_events/.test(sql as string));
    expect(insertCall?.[0]).not.toMatch(/event_type/);
    expect(insertCall?.[0]).toMatch(/\(provider, event_id, payload, processed_at\)/);
  });

  it('provider retry after the transient failure processes the event and mints credits', async () => {
    const { pool } = makeFakePool({ status: 'confirmed', failInsertTimes: 1 });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(payload);

    const res1 = await post(app, raw, sig);
    expect(res1.status).toBe(503);

    const res2 = await post(app, raw, sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'processed' });
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Per-IP rate limiting (CodeQL: unauthenticated route performs DB access)
// ---------------------------------------------------------------------------

describe('POST /webhooks/nowpayments — concurrent status transitions', () => {
  it('a slower lower-status delivery cannot overwrite a faster finished (atomic UPDATE guard)', async () => {
    // Simulate the race: both deliveries' advisory SELECT sees the stale
    // pre-update 'waiting' row, so neither is rejected by the read-then-
    // check. The atomic UPDATE guard must still prevent the regression.
    const { pool, state } = makeFakePool({ status: 'waiting', selectStatus: () => 'waiting' });
    const { app } = makeApp({ pool });

    const finished = signedBody({
      payment_id: 777, payment_status: 'finished', order_id: 'order-race',
      price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
    });
    const confirmed = signedBody({
      payment_id: 777, payment_status: 'confirmed', order_id: 'order-race',
      price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
    });

    const res1 = await post(app, finished.raw, finished.sig);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('processed');
    expect(state.status).toBe('finished');

    const res2 = await post(app, confirmed.raw, confirmed.sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'skipped', reason: 'concurrent_transition' });
    // The finished row was NOT regressed to confirmed
    expect(state.status).toBe('finished');
    // Credits minted exactly once (by the finished delivery)
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });
});

describe('POST /webhooks/nowpayments — per-IP rate limiting', () => {
  it('returns 429 once the per-IP window budget is exhausted, before any processing', async () => {
    const { WEBHOOK_RATE_LIMIT_MAX } = await import('./webhooks.routes.js');
    const { pool } = makeFakePool({ status: 'finished' });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody({
      payment_id: 900001,
      payment_status: 'finished',
      order_id: 'order-rl',
      price_amount: 100,
      price_currency: 'usd',
      updated_at: Date.now(),
    });

    let limited = 0;
    for (let i = 0; i < WEBHOOK_RATE_LIMIT_MAX + 5; i++) {
      const res = await post(app, raw, sig);
      if (res.status === 429) {
        limited += 1;
        expect(res.body).toEqual({ status: 'rate_limited' });
      }
    }
    expect(limited).toBe(5);

    // Processing side effects happened at most once (dedupe) and the
    // rate-limited requests never reached the handler.
    expect(processPaymentForLedger.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
