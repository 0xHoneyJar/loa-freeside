import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { hostFpFromUrl } from '@freeside/cluster-fp';
import { createIntakeApp } from '../intake.js';
import { InMemoryOrderStore } from '../store.js';
import { PostgresOrderStore } from '../store-postgres.js';

// A connection string carrying a password + a real-looking host, so the
// secret-hygiene assertions have something concrete to catch leaking.
const SECRET_CONN = 'postgres://appuser:s3cr3t-pw@db-orders.internal:5432/orders';

/** Minimal fake pg.Pool: exposes `options` + a `query` that resolves (reachable). */
function fakePool(opts: Record<string, unknown>, reachable = true): Pool {
  return {
    options: opts,
    query: async () => {
      if (!reachable) throw new Error('ECONNREFUSED');
      return { rows: [{ '?column?': 1 }] };
    },
  } as unknown as Pool;
}

describe('GET /admin/data-store — cell self-report (S1-T3, SDD C-1)', () => {
  it('authed GET returns the datastore.report.v1 shape', async () => {
    const store = new PostgresOrderStore({ pool: fakePool({ connectionString: SECRET_CONN }) });
    const app = createIntakeApp({ store, now: () => 1, serviceToken: 'tok' });

    const res = await app.request('/admin/data-store', {
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      schema_version: 'datastore.report.v1',
      engine: 'postgres',
      reachable: true,
      migrations_applied: null,
      store: 'postgres',
    });
    expect(body.host_fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('unauthed GET → 401 (behind the SERVICE_TOKEN gate)', async () => {
    const store = new PostgresOrderStore({ pool: fakePool({ connectionString: SECRET_CONN }) });
    const app = createIntakeApp({ store, now: () => 1, serviceToken: 'tok' });

    expect((await app.request('/admin/data-store')).status).toBe(401);
    const wrong = await app.request('/admin/data-store', { headers: { authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
  });

  it('NEVER leaks the connection string, password, host, or db-name in the body (NFR-1)', async () => {
    const store = new PostgresOrderStore({ pool: fakePool({ connectionString: SECRET_CONN }) });
    const app = createIntakeApp({ store, now: () => 1, serviceToken: 'tok' });

    const res = await app.request('/admin/data-store', { headers: { authorization: 'Bearer tok' } });
    const raw = await res.text();
    expect(raw).not.toContain('s3cr3t-pw'); // password
    expect(raw).not.toContain('postgres://'); // connection string
    expect(raw).not.toContain('db-orders.internal'); // host
    expect(raw).not.toContain('appuser'); // user
  });

  it('when no serviceToken is configured, the route is open (local/dev posture)', async () => {
    const store = new InMemoryOrderStore({ now: () => 1 });
    const app = createIntakeApp({ store, now: () => 1 }); // no serviceToken
    expect((await app.request('/admin/data-store')).status).toBe(200);
  });
});

describe('PostgresOrderStore.dataStoreFacts (SDD C-1 derivation)', () => {
  it('derives host_fp from pool.options WITHOUT the connection string, matching cluster-fp', async () => {
    const store = new PostgresOrderStore({ pool: fakePool({ connectionString: SECRET_CONN }) });
    const facts = await store.dataStoreFacts('salt-x');
    expect(facts.host_fp).toBe(hostFpFromUrl(SECRET_CONN, 'salt-x'));
    expect(facts.reachable).toBe(true);
    expect(JSON.stringify(facts)).not.toContain('s3cr3t-pw');
  });

  it('derives host_fp from discrete host/port/database when no connectionString', async () => {
    const store = new PostgresOrderStore({
      pool: fakePool({ host: 'DB-Orders.Internal', port: 5432, database: 'Orders' }),
    });
    const facts = await store.dataStoreFacts('salt-x');
    // Normalized + default-port-elided → identical to the URL form.
    expect(facts.host_fp).toBe(hostFpFromUrl('postgres://x:y@db-orders.internal/orders', 'salt-x'));
  });

  it('reachable=false is a FACT, not a throw, when the probe fails', async () => {
    const store = new PostgresOrderStore({
      pool: fakePool({ connectionString: SECRET_CONN }, false),
    });
    const facts = await store.dataStoreFacts('salt-x');
    expect(facts.reachable).toBe(false);
    expect(facts.host_fp).toMatch(/^[0-9a-f]{16}$/); // fp derives from config, not reachability
  });

  it('host_fp is null when the pool has no derivable connection info', async () => {
    const store = new PostgresOrderStore({ pool: fakePool({}) });
    const facts = await store.dataStoreFacts('salt-x');
    expect(facts.host_fp).toBeNull();
    expect(facts.engine).toBe('postgres');
    expect(facts.store).toBe('postgres');
  });
});

describe('InMemoryOrderStore.dataStoreFacts — absent store', () => {
  it('reports an honest no-database shape (engine/host_fp null, store memory)', async () => {
    const store = new InMemoryOrderStore({ now: () => 1 });
    const facts = await store.dataStoreFacts('unused-salt');
    expect(facts).toEqual({
      schema_version: 'datastore.report.v1',
      engine: null,
      host_fp: null,
      reachable: true,
      migrations_applied: null,
      store: 'memory',
    });
  });
});
