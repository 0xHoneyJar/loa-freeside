/**
 * G-1 (durable EventStore) — Postgres adapter for the append-only EventStore.
 *
 * Mirrors sql/0001_shadow_audit_events.sql + sql/0002_public_gate_leak.sql. The
 * runtime historically wired ONLY `InMemoryEventStore` (per-replica, non-durable) —
 * so a registered run vanished on restart and feedback could never bind across a
 * deploy. This adapter makes the store durable while preserving every EventStore
 * invariant: the journey/event ledger is append-only, aggregate-only (the row shape
 * has NO member columns), and consent-required. The separate compute cache is an
 * operational renewable lease, so it deliberately updates/deletes lease rows.
 *
 * Same idiom as role-store-postgres.ts: the `postgres` tagged-template client, an
 * idempotent `initialize()` that runs before HTTP bind, and a `connect*` helper that
 * owns the pool + close.
 */

import postgres, { type Sql, type TransactionSql } from 'postgres';
import {
  ContactRecordSchema,
  PublicGateLeakRunSchema,
  PublicJourneyInputEventSchema,
  PublicJourneyTransitionSchema,
  RunEventSchema,
  publicJourneyTransitionDisposition,
  type ContactRecord,
  type EventStore,
  type PublicComputeClaim,
  type PublicComputeClaimResult,
  type PublicGateLeakJourneyRecord,
  type PublicGateLeakRun,
  type PublicJourneyInputEvent,
  type PublicJourneyTransition,
  type PublicJourneyWriteBudget,
  type RunEvent,
} from './event-store.js';
import {
  AttentionEventSchema,
  type AttentionEvent,
  type PublicGateLeakOutcome,
  type RefusalCode,
} from '@freeside/shadow-audit-protocol';

class PublicJourneyBudgetExceededError extends Error {}

