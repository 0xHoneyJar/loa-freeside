/**
 * Redis credit exactly-once — proven against a real Redis.
 *
 * The unit coverage in packages/services/__tests__/nowpayments-redis-adjustment.test.ts
 * asserts the SHAPE of the call (one eval, two keys, no TTL argument). That
 * cannot prove the property that actually matters: that the Lua script is
 * genuinely atomic under concurrency and that the marker really survives an
 * unbounded retry horizon. Those are claims about Redis, so they are tested
 * against Redis.
 *
 * Invariant under test: for the entire lifetime of a pending outbox row, a
 * given lot increments `agent:budget:limit:{cid}` AT MOST ONCE — regardless of
 * how many times, from how many workers, or after how long the adjustment is
 * retried.
 *
 * Requires REDIS_URL / localhost:6379 (the `integration` project).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRequire } from 'module';

import { applyRedisCreditAdjustment } from '../../../../../../packages/services/nowpayments-handler.js';

const require = createRequire(import.meta.url);
const Redis = require('ioredis');

const HOST = process.env.REDIS_HOST || 'localhost';
const PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const DB = 13;

let redis: InstanceType<typeof Redis>;

const COMMUNITY = '11111111-1111-4111-8111-111111111111';
const LIMIT_KEY = `agent:budget:limit:${COMMUNITY}`;

/** Minimal Queryable: records acknowledgements, optionally failing them. */
function fakeDb(opts: { failAck?: boolean } = {}) {
  const statements: string[] = [];
  return {
    statements,
    query: async (text: string) => {
      statements.push(text);
      if (opts.failAck && /SET applied_at = NOW\(\)/i.test(text)) {
        throw new Error('postgres unavailable');
      }
      return { rows: [] };
    },
  };
}

const adjFor = (lotId: string, amountCents: bigint) => ({ lotId, communityId: COMMUNITY, amountCents });

async function limit(): Promise<number> {
  return Number((await redis.get(LIMIT_KEY)) ?? 0);
}

beforeAll(() => {
  redis = new Redis(PORT, HOST, { db: DB });
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe('Redis credit — exactly once', () => {
  it('credits once when a single apply succeeds', async () => {
    const db = fakeDb();
    const ok = await applyRedisCreditAdjustment(redis, db, adjFor('lot-a', 2500n));

    expect(ok).toBe(true);
    expect(await limit()).toBe(2500);
    expect(await redis.exists('processed:mint:lot-a')).toBe(1);
  });

  it('credits once when the SAME adjustment is applied 20 times sequentially', async () => {
    // Duplicate webhook delivery, duplicate sweep passes, operator re-runs.
    for (let i = 0; i < 20; i++) {
      await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-b', 700n));
    }
    expect(await limit()).toBe(700);
  });

  it('credits once when N workers apply the SAME adjustment concurrently', async () => {
    // Duplicate workers / a sweep racing the inline webhook apply. The whole
    // point of doing the check and the INCRBY in one Lua script.
    const workers = Array.from({ length: 25 }, () =>
      applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-c', 1234n)),
    );
    const results = await Promise.all(workers);

    expect(results.every((r) => r === true)).toBe(true);
    expect(await limit()).toBe(1234);
  });

  it('credits once across a process restart (fresh client, fresh connection)', async () => {
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-d', 900n));

    const restarted = new Redis(PORT, HOST, { db: DB });
    try {
      await applyRedisCreditAdjustment(restarted, fakeDb(), adjFor('lot-d', 900n));
    } finally {
      await restarted.quit();
    }

    expect(await limit()).toBe(900);
  });

  it('keeps the marker for an UNBOUNDED horizon — no TTL is ever set', async () => {
    // A marker that expired before its outbox row was acknowledged would let
    // the next drain INCRBY a second time. `-1` is redis for "no expiry".
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-e', 100n));

    expect(await redis.ttl('processed:mint:lot-e')).toBe(-1);
    expect(await redis.pttl('processed:mint:lot-e')).toBe(-1);
  });

  it('credits once when Redis succeeds, the Postgres ack fails, and the retry lands days later', async () => {
    // The exact sequence the durable outbox exists for.
    const failing = fakeDb({ failAck: true });
    await expect(
      applyRedisCreditAdjustment(redis, failing, adjFor('lot-f', 5000n)),
    ).rejects.toThrow(/postgres unavailable/);

    // Credit landed; the row is still pending because the ack never wrote.
    expect(await limit()).toBe(5000);

    // Simulate the retry horizon by advancing far past any plausible TTL. The
    // marker has none, so elapsed time is irrelevant — assert that directly
    // rather than sleeping.
    expect(await redis.ttl('processed:mint:lot-f')).toBe(-1);

    // Days later: sweep drains the still-pending row.
    const later = fakeDb();
    const ok = await applyRedisCreditAdjustment(redis, later, adjFor('lot-f', 5000n));

    expect(ok).toBe(true);
    expect(await limit()).toBe(5000); // NOT 10000
    expect(later.statements.some((s) => /SET applied_at = NOW\(\)/i.test(s))).toBe(true);
  });

  it('does not credit at all while Redis is unreachable, and credits once when it returns', async () => {
    const down = new Redis(PORT + 1, HOST, {
      db: DB, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 0,
    });
    down.on('error', () => {});

    const first = await applyRedisCreditAdjustment(down, fakeDb(), adjFor('lot-g', 4200n));
    expect(first).toBe(false);
    await down.quit().catch(() => {});
    expect(await limit()).toBe(0);

    const second = await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-g', 4200n));
    expect(second).toBe(true);
    expect(await limit()).toBe(4200);
  });

  it('keeps distinct lots independent — one marker never suppresses another', async () => {
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-h1', 100n));
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-h2', 250n));
    // …and replays of both are still absorbed.
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-h1', 100n));
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-h2', 250n));

    expect(await limit()).toBe(350);
  });

  it('never lets one community credit another', async () => {
    // Marker and limit keys are both namespaced by community; a replay for
    // tenant A must leave tenant B's budget untouched.
    const other = '22222222-2222-4222-8222-222222222222';
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-i', 800n));
    await applyRedisCreditAdjustment(redis, fakeDb(), {
      lotId: 'lot-j', communityId: other, amountCents: 300n,
    });
    await applyRedisCreditAdjustment(redis, fakeDb(), adjFor('lot-i', 800n));

    expect(await limit()).toBe(800);
    expect(Number((await redis.get(`agent:budget:limit:${other}`)) ?? 0)).toBe(300);
  });
});
