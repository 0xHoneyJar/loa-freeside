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

  it('builds coverage-refusal drift from current counts without historical reconstruction', async () => {
    let historicalReconstructions = 0;
    let currentReads = 0;
    const app = createAuditRouter(
      makeDeps({
        roles: coverageRoles(1, 515),
        ownership: {
          ...ownership,
          balancesAt: async (args) => {
            historicalReconstructions++;
            return ownership.balancesAt(args);
          },
          currentBalances: async (args) => {
            currentReads++;
            return ownership.currentBalances(args);
          },
        },
      }),
    );

    expect((await app.request(GET_URL)).status).toBe(422);
    expect(historicalReconstructions).toBe(0);
    expect(currentReads).toBe(1);
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
