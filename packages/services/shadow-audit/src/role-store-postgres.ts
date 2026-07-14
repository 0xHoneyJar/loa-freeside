import postgres, { type Sql } from 'postgres';
import { RoleSnapshotSchema, type RoleSnapshot } from './role-snapshot.js';
import { canonicalRoleCollectionKey, type DurableRoleStore } from './role-store.js';
import type { SourceResolver } from './collection-union.js';

/** Database row owned by the role-store adapter. `snapshot` is validated at both boundaries. */
export interface RoleSnapshotRecord {
  community: string;
  collectionKey: string;
  capturedAt: string;
  snapshot: unknown;
}

/** Persistence port kept separate from the role source/sink so lifecycle behavior is testable without a DB. */
export interface RoleSnapshotRepository {
  initialize(): Promise<void>;
  load(community: string, collectionKey: string): Promise<unknown | undefined>;
  storeIfNewer(record: RoleSnapshotRecord): Promise<boolean>;
}

/**
 * RoleSource + RoleSink over a shared repository. Multiple application instances may construct this adapter;
 * newest-wins atomicity belongs to the repository, not process memory.
 */
export function makeRepositoryRoleStore(opts: {
  repository: RoleSnapshotRepository;
  community: string;
  sources: SourceResolver;
}): DurableRoleStore {
  const { repository, community, sources } = opts;
  return {
    async load(collectionKey: string): Promise<RoleSnapshot | undefined> {
      const raw = await repository.load(community, collectionKey.toLowerCase());
      return raw === undefined ? undefined : RoleSnapshotSchema.parse(raw);
    },
    async store(snap: RoleSnapshot): Promise<boolean> {
      const valid = RoleSnapshotSchema.parse(snap);
      if (valid.community !== community) {
        throw new Error(
          `role-store: snapshot community ${valid.community} does not match configured community ${community}`,
        );
      }
      return repository.storeIfNewer({
        community: valid.community,
        collectionKey: canonicalRoleCollectionKey(valid, sources).toLowerCase(),
        capturedAt: valid.captured_at,
        snapshot: valid,
      });
    },
  };
}

/** Service-owned Postgres repository. Schema initialization is idempotent and completes before HTTP bind. */
export class PostgresRoleSnapshotRepository implements RoleSnapshotRepository {
  constructor(private readonly sql: Sql) {}

  async initialize(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS shadow_audit_role_snapshots (
        community TEXT NOT NULL,
        collection_key TEXT NOT NULL,
        captured_at TIMESTAMPTZ NOT NULL,
        snapshot JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (community, collection_key)
      )
    `;
  }

  async load(community: string, collectionKey: string): Promise<unknown | undefined> {
    const rows = await this.sql<{ snapshot: unknown }[]>`
      SELECT snapshot
      FROM shadow_audit_role_snapshots
      WHERE community = ${community} AND collection_key = ${collectionKey}
      LIMIT 1
    `;
    return rows[0]?.snapshot;
  }

  async storeIfNewer(record: RoleSnapshotRecord): Promise<boolean> {
    const snapshot = RoleSnapshotSchema.parse(record.snapshot);
    const rows = await this.sql<{ stored: number }[]>`
      INSERT INTO shadow_audit_role_snapshots (
        community, collection_key, captured_at, snapshot, updated_at
      ) VALUES (
        ${record.community},
        ${record.collectionKey},
        ${record.capturedAt}::timestamptz,
        ${this.sql.json(snapshot as postgres.JSONValue)}::jsonb,
        NOW()
      )
      ON CONFLICT (community, collection_key) DO UPDATE
      SET captured_at = EXCLUDED.captured_at,
          snapshot = EXCLUDED.snapshot,
          updated_at = NOW()
      WHERE shadow_audit_role_snapshots.captured_at < EXCLUDED.captured_at
      RETURNING 1 AS stored
    `;
    return rows.length > 0;
  }
}

export interface PostgresRoleSnapshotConnection {
  repository: PostgresRoleSnapshotRepository;
  close(): Promise<void>;
}

export function connectPostgresRoleSnapshotRepository(databaseUrl: string): PostgresRoleSnapshotConnection {
  const sql = postgres(databaseUrl, { max: 5, connect_timeout: 10, idle_timeout: 20 });
  return {
    repository: new PostgresRoleSnapshotRepository(sql),
    close: () => sql.end({ timeout: 5 }),
  };
}