/**
 * Durable EventStore over Postgres. Schema init is idempotent and completes before
 * the server accepts traffic. Journey history is append-only; compute leases are not history.
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
      CREATE TABLE IF NOT EXISTS shadow_audit_public_run_registration_keys (
        run_id TEXT PRIMARY KEY
      )
    `;
    await this.sql`
      INSERT INTO shadow_audit_public_run_registration_keys (run_id)
      SELECT DISTINCT run_id FROM shadow_audit_run_events
      WHERE mode = 'public-gate-leak' AND reaction IS NULL AND cta_interaction IS NULL
      ON CONFLICT (run_id) DO NOTHING
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
    await this.sql`
      CREATE TABLE IF NOT EXISTS gate_leak_compute_cache (
        compute_key                CHAR(64)    PRIMARY KEY,
        state                      TEXT        NOT NULL CHECK (state IN ('running', 'complete')),
        owner_token                TEXT        NOT NULL,
        lease_expires_at           TIMESTAMPTZ NOT NULL,
        result                     JSONB,
        updated_at                 TIMESTAMPTZ NOT NULL,
        CHECK ((state = 'complete') = (result IS NOT NULL))
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS gate_leak_journey_write_budget (
        bucket                     TEXT        NOT NULL,
        window_started_at          TIMESTAMPTZ NOT NULL,
        used                       INTEGER     NOT NULL CHECK (used >= 0),
        PRIMARY KEY (bucket, window_started_at)
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
    const append = async (sql: Sql | TransactionSql): Promise<void> => {
      await sql`
        INSERT INTO shadow_audit_run_events (
          run_id, mode, inputs_hash, stale_set_size,
          time_on_stale_section_ms, reruns, reaction, cta_interaction, ts
        ) VALUES (
          ${e.run_id}, ${e.mode}, ${e.inputs_hash}, ${e.stale_set_size},
          ${e.time_on_stale_section_ms ?? null}, ${e.reruns},
          ${e.reaction ?? null}, ${e.cta_interaction ?? null}, ${e.ts}::timestamptz
        )
      `;
    };
    if (e.mode !== 'public-gate-leak' || e.reaction || e.cta_interaction) {
      await append(this.sql);
      return;
    }
    await this.sql.begin(async (sql) => {
      const keys = await sql<{ run_id: string }[]>`
        INSERT INTO shadow_audit_public_run_registration_keys (run_id)
        VALUES (${e.run_id})
        ON CONFLICT (run_id) DO NOTHING
        RETURNING run_id
      `;
      if (keys.length > 0) await append(sql);
    });
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

  async appendPublicGateLeakRun(
    run: PublicGateLeakRun,
    budget: PublicJourneyWriteBudget,
  ): Promise<{ created: boolean; rate_limited?: boolean }> {
    const value = PublicGateLeakRunSchema.parse(run);
    if (!Number.isInteger(budget.limit) || budget.limit < 1) throw new Error('public journey budget limit must be positive');
    try {
      return await this.sql.begin(async (sql) => {
        const inserted = await sql<{ run_id: string }[]>`
          INSERT INTO public_gate_leak_runs (
            run_id, journey_token, inputs_hash, subject_chain_id, subject_contract_address,
            threshold, outcome, refusal_code, access_started_at, ts
          ) VALUES (
            ${value.run_id}, ${value.journey_token}, ${value.inputs_hash},
            ${value.subject.chain_id}, ${value.subject.contract_address},
            ${value.threshold}, ${value.outcome}, ${value.refusal_code ?? null},
            ${value.access_started_at ?? null}::date, ${value.ts}::timestamptz
          ) ON CONFLICT DO NOTHING
          RETURNING run_id
        `;
        if (inserted.length === 0) {
          const rows = await sql<{
            run_id: string;
            journey_token: string;
            inputs_hash: string;
            subject_chain_id: string;
            subject_contract_address: string;
            threshold: number | string;
          }[]>`
            SELECT run_id, journey_token, inputs_hash, subject_chain_id, subject_contract_address, threshold
            FROM public_gate_leak_runs
            WHERE run_id = ${value.run_id} OR journey_token = ${value.journey_token}
            LIMIT 1
          `;
          const existing = rows[0];
          if (
            !existing ||
            existing.journey_token !== value.journey_token ||
            existing.inputs_hash !== value.inputs_hash ||
            existing.subject_chain_id !== value.subject.chain_id ||
            existing.subject_contract_address !== value.subject.contract_address ||
            Number(existing.threshold) !== value.threshold
          ) {
            throw new Error(`conflicting public gate-leak run_id: ${value.run_id}`);
          }
          return { created: false };
        }

        const consumed = await sql<{ used: number }[]>`
          INSERT INTO gate_leak_journey_write_budget (bucket, window_started_at, used)
          VALUES (${budget.bucket}, ${budget.window_started_at}::timestamptz, 1)
          ON CONFLICT (bucket, window_started_at) DO UPDATE SET
            used = gate_leak_journey_write_budget.used + 1
          WHERE gate_leak_journey_write_budget.used < ${budget.limit}
          RETURNING used
        `;
        if (consumed.length === 0) throw new PublicJourneyBudgetExceededError();
        await sql`
          INSERT INTO gate_leak_subject (
            subject_chain_id, subject_contract_address, first_seen_ts
          ) VALUES (
            ${value.subject.chain_id}, ${value.subject.contract_address}, ${value.ts}::timestamptz
          ) ON CONFLICT (subject_chain_id, subject_contract_address) DO NOTHING
        `;
        return { created: true };
      });
    } catch (error) {
      if (error instanceof PublicJourneyBudgetExceededError) return { created: false, rate_limited: true };
      throw error;
    }
  }

  async appendPublicJourneyInput(event: PublicJourneyInputEvent): Promise<{ created: boolean }> {
    const value = PublicJourneyInputEventSchema.parse(event);
    return this.sql.begin(async (sql) => {
      const runRows = await sql<{ access_started_at: Date | string | null }[]>`
        SELECT access_started_at FROM public_gate_leak_runs
        WHERE run_id = ${value.run_id}
        FOR UPDATE
      `;
      const run = runRows[0];
      if (!run) throw new Error(`unknown public run_id: ${value.run_id}`);
      const baseDate = run.access_started_at instanceof Date
        ? run.access_started_at.toISOString().slice(0, 10)
        : run.access_started_at
          ? String(run.access_started_at).slice(0, 10)
          : undefined;
      if (baseDate) {
        if (baseDate !== value.value) throw new Error(`conflicting journey input: ${value.run_id}/${value.input}`);
        return { created: false };
      }
      const inserted = await sql<{ id: number }[]>`
        INSERT INTO gate_leak_journey_inputs (run_id, input_name, input_value, ts)
        VALUES (${value.run_id}, ${value.input}, ${value.value}::date, ${value.ts}::timestamptz)
        ON CONFLICT (run_id, input_name) DO NOTHING
        RETURNING id
      `;
      if (inserted.length > 0) return { created: true };
      const existingRows = await sql<{ input_value: Date | string }[]>`
        SELECT input_value FROM gate_leak_journey_inputs
        WHERE run_id = ${value.run_id} AND input_name = ${value.input}
      `;
      const existing = existingRows[0]?.input_value;
      const existingDate = existing instanceof Date ? existing.toISOString().slice(0, 10) : String(existing).slice(0, 10);
      if (existingDate !== value.value) throw new Error(`conflicting journey input: ${value.run_id}/${value.input}`);
      return { created: false };
    });
  }

  async appendPublicJourneyTransition(event: PublicJourneyTransition): Promise<{ created: boolean }> {
    const value = PublicJourneyTransitionSchema.parse(event);
    return this.sql.begin(async (sql) => {
      const runRows = await sql<{ outcome: PublicGateLeakOutcome; refusal_code: RefusalCode | null }[]>`
        SELECT outcome, refusal_code
        FROM public_gate_leak_runs
        WHERE run_id = ${value.run_id}
        FOR UPDATE
      `;
      const run = runRows[0];
      if (!run) throw new Error(`unknown public run_id: ${value.run_id}`);
      const transitionRows = await sql<{ outcome: PublicGateLeakOutcome; refusal_code: RefusalCode | null }[]>`
        SELECT outcome, refusal_code
        FROM gate_leak_journey_events
        WHERE run_id = ${value.run_id}
        ORDER BY id DESC
        LIMIT 1
      `;
      const latest = transitionRows[0];
      const disposition = publicJourneyTransitionDisposition(
        {
          current_outcome: latest?.outcome ?? run.outcome,
          current_refusal_code: latest?.refusal_code ?? run.refusal_code ?? undefined,
        },
        value,
      );
      if (disposition === 'noop') return { created: false };
      const inserted = await sql<{ id: number }[]>`
        INSERT INTO gate_leak_journey_events (run_id, outcome, refusal_code, ts)
        VALUES (${value.run_id}, ${value.outcome}, ${value.refusal_code ?? null}, ${value.ts}::timestamptz)
        RETURNING id
      `;
      return { created: inserted.length > 0 };
    });
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

  async getPublicGateLeakJourneyByToken(journeyToken: string): Promise<PublicGateLeakJourneyRecord | undefined> {
    const rows = await this.sql<{ run_id: string }[]>`
      SELECT run_id FROM public_gate_leak_runs WHERE journey_token = ${journeyToken} LIMIT 1
    `;
    return rows[0] ? this.getPublicGateLeakJourney(rows[0].run_id) : undefined;
  }

  async getPublicComputeResult(computeKey: string): Promise<unknown | undefined> {
    const rows = await this.sql<{ result: unknown }[]>`
      SELECT result FROM gate_leak_compute_cache
      WHERE compute_key = ${computeKey} AND state = 'complete'
      LIMIT 1
    `;
    return rows[0]?.result;
  }

  async claimPublicCompute(claim: PublicComputeClaim): Promise<PublicComputeClaimResult> {
    const rows = await this.sql<{ state: 'running' | 'complete' }[]>`
      INSERT INTO gate_leak_compute_cache (
        compute_key, state, owner_token, lease_expires_at, result, updated_at
      ) VALUES (
        ${claim.compute_key}, 'running', ${claim.owner_token},
        ${claim.lease_expires_at}::timestamptz, NULL, ${claim.claimed_at}::timestamptz
      )
      ON CONFLICT (compute_key) DO UPDATE SET
        state = 'running',
        owner_token = EXCLUDED.owner_token,
        lease_expires_at = EXCLUDED.lease_expires_at,
        result = NULL,
        updated_at = EXCLUDED.updated_at
      WHERE gate_leak_compute_cache.state = 'running'
        AND gate_leak_compute_cache.lease_expires_at <= ${claim.claimed_at}::timestamptz
      RETURNING state
    `;
    if (rows.length > 0) return 'claimed';
    const current = await this.sql<{ state: 'running' | 'complete' }[]>`
      SELECT state FROM gate_leak_compute_cache WHERE compute_key = ${claim.compute_key}
    `;
    return current[0]?.state === 'complete' ? 'complete' : 'busy';
  }

  async completePublicCompute(
    computeKey: string,
    ownerToken: string,
    result: unknown,
    completedAt: string,
  ): Promise<boolean> {
    const rows = await this.sql<{ compute_key: string }[]>`
      UPDATE gate_leak_compute_cache SET
        state = 'complete',
        result = ${this.sql.json(result as never)},
        updated_at = ${completedAt}::timestamptz
      WHERE compute_key = ${computeKey}
        AND state = 'running'
        AND owner_token = ${ownerToken}
        AND lease_expires_at > ${completedAt}::timestamptz
      RETURNING compute_key
    `;
    // Only this owner's guarded UPDATE is a successful completion. A different
    // owner may already have completed the key; false tells the caller to read
    // that winner rather than cache its own late, uncommitted result.
    return rows.length > 0;
  }

  async releasePublicCompute(computeKey: string, ownerToken: string): Promise<void> {
    await this.sql`
      DELETE FROM gate_leak_compute_cache
      WHERE compute_key = ${computeKey} AND state = 'running' AND owner_token = ${ownerToken}
    `;
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
