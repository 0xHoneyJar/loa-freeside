/**
 * Reconciliation Sweep — focused regressions
 *
 * 1. Monotonicity guard: the sweep includes partially_paid rows (to catch a
 *    delayed `finished`), but the Postgres crypto_payments_status_monotonicity
 *    trigger ranks partially_paid (4) above confirming/confirmed/sending
 *    (1-3). Persisting a still-progressing status for a partially_paid row
 *    would be a backward UPDATE the trigger rejects; the sweep must skip it.
 *
 * 2. Missed-mint recovery arm: an already-`finished` payment with no
 *    credit_lots row is recovered exactly once (Redis and Postgres-only
 *    fallback paths), and a row that already has a lot is never re-minted.
 *
 * 3. Fair rotation (migration 0020): the non-terminal arm orders by
 *    last_checked_at (least-recently-checked first) and stamps every polled row
 *    so a persistent oldest backlog can never starve newer payments.
 *
 * 4. Redis-adjustment outbox (migration 0020): budget increments that failed or
 *    were deferred (Postgres-only mint) are durably enqueued and drained by the
 *    sweep until they land exactly once.
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

const mockQuery = vi.fn();
const mockPool = { query: mockQuery } as unknown as import('pg').Pool;

const finishedRow = {
  payment_id: 'pay_finished',
  community_id: 'comm_1',
  price_amount: 25,
  order_id: 'order_finished',
};

/** Scoped-client queries recorded by the withCommunityScope mock. */
const scopedQuery = vi.fn().mockResolvedValue({ rows: [] });
/** communityIds withCommunityScope was invoked with, in order. */
const scopedCommunities: string[] = [];

beforeEach(() => {
  mockQuery.mockReset();
  mockProcessPaymentForLedger.mockReset();
  mockMintCreditLot.mockReset();
  mockWithCommunityScope.mockReset();
  mockEnqueueAdj.mockReset();
  mockApplyAdj.mockReset();
  scopedQuery.mockClear();
  scopedCommunities.length = 0;
  // Default: nothing pending in the outbox drain.
  mockApplyAdj.mockResolvedValue(true);
  // Default withCommunityScope: record the community and run the callback with
  // a query-capable scoped client (mirrors the real BEGIN/SET LOCAL/COMMIT).
  mockWithCommunityScope.mockImplementation(
    async (communityId: string, _pool: unknown, fn: (c: unknown) => unknown) => {
      scopedCommunities.push(communityId);
      return fn({ query: scopedQuery });
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runReconciliationSweep — monotonicity guard', () => {
  it('does NOT persist a backward transition for a partially_paid row', async () => {
    // Stuck SELECT → one partially_paid row; stamp UPDATE; missed-mint SELECT → none.
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            payment_id: 'pay_1',
            community_id: 'comm_1',
            status: 'partially_paid',
            price_amount: 10,
            order_id: 'order_1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // missed-mint SELECT (stamp is scoped, not on pool)

    // Provider still reports a lower-ranked, non-terminal status.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'order_1' }),
      }),
    );

    const result = await runReconciliationSweep(mockPool, null, config);

    // No UPDATE crypto_payments was attempted (only SELECT + sidecar stamp).
    const ranUpdate = mockQuery.mock.calls.some(([sql]) =>
      /UPDATE\s+crypto_payments\b/i.test(String(sql)),
    );
    expect(ranUpdate).toBe(false);

    // The row is left pending, not errored.
    expect(result.errorCount).toBe(0);
    expect(result.pendingCount).toBe(1);
    expect(result.details[0]).toMatchObject({
      paymentId: 'pay_1',
      previousStatus: 'partially_paid',
      newStatus: null,
      action: 'pending',
    });
  });
});

