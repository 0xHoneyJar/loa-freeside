import { describe, expect, it } from 'vitest';
import {
  ground,
  detectTokenStandard,
  normalizeCollectionKey,
  proposeWorldFromKey,
  decodeBool,
  ERC721_INTERFACE_ID,
  ERC1155_INTERFACE_ID,
  type BeltCollection,
  type EthCall,
} from '../collections/distiller.js';
import { proposeAll } from '../collections/propose.js';
import { InMemoryLedgerStore } from '../adapters/in-memory-store.js';
import { collectionProducerGrant } from '../auth/append-grant.js';

const NOW = '2026-07-03T00:00:00.000Z';

// A slice of the committed 24-collection proof (self-grounded-collections-registry.txt):
// erc721 on berachain/optimism, erc1155 on Base (puru).
const BELT_FIXTURE: BeltCollection[] = [
  { collectionKey: 'apdao_seat', chainId: '80094', contract: '0xfc2d7ebfeb2714fce13caf234a95db129ecc43da' },
  { collectionKey: 'mibera', chainId: '80094', contract: '0x6666397dfe9a8c469bf65dc744cb1c733416c420' },
  { collectionKey: 'lore_1_introducing_mibera', chainId: '10', contract: '0x6b31859e5e32a5212f1ba4d7b377604b9d4c7a60' },
  { collectionKey: 'puru_apiculture', chainId: '8453', contract: '0x6cfb9280767a3596ee6af887d900014a755ffc75' },
];

// erc1155 contracts (from the proof) — everything else answers erc721.
const ERC1155_CONTRACTS = new Set(['0x6cfb9280767a3596ee6af887d900014a755ffc75']);

const trueWord = '0x' + '0'.repeat(63) + '1';
const falseWord = '0x' + '0'.repeat(64);

/** A fixture eth_call that answers supportsInterface per the proof. */
const fixtureEthCall: EthCall = async (_chainId, to, data) => {
  const is1155 = ERC1155_CONTRACTS.has(to.toLowerCase());
  if (data.includes(ERC721_INTERFACE_ID)) return is1155 ? falseWord : trueWord;
  if (data.includes(ERC1155_INTERFACE_ID)) return is1155 ? trueWord : falseWord;
  return falseWord;
};

describe('collection distiller — ground() (S2-T1, SDD §3/§9)', () => {
  it('reproduces the proof classification (erc721 vs erc1155) with ZERO operator input', async () => {
    const derived = await ground({ belt: async () => BELT_FIXTURE, ethCall: fixtureEthCall });
    const byKey = Object.fromEntries(derived.map((d) => [d.collection_key, d.token_standard]));
    expect(byKey['apdao-seat']).toBe('erc721');
    expect(byKey['mibera']).toBe('erc721');
    expect(byKey['lore-1-introducing-mibera']).toBe('erc721');
    expect(byKey['puru-apiculture']).toBe('erc1155'); // the standard the operator would otherwise answer
  });

  it('normalizes collection_key underscores → hyphens (the grammar hazard)', () => {
    expect(normalizeCollectionKey('apdao_seat')).toBe('apdao-seat');
    expect(normalizeCollectionKey('lore_1_introducing_mibera')).toBe('lore-1-introducing-mibera');
    expect(normalizeCollectionKey('MiBeRa')).toBe('mibera');
    expect(normalizeCollectionKey('9bad')).toBeNull(); // must start with a letter
  });

  it('an ERC-165-omitting (reverting) contract → unknown, NEVER assumed erc721', async () => {
    const revertingCall: EthCall = async () => {
      throw new Error('execution reverted');
    };
    const std = await detectTokenStandard('80094', '0xdead000000000000000000000000000000000000', revertingCall);
    expect(std).toBe('unknown');
  });

  it('a both-false (non-165) contract → unknown', async () => {
    const std = await detectTokenStandard('1', '0xabc0000000000000000000000000000000000000', async () => falseWord);
    expect(std).toBe('unknown');
  });

  it('proposes a world binding by key prefix (unratified)', () => {
    expect(proposeWorldFromKey('apdao-seat')).toBe('apdao');
    expect(proposeWorldFromKey('puru-apiculture')).toBe('purupuru');
    expect(proposeWorldFromKey('lore-1-introducing-mibera')).toBe('mibera');
    expect(proposeWorldFromKey('mibera')).toBe('mibera');
    expect(proposeWorldFromKey('miladies')).toBe('mibera');
    expect(proposeWorldFromKey('unknownthing')).toBeUndefined();
  });

  it('decodeBool: ABI bool word', () => {
    expect(decodeBool(trueWord)).toBe(true);
    expect(decodeBool(falseWord)).toBe(false);
    expect(decodeBool(null)).toBe(false);
  });

  it('propose → the ledger folds the distilled labels (born-low, unratified)', async () => {
    const store = new InMemoryLedgerStore();
    const grant = collectionProducerGrant();
    const derived = await ground({ belt: async () => BELT_FIXTURE, ethCall: fixtureEthCall });
    const results = await proposeAll(store, grant, derived, NOW);
    expect(results).toHaveLength(4);

    // the puru collection folds to erc1155 with an unratified world proposal
    const puru = await store.getCollectionEntity('8453:0x6cfb9280767a3596ee6af887d900014a755ffc75');
    expect(puru!.labels.token_standard).toBe('erc1155');
    expect(puru!.labels.collection_key).toBe('puru-apiculture');
    expect(puru!.labels.world).toBe('purupuru');
    expect(puru!.provenance.find((p) => p.label === 'world')!.source_type).toBe('ai-derived'); // NOT yet ratified

    // idempotent re-propose
    const again = await proposeAll(store, grant, derived, NOW);
    expect(again.every((r) => r.appended === 0)).toBe(true);
  });
});
