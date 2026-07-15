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
});
