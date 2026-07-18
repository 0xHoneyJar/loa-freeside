import { describe, expect, it } from 'vitest';
import {
  makeRepositoryRoleStore,
  PostgresRoleSnapshotRepository,
  type RoleSnapshotRecord,
  type RoleSnapshotRepository,
} from '../role-store-postgres.js';
import type { Sql } from 'postgres';
import { canonicalCollectionKey, type SourceResolver } from '../collection-union.js';
import { RoleSnapshotSchema, type RoleSnapshot } from '../role-snapshot.js';
import { RoleSnapshotConflictError } from '../role-store.js';

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
    if (current && Date.parse(current.capturedAt) > Date.parse(record.capturedAt)) return false;
    if (current && Date.parse(current.capturedAt) === Date.parse(record.capturedAt)) {
      const currentValid = RoleSnapshotSchema.safeParse(current.snapshot);
      if (currentValid.success) {
        const incoming = RoleSnapshotSchema.parse(record.snapshot);
        if (JSON.stringify(currentValid.data) === JSON.stringify(incoming)) return false;
        throw new RoleSnapshotConflictError();
      }
    }
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
    await expect(
      a.store({
        ...newer,
        entries: [{ discord_user_id: 'different', wallet: '0x' + '4'.repeat(40), role_ids: ['hc'] }],
      }),
    ).rejects.toThrow(/conflicting valid snapshots/);
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
    expect(await store.store(snapshot())).toBe(true);
    expect(await store.load(HONEYCOMB_KEY)).toEqual(snapshot());
  });
});

describe('Postgres role-snapshot encoding', () => {
  it('applies and verifies the versioned role-store migration before serving', async () => {
    const queries: string[] = [];
    let version = 0;
    const tag = Object.assign(
      (strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        queries.push(query);
        if (query.includes('SELECT COALESCE(MAX(version)')) return Promise.resolve([{ version }]);
        if (query.includes('INSERT INTO shadow_audit_schema_migrations')) version = 1;
        if (query.includes('FROM information_schema.columns')) {
          return Promise.resolve([
            { column_name: 'community', data_type: 'text', is_nullable: 'NO' },
            { column_name: 'collection_key', data_type: 'text', is_nullable: 'NO' },
            { column_name: 'captured_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
            { column_name: 'snapshot', data_type: 'jsonb', is_nullable: 'NO' },
            { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
          ]);
        }
        if (query.includes('FROM pg_constraint')) {
          return Promise.resolve([{ columns: ['community', 'collection_key'] }]);
        }
        return Promise.resolve([]);
      },
      { json: (value: unknown) => value },
    ) as unknown as Sql;
    const repository = new PostgresRoleSnapshotRepository(tag, sources);

    await repository.initialize();

    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS shadow_audit_schema_migrations'))).toBe(true);
    expect(queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS shadow_audit_role_snapshots'))).toBe(true);
    expect(version).toBe(1);
  });

  it('fails initialization when the migration ledger and live catalog disagree', async () => {
    const tag = Object.assign(
      (strings: TemplateStringsArray) => {
        const query = strings.join(' ');
        if (query.includes('SELECT COALESCE(MAX(version)')) return Promise.resolve([{ version: 1 }]);
        if (query.includes('FROM information_schema.columns')) return Promise.resolve([]);
        return Promise.resolve([]);
      },
      { json: (value: unknown) => value },
    ) as unknown as Sql;

    await expect(new PostgresRoleSnapshotRepository(tag, sources).initialize()).rejects.toThrow(
      /schema drift/,
    );
  });

  it('uses the driver JSON encoder with the object, not a pre-stringified JSON scalar', async () => {
    let encoded: unknown;
    let upsertQuery = '';
    const tag = Object.assign(
      (strings: TemplateStringsArray, ..._values: unknown[]) => {
        upsertQuery = strings.join(' ');
        return Promise.resolve([{ stored: 1 }]);
      },
      {
        json(value: unknown) {
          encoded = value;
          return value;
        },
      },
    ) as unknown as Sql;
    const repository = new PostgresRoleSnapshotRepository(tag, sources);
    const valid = snapshot();

    expect(await repository.storeIfNewer({
      community: valid.community,
      collectionKey: HONEYCOMB_KEY,
      capturedAt: valid.captured_at,
      snapshot: valid,
    })).toBe(true);
    expect(encoded).toEqual(valid);
    expect(upsertQuery).toContain("captured_at > NOW() + INTERVAL '5 minutes'");
  });

  it('rejects a future ordering timestamp even when called outside the HTTP adapter', async () => {
    const tag = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve([]),
      { json: (value: unknown) => value },
    ) as unknown as Sql;
    const now = Date.UTC(2026, 6, 18, 12, 0, 0);
    const repository = new PostgresRoleSnapshotRepository(tag, sources, () => now);
    const future = snapshot({ captured_at: '2099-01-01T00:00:00.000Z' });

    await expect(repository.storeIfNewer({
      community: future.community,
      collectionKey: HONEYCOMB_KEY,
      capturedAt: future.captured_at,
      snapshot: future,
    })).rejects.toThrow(/clock skew/);
  });

  it('rejects caller metadata that contradicts the validated snapshot', async () => {
    let queried = false;
    const tag = Object.assign(
      (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        queried = true;
        return Promise.resolve([]);
      },
      { json: (value: unknown) => value },
    ) as unknown as Sql;
    const repository = new PostgresRoleSnapshotRepository(tag, sources);
    const valid = snapshot();

    for (const record of [
      { community: 'other', collectionKey: HONEYCOMB_KEY, capturedAt: valid.captured_at },
      { community: valid.community, collectionKey: HJ1_KEY, capturedAt: valid.captured_at },
      {
        community: valid.community,
        collectionKey: HONEYCOMB_KEY,
        capturedAt: '2026-07-12T12:00:01.000Z',
      },
    ]) {
      await expect(
        repository.storeIfNewer({ ...record, snapshot: valid }),
      ).rejects.toThrow(/metadata does not match/);
    }
    expect(queried).toBe(false);
  });
});
