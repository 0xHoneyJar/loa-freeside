/**
 * S2-T3 (G-5, IMP-006) — the PUBLIC access-risk teaser.
 *
 * Covers the properties that make it safe to expose unauthenticated:
 *   · works with NO role snapshot (the whole point — a community whose Discord we cannot see)
 *   · reachable WITHOUT the X-API-Key while /v1/audit still 401s (the server-level exemption)
 *   · anti-enumeration: a contract outside the registry is refused (not a probe oracle)
 *   · meaningful-or-refuse: a sub-k cohort is REFUSED, never served as a vacuous "no risk"
 *   · k-anon: small cohorts bucket, and the ratio is coarsened so it can't back-compute them
 *   · never leaks member data (no wallets/records anywhere in the response)
 *   · its own tighter per-IP limit
 */
import { describe, it, expect } from 'vitest';
import { createAuditRouter, type AuditRouterDeps } from '../http/audit-router.js';
import { buildAuditApp } from '../server.js';
import { InMemoryEventStore } from '../event-store.js';
import { InMemoryNonceStore } from '../association-verifier.js';
import { FixedWindowRateLimiter } from '../rate-limiter.js';
import type { Balances, OwnershipSource, WhaleSource } from '../audit-service.js';

const W = (n: number) => '0x' + String(n).repeat(40).slice(0, 40);
const CONTRACT = '0x' + 'a'.repeat(40);
const UNKNOWN = '0x' + 'b'.repeat(40);
const NOW_MS = Date.UTC(2026, 5, 22, 12, 0, 0);

/** 6 qualified at snapshot (W1..W6); now W1-W4 still hold, W7+W8 are new → sold_lapsed=2, newly=2. */
const snapBal: Balances = new Map([1, 2, 3, 4, 5, 6].map((i) => [W(i), 1n]));
const curBal: Balances = new Map([1, 2, 3, 4, 7, 8].map((i) => [W(i), 1n]));

const ownership: OwnershipSource = {
  resolveSnapshotBlock: async () => 1000,
  balancesAt: async () => snapBal,
  currentBalances: async () => curBal,
};
const whale: WhaleSource = { concentration: async () => 0.25 };

const registry = (q: { chain: string; contract: string }) =>
  q.contract === CONTRACT ? { collection: 'Honeycomb', standard: 'erc721' as const } : undefined;

function makeDeps(over: Partial<AuditRouterDeps> = {}): AuditRouterDeps {
  return {
    ownership,
    whale,
    collectionRegistry: registry as AuditRouterDeps['collectionRegistry'],
    // NO role snapshot — the teaser must work without any Discord access at all.
    roles: { load: async () => undefined },
    eventStore: new InMemoryEventStore(),
    rateLimiter: new FixedWindowRateLimiter({ limit: 100, windowMs: 60_000, now: () => NOW_MS }),
    teaserRateLimiter: new FixedWindowRateLimiter({ limit: 100, windowMs: 60_000, now: () => NOW_MS }),
    auth: {
      recover: async () => W(9),
      nonces: new InMemoryNonceStore(),
      isCommunityOwner: async () => false,
      domain: 'audit.thj',
      chainId: 1,
      scope: 'named-output',
      maxValiditySeconds: 3600,
    },
    isOperatedCommunity: () => true,
    cta: { product: '/shadow-access', conversation: '/talk' },
    now: () => NOW_MS,
    clientKey: (xff) => xff ?? 'default',
    k: 5,
    ...over,
  };
}

const url = (contract = CONTRACT, extra = '') =>
  `/v1/access-risk?chain=80094&contract=${contract}&snapshot_date=2026-06-01${extra}`;

