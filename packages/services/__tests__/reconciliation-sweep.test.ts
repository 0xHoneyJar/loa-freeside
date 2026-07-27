/**
 * Reconciliation Sweep — correctness regressions
 *
 * 1. Monotonicity guard: the sweep includes partially_paid rows (to catch a
 *    delayed `finished`), but the Postgres crypto_payments_status_monotonicity
 *    trigger ranks partially_paid (4) above confirming/confirmed/sending
 *    (1-3). Persisting a still-progressing status for a partially_paid row
 *    would be a backward UPDATE the trigger rejects; the sweep must skip it.
 *
 * 2. Missed-mint recovery arm: a payment that owes a credit lot is recovered
 *    exactly once (Redis and Postgres-only fallback paths), a row that already
 *    has a lot is never re-minted, and a payment whose status was captured by a
 *    concurrent/late `failed`/`expired` transition is still recovered on the
 *    evidence of its signed `finished` webhook_events row.
 *
 * 3. Fairness: batchSize is honored EXACTLY across all arms, slots go to the
 *    least-recently-serviced work, cursors are stamped BEFORE processing, and
 *    neither a standing backlog nor a permanently-failing "poison" row can
 *    starve anything — including at batchSize 1.
 *
 * 4. Redis-adjustment outbox (migration 0020): budget increments that failed or
 *    were deferred (Postgres-only mint) are durably enqueued and drained by the
 *    sweep until they land exactly once.
 *
 * 5. Tenant isolation: enumeration uses the explicitly injected maintenance
 *    authority; every mutation runs inside its own community's RLS scope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the mint/ledger collaborators so the sweep's recovery arm can be
// exercised without a real database or Redis. The whole nowpayments-handler
// module is replaced, so every export the sweep imports must be listed here.
const {
  mockProcessPaymentForLedger,
  mockMintCreditLot,
  mockWithCommunityScope,
  mockEnqueueAdj,
  mockApplyAdj,
} = vi.hoisted(() => ({
  mockProcessPaymentForLedger: vi.fn(),
  mockMintCreditLot: vi.fn(),
  mockWithCommunityScope: vi.fn(),
  mockEnqueueAdj: vi.fn(),
  mockApplyAdj: vi.fn(),
}));

vi.mock('../nowpayments-handler.js', () => ({
  processPaymentForLedger: mockProcessPaymentForLedger,
  enqueueRedisCreditAdjustment: mockEnqueueAdj,
  applyRedisCreditAdjustment: mockApplyAdj,
  LOT_EXPIRY_DAYS: 90,
  usdToMicroSafe: (n: number) => BigInt(Math.round(n * 100)) * 10_000n,
}));
vi.mock('../credit-lot-service.js', () => ({
  mintCreditLot: mockMintCreditLot,
}));
vi.mock('../community-scope.js', () => ({
  // Invoke the callback with a dummy client, mirroring the real BEGIN/COMMIT wrapper.
  withCommunityScope: mockWithCommunityScope,
}));

import { runReconciliationSweep, type ReconciliationConfig } from '../reconciliation-sweep.js';

const config: ReconciliationConfig = {
  apiKey: 'test-key',
  apiUrl: 'https://api.test',
  minAgeMins: 10,
  batchSize: 50,
  timeoutMs: 1000,
};

const mockRedis = {} as unknown as import('ioredis').Redis;

// ---------------------------------------------------------------------------
// Fake database
//
// Routed by SQL shape rather than call order: the sweep enumerates every arm
// before allocating slots, so an order-coupled fake would encode the very
// scheduling detail these tests exist to vary.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface FakeDb {
  stuck?: Row[];
  missed?: Row[];
  outbox?: Row[];
}

/** Classify an enumeration query by the tables it touches. */
function classify(sql: string): 'stuck' | 'missed' | 'outbox' | 'other' {
  if (/FROM pending_redis_credit_adjustments/i.test(sql)) return 'outbox';
  if (/LEFT JOIN credit_lots/i.test(sql)) return 'missed';
  if (/FROM crypto_payments/i.test(sql)) return 'stuck';
  return 'other';
}

