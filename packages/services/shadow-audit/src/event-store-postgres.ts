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
  PublicGateLeakRunSchema,
  PublicJourneyInputEventSchema,
  PublicJourneyTransitionSchema,
  RunEventSchema,
  type ContactRecord,
  type EventStore,
  type PublicGateLeakJourneyRecord,
  type PublicGateLeakRun,
  type PublicJourneyInputEvent,
  type PublicJourneyTransition,
  type RunEvent,
} from './event-store.js';
import {
  AttentionEventSchema,
  type AttentionEvent,
  type PublicGateLeakOutcome,
  type RefusalCode,
} from '@freeside/shadow-audit-protocol';

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
    await this.sql`
      CREATE TABLE IF NOT EXISTS gate_leak_subject (
        subject_chain_id           TEXT        NOT NULL,
        subject_contract_address   TEXT        NOT NULL,
        first_seen_ts              TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (subject_chain_id, subject_contract_address)
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS public_gate_leak_runs (
        run_id                     TEXT        PRIMARY KEY,
        journey_token              TEXT        NOT NULL,
        inputs_hash                CHAR(64)    NOT NULL,
        subject_chain_id           TEXT        NOT NULL,
        subject_contract_address   TEXT        NOT NULL,
        threshold                  INTEGER     NOT NULL CHECK (threshold > 0),
        outcome                    TEXT        NOT NULL CHECK (outcome IN (
          'submitted', 'resolving_subject', 'indexing', 'needs_input',
          'computing', 'delivered_e1', 'refused', 'unavailable'
        )),
        refusal_code               TEXT,
        access_started_at          DATE,
        ts                         TIMESTAMPTZ NOT NULL
      )
    `;
    await this.sql`
      CREATE UNIQUE INDEX IF NOT EXISTS public_gate_leak_runs_journey_token_idx
      ON public_gate_leak_runs (journey_token)
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gate_leak_journey_inputs (
        id                         BIGSERIAL PRIMARY KEY,
        run_id                     TEXT        NOT NULL REFERENCES public_gate_leak_runs(run_id),
        input_name                 TEXT        NOT NULL CHECK (input_name = 'access_started_at'),
        input_value                DATE        NOT NULL,
        ts                         TIMESTAMPTZ NOT NULL,
        UNIQUE (run_id, input_name)
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gate_leak_journey_events (
        id                         BIGSERIAL PRIMARY KEY,
        run_id                     TEXT        NOT NULL REFERENCES public_gate_leak_runs(run_id),
        outcome                    TEXT        NOT NULL CHECK (outcome IN (
          'submitted', 'resolving_subject', 'indexing', 'needs_input',
          'computing', 'delivered_e1', 'refused', 'unavailable'
        )),
        refusal_code               TEXT,
        ts                         TIMESTAMPTZ NOT NULL,
        UNIQUE (run_id, outcome)
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gate_leak_attention (
        id                         BIGSERIAL PRIMARY KEY,
        subject_chain_id           TEXT        NOT NULL,
        subject_contract_address   TEXT        NOT NULL,
        journey_token              TEXT        NOT NULL,
        kind                       TEXT        NOT NULL CHECK (kind IN (
          'submitted', 'delivered_e1', 'needs_input', 'refused', 'enhance_intent', 'feedback'
        )),
        ts                         TIMESTAMPTZ NOT NULL,
        UNIQUE (journey_token, kind)
      )
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
            AND pg_get_constraintdef(oid) ILIKE '%mode%'
            AND pg_get_constraintdef(oid) NOT ILIKE '%public-gate-leak%'
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

  async appendPublicGateLeakRun(run: PublicGateLeakRun): Promise<{ created: boolean }> {
    const value = PublicGateLeakRunSchema.parse(run);
    await this.sql`
      INSERT INTO gate_leak_subject (
        subject_chain_id, subject_contract_address, first_seen_ts
      ) VALUES (
        ${value.subject.chain_id}, ${value.subject.contract_address}, ${value.ts}::timestamptz
      ) ON CONFLICT (subject_chain_id, subject_contract_address) DO NOTHING
    `;
    const inserted = await this.sql<{ run_id: string }[]>`
      INSERT INTO public_gate_leak_runs (
        run_id, journey_token, inputs_hash, subject_chain_id, subject_contract_address,
        threshold, outcome, refusal_code, access_started_at, ts
      ) VALUES (
        ${value.run_id}, ${value.journey_token}, ${value.inputs_hash},
        ${value.subject.chain_id}, ${value.subject.contract_address},
        ${value.threshold}, ${value.outcome}, ${value.refusal_code ?? null},
        ${value.access_started_at ?? null}::date, ${value.ts}::timestamptz
      ) ON CONFLICT (run_id) DO NOTHING
      RETURNING run_id
    `;
    if (inserted.length > 0) return { created: true };

    const existing = await this.getPublicGateLeakJourney(value.run_id);
    if (
      !existing ||
      existing.journey_token !== value.journey_token ||
      existing.inputs_hash !== value.inputs_hash ||
      existing.subject.chain_id !== value.subject.chain_id ||
      existing.subject.contract_address !== value.subject.contract_address ||
      existing.threshold !== value.threshold
    ) {
      throw new Error(`conflicting public gate-leak run_id: ${value.run_id}`);
    }
    return { created: false };
  }

  async appendPublicJourneyInput(event: PublicJourneyInputEvent): Promise<{ created: boolean }> {
    const value = PublicJourneyInputEventSchema.parse(event);
    const inserted = await this.sql<{ id: number }[]>`
      INSERT INTO gate_leak_journey_inputs (run_id, input_name, input_value, ts)
      VALUES (${value.run_id}, ${value.input}, ${value.value}::date, ${value.ts}::timestamptz)
      ON CONFLICT (run_id, input_name) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) return { created: true };
    const existing = await this.getPublicGateLeakJourney(value.run_id);
    if (!existing) throw new Error(`unknown public run_id: ${value.run_id}`);
    if (existing.supplied_access_started_at !== value.value) {
      throw new Error(`conflicting journey input: ${value.run_id}/${value.input}`);
    }
    return { created: false };
  }

  async appendPublicJourneyTransition(event: PublicJourneyTransition): Promise<{ created: boolean }> {
    const value = PublicJourneyTransitionSchema.parse(event);
    const inserted = await this.sql<{ id: number }[]>`
      INSERT INTO gate_leak_journey_events (run_id, outcome, refusal_code, ts)
      VALUES (${value.run_id}, ${value.outcome}, ${value.refusal_code ?? null}, ${value.ts}::timestamptz)
      ON CONFLICT (run_id, outcome) DO NOTHING
      RETURNING id
    `;
    return { created: inserted.length > 0 };
  }

  async appendAttention(event: AttentionEvent): Promise<{ created: boolean }> {
    const value = AttentionEventSchema.parse(event);
    const inserted = await this.sql<{ id: number }[]>`
      INSERT INTO gate_leak_attention (
        subject_chain_id, subject_contract_address, journey_token, kind, ts
      ) VALUES (
        ${value.subject_chain_id}, ${value.subject_contract_address},
        ${value.journey_token}, ${value.kind}, ${value.ts}::timestamptz
      ) ON CONFLICT (journey_token, kind) DO NOTHING
      RETURNING id
    `;
    return { created: inserted.length > 0 };
  }

  async getPublicGateLeakJourney(runId: string): Promise<PublicGateLeakJourneyRecord | undefined> {
    const rows = await this.sql<{
      run_id: string;
      journey_token: string;
      inputs_hash: string;
      subject_chain_id: string;
      subject_contract_address: string;
      threshold: number | string;
      outcome: PublicGateLeakOutcome;
      refusal_code: RefusalCode | null;
      access_started_at: Date | string | null;
      ts: Date | string;
      current_outcome: PublicGateLeakOutcome;
      current_refusal_code: RefusalCode | null;
      supplied_access_started_at: Date | string | null;
    }[]>`
      SELECT
        r.run_id, r.journey_token, r.inputs_hash,
        r.subject_chain_id, r.subject_contract_address, r.threshold,
        r.outcome, r.refusal_code, r.access_started_at, r.ts,
        COALESCE(e.outcome, r.outcome) AS current_outcome,
        COALESCE(e.refusal_code, r.refusal_code) AS current_refusal_code,
        COALESCE(i.input_value, r.access_started_at) AS supplied_access_started_at
      FROM public_gate_leak_runs r
      LEFT JOIN LATERAL (
        SELECT outcome, refusal_code
        FROM gate_leak_journey_events
        WHERE run_id = r.run_id
        ORDER BY id DESC
        LIMIT 1
      ) e ON TRUE
      LEFT JOIN LATERAL (
        SELECT input_value
        FROM gate_leak_journey_inputs
        WHERE run_id = r.run_id AND input_name = 'access_started_at'
        ORDER BY id DESC
        LIMIT 1
      ) i ON TRUE
      WHERE r.run_id = ${runId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    const isoDate = (value: Date | string | null): string | undefined => {
      if (!value) return undefined;
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    };
    const run = PublicGateLeakRunSchema.parse({
      run_id: row.run_id,
      journey_token: row.journey_token,
      inputs_hash: row.inputs_hash,
      subject: {
        chain_id: row.subject_chain_id,
        contract_address: row.subject_contract_address,
      },
      threshold: Number(row.threshold),
      outcome: row.outcome,
      refusal_code: row.refusal_code ?? undefined,
      access_started_at: isoDate(row.access_started_at),
      ts: row.ts instanceof Date ? row.ts.toISOString() : String(row.ts),
    });
    return {
      ...run,
      current_outcome: row.current_outcome,
      current_refusal_code: row.current_refusal_code ?? undefined,
      supplied_access_started_at: isoDate(row.supplied_access_started_at),
    };
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
