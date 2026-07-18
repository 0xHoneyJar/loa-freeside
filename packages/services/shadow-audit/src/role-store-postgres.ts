import postgres, { type Sql } from 'postgres';
import {
  ROLE_SNAPSHOT_MAX_FUTURE_SKEW_MS,
  RoleSnapshotSchema,
  type RoleSnapshot,
} from './role-snapshot.js';
import {
  canonicalRoleCollectionKey,
  RoleSnapshotConflictError,
  type DurableRoleStore,
} from './role-store.js';
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

const ROLE_STORE_COMPONENT = 'role-snapshot-store';
const ROLE_STORE_SCHEMA_VERSION = 1;

const canonicalSnapshotJson = (snapshot: RoleSnapshot): string =>
  JSON.stringify(RoleSnapshotSchema.parse(snapshot));

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

/**
 * Service-owned Postgres repository.
 *
 * Startup applies and verifies an append-only component migration ledger before
 * HTTP bind. Future schema changes add a numbered step and bump
 * ROLE_STORE_SCHEMA_VERSION; table existence alone is never treated as schema
 * compatibility.
 */
export class PostgresRoleSnapshotRepository implements RoleSnapshotRepository {
  constructor(
    private readonly sql: Sql,
    private readonly sources: SourceResolver,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async initialize(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS shadow_audit_schema_migrations (
        component TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (component, version)
      )
    `;

    const currentRows = await this.sql<{ version: number }[]>`
      SELECT COALESCE(MAX(version), 0)::int AS version
      FROM shadow_audit_schema_migrations
      WHERE component = ${ROLE_STORE_COMPONENT}
    `;
    const current = currentRows[0]?.version ?? 0;
    if (current > ROLE_STORE_SCHEMA_VERSION) {
      throw new Error(
        `role-store schema version ${current} is newer than supported ${ROLE_STORE_SCHEMA_VERSION}`,
      );
    }

    if (current < 1) {
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
      await this.sql`
        INSERT INTO shadow_audit_schema_migrations (component, version)
        VALUES (${ROLE_STORE_COMPONENT}, 1)
        ON CONFLICT (component, version) DO NOTHING
      `;
    }

    const verifiedRows = await this.sql<{ version: number }[]>`
      SELECT COALESCE(MAX(version), 0)::int AS version
      FROM shadow_audit_schema_migrations
      WHERE component = ${ROLE_STORE_COMPONENT}
    `;
    const verified = verifiedRows[0]?.version ?? 0;
    if (verified !== ROLE_STORE_SCHEMA_VERSION) {
      throw new Error(
        `role-store schema initialization incomplete: expected ${ROLE_STORE_SCHEMA_VERSION}, got ${verified}`,
      );
    }

    const columns = await this.sql<
      { column_name: string; data_type: string; is_nullable: 'YES' | 'NO' }[]
    >`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'shadow_audit_role_snapshots'
    `;
    const requiredColumns = new Map([
      ['community', ['text', 'NO']],
      ['collection_key', ['text', 'NO']],
      ['captured_at', ['timestamp with time zone', 'NO']],
      ['snapshot', ['jsonb', 'NO']],
      ['updated_at', ['timestamp with time zone', 'NO']],
    ]);
    for (const [name, [dataType, nullable]] of requiredColumns) {
      const column = columns.find((candidate) => candidate.column_name === name);
      if (!column || column.data_type !== dataType || column.is_nullable !== nullable) {
        throw new Error(`role-store schema drift: required column ${name} is missing or incompatible`);
      }
    }

    const primaryKeys = await this.sql<{ columns: string[] }[]>`
      SELECT array_agg(attribute.attname ORDER BY key_column.ordinality) AS columns
      FROM pg_constraint AS constraint_row
      JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
        AS key_column(attnum, ordinality) ON TRUE
      JOIN pg_attribute AS attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
      WHERE constraint_row.contype = 'p'
        AND constraint_row.conrelid = 'shadow_audit_role_snapshots'::regclass
      GROUP BY constraint_row.oid
    `;
    if (JSON.stringify(primaryKeys[0]?.columns) !== JSON.stringify(['community', 'collection_key'])) {
      throw new Error(
        'role-store schema drift: primary key must be (community, collection_key)',
      );
    }
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
    const community = snapshot.community;
    const collectionKey = canonicalRoleCollectionKey(snapshot, this.sources).toLowerCase();
    const capturedAt = snapshot.captured_at;
    if (
      record.community !== community ||
      record.collectionKey.toLowerCase() !== collectionKey ||
      record.capturedAt !== capturedAt
    ) {
      throw new Error('role-store: record metadata does not match the validated snapshot');
    }
    const capturedAtMs = new Date(capturedAt).getTime();
    if (capturedAtMs > this.now() + ROLE_SNAPSHOT_MAX_FUTURE_SKEW_MS) {
      throw new Error('role-store: captured_at exceeds the allowed five-minute clock skew');
    }
    const rows = await this.sql<{ stored: number }[]>`
      INSERT INTO shadow_audit_role_snapshots (
        community, collection_key, captured_at, snapshot, updated_at
      ) VALUES (
        ${community},
        ${collectionKey},
        ${capturedAt}::timestamptz,
        ${this.sql.json(snapshot as postgres.JSONValue)}::jsonb,
        NOW()
      )
      ON CONFLICT (community, collection_key) DO UPDATE
      SET captured_at = EXCLUDED.captured_at,
          snapshot = EXCLUDED.snapshot,
          updated_at = NOW()
      WHERE shadow_audit_role_snapshots.captured_at < EXCLUDED.captured_at
         OR (
           shadow_audit_role_snapshots.captured_at > NOW() + INTERVAL '5 minutes'
           AND EXCLUDED.captured_at <= NOW() + INTERVAL '5 minutes'
         )
      RETURNING 1 AS stored
    `;
    if (rows.length > 0) return true;

    // Equal timestamps are normally exact replays and remain no-ops. The one
    // exception is anti-entropy repair: if persisted JSON at that same version
    // no longer satisfies the schema, replaying the canonical snapshot repairs
    // it. The conditional UPDATE includes the observed corrupt JSON, so a
    // concurrent valid repair cannot be overwritten by this stale observation.
    const heldRows = await this.sql<{ captured_at: Date | string; snapshot: unknown }[]>`
      SELECT captured_at, snapshot
      FROM shadow_audit_role_snapshots
      WHERE community = ${community} AND collection_key = ${collectionKey}
      LIMIT 1
    `;
    const held = heldRows[0];
    if (!held || new Date(held.captured_at).getTime() !== capturedAtMs) {
      return false;
    }
    const heldValid = RoleSnapshotSchema.safeParse(held.snapshot);
    if (heldValid.success) {
      if (canonicalSnapshotJson(heldValid.data) === canonicalSnapshotJson(snapshot)) return false;
      throw new RoleSnapshotConflictError();
    }

    const repaired = await this.sql<{ stored: number }[]>`
      UPDATE shadow_audit_role_snapshots
      SET snapshot = ${this.sql.json(snapshot as postgres.JSONValue)}::jsonb,
          updated_at = NOW()
      WHERE community = ${community}
        AND collection_key = ${collectionKey}
        AND captured_at = ${capturedAt}::timestamptz
        AND snapshot = ${this.sql.json(held.snapshot as postgres.JSONValue)}::jsonb
      RETURNING 1 AS stored
    `;
    return repaired.length > 0;
  }
}

export interface PostgresRoleSnapshotConnection {
  repository: PostgresRoleSnapshotRepository;
  close(): Promise<void>;
}

export function connectPostgresRoleSnapshotRepository(
  databaseUrl: string,
  sources: SourceResolver,
): PostgresRoleSnapshotConnection {
  const sql = postgres(databaseUrl, { max: 5, connect_timeout: 10, idle_timeout: 20 });
  return {
    repository: new PostgresRoleSnapshotRepository(sql, sources),
    close: () => sql.end({ timeout: 5 }),
  };
}
