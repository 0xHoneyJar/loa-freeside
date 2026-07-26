/**
 * NOWPayments Redis-adjustment outbox — durability helpers (migration 0020).
 *
 * Covers the two novel exports that make purchased credit durable when the
 * Redis budget INCRBY fails after a lot is minted:
 *
 *   enqueueRedisCreditAdjustment — writes the outbox row (idempotent per lot).
 *   applyRedisCreditAdjustment    — atomic marker-check + INCRBY, then resolves
 *                                   the outbox row. Exactly-once under retry.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  enqueueRedisCreditAdjustment,
  applyRedisCreditAdjustment,
} from '../nowpayments-handler.js';

const adj = { lotId: 'lot_1', communityId: 'comm_1', amountCents: 2500n };

describe('enqueueRedisCreditAdjustment', () => {
  it('inserts the outbox row idempotently within the caller transaction', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await enqueueRedisCreditAdjustment(client as never, adj);

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(String(sql)).toMatch(/INSERT INTO pending_redis_credit_adjustments/i);
    expect(String(sql)).toMatch(/ON CONFLICT \(lot_id\) DO NOTHING/i);
    expect(params).toEqual(['lot_1', 'comm_1', '2500']);
  });
});

describe('applyRedisCreditAdjustment', () => {
  it('applies the INCRBY atomically and resolves the outbox row on success', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const ok = await applyRedisCreditAdjustment(redis as never, pool as never, adj);

    expect(ok).toBe(true);
    // Atomic marker-check + INCRBY: one eval over exactly two keys.
    expect(redis.eval).toHaveBeenCalledTimes(1);
    const evalArgs = redis.eval.mock.calls[0];
    // Persistent marker: NO TTL argument (script, numKeys, KEYS[1], KEYS[2],
    // ARGV[1]) = 5 args. An expiring marker could lapse while a pending outbox
    // row is still retryable and permit a double-credit on the next drain.
    expect(evalArgs).toHaveLength(5);
    expect(evalArgs[1]).toBe(2); // numKeys
    expect(evalArgs[2]).toBe('processed:mint:lot_1'); // KEYS[1]
    expect(evalArgs[3]).toBe('agent:budget:limit:comm_1'); // KEYS[2]
    expect(evalArgs[4]).toBe('2500'); // ARGV[1] amountCents
    // Outbox row marked applied.
    const applyUpdate = pool.query.mock.calls.find(([sql]) =>
      /SET applied_at = NOW\(\)/i.test(String(sql)),
    );
    expect(applyUpdatePresent(applyUpdate)).toBe(true);
  });

  it('treats an already-applied marker (eval → 0) as resolved, not double-credit', async () => {
    const redis = { eval: vi.fn().mockResolvedValue(0) };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const ok = await applyRedisCreditAdjustment(redis as never, pool as never, adj);

    expect(ok).toBe(true);
    const applyUpdate = pool.query.mock.calls.find(([sql]) =>
      /SET applied_at = NOW\(\)/i.test(String(sql)),
    );
    expect(applyUpdate).toBeTruthy();
  });

  it('leaves the row pending and bumps attempts when Redis is unavailable', async () => {
    const redis = { eval: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const ok = await applyRedisCreditAdjustment(redis as never, pool as never, adj);

    expect(ok).toBe(false);
    // Attempts bumped, applied_at NOT set (stays pending for the next sweep).
    const calls = pool.query.mock.calls.map(([sql]) => String(sql));
    expect(calls.some((s) => /attempts = attempts \+ 1/i.test(s))).toBe(true);
    expect(calls.some((s) => /SET applied_at = NOW\(\)/i.test(s))).toBe(false);
  });
});

function applyUpdatePresent(call: unknown): boolean {
  return Array.isArray(call);
}
