/**
 * S1-T4 (IMP-009/IMP-002) + S1-T5 — POST /v1/role-snapshot ingestion: the S1↔S3 seam.
 * S5-T1 — the store is keyed by (community, COLLECTION), not community alone.
 *
 * Covers: service-token auth (missing/wrong → 401), byte-exact sha256 integrity (missing/mismatch → 422),
 * schema validation (bad shape → 422; bad JSON → 400), the happy-path receipt, fail-closed mounting (no
 * ingest config → route 404), the audit reading the ingested snapshot (the seam), restart durability, and
 * the S5-T1 multi-collection invariants (siblings coexist; monotonicity is per-collection).
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAuditRouter, type AuditRouterDeps } from '../http/audit-router.js';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryNonceStore } from '../association-verifier.js';
import { FixedWindowRateLimiter } from '../rate-limiter.js';
import {
  makeInMemoryRoleStore,
  makeDurableRoleStore,
  RoleSnapshotConflictError,
  UndeclaredCollectionSourceError,
  type RoleSink,
} from '../role-store.js';
import { canonicalCollectionKey, type SourceResolver } from '../collection-union.js';
import type { OwnershipSource, RoleSource, WhaleSource } from '../audit-service.js';
import { collectionKey, type RoleSnapshot } from '../role-snapshot.js';
import type { CollectionRegistry } from '../ownership-source.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40);
const R3 = '0x' + '3'.repeat(40);
const Y = '0x' + '5'.repeat(40);
const OWNER = '0x' + '9'.repeat(40);
const CONTRACT = '0x' + 'a'.repeat(40);
// The SECOND gated collection of the SAME community — thj gates Honeycomb + HoneyJar1-6, each behind its
// own Discord role. This is the whole reason the store is keyed by collection (S5-T1).
const CONTRACT_B = '0x' + 'b'.repeat(40);
const CHAIN = '1'; // numeric chain id — the ratified collection identity (S5-T3)
const COLL_A = { chain: CHAIN, contract: CONTRACT };
const COLL_B = { chain: CHAIN, contract: CONTRACT_B };
const KEY_A = collectionKey(COLL_A);
const KEY_B = collectionKey(COLL_B);
const TOKEN = 'svc-ingest-token-do-not-guess';
// Snapshot captured at 11:00; NOW is 12:00 same day, threshold 24h → FRESH.
const NOW_MS = Date.UTC(2026, 5, 22, 12, 0, 0);

/** Both gated collections are audited by this deploy — the registry the ingest route gates against. */
const registry: CollectionRegistry = ({ chain, contract }) =>
  [KEY_A, KEY_B].includes(`${chain}/${contract}`.toLowerCase())
    ? { collection: 'c', standard: 'erc721' }
    : undefined;

/** Each gated collection stands alone here (one deployment each) — enough to exercise the key. */
const testSources: SourceResolver = ({ chain, contract }) => {
  const k = `${chain}/${contract}`.toLowerCase();
  return [KEY_A, KEY_B].includes(k) ? [{ chain, contract }] : undefined;
};

