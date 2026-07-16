/** Real-SQL proof for the gate-leak claim, prerequisite, join, and outbox transaction seams. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

import { PostgresOrderStore } from '../store-postgres.js';
import type { NewOrder } from '../store.js';

const CONTRACT = '0x' + 'c'.repeat(40);

function gateOrder(orderId: string): NewOrder {
  return {
    order_id: orderId,
    product: 'gate-leak',
    placed_by: 'anonymous',
    inputs: { chain_id: '1', contract_address: CONTRACT, source: 'public_gate_leak' },
    placed_at_unix: 1_700_000_000,
    inputs_digest: `${orderId}:immutable`,
  };
}

function communityOrder(orderId: string): NewOrder {
  return {
    order_id: orderId,
    product: 'community-onboarding',
    placed_by: 'operator:test',
    inputs: {
      chain_id: '1',
      contract_address: CONTRACT,
      contact_email: 'operator@example.test',
      source: 'dashboard_onboarding',
    },
    placed_at_unix: 1_700_000_000,
    inputs_digest: `${orderId}:immutable`,
  };
}

describe('PostgresOrderStore gate-leak lifecycle (real SQL)', () => {
  let store: PostgresOrderStore;
  let pglite: PGlite | undefined;
  let socket: PGLiteSocketServer | undefined;

  beforeAll(async () => {
    let url = process.env.ORDERING_TEST_DATABASE_URL;
    if (!url) {
      pglite = await PGlite.create();
      const port = 5944 + Math.floor(Date.now() % 400);
      socket = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1' });
      await socket.start();
      url = `postgres://postgres@127.0.0.1:${port}/postgres`;
    }
    store = await PostgresOrderStore.connect(url, { migrate: true });
  });

  afterAll(async () => {
    await store?.close();
    await socket?.stop();
    await pglite?.close();
  });

  it('dedupes shared work and append-only prerequisites under real constraints', async () => {
    await store.placeOrder(gateOrder('sql-gate-a'), {
      subject: 'orders.lifecycle.placed.v1',
      payload: { order_id: 'sql-gate-a' },
    });
    await store.placeOrder(gateOrder('sql-gate-b'), {
      subject: 'orders.lifecycle.placed.v1',
      payload: { order_id: 'sql-gate-b' },
    });
    expect((await store.claimGateLeakWork('sql-shared-work', 'sql-gate-a')).created).toBe(true);
    const second = await store.claimGateLeakWork('sql-shared-work', 'sql-gate-b');
    expect(second).toMatchObject({ created: false, claim: { canonical_order_id: 'sql-gate-a' } });

    const input = {
      gate_leak_order_id: 'sql-gate-a',
      input: 'access_started_at' as const,
      value: '2026-06-22',
      supplied_at_unix: 1_700_000_001,
    };
    const signal = {
      gate_leak_order_id: input.gate_leak_order_id,
      input: input.input,
      supplied_at_unix: input.supplied_at_unix,
    };
    expect(
      (await store.appendGateLeakInput(input, {
        subject: 'orders.gate-leak.input-supplied.v1',
        payload: signal,
      })).created,
    ).toBe(true);
    expect(
      (await store.appendGateLeakInput(input, {
        subject: 'orders.gate-leak.input-supplied.v1',
        payload: signal,
      })).created,
    ).toBe(false);
    await expect(
      store.appendGateLeakInput(
        { ...input, value: '2026-06-23' },
        { subject: 'orders.gate-leak.input-supplied.v1', payload: signal },
      ),
    ).rejects.toThrow(/conflicting/);
    expect(await store.getGateLeakInput('sql-gate-a')).toEqual(input);
    const producing = { subject: 'orders.lifecycle.producing.v1', payload: { step: 0 } };
    expect((await store.appendEventOnce('sql-gate-a', producing, 'sql-gate-a:producing:0')).created).toBe(true);
    expect((await store.appendEventOnce('sql-gate-a', producing, 'sql-gate-a:producing:0')).created).toBe(false);
  });

  it('joins orders without mutating either immutable input record', async () => {
    await store.placeOrder(communityOrder('sql-community'), {
      subject: 'orders.lifecycle.placed.v1',
      payload: { order_id: 'sql-community' },
    });
    const beforeGate = await store.get('sql-gate-a');
    const beforeCommunity = await store.get('sql-community');
    const join = {
      gate_leak_order_id: 'sql-gate-a',
      community_onboarding_order_id: 'sql-community',
      joined_at_unix: 1_700_000_002,
    };
    expect(
      (await store.appendGateLeakJoin(join, {
        subject: 'orders.gate-leak.community-joined.v1',
        payload: join,
      })).created,
    ).toBe(true);
    expect(
      (await store.appendGateLeakJoin(join, {
        subject: 'orders.gate-leak.community-joined.v1',
        payload: join,
      })).created,
    ).toBe(false);
    expect(await store.listGateLeakJoins('sql-gate-a')).toEqual([join]);
    expect((await store.get('sql-gate-a'))?.inputs_digest).toBe(beforeGate?.inputs_digest);
    expect((await store.get('sql-gate-a'))?.inputs).toEqual(beforeGate?.inputs);
    expect((await store.get('sql-community'))?.inputs_digest).toBe(beforeCommunity?.inputs_digest);
    expect((await store.get('sql-community'))?.inputs).toEqual(beforeCommunity?.inputs);
    const subjects = (await store.pendingOutbox()).map((entry) => entry.subject);
    expect(subjects.filter((subject) => subject === 'orders.gate-leak.input-supplied.v1')).toHaveLength(1);
    expect(subjects.filter((subject) => subject === 'orders.gate-leak.community-joined.v1')).toHaveLength(1);
  });

  it('enforces the anonymous order budget transactionally in real SQL', async () => {
    const budget = { bucket: 'tight-order-test', window_started_at: '2026-07-15T12:00:00.000Z', limit: 1 };
    const event = (id: string) => ({ subject: 'orders.lifecycle.placed.v1', payload: { order_id: id } });
    expect((await store.placeOrder(gateOrder('sql-budget-a'), event('sql-budget-a'), budget)).created).toBe(true);
    await expect(store.placeOrder(gateOrder('sql-budget-b'), event('sql-budget-b'), budget)).rejects.toThrow(/budget/);
    expect(await store.get('sql-budget-b')).toBeUndefined();
    expect((await store.pendingOutbox()).some((entry) => entry.order_id === 'sql-budget-b')).toBe(false);
  });
});
