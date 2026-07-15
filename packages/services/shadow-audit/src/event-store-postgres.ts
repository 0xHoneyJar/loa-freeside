/**
 * G-1 (durable EventStore) — Postgres adapter for the append-only EventStore.
 *
 * Mirrors sql/0001_shadow_audit_events.sql + sql/0002_public_gate_leak.sql. The
 * runtime historically wired ONLY `InMemoryEventStore` (per-replica, non-durable) —
 * so a registered run vanished on restart and feedback could never bind across a
 * deploy. This adapter makes the store durable while preserving every EventStore
 * invariant: append-only (INSERT only, no UPDATE/DELETE), aggregate-only (the row
 * shape has NO member columns), and consent-required contact.
 *
 * Same idiom as role-store-postgres.ts: the `postgres` tagged-template client, an
 * idempotent `initialize()` that runs before HTTP bind, and a `connect*` helper that
 * owns the pool + close.
 */

import postgres, { type Sql } from 'postgres';
import {
  ContactRecordSchema,
  RunEventSchema,
  type ContactRecord,
  type EventStore,
  type RunEvent,
} from './event-store.js';

/**
 * Durable EventStore over Postgres. Schema init is idempotent and completes before
 * the server accepts traffic. Append-only by construction — this class issues no
 * UPDATE or DELETE.
 */
export class PostgresEventStore implements EventStore {
  constructor(private readonly sql: Sql) {}

  /**
   * Idempotent. Creates the aggregate run-event + consented-contact tables (matching
   * 0001) with the WIDENED mode CHECK from 0002 for fresh databases, then applies the
   * 0002 mode-widening to any pre-existing table created by the raw 0001 DDL.
   */
  async initialize(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS shadow_audit_run_events (
        id                       BIGSERIAL PRIMARY KEY,
        run_id                   TEXT        NOT NULL,
        mode                     TEXT        NOT NULL
                                 CONSTRAINT shadow_audit_run_events_mode_check
                                 CHECK (mode IN ('dogfood-full', 'public-gate-leak')),
        inputs_hash              CHAR(64)    NOT NULL,
        stale_set_size           INTEGER     NOT NULL CHECK (stale_set_size >= 0),
        time_on_stale_section_ms INTEGER     CHECK (time_on_stale_section_ms >= 0),
        reruns                   INTEGER     NOT NULL DEFAULT 0 CHECK (reruns >= 0),
        reaction                 TEXT        CHECK (reaction IN ('worse', 'expected', 'surprised')),
        cta_interaction          TEXT        CHECK (cta_interaction IN ('product', 'conversation')),
        ts                       TIMESTAMPTZ NOT NULL
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS shadow_audit_run_events_run_id_idx ON shadow_audit_run_events (run_id)
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS shadow_audit_run_events_ts_idx ON shadow_audit_run_events (ts)
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS shadow_audit_contacts (
        id       BIGSERIAL PRIMARY KEY,
        run_id   TEXT        NOT NULL,
        contact  TEXT        NOT NULL,
        consent  BOOLEAN     NOT NULL CHECK (consent = TRUE),
        ts       TIMESTAMPTZ NOT NULL
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS shadow_audit_contacts_run_id_idx ON shadow_audit_contacts (run_id)
    `;
    // Forward-migrate an existing table that still carries 0001's narrow (mode = 'dogfood-full')
    // CHECK. No-op on a table this class just created with the widened constraint.
    await this.sql`
      DO $$
      DECLARE con RECORD;
      BEGIN
        FOR con IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'public.shadow_audit_run_events'::regclass
            AND contype = 'c'
            AND conname <> 'shadow_audit_run_events_mode_check'
            AND pg_get_constraintdef(oid) ILIKE '%mode%'
        LOOP
          EXECUTE format('ALTER TABLE shadow_audit_run_events DROP CONSTRAINT %I', con.conname);
        END LOOP;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.shadow_audit_run_events'::regclass
            AND conname = 'shadow_audit_run_events_mode_check'
        ) THEN
          ALTER TABLE shadow_audit_run_events
            ADD CONSTRAINT shadow_audit_run_events_mode_check
            CHECK (mode IN ('dogfood-full', 'public-gate-leak'));
        END IF;
      END $$;
    `;
  }

  async appendRunEvent(event: RunEvent): Promise<void> {
    // Validate at the boundary — a smuggled member field is a hard parse failure (.strict()).
    const e = RunEventSchema.parse(event);
    await this.sql`
      INSERT INTO shadow_audit_run_events (
        run_id, mode, inputs_hash, stale_set_size,
        time_on_stale_section_ms, reruns, reaction, cta_interaction, ts
      ) VALUES (
        ${e.run_id}, ${e.mode}, ${e.inputs_hash}, ${e.stale_set_size},
        ${e.time_on_stale_section_ms ?? null}, ${e.reruns},
        ${e.reaction ?? null}, ${e.cta_interaction ?? null}, ${e.ts}::timestamptz
      )
    `;
  }

  async appendContact(record: ContactRecord): Promise<void> {
    const r = ContactRecordSchema.parse(record);
    // Same invariant as InMemoryEventStore: a contact can only bind to a known run.
    const run = await this.getRun(r.run_id);
    if (!run) {
      throw new Error(`unknown run_id: ${r.run_id}`);
    }
    await this.sql`
      INSERT INTO shadow_audit_contacts (run_id, contact, consent, ts)
      VALUES (${r.run_id}, ${r.contact}, ${r.consent}, ${r.ts}::timestamptz)
    `;
  }

  async getRun(runId: string): Promise<{ ts: string; inputs_hash: string } | undefined> {
    // Earliest event for the run defines its landing time + fingerprint (matches InMemory).
    const rows = await this.sql<{ ts: Date | string; inputs_hash: string }[]>`
      SELECT ts, inputs_hash
      FROM shadow_audit_run_events
      WHERE run_id = ${runId}
      ORDER BY id ASC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    // timestamptz comes back as a Date; the port contract is an ISO-8601 string.
    const ts = row.ts instanceof Date ? row.ts.toISOString() : String(row.ts);
    return { ts, inputs_hash: row.inputs_hash };
  }
}

export interface PostgresEventStoreConnection {
  store: PostgresEventStore;
  close(): Promise<void>;
}

/** Owns the connection pool + close, mirroring connectPostgresRoleSnapshotRepository. */
export function connectPostgresEventStore(databaseUrl: string): PostgresEventStoreConnection {
  const sql = postgres(databaseUrl, { max: 5, connect_timeout: 10, idle_timeout: 20 });
  return {
    store: new PostgresEventStore(sql),
    close: () => sql.end({ timeout: 5 }),
  };
}