describe('GET /v1/access-risk — public teaser (S2-T3)', () => {
  it('computes on-chain risk with NO role snapshot (no Discord access required)', async () => {
    const app = createAuditRouter(makeDeps());
    const res = await app.request(url());
    expect(res.status).toBe(200);
    const b = (await res.json()) as Record<string, unknown>;

    expect(b.access_basis).toBe('on-chain-only');
    // 6 qualified@snapshot → exact (>= k). sold_lapsed = 2 → bucketed (< k).
    expect(b.qualified_at_snapshot).toEqual({ kind: 'exact', value: 6 });
    expect(b.sold_lapsed).toEqual({ kind: 'bucketed', bucket: '<5' });
    // The bound is named for what it MEANS — same cohort, honest label.
    expect(b.stale_access_upper_bound).toEqual(b.sold_lapsed);
    expect(b.newly_eligible).toEqual({ kind: 'bucketed', bucket: '<5' });
    // PRIVACY: sold_lapsed is suppressed (<k), so NO true-ratio-derived number may be emitted.
    // (This previously returned 0.3 — which, with the exact denominator 6, uniquely revealed n=2 and
    // defeated the '<5' bucket. Rounding is not suppression. FAGAN 2026-07-12.)
    expect(b.holder_turnover).toBeNull();
    // risk_band is banded from the UPPER BOUND (k-1)/N = 4/6 → 'high': a function of k and N only.
    expect(b.risk_band).toBe('high');
    expect(b.risk_band_is_upper_bound).toBe(true);
    expect(b.whale_concentration).toBe(0.25);
    expect(typeof b.disclosure).toBe('string');
    expect(b.cta).toEqual({ product: '/shadow-access', conversation: '/talk' });
  });

  it('NEVER leaks member data — no wallet addresses, no per-member records', async () => {
    const app = createAuditRouter(makeDeps());
    const res = await app.request(url());
    const raw = await res.text();
    // The load-bearing check: not a single wallet ADDRESS anywhere in the payload.
    expect(raw).not.toMatch(/0x[0-9a-fA-F]{40}/);
    // No per-member record array (that is the authed POST /v1/audit surface, never this one).
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body.records).toBeUndefined();
    // Every cohort is an aggregate CohortCount, never a list.
    for (const key of ['qualified_at_snapshot', 'sold_lapsed', 'stale_access_upper_bound', 'newly_eligible']) {
      expect(Array.isArray(body[key])).toBe(false);
      expect(body[key]).toHaveProperty('kind');
    }
    // ("wallets" appears only in the human-readable `disclosure` prose — that is copy, not member data.)
  });

  it('ANTI-ENUMERATION: a contract outside the registry is refused (not a probe oracle)', async () => {
    const app = createAuditRouter(makeDeps());
    const res = await app.request(url(UNKNOWN));
    expect(res.status).toBe(404); // unindexed-contract
    const b = (await res.json()) as { error: { code: string } };
    expect(b.error.code).toBe('unindexed-contract');
  });

  it('MEANINGFUL-OR-REFUSE: a sub-k cohort is refused, never served as a vacuous "no risk"', async () => {
    const tiny: Balances = new Map([1, 2, 3].map((i) => [W(i), 1n])); // 3 < k=5
    const app = createAuditRouter(
      makeDeps({
        ownership: { ...ownership, balancesAt: async () => tiny, currentBalances: async () => tiny },
      }),
    );
    const res = await app.request(url());
    expect(res.status).toBe(422);
    const b = (await res.json()) as { error: { code: string } };
    expect(b.error.code).toBe('cohort-too-small');
  });

  it('enforces its OWN tighter per-IP limit', async () => {
    const app = createAuditRouter(
      makeDeps({
        teaserRateLimiter: new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => NOW_MS }),
      }),
    );
    expect((await app.request(url())).status).toBe(200);
    expect((await app.request(url())).status).toBe(200);
    expect((await app.request(url())).status).toBe(429); // rate-limited
  });

  it('rejects a non-positive threshold', async () => {
    const app = createAuditRouter(makeDeps());
    expect((await app.request(url(CONTRACT, '&threshold=0'))).status).toBe(400);
  });

  it('PRIVACY REGRESSION: a suppressed cohort emits NO back-computable ratio, for ANY small denominator', async () => {
    // The exploit the FAGAN council found: qualified_at_snapshot is published EXACTLY (denominator N is
    // public), so any function of the true numerator n back-computes it. With N=6, round(n/N,1) maps
    // n=1,2,3,4 → 0.2,0.3,0.5,0.7 — each uniquely identifying n despite the "<5" bucket.
    // Sweep every suppressed n and assert no emitted number varies with it.
    const seen = new Set<string>();
    for (let sold = 0; sold < 5; sold++) {
      const snap: Balances = new Map([1, 2, 3, 4, 5, 6].map((i) => [W(i), 1n])); // N = 6 (exact, public)
      // First `sold` holders no longer qualify.
      const cur: Balances = new Map([...snap.keys()].slice(sold).map((w) => [w, 1n]));
      const app = createAuditRouter(
        makeDeps({
          ownership: { ...ownership, balancesAt: async () => snap, currentBalances: async () => cur },
        }),
      );
      const b = (await (await app.request(url())).json()) as Record<string, unknown>;
      expect(b.qualified_at_snapshot).toEqual({ kind: 'exact', value: 6 }); // denominator IS public
      expect(b.sold_lapsed).toEqual({ kind: 'bucketed', bucket: '<5' }); // numerator suppressed
      expect(b.holder_turnover).toBeNull(); // ← no ratio may leak n
      seen.add(JSON.stringify([b.holder_turnover, b.risk_band, b.sold_lapsed]));
    }
    // All 5 distinct true numerators (0..4) must be INDISTINGUISHABLE in the payload.
    expect(seen.size).toBe(1);
  });

  it('HARD BOUND: rotating the client key does NOT bypass the global reconstruction budget', async () => {
    // The live probe (2026-07-12) sent 9 requests with rotating X-Forwarded-For against the 6/min per-IP
    // teaser limit and NONE were limited — the caller supplies the key, so per-IP is not a bound at all.
    // The global budget is keyed on a CONSTANT, so identity-rotation buys nothing. Per-IP is left wide
    // open here precisely to prove the global bound is what bites.
    const app = createAuditRouter(
      makeDeps({
        teaserRateLimiter: new FixedWindowRateLimiter({ limit: 999, windowMs: 60_000, now: () => NOW_MS }),
        teaserBudget: new FixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => NOW_MS }),
      }),
    );
    // Distinct dates → distinct cache keys → every one is a real (expensive) reconstruction.
    // Distinct XFF → the exact evasion that defeated the per-IP limiter.
    const hit = (i: number) =>
      app.request(`/v1/access-risk?chain=80094&contract=${CONTRACT}&snapshot_date=2026-06-0${i}`, {
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
      });

    expect((await hit(1)).status).toBe(200);
    expect((await hit(2)).status).toBe(200);
    expect((await hit(3)).status).toBe(429); // budget spent — rotation did not help
  });

  it('CACHE: an identical repeat query does ZERO chain work', async () => {
    let reconstructions = 0;
    const app = createAuditRouter(
      makeDeps({
        ownership: {
          ...ownership,
          balancesAt: async () => {
            reconstructions++;
            return snapBal;
          },
        },
      }),
    );
    expect((await app.request(url())).status).toBe(200);
    expect((await app.request(url())).status).toBe(200);
    // The cheapest flood (same query repeated) costs exactly one reconstruction per TTL.
    expect(reconstructions).toBe(1);
  });

  it('a FAILED whale source is null, never 0 (0 would read as "no whale risk")', async () => {
    const app = createAuditRouter(
      makeDeps({ whale: { concentration: async () => { throw new Error('rpc down'); } } }),
    );
    const b = (await (await app.request(url())).json()) as Record<string, unknown>;
    expect(b.whale_concentration).toBeNull();
  });
});

describe('/v1/access-risk is PUBLIC while /v1/audit stays key-gated (server exemption)', () => {
  it('serves the teaser with NO X-API-Key, but 401s /v1/audit without one', async () => {
    const app = buildAuditApp(
      ownership,
      {
        apiKey: 'the-dashboard-secret',
        operatedCommunities: ['thj'],
        cta: { product: '/p', conversation: '/c' },
        k: 5,
      },
      registry as never,
    );

    // The lead magnet is reachable with no credentials at all.
    const teaser = await app.request(url());
    expect(teaser.status).toBe(200);

    // The authed surface is NOT.
    const audit = await app.request(
      `/v1/audit?chain=80094&contract=${CONTRACT}&snapshot_date=2026-06-01&community=thj&owner_wallet=${W(9)}&threshold=1`,
    );
    expect(audit.status).toBe(401);
  });
});
