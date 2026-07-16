import { describe, it, expect } from 'vitest';
import { createAuditRouter, type AuditRouterDeps } from '../http/audit-router.js';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryNonceStore } from '../association-verifier.js';
import { FixedWindowRateLimiter } from '../rate-limiter.js';
import type { OwnershipSource, RoleSource, WhaleSource } from '../audit-service.js';
import type { SourceResolver } from '../collection-union.js';
import type { RoleSnapshot } from '../role-snapshot.js';

const R1 = '0x' + '1'.repeat(40);
const R2 = '0x' + '2'.repeat(40);
const R3 = '0x' + '3'.repeat(40);
const Y = '0x' + '5'.repeat(40);
const OWNER = '0x' + '9'.repeat(40);
const CONTRACT = '0x' + 'a'.repeat(40);
const NOW_MS = Date.UTC(2026, 5, 22, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);

function snapshot(): RoleSnapshot {
  return {
    source: 'discord:guild:1',
    community: 'thj',
    collection: { chain: '1', contract: CONTRACT }, // the gated collection these roles are for
    captured_at: '2026-06-22T11:00:00.000Z',
    export_method: 'export',
    owner: OWNER,
    freshness_threshold_seconds: 86_400,
    entries: [
      { discord_user_id: 'u1', wallet: R1, role_ids: ['h'] },
      { discord_user_id: 'u2', wallet: R2, role_ids: ['h'] },
      { discord_user_id: 'u3', wallet: R3, role_ids: ['h'] },
    ],
  };
}
const ownership: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => new Map([[R1, 1n], [R2, 1n], [R3, 1n]]),
  currentBalances: async () => new Map([[R1, 1n], [R3, 1n], [Y, 1n]]), // R2 sold → stale; Y new
};
const whale: WhaleSource = { concentration: async () => 0.3 };
const roles: RoleSource = { load: async () => snapshot() };

/** The fixture collection has ONE declared deployment (chain 1) — see audit-service.test.ts for the union. */
const sources: SourceResolver = () => [{ chain: '1', contract: CONTRACT }];

function makeDeps(over: Partial<AuditRouterDeps> = {}): AuditRouterDeps {
  return {
    ownership,
    whale,
    roles,
    sources,
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
    publicJourneyBudget: { limit: 1_000, windowMs: 60_000 },
    k: 1,
    ...over,
  };
}

const GET_URL = `/v1/audit?chain=1&contract=${CONTRACT}&snapshot_date=2026-06-22&community=thj&owner_wallet=${OWNER}&threshold=1`;

function namedBody() {
  return {
    chain: '1',
    contract: CONTRACT,
    snapshot_date: '2026-06-22',
    community: 'thj',
    owner_wallet: OWNER,
    threshold: '1',
    auth: {
      message: {
        nonce: 'nonce-router-0001',
        issued_at: NOW_S - 100,
        expiry: NOW_S + 1000,
        domain: 'audit.thj',
        chain_id: 1,
        contract: CONTRACT,
        community_id: 'thj',
        scope: 'named-output',
      },
      signature: '0xsig',
      ownerWallet: OWNER,
    },
  };
}
function post(app: ReturnType<typeof createAuditRouter>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /v1/audit (anonymous aggregate)', () => {
  it('returns the k-anon aggregate, no records', async () => {
    const res = await createAuditRouter(makeDeps()).request(GET_URL);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.records).toBeUndefined();
    expect(json.aggregate.stale_access).toEqual({ kind: 'exact', value: 1 }); // k=1
    expect(json.run_id).toMatch(/^run_[0-9a-f]{24}$/);
  });

  it('refuses out-of-scope gating with 422', async () => {
    const res = await createAuditRouter(makeDeps()).request(`${GET_URL}&gating=lp-stake`);
    expect(res.status).toBe(422);
  });

  it('refuses an external (non-operated) community with 422', async () => {
    const res = await createAuditRouter(makeDeps({ isOperatedCommunity: () => false })).request(GET_URL);
    expect(res.status).toBe(422);
  });

  it('rate-limits with 429', async () => {
    const app = createAuditRouter(
      makeDeps({ rateLimiter: new FixedWindowRateLimiter({ limit: 1, windowMs: 60_000, now: () => NOW_MS }) }),
    );
    expect((await app.request(GET_URL)).status).toBe(200);
    expect((await app.request(GET_URL)).status).toBe(429);
  });
});

