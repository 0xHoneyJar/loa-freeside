/**
 * Reconciliation Sweep — backward-transition guard
 *
 * Regression for the partially_paid monotonicity conflict: the sweep includes
 * partially_paid rows (to catch a delayed `finished`), but the Postgres
 * crypto_payments_status_monotonicity trigger ranks partially_paid (4) above
 * confirming/confirmed/sending (1-3). Persisting a still-progressing provider
 * status for a partially_paid row would be a backward UPDATE the trigger
 * rejects — erroring every sweep and stranding the row. The sweep must skip
 * it instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

beforeEach(() => {
  mockQuery.mockReset();
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
