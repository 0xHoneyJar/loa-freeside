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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the mint/ledger collaborators so the sweep's recovery arm can be
// exercised without a real database or Redis.
const { mockProcessPaymentForLedger, mockMintCreditLot, mockWithCommunityScope } = vi.hoisted(() => ({
  mockProcessPaymentForLedger: vi.fn(),
  mockMintCreditLot: vi.fn(),
  mockWithCommunityScope: vi.fn(),
}));

vi.mock('../nowpayments-handler.js', () => ({
  processPaymentForLedger: mockProcessPaymentForLedger,
  LOT_EXPIRY_DAYS: 90,
  usdToMicroSafe: (n: number) => BigInt(Math.round(n * 1_000_000)),
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

beforeEach(() => {
  mockQuery.mockReset();
  mockProcessPaymentForLedger.mockReset();
  mockMintCreditLot.mockReset();
  mockWithCommunityScope.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runReconciliationSweep — monotonicity guard', () => {
  it('does NOT persist a backward transition for a partially_paid row', async () => {
    // Stuck-payments SELECT → one partially_paid row; missed-mint SELECT → none.
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
      .mockResolvedValueOnce({ rows: [] });

    // Provider still reports a lower-ranked, non-terminal status.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'order_1' }),
      }),
    );

    const result = await runReconciliationSweep(mockPool, null, config);

    // Only the two SELECTs ran — no UPDATE was attempted.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const ranUpdate = mockQuery.mock.calls.some(([sql]) =>
      /UPDATE\s+crypto_payments/i.test(String(sql)),
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

describe('runReconciliationSweep — missed-mint recovery arm', () => {
  const mockRedis = {} as unknown as import('ioredis').Redis;

  it('recovers a finished payment with no credit lot via the Redis mint path (once)', async () => {
    // No non-terminal stuck rows; missed-mint SELECT → one finished row.
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [finishedRow] });
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
    // withCommunityScope runs its callback with a dummy client; mint returns a lot id.
    mockMintCreditLot.mockResolvedValue('lot_pg');
    mockWithCommunityScope.mockImplementation(async (_community, _pool, fn) => fn({} as never));

    const result = await runReconciliationSweep(mockPool, null, config);

    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockWithCommunityScope).toHaveBeenCalledTimes(1);
    expect(mockMintCreditLot).toHaveBeenCalledTimes(1);
    expect(result.recoveredCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.details.at(-1)).toMatchObject({
      paymentId: 'pay_finished',
      action: 'recovered',
      lotId: 'lot_pg',
    });
  });

  it('caps total work at batchSize across both arms', async () => {
    // batchSize 1, and the non-terminal arm already returns 1 row → the
    // missed-mint arm must not run a second full batch.
    const oneBatch = { ...config, batchSize: 1 };
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          payment_id: 'pay_pp',
          community_id: 'comm_1',
          status: 'partially_paid',
          price_amount: 10,
          order_id: 'order_pp',
        },
      ],
    });
    // Provider still progressing → guard leaves it pending, no UPDATE.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ payment_id: 1, payment_status: 'confirming', order_id: 'order_pp' }),
      }),
    );

    const result = await runReconciliationSweep(mockPool, mockRedis, oneBatch);

    // Only the stuck-payments SELECT ran — the missed-mint query was skipped
    // because no batch capacity remained.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
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
      .mockResolvedValueOnce({ rows: [finishedRow] });
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
      .mockResolvedValueOnce({ rows: [] });

    const result = await runReconciliationSweep(mockPool, mockRedis, config);

    expect(mockProcessPaymentForLedger).not.toHaveBeenCalled();
    expect(mockMintCreditLot).not.toHaveBeenCalled();
    expect(result.recoveredCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });
});