describe('POST /v1/audit (named output, authed)', () => {
  it('returns records for a valid, community-bound signature', async () => {
    const res = await post(createAuditRouter(makeDeps()), '/v1/audit', namedBody());
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.records)).toBe(true);
  });

  it('rejects a bad signature with 401', async () => {
    const deps = makeDeps({
      auth: { ...makeDeps().auth, recover: async () => '0x' + 'd'.repeat(40) },
    });
    const res = await post(createAuditRouter(deps), '/v1/audit', namedBody());
    expect(res.status).toBe(401);
  });

  it('rejects when the signed contract differs from the request body (BB-1)', async () => {
    const body = namedBody();
    body.auth.message.contract = '0x' + 'e'.repeat(40);
    const res = await post(createAuditRouter(makeDeps()), '/v1/audit', body);
    expect(res.status).toBe(401);
  });

  it('rejects when the authed signer is not the order owner_wallet (BB-1)', async () => {
    const W = '0x' + 'e'.repeat(40);
    const body = namedBody(); // order owner_wallet = OWNER
    body.auth.ownerWallet = W;
    const deps = makeDeps({ auth: { ...makeDeps().auth, recover: async () => W } });
    const res = await post(createAuditRouter(deps), '/v1/audit', body);
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/audit/{reaction,contact} (run lifecycle + consent)', () => {
  it('accepts a reaction for a live run, 404s an unknown run', async () => {
    const app = createAuditRouter(makeDeps());
    const { run_id } = (await (await app.request(GET_URL)).json()) as any;
    expect((await post(app, '/v1/audit/reaction', { run_id, reaction: 'expected' })).status).toBe(200);
    expect((await post(app, '/v1/audit/reaction', { run_id: 'nope', reaction: 'expected' })).status).toBe(404);
  });

  it('requires consent for contact capture', async () => {
    const app = createAuditRouter(makeDeps());
    const { run_id } = (await (await app.request(GET_URL)).json()) as any;
    expect((await post(app, '/v1/audit/contact', { run_id, contact: 'me@x.com' })).status).toBe(400);
    expect((await post(app, '/v1/audit/contact', { run_id, contact: 'me@x.com', consent: true })).status).toBe(200);
  });

  it('accepts a form-encoded reaction (BLOCK-1)', async () => {
    const app = createAuditRouter(makeDeps());
    const { run_id } = (await (await app.request(GET_URL)).json()) as any;
    const res = await app.request('/v1/audit/reaction', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ run_id, reaction: 'expected' }).toString(),
    });
    expect([200, 303]).toContain(res.status);
  });

  it('rate-limits the reaction endpoint (SEC-M2)', async () => {
    const app = createAuditRouter(
      makeDeps({ rateLimiter: new FixedWindowRateLimiter({ limit: 1, windowMs: 60_000, now: () => NOW_MS }) }),
    );
    await app.request(GET_URL); // consumes the single token
    const res = await post(app, '/v1/audit/reaction', { run_id: 'x', reaction: 'expected' });
    expect(res.status).toBe(429);
  });
});

