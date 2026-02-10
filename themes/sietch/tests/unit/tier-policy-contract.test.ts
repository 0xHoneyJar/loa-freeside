/**
 * Two-Layer Authorization Contract Tests
 * Sprint S12-T1: §7.2.3, FR-2.6
 *
 * Verifies: Arrakis per-community policy ∩ loa-finn global ceiling = effective aliases.
 *
 * Layer 1 — TierAccessMapper: maps tier (1-9) → accessLevel + allowedModelAliases
 * Layer 2 — Ceiling policy: loa-finn restricts aliases per access level
 * Effective = layer1_aliases ∩ ceiling[accessLevel]
 *
 * 27 data-driven test cases from versioned fixtures (no hardcoded policy in test code).
 * Override scenarios: restrict within ceiling, expand beyond ceiling.
 * POLICY_ESCALATION: gateway rejects model alias not in effective set.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before any barrel imports (budget-manager loads Lua at module level)
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import {
  TierAccessMapper,
  DEFAULT_TIER_MAP,
  type TierMapping,
  type TierOverrideProvider,
  AgentGateway,
  AgentGatewayError,
} from '@arrakis/adapters/agent';

import fixtures from '../fixtures/tier-policy-fixtures.json';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Compute effective aliases: tier_allowed ∩ ceiling[accessLevel] */
function computeEffective(
  tierAliases: string[],
  ceilingAliases: string[],
): string[] {
  return tierAliases.filter((a) => ceilingAliases.includes(a));
}

/** Type-narrowed access to fixtures */
const tierIds = Object.keys(fixtures.tiers) as Array<keyof typeof fixtures.tiers>;
const ceilingPolicy = fixtures.ceiling_policy as Record<string, string[]>;

// --------------------------------------------------------------------------
// Data-driven tier entries (from fixtures)
// --------------------------------------------------------------------------