function makeQuery(db: FakeDb) {
  return vi.fn(async (sql: string, params?: unknown[]) => {
    const s = String(sql);
    switch (classify(s)) {
      case 'outbox':
        return { rows: (db.outbox ?? []).slice(0, Number(params?.[0] ?? Infinity)) };
      case 'missed':
        return { rows: (db.missed ?? []).slice(0, Number(params?.[1] ?? Infinity)) };
      case 'stuck':
        return { rows: (db.stuck ?? []).slice(0, Number(params?.[1] ?? Infinity)) };
      default:
        return { rows: [] };
    }
  });
}

/** Candidate-row builders. `key` is the rotation cursor the sweep sorts on. */
const stuckRow = (id: string, key: string, over: Row = {}): Row => ({
  payment_id: id, community_id: 'comm_1', status: 'confirming',
  price_amount: 10, order_id: `o_${id}`, fairness_key: key, ...over,
});
const missedRow = (id: string, key: string, over: Row = {}): Row => ({
  payment_id: id, community_id: 'comm_1', price_amount: 25,
  order_id: `o_${id}`, status: 'finished', fairness_key: key, ...over,
});
const outboxRow = (id: string, key: string, over: Row = {}): Row => ({
  lot_id: id, community_id: 'comm_1', amount_cents: '2500', fairness_key: key, ...over,
});

/** Provider poll response; defaults to "still progressing" (leaves row pending). */
function stubProvider(payment_status = 'confirming') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ payment_id: 1, payment_status, order_id: 'o', price_amount: 10, actually_paid: 10 }),
  }));
}

/** Scoped-client queries recorded by the withCommunityScope mock. */
const scopedQuery = vi.fn().mockResolvedValue({ rows: [] });
/** communityIds withCommunityScope was invoked with, in order. */
const scopedCommunities: string[] = [];

