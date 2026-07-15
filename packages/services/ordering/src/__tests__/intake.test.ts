import { describe, it, expect } from 'vitest';
import { createIntakeApp } from '../intake.js';
import { InMemoryOrderStore } from '../store.js';

function harness() {
  const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const app = createIntakeApp({ store, now: () => 1_700_000_000_000 });
  return { store, app };
}

const VALID_BODY = {
  product: 'access-risk-audit',
  placed_by: 'operator:test',
  inputs: { chain: '1', contract: '0x' + '2'.repeat(40), snapshot_date: '2026-06-01', threshold: 1 },
};

const VALID_COMMUNITY_BODY = {
  product: 'community-onboarding',
  placed_by: 'dashboard_onboarding',
  inputs: {
    chain_id: '8453',
    contract_address: '0x1234567890123456789012345678901234567890',
    contact_email: 'cm@example.com',
    community_name: 'Pythenians',
    source: 'dashboard_onboarding',
  },
};

const VALID_GATE_LEAK_BODY = {
  product: 'gate-leak',
  placed_by: 'anonymous',
  inputs: {
    chain_id: '1',
    contract_address: '0x1234567890123456789012345678901234567890',
    source: 'public_gate_leak',
  },
};

describe('order-intake POST /v1/orders', () => {
  it('accepts a valid order → 200 { order_id } and persists placed + enqueues placed.v1', async () => {
    const { store, app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { order_id: string };
    expect(json.order_id).toBeTruthy();

    const record = await store.get(json.order_id);
    expect(record?.state).toBe('placed');
    const pending = await store.pendingOutbox();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.subject).toBe('orders.lifecycle.placed.v1');
  });

  it('rejects an unknown product → 400 and emits NO event', async () => {
    const { store, app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, product: 'not-a-product' }),
    });
    expect(res.status).toBe(400);
    expect(await store.pendingOutbox()).toHaveLength(0);
  });

  it('rejects inputs that fail the preset schema → 400 and emits NO event', async () => {
    const { store, app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // snapshot_date is not YYYY-MM-DD → preset.inputSchema rejects
      body: JSON.stringify({ ...VALID_BODY, inputs: { chain: '1', contract: '0x' + '2'.repeat(40), snapshot_date: 'yesterday' } }),
    });
    expect(res.status).toBe(400);
    expect(await store.pendingOutbox()).toHaveLength(0);
  });

  it('rejects a non-JSON body → 400', async () => {
    const { app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('accepts community-onboarding → 200 and seeds initial ingredients', async () => {
    const { store, app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_COMMUNITY_BODY),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { order_id: string };
    const record = await store.get(json.order_id);
    expect(record?.product).toBe('community-onboarding');
    expect(record?.ingredients).toEqual({
      sonar: 'pending',
      score: 'pending',
      metadata_snapshot: 'pending',
      worlds_manifest: 'pending',
      discord_observer: 'optional',
      shadow_preview: 'blocked',
    });
  });

  it('rejects community-onboarding with invalid email → 400 and emits NO event', async () => {
    const { store, app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...VALID_COMMUNITY_BODY,
        inputs: { ...VALID_COMMUNITY_BODY.inputs, contact_email: 'bad' },
      }),
    });
    expect(res.status).toBe(400);
    expect(await store.pendingOutbox()).toHaveLength(0);
  });

  it('accepts anonymous gate-leak intake with no account, wallet, or contact field', async () => {
    const { store, app } = harness();
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_GATE_LEAK_BODY),
    });
    expect(res.status).toBe(200);
    const { order_id: orderId } = (await res.json()) as { order_id: string };
    const record = await store.get(orderId);
    expect(record?.product).toBe('gate-leak');
    expect(record?.inputs).toEqual(VALID_GATE_LEAK_BODY.inputs);
    expect(JSON.stringify(record)).not.toContain('contact_email');
  });

  it('refuses gate-leak before persistence when the production composition is incomplete', async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const app = createIntakeApp({
      store,
      now: () => 1_700_000_000_000,
      gateLeakEnabled: false,
    });
    const res = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_GATE_LEAK_BODY),
    });
    expect(res.status).toBe(503);
    expect(await store.pendingOutbox()).toHaveLength(0);
  });
});

describe('order-intake GET /v1/orders/:id', () => {
  it('returns the order state for a known id', async () => {
    const { app } = harness();
    const placed = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    const { order_id } = (await placed.json()) as { order_id: string };

    const res = await app.request(`/v1/orders/${order_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order_id: string; state: string; product: string };
    expect(body.order_id).toBe(order_id);
    expect(body.state).toBe('placed');
    expect(body.product).toBe('access-risk-audit');
  });

  it('returns 404 for an unknown id', async () => {
    const { app } = harness();
    const res = await app.request('/v1/orders/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns ingredients + updated_at_unix for community-onboarding', async () => {
    const { app } = harness();
    const placed = await app.request('/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_COMMUNITY_BODY),
    });
    const { order_id } = (await placed.json()) as { order_id: string };

    const res = await app.request(`/v1/orders/${order_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order_id: string;
      state: string;
      product: string;
      updated_at_unix: number;
      ingredients: Record<string, string>;
    };
    expect(body.product).toBe('community-onboarding');
    expect(body.updated_at_unix).toBe(1_700_000_000);
    expect(body.ingredients.shadow_preview).toBe('blocked');
  });
});
