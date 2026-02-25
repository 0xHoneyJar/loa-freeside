/**
 * CapabilityCatalog — Unit tests (Task 2.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CapabilityCatalog,
  ReputationResolver,
  FeatureFlagResolver,
} from '../../themes/sietch/src/packages/core/protocol/capability-catalog.js';
import type { CapabilityResolver, CapabilitySet, ResolutionContext } from '../../themes/sietch/src/packages/core/protocol/capability-catalog.js';

// Minimal mock DynamicContract for ReputationResolver
const mockContract = {
  version: '1.0.0',
  surfaces: {
    cold: {
      schemas: ['basic'],
      capabilities: ['read'],
      rate_limit_tier: 'free',
      ensemble_strategies: [],
    },
    warming: {
      schemas: ['basic', 'advanced'],
      capabilities: ['read', 'write'],
      rate_limit_tier: 'basic',
      ensemble_strategies: [],
    },
    established: {
      schemas: ['basic', 'advanced', 'admin'],
      capabilities: ['read', 'write', 'ensemble'],
      rate_limit_tier: 'standard',
      ensemble_strategies: ['voting'],
    },
  },
} as any;

/** Simple test resolver */
function createResolver(name: string, priority: number, caps: Partial<CapabilitySet>): CapabilityResolver {
  return {
    name,
    priority,
    resolve: () => ({
      capabilities: caps.capabilities ?? [],
      schemas: caps.schemas ?? [],
      rate_limit_tier: caps.rate_limit_tier ?? 'free',
      ensemble_strategies: caps.ensemble_strategies ?? [],
    }),
  };
}

describe('CapabilityCatalog', () => {
  let catalog: CapabilityCatalog;

  beforeEach(() => {
    catalog = new CapabilityCatalog();
  });

  it('should return empty capabilities with 0 resolvers', () => {
    const result = catalog.resolve({});
    expect(result.capabilities).toEqual([]);
    expect(result.schemas).toEqual([]);
    expect(result.rate_limit_tier).toBe('free');
    expect(result.ensemble_strategies).toEqual([]);
    expect(result.provenance).toEqual([]);
  });

  it('should return resolver output with 1 resolver', () => {
    catalog.addResolver(createResolver('test', 100, {
      capabilities: ['read', 'write'],
      schemas: ['basic'],
      rate_limit_tier: 'standard',
    }));

    const result = catalog.resolve({});
    expect(result.capabilities).toEqual(['read', 'write']);
    expect(result.schemas).toEqual(['basic']);
    expect(result.rate_limit_tier).toBe('standard');
  });

  it('should combine capabilities via union with 2 resolvers', () => {
    catalog.addResolver(createResolver('resolver-a', 100, {
      capabilities: ['read'],
      schemas: ['basic'],
      rate_limit_tier: 'basic',
    }));
    catalog.addResolver(createResolver('resolver-b', 50, {
      capabilities: ['write'],
      schemas: ['advanced'],
      rate_limit_tier: 'standard',
    }));

    const result = catalog.resolve({});

    // Union: both capabilities granted
    expect(result.capabilities).toContain('read');
    expect(result.capabilities).toContain('write');
    // Union: both schemas granted
    expect(result.schemas).toContain('basic');
    expect(result.schemas).toContain('advanced');
    // Most permissive tier wins
    expect(result.rate_limit_tier).toBe('standard');
  });

  it('should never subtract capabilities (monotonic expansion)', () => {
    catalog.addResolver(createResolver('grants', 100, {
      capabilities: ['cap_a', 'cap_b', 'cap_c'],
    }));
    catalog.addResolver(createResolver('grants-less', 50, {
      capabilities: ['cap_a'],  // Only grants one — should NOT remove cap_b, cap_c
    }));

    const result = catalog.resolve({});
    expect(result.capabilities).toContain('cap_a');
    expect(result.capabilities).toContain('cap_b');
    expect(result.capabilities).toContain('cap_c');
  });

  it('should use most permissive rate_limit_tier (not priority-based)', () => {
    catalog.addResolver(createResolver('low-priority', 10, {
      rate_limit_tier: 'premium',
    }));
    catalog.addResolver(createResolver('high-priority', 100, {
      rate_limit_tier: 'basic',
    }));

    const result = catalog.resolve({});
    // Premium wins because it's more permissive, even though it's from lower-priority resolver
    expect(result.rate_limit_tier).toBe('premium');
  });

  it('should track provenance (highest priority resolver first)', () => {
    catalog.addResolver(createResolver('primary', 100, {
      capabilities: ['shared_cap'],
    }));
    catalog.addResolver(createResolver('secondary', 50, {
      capabilities: ['shared_cap'],
    }));

    const result = catalog.resolve({});
    const sharedProvenance = result.provenance.find((p) => p.capability === 'shared_cap');
    expect(sharedProvenance).toBeDefined();
    // Highest priority listed first
    expect(sharedProvenance!.grantedBy).toEqual(['primary', 'secondary']);
  });

  it('should use priority for provenance only (not override)', () => {
    catalog.addResolver(createResolver('high-prio', 100, {
      capabilities: ['cap_from_high'],
    }));
    catalog.addResolver(createResolver('low-prio', 10, {
      capabilities: ['cap_from_low'],
    }));

    const result = catalog.resolve({});
    // Both capabilities present — priority doesn't filter
    expect(result.capabilities).toContain('cap_from_high');
    expect(result.capabilities).toContain('cap_from_low');
  });
});

describe('ReputationResolver', () => {
  it('should produce identical results to resolveProtocolSurface()', () => {
    const resolver = new ReputationResolver(mockContract);
    const result = resolver.resolve({ reputationState: 'warming' });

    expect(result.capabilities).toEqual(['read', 'write']);
    expect(result.schemas).toEqual(['basic', 'advanced']);
    expect(result.rate_limit_tier).toBe('basic');
  });

  it('should fall back to cold for unknown state', () => {
    const resolver = new ReputationResolver(mockContract);
    const result = resolver.resolve({ reputationState: 'unknown' as any });

    expect(result.capabilities).toEqual(['read']);
    expect(result.schemas).toEqual(['basic']);
    expect(result.rate_limit_tier).toBe('free');
  });

  it('should default to cold when no reputationState provided', () => {
    const resolver = new ReputationResolver(mockContract);
    const result = resolver.resolve({});

    expect(result.capabilities).toEqual(['read']);
  });
});

describe('FeatureFlagResolver', () => {
  it('should read flags from options', () => {
    const resolver = new FeatureFlagResolver({
      flags: ['beta_feature', 'dark_launch'],
    });
    const result = resolver.resolve({});

    expect(result.capabilities).toContain('beta_feature');
    expect(result.capabilities).toContain('dark_launch');
  });

  it('should return empty when no flags configured', () => {
    const resolver = new FeatureFlagResolver();
    const result = resolver.resolve({});

    expect(result.capabilities).toEqual([]);
  });
});

describe('isGranted', () => {
  it('should return true when capability is granted by any resolver', () => {
    const catalog = new CapabilityCatalog();
    catalog.addResolver(createResolver('test', 100, {
      capabilities: ['my_cap'],
    }));

    expect(catalog.isGranted('my_cap', {})).toBe(true);
    expect(catalog.isGranted('other_cap', {})).toBe(false);
  });
});
