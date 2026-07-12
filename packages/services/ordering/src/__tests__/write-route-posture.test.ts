import { describe, expect, it } from 'vitest';
import { resolveWriteRoutePosture } from '../composition.js';
import { createIntakeApp } from '../intake.js';
import { InMemoryOrderStore } from '../store.js';

describe('resolveWriteRoutePosture — D8 auth matrix (FR-10a)', () => {
  it('local/dev + no token → open_dev', () => {
    expect(resolveWriteRoutePosture({})).toBe('open_dev');
    expect(resolveWriteRoutePosture({ nodeEnv: 'development' })).toBe('open_dev');
  });

  it('local/dev + token → token', () => {
    expect(resolveWriteRoutePosture({ serviceToken: 't' })).toBe('token');
  });

  it('deployed + no token → disabled_no_token (fail-closed)', () => {
    expect(resolveWriteRoutePosture({ railwayEnvironment: 'production' })).toBe('disabled_no_token');
    expect(resolveWriteRoutePosture({ nodeEnv: 'production' })).toBe('disabled_no_token');
    // Whitespace-only marker does not count as deployed.
    expect(resolveWriteRoutePosture({ railwayEnvironment: '  ' })).toBe('open_dev');
  });

  it('deployed + token → token', () => {
    expect(resolveWriteRoutePosture({ railwayEnvironment: 'production', serviceToken: 't' })).toBe('token');
    expect(resolveWriteRoutePosture({ nodeEnv: 'production', serviceToken: 't' })).toBe('token');
  });
});

describe('fail-closed intake (deployed, tokenless — FR-10b)', () => {
  // bin/http.ts passes orchestrator: undefined when posture is disabled_no_token —
  // this pins the resulting surface: writes absent, reads + healthz open.
  function failClosedApp() {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    return createIntakeApp({
      store,
      now: () => 1_700_000_000_000,
      orchestrator: undefined,
      healthz: { store: 'memory', kitchen_enqueue: false, write_routes: 'disabled_no_token' },
    });
  }

  it('write routes are not mounted → 404', async () => {
    const app = failClosedApp();
    const advance = await app.request('/v1/orders/any/advance-ingredient', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ingredient: 'sonar', status: 'complete' }),
    });
    expect(advance.status).toBe(404);
    const reprobe = await app.request('/v1/orders/any/reprobe', { method: 'POST' });
    expect(reprobe.status).toBe(404);
  });

  it('reads stay open BY DESIGN (registry doctor probes tokenless — IMP-007)', async () => {
    const app = failClosedApp();
    const order = await app.request('/v1/orders/does-not-exist');
    expect(order.status).toBe(404); // route mounted; 404 = unknown id, not missing route

    const healthz = await app.request('/healthz');
    expect(healthz.status).toBe(200);
    const body = (await healthz.json()) as Record<string, unknown>;
    expect(body.write_routes).toBe('disabled_no_token');
    expect(body.ok).toBe(true);
  });
});
