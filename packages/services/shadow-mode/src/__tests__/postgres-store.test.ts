/**
 * PostgresLedgerStore integration tests (SDD 6b-2 ACs).
 * Gated behind PG_TEST_URL (sprint plan: no testcontainers in this repo) —
 * skipped LOUD when absent so a green suite can never imply pg coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { PostgresLedgerStore } from '../adapters/postgres-store.js';
import { testGrant } from '../auth/append-grant.js';
import { ChainFrozenError } from '../chain.js';
import type { ShadowObservation } from '@freeside/shadow-mode-protocol';

const PG_TEST_URL = process.env.PG_TEST_URL;

function obs(eventId: string, community: string): ShadowObservation {
  return {
    event_id: eventId,
    community_id: community,
    name: 'discord.member.snapshot.v1' as ShadowObservation['name'],
    source: 'discord' as ShadowObservation['source'],
    truth_status: 'observed' as ShadowObservation['truth_status'],
    observed_at: '2026-07-03T00:00:00.000Z',
    emitted_at: '2026-07-03T00:00:00.000Z',
    payload: { n: eventId },
    ingested_at: '2026-07-03T00:00:01.000Z',
  };
}

if (!PG_TEST_URL) {
  // eslint-disable-next-line no-console
  console.warn('⚠ postgres-store tests SKIPPED — set PG_TEST_URL to run them (SDD 6b-2 AC gate)');
}

describe.skipIf(!PG_TEST_URL)('PostgresLedgerStore (PG_TEST_URL)', () => {
  let pool: pg.Pool;
  let store: PostgresLedgerStore;
  const community = `t${Date.now().toString(36)}`;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_TEST_URL });
    store = new PostgresLedgerStore(pool);
    await store.migrate();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('appends build a verifiable chain with lazy genesis', async () => {
    expect(await store.appendObservationIfAbsent(obs('e1-' + community, community), testGrant())).toBe(true);
    expect(await store.appendObservationIfAbsent(obs('e2-' + community, community), testGrant())).toBe(true);
    expect((await store.getChainHead(community))?.seq).toBe(2);
    expect(await store.verifyChain(community)).toEqual({ ok: true, length: 3 });
  });

  it('duplicate event_id returns false, chain unextended', async () => {
    expect(await store.appendObservationIfAbsent(obs('e1-' + community, community), testGrant())).toBe(false);
    expect((await store.getChainHead(community))?.seq).toBe(2);
  });

  it('reserved genesis namespace rejected', async () => {
    await expect(
      store.appendObservationIfAbsent({ ...obs('x', community), event_id: `genesis:${community}` }, testGrant()),
    ).rejects.toThrow(/reserved/);
  });

  it('concurrent appends: no fork, no gap, one winner per seq', async () => {
    const c2 = `${community}-conc`;
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.appendObservationIfAbsent(obs(`c${i}-${c2}`, c2), testGrant())),
    );
    const verdict = await store.verifyChain(c2);
    expect(verdict).toEqual({ ok: true, length: 9 }); // genesis + 8
  });

  it('tampered payload → verify freezes → append rejected → clear refused until repaired', async () => {
    const c3 = `${community}-tam`;
    await store.appendObservationIfAbsent(obs(`t1-${c3}`, c3), testGrant());
    await pool.query(`update shadow_observations set payload = '{"n":"tampered"}' where event_id = $1`, [
      `t1-${c3}`,
    ]);
    const verdict = await store.verifyChain(c3);
    expect(verdict.ok).toBe(false);
    expect(await store.isChainFrozen(c3)).toBe(true);
    await expect(store.appendObservationIfAbsent(obs(`t2-${c3}`, c3), testGrant())).rejects.toThrow(ChainFrozenError);
    await expect(store.clearChainFreeze(c3, 'operator', 'premature')).rejects.toThrow(/clear refused/);
    await pool.query(`update shadow_observations set payload = $2 where event_id = $1`, [
      `t1-${c3}`,
      JSON.stringify({ n: `t1-${c3}` }),
    ]);
    await store.clearChainFreeze(c3, 'operator', 'payload restored');
    expect(await store.isChainFrozen(c3)).toBe(false);
    expect(await store.appendObservationIfAbsent(obs(`t2-${c3}`, c3), testGrant())).toBe(true);
  });

  it('boot gate: assertChainsVerified passes on healthy chains', async () => {
    await expect(store.assertChainsVerified()).resolves.toBeUndefined();
  });
});
