/**
 * makeScoreEligibilityChecker — fail-closed access-boundary tests.
 *
 * This adapter decides Arrakis-eligibility for the shadow order-counter. It is an access
 * boundary, so the load-bearing invariant is: eligibility is NEVER granted on a degraded
 * read (non-2xx other than 404, transport failure, or contract drift). A 404 is a real
 * negative (not a holder), distinct from a degrade.
 */
import { describe, it, expect } from 'vitest';
import { makeScoreEligibilityChecker, type CommunityProfileFetcher } from './score-eligibility-checker.js';
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

  it('nft_ownership: a present tier = holder = eligible', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'member', combined_score: 10 }));
    expect((await c.checkEligibility([nftRule], W)).eligible).toBe(true);
  });

  it('nft_ownership: null tier + zero nft_score = not a holder = not eligible', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: null, combined_score: null, nft_score: 0 }));
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

  it('token_balance is not evaluable by the score path → not eligible (defer to a chain checker)', async () => {
    const c = makeScoreEligibilityChecker(cfg, returning(200, { tier: 'elder', combined_score: 999 }));
    const tokRule: EligibilityRule = { ruleType: 'token_balance', chainId: '101', contractAddress: 'pyTh', minAmount: 1n };
    expect((await c.checkEligibility([tokRule], W)).eligible).toBe(false);
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
});
