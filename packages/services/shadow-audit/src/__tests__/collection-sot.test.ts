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
      registryFromEnv: (raw) => {
        const map = JSON.parse(raw);
        const chains = new Set<string>(['80094']);
        return {
          registry: ({ chain, contract }) => map[`${chain}/${contract}`],
          chains,
        };
      },
    });
    expect(r.registry({ chain: '80094', contract: '0xabc' })).toEqual({ collection: 'legacy', standard: 'erc721' });
  });

  it('a malformed/missing snapshot FAILS LOUD (never fail-open to empty)', () => {
    expect(() => loadRegistry({ registryFromEnv: () => ({ registry: () => undefined, chains: new Set() }) })).toThrow(/no collection source/);
    expect(() =>
      loadRegistry({ snapshotJson: '{not json', registryFromEnv: () => ({ registry: () => undefined, chains: new Set() }) }),
    ).toThrow(/not valid JSON/);
  });
});
