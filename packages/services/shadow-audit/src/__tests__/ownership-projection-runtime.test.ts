import { describe, it, expect } from 'vitest';
import { makeOwnershipProjectionRuntime, type SubscribeActivities } from '../ownership-projection-runtime.js';
import type { OwnershipSource } from '../audit-service.js';
import type { OwnershipActivity } from '../ownership-projection-subscriber.js';

const W = (n: string) => '0x' + n.repeat(40);
const A = W('a'), B = W('b'), R1 = W('1'), R2 = W('2');
const CHAIN = 'ethereum';

// a fake @freeside/events subscriber — captures the handler so the test can feed the worldline.
let feed: (a: OwnershipActivity) => void = () => {};
const fakeSubscribe: SubscribeActivities = async (_subject, handler) => {
  feed = handler;
  return { stop: async () => {} };
};
// the fallback (raw sonar) returns a DIFFERENT picture (only R1) than the events (R2) — so the test can tell
// which source the audit actually read.
const fallback: OwnershipSource = {
  resolveSnapshotBlock: async () => 999,
  balancesAt: async () => new Map([[R1, 1n]]),
  currentBalances: async () => new Map([[R1, 1n]]),
};
let mintN = 0;
const mint = (to: string, contract: string, block: number): OwnershipActivity => ({
  verb: 'mint', from: null, to, value: '1', timestamp: '2026-06-20T00:00:00Z', tx: `0xtx${++mintN}`,
  metadata: { chain: 'evm', chain_id: 1, contract, block_number: block, log_index: 0 },
});
const keys = async (src: OwnershipSource, contract: string) =>
  [...(await src.currentBalances({ chain: CHAIN, contract })).keys()];

describe('OwnershipProjectionRuntime — shadow-then-cutover migration (the safe wire)', () => {
  it('SHADOW (not cutover): the audit reads RAW SONAR even though events fed the projection', async () => {
    const rt = makeOwnershipProjectionRuntime({ subscribe: fakeSubscribe, fallback, isCutover: () => false });
    await rt.start();
    feed(mint(R2, A, 100)); // an ownership.changed event arrives → projection holds R2
    expect(await keys(rt.source, A)).toEqual([R1]); // …but the audit still reads sonar's picture (shadow)
  });

  it('CUTOVER: the audit reads the event-fed SPINE, not sonar', async () => {
    const rt = makeOwnershipProjectionRuntime({ subscribe: fakeSubscribe, fallback, isCutover: () => true });
    await rt.start();
    feed(mint(R2, A, 100));
    expect(await keys(rt.source, A)).toEqual([R2]); // the spine's picture — the cutover flipped one bit
  });

  it('per-collection cutover — A on the spine, B still on sonar (reversible, one collection at a time)', async () => {
    const rt = makeOwnershipProjectionRuntime({ subscribe: fakeSubscribe, fallback, isCutover: (_c, contract) => contract === A });
    await rt.start();
    feed(mint(R2, A, 100));
    expect(await keys(rt.source, A)).toEqual([R2]); // A cutover → spine
    expect(await keys(rt.source, B)).toEqual([R1]); // B shadow → sonar
  });
});
