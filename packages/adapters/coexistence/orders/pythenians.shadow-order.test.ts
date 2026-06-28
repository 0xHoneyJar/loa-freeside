import { describe, it, expect } from 'vitest';
import {
  PYTHENIANS_SHADOW_ORDER,
  PYTHENIANS_GUILD_ID,
  PYTHENIANS_COLLECTION,
} from './pythenians.shadow-order.js';
import { makeInMemoryOrderRegistry } from '../order-registry.js';
import { makeScoreEligibilityChecker } from '../score-eligibility-checker.js';
import type { EligibilityRule } from '../shadow-sync-job.js';

describe('PYTHENIANS_SHADOW_ORDER (run #1 — chain-first, shadow-only, no admin)', () => {
  it('is a valid shadow order: shadow mode, real guild + Solana collection, nft_ownership rule', () => {
    expect(PYTHENIANS_SHADOW_ORDER.config.mode).toBe('shadow');
    expect(PYTHENIANS_SHADOW_ORDER.config.guildId).toBe(PYTHENIANS_GUILD_ID);
    expect(PYTHENIANS_SHADOW_ORDER.eligibilityRules).toEqual([
      { ruleType: 'nft_ownership', chainId: '101', contractAddress: PYTHENIANS_COLLECTION },
    ]);
  });

  it('places into the order book + shows up in the shadow sweep set (the foundation has a real order)', () => {
    const r = makeInMemoryOrderRegistry([PYTHENIANS_SHADOW_ORDER]);
    expect(r.getShadowModeCommunities()).toEqual(['pythenians']);
    expect(r.getEligibilityRules('pythenians')[0]?.ruleType).toBe('nft_ownership');
  });

  it('is gated chain-first: an nft_score>0 holder is eligible, a scored non-holder is denied', async () => {
    const rules = PYTHENIANS_SHADOW_ORDER.eligibilityRules as EligibilityRule[];
    const holder = makeScoreEligibilityChecker(
      { endpoint: 'https://score', community: 'pythenians', apiKey: 'k' },
      async () => ({ status: 200, body: { tier: 'elder', nft_score: 1, combined_score: 500 } }),
    );
    const nonHolder = makeScoreEligibilityChecker(
      { endpoint: 'https://score', community: 'pythenians', apiKey: 'k' },
      async () => ({ status: 200, body: { tier: 'member', nft_score: 0, combined_score: 50 } }),
    );
    expect((await holder.checkEligibility(rules, '0xabc')).eligible).toBe(true);
    expect((await nonHolder.checkEligibility(rules, '0xabc')).eligible).toBe(false);
  });
});
