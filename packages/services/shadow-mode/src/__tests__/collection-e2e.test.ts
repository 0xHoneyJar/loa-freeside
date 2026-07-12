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
import { exportRatifiedSnapshot } from '../collections/export-snapshot.js';

const NOW = '2026-07-03T00:00:00.000Z';
const BELT: BeltCollection[] = [
  { collectionKey: 'mibera', chainId: '80094', contract: '0x6666397dfe9a8c469bf65dc744cb1c733416c420' },
  { collectionKey: 'puru_apiculture', chainId: '8453', contract: '0x6cfb9280767a3596ee6af887d900014a755ffc75' },
];
const ERC1155 = new Set(['0x6cfb9280767a3596ee6af887d900014a755ffc75']);
const T = '0x' + '0'.repeat(63) + '1';
const F = '0x' + '0'.repeat(64);
const ethCall: EthCall = async (_c, to, data) => {
  const is1155 = ERC1155.has(to.toLowerCase());
  if (data.includes('80ac58cd')) return is1155 ? F : T;
  if (data.includes('d9b67a26')) return is1155 ? T : F;
  return F;
};

describe('collections-sot END-TO-END: distill → propose → ratify → snapshot (the cycle proof)', () => {
  it('the full value chain produces a snapshot whose trust signals gate the settle', async () => {
    const store = new InMemoryLedgerStore();
    const grant = collectionProducerGrant();

    // 1. DISTILL (derive-don't-ask) + PROPOSE (born-low)
    const derived = await ground({ belt: async () => BELT, ethCall });
    await proposeAll(store, grant, derived, NOW);

    // pre-ratify snapshot: worlds are proposed (NOT validated) → settle gate would withhold
    const before = await exportRatifiedSnapshot(store);
    const miberaBefore = before.entities.find((e) => e.collection_key === 'mibera')!;
    expect(miberaBefore.token_standard).toBe('erc721');
    expect(miberaBefore.world).toBe('mibera'); // proposed by heuristic
    expect(miberaBefore.world_validated).toBe(false); // but NOT ratified

    // 2. RATIFY the mibera world (operator's one gesture, cockpit grant)
    const dir = mkdtempSync(join(tmpdir(), 'cockpit-'));
    const grantPath = join(dir, '.recall-cockpit-grant');
    writeFileSync(grantPath, '');
    const entityId = collectionEntityId('80094', '0x6666397dfe9a8c469bf65dc744cb1c733416c420')!;
    const r = await ratifyCollectionLabel(
      store,
      grant,
      { entity_id: entityId, label: 'world', value: 'mibera', ratified_by: 'operator' },
      NOW,
      { grantPath },
    );
    expect(r.ok).toBe(true);
    rmSync(dir, { recursive: true, force: true });

    // 3. SNAPSHOT: mibera is now settle-eligible; puru still isn't (unratified world)
    const after = await exportRatifiedSnapshot(store);
    const miberaAfter = after.entities.find((e) => e.collection_key === 'mibera')!;
    expect(miberaAfter.world_validated).toBe(true); // the settle gate will now serve it
    expect(miberaAfter.contested).toBe(false);
    const puruAfter = after.entities.find((e) => e.collection_key === 'puru-apiculture')!;
    expect(puruAfter.token_standard).toBe('erc1155');
    expect(puruAfter.world_validated).toBe(false); // still withheld from the audit
  });
});
