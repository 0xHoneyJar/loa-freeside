import { describe, it, expect } from 'vitest';
import { makeInMemoryOrderRegistry, type CommunityOrder } from './order-registry.js';
import type { CoexistenceConfig } from '@freeside/core/domain';
import type { EligibilityRule } from './shadow-sync-job.js';

const cfg = (over: Partial<CoexistenceConfig> = {}): CoexistenceConfig => ({
  communityId: 'pythenians',
  guildId: 'g1',
  mode: 'shadow',
  incumbentInfo: null,
  syncIntervalHours: 6,
  lastSyncAt: null,
  shadowAccuracy: null,
  shadowDays: 0,
  minAccuracyForParallel: 0.95,
  minShadowDaysForParallel: 14,
  ...over,
});
const rule: EligibilityRule = { ruleType: 'score_threshold', chainId: '101', contractAddress: 'pyTh', minScore: 100 };
const order = (over: Partial<CoexistenceConfig> = {}, rules: EligibilityRule[] = [rule]): CommunityOrder => ({
  config: cfg(over),
  eligibilityRules: rules,
});

describe('makeInMemoryOrderRegistry (the Shadow Mode order book)', () => {
  it('places + reads an order back', () => {
    const r = makeInMemoryOrderRegistry();
    r.place(order());
    expect(r.get('pythenians')?.config.guildId).toBe('g1');
    expect(r.getConfig('pythenians')?.mode).toBe('shadow');
    expect(r.getEligibilityRules('pythenians')).toEqual([rule]);
  });

  it('seeds from a constructor list', () => {
    const r = makeInMemoryOrderRegistry([order({ communityId: 'mibera' }, [])]);
    expect(r.get('mibera')).toBeDefined();
  });

  it('fail-safe on an un-ordered community: undefined config, [] rules, no throw', () => {
    const r = makeInMemoryOrderRegistry();
    expect(r.get('nope')).toBeUndefined();
    expect(r.getConfig('nope')).toBeUndefined();
    expect(r.getEligibilityRules('nope')).toEqual([]);
  });

  it('getShadowModeCommunities returns only mode==="shadow" (graduated communities drop out)', () => {
    const r = makeInMemoryOrderRegistry([
      order({ communityId: 'a', mode: 'shadow' }),
      order({ communityId: 'b', mode: 'parallel' }),
      order({ communityId: 'c', mode: 'primary' }),
      order({ communityId: 'd', mode: 'disabled' }),
    ]);
    expect(r.getShadowModeCommunities().sort()).toEqual(['a']);
  });

  it('updateConfig graduates a mode + accrues accuracy in place, preserving the rules', () => {
    const r = makeInMemoryOrderRegistry([order({ communityId: 'a', mode: 'shadow' })]);
    r.updateConfig('a', { mode: 'parallel', shadowAccuracy: 0.97, shadowDays: 15 });
    expect(r.getConfig('a')?.mode).toBe('parallel');
    expect(r.getConfig('a')?.shadowAccuracy).toBe(0.97);
    expect(r.getShadowModeCommunities()).toEqual([]); // out of the shadow sweep once graduated
    expect(r.getEligibilityRules('a')).toEqual([rule]); // rules survived the patch
  });

  it('updateConfig is a no-op for an un-ordered community (never resurrects)', () => {
    const r = makeInMemoryOrderRegistry();
    r.updateConfig('ghost', { mode: 'primary' });
    expect(r.get('ghost')).toBeUndefined();
  });

  it('place replaces an existing order for the same community', () => {
    const r = makeInMemoryOrderRegistry([order({ communityId: 'a', guildId: 'old' })]);
    r.place(order({ communityId: 'a', guildId: 'new' }));
    expect(r.getConfig('a')?.guildId).toBe('new');
  });
});
