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
  inputs: { chain: 'ethereum', contract: '0xCollection', snapshot_date: '2026-06-01', threshold: 1 },
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
      body: JSON.stringify({ ...VALID_BODY, inputs: { chain: 'ethereum', contract: '0xC', snapshot_date: 'yesterday' } }),
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
});
