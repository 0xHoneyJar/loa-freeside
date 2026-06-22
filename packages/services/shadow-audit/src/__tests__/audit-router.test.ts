import { describe, it, expect } from 'vitest';
import { createAuditRouter, type AuditRouterDeps } from '../http/audit-router.js';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryNonceStore, type AuthExpectations } from '../association-verifier.js';
import { FixedWindowRateLimiter } from '../rate-limiter.js';
import type { OwnershipSource, RoleSource, WhaleSource } from '../audit-service.js';
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

function makeDeps(over: Partial<AuditRouterDeps> = {}): AuditRouterDeps {
  return {
    ownership,
    whale,
    roles,
    eventStore: new InMemoryEventStore(),
    rateLimiter: new FixedWindowRateLimiter({ limit: 100, windowMs: 60_000, now: () => NOW_MS }),
    auth: {
      recover: async () => OWNER,
      nonces: new InMemoryNonceStore(),
      isCommunityOwner: async () => true,
      expectations: (): AuthExpectations => ({
        domain: 'audit.thj',
        chainId: 1,
        contract: CONTRACT,
        communityId: 'thj',
        nowUnixSeconds: NOW_S,
      }),
    },
    isOperatedCommunity: () => true,
    cta: { product: '/shadow-access', conversation: '/talk' },
    now: () => NOW_MS,
    clientKey: (xff) => xff ?? 'default',
    k: 1,
    ...over,
  };
}

const GET_URL = `/v1/audit?chain=ethereum&contract=${CONTRACT}&snapshot_date=2026-06-22&community=thj&owner_wallet=${OWNER}&threshold=1`;

function namedBody() {
  return {
    chain: 'ethereum',
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
});