beforeEach(() => {
  mockProcessPaymentForLedger.mockReset();
  mockMintCreditLot.mockReset();
  mockWithCommunityScope.mockReset();
  mockEnqueueAdj.mockReset();
  mockApplyAdj.mockReset();
  scopedQuery.mockClear();
  scopedQuery.mockResolvedValue({ rows: [] });
  scopedCommunities.length = 0;
  mockApplyAdj.mockResolvedValue(true);
  mockProcessPaymentForLedger.mockResolvedValue({ lotId: 'lot_1', amountUsdMicro: 25_000_000n });
  mockMintCreditLot.mockResolvedValue('lot_pg');
  mockWithCommunityScope.mockImplementation(
    async (communityId: string, _pool: unknown, fn: (c: unknown) => unknown) => {
      scopedCommunities.push(communityId);
      return fn({ query: scopedQuery });
    },
  );
  stubProvider();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Ids of the work items the sweep actually serviced, via the cursor stamps. */
function stampedIds(): string[] {
  return scopedQuery.mock.calls
    .filter(([sql]) => /crypto_payment_checks|pending_redis_credit_adjustments/i.test(String(sql)))
    .flatMap(([, params]) => (params as [string[], ...unknown[]])[0]);
}

describe('runReconciliationSweep — monotonicity guard', () => {
  it('does NOT persist a backward transition for a partially_paid row', async () => {
    const query = makeQuery({ stuck: [stuckRow('pay_1', '2020-01-01T00:00:00Z', { status: 'partially_paid' })] });
    const pool = { query } as unknown as import('pg').Pool;
    // Provider still reports a lower-ranked, non-terminal status.
    stubProvider('confirming');

    const result = await runReconciliationSweep(pool, null, config);

    const ranUpdate = [...query.mock.calls, ...scopedQuery.mock.calls].some(([sql]) =>
      /UPDATE\s+crypto_payments\b/i.test(String(sql)),
    );
    expect(ranUpdate).toBe(false);
    expect(result.errorCount).toBe(0);
    expect(result.pendingCount).toBe(1);
    expect(result.details[0]).toMatchObject({
      paymentId: 'pay_1', previousStatus: 'partially_paid', newStatus: null, action: 'pending',
    });
  });
});

describe('runReconciliationSweep — missed-mint recovery arm', () => {
  it('recovers a finished payment with no credit lot via the Redis mint path (once)', async () => {
    const pool = { query: makeQuery({ missed: [missedRow('pay_finished', '2020-01-01T00:00:00Z')] }) } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, mockRedis, config);

    expect(mockProcessPaymentForLedger).toHaveBeenCalledTimes(1);
    expect(mockProcessPaymentForLedger).toHaveBeenCalledWith(
      pool, mockRedis,
      expect.objectContaining({ paymentId: 'pay_finished', communityId: 'comm_1' }),
    );
    expect(result.recoveredCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.details.at(-1)).toMatchObject({
      paymentId: 'pay_finished', previousStatus: 'finished', action: 'recovered', lotId: 'lot_1',
    });
  });

  it('recovers via the Postgres-only fallback when Redis is unavailable', async () => {
    const pool = { query: makeQuery({ missed: [missedRow('pay_finished', '2020-01-01T00:00:00Z')] }) } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, null, config);

    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockMintCreditLot).toHaveBeenCalledTimes(1);
    // Postgres-only mint durably enqueues the Redis adjustment for later drain.
    expect(mockEnqueueAdj).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lotId: 'lot_pg', communityId: 'comm_1', amountCents: 2500n }),
    );
    expect(result.recoveredCount).toBe(1);
    expect(result.details.at(-1)).toMatchObject({ paymentId: 'pay_finished', action: 'recovered', lotId: 'lot_pg' });
  });

  it('does not re-mint when the finished payment already has a credit lot', async () => {
    // The enumeration (LEFT JOIN credit_lots ... WHERE l.id IS NULL) returns
    // nothing once a lot exists, so a rerun mints nothing.
    const pool = { query: makeQuery({}) } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, mockRedis, config);

    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockMintCreditLot).not.toHaveBeenCalled();
    expect(result.recoveredCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // A signed `finished` IPN that lost the status column must still be credited.
  //
  // The monotonicity trigger ranks finished(5) BELOW expired(6)/failed(7), so a
  // concurrent or late failure transition permanently captures the status. The
  // non-terminal arm excludes those rows, so without this recovery source the
  // purchase would be lost forever.
  // -------------------------------------------------------------------------
  it.each(['failed', 'expired'])(
    'recovers a %s payment that has a signed finished webhook on record',
    async (status) => {
      const pool = { query: makeQuery({
        missed: [missedRow('pay_lost_race', '2020-01-01T00:00:00Z', { status })],
      }) } as unknown as import('pg').Pool;

      const result = await runReconciliationSweep(pool, mockRedis, config);

      expect(mockProcessPaymentForLedger).toHaveBeenCalledTimes(1);
      expect(result.recoveredCount).toBe(1);
      expect(result.details.at(-1)).toMatchObject({
        paymentId: 'pay_lost_race', previousStatus: status, action: 'recovered',
      });
    },
  );

  it('enumerates the finished-webhook evidence, not just the finished status', async () => {
    const query = makeQuery({});
    const pool = { query } as unknown as import('pg').Pool;

    await runReconciliationSweep(pool, mockRedis, config);

    const missedSql = String(query.mock.calls.find(([sql]) => classify(String(sql)) === 'missed')![0]);
    expect(missedSql).toMatch(/p\.status = 'finished'/);
    expect(missedSql).toMatch(/p\.status IN \('failed', 'expired'\)/);
    expect(missedSql).toMatch(/FROM webhook_events w/i);
    // Only a real (non-quarantined) finished event counts: the stale-quarantine
    // path writes `<id>:<status>:stale`, which must not trigger an auto-mint.
    expect(missedSql).toMatch(/w\.event_id = p\.payment_id \|\| ':finished'/);
  });
});

