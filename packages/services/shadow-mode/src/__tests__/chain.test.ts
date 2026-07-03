import { describe, expect, it } from 'vitest';
import {
  CHAIN_VERSION,
  ChainFrozenError,
  GENESIS_PREV_HASH,
  chainLink,
  computeLinkHash,
  genesisObservation,
  verifyChain,
} from '../chain.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import type { ShadowObservation } from '@freeside/shadow-mode-protocol';

function obs(eventId: string, community = 'azuki'): ShadowObservation {
  return {
    event_id: eventId,
    community_id: community,
    name: 'member.joined' as ShadowObservation['name'],
    source: 'discord' as ShadowObservation['source'],
    truth_status: 'observed' as ShadowObservation['truth_status'],
    observed_at: '2026-07-03T00:00:00.000Z',
    emitted_at: '2026-07-03T00:00:00.000Z',
    payload: { n: eventId },
    ingested_at: '2026-07-03T00:00:01.000Z',
  };
}

function buildChain(n: number) {
  const store = new Map<string, ShadowObservation>();
  const genesis = genesisObservation('azuki', '2026-07-03T00:00:00.000Z');
  store.set(genesis.event_id, genesis);
  const links = [chainLink('azuki', null, genesis)];
  for (let i = 1; i <= n; i++) {
    const o = obs(`e${i}`);
    store.set(o.event_id, o);
    links.push(chainLink('azuki', links[links.length - 1] ?? null, o));
  }
  return { links, store };
}

describe('chainLink / verifyChain (pure)', () => {
  it('genesis anchors at the zero hash and seq 0', async () => {
    const { links } = buildChain(0);
    expect(links[0]!.seq).toBe(0);
    expect(links[0]!.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(links[0]!.chain_version).toBe(CHAIN_VERSION);
  });

  it('replay determinism: rebuilding the same chain reproduces every hash byte-exactly', async () => {
    const a = buildChain(5);
    const b = buildChain(5);
    expect(a.links.map((l) => l.hash)).toEqual(b.links.map((l) => l.hash));
  });

  it('verifies a valid chain', async () => {
    const { links, store } = buildChain(5);
    expect(verifyChain(links, (id) => store.get(id))).toEqual({ ok: true, length: 6 });
  });

  it('tamper: one mutated payload byte fails at exactly that seq', async () => {
    const { links, store } = buildChain(5);
    (store.get('e3')!.payload as { n: string }).n = 'e3-tampered';
    const verdict = verifyChain(links, (id) => store.get(id));
    expect(verdict).toEqual({ ok: false, first_bad_seq: 3, reason: 'hash_mismatch' });
  });

  it('tamper: a rewritten link hash breaks linkage at the NEXT seq', async () => {
    const { links, store } = buildChain(3);
    const forged = { ...links[2]!, hash: 'f'.repeat(64) };
    const verdict = verifyChain([links[0]!, links[1]!, forged, links[3]!], (id) => store.get(id));
    // forged seq-2 hash itself mismatches recomputation first
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.first_bad_seq).toBe(2);
  });

  it('seq gap detected', async () => {
    const { links, store } = buildChain(3);
    const verdict = verifyChain([links[0]!, links[2]!, links[3]!], (id) => store.get(id));
    expect(verdict).toEqual({ ok: false, first_bad_seq: 2, reason: 'seq_gap' });
  });

  it('version bump changes the hash (version is inside the hashed bytes)', async () => {
    const g = genesisObservation('azuki', '2026-07-03T00:00:00.000Z');
    const h1 = computeLinkHash('azuki', 0, GENESIS_PREV_HASH, g, 'shadow.chain.v1');
    const h2 = computeLinkHash('azuki', 0, GENESIS_PREV_HASH, g, 'shadow.chain.v2');
    expect(h1).not.toBe(h2);
  });
});