function snapshot(over: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    source: 'discord:guild:1',
    community: 'thj',
    collection: COLL_A,
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
    collectionRegistry: registry,
    sources: ({ chain, contract }) =>
      registry({ chain, contract }) ? [{ chain, contract }] : undefined,
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
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-type': 'application/json',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; community: string; entries: number };
    expect(body).toMatchObject({ ok: true, community: 'thj', collection: COLL_A, entries: 3 });
    // The ingested snapshot is now readable through the SAME store's load() (the seam).
    expect(await store.load(KEY_A)).toMatchObject({ community: 'thj' });
  });

  it('accepts both current and previous tokens during rotation', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(
      makeDeps({
        roles: store,
        ingest: { tokens: ['current-token', 'previous-token'], sink: store },
      }),
    );
    const raw = JSON.stringify(snapshot());
    const current = await postSnapshot(app, raw, {
      'x-ingest-token': 'current-token',
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(current.status).toBe(200);
    const previous = await postSnapshot(app, raw, {
      'x-ingest-token': 'previous-token',
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(previous.status).toBe(200);
  });

  it('bounds buffered ingest bodies without serializing sibling exports globally', async () => {
    let releaseStores!: () => void;
    let enteredStores = 0;
    let resolveTwoEntered!: () => void;
    const twoEntered = new Promise<void>((resolve) => {
      resolveTwoEntered = resolve;
    });
    const storesReleased = new Promise<void>((resolve) => {
      releaseStores = resolve;
    });
    const sink: RoleSink = {
      store: async () => {
        enteredStores += 1;
        if (enteredStores === 2) resolveTwoEntered();
        await storesReleased;
        return true;
      },
    };
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink } }));
    const raw = JSON.stringify(snapshot());
    const headers = {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    };

    const first = postSnapshot(app, raw, headers);
    const second = postSnapshot(app, raw, headers);
    await twoEntered;
    const third = await postSnapshot(app, raw, headers);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('1');

    releaseStores();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it('verifies sha256 against the received bytes before UTF-8 BOM decoding', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = '\uFEFF' + JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-type': 'application/json',
    });

    expect(res.status).toBe(200);
    expect(await store.load(KEY_A)).toMatchObject({ community: 'thj' });
  });

  it('rejects a MISSING service token with 401', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, { 'x-snapshot-sha256': sha256hex(raw) });
    expect(res.status).toBe(401);
    expect(await store.load(KEY_A)).toBeUndefined(); // nothing stored on auth failure
  });

  it('rejects a WRONG service token with 401', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN + 'x',
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a sha256 MISMATCH with 422 (tampered/truncated body)', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw + ' '), // hash of DIFFERENT bytes
    });
    expect(res.status).toBe(422);
    expect(await store.load(KEY_A)).toBeUndefined();
  });

  it('rejects a MISSING sha256 header with 422', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, { 'x-ingest-token': TOKEN });
    expect(res.status).toBe(422);
  });

  it('rejects an INVALID snapshot shape with 422 (never persists a wrong shape)', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify({ community: 'thj', entries: [] }); // missing required fields
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(422);
    expect(await store.load(KEY_A)).toBeUndefined();
  });

  it('rejects a future-dated snapshot before it can poison newest-wins ordering', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot({ captured_at: '2099-01-01T00:00:00.000Z' }));
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });

    expect(res.status).toBe(422);
    expect(await store.load(KEY_A)).toBeUndefined();
  });

  it('rejects INVALID json with 400', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink: store } }));
    const raw = '{not json';
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(400);
  });

  it('MONOTONICITY: a replayed/older snapshot never rolls the held one backwards', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
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
    expect((await store.load(KEY_A))?.captured_at).toBe('2026-06-22T11:30:00.000Z'); // still the newer one

    // An exact replay of the CURRENT snapshot is also a no-op (equal is not newer).
    expect(((await (await post(newer)).json()) as { stored: boolean }).stored).toBe(false);
  });

  it('refuses a community this deploy does not operate (403) — the community is a storage key', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
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
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-length': String(11 * 1024 * 1024), // declares > 10 MB cap
    });
    expect(res.status).toBe(413);
  });

  it.each(['-1', '1.5', '+1'])('rejects malformed Content-Length %s before reading the body', async (value) => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-length': value,
    });
    expect(res.status).toBe(400);
    expect(await store.load(KEY_A)).toBeUndefined();
  });

  it('aborts an oversized streamed body when Content-Length is absent', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const raw = 'x'.repeat(10 * 1024 * 1024 + 1);
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(413);
  });

  it('returns a structured retryable 503 when durable storage fails', async () => {
    const sink: RoleSink = {
      store: async () => {
        throw new Error('database unavailable');
      },
    };
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink } }));
    const raw = JSON.stringify(snapshot());
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await postSnapshot(app, raw, {
        'x-ingest-token': TOKEN,
        'x-snapshot-sha256': sha256hex(raw),
      });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: { code: 'snapshot-store-failed', retryable: true },
      });
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it('returns a non-retryable 409 for conflicting snapshots at one captured_at', async () => {
    const sink: RoleSink = {
      store: async () => {
        throw new RoleSnapshotConflictError();
      },
    };
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink } }));
    const raw = JSON.stringify(snapshot());
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await postSnapshot(app, raw, {
        'x-ingest-token': TOKEN,
        'x-snapshot-sha256': sha256hex(raw),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: { code: 'snapshot-version-conflict', retryable: false },
      });
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });

  it('returns a non-retryable 422 when the store cannot resolve the collection source', async () => {
    const sink: RoleSink = {
      store: async () => {
        throw new UndeclaredCollectionSourceError(CHAIN, CONTRACT);
      },
    };
    const app = createAuditRouter(makeDeps({ ingest: { token: TOKEN, sink } }));
    const raw = JSON.stringify(snapshot());
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: { code: 'collection-source-undeclared', retryable: false },
    });
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
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));

    // Before ingestion the audit has no role snapshot → it must NOT succeed with a real aggregate.
    const url = `/v1/audit?chain=${CHAIN}&contract=${CONTRACT}&snapshot_date=2026-06-22&community=thj&owner_wallet=${OWNER}&threshold=1`;
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

  it('refuses a collection this deploy does not audit (422) — the collection is a storage key too', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    const unknown = { chain: CHAIN, contract: '0x' + 'c'.repeat(40) };
    const raw = JSON.stringify(snapshot({ collection: unknown }));
    const res = await postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
    });
    // A typo'd contract would otherwise file the snapshot under a key no audit ever reads — every audit for
    // the REAL collection would then refuse "no snapshot" with no clue why. Reject at ingest, loudly.
    expect(res.status).toBe(422);
    expect(await store.load(collectionKey(unknown))).toBeUndefined();
  });
});

