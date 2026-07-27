/**
 * processPaymentForLedger — mint/outbox atomicity and tenant scoping.
 *
 * The durable-outbox design rests on one structural claim: the credit lot and
 * its pending Redis adjustment are written in the SAME transaction, so the
 * outbox row is durable if and only if the lot is. If they could diverge, the
 * two halves fail in opposite directions — a lot with no outbox row is a
 * permanently uncredited purchase in Redis, and an outbox row with no lot is a
 * credit for money that was never minted.
 *
 * These tests pin that boundary, plus the tenant scope every statement inside
 * it runs under (credit_lots and pending_redis_credit_adjustments both carry
 * forced RLS keyed on app.current_community_id()).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMintCreditLot, mockWithCommunityScope, mockApplyAdj } = vi.hoisted(() => ({
  mockMintCreditLot: vi.fn(),
  mockWithCommunityScope: vi.fn(),
  mockApplyAdj: vi.fn(),
}));

vi.mock('../credit-lot-service.js', () => ({ mintCreditLot: mockMintCreditLot }));
vi.mock('../community-scope.js', () => ({ withCommunityScope: mockWithCommunityScope }));

import { processPaymentForLedger } from '../nowpayments-handler.js';

const COMMUNITY = 'comm-1';
const EVENT = {
  paymentId: 'pay-1',
  communityId: COMMUNITY,
  priceUsd: 25,
  orderId: 'order-1',
};

/** Records the exact statement sequence issued on the mint connection. */
function makePool(opts: { failEnqueue?: boolean } = {}) {
  const statements: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: vi.fn(async (text: string, p?: unknown[]) => {
      statements.push(text.trim());
      params.push(p ?? []);
      if (opts.failEnqueue && /INSERT INTO pending_redis_credit_adjustments/i.test(text)) {
        throw new Error('outbox insert failed');
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client, statements, params };
}

/** Statement keywords in issue order, ignoring the exact SQL text. */
function shape(statements: string[]): string[] {
  return statements.map((s) => {
    if (/^BEGIN/i.test(s)) return 'BEGIN';
    if (/^COMMIT/i.test(s)) return 'COMMIT';
    if (/^ROLLBACK/i.test(s)) return 'ROLLBACK';
    if (/set_config/i.test(s)) return 'SET_TENANT';
    if (/INSERT INTO pending_redis_credit_adjustments/i.test(s)) return 'ENQUEUE_OUTBOX';
    return 'OTHER';
  });
}

const redis = {} as never;

beforeEach(() => {
  mockMintCreditLot.mockReset();
  mockWithCommunityScope.mockReset();
  mockApplyAdj.mockReset();
  mockMintCreditLot.mockResolvedValue('lot-1');
  mockWithCommunityScope.mockImplementation(
    async (_cid: string, _pool: unknown, fn: (c: unknown) => unknown) => fn({ query: vi.fn() }),
  );
});

describe('processPaymentForLedger — mint and outbox are one transaction', () => {
  it('mints and enqueues inside a single tenant-scoped transaction', async () => {
    const { pool, statements } = makePool();

    const result = await processPaymentForLedger(pool as never, redis, EVENT);

    // Tenant scope is established BEFORE any RLS-guarded write, and both
    // writes land between the same BEGIN/COMMIT.
    expect(shape(statements)).toEqual(['BEGIN', 'SET_TENANT', 'ENQUEUE_OUTBOX', 'COMMIT']);
    expect(result.minted).toBe(true);
    expect(result.lotId).toBe('lot-1');
  });

  it('sets the tenant GUC with a bindable set_config, not SET LOCAL', async () => {
    // `SET LOCAL app.community_id = $1` is not parameterizable — the SET
    // command does not accept bind parameters, so it would have to be built by
    // string concatenation. set_config(..., is_local => true) is the
    // parameterized equivalent.
    const { pool, statements, params } = makePool();

    await processPaymentForLedger(pool as never, redis, EVENT);

    const idx = statements.findIndex((s) => /set_config/i.test(s));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(statements[idx]).toMatch(/set_config\('app\.community_id', \$1, true\)/i);
    expect(statements[idx]).not.toMatch(/SET\s+LOCAL/i);
    expect(params[idx]).toEqual([COMMUNITY]);
  });

  it('ROLLS BACK the mint when the outbox enqueue fails — never a lot without its outbox row', async () => {
    // The failure that would otherwise strand purchased credit outside Redis
    // forever: the lot exists, so no sweep arm revisits it, but no outbox row
    // exists to drain.
    const { pool, statements, client } = makePool({ failEnqueue: true });

    await expect(processPaymentForLedger(pool as never, redis, EVENT))
      .rejects.toThrow(/outbox insert failed/);

    expect(shape(statements)).toEqual(['BEGIN', 'SET_TENANT', 'ENQUEUE_OUTBOX', 'ROLLBACK']);
    expect(shape(statements)).not.toContain('COMMIT');
    // The connection is returned to the pool even on the failure path.
    expect(client.release).toHaveBeenCalledTimes(1);
    // No Redis credit is attempted for a rolled-back mint.
    expect(mockWithCommunityScope).not.toHaveBeenCalled();
  });

  it('skips the outbox row and the Redis credit for a duplicate payment', async () => {
    // mintCreditLot returns null on ON CONFLICT (payment_id) DO NOTHING. A
    // duplicate must not enqueue a second adjustment for a lot it did not mint.
    mockMintCreditLot.mockResolvedValue(null);
    const { pool, statements } = makePool();

    const result = await processPaymentForLedger(pool as never, redis, EVENT);

    expect(shape(statements)).toEqual(['BEGIN', 'SET_TENANT', 'COMMIT']);
    expect(result).toMatchObject({ lotId: null, minted: false, redisAdjusted: false });
    expect(mockWithCommunityScope).not.toHaveBeenCalled();
  });

  it('applies the Redis credit under the payment community scope, never unscoped', async () => {
    const { pool } = makePool();

    await processPaymentForLedger(pool as never, redis, EVENT);

    expect(mockWithCommunityScope).toHaveBeenCalledTimes(1);
    expect(mockWithCommunityScope.mock.calls[0][0]).toBe(COMMUNITY);
  });

  it('reports redisAdjusted:false — leaving the row pending — when the Redis credit fails', async () => {
    // The mint stays committed; recovery is the sweep's outbox drain.
    mockWithCommunityScope.mockImplementation(async () => false);
    const { pool, statements } = makePool();

    const result = await processPaymentForLedger(pool as never, redis, EVENT);

    expect(shape(statements)).toContain('COMMIT');
    expect(result).toMatchObject({ minted: true, redisAdjusted: false });
  });

  it('keeps each community in its own transaction scope', async () => {
    // Two payments, two communities: neither the GUC nor the Redis scope may
    // leak across them.
    const { pool, params, statements } = makePool();
    await processPaymentForLedger(pool as never, redis, EVENT);
    await processPaymentForLedger(pool as never, redis, { ...EVENT, paymentId: 'pay-2', communityId: 'comm-2' });

    const tenantParams = statements
      .map((s, i) => (/set_config/i.test(s) ? params[i][0] : null))
      .filter((v): v is string => v !== null);
    expect(tenantParams).toEqual([COMMUNITY, 'comm-2']);
    expect(mockWithCommunityScope.mock.calls.map((c) => c[0])).toEqual([COMMUNITY, 'comm-2']);
  });
});