describe('runReconciliationSweep — fair rotation (migration 0020)', () => {
  it('orders the non-terminal arm least-recently-checked first and stamps polled rows', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            payment_id: 'pay_1',
            community_id: 'comm_1',
            status: 'confirming',
            price_amount: 10,
            order_id: 'order_1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // missed-mint SELECT

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'order_1' }),
      }),
    );

    await runReconciliationSweep(mockPool, null, config);

    // Stuck SELECT rotates on the cursor.
    const stuckSql = String(mockQuery.mock.calls[0][0]);
    expect(stuckSql).toMatch(/last_checked_at ASC NULLS FIRST/i);
    expect(stuckSql).toMatch(/LEFT JOIN crypto_payment_checks/i);

    // The stamp runs on a community-scoped client (forced tenant RLS), never
    // as an unscoped pool query.
    expect(scopedCommunities).toContain('comm_1');
    const stampCall = scopedQuery.mock.calls.find(([sql]) =>
      /INSERT INTO crypto_payment_checks/i.test(String(sql)),
    );
    expect(stampCall).toBeTruthy();
    expect(String(stampCall![0])).toMatch(
      /ON CONFLICT .* DO UPDATE SET last_checked_at = NOW\(\)/is,
    );
    expect(stampCall![1]).toEqual([['pay_1'], 'comm_1']);
    const unscopedStamp = mockQuery.mock.calls.some(([sql]) =>
      /INSERT INTO crypto_payment_checks/i.test(String(sql)),
    );
    expect(unscopedStamp).toBe(false);
  });

  it('stamps each community under its own scope and never crosses tenants', async () => {
    // Two communities in one batch: each cursor write must run inside its own
    // withCommunityScope, carrying only its own payment ids.
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { payment_id: 'p_a', community_id: 'comm_a', status: 'confirming', price_amount: 10, order_id: 'o_a' },
          { payment_id: 'p_b', community_id: 'comm_b', status: 'confirming', price_amount: 10, order_id: 'o_b' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // missed-mint SELECT

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'o' }),
      }),
    );

    await runReconciliationSweep(mockPool, null, config);

    const stampCalls = scopedQuery.mock.calls.filter(([sql]) =>
      /INSERT INTO crypto_payment_checks/i.test(String(sql)),
    );
    expect(stampCalls).toHaveLength(2);
    expect(scopedCommunities).toEqual(expect.arrayContaining(['comm_a', 'comm_b']));
    // No stamp carries another community's payment ids.
    for (const [, params] of stampCalls) {
      const [ids, communityId] = params as [string[], string];
      expect(ids).toEqual(communityId === 'comm_a' ? ['p_a'] : ['p_b']);
    }
  });
});

describe('runReconciliationSweep — missed-mint recovery arm', () => {
  const mockRedis = {} as unknown as import('ioredis').Redis;

  it('recovers a finished payment with no credit lot via the Redis mint path (once)', async () => {
    // No non-terminal stuck rows (→ no stamp); missed-mint SELECT → one finished row;
    // outbox drain SELECT → none.
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [finishedRow] })
      .mockResolvedValueOnce({ rows: [] }); // outbox drain
    mockProcessPaymentForLedger.mockResolvedValue({ lotId: 'lot_1', amountUsdMicro: 25_000_000n });

    const result = await runReconciliationSweep(mockPool, mockRedis, config);

    expect(mockProcessPaymentForLedger).toHaveBeenCalledTimes(1);
    expect(mockProcessPaymentForLedger).toHaveBeenCalledWith(
      mockPool,
      mockRedis,
      expect.objectContaining({ paymentId: 'pay_finished', communityId: 'comm_1' }),
    );
    expect(mockWithCommunityScope).not.toHaveBeenCalled();
    expect(result.recoveredCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.details.at(-1)).toMatchObject({
      paymentId: 'pay_finished',
      previousStatus: 'finished',
      newStatus: 'finished',
      action: 'recovered',
      lotId: 'lot_1',
    });
  });

  it('recovers via the Postgres-only fallback when Redis is unavailable', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [finishedRow] });
    // The default withCommunityScope mock runs the callback with a scoped client.
    mockMintCreditLot.mockResolvedValue('lot_pg');

    const result = await runReconciliationSweep(mockPool, null, config);

    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockWithCommunityScope).toHaveBeenCalledTimes(1);
    expect(mockMintCreditLot).toHaveBeenCalledTimes(1);
    // Postgres-only mint durably enqueues the Redis adjustment for later drain.
    expect(mockEnqueueAdj).toHaveBeenCalledTimes(1);
    expect(mockEnqueueAdj).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lotId: 'lot_pg', communityId: 'comm_1', amountCents: 2500n }),
    );
    expect(result.recoveredCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.details.at(-1)).toMatchObject({
      paymentId: 'pay_finished',
      action: 'recovered',
      lotId: 'lot_pg',
    });
  });

  it('gives each arm a slot even at batchSize 1 (no starvation)', async () => {
    // batchSize 1 floors to an effective batch of 2, so the stuck arm is capped
    // to 1 and the missed-mint arm still gets the leftover slot — a standing
    // stuck backlog can no longer starve missed-mint recovery.
    const oneBatch = { ...config, batchSize: 1 };
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            payment_id: 'pay_pp',
            community_id: 'comm_1',
            status: 'partially_paid',
            price_amount: 10,
            order_id: 'order_pp',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [finishedRow] }) // missed-mint gets its slot
      .mockResolvedValueOnce({ rows: [] }); // outbox drain
    // Provider still progressing → guard leaves it pending, no UPDATE.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'order_pp' }),
      }),
    );
    mockProcessPaymentForLedger.mockResolvedValue({ lotId: 'lot_1', amountUsdMicro: 25_000_000n });

    const result = await runReconciliationSweep(mockPool, mockRedis, oneBatch);

    // The missed-mint query ran despite the stuck backlog occupying its slot.
    const ranMissedMint = mockQuery.mock.calls.some(([sql]) =>
      /LEFT JOIN credit_lots/i.test(String(sql)),
    );
    expect(ranMissedMint).toBe(true);
    expect(mockProcessPaymentForLedger).toHaveBeenCalledTimes(1);
    expect(result.recoveredCount).toBe(1);
    // Stuck arm capped to 1 (ceil(2/2)).
    expect(mockQuery.mock.calls[0][1]).toEqual([config.minAgeMins, 1]);
    expect(result.pendingCount).toBe(1);
  });

  it('does not starve the missed-mint arm when the stuck backlog is full', async () => {
    // batchSize 4: the stuck arm is capped at ceil(4/2)=2, so even a full
    // backlog leaves >= floor(4/2)=2 capacity for missed-mint recovery.
    const cfg = { ...config, batchSize: 4 };
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { payment_id: 'pp1', community_id: 'c', status: 'partially_paid', price_amount: 10, order_id: 'o1' },
          { payment_id: 'pp2', community_id: 'c', status: 'partially_paid', price_amount: 10, order_id: 'o2' },
        ],
      })
      .mockResolvedValueOnce({ rows: [finishedRow] }) // missed-mint SELECT
      .mockResolvedValueOnce({ rows: [] }); // outbox drain
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'o' }),
      }),
    );
    mockProcessPaymentForLedger.mockResolvedValue({ lotId: 'lot_x', amountUsdMicro: 25_000_000n });

    const result = await runReconciliationSweep(mockPool, mockRedis, cfg);

    // Missed-mint arm ran despite the full stuck backlog.
    expect(mockProcessPaymentForLedger).toHaveBeenCalledTimes(1);
    expect(result.recoveredCount).toBe(1);
    // Stuck arm was capped to 2 (ceil(4/2)); missed-mint got the leftover 2.
    const stuckSql = String(mockQuery.mock.calls[0][0]);
    expect(stuckSql).toMatch(/status IN/);
    expect(mockQuery.mock.calls[0][1]).toEqual([config.minAgeMins, 2]);
  });

  it('does not re-mint when the finished payment already has a credit lot', async () => {
    // The missed-mint SELECT (LEFT JOIN ... WHERE l.id IS NULL) returns no rows
    // once a lot exists, so a rerun mints nothing — no duplicate lot.
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // outbox drain

    const result = await runReconciliationSweep(mockPool, mockRedis, config);

    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockMintCreditLot).not.toHaveBeenCalled();
    expect(result.recoveredCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });
});

