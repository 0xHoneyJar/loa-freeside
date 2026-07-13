import { describe, expect, it } from 'vitest';
import {
  buildRegistryFromSnapshot,
  loadRegistry,
  type RatifiedSnapshot,
} from '../collection-sot.js';

const MIBERA = { chain: '80094', contract: '0x6666397dfe9a8c469bf65dc744cb1c733416c420' };
const PURU = { chain: '8453', contract: '0x6cfb9280767a3596ee6af887d900014a755ffc75' };

function snap(entities: RatifiedSnapshot['entities']): RatifiedSnapshot {
  return { schema_version: 'collections.snapshot.v1', entities };
}

describe('shadow-audit settle gate — collapse onto the ratified ledger (S3-T2, G-4)', () => {
  it('serves a fully-ratified, coherent collection', () => {
    const r = buildRegistryFromSnapshot(
      snap([
        { ...MIBERA, collection_key: 'mibera', token_standard: 'erc721', world: 'mibera', world_validated: true, contested: false },
      ]),
    );
    const ref = r.registry({ chain: '80094', contract: MIBERA.contract });
    expect(ref).toEqual({ collection: 'mibera', standard: 'erc721' });
    expect(r.included).toContain('80094:' + MIBERA.contract);
  });

  it('FAIL-CLOSED: an unratified world is NEVER served', () => {
    const r = buildRegistryFromSnapshot(
      snap([
        { ...MIBERA, collection_key: 'mibera', token_standard: 'erc721', world: 'mibera', world_validated: false, contested: false },
      ]),
    );
    expect(r.registry({ chain: '80094', contract: MIBERA.contract })).toBeUndefined();
    expect(r.excluded['80094:' + MIBERA.contract]).toBe('unratified_world');
  });

  it('FAIL-CLOSED: unknown standard and contested labels are never served', () => {
    const r = buildRegistryFromSnapshot(
      snap([
        { ...MIBERA, collection_key: 'mibera', token_standard: 'unknown', world: 'mibera', world_validated: true, contested: false },
        { ...PURU, collection_key: 'puru-apiculture', token_standard: 'erc1155', world: 'purupuru', world_validated: true, contested: true },
      ]),
    );
    expect(r.included).toHaveLength(0);
    expect(r.excluded['80094:' + MIBERA.contract]).toBe('unknown_standard');
    expect(r.excluded['8453:' + PURU.contract]).toBe('contested');
  });

  it('KILL-TEST (G-4): with NO env, the snapshot serves the ratified set; unratified excluded', () => {
    const snapshotJson = JSON.stringify(
      snap([
        { ...MIBERA, collection_key: 'mibera', token_standard: 'erc721', world: 'mibera', world_validated: true, contested: false },
        { ...PURU, collection_key: 'puru-apiculture', token_standard: 'erc1155', world: 'purupuru', world_validated: false, contested: false },
      ]),
    );
    const r = loadRegistry({
      snapshotJson,
      registryFromEnv: () => {
        throw new Error('env path must NOT be taken when no COLLECTION_REGISTRY is set');
      },
    });
    expect(r.registry({ chain: '80094', contract: MIBERA.contract })).toEqual({ collection: 'mibera', standard: 'erc721' });
    expect(r.registry({ chain: '8453', contract: PURU.contract })).toBeUndefined(); // unratified world
  });

  it('env COLLECTION_REGISTRY still overrides (deprecated break-glass, back-compat)', () => {
    const r = loadRegistry({
      envRegistry: '{"80094/0xabc": {"collection":"legacy","standard":"erc721"}}',
      registryFromEnv: (raw) => ({ map: JSON.parse(raw), chains: new Set<string>(['80094']) }),
    });
    expect(r.registry({ chain: '80094', contract: '0xabc' })).toEqual({ collection: 'legacy', standard: 'erc721' });
    // The env path builds the SAME index as the ratified path — one collection, one deployment.
    expect(r.sources({ chain: '80094', contract: '0xabc' })).toEqual([{ chain: '80094', contract: '0xabc' }]);
  });

  it('a malformed/missing snapshot FAILS LOUD (never fail-open to empty)', () => {
    expect(() => loadRegistry({ registryFromEnv: () => ({ map: {}, chains: new Set() }) })).toThrow(/no collection source/);
    expect(() =>
      loadRegistry({ snapshotJson: '{not json', registryFromEnv: () => ({ map: {}, chains: new Set() }) }),
    ).toThrow(/not valid JSON/);
  });
});

/**
 * S5-T3 — the settle gate must gate the COLLECTION, not the row.
 *
 * A collection is the UNION of its deployments. Serving "the ratified subset" of a bridged collection hands
 * the audit a PARTIAL union — and a partial union silently brands every holder on the withheld chain as
 * stale access. The per-row gate was correct when a collection was one row; it is a leak now.
 */
describe('shadow-audit settle gate — multi-source collections (S5-T3)', () => {
  const HC_ETH = { chain: '1', contract: '0x' + 'a'.repeat(40) };
  const HC_BERA = { chain: '80094', contract: '0x' + 'b'.repeat(40) };

  it('groups a collection deployed on two chains into ONE source set (either addresses both)', () => {
    const r = buildRegistryFromSnapshot(
      snap([
        { ...HC_ETH, collection_key: 'honeycomb', token_standard: 'erc721', world: 'thj', world_validated: true, contested: false },
        { ...HC_BERA, collection_key: 'honeycomb', token_standard: 'erc721', world: 'thj', world_validated: true, contested: false },
      ]),
    );
    const expected = [
      { chain: '1', contract: HC_ETH.contract },
      { chain: '80094', contract: HC_BERA.contract },
    ];
    // Addressing EITHER deployment resolves the collection's FULL source set — that is what makes a
    // berachain-addressed audit see the 2,280 ethereum holders it used to call stale.
    expect(r.sources(HC_BERA)).toEqual(expected);
    expect(r.sources(HC_ETH)).toEqual(expected);
    expect(r.included).toHaveLength(2);
  });

  it('FAIL-CLOSED: one unservable deployment withholds the WHOLE collection (never a partial union)', () => {
    const r = buildRegistryFromSnapshot(
      snap([
        { ...HC_ETH, collection_key: 'honeycomb', token_standard: 'erc721', world: 'thj', world_validated: true, contested: true },
        { ...HC_BERA, collection_key: 'honeycomb', token_standard: 'erc721', world: 'thj', world_validated: true, contested: false },
      ]),
    );
    // The bera row is individually ratified — but serving it ALONE is a partial union of Honeycomb, which
    // would report every ethereum holder as stale. Withhold both; refusing is recoverable, wrong is not.
    expect(r.registry(HC_BERA)).toBeUndefined();
    expect(r.registry(HC_ETH)).toBeUndefined();
    expect(r.included).toHaveLength(0);
    expect(r.excluded['1:' + HC_ETH.contract]).toBe('contested');
    expect(r.excluded['80094:' + HC_BERA.contract]).toContain('partial_union');
  });

  it('an unrelated collection is unaffected by another collection being withheld', () => {
    const r = buildRegistryFromSnapshot(
      snap([
        { ...HC_ETH, collection_key: 'honeycomb', token_standard: 'unknown', world: 'thj', world_validated: true, contested: false },
        { ...MIBERA, collection_key: 'mibera', token_standard: 'erc721', world: 'mibera', world_validated: true, contested: false },
      ]),
    );
    expect(r.registry(HC_ETH)).toBeUndefined();
    expect(r.sources({ chain: '80094', contract: MIBERA.contract })).toEqual([
      { chain: '80094', contract: MIBERA.contract },
    ]);
  });
});
