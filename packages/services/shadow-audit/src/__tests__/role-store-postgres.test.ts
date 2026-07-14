import { describe, expect, it } from 'vitest';
import {
  makeRepositoryRoleStore,
  type RoleSnapshotRecord,
  type RoleSnapshotRepository,
} from '../role-store-postgres.js';
import { canonicalCollectionKey, type SourceResolver } from '../collection-union.js';
import type { RoleSnapshot } from '../role-snapshot.js';

const ETH = '0x' + 'a'.repeat(40);
const BERA = '0x' + 'b'.repeat(40);
const HJ1 = '0x' + 'c'.repeat(40);

const sources: SourceResolver = ({ chain, contract }) => {
  const addressed = `${chain}/${contract}`.toLowerCase();
  if ([`1/${ETH}`, `80094/${BERA}`].includes(addressed)) {
    return [
      { chain: '1', contract: ETH },
      { chain: '80094', contract: BERA },
    ];
  }
  if (addressed === `1/${HJ1}`) return [{ chain: '1', contract: HJ1 }];
  return undefined;
};

const HONEYCOMB_KEY = canonicalCollectionKey(sources({ chain: '1', contract: ETH })!);
const HJ1_KEY = canonicalCollectionKey(sources({ chain: '1', contract: HJ1 })!);

function snapshot(over: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    source: 'discord:guild:1',
    community: 'thj',
    collection: { chain: '80094', contract: BERA },
    captured_at: '2026-07-12T12:00:00.000Z',
    export_method: 'export',
    owner: '0x' + '9'.repeat(40),
    freshness_threshold_seconds: 86_400,
    entries: [{ discord_user_id: 'u1', wallet: '0x' + '1'.repeat(40), role_ids: ['hc'] }],
    ...over,
  };
}

/** Shared durable state with independently constructed repository/store instances. */
class PersistentFakeRepository implements RoleSnapshotRepository {
  readonly rows = new Map<string, RoleSnapshotRecord>();
  initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async load(community: string, collectionKey: string): Promise<unknown | undefined> {
    return this.rows.get(JSON.stringify([community, collectionKey]))?.snapshot;
  }

  async storeIfNewer(record: RoleSnapshotRecord): Promise<boolean> {
    const key = JSON.stringify([record.community, record.collectionKey]);
    const current = this.rows.get(key);
    if (current && Date.parse(current.capturedAt) >= Date.parse(record.capturedAt)) return false;
    this.rows.set(key, structuredClone(record));
    return true;
  }
}

describe('repository-backed role store (arrakis-7mtwa)', () => {
  it('survives replacement of the application store instance', async () => {
    const repository = new PersistentFakeRepository();
    await repository.initialize();

    const firstContainer = makeRepositoryRoleStore({ repository, community: 'thj', sources });
    expect(await firstContainer.store(snapshot())).toBe(true);

    // A Railway redeploy discards the whole application instance. Only the repository is shared.
    const replacementContainer = makeRepositoryRoleStore({ repository, community: 'thj', sources });
    expect(await replacementContainer.load(HONEYCOMB_KEY)).toEqual(snapshot());
  });

  it('atomically preserves newest-wins semantics across competing instances', async () => {
    const repository = new PersistentFakeRepository();
    await repository.initialize();
    const a = makeRepositoryRoleStore({ repository, community: 'thj', sources });
    const b = makeRepositoryRoleStore({ repository, community: 'thj', sources });

    const newer = snapshot({ captured_at: '2026-07-12T13:00:00.000Z' });
    const older = snapshot({ captured_at: '2026-07-12T11:00:00.000Z' });
    expect(await a.store(newer)).toBe(true);
    expect(await b.store(older)).toBe(false);
    expect((await b.load(HONEYCOMB_KEY))?.captured_at).toBe(newer.captured_at);
    expect(await a.store(newer)).toBe(false); // exact replay
  });

  it('isolates sibling collections and configured communities', async () => {
    const repository = new PersistentFakeRepository();
    await repository.initialize();
    const thj = makeRepositoryRoleStore({ repository, community: 'thj', sources });
    const other = makeRepositoryRoleStore({ repository, community: 'other', sources });

    const hj1 = snapshot({
      collection: { chain: '1', contract: HJ1 },
      entries: [{ discord_user_id: 'u2', wallet: '0x' + '2'.repeat(40), role_ids: ['hj1'] }],
    });
    await thj.store(snapshot());
    await thj.store(hj1);
    await other.store(snapshot({ community: 'other' }));

    expect((await thj.load(HONEYCOMB_KEY))?.entries[0]?.role_ids).toEqual(['hc']);
    expect((await thj.load(HJ1_KEY))?.entries[0]?.role_ids).toEqual(['hj1']);
    expect((await other.load(HONEYCOMB_KEY))?.community).toBe('other');
  });

  it('rejects a write for a different community than the configured store', async () => {
    const repository = new PersistentFakeRepository();
    const thj = makeRepositoryRoleStore({ repository, community: 'thj', sources });

    await expect(thj.store(snapshot({ community: 'other' }))).rejects.toThrow(/configured community/);
    expect(repository.rows.size).toBe(0);
  });

  it('fails closed when persisted JSON does not satisfy RoleSnapshotSchema', async () => {
    const repository = new PersistentFakeRepository();
    await repository.initialize();
    repository.rows.set(JSON.stringify(['thj', HONEYCOMB_KEY]), {
      community: 'thj',
      collectionKey: HONEYCOMB_KEY,
      capturedAt: '2026-07-12T12:00:00.000Z',
      snapshot: { community: 'thj', entries: 'corrupt' },
    });
    const store = makeRepositoryRoleStore({ repository, community: 'thj', sources });

    await expect(store.load(HONEYCOMB_KEY)).rejects.toThrow();
  });
});
