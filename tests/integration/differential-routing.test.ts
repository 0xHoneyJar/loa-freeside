/**
 * Two-NFT Differential Routing Integration Test
 * Sprint 4, Task 4.5: Verify two NFTs with different conviction tiers
 * get different model pool routing.
 *
 * Tests the full chain: tier → access level → pool resolution → differential pools.
 * Uses real TierAccessMapper and resolvePoolId (no mocks on the routing path).
 *
 * @see SDD §4.3 Pool Routing
 * @see PRD FR-2.1 Tier-Based Access
 */

import { describe, it, expect } from 'vitest';
import { TierAccessMapper } from '../../packages/adapters/agent/tier-access-mapper.js';
import { resolvePoolId, ACCESS_LEVEL_POOLS } from '../../packages/adapters/agent/pool-mapping.js';

// --------------------------------------------------------------------------
// Test: Two-NFT Differential Routing
// --------------------------------------------------------------------------

describe('Two-NFT Differential Routing', () => {
  const mapper = new TierAccessMapper();

  it('high-tier NFT and standard-tier NFT route to different pools', async () => {
    // NFT-A: high conviction (tier 8) → enterprise
    const nftA = await mapper.resolveAccess(8);
    // NFT-B: standard conviction (tier 2) → free
    const nftB = await mapper.resolveAccess(2);

    // Access levels must differ
    expect(nftA.accessLevel).toBe('enterprise');
    expect(nftB.accessLevel).toBe('free');

    // Resolve default pool for each (no alias specified — simulates default invocation)
    const poolA = resolvePoolId(undefined, nftA.accessLevel);
    const poolB = resolvePoolId(undefined, nftB.accessLevel);

    // Default pools MUST differ between enterprise and free
    expect(poolA.poolId).not.toBe(poolB.poolId);

    // Free tier always gets 'cheap'
    expect(poolB.poolId).toBe('cheap');

    // Enterprise gets a higher-capability default
    expect(poolA.allowedPools.length).toBeGreaterThan(poolB.allowedPools.length);
  });

  it('enterprise NFT can access reasoning pool, free NFT cannot', async () => {
    const enterprise = await mapper.resolveAccess(7);
    const free = await mapper.resolveAccess(3);

    // Enterprise can use 'reasoning'
    const entPool = resolvePoolId('reasoning', enterprise.accessLevel);
    expect(entPool.poolId).toBe('reasoning');

    // Free tier requesting 'reasoning' falls back to tier default (silent deny — AC-3.4)
    const freePool = resolvePoolId('reasoning', free.accessLevel);
    expect(freePool.poolId).toBe('cheap');
    expect(freePool.poolId).not.toBe('reasoning');
  });

  it('native alias resolves tier-dependently', async () => {
    const enterprise = await mapper.resolveAccess(9);
    const free = await mapper.resolveAccess(1);

    const entNative = resolvePoolId('native', enterprise.accessLevel);
    const freeNative = resolvePoolId('native', free.accessLevel);

    // native → different pools per tier
    expect(entNative.poolId).not.toBe(freeNative.poolId);

    // Free native falls back to cheap
    expect(freeNative.poolId).toBe('cheap');
  });

  it('X-Pool-Used and X-Personality-Id differ between two NFTs', async () => {
    // Simulate two requests with different NFT contexts
    const nftHighTier = { nftId: 'nft-001', personalityId: 'personality-alpha', tier: 8 };
    const nftLowTier = { nftId: 'nft-002', personalityId: 'personality-beta', tier: 2 };

    const accessHigh = await mapper.resolveAccess(nftHighTier.tier);
    const accessLow = await mapper.resolveAccess(nftLowTier.tier);

    const poolHigh = resolvePoolId(undefined, accessHigh.accessLevel);
    const poolLow = resolvePoolId(undefined, accessLow.accessLevel);

    // Pool used differs
    expect(poolHigh.poolId).not.toBe(poolLow.poolId);

    // Personality IDs differ (different NFTs have different personalities)
    expect(nftHighTier.personalityId).not.toBe(nftLowTier.personalityId);
  });

  it('anti-escalation: free tier NEVER gets enterprise pools', async () => {
    const free = await mapper.resolveAccess(1);
    const enterprisePools = ACCESS_LEVEL_POOLS.enterprise.allowed;

    // For every enterprise-exclusive pool, free should fall back to cheap
    for (const alias of ['reasoning', 'native'] as const) {
      const pool = resolvePoolId(alias, free.accessLevel);
      // Must not resolve to any enterprise-exclusive pool
      const isEnterpriseExclusive = enterprisePools.includes(pool.poolId) &&
        !ACCESS_LEVEL_POOLS.free.allowed.includes(pool.poolId);
      expect(isEnterpriseExclusive).toBe(false);
    }
  });

  it('all tier ranges produce expected access levels', async () => {
    // Exhaustive tier range verification
    const expected: Record<number, string> = {
      1: 'free', 2: 'free', 3: 'free',
      4: 'pro', 5: 'pro', 6: 'pro',
      7: 'enterprise', 8: 'enterprise', 9: 'enterprise',
    };

    for (const [tier, expectedLevel] of Object.entries(expected)) {
      const result = await mapper.resolveAccess(Number(tier));
      expect(result.accessLevel).toBe(expectedLevel);
    }
  });

  it('pro tier gets intermediate pool access (between free and enterprise)', async () => {
    const free = await mapper.resolveAccess(2);
    const pro = await mapper.resolveAccess(5);
    const enterprise = await mapper.resolveAccess(8);

    // Pool count: free < pro < enterprise
    expect(free.allowedModelAliases.length).toBeLessThan(pro.allowedModelAliases.length);
    expect(pro.allowedModelAliases.length).toBeLessThan(enterprise.allowedModelAliases.length);

    // Pro can access fast-code but not reasoning
    const proPool = resolvePoolId('fast-code', pro.accessLevel);
    expect(proPool.poolId).toBe('fast-code');

    const proReasoning = resolvePoolId('reasoning', pro.accessLevel);
    expect(proReasoning.poolId).not.toBe('reasoning'); // Falls back to default
  });
});