describe('GET /v1/audit/view (thin dashboard HTML)', () => {
  it('renders the aggregate, the reaction prompt, and the dual CTA', async () => {
    const res = await createAuditRouter(makeDeps()).request(`/v1/audit/view${GET_URL.slice(GET_URL.indexOf('?'))}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Shadow Access Audit');
    expect(html).toContain('Does this match what you expected?');
    expect(html).toContain('/shadow-access'); // product CTA
    expect(html).toContain('/talk'); // conversation CTA
  });

  it('LEADS with the assumption-free side-by-side, and labels each floor with its violation direction (S5-T4)', async () => {
    const res = await createAuditRouter(makeDeps()).request(`/v1/audit/view${GET_URL.slice(GET_URL.indexOf('?'))}`);
    expect(res.status).toBe(200);
    const html = await res.text();

    // THE HEADLINE — two measured facts, no derivation. This is the DoD's "sees its real drift, NEXT TO its
    // incumbent roles", and it is the ONLY part of this page that is true at 0% identity coverage.
    expect(html).toContain('Your role, next to the chain');
    expect(html).toContain('members</strong> hold the role');
    expect(html).toContain('Both numbers are measured. No identity data, no assumptions.');
    // The side-by-side must come BEFORE the wallet-matched cohorts — the floors are never the headline.
    expect(html.indexOf('Your role, next to the chain')).toBeLessThan(
      html.indexOf('Members we could match to a wallet'),
    );

    // …and every floor carries its assumption + the direction it errs when that assumption breaks, and says
    // it bounds WALLETS. A floor rendered as a bare number about PEOPLE is the failure mode.
    expect(html).toContain('wallets</strong>');
    expect(html).toContain('Holds only if no two role members hold the role through the same wallet');
    expect(html).toContain('Holds only if each role member holds the collection through at most one wallet');
    expect(html).toContain('<strong>overstates</strong>');
    // whitespace-insensitive: the CLAIM is load-bearing, the template's line-wrapping is not.
    expect(html.replace(/\s+/g, ' ')).toContain('It bounds WALLETS, not people: one person with ten wallets is ten holders.');
  });
});

describe('GET /v1/collections/:chain/:contract — capability read (FR-2)', () => {
  const registry = (m: Record<string, { collection: string; standard: 'erc721' | 'erc1155' }>) =>
    ({ chain, contract }: { chain: string; contract: string }) =>
      m[`${chain}/${contract}`.toLowerCase()];

  it('200 {collection, standard} for an in-registry pair', async () => {
    const app = createAuditRouter(
      makeDeps({ collectionRegistry: registry({ '1/0xabc': { collection: 'azuki', standard: 'erc721' } }) }),
    );
    const res = await app.request('/v1/collections/1/0xABC');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ chain: '1', contract: '0xABC', collection: 'azuki', standard: 'erc721' });
  });

  it('404 for an unknown pair', async () => {
    const app = createAuditRouter(
      makeDeps({ collectionRegistry: registry({ '1/0xabc': { collection: 'azuki', standard: 'erc721' } }) }),
    );
    const res = await app.request('/v1/collections/1/0xDEAD');
    expect(res.status).toBe(404);
  });

  it('503 when no registry is wired (never a false 200)', async () => {
    const app = createAuditRouter(makeDeps()); // collectionRegistry undefined
    const res = await app.request('/v1/collections/1/0xABC');
    expect(res.status).toBe(503);
  });

  it('returns NO member data (membership + static config only)', async () => {
    const app = createAuditRouter(
      makeDeps({ collectionRegistry: registry({ '10/0xed5a': { collection: 'op-thing', standard: 'erc1155' } }) }),
    );
    const body = (await (await app.request('/v1/collections/10/0xED5A')).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['chain', 'collection', 'contract', 'standard']);
  });
});

/**
 * Bug 20260712-486383 — the signal must reach THE WIRE, not just `runAudit`'s return value.
 *
 * `uncertain` was already returned by runAudit — and dropped by every JSON route (it was once a
 * top-level field and was REMOVED because it broke the dashboard's strict decode). So "flip
 * uncertain" was a no-op fix: the JSON channel the dashboard reads carried no signal at all.
 */
describe('role coverage on the wire (bug 20260712-486383)', () => {
  /** `matchedCount` of `total` role-holders resolve to a wallet. */
  function coverageRoles(matchedCount: number, total: number): RoleSource {
    return {
      load: async () => ({
        ...snapshot(),
        entries: Array.from({ length: total }, (_, i) =>
          i < matchedCount
            ? {
                discord_user_id: `u${i}`,
                wallet: '0x' + (i + 1).toString(16).padStart(40, '0'),
                role_ids: ['h'],
              }
            : { discord_user_id: `u${i}`, role_ids: ['h'] },
        ),
      }),
    };
  }

  it('GET /v1/audit REFUSES 422 role-coverage-too-low for the real 1/515 THJ shape', async () => {
    const app = createAuditRouter(makeDeps({ roles: coverageRoles(1, 515) }));
    const res = await app.request(GET_URL);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; reason: string; retryable: boolean } };
    expect(body.error.code).toBe('role-coverage-too-low');
    expect(body.error.reason).toContain('515'); // names what we cannot see
    expect(body.error.retryable).toBe(false); // re-running changes nothing; the missing links do
  });

  it('GET /v1/audit (the JSON channel the dashboard reads) carries the coverage signal', async () => {
    // 14/20 = 70%: served, but labelled. 6 unmatched >= k → exact cohort, so the ratio is publishable.
    const app = createAuditRouter(makeDeps({ roles: coverageRoles(14, 20), k: 5 }));
    const res = await app.request(GET_URL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aggregate: {
        coverage_uncertain: boolean;
        role_coverage: number | null;
        unmatched_role_holders: { kind: string; value?: number };
      };
    };
    expect(body.aggregate.coverage_uncertain).toBe(true);
    expect(body.aggregate.role_coverage).toBe(0.7);
    expect(body.aggregate.unmatched_role_holders).toEqual({ kind: 'exact', value: 6 });
  });

  it('GET /v1/audit/view names the blind spot instead of calling it "stale"', async () => {
    const app = createAuditRouter(makeDeps({ roles: coverageRoles(14, 20), k: 5 }));
    const res = await app.request(GET_URL.replace('/v1/audit?', '/v1/audit/view?'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('could only resolve');
    expect(html).toContain('could not resolve');
    // The snapshot is FRESH — calling it stale would be its own small lie.
    expect(html).not.toContain('snapshot is stale');
  });
});

describe('GET /v1/access-risk registers the PUBLIC run (G-2 — feedback can now bind)', () => {
  const registry =
    (m: Record<string, { collection: string; standard: 'erc721' | 'erc1155' }>) =>
    ({ chain, contract }: { chain: string; contract: string }) =>
      m[`${chain}/${contract}`.toLowerCase()];
  const ACCESS_RISK_URL = `/v1/access-risk?chain=1&contract=${CONTRACT}&snapshot_date=2026-06-22&threshold=1`;
  const gateLeakDeps = (over: Partial<AuditRouterDeps> = {}) =>
    makeDeps({
      collectionRegistry: registry({ [`1/${CONTRACT}`]: { collection: 'thj', standard: 'erc721' } }),
      ...over,
    });

  it('registers the teaser run so getRun resolves it and a reaction binds (was a 404 ghost)', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps({ eventStore }));
    const res = await app.request(ACCESS_RISK_URL);
    expect(res.status).toBe(200);
    const { run_id } = (await res.json()) as { run_id: string };
    expect(run_id).toMatch(/^risk_/);
    // The run is now durably registered under the public-gate-leak mode.
    expect(await eventStore.getRun(run_id)).toBeDefined();
    // ...so a reaction BINDS (before registration this returned 404 — the teaser run_id backed no event).
    expect((await post(app, '/v1/audit/reaction', { run_id, reaction: 'expected' })).status).toBe(200);
    // A consented contact binds too.
    expect(
      (await post(app, '/v1/audit/contact', { run_id, contact: 'a@b.co', consent: true })).status,
    ).toBe(200);
  });

  it('registration carries NO member data — only aggregate provenance (RunEvent is .strict())', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps({ eventStore }));
    await app.request(ACCESS_RISK_URL);
    // The store accepted the run: the .strict() RunEvent schema would have thrown on any smuggled member
    // field, so a successful registration is itself the proof that only aggregate fields were written.
    expect(eventStore.counts().runEvents).toBe(1);
  });
});

describe('POST /v1/access-risk — typed resumable public journey (G-3, G-5)', () => {
  const registry =
    (m: Record<string, { collection: string; standard: 'erc721' | 'erc1155'; access_started_at?: string }>) =>
    ({ chain, contract }: { chain: string; contract: string }) =>
      m[`${chain}/${contract}`.toLowerCase()];
  const gateLeakDeps = (eventStore: InMemoryEventStore, accessStartedAt?: string) =>
    makeDeps({
      eventStore,
      collectionRegistry: registry({
        [`1/${CONTRACT}`]: {
          collection: 'thj',
          standard: 'erc721',
          ...(accessStartedAt ? { access_started_at: accessStartedAt } : {}),
        },
      }),
    });

  it('returns typed needs_input when no access-start is supplied or ratified', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore));
    const res = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
    });
    expect(res.status).toBe(428);
    const body = (await res.json()) as any;
    expect(body.journey.status).toEqual({ state: 'needs_input', required_input: 'access_started_at' });
    expect(body.journey.run_id).toMatch(/^gate_[0-9a-f]{32}$/);
    expect(eventStore.counts()).toMatchObject({ publicRuns: 1, attention: 2, runEvents: 1 });
  });

  it('appends access_started_at and resumes the SAME journey to delivered_e1', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore));
    const first = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
    });
    const firstBody = (await first.json()) as any;
    const runBefore = await eventStore.getPublicGateLeakJourney(firstBody.journey.run_id);

    const resumed = await post(app, `/v1/access-risk/${firstBody.journey.run_id}/resume`, {
      access_started_at: '2026-06-22',
      journey_token: firstBody.journey.journey_token,
    });
    expect(resumed.status).toBe(200);
    const resumedBody = (await resumed.json()) as any;
    expect(resumedBody.journey.run_id).toBe(firstBody.journey.run_id);
    expect(resumedBody.journey.journey_token).toBe(firstBody.journey.journey_token);
    expect(resumedBody.journey.status).toEqual({ state: 'delivered_e1' });
    expect(resumedBody.report.run_id).toBe(firstBody.journey.run_id);

    const runAfter = await eventStore.getPublicGateLeakJourney(firstBody.journey.run_id);
    expect(runAfter?.inputs_hash).toBe(runBefore?.inputs_hash); // original digest is immutable
    expect(runAfter?.outcome).toBe('submitted'); // first event remains historical truth
    expect(runAfter?.current_outcome).toBe('delivered_e1');
    expect(runAfter?.supplied_access_started_at).toBe('2026-06-22');

    const poll = await app.request(`/v1/access-risk/${firstBody.journey.run_id}?journey_token=${encodeURIComponent(firstBody.journey.journey_token)}`);
    expect(poll.status).toBe(200);
    expect(((await poll.json()) as any).journey.status).toEqual({ state: 'delivered_e1' });
  });

  it('persists retry transitions before returning delivered (ledger is response truth)', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore));
    const first = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
    });
    const firstBody = (await first.json()) as any;
    const retried = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
      journey_token: firstBody.journey.journey_token,
      access_started_at: '2026-06-22',
    });
    expect(retried.status).toBe(200);
    const retriedBody = (await retried.json()) as any;
    expect(retriedBody.journey.run_id).toBe(firstBody.journey.run_id);
    expect((await eventStore.getPublicGateLeakJourney(firstBody.journey.run_id))?.current_outcome).toBe('delivered_e1');
  });

  it('rejects malformed subjects, impossible dates, and future dates before persistence', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore));
    for (const body of [
      { chain: 'ethereum', contract: CONTRACT },
      { chain: '1', contract: '0xabc' },
      { chain: '1', contract: CONTRACT, access_started_at: '2026-02-31' },
      { chain: '1', contract: CONTRACT, access_started_at: '2027-01-01' },
    ]) {
      expect((await post(app, '/v1/access-risk', body)).status).toBe(400);
    }
    expect(eventStore.counts().publicRuns).toBe(0);
  });

  it('rejects a caller-chosen retry token unless the server already issued it', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore));
    const response = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
      journey_token: 'predictable-token',
    });
    expect(response.status).toBe(404);
    expect(eventStore.counts().publicRuns).toBe(0);
  });

  it('bounds new durable journeys independently of caller identity', async () => {
    const eventStore = new InMemoryEventStore();
    const bounded = createAuditRouter({
      ...gateLeakDeps(eventStore),
      publicJourneyBudget: { limit: 1, windowMs: 60_000 },
    });
    expect((await post(bounded, '/v1/access-risk', { chain: '1', contract: CONTRACT })).status).toBe(428);
    expect((await post(bounded, '/v1/access-risk', { chain: '1', contract: CONTRACT })).status).toBe(429);
    expect(eventStore.counts().publicRuns).toBe(1);
  });

  it('uses a ratified registry access-start without silently inventing a date', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore, '2026-06-22'));
    const res = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.journey.status).toEqual({ state: 'delivered_e1' });
    expect((await eventStore.getPublicGateLeakJourney(body.journey.run_id))?.supplied_access_started_at).toBe('2026-06-22');
    const conflict = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
      journey_token: body.journey.journey_token,
      access_started_at: '2026-06-21',
    });
    expect(conflict.status).toBe(409);
    expect((await eventStore.getPublicGateLeakJourney(body.journey.run_id))?.supplied_access_started_at).toBe('2026-06-22');
  });

  it('counts two demand journeys while doing the expensive subject/input compute once', async () => {
    const eventStore = new InMemoryEventStore();
    let snapshotCalls = 0;
    const countingOwnership: OwnershipSource = {
      ...ownership,
      resolveSnapshotBlock: async (args) => {
        snapshotCalls++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ownership.resolveSnapshotBlock(args);
      },
    };
    const sharedDeps = makeDeps({
        eventStore,
        ownership: countingOwnership,
        collectionRegistry: registry({
          [`1/${CONTRACT}`]: {
            collection: 'thj',
            standard: 'erc721',
            access_started_at: '2026-06-22',
          },
        }),
      });
    const firstReplica = createAuditRouter(sharedDeps);
    const secondReplica = createAuditRouter(sharedDeps);
    const [first, second] = await Promise.all([
      post(firstReplica, '/v1/access-risk', {
        chain: '1',
        contract: CONTRACT,
      }),
      post(secondReplica, '/v1/access-risk', {
        chain: '1',
        contract: CONTRACT,
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 202]);
    const firstBody = (await first.json()) as any;
    const secondBody = (await second.json()) as any;
    expect(firstBody.journey.run_id).not.toBe(secondBody.journey.run_id);
    const pendingToken = first.status === 202
      ? firstBody.journey.journey_token
      : secondBody.journey.journey_token;
    const settled = await post(secondReplica, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
      journey_token: pendingToken,
    });
    expect(settled.status).toBe(200);
    expect(snapshotCalls).toBe(1);
    expect(eventStore.counts()).toMatchObject({ publicRuns: 2, attention: 4, runEvents: 2 });
  });

  it('does not commit or cache a compute result after its distributed lease expires', async () => {
    const eventStore = new InMemoryEventStore();
    let clock = NOW_MS;
    let snapshotCalls = 0;
    const slowOwnership: OwnershipSource = {
      ...ownership,
      resolveSnapshotBlock: async (args) => {
        snapshotCalls++;
        clock += 2;
        return ownership.resolveSnapshotBlock(args);
      },
    };
    const app = createAuditRouter(makeDeps({
      eventStore,
      ownership: slowOwnership,
      now: () => clock,
      publicComputeLeaseMs: 1,
      collectionRegistry: registry({
        [`1/${CONTRACT}`]: {
          collection: 'thj',
          standard: 'erc721',
          access_started_at: '2026-06-22',
        },
      }),
    }));

    const first = await post(app, '/v1/access-risk', { chain: '1', contract: CONTRACT });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as any;
    expect(
      (
        await post(app, '/v1/access-risk', {
          chain: '1',
          contract: CONTRACT,
          journey_token: firstBody.journey.journey_token,
        })
      ).status,
    ).toBe(202);
    expect(snapshotCalls).toBe(2); // the stale first result never entered either cache
    expect(eventStore.counts().runEvents).toBe(0);
  });

  it('returns the concurrent durable delivery instead of the losing attempted refusal', async () => {
    class ConcurrentDeliveryStore extends InMemoryEventStore {
      private winnerVisible = false;

      override async appendPublicJourneyTransition(
        event: Parameters<InMemoryEventStore['appendPublicJourneyTransition']>[0],
      ): Promise<{ created: boolean }> {
        if (event.outcome === 'refused') {
          await super.appendPublicJourneyTransition({
            ...event,
            outcome: 'delivered_e1',
            refusal_code: undefined,
          });
          this.winnerVisible = true;
        }
        return super.appendPublicJourneyTransition(event);
      }

      override async getPublicComputeResult(): Promise<unknown | undefined> {
        return this.winnerVisible ? { concurrent_winner: true } : undefined;
      }
    }

    const eventStore = new ConcurrentDeliveryStore();
    const app = createAuditRouter(makeDeps({
      eventStore,
      teaserBudget: {
        check: () => ({ allowed: false, remaining: 0, retryAfterMs: 60_000 }),
      },
      collectionRegistry: registry({
        [`1/${CONTRACT}`]: {
          collection: 'thj',
          standard: 'erc721',
          access_started_at: '2026-06-22',
        },
      }),
    }));

    const response = await post(app, '/v1/access-risk', { chain: '1', contract: CONTRACT });
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.journey.status).toEqual({ state: 'delivered_e1' });
    expect(body.report.concurrent_winner).toBe(true);
    expect(body.error).toBeUndefined();
  });

  it('keeps every public exit channel member-free and sub-k-safe', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(gateLeakDeps(eventStore));
    const needs = await post(app, '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
    });
    const serializedNeeds = JSON.stringify(await needs.json());
    for (const forbidden of ['wallet', 'email', 'role_ids', 'sub_k_denominator', 'free_text']) {
      expect(serializedNeeds).not.toContain(forbidden);
    }

    const refused = await post(createAuditRouter(makeDeps({ eventStore })), '/v1/access-risk', {
      chain: '1',
      contract: CONTRACT,
    });
    const serializedRefusal = JSON.stringify(await refused.json());
    for (const forbidden of ['wallet', 'email', 'role_ids', 'sub_k_denominator', 'free_text']) {
      expect(serializedRefusal).not.toContain(forbidden);
    }
  });
});

describe('POST /v1/access-risk/:runId/interaction — public demand signal (FR-11 · G-7)', () => {
  const registry =
    (m: Record<string, { collection: string; standard: 'erc721' | 'erc1155'; access_started_at?: string }>) =>
    ({ chain, contract }: { chain: string; contract: string }) =>
      m[`${chain}/${contract}`.toLowerCase()];
  // A registry that DELIVERS an E1 for CONTRACT, so a submit registers a durable public run to interact with.
  const interactionDeps = (eventStore: InMemoryEventStore, over: Partial<AuditRouterDeps> = {}) =>
    makeDeps({
      eventStore,
      collectionRegistry: registry({
        [`1/${CONTRACT}`]: { collection: 'thj', standard: 'erc721', access_started_at: '2026-06-22' },
      }),
      ...over,
    });

  // Register a delivered public run and hand back its (run_id + journey_token) capability pair.
  async function registerRun(app: ReturnType<typeof createAuditRouter>) {
    const res = await post(app, '/v1/access-risk', { chain: '1', contract: CONTRACT });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    return { run_id: body.journey.run_id as string, journey_token: body.journey.journey_token as string };
  }

  it('records a public-gate-leak feedback attention event + value bound to the run subject + capability', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(interactionDeps(eventStore));
    const { run_id, journey_token } = await registerRun(app);

    const res = await post(app, `/v1/access-risk/${run_id}/interaction`, {
      kind: 'feedback',
      journey_token,
      reaction: 'worse',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduplicated: false });

    // WEAKEST-LINK: the durable event is a `feedback` attention kind bound to the run's CANONICAL subject
    // + THIS journey's capability — not merely a 200. The subject came from the run, never the caller.
    const feedback = eventStore.attentionList(journey_token).find((e) => e.kind === 'feedback');
    expect(feedback).toMatchObject({
      kind: 'feedback',
      subject_chain_id: '1',
      subject_contract_address: CONTRACT.toLowerCase(),
      journey_token,
    });
    // ...and the bounded VALUE is persisted under the run's OWN public-gate-leak mode (never dogfood-full).
    const valueEvent = eventStore.runEventList(run_id).find((e) => e.reaction === 'worse');
    expect(valueEvent).toMatchObject({ mode: 'public-gate-leak', reaction: 'worse' });
    expect(valueEvent?.cta_interaction).toBeUndefined(); // feedback carries no CTA target
  });

  it('records enhance_intent as a distinct attention kind carrying the CTA target', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(interactionDeps(eventStore));
    const { run_id, journey_token } = await registerRun(app);

    const res = await post(app, `/v1/access-risk/${run_id}/interaction`, {
      kind: 'enhance_intent',
      journey_token,
      target: 'conversation',
    });
    expect(res.status).toBe(200);
    const enhance = eventStore.attentionList(journey_token).find((e) => e.kind === 'enhance_intent');
    expect(enhance).toMatchObject({
      kind: 'enhance_intent',
      subject_chain_id: '1',
      subject_contract_address: CONTRACT.toLowerCase(),
      journey_token,
    });
    const valueEvent = eventStore.runEventList(run_id).find((e) => e.cta_interaction === 'conversation');
    expect(valueEvent).toMatchObject({ mode: 'public-gate-leak', cta_interaction: 'conversation' });
  });

  it('is idempotent per (journey_token, kind): a retry inflates neither demand nor the aggregate', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(interactionDeps(eventStore));
    const { run_id, journey_token } = await registerRun(app);

    const first = await post(app, `/v1/access-risk/${run_id}/interaction`, {
      kind: 'feedback',
      journey_token,
      reaction: 'worse',
    });
    expect(await first.json()).toEqual({ ok: true, deduplicated: false });
    const feedbackAttentionAfterFirst = eventStore.attentionList(journey_token).filter((e) => e.kind === 'feedback').length;
    const feedbackValueRowsAfterFirst = eventStore.runEventList(run_id).filter((e) => e.reaction).length;

    // Retry the SAME (token, kind) with a DIFFERENT value: a no-op, not an error and not a second row.
    const retry = await post(app, `/v1/access-risk/${run_id}/interaction`, {
      kind: 'feedback',
      journey_token,
      reaction: 'surprised',
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ ok: true, deduplicated: true });
    expect(eventStore.attentionList(journey_token).filter((e) => e.kind === 'feedback').length).toBe(feedbackAttentionAfterFirst);
    expect(eventStore.runEventList(run_id).filter((e) => e.reaction).length).toBe(feedbackValueRowsAfterFirst);
    // First value wins; the retry's differing value is dropped (the "counts once" contract).
    expect(eventStore.runEventList(run_id).find((e) => e.reaction)?.reaction).toBe('worse');
  });

  it('fails closed on malformed body, unknown/non-public run, and mismatched capability token', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(interactionDeps(eventStore));
    const { run_id, journey_token } = await registerRun(app);

    // malformed / missing value / out-of-enum / unknown kind / smuggled member field (.strict()) → 400
    for (const bad of [
      null,
      { kind: 'feedback', journey_token }, // missing reaction
      { kind: 'feedback', journey_token, reaction: 'nope' }, // reaction out of enum
      { kind: 'love', journey_token, reaction: 'worse' }, // unknown discriminant
      { kind: 'feedback', journey_token, reaction: 'worse', wallet: R1 }, // .strict() rejects the extra field
      { kind: 'feedback', journey_token, reaction: 'worse', subject: { chain_id: '1' } }, // no caller-supplied subject
      { kind: 'feedback', journey_token, reaction: 'worse', placed_by: 'attacker' }, // no caller-supplied placed_by
    ]) {
      expect((await post(app, `/v1/access-risk/${run_id}/interaction`, bad)).status).toBe(400);
    }

    // The public 400 must not REFLECT caller-controlled content (no zod `issues` echo of the bad value).
    const reflecting = await post(app, `/v1/access-risk/${run_id}/interaction`, {
      kind: 'feedback',
      journey_token,
      reaction: 'leak-me@example.com',
    });
    expect(reflecting.status).toBe(400);
    expect(JSON.stringify(await reflecting.json())).not.toContain('leak-me@example.com');

    // unknown run_id → 404 (a non-public run is absent from the public journey store — fail-closed)
    expect(
      (await post(app, `/v1/access-risk/does-not-exist/interaction`, { kind: 'feedback', journey_token, reaction: 'worse' })).status,
    ).toBe(404);

    // an INTERNAL dogfood run_id is NOT interactable on this public route (non-public fail-closed)
    const dogfood = createAuditRouter(makeDeps({ eventStore }));
    const { run_id: dogfoodRunId } = (await (await dogfood.request(GET_URL)).json()) as any;
    expect(
      (await post(app, `/v1/access-risk/${dogfoodRunId}/interaction`, { kind: 'feedback', journey_token, reaction: 'worse' })).status,
    ).toBe(404);

    // mismatched capability token → 404 (no existence oracle for a caller without the capability)
    expect(
      (await post(app, `/v1/access-risk/${run_id}/interaction`, { kind: 'feedback', journey_token: 'not-the-token', reaction: 'worse' })).status,
    ).toBe(404);

    // NO durable interaction was written by any rejection.
    expect(eventStore.attentionList(journey_token).some((e) => e.kind === 'feedback')).toBe(false);
  });

  it('rejects an interaction against an expired run (outside the 24h lifecycle window)', async () => {
    const eventStore = new InMemoryEventStore();
    let clock = NOW_MS;
    const app = createAuditRouter(interactionDeps(eventStore, { now: () => clock }));
    const { run_id, journey_token } = await registerRun(app);
    clock = NOW_MS + 86_400_000 + 1; // one ms past the 24h window
    const res = await post(app, `/v1/access-risk/${run_id}/interaction`, {
      kind: 'feedback',
      journey_token,
      reaction: 'worse',
    });
    expect(res.status).toBe(404);
    expect(eventStore.attentionList(journey_token).some((e) => e.kind === 'feedback')).toBe(false);
  });

  it('leaves the internal dogfood reaction bound to dogfood-full (unchanged)', async () => {
    const eventStore = new InMemoryEventStore();
    const app = createAuditRouter(makeDeps({ eventStore }));
    const { run_id } = (await (await app.request(GET_URL)).json()) as any;
    expect((await post(app, '/v1/audit/reaction', { run_id, reaction: 'expected' })).status).toBe(200);
    const dogfoodReaction = eventStore.runEventList(run_id).find((e) => e.reaction === 'expected');
    expect(dogfoodReaction?.mode).toBe('dogfood-full');
  });

  // Lifecycle-wide capability contract (FAGAN HIGH-1 closed): run_id is the public address (can live
  // in a URL/QR); journey_token is the authentication credential required by ALL public sub-routes.
  // The poll, the resume, and the interaction route all gate on it — a bare run_id holder cannot
  // observe state, resume, or record a demand signal.
  describe('lifecycle-wide capability contract — all sub-routes gate on journey_token (FAGAN HIGH-1)', () => {
    it('poll: bare run_id without journey_token → 404 (no existence oracle)', async () => {
      const eventStore = new InMemoryEventStore();
      const app = createAuditRouter(interactionDeps(eventStore));
      const { run_id } = await registerRun(app);
      const poll = await app.request(`/v1/access-risk/${run_id}`);
      expect(poll.status).toBe(404);
    });

    it('poll: mismatched journey_token → 404', async () => {
      const eventStore = new InMemoryEventStore();
      const app = createAuditRouter(interactionDeps(eventStore));
      const { run_id } = await registerRun(app);
      const poll = await app.request(`/v1/access-risk/${run_id}?journey_token=wrong-token`);
      expect(poll.status).toBe(404);
    });

    it('poll: matching journey_token → 200 with full projection (including journey_token)', async () => {
      const eventStore = new InMemoryEventStore();
      const app = createAuditRouter(interactionDeps(eventStore));
      const { run_id, journey_token } = await registerRun(app);
      const poll = await app.request(`/v1/access-risk/${run_id}?journey_token=${encodeURIComponent(journey_token)}`);
      expect(poll.status).toBe(200);
      const body = (await poll.json()) as any;
      expect(body.journey.run_id).toBe(run_id);
      expect(body.journey.journey_token).toBe(journey_token);
      expect(body.journey.status).toBeDefined();
    });

    it('resume: bare run_id without journey_token → 400 (schema)', async () => {
      const eventStore = new InMemoryEventStore();
      const app = createAuditRouter(interactionDeps(eventStore));
      const { run_id } = await registerRun(app);
      const res = await post(app, `/v1/access-risk/${run_id}/resume`, { access_started_at: '2026-06-22' });
      expect(res.status).toBe(400);
    });

    it('resume: mismatched journey_token → 404', async () => {
      const eventStore = new InMemoryEventStore();
      // needs_input fixture: no access_started_at in the registry so the run stays in needs_input state
      const needsInputDeps = makeDeps({
        eventStore,
        collectionRegistry: (({ chain, contract }: { chain: string; contract: string }) =>
          `${chain}/${contract}`.toLowerCase() === `1/${CONTRACT}`.toLowerCase()
            ? { collection: 'thj', standard: 'erc721' as const }
            : undefined),
      });
      const app = createAuditRouter(needsInputDeps);
      // Submit without access_started_at so outcome is needs_input
      const submitRes = await post(app, '/v1/access-risk', { chain: '1', contract: CONTRACT });
      const submitBody = (await submitRes.json()) as any;
      if (submitBody.journey?.status?.state !== 'needs_input') return; // skip if env delivers directly
      const run_id = submitBody.journey.run_id as string;
      const res = await post(app, `/v1/access-risk/${run_id}/resume`, {
        access_started_at: '2026-06-22',
        journey_token: 'wrong-token',
      });
      expect(res.status).toBe(404);
    });
  });
});