describe('InMemoryLedgerStore chain integration', () => {
  it('appends build a verifiable chain with lazy genesis', async () => {
    const store = new InMemoryLedgerStore();
    await store.appendObservationIfAbsent(obs('e1'));
    await store.appendObservationIfAbsent(obs('e2'));
    expect((await store.getChainHead('azuki'))?.seq).toBe(2);
    expect(await store.verifyChain('azuki')).toEqual({ ok: true, length: 3 });
  });

  it('duplicate event_id is idempotent-false and does not extend the chain', async () => {
    const store = new InMemoryLedgerStore();
    expect(await store.appendObservationIfAbsent(obs('e1'))).toBe(true);
    expect(await store.appendObservationIfAbsent(obs('e1'))).toBe(false);
    expect((await store.getChainHead('azuki'))?.seq).toBe(1);
  });

  it('tamper → verify freezes → appends rejected → operator clear reopens', async () => {
    const store = new InMemoryLedgerStore();
    await store.appendObservationIfAbsent(obs('e1'));
    store.unsafeMutateObservationForTest('e1', (o) => {
      (o.payload as { n: string }).n = 'tampered';
    });
    const verdict = await store.verifyChain('azuki');
    expect(verdict.ok).toBe(false);
    expect(await store.isChainFrozen('azuki')).toBe(true);
    await expect(store.appendObservationIfAbsent(obs('e2'))).rejects.toThrow(ChainFrozenError);
    // hardened behavior: clear requires the chain to verify green — repair first
    store.unsafeMutateObservationForTest('e1', (o) => {
      (o.payload as { n: string }).n = 'e1';
    });
    await store.clearChainFreeze('azuki', 'operator', 'test recovery — payload restored');
    expect(await store.isChainFrozen('azuki')).toBe(false);
  });

  it('chains are per-community (independent genesis + seq)', async () => {
    const store = new InMemoryLedgerStore();
    await store.appendObservationIfAbsent(obs('a1', 'azuki'));
    await store.appendObservationIfAbsent(obs('m1', 'mibera'));
    expect((await store.getChainHead('azuki'))?.seq).toBe(1);
    expect((await store.getChainHead('mibera'))?.seq).toBe(1);
    expect(await store.verifyChain('mibera')).toEqual({ ok: true, length: 2 });
  });
});

describe('FAGAN hardening (sprint-1 review)', () => {
  it("rejects user observations in the reserved genesis: namespace", async () => {
    const store = new InMemoryLedgerStore();
    await expect(
      store.appendObservationIfAbsent({ ...obs('x'), event_id: 'genesis:azuki' }),
    ).rejects.toThrow(/reserved/);
  });

  it('clear is refused while the chain still fails verification', async () => {
    const store = new InMemoryLedgerStore();
    await store.appendObservationIfAbsent(obs('e1'));
    store.unsafeMutateObservationForTest('e1', (o) => {
      (o.payload as { n: string }).n = 'tampered';
    });
    await store.verifyChain('azuki');
    await expect(store.clearChainFreeze('azuki', 'operator', 'premature')).rejects.toThrow(/clear refused/);
    // repair the payload, then the clear succeeds
    store.unsafeMutateObservationForTest('e1', (o) => {
      (o.payload as { n: string }).n = 'e1';
    });
    await store.clearChainFreeze('azuki', 'operator', 'payload restored');
    expect(await store.isChainFrozen('azuki')).toBe(false);
    await expect(store.appendObservationIfAbsent(obs('e2'))).resolves.toBe(true);
  });

  it('append freezes on a tampered HEAD without an explicit verify call', async () => {
    const store = new InMemoryLedgerStore();
    await store.appendObservationIfAbsent(obs('e1'));
    store.unsafeMutateObservationForTest('e1', (o) => {
      (o.payload as { n: string }).n = 'tampered';
    });
    await expect(store.appendObservationIfAbsent(obs('e2'))).rejects.toThrow(ChainFrozenError);
    expect(await store.isChainFrozen('azuki')).toBe(true);
  });

  it('withTransaction serializes concurrent units of work', async () => {
    const store = new InMemoryLedgerStore();
    const order: number[] = [];
    await Promise.all([
      store.withTransaction(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 10));
        order.push(2);
      }),
      store.withTransaction(async () => {
        order.push(3);
      }),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });
});