describe('runReconciliationSweep — Redis-adjustment outbox drain (migration 0020)', () => {
  const mockRedis = {} as unknown as import('ioredis').Redis;

  it('drains pending Redis adjustments exactly once when Redis is available', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // stuck
      .mockResolvedValueOnce({ rows: [] }) // missed-mint
      .mockResolvedValueOnce({
        rows: [{ lot_id: 'lot_pg', community_id: 'comm_1', amount_cents: '2500' }],
      }); // outbox drain SELECT
    mockApplyAdj.mockResolvedValue(true);

    const result = await runReconciliationSweep(mockPool, mockRedis, config);

    expect(mockApplyAdj).toHaveBeenCalledTimes(1);
    // Apply + acknowledge run under the adjustment's own tenant scope (forced
    // RLS), with a scoped client — never the unscoped pool.
    expect(scopedCommunities).toContain('comm_1');
    expect(mockApplyAdj).toHaveBeenCalledWith(
      mockRedis,
      expect.objectContaining({ query: expect.any(Function) }),
      { lotId: 'lot_pg', communityId: 'comm_1', amountCents: 2500n },
    );
    expect(mockApplyAdj.mock.calls[0][1]).not.toBe(mockPool);
    expect(result.redisAdjustmentsApplied).toBe(1);

    // The drain query targets only unapplied rows, oldest-created first (FIFO)
    // so fresh rows can never starve older failed ones.
    const drainSql = String(mockQuery.mock.calls[2][0]);
    expect(drainSql).toMatch(/FROM pending_redis_credit_adjustments/i);
    expect(drainSql).toMatch(/applied_at IS NULL/i);
    expect(drainSql).toMatch(/created_at ASC/i);
  });

  it('does not run the outbox drain when Redis is unavailable', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // stuck
      .mockResolvedValueOnce({ rows: [] }); // missed-mint

    const result = await runReconciliationSweep(mockPool, null, config);

    expect(mockApplyAdj).not.toHaveBeenCalled();
    expect(result.redisAdjustmentsApplied).toBe(0);
    const ranDrain = mockQuery.mock.calls.some(([sql]) =>
      /pending_redis_credit_adjustments/i.test(String(sql)),
    );
    expect(ranDrain).toBe(false);
  });
});
