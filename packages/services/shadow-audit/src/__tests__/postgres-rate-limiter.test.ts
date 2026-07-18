import { describe, expect, it } from 'vitest';
import type { Sql } from 'postgres';
import { PostgresFixedWindowRateLimiter } from '../postgres-rate-limiter.js';

describe('PostgresFixedWindowRateLimiter', () => {
  it('shares one atomic deployment budget across independently constructed replicas', async () => {
    let count = 0;
    const queries: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      queries.push(strings.join(' '));
      count = Math.min(count + 1, 3);
      return Promise.resolve([{ request_count: count, retry_after_ms: 42_000 }]);
    }) as unknown as Sql;
    const config = { namespace: 'public-reconstruction', limit: 2, windowMs: 60_000 };
    const replicaA = new PostgresFixedWindowRateLimiter(sql, config);
    const replicaB = new PostgresFixedWindowRateLimiter(sql, config);

    expect((await replicaA.check('deployment')).allowed).toBe(true);
    expect((await replicaB.check('deployment')).allowed).toBe(true);
    const blocked = await replicaA.check('deployment');

    expect(blocked).toEqual({ allowed: false, remaining: 0, retryAfterMs: 42_000 });
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('ON CONFLICT (namespace, limiter_key) DO UPDATE');
    expect(queries[0]).toContain('clock_timestamp()');
  });

  it('rejects an invalid budget before reaching Postgres', () => {
    const sql = (() => Promise.resolve([])) as unknown as Sql;
    expect(
      () => new PostgresFixedWindowRateLimiter(sql, { namespace: 'x', limit: 0, windowMs: 1 }),
    ).toThrow(/positive integer/);
    expect(
      () => new PostgresFixedWindowRateLimiter(sql, { namespace: '', limit: 1, windowMs: 1 }),
    ).toThrow(/namespace/);
  });
});
