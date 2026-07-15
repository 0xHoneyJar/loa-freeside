/**
 * G-1 round-trip — through the REAL PostgresEventStore SQL, read back by the READER's
 * path (getRun), not a fake repository. This is the seam the InMemory double cannot
 * cover: a serialization/column/timestamp/CHECK bug is invisible until real SQL runs
 * (cf. the shadow-audit snapshot round-trip that passed every fake test yet broke
 * every live audit).
 *
 * Runs against REAL Postgres unconditionally: an external DATABASE_URL when provided
 * (CI), otherwise an in-process PGlite instance exposed over the wire protocol via a
 * socket server. Never a fake, never skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { connectPostgresEventStore, type PostgresEventStoreConnection } from '../event-store-postgres.js';
import type { RunEvent } from '../event-store.js';

const HASH = 'a'.repeat(64);

function publicRun(over: Partial<RunEvent> = {}): RunEvent {
  return {
    run_id: `risk_${'b'.repeat(24)}`,
    mode: 'public-gate-leak',
    inputs_hash: HASH,
    stale_set_size: 7,
    reruns: 0,
    ts: '2026-07-15T12:00:00.000Z',
    ...over,
  };
}

describe('PostgresEventStore round-trip (real SQL)', () => {
  const budget = { bucket: 'test', window_started_at: '2026-07-15T12:00:00.000Z', limit: 100 };
  let conn: PostgresEventStoreConnection;
  let pglite: PGlite | undefined;
  let socket: PGLiteSocketServer | undefined;

  beforeAll(async () => {
    let url = process.env.DATABASE_URL;
    if (!url) {
      // In-process real Postgres over the wire protocol — no external infra, no skip.
      pglite = await PGlite.create();
      const port = 5544 + Math.floor((Date.now() % 400)); // avoid a fixed-port collision across suites
      socket = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1' });
      await socket.start();
      url = `postgres://postgres@127.0.0.1:${port}/postgres`;
    }
    conn = connectPostgresEventStore(url);
    await conn.store.initialize();
  });

  afterAll(async () => {
    await conn?.close();
    await socket?.stop();
    await pglite?.close();
  });

  it('initialize() is idempotent', async () => {
    await expect(conn.store.initialize()).resolves.toBeUndefined();
  });

  it('registers a PUBLIC teaser run and reads it back through getRun', async () => {
    const run = publicRun();
    await conn.store.appendRunEvent(run);
    const got = await conn.store.getRun(run.run_id);
    expect(got).toBeDefined();
    expect(got!.inputs_hash).toBe(HASH);
    // timestamptz survives the round-trip as the same instant, ISO-normalized.
    expect(new Date(got!.ts).toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('binds a consented contact to a registered public run', async () => {
    const run = publicRun({ run_id: `risk_${'c'.repeat(24)}` });
    await conn.store.appendRunEvent(run);
    await expect(
      conn.store.appendContact({ run_id: run.run_id, contact: 'a@b.co', consent: true, ts: run.ts }),
    ).resolves.toBeUndefined();
  });

  it('rejects a contact bound to an unknown run (feedback cannot bind to a ghost)', async () => {
    await expect(
      conn.store.appendContact({
        run_id: 'risk_unknown',
        contact: 'a@b.co',
        consent: true,
        ts: '2026-07-15T12:00:00.000Z',
      }),
    ).rejects.toThrow(/unknown run_id/);
  });

  it('getRun returns the EARLIEST event for a run (stable fingerprint)', async () => {
    const id = `risk_${'d'.repeat(24)}`;
    await conn.store.appendRunEvent(
      publicRun({ run_id: id, ts: '2026-07-15T10:00:00.000Z', inputs_hash: 'e'.repeat(64) }),
    );
    await conn.store.appendRunEvent(
      publicRun({ run_id: id, ts: '2026-07-15T11:00:00.000Z', inputs_hash: 'f'.repeat(64) }),
    );
    const got = await conn.store.getRun(id);
    expect(got!.inputs_hash).toBe('e'.repeat(64)); // first appended wins
  });

  it('enforces the widened mode CHECK at the DB (aggregate-only provenance)', async () => {
    // A bogus mode must be rejected by the DB constraint, proving 0002 widened — not removed — the check.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = (conn.store as any).sql;
    await expect(
      sql`INSERT INTO shadow_audit_run_events (run_id, mode, inputs_hash, stale_set_size, reruns, ts)
          VALUES ('x', 'not-a-mode', ${HASH}, 0, 0, NOW())`,
    ).rejects.toThrow();
  });

  it('round-trips an appended needs_input -> delivered journey without digest mutation', async () => {
    const run = {
      run_id: 'gate_round_trip',
      journey_token: 'journey_round_trip',
      subject: { chain_id: '80094', contract_address: `0x${'a'.repeat(40)}` },
      inputs_hash: '1'.repeat(64),
      threshold: 1,
      outcome: 'needs_input' as const,
      ts: '2026-07-15T12:00:00.000Z',
    };
    expect(await conn.store.appendPublicGateLeakRun(run, budget)).toEqual({ created: true });
    expect(await conn.store.appendPublicGateLeakRun(run, budget)).toEqual({ created: false });
    await conn.store.appendPublicJourneyInput({
      run_id: run.run_id,
      input: 'access_started_at',
      value: '2026-06-01',
      ts: '2026-07-15T12:01:00.000Z',
    });
    await conn.store.appendPublicJourneyTransition({
      run_id: run.run_id,
      outcome: 'delivered_e1',
      ts: '2026-07-15T12:02:00.000Z',
    });
    const folded = await conn.store.getPublicGateLeakJourney(run.run_id);
    expect(folded?.inputs_hash).toBe(run.inputs_hash);
    expect(folded?.outcome).toBe('needs_input');
    expect(folded?.current_outcome).toBe('delivered_e1');
    expect(folded?.supplied_access_started_at).toBe('2026-06-01');
  });

  it('serializes terminal transitions and persists a distributed compute result', async () => {
    const run = {
      run_id: 'gate_serialized',
      journey_token: 'journey_serialized',
      subject: { chain_id: '1', contract_address: `0x${'b'.repeat(40)}` },
      inputs_hash: '2'.repeat(64),
      threshold: 1,
      outcome: 'needs_input' as const,
      ts: '2026-07-15T12:00:00.000Z',
    };
    await conn.store.appendPublicGateLeakRun(run, budget);
    await conn.store.appendPublicJourneyTransition({
      run_id: run.run_id,
      outcome: 'delivered_e1',
      ts: '2026-07-15T12:01:00.000Z',
    });
    await expect(
      conn.store.appendPublicJourneyTransition({
        run_id: run.run_id,
        outcome: 'refused',
        refusal_code: 'rate-limited',
        ts: '2026-07-15T12:02:00.000Z',
      }),
    ).rejects.toThrow(/terminal public journey/);

    const claim = {
      compute_key: 'e'.repeat(64),
      owner_token: 'pg-owner-a',
      claimed_at: '2026-07-15T12:00:00.000Z',
      lease_expires_at: '2026-07-15T12:02:00.000Z',
    };
    expect(await conn.store.claimPublicCompute(claim)).toBe('claimed');
    expect(await conn.store.claimPublicCompute({ ...claim, owner_token: 'pg-owner-b' })).toBe('busy');
    expect(
      await conn.store.completePublicCompute(claim.compute_key, claim.owner_token, { aggregate: true }, claim.claimed_at),
    ).toBe(true);
    expect(await conn.store.getPublicComputeResult(claim.compute_key)).toEqual({ aggregate: true });
    expect(
      await conn.store.completePublicCompute(
        claim.compute_key,
        'pg-owner-b',
        { aggregate: false },
        claim.claimed_at,
      ),
    ).toBe(false);
    expect(await conn.store.getPublicComputeResult(claim.compute_key)).toEqual({ aggregate: true });

    const expired = {
      ...claim,
      compute_key: 'c'.repeat(64),
      owner_token: 'pg-expired-owner',
      lease_expires_at: '2026-07-15T12:00:01.000Z',
    };
    expect(await conn.store.claimPublicCompute(expired)).toBe('claimed');
    expect(
      await conn.store.completePublicCompute(
        expired.compute_key,
        expired.owner_token,
        { stale: true },
        '2026-07-15T12:00:02.000Z',
      ),
    ).toBe(false);
    expect(await conn.store.getPublicComputeResult(expired.compute_key)).toBeUndefined();
  });

  it('charges the durable write budget only for a newly created journey', async () => {
    const tight = { bucket: 'tight-test', window_started_at: '2026-07-15T13:00:00.000Z', limit: 1 };
    const first = {
      run_id: 'gate_budget_a',
      journey_token: 'journey_budget_a',
      subject: { chain_id: '1', contract_address: `0x${'c'.repeat(40)}` },
      inputs_hash: '3'.repeat(64),
      threshold: 1,
      outcome: 'submitted' as const,
      ts: '2026-07-15T13:00:00.000Z',
    };
    expect(await conn.store.appendPublicGateLeakRun(first, tight)).toEqual({ created: true });
    expect(await conn.store.appendPublicGateLeakRun(first, tight)).toEqual({ created: false });
    expect(
      await conn.store.appendPublicGateLeakRun(
        {
          ...first,
          run_id: 'gate_budget_b',
          journey_token: 'journey_budget_b',
          inputs_hash: '4'.repeat(64),
        },
        tight,
      ),
    ).toEqual({ created: false, rate_limited: true });
  });

  it('dedupes attention per journey+kind but counts a distinct journey', async () => {
    const event = {
      subject_chain_id: '80094',
      subject_contract_address: `0x${'a'.repeat(40)}`,
      journey_token: 'journey_attention_1',
      kind: 'submitted' as const,
      ts: '2026-07-15T12:00:00.000Z',
    };
    expect(await conn.store.appendAttention(event)).toEqual({ created: true });
    expect(await conn.store.appendAttention(event)).toEqual({ created: false });
    expect(await conn.store.appendAttention({ ...event, journey_token: 'journey_attention_2' })).toEqual({ created: true });
  });

  it('widens an already-existing NAMED narrow mode CHECK', async () => {
    // Regression: initialize() previously excluded the named constraint from its drop loop,
    // then saw the name existed and left the old dogfood-only CHECK in place.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = (conn.store as any).sql;
    await sql`DELETE FROM shadow_audit_run_events WHERE mode = 'public-gate-leak'`;
    await sql`ALTER TABLE shadow_audit_run_events DROP CONSTRAINT shadow_audit_run_events_mode_check`;
    await sql`ALTER TABLE shadow_audit_run_events ADD CONSTRAINT shadow_audit_run_events_mode_check CHECK (mode = 'dogfood-full')`;
    await conn.store.initialize();
    await expect(
      conn.store.appendRunEvent(publicRun({ run_id: `risk_${'9'.repeat(24)}` })),
    ).resolves.toBeUndefined();
  });
});
