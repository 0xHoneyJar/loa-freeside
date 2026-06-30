import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import {
  requireOperatorAuth,
  InMemoryNonceStore,
  type IntakeAuthDeps,
  type IntakeAuditEntry,
  type OperatorAuthEnv,
} from '../intake-auth.js';

const NOW = 1_700_000_000_000;

function harness(overrides: Partial<IntakeAuthDeps> = {}) {
  const audit = vi.fn<(e: IntakeAuditEntry) => void>();
  const deps: IntakeAuthDeps = {
    authenticate: (id, cred) => cred === 'good-' + id,
    authorize: (id) => id !== 'banned',
    nonces: new InMemoryNonceStore(),
    now: () => NOW,
    audit,
    ...overrides,
  };
  const app = new Hono<OperatorAuthEnv>();
  app.use('/v1/orders', requireOperatorAuth(deps));
  app.post('/v1/orders', (c) => c.json({ ok: true, op: c.get('operatorId') }));
  return { app, audit };
}

function headers(over: Record<string, string> = {}) {
  return {
    'x-operator-id': 'op1',
    'x-credential': 'good-op1',
    'x-nonce': 'n-' + Math.random(),
    'x-timestamp': String(NOW),
    ...over,
  };
}

async function post(app: Hono<OperatorAuthEnv>, h: Record<string, string>) {
  return app.request('/v1/orders', { method: 'POST', headers: h, body: '{}' });
}

describe('intake auth (S4-T2 / H-6)', () => {
  it('accepts an authenticated, authorized, fresh request (200) and logs ok', async () => {
    const { app, audit } = harness();
    const res = await post(app, headers());
    expect(res.status).toBe(200);
    expect((await res.json() as { op: string }).op).toBe('op1');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ ok: true, operator_id: 'op1' }));
  });

  it('rejects missing auth headers (401) and logs the failure', async () => {
    const { app, audit } = harness();
    const res = await post(app, { 'x-operator-id': 'op1' });
    expect(res.status).toBe(401);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  });

  it('rejects a bad credential (401)', async () => {
    const { app } = harness();
    expect((await post(app, headers({ 'x-credential': 'wrong' }))).status).toBe(401);
  });

  it('rejects an unauthorized operator (403)', async () => {
    const { app } = harness();
    expect((await post(app, headers({ 'x-operator-id': 'banned', 'x-credential': 'good-banned' }))).status).toBe(403);
  });

  it('rejects a replayed nonce (401 on the second use)', async () => {
    const { app } = harness();
    const h = headers({ 'x-nonce': 'fixed-nonce' });
    expect((await post(app, h)).status).toBe(200);
    expect((await post(app, h)).status).toBe(401); // replay
  });

  it('rejects a stale timestamp (401)', async () => {
    const { app } = harness();
    const res = await post(app, headers({ 'x-timestamp': String(NOW - 10 * 60_000) }));
    expect(res.status).toBe(401);
  });
});
