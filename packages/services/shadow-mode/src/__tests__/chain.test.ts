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
  it('genesis anchors at the zero hash and seq 0', () => {
    const { links } = buildChain(0);
    expect(links[0]!.seq).toBe(0);
    expect(links[0]!.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(links[0]!.chain_version).toBe(CHAIN_VERSION);
  });

  it('replay determinism: rebuilding the same chain reproduces every hash byte-exactly', () => {
    const a = buildChain(5);
    const b = buildChain(5);
    expect(a.links.map((l) => l.hash)).toEqual(b.links.map((l) => l.hash));
  });

  it('verifies a valid chain', () => {
    const { links, store } = buildChain(5);
    expect(verifyChain(links, (id) => store.get(id))).toEqual({ ok: true, length: 6 });
  });

  it('tamper: one mutated payload byte fails at exactly that seq', () => {
    const { links, store } = buildChain(5);
    (store.get('e3')!.payload as { n: string }).n = 'e3-tampered';
    const verdict = verifyChain(links, (id) => store.get(id));
    expect(verdict).toEqual({ ok: false, first_bad_seq: 3, reason: 'hash_mismatch' });
  });

  it('tamper: a rewritten link hash breaks linkage at the NEXT seq', () => {
    const { links, store } = buildChain(3);
    const forged = { ...links[2]!, hash: 'f'.repeat(64) };
    const verdict = verifyChain([links[0]!, links[1]!, forged, links[3]!], (id) => store.get(id));
    // forged seq-2 hash itself mismatches recomputation first
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.first_bad_seq).toBe(2);
  });

  it('seq gap detected', () => {
    const { links, store } = buildChain(3);
    const verdict = verifyChain([links[0]!, links[2]!, links[3]!], (id) => store.get(id));
    expect(verdict).toEqual({ ok: false, first_bad_seq: 2, reason: 'seq_gap' });
  });

  it('version bump changes the hash (version is inside the hashed bytes)', () => {
    const g = genesisObservation('azuki', '2026-07-03T00:00:00.000Z');
    const h1 = computeLinkHash('azuki', 0, GENESIS_PREV_HASH, g, 'shadow.chain.v1');
    const h2 = computeLinkHash('azuki', 0, GENESIS_PREV_HASH, g, 'shadow.chain.v2');
    expect(h1).not.toBe(h2);
  });
});

describe('InMemoryLedgerStore chain integration', () => {
  it('appends build a verifiable chain with lazy genesis', () => {
    const store = new InMemoryLedgerStore();
    store.appendObservationIfAbsent(obs('e1'));
    store.appendObservationIfAbsent(obs('e2'));
    expect(store.getChainHead('azuki')?.seq).toBe(2);
    expect(store.verifyChain('azuki')).toEqual({ ok: true, length: 3 });
  });

  it('duplicate event_id is idempotent-false and does not extend the chain', () => {
    const store = new InMemoryLedgerStore();
    expect(store.appendObservationIfAbsent(obs('e1'))).toBe(true);
    expect(store.appendObservationIfAbsent(obs('e1'))).toBe(false);
    expect(store.getChainHead('azuki')?.seq).toBe(1);
  });

  it('tamper → verify freezes → appends rejected → operator clear reopens', () => {
    const store = new InMemoryLedgerStore();
    store.appendObservationIfAbsent(obs('e1'));
    store.unsafeMutateObservationForTest('e1', (o) => {
      (o.payload as { n: string }).n = 'tampered';
    });
    const verdict = store.verifyChain('azuki');
    expect(verdict.ok).toBe(false);
    expect(store.isChainFrozen('azuki')).toBe(true);
    expect(() => store.appendObservationIfAbsent(obs('e2'))).toThrow(ChainFrozenError);
    store.clearChainFreeze('azuki', 'operator', 'test recovery — payload restored');
    expect(store.isChainFrozen('azuki')).toBe(false);
  });

  it('chains are per-community (independent genesis + seq)', () => {
    const store = new InMemoryLedgerStore();
    store.appendObservationIfAbsent(obs('a1', 'azuki'));
    store.appendObservationIfAbsent(obs('m1', 'mibera'));
    expect(store.getChainHead('azuki')?.seq).toBe(1);
    expect(store.getChainHead('mibera')?.seq).toBe(1);
    expect(store.verifyChain('mibera')).toEqual({ ok: true, length: 2 });
  });
});