// ---- S5-T1: the store is keyed by (community, COLLECTION) --------------------------------------------
// thj gates SEVEN collections behind SEVEN Discord roles. Keyed by community alone, the HoneyJar1 export
// OVERWRITES the Honeycomb one and the Honeycomb audit computes stale-access against HoneyJar1's
// role-holders — a confidently-wrong audit. These are the tests that fail without the re-key.
describe('multi-collection role store (S5-T1)', () => {
  const postTo = (app: ReturnType<typeof createAuditRouter>, snap: RoleSnapshot) => {
    const raw = JSON.stringify(snap);
    return postSnapshot(app, raw, {
      'x-ingest-token': TOKEN,
      'x-snapshot-sha256': sha256hex(raw),
      'content-type': 'application/json',
    });
  };

  it('two collections of ONE community coexist — ingesting B does not overwrite A', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));

    const a = snapshot({ collection: COLL_A, entries: [{ discord_user_id: 'u1', wallet: R1, role_ids: ['honeycomb'] }] });
    const b = snapshot({ collection: COLL_B, entries: [{ discord_user_id: 'u2', wallet: R2, role_ids: ['hj1'] }] });
    expect((await postTo(app, a)).status).toBe(200);
    expect((await postTo(app, b)).status).toBe(200);

    // Each collection serves ITS OWN role-holders. Community-keyed, B's ingest would have replaced A's.
    expect((await store.load(KEY_A))?.entries).toEqual(a.entries);
    expect((await store.load(KEY_B))?.entries).toEqual(b.entries);
  });

  it('MONOTONICITY is per-collection: a replay of A cannot roll back B, and B cannot block A', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));

    const b2 = snapshot({ collection: COLL_B, captured_at: '2026-06-22T11:45:00.000Z' });
    const a1 = snapshot({ collection: COLL_A, captured_at: '2026-06-22T11:00:00.000Z' });
    const a2 = snapshot({ collection: COLL_A, captured_at: '2026-06-22T11:30:00.000Z' });

    expect(((await (await postTo(app, b2)).json()) as { stored: boolean }).stored).toBe(true);
    // A's FIRST snapshot is OLDER than B's held one — but they are different keys, so it must still store.
    // A shared `isNewer` comparison against "the community's latest" would reject it (a silent data loss).
    expect(((await (await postTo(app, a1)).json()) as { stored: boolean }).stored).toBe(true);
    // A newer A supersedes A...
    expect(((await (await postTo(app, a2)).json()) as { stored: boolean }).stored).toBe(true);
    // ...and a replayed older A is a no-op that touches NEITHER key.
    expect(((await (await postTo(app, a1)).json()) as { stored: boolean }).stored).toBe(false);

    expect((await store.load(KEY_A))?.captured_at).toBe('2026-06-22T11:30:00.000Z');
    expect((await store.load(KEY_B))?.captured_at).toBe('2026-06-22T11:45:00.000Z'); // never rolled back
  });

  it('the audit reads ITS collection: A ingested, B audited → refusal, never A’s role-holders', async () => {
    const store = makeInMemoryRoleStore('thj', testSources);
    const app = createAuditRouter(makeDeps({ roles: store, ingest: { token: TOKEN, sink: store } }));
    expect((await postTo(app, snapshot({ collection: COLL_A }))).status).toBe(200);

    const url = (contract: string) =>
      `/v1/audit?chain=${CHAIN}&contract=${contract}&snapshot_date=2026-06-22&community=thj&owner_wallet=${OWNER}&threshold=1`;
    expect((await app.request(url(CONTRACT))).status).toBe(200); // A has a snapshot → audits
    // B has NO snapshot. The ONLY honest answers are "refuse". Serving A's role-holders as B's would be the
    // silent catastrophe: B's on-chain holders diffed against A's Discord gate.
    expect((await app.request(url(CONTRACT_B))).status).not.toBe(200);
  });
});

