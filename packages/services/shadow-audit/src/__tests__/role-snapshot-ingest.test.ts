/**
 * S1-T4 (IMP-009/IMP-002) + S1-T5 — POST /v1/role-snapshot ingestion: the S1↔S3 seam.
 *
 * Covers: service-token auth (missing/wrong → 401), byte-exact sha256 integrity (missing/mismatch → 422),
 * schema validation (bad shape → 422; bad JSON → 400), the happy-path receipt, fail-closed mounting (no
 * ingest config → route 404), the audit reading the ingested snapshot (the seam), and restart durability.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditRouter, type AuditRouterDeps } from '../http/audit-router.js';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryNonceStore } from '../association-verifier.js';
import { FixedWindowRateLimiter } from '../rate-limiter.js';
import { makeInMemoryRoleStore, makeDurableRoleStore, type RoleSink } from '../role-store.js';
import type { OwnershipSource, RoleSource, WhaleSource } from '../audit-service.js';
import type { RoleSnapshot } from '../role-snapshot.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40);
const R3 = '0x' + '3'.repeat(40);
const Y = '0x' + '5'.repeat(40);
const OWNER = '0x' + '9'.repeat(40);
const CONTRACT = '0x' + 'a'.repeat(40);
const TOKEN = 'svc-ingest-token-do-not-guess';
// Snapshot captured at 11:00; NOW is 12:00 same day, threshold 24h → FRESH.
const NOW_MS = Date.UTC(2026, 5, 22, 12, 0, 0);

function snapshot(over: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    source: 'discord:guild:1',
    community: 'thj',
    captured_at: '2026-06-22T11:00:00.000Z',
    export_method: 'export',
    owner: OWNER,
    freshness_threshold_seconds: 86_400,
    entries: [
      { discord_user_id: 'u1', wallet: R1, role_ids: ['h'] },
      { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] },
      { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] },
    ],
    ...over,
  };
}

const ownership: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]), // R2 sold → stale; Y new
};
const whale: WhaleSource = { concentration: async () => 0.3 };

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function makeDeps(over: Partial<AuditRouterDeps> = {}): AuditRouterDeps {
  return {
    ownership,
    whale,
    roles: { load: async () => undefined },
    eventStore: new InMemoryEventStore(),
    rateLimiter: new FixedWindowRateLimiter({ limit: 100, windowMs: 60_000, now: () => NOW_MS }),
    auth: {
      recover: async () => OWNER,
      nonces: new InMemoryNonceStore(),
      isCommunityOwner: async () => true,
      domain: 'audit.thj',
      chainId: 1,
      scope: 'named-output',
      maxValiditySeconds: 3600,
    },
    isOperatedCommunity: () => true,
    cta: { product: '/shadow-access', conversation: '/talk' },
    now: () => NOW_MS,
    clientKey: (xff) => xff ?? 'default',
    k: 1,
    ...over,
  };
}

async function postSnapshot(
  app: ReturnType<typeof createAuditRouter>,
  raw: string,
  headers: Record<string, string>,
): Promise<Response> {
  return app.request('/v1/role-snapshot', { method: 'POST', headers, body: raw });
}

describe('POST /v1/role-snapshot ingestion (S1-T4)', () => {
  it('accepts a valid snapshot with correct token + sha256, returns a minimal receipt', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-type': 'application/json',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; community: string; entries: number };
    expect(body).toMatchObject({ ok: true, community: 'thj', entries: 3 });
    // The ingested snapshot is now readable through the SAME store's load() (the seam).
    expect(await store.load()).toMatchObject({ community: 'thj' });
  });

  it('rejects a MISSING service token with 401', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, { 'x-snapshot-sha256': sha256hex(raw) });
    expect(res.status).toBe(401);
    expect(await store.load()).toBeUndefined(); // nothing stored on auth failure
  });

  it('rejects a WRONG service token with 401', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN + 'x',
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a sha256 MISMATCH with 422 (tampered/truncated body)', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw + ' '), // hash of DIFFERENT bytes
    });
    expect(res.status).toBe(422);
    expect(await store.load()).toBeUndefined();
  });

  it('rejects a MISSING sha256 header with 422', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, { 'x-ingest-token': TOKEN });
    expect(res.status).toBe(422);
  });

  it('rejects an INVALID snapshot shape with 422 (never persists a wrong shape)', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify({ community: 'thj', entries: [] }); // missing required fields
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(422);
    expect(await store.load()).toBeUndefined();
  });

  it('rejects INVALID json with 400', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = '{not json';
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(400);
  });

  it('MONOTONICITY: a replayed/older snapshot never rolls the held one backwards', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const post = (snap: RoleSnapshot) => {
      const raw = JSON.stringify(snap);
      return postSnapshot(app, raw, {
        'x-ingest-token': TOKEN,
        'x-snapshot-sha256': sha256hex(raw),
        'content-type': 'application/json',
      });
    };

    const newer = snapshot({ captured_at: '2026-06-22T11:30:00.000Z' });
    const older = snapshot({ captured_at: '2026-06-22T10:00:00.000Z' });

    expect(((await (await post(newer)).json()) as { stored: boolean }).stored).toBe(true);

    // A delayed / replayed older export is a VALID, correctly-signed request (at-least-once delivery makes
    // this expected). It must be a successful no-op, not a rollback to stale role data.
    const res = await post(older);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { stored: boolean }).stored).toBe(false);
    expect((await store.load())?.captured_at).toBe('2026-06-22T11:30:00.000Z'); // still the newer one

    // An exact replay of the CURRENT snapshot is also a no-op (equal is not newer).
    expect(((await (await post(newer)).json()) as { stored: boolean }).stored).toBe(false);
  });

  it('refuses a community this deploy does not operate (403) — the community is a storage key', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(
      makeDeps({
        roles: store,
        ingest: { token: TOKEN, sink: store },
        isOperatedCommunity: (id) => id === 'thj',
      }),
    );
    const raw = JSON.stringify(snapshot({ community: 'someone-elses-dao' }));
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    // Without this gate a token-holder could mint unbounded distinct communities, each a new stored file.
    expect(res.status).toBe(403);
  });

  it('rejects an oversized body (413) — a valid token is not a licence to exhaust memory', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-length': String(11 * 1024 * 1024), // declares > 10 MB cap
    });
    expect(res.status).toBe(413);
  });

  it('does NOT mount the route when ingestion is unconfigured (fail-closed → 404)', async () => {
    const app = createAuditRouter(makeDeps()); // no `ingest`
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(404);
  });

  it('feeds the audit: an ingested snapshot drives the /v1/audit aggregate (the seam end-to-end)', async () => {
    const store = makeInMemoryRoleStore('thj');
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));

    // Before ingestion the audit has no role snapshot → it must NOT succeed with a real aggregate.
    const url = `/v1/audit?chain=ethereum&contract=${CONTRACT}&snapshot_date=2026-06-22&community=thj&owner_wallet=${OWNER}&threshold=1`;
    const before = await app.request(url);
    expect(before.status).not.toBe(200); // refusal: no snapshot yet

    // Ingest, then the same audit computes drift from the ingested snapshot.
    const raw = JSON.stringify(snapshot());
    const ing = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-type': 'application/json',
    });
    expect(ing.status).toBe(200);

    const after = await app.request(url);
    expect(after.status).toBe(200);
    const out = (await after.json()) as { aggregate: { stale_access: unknown } };
    expect(out.aggregate).toBeDefined(); // R2 sold → stale-access present; the audit read the ingested set
  });
});

describe('durable role store (S1-T4 — survives restart)', () => {
  it('a snapshot ingested into one store is recovered by a fresh store on the same dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const first = makeDurableRoleStore({ dir, community: 'thj' });
    await first.store(snapshot());
    expect(await first.load()).toMatchObject({ community: 'thj' });

    // Simulate a replica restart: a NEW store over the same dir must recover the last snapshot.
    const rebooted = makeDurableRoleStore({ dir, community: 'thj' });
    expect(await rebooted.load()).toMatchObject({ community: 'thj', entries: expect.any(Array) });
  });

  it('holds LATEST per community (a second ingest overwrites the first)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const store = makeDurableRoleStore({ dir, community: 'thj' });
    await store.store(snapshot({ captured_at: '2026-06-22T11:00:00.000Z' }));
    await store.store(snapshot({ captured_at: '2026-06-22T11:30:00.000Z' }));
    const loaded = await store.load();
    expect(loaded?.captured_at).toBe('2026-06-22T11:30:00.000Z');
  });

  it('load() serves only the CONFIGURED community', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const store: RoleSink & RoleSource = makeDurableRoleStore({ dir, community: 'thj' });
    await store.store(snapshot({ community: 'other-dao' }));
    expect(await store.load()).toBeUndefined(); // stored 'other-dao', but this deploy audits 'thj'
  });
});