const tierEntries = tierIds.map((id) => {
  const tier = fixtures.tiers[id];
  const ceiling = ceilingPolicy[tier.accessLevel] ?? [];
  const expected = (fixtures.expected_effective as Record<string, string[]>)[id] ?? [];
  return {
    tier: Number(id),
    accessLevel: tier.accessLevel,
    allowedAliases: tier.allowedModelAliases,
    ceiling,
    expectedEffective: expected,
  };
});

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('Two-Layer Authorization Contract Tests (§7.2.3, FR-2.6)', () => {
  let mapper: InstanceType<typeof TierAccessMapper>;

  beforeEach(() => {
    mapper = new TierAccessMapper();
  });

  // ========================================================================
  // Layer 1: Default Tier→Access Mapping (9 tests)
  // ========================================================================
  describe('Layer 1: resolveAccess — default tier mapping', () => {
    it.each(tierEntries)(
      'tier $tier → accessLevel=$accessLevel, aliases=$allowedAliases',
      async ({ tier, accessLevel, allowedAliases }) => {
        const result = await mapper.resolveAccess(tier);

        expect(result.accessLevel).toBe(accessLevel);
        expect(result.allowedModelAliases).toEqual(allowedAliases);
      },
    );
  });

  // ========================================================================
  // Layer 1b: getDefaultModels (9 tests)
  // ========================================================================
  describe('Layer 1b: getDefaultModels — default aliases per tier', () => {
    it.each(tierEntries)(
      'tier $tier → $allowedAliases',
      ({ tier, allowedAliases }) => {
        const result = mapper.getDefaultModels(tier);
        expect(result).toEqual(allowedAliases);
      },
    );
  });

  // ========================================================================
  // Layer 2: Two-Layer Intersection (9 tests)
  // tier_allowed ∩ ceiling[accessLevel] = expected_effective
  // ========================================================================
  describe('Layer 2: effective = tier_allowed ∩ ceiling[accessLevel]', () => {
    it.each(tierEntries)(
      'tier $tier ($accessLevel): effective = $expectedEffective',
      async ({ tier, allowedAliases, ceiling, expectedEffective }) => {
        const result = await mapper.resolveAccess(tier);
        const effective = computeEffective(result.allowedModelAliases, ceiling);

        expect(effective).toEqual(expectedEffective);
      },
    );
  });

  // ========================================================================
  // validateModelRequest — ceiling enforcement
  // ========================================================================
  describe('validateModelRequest — ceiling enforcement', () => {
    it('free tier: cheap allowed', () => {
      expect(mapper.validateModelRequest('cheap', ['cheap'])).toBe(true);
    });

    it('free tier: fast-code rejected', () => {
      expect(mapper.validateModelRequest('fast-code', ['cheap'])).toBe(false);
    });

    it('pro tier: all 3 aliases allowed', () => {
      const proAliases = fixtures.access_levels.pro.aliases;
      for (const alias of proAliases) {
        expect(mapper.validateModelRequest(alias as any, proAliases as any)).toBe(true);
      }
    });

    it('pro tier: reasoning rejected', () => {
      const proAliases = fixtures.access_levels.pro.aliases;
      expect(mapper.validateModelRequest('reasoning', proAliases as any)).toBe(false);
    });

    it('enterprise tier: all 5 aliases allowed', () => {
      const entAliases = fixtures.access_levels.enterprise.aliases;
      for (const alias of entAliases) {
        expect(mapper.validateModelRequest(alias as any, entAliases as any)).toBe(true);
      }
    });
  });

  // ========================================================================
  // Community Override: Restrict within ceiling
  // ========================================================================
  describe('Community Override: restrict within ceiling', () => {
    const scenario = fixtures.override_scenarios.restrict_within_ceiling;

    it('pro tier restricted to [cheap] via override → honored', async () => {
      const overrideProvider: TierOverrideProvider = {
        getTierOverrides: vi.fn().mockResolvedValue({
          [String(scenario.tier)]: {
            accessLevel: 'pro',
            aliases: scenario.override.allowedModelAliases,
          } satisfies TierMapping,
        }),
      };

      const mapperWithOverride = new TierAccessMapper(undefined, {
        overrideProvider,
      });

      const result = await mapperWithOverride.resolveAccess(
        scenario.tier,
        'community-restrict-test',
      );

      expect(result.accessLevel).toBe('pro');
      expect(result.allowedModelAliases).toEqual(scenario.expected);
    });

    it('restricted override: effective ⊆ ceiling', async () => {
      const overrideProvider: TierOverrideProvider = {
        getTierOverrides: vi.fn().mockResolvedValue({
          [String(scenario.tier)]: {
            accessLevel: 'pro',
            aliases: scenario.override.allowedModelAliases,
          } satisfies TierMapping,
        }),
      };

      const mapperWithOverride = new TierAccessMapper(undefined, {
        overrideProvider,
      });

      const result = await mapperWithOverride.resolveAccess(
        scenario.tier,
        'community-restrict-test',
      );

      const proCeiling = ceilingPolicy['pro'];
      const effective = computeEffective(result.allowedModelAliases, proCeiling);
      expect(effective).toEqual(scenario.expected);
    });
  });

  // ========================================================================
  // Community Override: Expand beyond ceiling
  // ========================================================================
  describe('Community Override: expand beyond ceiling', () => {
    const scenario = fixtures.override_scenarios.expand_beyond_ceiling;

    it('free tier override with [cheap, reasoning] → mapper returns override', async () => {
      const overrideProvider: TierOverrideProvider = {
        getTierOverrides: vi.fn().mockResolvedValue({
          [String(scenario.tier)]: {
            accessLevel: 'free',
            aliases: scenario.override.allowedModelAliases,
          } satisfies TierMapping,
        }),
      };

      const mapperWithOverride = new TierAccessMapper(undefined, {
        overrideProvider,
      });

      const result = await mapperWithOverride.resolveAccess(
        scenario.tier,
        'community-expand-test',
      );

      // Mapper returns the override as-is (no ceiling enforcement at this layer)
      expect(result.allowedModelAliases).toEqual(
        scenario.override.allowedModelAliases,
      );
    });

    it('ceiling enforcement: effective excludes aliases beyond ceiling', async () => {
      const overrideProvider: TierOverrideProvider = {
        getTierOverrides: vi.fn().mockResolvedValue({
          [String(scenario.tier)]: {
            accessLevel: 'free',
            aliases: scenario.override.allowedModelAliases,
          } satisfies TierMapping,
        }),
      };

      const mapperWithOverride = new TierAccessMapper(undefined, {
        overrideProvider,
      });

      const result = await mapperWithOverride.resolveAccess(
        scenario.tier,
        'community-expand-test',
      );

      const freeCeiling = scenario.ceiling_allows;
      const effective = computeEffective(result.allowedModelAliases, freeCeiling);

      expect(effective).toEqual(scenario.expected_effective);
      // 'reasoning' is rejected by ceiling
      expect(effective).not.toContain('reasoning');
    });

    it('validateModelRequest rejects reasoning against free ceiling', () => {
      const freeCeiling = scenario.ceiling_allows;
      expect(
        mapper.validateModelRequest('reasoning', freeCeiling as any),
      ).toBe(false);
    });
  });

  // ========================================================================
  // POLICY_ESCALATION: Gateway rejects model not in allowed list (403)
  // ========================================================================
  describe('POLICY_ESCALATION: gateway rejects model outside ceiling', () => {
    it('gateway throws MODEL_NOT_ALLOWED (403) for alias not in allowedModelAliases', async () => {
      const mockDeps = {
        budgetManager: {
          estimateCost: vi.fn().mockReturnValue(100),
          reserve: vi.fn().mockResolvedValue({ status: 'RESERVED' }),
          finalize: vi.fn(),
          cancelReservation: vi.fn(),
        },
        rateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
        loaFinnClient: {
          invoke: vi.fn(),
          healthCheck: vi.fn(),
          stream: vi.fn(),
        },
        tierMapper: mapper,
        redis: { get: vi.fn(), ping: vi.fn() },
        logger: {
          child: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          }),
        },
      };

      const gateway = new AgentGateway(mockDeps as any);

      // Free tier user requests 'reasoning' — not in allowedModelAliases
      const request = {
        modelAlias: 'reasoning',
        messages: [{ content: 'test', role: 'user' }],
        context: {
          traceId: 'trace-escalation',
          tenantId: 'community-1',
          userId: 'user-1',
          channelId: 'channel-1',
          accessLevel: 'free',
          idempotencyKey: 'idem-1',
          allowedModelAliases: ['cheap'], // free ceiling
        },
      };

      await expect(gateway.invoke(request as any)).rejects.toThrow(
        AgentGatewayError,
      );

      try {
        await gateway.invoke(request as any);
      } catch (err) {
        expect(err).toBeInstanceOf(AgentGatewayError);
        expect((err as AgentGatewayError).code).toBe('MODEL_NOT_ALLOWED');
        expect((err as AgentGatewayError).statusCode).toBe(403);
      }
    });

    it('gateway allows model within ceiling for same tier', async () => {
      const mockResponse = {
        content: 'ok',
        usage: { costUsd: 0.001, inputTokens: 10, outputTokens: 5 },
      };

      const mockDeps = {
        budgetManager: {
          estimateCost: vi.fn().mockReturnValue(100),
          reserve: vi.fn().mockResolvedValue({ status: 'RESERVED' }),
          finalize: vi.fn(),
          cancelReservation: vi.fn(),
        },
        rateLimiter: { check: vi.fn().mockResolvedValue({ allowed: true }) },
        loaFinnClient: {
          invoke: vi.fn().mockResolvedValue(mockResponse),
          healthCheck: vi.fn(),
          stream: vi.fn(),
        },
        tierMapper: mapper,
        redis: { get: vi.fn(), ping: vi.fn() },
        logger: {
          child: vi.fn().mockReturnValue({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
          }),
        },
      };

      const gateway = new AgentGateway(mockDeps as any);

      // Pro tier user requests 'fast-code' — within allowedModelAliases
      const request = {
        modelAlias: 'fast-code',
        messages: [{ content: 'test', role: 'user' }],
        context: {
          traceId: 'trace-allowed',
          tenantId: 'community-2',
          userId: 'user-2',
          channelId: 'channel-2',
          accessLevel: 'pro',
          idempotencyKey: 'idem-2',
          allowedModelAliases: ['cheap', 'fast-code', 'reviewer'], // pro ceiling
        },
      };

      const result = await gateway.invoke(request as any);
      expect(result).toBeDefined();
      expect(result.content).toBe('ok');
    });
  });

  // ========================================================================
  // Edge cases
  // ========================================================================
  describe('Edge cases', () => {
    it('invalid tier throws', async () => {
      await expect(mapper.resolveAccess(0)).rejects.toThrow('Invalid tier: 0');
      await expect(mapper.resolveAccess(10)).rejects.toThrow(
        'Invalid tier: 10',
      );
    });

    it('getDefaultModels for invalid tier returns [cheap]', () => {
      expect(mapper.getDefaultModels(0)).toEqual(['cheap']);
      expect(mapper.getDefaultModels(99)).toEqual(['cheap']);
    });

    it('resolveAccess without communityId skips override lookup', async () => {
      const overrideProvider: TierOverrideProvider = {
        getTierOverrides: vi.fn(),
      };

      const mapperWithOverride = new TierAccessMapper(undefined, {
        overrideProvider,
      });

      await mapperWithOverride.resolveAccess(5);
      expect(overrideProvider.getTierOverrides).not.toHaveBeenCalled();
    });

    it('override provider returning null falls through to defaults', async () => {
      const overrideProvider: TierOverrideProvider = {
        getTierOverrides: vi.fn().mockResolvedValue(null),
      };

      const mapperWithOverride = new TierAccessMapper(undefined, {
        overrideProvider,
      });

      const result = await mapperWithOverride.resolveAccess(
        5,
        'community-null-override',
      );
      const expected =
        fixtures.tiers['5' as keyof typeof fixtures.tiers];
      expect(result.accessLevel).toBe(expected.accessLevel);
      expect(result.allowedModelAliases).toEqual(
        expected.allowedModelAliases,
      );
    });
  });
});
