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

  it('a returned config/order is a deep copy — mutating it cannot reach stored state (FAGAN M-2)', () => {
    const r = makeInMemoryOrderRegistry([order({ communityId: 'a', mode: 'parallel' })]);
    // try to resurrect a graduated community by flipping the leaked config back to shadow
    const leaked = r.getConfig('a')!;
    leaked.mode = 'shadow';
    expect(r.getConfig('a')?.mode).toBe('parallel'); // store untouched
    expect(r.getShadowModeCommunities()).toEqual([]); // NOT resurrected into the sweep
    // and the rules array is not a live reference either
    const o = r.get('a')!;
    (o.eligibilityRules as EligibilityRule[]).push(rule);
    expect(r.getEligibilityRules('a')).toEqual([rule]); // stored single rule, unchanged
  });

  it('mutating an order AFTER place() does not change stored state (write-path copy)', () => {
    const r = makeInMemoryOrderRegistry();
    const o = order({ communityId: 'a', mode: 'shadow' });
    r.place(o);
    (o.config as { mode: string }).mode = 'disabled';
    expect(r.getConfig('a')?.mode).toBe('shadow');
  });
});
