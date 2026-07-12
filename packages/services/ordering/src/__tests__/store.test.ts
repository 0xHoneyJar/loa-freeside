import { describe, it, expect } from 'vitest';
import { InMemoryOrderStore, OrderNotFoundError, type NewOrder, type OutboxEvent } from '../store.js';
import { IllegalTransitionError } from '../order-state.js';

const NEW_ORDER: NewOrder = {
  order_id: 'ord_1',
  product: 'access-risk-audit',
  placed_by: 'operator:test',
  inputs: { chain: 'ethereum', contract: '0xabc', snapshot_date: '2026-06-01' },
  placed_at_unix: 1_700_000_000,
  inputs_digest: 'a'.repeat(64),
};
const PLACED_EVENT: OutboxEvent = { subject: 'orders.lifecycle.placed.v1', payload: { order_id: 'ord_1' } };

function store() {
  return new InMemoryOrderStore({ now: () => 1_700_000_000 });
}

describe('InMemoryOrderStore', () => {
  it('persists a placed order + enqueues the placed event', async () => {
    const s = store();
    const { created, record } = await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    expect(created).toBe(true);
    expect(record.state).toBe('placed');
    const pending = await s.pendingOutbox();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.subject).toBe('orders.lifecycle.placed.v1');
  });

  it('placeOrder is idempotent on order_id (no duplicate record or event)', async () => {
    const s = store();
    await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    const second = await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    expect(second.created).toBe(false);
    expect(await s.pendingOutbox()).toHaveLength(1);
  });

  it('transition is a CAS: succeeds from the expected state, atomically enqueues its event', async () => {
    const s = store();
    await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    const r = await s.transition('ord_1', 'placed', 'routing', {
      patch: { recipe_id: 'access-risk-audit' },
      event: { subject: 'orders.lifecycle.routing.v1', payload: { order_id: 'ord_1' } },
    });
    expect(r.ok).toBe(true);
    expect(r.record?.state).toBe('routing');
    expect(r.record?.recipe_id).toBe('access-risk-audit');
    expect(await s.pendingOutbox()).toHaveLength(2); // placed + routing
  });

  it('transition CAS MISSES when current state != expectedFrom (the idempotency guard)', async () => {
    const s = store();
    await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    await s.transition('ord_1', 'placed', 'routing');
    // a redelivery tries to claim placed→routing again, but state is already routing
    const second = await s.transition('ord_1', 'placed', 'routing', {
      event: { subject: 'orders.lifecycle.routing.v1', payload: {} },
    });
    expect(second.ok).toBe(false);
    expect((await s.get('ord_1'))?.state).toBe('routing');
    // the losing claim did NOT enqueue a duplicate routing event
    expect(await s.pendingOutbox()).toHaveLength(1); // only the placed event (the winning routing had no event)
  });

  it('transition throws IllegalTransitionError on an illegal (from→to) pair', async () => {
    const s = store();
    await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    await expect(s.transition('ord_1', 'placed', 'fulfilled')).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('transition / appendEvent throw OrderNotFoundError for an unknown order', async () => {
    const s = store();
    await expect(s.transition('nope', 'placed', 'routing')).rejects.toBeInstanceOf(OrderNotFoundError);
    await expect(s.appendEvent('nope', PLACED_EVENT)).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it('appendEvent enqueues without a state change (for producing events)', async () => {
    const s = store();
    await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    await s.transition('ord_1', 'placed', 'routing');
    await s.transition('ord_1', 'routing', 'producing');
    await s.appendEvent('ord_1', { subject: 'orders.lifecycle.producing.v1', payload: { step: 0 } });
    expect((await s.get('ord_1'))?.state).toBe('producing');
    const subjects = (await s.pendingOutbox()).map((e) => e.subject);
    expect(subjects).toContain('orders.lifecycle.producing.v1');
  });

  it('markPublished removes an entry from the pending set', async () => {
    const s = store();
    await s.placeOrder(NEW_ORDER, PLACED_EVENT);
    const [entry] = await s.pendingOutbox();
    await s.markPublished(entry!.seq);
    expect(await s.pendingOutbox()).toHaveLength(0);
  });
});