describe('durable role store (S1-T4 — survives restart)', () => {
  it('a snapshot ingested into one store is recovered by a fresh store on the same dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const first = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    await first.store(snapshot());
    expect(await first.load(KEY_A)).toMatchObject({ community: 'thj' });

    // Simulate a replica restart: a NEW store over the same dir must recover the last snapshot.
    const rebooted = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    expect(await rebooted.load(KEY_A)).toMatchObject({ community: 'thj', entries: expect.any(Array) });
  });

  it('holds LATEST per (community, collection) — a second ingest of the SAME collection overwrites', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const store = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    await store.store(snapshot({ captured_at: '2026-06-22T11:00:00.000Z' }));
    await store.store(snapshot({ captured_at: '2026-06-22T11:30:00.000Z' }));
    const loaded = await store.load(KEY_A);
    expect(loaded?.captured_at).toBe('2026-06-22T11:30:00.000Z');
  });

  it('serializes overlapping writes for one key and retains the newest capture', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const store = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    const newer = snapshot({ captured_at: '2026-06-22T11:30:00.000Z' });
    const older = snapshot({ captured_at: '2026-06-22T11:00:00.000Z' });
    const results = await Promise.all([store.store(newer), store.store(older)]);
    expect(results).toEqual([true, false]);

    const rebooted = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    expect((await rebooted.load(KEY_A))?.captured_at).toBe(newer.captured_at);
  });

  it('S5-T1: sibling collections get their OWN files and both survive a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const store = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    await store.store(snapshot({ collection: COLL_A, entries: [{ discord_user_id: 'u1', wallet: R1, role_ids: ['honeycomb'] }] }));
    await store.store(snapshot({ collection: COLL_B, entries: [{ discord_user_id: 'u2', wallet: R2, role_ids: ['hj1'] }] }));

    // The filename is a hash of the (community, collection) key — one file per collection, no collision.
    const rebooted = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    expect((await rebooted.load(KEY_A))?.entries[0]?.wallet).toBe(R1);
    expect((await rebooted.load(KEY_B))?.entries[0]?.wallet).toBe(R2);
  });

  it('load() serves only the CONFIGURED community', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'role-store-'));
    const store: RoleSink & RoleSource = makeDurableRoleStore({ dir, community: 'thj', sources: testSources });
    await store.store(snapshot({ community: 'other-dao' }));
    expect(await store.load(KEY_A)).toBeUndefined(); // stored 'other-dao', but this deploy audits 'thj'
  });
});

/**
 * THE STORE ROUND-TRIP — the coverage hole that let a live bug through (2026-07-13).
 *
 * Sprint-5's review fixed the canonical-collection key on the READ path, and every unit test still passed
 * — because they all stub `RoleSource.load` directly and NEVER exercise the store. The WRITE path was
 * still filing snapshots under the DEPLOYMENT key. The first live probe after deploy did this:
 *
 *     POST /v1/role-snapshot  -> 200 {"stored":true}      (filed under "80094/0x886d…")
 *     GET  /v1/audit          -> 422 "no role snapshot"   (looked up "1/0xcb04…,80094/0x886d…")
 *
 * Stored successfully and invisible forever. Fakes pass; live finds it. This test closes the seam by
 * going through the REAL store, both ways.
 */
describe('store round-trip: any deployment of a collection addresses it', () => {
  const ETH = '0x' + 'e'.repeat(40);
  const BERA = '0x' + 'b'.repeat(40);
  /** ONE collection, TWO deployments — a bridged collection, which is the whole point of S5-T3. */
  const bridged: SourceResolver = ({ chain, contract }) => {
    const k = `${chain}/${contract}`.toLowerCase();
    return [`1/${ETH}`, `80094/${BERA}`].includes(k)
      ? [
          { chain: '1', contract: ETH },
          { chain: '80094', contract: BERA },
        ]
      : undefined;
  };

  it('a snapshot POSTed naming deployment A is found when the audit addresses deployment B', async () => {
    const store = makeInMemoryRoleStore('thj', bridged);
    // The exporter names the BERACHAIN deployment — as it naturally would.
    await store.store(snapshot({ collection: { chain: '80094', contract: BERA } }));

    // The audit is addressed via ETHEREUM. It looks the snapshot up by the CANONICAL key of the source
    // set — which both deployments resolve to. Before the fix this returned undefined and the audit
    // refused a community whose data was sitting right there.
    const canonical = canonicalCollectionKey(bridged({ chain: '1', contract: ETH })!);
    expect(await store.load(canonical)).toBeDefined();

    // ...and addressing it via berachain resolves to the very same key.
    expect(canonicalCollectionKey(bridged({ chain: '80094', contract: BERA })!)).toBe(canonical);
  });

  it('REFUSES to file a snapshot for an undeclared deployment (never under a key no audit can read)', async () => {
    const store = makeInMemoryRoleStore('thj', bridged);
    const rogue = snapshot({ collection: { chain: '1', contract: '0x' + 'f'.repeat(40) } });
    await expect(store.store(rogue)).rejects.toThrow(/not a declared collection source/);
  });
});