describe('runReconciliationSweep — batchSize is honored exactly', () => {
  it('processes exactly batchSize items in total, never one per arm', async () => {
    // Every arm has work. batchSize 1 must yield exactly ONE serviced item.
    const pool = { query: makeQuery({
      stuck: [stuckRow('s1', '2020-01-01T00:00:00Z')],
      missed: [missedRow('m1', '2021-01-01T00:00:00Z')],
      outbox: [outboxRow('a1', '2022-01-01T00:00:00Z')],
    }) } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });

    const serviced =
      result.paymentsChecked + result.redisAdjustmentsApplied;
    expect(serviced).toBe(1);
    // The oldest cursor (the stuck row) won the single slot.
    expect(stampedIds()).toEqual(['s1']);
    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockApplyAdj).not.toHaveBeenCalled();
  });

  it('never asks any arm for more than batchSize candidates', async () => {
    const query = makeQuery({});
    const pool = { query } as unknown as import('pg').Pool;

    await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 3 });

    const limits = query.mock.calls.map(([sql, params]) => {
      const p = params as unknown[];
      return classify(String(sql)) === 'outbox' ? p[0] : p[1];
    });
    expect(limits).toEqual([3, 3, 3]);
  });

  it('caps a full multi-arm backlog at batchSize', async () => {
    const pool = { query: makeQuery({
      stuck: [stuckRow('s1', '2020-01-01T00:00:00Z'), stuckRow('s2', '2020-01-02T00:00:00Z')],
      missed: [missedRow('m1', '2020-01-03T00:00:00Z'), missedRow('m2', '2020-01-04T00:00:00Z')],
      outbox: [outboxRow('a1', '2020-01-05T00:00:00Z')],
    }) } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 3 });

    expect(stampedIds().sort()).toEqual(['s1', 's2'].concat('m1').sort());
    expect(result.paymentsChecked).toBe(3);
    expect(result.redisAdjustmentsApplied).toBe(0);
  });
});

