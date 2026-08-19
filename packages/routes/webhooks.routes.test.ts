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
 *     missing/invalid timestamps rejected (freshness mandatory).
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

// withCommunityScope wraps each tenant-scoped statement in BEGIN/SET LOCAL/
// COMMIT against a real pg client. Replace it with a pass-through that records
// the community it was given, so the tests can assert WHICH connection ran a
// statement and under WHICH scope.
const { mockWithCommunityScope, scopedCommunities } = vi.hoisted(() => ({
  mockWithCommunityScope: vi.fn(),
  scopedCommunities: [] as string[],
}));
vi.mock('../services/community-scope.js', () => ({
  withCommunityScope: mockWithCommunityScope,
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
      // Mirror the deployed crypto_payments_status_monotonicity trigger ranks.
      const ORD: Record<string, number> = {
        waiting: 0, confirming: 1, confirmed: 2, sending: 3, partially_paid: 4,
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
  /** Privileged connection for the two operations that cannot be scoped. */
  systemPool?: { query: ReturnType<typeof vi.fn> };
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
      systemPool: opts.systemPool as any,
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

/** Statements the route ran through withCommunityScope (tenant connection). */
const scopedQuery = vi.fn();

beforeEach(() => {
  scopedCommunities.length = 0;
  scopedQuery.mockReset();
  mockWithCommunityScope.mockReset();
  // Pass-through scope: record the community, then delegate to the pool the
  // caller handed us so the fake keeps one shared view of the payment row.
  mockWithCommunityScope.mockImplementation(
    async (
      communityId: string,
      poolArg: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
      fn: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => unknown,
    ) => {
      scopedCommunities.push(communityId);
      scopedQuery.mockImplementation((sql: string, params?: unknown[]) => poolArg.query(sql, params));
      return fn({ query: scopedQuery });
    },
  );
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

/** SQL the route ran inside a community scope. */
function scopedSql(): string[] {
  return scopedQuery.mock.calls.map((c) => String(c[0]));
}

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
  it('quarantines a stale NON-TERMINAL event without processing it', async () => {
    const stale = {
      payment_id: 222,
      payment_status: 'confirming',
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
    expect(webhookEvents.has('nowpayments:222:confirming:stale')).toBe(true);
    // No status update, no mint.
    expect(processPaymentForLedger).not.toHaveBeenCalled();
    const updateCalls = pool.query.mock.calls.filter(([sql]) => /UPDATE crypto_payments/.test(sql as string));
    expect(updateCalls).toHaveLength(0);
    // Audit log carries provider timestamp, receipt timestamp, and verdict.
    const staleLog = logger.warn.mock.calls.find(([, msg]) => /quarantined/.test(msg as string));
    expect(staleLog?.[0]).toMatchObject({ freshness: 'stale', providerTimestamp: stale.updated_at });
    expect(staleLog?.[0]).toHaveProperty('receivedAt');
  });

  it('returns retriable 404 (not quarantine) for a stale event whose payment does not exist yet', async () => {
    // The reconciliation sweep polls crypto_payments and never reads
    // webhook_events, so quarantining+200 a stale event for a not-yet-created
    // payment would strand it. Must return retriable 404 like the fresh path.
    vi.mocked(verifyPaymentExists).mockResolvedValueOnce(null);
    const stale = {
      payment_id: 226,
      payment_status: 'finished',
      order_id: 'order-2c',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1h old
    };
    const { pool, webhookEvents } = makeFakePool();
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(stale);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ status: 'error', reason: 'unknown_payment' });
    // NOT recorded in webhook_events — a retry after the row appears must not be deduped.
    expect(webhookEvents.has('nowpayments:226:finished:stale')).toBe(false);
    expect(processPaymentForLedger).not.toHaveBeenCalled();
  });

  it('returns retriable 503 when the stale quarantine record cannot be written', async () => {
    const stale = {
      payment_id: 224,
      payment_status: 'confirming',
      order_id: 'order-2b',
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    const { pool, webhookEvents } = makeFakePool({ failInsertTimes: 1 });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(stale);

    const res1 = await post(app, raw, sig);
    expect(res1.status).toBe(503);
    expect(res1.body).toEqual({ status: 'error', reason: 'quarantine_record_failed' });
    expect(webhookEvents.has('nowpayments:224:confirming:stale')).toBe(false);

    // Provider retry after the transient failure records the quarantine.
    const res2 = await post(app, raw, sig);
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({ status: 'quarantined', reason: 'stale_timestamp' });
    expect(webhookEvents.has('nowpayments:224:confirming:stale')).toBe(true);
    expect(processPaymentForLedger).not.toHaveBeenCalled();
  });

  it('rejects an event with a missing timestamp (freshness mandatory) before any DB access', async () => {
    // updated_at is mandatory (CodeQL user-controlled-bypass fix): a missing
    // timestamp can no longer skip freshness enforcement. Rejected with
    // 200 ignored/invalid_timestamp before payment lookup/DB write/mint; the
    // reconciliation sweep recovers the payment from its non-terminal row.
    const noTs = { payment_id: 223, payment_status: 'confirming', order_id: 'order-3' };
    const { pool } = makeFakePool();
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(noTs);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ignored', reason: 'invalid_timestamp' });
    expect(verifyPaymentExists).not.toHaveBeenCalled();
    expect(processPaymentForLedger).not.toHaveBeenCalled();
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
    // Not processed — but durably recorded under its own dedupe slot, so a
    // signature-valid event is never dropped without a trace. The marker must
    // NOT collide with the real `<id>:<status>` slot that gates processing.
    const sql = pool.query.mock.calls.map(([s]) => String(s));
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/INSERT INTO webhook_events/);
    expect(pool.query.mock.calls[0][1]?.[0]).toBe('225:waiting:no_timestamp');
    // No payment lookup, no status read, no mint.
    expect(verifyPaymentExists).not.toHaveBeenCalled();
    expect(processPaymentForLedger).not.toHaveBeenCalled();
    expect(sql.some((s) => /crypto_payments/.test(s))).toBe(false);
  });

  it('returns a retriable 503 when the timestamp-less marker cannot be recorded', async () => {
    // Same rule as every other durable capture: a 200 for an event we failed
    // to record would drop it silently.
    const bad = {
      payment_id: 226, payment_status: 'finished', order_id: 'order-5b',
      updated_at: undefined,
    };
    const { pool } = makeFakePool({ failInsertTimes: 1 });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(bad);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', reason: 'capture_failed' });
    expect(processPaymentForLedger).not.toHaveBeenCalled();
  });

  it('never lets the timestamp-less marker consume the real dedupe slot', async () => {
    // The marker uses a `:no_timestamp` suffix. If it collided with
    // `<id>:finished`, a malformed delivery would permanently block the real
    // finished event from ever minting.
    const { pool } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });

    const noTs = signedBody({
      payment_id: 227, payment_status: 'finished', order_id: 'order-5c',
      price_amount: 100, price_currency: 'usd',
    });
    expect((await post(app, noTs.raw, noTs.sig)).body).toEqual({
      status: 'ignored', reason: 'invalid_timestamp',
    });

    // The real event, same payment and status, still mints.
    const good = signedBody({
      payment_id: 227, payment_status: 'finished', order_id: 'order-5c',
      price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
    });
    const res = await post(app, good.raw, good.sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Stale TERMINAL events must not be deferred to machinery that never runs.
  //
  // Quarantine acks with 200 and hands recovery to the reconciliation sweep,
  // which has no production caller. For a credit-bearing event that is a silent
  // loss, so safety must not depend on it.
  // ---------------------------------------------------------------------------

  it('PROCESSES a stale finished event instead of quarantining it', async () => {
    const stale = {
      payment_id: 250, payment_status: 'finished', order_id: 'order-stale-fin',
      price_amount: 100, price_currency: 'usd',
      updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6h old
    };
    const { pool, webhookEvents, state } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(stale);

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed' });
    expect(state.status).toBe('finished');
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
    // Recorded under the REAL dedupe slot, not the quarantine slot.
    expect(webhookEvents.has('nowpayments:250:finished')).toBe(true);
    expect(webhookEvents.has('nowpayments:250:finished:stale')).toBe(false);
  });

  it.each(['failed', 'refunded', 'expired'])(
    'processes a stale terminal %s event rather than stranding the row as pending',
    async (status) => {
      const { pool, state } = makeFakePool({ status: 'waiting' });
      const { app } = makeApp({ pool });
      const { raw, sig } = signedBody({
        payment_id: 251, payment_status: status, order_id: 'order-stale-term',
        updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      });

      const res = await post(app, raw, sig);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'processed' });
      expect(state.status).toBe(status);
    },
  );

  it('still absorbs a REPLAYED stale finished event — freshness is not what stops replay', async () => {
    // The layers that actually protect a terminal event: the
    // (payment_id, status) dedupe slot, then credit_lots unique on payment_id.
    const stale = {
      payment_id: 252, payment_status: 'finished', order_id: 'order-replay',
      price_amount: 100, price_currency: 'usd',
      updated_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30d old
    };
    const { pool } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(stale);

    const first = await post(app, raw, sig);
    expect(first.body).toEqual({ status: 'processed' });

    // Replay the exact same signed bytes, any number of times.
    for (let i = 0; i < 5; i++) {
      const replay = await post(app, raw, sig);
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual({ status: 'duplicate' });
    }

    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
  });

  it('keeps quarantining stale NON-terminal events — no money rides on them', async () => {
    const { pool, webhookEvents } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody({
      payment_id: 253, payment_status: 'partially_paid', order_id: 'order-stale-nt',
      updated_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    });

    const res = await post(app, raw, sig);

    expect(res.body).toEqual({ status: 'quarantined', reason: 'stale_timestamp' });
    expect(webhookEvents.has('nowpayments:253:partially_paid:stale')).toBe(true);
    expect(processPaymentForLedger).not.toHaveBeenCalled();
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

  it('partially_paid then confirmed is skipped, not sent as a backward DB update', async () => {
    // The DB trigger ranks partially_paid (4) above confirmed (2); the in-app
    // guard must agree and skip rather than issue an UPDATE the trigger rejects.
    const { pool, state } = makeFakePool({ status: 'partially_paid' });
    const { app } = makeApp({ pool });

    const c = signedBody(event('confirmed'));
    const res = await post(app, c.raw, c.sig);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', reason: 'backward_transition' });
    expect(state.status).toBe('partially_paid'); // unchanged — no UPDATE applied
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

  // -------------------------------------------------------------------------
  // `finished` is the credit-bearing fact and must never lose it.
  //
  // The monotonicity trigger ranks finished(5) BELOW expired(6) and failed(7),
  // so once a failure transition commits the status can never be corrected —
  // and neither reconciliation arm revisits failed/expired rows. If the route
  // let a failure transition suppress the mint, the purchase would be lost
  // permanently.
  // -------------------------------------------------------------------------

  it('credits a finished delivery that LOSES the status race to a concurrent failure', async () => {
    let selects = 0;
    const holder: { state?: { status: string } } = {};
    const { pool, state } = makeFakePool({
      status: 'waiting',
      selectStatus: () => {
        selects += 1;
        if (selects === 1) {
          // A concurrent `failed` delivery commits between our advisory read
          // and our UPDATE — the classic lost-race window.
          holder.state!.status = 'failed';
          return 'waiting';
        }
        return holder.state!.status;
      },
    });
    holder.state = state;
    const { app } = makeApp({ pool });

    const finished = signedBody({
      payment_id: 801, payment_status: 'finished', order_id: 'order-lost-race',
      price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
    });

    const res = await post(app, finished.raw, finished.sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'processed', reason: 'credited_without_status_write' });
    // Status legitimately stays 'failed' (the trigger forbids moving it back)…
    expect(state.status).toBe('failed');
    // …but the credit was minted anyway.
    expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
    expect(processPaymentForLedger).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ paymentId: '801', communityId: 'community-1' }));
  });

  it.each(['failed', 'expired'])(
    'credits a late finished delivery arriving after the row already settled as %s',
    async (settled) => {
      // Sequential (not a race): the invoice expired / failed, the customer
      // paid late, and the provider sends a signed `finished`.
      const { pool, state } = makeFakePool({ status: settled });
      const { app } = makeApp({ pool });

      const finished = signedBody({
        payment_id: 802, payment_status: 'finished', order_id: 'order-late',
        price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
      });

      const res = await post(app, finished.raw, finished.sig);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'processed', reason: 'credited_without_status_write' });
      expect(state.status).toBe(settled);
      expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
    },
  );

  it('does NOT credit a finished delivery when the payment was refunded', async () => {
    // `refunded` is the one terminal state that must suppress the mint —
    // the money went back to the customer.
    const { pool } = makeFakePool({ status: 'refunded' });
    const { app } = makeApp({ pool });

    const finished = signedBody({
      payment_id: 803, payment_status: 'finished', order_id: 'order-refunded',
      price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
    });

    const res = await post(app, finished.raw, finished.sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', reason: 'terminal_state' });
    expect(processPaymentForLedger).not.toHaveBeenCalled();
  });

  it('does NOT credit a finished delivery that loses the race to a refund', async () => {
    let selects = 0;
    const holder: { state?: { status: string } } = {};
    const { pool, state } = makeFakePool({
      status: 'waiting',
      selectStatus: () => {
        selects += 1;
        if (selects === 1) {
          holder.state!.status = 'refunded';
          return 'waiting';
        }
        return holder.state!.status;
      },
    });
    holder.state = state;
    const { app } = makeApp({ pool });

    const finished = signedBody({
      payment_id: 804, payment_status: 'finished', order_id: 'order-refund-race',
      price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
    });

    const res = await post(app, finished.raw, finished.sig);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'skipped', reason: 'refunded' });
    expect(processPaymentForLedger).not.toHaveBeenCalled();
  });

  it('still mints exactly once when finished and failed are delivered in either order', async () => {
    // Both orderings must converge on exactly one credit lot. The mint itself
    // is idempotent on payment_id; the route must simply never skip it.
    for (const order of [['finished', 'failed'], ['failed', 'finished']]) {
      vi.mocked(processPaymentForLedger).mockClear();
      const { pool } = makeFakePool({ status: 'waiting' });
      const { app } = makeApp({ pool });

      for (const status of order) {
        const body = signedBody({
          payment_id: 805, payment_status: status, order_id: 'order-either',
          price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
        });
        const res = await post(app, body.raw, body.sig);
        expect(res.status).toBe(200);
      }

      expect(processPaymentForLedger).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation — which connection runs what
//
// crypto_payments carries forced RLS with tenant policies; webhook_events
// carries forced RLS with NO policy and is admin-only (migration 0010). The
// route must therefore split its work across exactly two authorities, and the
// privileged one must be as narrow as possible.
// ---------------------------------------------------------------------------

describe('POST /webhooks/nowpayments — tenant isolation', () => {
  const finishedPayload = () => ({
    payment_id: 901, payment_status: 'finished', order_id: 'order-rls',
    price_amount: 100, price_currency: 'usd', updated_at: new Date().toISOString(),
  });

  it('runs every community-known statement inside that community scope', async () => {
    const { pool } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(finishedPayload());

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    // The status read, the monotonic UPDATE and the audit write are all scoped…
    const scoped = scopedSql();
    expect(scoped.some((s) => /SELECT status FROM crypto_payments/.test(s))).toBe(true);
    expect(scoped.some((s) => /UPDATE crypto_payments/.test(s))).toBe(true);
    expect(scoped.some((s) => /INSERT INTO billing_audit_log/.test(s))).toBe(true);
    // …and always under the community the payment lookup resolved.
    expect(new Set(scopedCommunities)).toEqual(new Set([PAYMENT_ROW.community_id]));
  });

  it('confines the privileged connection to the lookup and the dedupe insert', async () => {
    // Two distinct connections: the tenant pool must never see a
    // webhook_events write, and the privileged pool must never see a
    // crypto_payments mutation.
    const tenant = makeFakePool({ status: 'waiting' });
    const system = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool: tenant.pool, systemPool: system.pool });
    const { raw, sig } = signedBody(finishedPayload());

    const res = await post(app, raw, sig);
    expect(res.status).toBe(200);

    const systemSql = system.pool.query.mock.calls.map((c) => String(c[0]));
    // The privileged connection does exactly one thing: dedupe.
    expect(systemSql).toHaveLength(1);
    expect(systemSql[0]).toMatch(/INSERT INTO webhook_events/);
    // It never touches payment state.
    expect(systemSql.some((s) => /crypto_payments|billing_audit_log/.test(s))).toBe(false);

    // The tenant connection never attempts the admin-only dedupe table.
    const tenantSql = tenant.pool.query.mock.calls.map((c) => String(c[0]));
    expect(tenantSql.some((s) => /webhook_events/.test(s))).toBe(false);
    expect(tenantSql.length).toBeGreaterThan(0);
  });

  it('routes the payment lookup through the privileged connection', async () => {
    // The lookup is what establishes tenant context, so it cannot be scoped.
    const tenant = makeFakePool();
    const system = makeFakePool();
    const { app } = makeApp({ pool: tenant.pool, systemPool: system.pool });
    const { raw, sig } = signedBody(finishedPayload());

    await post(app, raw, sig);

    expect(verifyPaymentExists).toHaveBeenCalledWith(system.pool, '901');
    expect(verifyPaymentExists).not.toHaveBeenCalledWith(tenant.pool, expect.anything());
  });

  it('quarantines a stale event on the privileged connection without a tenant scope', async () => {
    const tenant = makeFakePool();
    const system = makeFakePool();
    const { app } = makeApp({
      pool: tenant.pool, systemPool: system.pool, webhookMaxAgeMs: 1000,
    });
    const { raw, sig } = signedBody({
      ...finishedPayload(),
      payment_status: 'confirming', // only non-terminal events are quarantined
      updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const res = await post(app, raw, sig);

    expect(res.body).toEqual({ status: 'quarantined', reason: 'stale_timestamp' });
    expect(String(system.pool.query.mock.calls[0][0])).toMatch(/INSERT INTO webhook_events/);
    // Nothing tenant-scoped runs: no community work happens on a stale event.
    expect(scopedCommunities).toEqual([]);
    expect(tenant.pool.query).not.toHaveBeenCalled();
  });

  it('defaults systemPool to the tenant pool when not injected', async () => {
    // Correct only where that pool already holds cross-tenant authority —
    // documented on WebhookDeps.systemPool.
    const { pool } = makeFakePool({ status: 'waiting' });
    const { app } = makeApp({ pool });
    const { raw, sig } = signedBody(finishedPayload());

    const res = await post(app, raw, sig);

    expect(res.status).toBe(200);
    expect(pool.query.mock.calls.some(([s]) => /INSERT INTO webhook_events/.test(String(s)))).toBe(true);
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
      updated_at: new Date().toISOString(),
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
