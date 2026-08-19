/**
 * makeScoreEligibilityChecker — fail-closed access-boundary tests.
 *
 * This adapter decides Arrakis-eligibility for the shadow order-counter. It is an access
 * boundary, so the load-bearing invariant is: eligibility is NEVER granted on a degraded
 * read (non-2xx other than 404, transport failure, or contract drift). A 404 is a real
 * negative (not a holder), distinct from a degrade.
 */
import { describe, it, expect } from 'vitest';
import {
  makeScoreEligibilityChecker,
  defaultProfileFetcher,
  type CommunityProfileFetcher,
} from './score-eligibility-checker.js';
import type { EligibilityRule } from './shadow-sync-job.js';

const cfg = { endpoint: 'https://score.test', community: 'pythenians', apiKey: 'k' };
const scoreRule: EligibilityRule = { ruleType: 'score_threshold', chainId: '101', contractAddress: 'pyTh', minScore: 100 };
const nftRule: EligibilityRule = { ruleType: 'nft_ownership', chainId: '101', contractAddress: 'pyTh' };
const W = '0xabc';

const returning = (status: number, body: unknown): CommunityProfileFetcher => async () => ({ status, body });
const throwing = (): CommunityProfileFetcher => async () => {
  throw new Error('network down');
};

describe('makeScoreEligibilityChecker (fail-closed, score-backed)', () => {
  it('grants when combined_score >= the score_threshold rule', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'elder', combined_score: 150 }));
    expect(await c.checkEligibility([scoreRule], W)).toEqual({
      eligible: true,
      tier: 'elder',
      score: 150,
      source: 'score_service',
    });
  });

  it('denies (clean) when combined_score < threshold — still a real score_service answer', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'crowd', combined_score: 50 }));
    expect(await c.checkEligibility([scoreRule], W)).toEqual({
      eligible: false,
      tier: 'crowd',
      score: 50,
      source: 'score_service',
    });
  });

  it('nft_ownership: nft_score > 0 = holder = eligible', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'member', nft_score: 2, combined_score: 10 }));
    expect((await c.checkEligibility([nftRule], W)).eligible).toBe(true);
  });

  it('nft_ownership FAILS CLOSED: a present tier with nft_score 0 is NOT a holder (FAGAN H-1)', async () => {
    // tier/combined_score aggregate non-NFT signals; a scored non-holder must NOT be granted.
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'member', combined_score: 10, nft_score: 0 }));
    expect((await c.checkEligibility([nftRule], W)).eligible).toBe(false);
  });

  it('nft_ownership: a missing nft_score is NOT a holder (no tier-presence over-grant)', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'elder', combined_score: 999 }));
    expect((await c.checkEligibility([nftRule], W)).eligible).toBe(false);
  });

  it('404 = a real negative (wallet not a scored holder), NOT degraded', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(404, null));
    expect(await c.checkEligibility([scoreRule], W)).toEqual({
      eligible: false,
      tier: null,
      score: null,
      source: 'score_service',
    });
  });

  it('FAIL-CLOSED on 403 (out-of-scope api key) — degraded, never granted', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(403, { error: 'out-of-scope' }));
    expect(await c.checkEligibility([scoreRule], W)).toEqual({
      eligible: false,
      tier: null,
      score: null,
      source: 'native_degraded',
    });
  });

  it('FAIL-CLOSED on a transport throw (network / timeout) — never grants', async () => {
    const c = makeScoreEligibilityChecker(cfg, throwing());
    expect(await c.checkEligibility([scoreRule], W)).toEqual({
      eligible: false,
      tier: null,
      score: null,
      source: 'native_degraded',
    });
  });

  it('FAIL-CLOSED on contract drift (wrong-typed body) — never grants', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 123, combined_score: 'oops' }));
    expect((await c.checkEligibility([scoreRule], W)).source).toBe('native_degraded');
  });

  it('token_balance → DEGRADED, not a confident negative (score checker cannot judge it) (FAGAN M-1)', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'elder', combined_score: 999 }));
    const tokRule: EligibilityRule = { ruleType: 'token_balance', chainId: '101', contractAddress: 'pyTh', minAmount: 1n };
    expect(await c.checkEligibility([tokRule], W)).toEqual({
      eligible: false,
      tier: null,
      score: null,
      source: 'native_degraded',
    });
  });

  it('a mixed config containing token_balance degrades the whole check (no confident partial answer)', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'elder', combined_score: 999 }));
    const tokRule: EligibilityRule = { ruleType: 'token_balance', chainId: '101', contractAddress: 'pyTh', minAmount: 1n };
    expect((await c.checkEligibility([tokRule, scoreRule], W)).source).toBe('native_degraded');
  });

  it('never grants on ANY non-2xx, across the range — even with a juicy body', async () => {
    for (const s of [400, 401, 403, 429, 500, 502, 503]) {
      const c = makeScoreEligibilityChecker(cfg, returning(s, { tier: 'elder', combined_score: 999 }));
      expect((await c.checkEligibility([scoreRule], W)).eligible).toBe(false);
    }
  });

  it('passes the community-scoped key + the wallet to the fetcher (key never widened)', async () => {
    let seen: { apiKey?: string; community?: string; address?: string } = {};
    const spy: CommunityProfileFetcher = async (a) => {
      seen = { apiKey: a.apiKey, community: a.community, address: a.address };
      return { status: 200, body: { tier: 'elder', combined_score: 150 } };
    };
    await makeScoreEligibilityChecker(cfg, spy).checkEligibility([scoreRule], W);
    expect(seen).toEqual({ apiKey: 'k', community: 'pythenians', address: W });
  });

  describe('onDegraded observability (FAGAN L-1)', () => {
    it('fires on every degrade with the community + a reason — and NEVER the api key', async () => {
      const seen: { community: string; reason: string }[] = [];
      const o = { ...cfg, apiKey: 'SECRET_KEY_XYZ', onDegraded: (i: { community: string; reason: string }) => seen.push(i) };
      const tokRule: EligibilityRule = { ruleType: 'token_balance', chainId: '101', contractAddress: 'pyTh', minAmount: 1n };
      await makeScoreEligibilityChecker(o, returning(503, null)).checkEligibility([scoreRule], W);
      await makeScoreEligibilityChecker(o, throwing()).checkEligibility([scoreRule], W);
      await makeScoreEligibilityChecker(o, returning(200, { tier: 123 })).checkEligibility([scoreRule], W);
      await makeScoreEligibilityChecker(o, returning(200, {})).checkEligibility([tokRule], W);
      expect(seen.map((s) => s.reason)).toEqual(['http_503', 'transport', 'contract-drift', 'token_balance-unevaluable']);
      expect(seen.every((s) => s.community === 'pythenians')).toBe(true);
      expect(JSON.stringify(seen)).not.toContain('SECRET'); // the key never reaches the observability hook
    });

    it('does NOT fire on a clean answer (200 grant/deny or a 404 negative)', async () => {
      let fired = false;
      const o = { ...cfg, onDegraded: () => { fired = true; } };
      await makeScoreEligibilityChecker(o, returning(200, { tier: 'elder', combined_score: 999 })).checkEligibility([scoreRule], W);
      await makeScoreEligibilityChecker(o, returning(404, null)).checkEligibility([scoreRule], W);
      expect(fired).toBe(false);
    });
  });

  describe('defaultProfileFetcher — the real I/O path (FAGAN L-4)', () => {
    const withFetch = async (impl: (url: string, init: { headers?: Record<string, string> }) => unknown, run: () => Promise<void>) => {
      const orig = globalThis.fetch;
      globalThis.fetch = ((url: string, init: { headers?: Record<string, string> }) => Promise.resolve(impl(url, init))) as unknown as typeof fetch;
      try { await run(); } finally { globalThis.fetch = orig; }
    };

    it('builds the community-scoped URL + x-api-key header, returns {status, body}', async () => {
      let captured: { url?: string; headers?: Record<string, string> } = {};
      await withFetch(
        (url, init) => { captured = { url, headers: init.headers }; return { status: 200, json: async () => ({ tier: 'elder' }) }; },
        async () => {
          const r = await defaultProfileFetcher({ endpoint: 'https://score.x/', community: 'pythenians', address: '0xWALLET', apiKey: 'K', timeoutMs: 1000 });
          expect(r).toEqual({ status: 200, body: { tier: 'elder' } });
        },
      );
      expect(captured.url).toBe('https://score.x/v1/wallets/0xWALLET?community=pythenians'); // trailing slash trimmed
      expect(captured.headers).toEqual({ 'x-api-key': 'K' }); // key in header only, not the URL
    });

    it('returns a non-200 status (does not throw) for the checker to map', async () => {
      await withFetch(
        () => ({ status: 403, json: async () => ({ error: 'out-of-scope' }) }),
        async () => {
          const r = await defaultProfileFetcher({ endpoint: 'https://score.x', community: 'c', address: 'w', apiKey: 'K', timeoutMs: 1000 });
          expect(r.status).toBe(403);
        },
      );
    });

    it('null body when the response is not JSON (no throw)', async () => {
      await withFetch(
        () => ({ status: 200, json: async () => { throw new Error('not json'); } }),
        async () => {
          const r = await defaultProfileFetcher({ endpoint: 'https://score.x', community: 'c', address: 'w', apiKey: 'K', timeoutMs: 1000 });
          expect(r).toEqual({ status: 200, body: null });
        },
      );
    });
  });
});