describe('runReconciliationSweep — fairness: no arm or item starves', () => {
  it('rotates the single slot across arms on successive sweeps (batchSize 1)', async () => {
    // Standing backlog in every arm. Servicing an item stamps its cursor to
    // NOW(), so the next sweep must pick a DIFFERENT item — the classic
    // "continuous new work starves old work" failure must not occur.
    const db: FakeDb = {
      stuck: [stuckRow('s1', '2020-01-01T00:00:00Z')],
      missed: [missedRow('m1', '2020-01-02T00:00:00Z')],
      outbox: [outboxRow('a1', '2020-01-03T00:00:00Z')],
    };
    const pool = { query: makeQuery(db) } as unknown as import('pg').Pool;

    const servicedPerSweep: string[][] = [];
    for (let sweep = 0; sweep < 3; sweep++) {
      scopedQuery.mockClear();
      await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });
      const serviced = stampedIds();
      servicedPerSweep.push(serviced);
      // Emulate the DB cursor write: the serviced item rotates to the back.
      const now = new Date(Date.UTC(2030, 0, 1 + sweep)).toISOString();
      for (const arm of ['stuck', 'missed', 'outbox'] as const) {
        for (const row of db[arm] ?? []) {
          const id = (row.payment_id ?? row.lot_id) as string;
          if (serviced.includes(id)) row.fairness_key = now;
        }
      }
    }

    // Three sweeps, three different arms — nothing monopolised the slot.
    expect(servicedPerSweep).toEqual([['s1'], ['m1'], ['a1']]);
  });

  it('does not let a continuous stream of fresh work starve one old item', async () => {
    // The old item's cursor never advances until it is serviced; fresh arrivals
    // always sort behind it. This is the property NULLS-FIRST ordering broke.
    const db: FakeDb = {
      missed: [missedRow('old', '2019-01-01T00:00:00Z')],
    };
    const pool = { query: makeQuery(db) } as unknown as import('pg').Pool;

    for (let sweep = 0; sweep < 5; sweep++) {
      // A fresh never-attempted row arrives before every sweep.
      db.missed!.push(missedRow(`fresh_${sweep}`, `2026-0${sweep + 1}-01T00:00:00Z`));
      db.missed!.sort((a, b) => String(a.fairness_key).localeCompare(String(b.fairness_key)));
      scopedQuery.mockClear();
      await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });
      if (sweep === 0) expect(stampedIds()).toEqual(['old']);
    }
  });

  it('stamps the rotation cursor BEFORE processing, so a poison item cannot block the queue', async () => {
    // 'poison' always throws. Without a pre-stamp it would re-win the head slot
    // every sweep and the rows behind it would never be serviced.
    const db: FakeDb = {
      missed: [
        missedRow('poison', '2020-01-01T00:00:00Z'),
        missedRow('healthy', '2020-01-02T00:00:00Z'),
      ],
    };
    const pool = { query: makeQuery(db) } as unknown as import('pg').Pool;
    mockProcessPaymentForLedger.mockImplementation(async (_p: unknown, _r: unknown, e: { paymentId: string }) => {
      if (e.paymentId === 'poison') throw new Error('mint always fails');
      return { lotId: 'lot_ok', amountUsdMicro: 25_000_000n };
    });

    // Sweep 1: poison wins the slot, throws, but is still stamped.
    const first = await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });
    expect(first.errorCount).toBe(1);
    expect(stampedIds()).toEqual(['poison']);
    db.missed![0].fairness_key = '2030-01-01T00:00:00Z';
    db.missed!.sort((a, b) => String(a.fairness_key).localeCompare(String(b.fairness_key)));

    // Sweep 2: the healthy row behind it now gets served.
    scopedQuery.mockClear();
    const second = await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });
    expect(stampedIds()).toEqual(['healthy']);
    expect(second.recoveredCount).toBe(1);
  });

  it('stamps a stuck row even when the provider poll fails', async () => {
    const pool = { query: makeQuery({ stuck: [stuckRow('s_err', '2020-01-01T00:00:00Z')] }) } as unknown as import('pg').Pool;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('provider down')));

    const result = await runReconciliationSweep(pool, null, config);

    expect(result.errorCount).toBe(1);
    expect(stampedIds()).toEqual(['s_err']);
  });

  it('orders every arm by least-recently-serviced, not by arrival', async () => {
    const query = makeQuery({});
    const pool = { query } as unknown as import('pg').Pool;

    await runReconciliationSweep(pool, mockRedis, config);

    const byKind = Object.fromEntries(
      query.mock.calls.map(([sql]) => [classify(String(sql)), String(sql)]),
    );
    expect(byKind.stuck).toMatch(/ORDER BY COALESCE\(c\.last_checked_at, p\.created_at\) ASC, p\.payment_id ASC/i);
    expect(byKind.missed).toMatch(/ORDER BY COALESCE\(c\.last_checked_at, p\.updated_at\) ASC, p\.payment_id ASC/i);
    expect(byKind.outbox).toMatch(/ORDER BY COALESCE\(last_attempt_at, created_at\) ASC, lot_id ASC/i);
  });

  it('is deterministic: identical DB state yields an identical batch', async () => {
    const build = () => ({ query: makeQuery({
      // Same cursor on every row — only the stable tie-break can decide.
      stuck: [stuckRow('s_b', '2020-01-01T00:00:00Z'), stuckRow('s_a', '2020-01-01T00:00:00Z')],
      missed: [missedRow('m_a', '2020-01-01T00:00:00Z')],
      outbox: [outboxRow('a_a', '2020-01-01T00:00:00Z')],
    }) } as unknown as import('pg').Pool);

    const runs: string[][] = [];
    for (let i = 0; i < 3; i++) {
      scopedQuery.mockClear();
      await runReconciliationSweep(build(), mockRedis, { ...config, batchSize: 2 });
      runs.push(stampedIds());
    }

    // Ties break on kind (stuck < missed_mint < redis_adjustment) then id.
    expect(runs[0]).toEqual(['s_a', 's_b']);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });
});

