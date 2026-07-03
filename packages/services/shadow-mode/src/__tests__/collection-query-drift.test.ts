import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectionEntityId } from '@freeside/shadow-mode-protocol';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { collectionProducerGrant } from '../auth/append-grant.js';
import { ground, type BeltCollection, type EthCall } from '../collections/distiller.js';
import { proposeAll } from '../collections/propose.js';
import { ratifyCollectionLabel } from '../collections/ratify.js';
import { queryCollections } from '../collections/query.js';
import { drift } from '../collections/drift.js';

const NOW = '2026-07-03T00:00:00.000Z';
const MIBERA = { collectionKey: 'mibera', chainId: '80094', contract: '0x6666397dfe9a8c469bf65dc744cb1c733416c420' };
const PURU = { collectionKey: 'puru_apiculture', chainId: '8453', contract: '0x6cfb9280767a3596ee6af887d900014a755ffc75' };
const T = '0x' + '0'.repeat(63) + '1';
const F = '0x' + '0'.repeat(64);
const mkEthCall = (erc1155: Set<string>): EthCall => async (_c, to, data) => {
  const is = erc1155.has(to.toLowerCase());
  if (data.includes('80ac58cd')) return is ? F : T;
  if (data.includes('d9b67a26')) return is ? T : F;
  return F;
};

async function seed(store: InMemoryLedgerStore, belt: BeltCollection[], erc1155: Set<string>) {
  const derived = await ground({ belt: async () => belt, ethCall: mkEthCall(erc1155) });
  await proposeAll(store, collectionProducerGrant(), derived, NOW);
}

function withGrant<T>(fn: (grantPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
  const grantPath = join(dir, '.recall-cockpit-grant');
  writeFileSync(grantPath, '');
  return fn(grantPath).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('collections query (S3-T1, SDD §5)', () => {
  it('matches by world / contract; carries a provenance badge', async () => {
    const store = new InMemoryLedgerStore();
    await seed(store, [MIBERA, PURU], new Set([PURU.contract]));
    const byWorld = await queryCollections(store, 'mibera');
    expect(byWorld.some((h) => h.collection_key === 'mibera')).toBe(true);
    expect(byWorld[0]!.badge).toBe('ai-derived'); // proposed, not yet ratified

    const byContract = await queryCollections(store, PURU.contract);
    expect(byContract).toHaveLength(1);
    expect(byContract[0]!.collection_key).toBe('puru-apiculture');
    expect(byContract[0]!.token_standard).toBe('erc1155');
  });

  it('operator-validated badge after ratify', async () => {
    const store = new InMemoryLedgerStore();
    await seed(store, [MIBERA], new Set());
    const id = collectionEntityId(MIBERA.chainId, MIBERA.contract)!;
    await withGrant((grantPath) =>
      ratifyCollectionLabel(store, collectionProducerGrant(), { entity_id: id, label: 'world', value: 'mibera', ratified_by: 'operator' }, NOW, { grantPath }),
    );
    const hits = await queryCollections(store, 'mibera');
    expect(hits[0]!.badge).toBe('operator-validated');
  });

  it('withholds a contested entity unless --show-contested', async () => {
    const store = new InMemoryLedgerStore();
    const grant = collectionProducerGrant();
    await seed(store, [MIBERA], new Set());
    const id = collectionEntityId(MIBERA.chainId, MIBERA.contract)!;
    await withGrant((grantPath) =>
      ratifyCollectionLabel(store, grant, { entity_id: id, label: 'world', value: 'mibera', ratified_by: 'operator' }, NOW, { grantPath }),
    );
    // a NEW post-ratify derive disagrees → contested
    const { collectionLabelObserved } = await import('@freeside/shadow-mode-protocol');
    await store.appendObservationIfAbsent(collectionLabelObserved(MIBERA.chainId, MIBERA.contract, 'world', 'apdao', NOW)!, grant);

    expect(await queryCollections(store, 'mibera')).toHaveLength(0); // withheld
    expect((await queryCollections(store, 'mibera', { showContested: true })).length).toBeGreaterThan(0);
  });
});

describe('collections drift (S3-T3, SDD §8)', () => {
  it('a changed DERIVED standard → drifted + auto-overwritten (ground truth wins)', async () => {
    const store = new InMemoryLedgerStore();
    await seed(store, [MIBERA], new Set()); // starts erc721
    // re-derive with mibera now answering erc1155
    const report = await drift(store, collectionProducerGrant(), { belt: async () => [MIBERA], ethCall: mkEthCall(new Set([MIBERA.contract])) }, '2026-07-04T00:00:00.000Z');
    const f = report.findings.find((x) => x.entity_id === collectionEntityId(MIBERA.chainId, MIBERA.contract));
    expect(f!.class).toBe('drifted');
    const entity = await store.getCollectionEntity(collectionEntityId(MIBERA.chainId, MIBERA.contract)!);
    expect(entity!.labels.token_standard).toBe('erc1155'); // overwritten
  });

  it('an orphaned entity (no longer belt-tracked) → orphaned + failed', async () => {
    const store = new InMemoryLedgerStore();
    await seed(store, [MIBERA], new Set());
    const report = await drift(store, collectionProducerGrant(), { belt: async () => [], ethCall: mkEthCall(new Set()) }, NOW);
    expect(report.findings.some((f) => f.class === 'orphaned')).toBe(true);
    expect(report.failed).toBe(true);
  });

  it('a ratified world that a NEW re-derive disagrees with → contested + failed (never overwritten)', async () => {
    const store = new InMemoryLedgerStore();
    const grant = collectionProducerGrant();
    await seed(store, [MIBERA], new Set()); // world proposed = mibera (heuristic)
    const id = collectionEntityId(MIBERA.chainId, MIBERA.contract)!;
    await withGrant((grantPath) =>
      ratifyCollectionLabel(store, grant, { entity_id: id, label: 'world', value: 'mibera', ratified_by: 'operator' }, NOW, { grantPath }),
    );
    // the reverse worlds-lookup now returns a DIFFERENT binding (a genuine, novel drift)
    const report = await drift(
      store,
      grant,
      { belt: async () => [MIBERA], ethCall: mkEthCall(new Set()), lookupWorld: async () => 'purupuru' },
      '2026-07-04T00:00:00.000Z',
    );
    const entity = await store.getCollectionEntity(id);
    expect(entity!.labels.world).toBe('mibera'); // operator truth preserved
    expect(entity!.provenance.find((p) => p.label === 'world')!.contested).toBe(true);
    expect(report.failed).toBe(true);
  });
});