describe('runReconciliationSweep — Redis-adjustment outbox drain (migration 0020)', () => {
  it('drains pending Redis adjustments exactly once when Redis is available', async () => {
    const query = makeQuery({ outbox: [outboxRow('lot_pg', '2020-01-01T00:00:00Z')] });
    const pool = { query } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, mockRedis, config);

    expect(mockApplyAdj).toHaveBeenCalledTimes(1);
    // Apply + acknowledge run under the adjustment's own tenant scope (forced
    // RLS), with a scoped client — never the unscoped pool.
    expect(scopedCommunities).toContain('comm_1');
    expect(mockApplyAdj).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({ query: expect.any(Function) }),
      { lotId: 'lot_pg', communityId: 'comm_1', amountCents: 2500n },
    );
    expect(mockApplyAdj.mock.calls[0][1]).not.toBe(pool);
    expect(result.redisAdjustmentsApplied).toBe(1);

    const drainSql = String(query.mock.calls.find(([sql]) => classify(String(sql)) === 'outbox')![0]);
    expect(drainSql).toMatch(/applied_at IS NULL/i);
  });

  it('does not run the outbox drain when Redis is unavailable', async () => {
    const query = makeQuery({ outbox: [outboxRow('lot_pg', '2020-01-01T00:00:00Z')] });
    const pool = { query } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, null, config);

    expect(mockApplyAdj).not.toHaveBeenCalled();
    expect(result.redisAdjustmentsApplied).toBe(0);
    const ranDrain = query.mock.calls.some(([sql]) =>
      /pending_redis_credit_adjustments/i.test(String(sql)),
    );
    expect(ranDrain).toBe(false);
  });

  it('rotates the outbox cursor only for still-pending rows, inside the tenant scope', async () => {
    const pool = { query: makeQuery({ outbox: [outboxRow('lot_x', '2020-01-01T00:00:00Z')] }) } as unknown as import('pg').Pool;

    await runReconciliationSweep(pool, mockRedis, config);

    const stamp = scopedQuery.mock.calls.find(([sql]) =>
      /UPDATE pending_redis_credit_adjustments/i.test(String(sql)),
    );
    expect(stamp).toBeTruthy();
    expect(String(stamp![0])).toMatch(/SET last_attempt_at = NOW\(\)/i);
    expect(String(stamp![0])).toMatch(/applied_at IS NULL/i);
    expect(stamp![1]).toEqual([['lot_x']]);
    // Never as an unscoped pool write.
    expect(scopedCommunities).toContain('comm_1');
  });

  it('a permanently failing adjustment does not block the rest of the outbox', async () => {
    const db: FakeDb = {
      outbox: [outboxRow('bad', '2020-01-01T00:00:00Z'), outboxRow('good', '2020-01-02T00:00:00Z')],
    };
    const pool = { query: makeQuery(db) } as unknown as import('pg').Pool;
    mockApplyAdj.mockImplementation(async (_r: unknown, _db: unknown, a: { lotId: string }) =>
      a.lotId !== 'bad');

    const first = await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });
    expect(first.redisAdjustmentsApplied).toBe(0);
    expect(stampedIds()).toEqual(['bad']);

    db.outbox![0].fairness_key = '2030-01-01T00:00:00Z';
    db.outbox!.sort((a, b) => String(a.fairness_key).localeCompare(String(b.fairness_key)));
    scopedQuery.mockClear();

    const second = await runReconciliationSweep(pool, mockRedis, { ...config, batchSize: 1 });
    expect(second.redisAdjustmentsApplied).toBe(1);
    expect(stampedIds()).toEqual(['good']);
  });
});

describe('runReconciliationSweep — explicit maintenance authority (forced RLS)', () => {
  it('enumerates via the injected maintenancePool and never via the tenant pool', async () => {
    // Cross-community enumeration needs BYPASSRLS-class authority; it must be
    // injected explicitly rather than inferred from the tenant pool.
    const maintQuery = makeQuery({
      stuck: [stuckRow('p_a', '2020-01-01T00:00:00Z', { community_id: 'comm_a' })],
      outbox: [outboxRow('lot_a', '2020-01-02T00:00:00Z', { community_id: 'comm_a' })],
    });
    const maintenancePool = { query: maintQuery } as unknown as import('pg').Pool;
    const tenantQuery = makeQuery({});
    const pool = { query: tenantQuery } as unknown as import('pg').Pool;

    const result = await runReconciliationSweep(pool, mockRedis, config, { maintenancePool });

    // All three enumerations went to the maintenance connection...
    expect(maintQuery).toHaveBeenCalledTimes(3);
    // ...and no enumeration leaked onto the tenant pool.
    expect(tenantQuery).not.toHaveBeenCalled();
    // Writes still run scoped, under the tenant path.
    expect(scopedCommunities).toContain('comm_a');
    expect(result.redisAdjustmentsApplied).toBe(1);
  });

  it('defaults maintenancePool to the main pool when not injected', async () => {
    const query = makeQuery({});
    const pool = { query } as unknown as import('pg').Pool;

    await runReconciliationSweep(pool, mockRedis, config);

    expect(query).toHaveBeenCalledTimes(3);
  });
});

describe('runReconciliationSweep — every mutation is tenant-scoped', () => {
  it('applies a terminal-failure transition through the community scope, not the raw pool', async () => {
    // crypto_payments carries forced tenant RLS; when the main pool is the
    // ordinary tenant role (the case maintenancePool exists to support), an
    // unscoped UPDATE would raise TENANT_CONTEXT_MISSING or match no row.
    const query = makeQuery({
      stuck: [stuckRow('pay_x', '2020-01-01T00:00:00Z', { community_id: 'comm_x', status: 'waiting' })],
    });
    const pool = { query } as unknown as import('pg').Pool;
    stubProvider('expired');

    const result = await runReconciliationSweep(pool, null, config);

    expect(result.failedCount).toBe(1);
    expect(scopedCommunities).toContain('comm_x');
    const scopedUpdate = scopedQuery.mock.calls.find(([sql]) => /UPDATE crypto_payments/i.test(String(sql)));
    expect(scopedUpdate).toBeTruthy();
    const unscopedUpdate = query.mock.calls.some(([sql]) => /UPDATE crypto_payments/i.test(String(sql)));
    expect(unscopedUpdate).toBe(false);
  });

  it('stamps each community under its own scope and never crosses tenants', async () => {
    const pool = { query: makeQuery({
      stuck: [
        stuckRow('p_a', '2020-01-01T00:00:00Z', { community_id: 'comm_a' }),
        stuckRow('p_b', '2020-01-02T00:00:00Z', { community_id: 'comm_b' }),
      ],
    }) } as unknown as import('pg').Pool;

    await runReconciliationSweep(pool, null, config);

    const stampCalls = scopedQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO crypto_payment_checks/i.test(String(sql)),
    );
    expect(stampCalls).toHaveLength(2);
    expect(scopedCommunities).toEqual(expect.arrayContaining(['comm_a', 'comm_b']));
    for (const [, params] of stampCalls) {
      const [ids, communityId] = params as [string[], string];
      expect(ids).toEqual(communityId === 'comm_a' ? ['p_a'] : ['p_b']);
    }
  });
});
