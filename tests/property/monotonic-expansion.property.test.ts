/**
 * Monotonic Expansion — Property-based tests (Task 2.3)
 *
 * Uses fast-check to verify that the monotonic expansion invariant holds
 * under arbitrary DynamicContract configurations.
 *
 * Properties:
 * 1. For all reputation state pairs (a, b) where a < b, surface(b) >= surface(a).capabilities
 * 2. For all reputation state pairs (a, b) where a < b, surface(b) >= surface(a).schemas
 * 3. resolveProtocolSurface(contract, 'unknown') always returns cold surface
 * 4. CapabilityCatalog.resolve() is idempotent (same context -> same result)
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { resolveProtocolSurface } from '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js';
import { CapabilityCatalog, ReputationResolver } from '../../themes/sietch/src/packages/core/protocol/capability-catalog.js';
import type { ReputationStateName } from '../../themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Ordered reputation states from lowest to highest */
const REPUTATION_ORDER: ReputationStateName[] = ['cold', 'warming', 'established', 'authoritative'];

/** Generate an arbitrary capability name */
const arbCapability = fc.stringOf(
  fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '_'),
  { minLength: 1, maxLength: 8 },
);

/** Generate an arbitrary schema name */
const arbSchema = fc.stringOf(
  fc.constantFrom('s', 't', 'u', 'v', 'w', '_'),
  { minLength: 1, maxLength: 6 },
);

const arbTier = fc.constantFrom('free', 'basic', 'standard', 'premium', 'enterprise');
const arbStrategy = fc.constantFrom('voting', 'cascade', 'mixture', 'routing');

/** Generate a monotonically expanding DynamicContract */
const arbMonotonicContract = fc.tuple(
  fc.set(arbCapability, { minLength: 0, maxLength: 5 }),
  fc.set(arbCapability, { minLength: 0, maxLength: 5 }),
  fc.set(arbCapability, { minLength: 0, maxLength: 5 }),
  fc.set(arbSchema, { minLength: 0, maxLength: 4 }),
  fc.set(arbSchema, { minLength: 0, maxLength: 4 }),
  fc.set(arbSchema, { minLength: 0, maxLength: 4 }),
  fc.tuple(arbTier, arbTier, arbTier, arbTier),
  fc.set(arbStrategy, { minLength: 0, maxLength: 3 }),
).map(([coldCaps, warmExtra, estExtra, coldSchemas, warmSchemaExtra, estSchemaExtra, tiers, strategies]) => {
  // Build monotonically expanding surfaces
  const warmCaps = [...new Set([...coldCaps, ...warmExtra])];
  const estCaps = [...new Set([...warmCaps, ...estExtra])];
  const authCaps = [...estCaps]; // authoritative >= established

  const warmSchemas = [...new Set([...coldSchemas, ...warmSchemaExtra])];
  const estSchemas = [...new Set([...warmSchemas, ...estSchemaExtra])];
  const authSchemas = [...estSchemas];

  return {
    version: '1.0.0',
    surfaces: {
      cold: {
        schemas: [...coldSchemas],
        capabilities: [...coldCaps],
        rate_limit_tier: tiers[0],
        ensemble_strategies: [],
      },
      warming: {
        schemas: warmSchemas,
        capabilities: warmCaps,
        rate_limit_tier: tiers[1],
        ensemble_strategies: [],
      },
      established: {
        schemas: estSchemas,
        capabilities: estCaps,
        rate_limit_tier: tiers[2],
        ensemble_strategies: [...strategies],
      },
      authoritative: {
        schemas: authSchemas,
        capabilities: authCaps,
        rate_limit_tier: tiers[3],
        ensemble_strategies: [...strategies],
      },
    },
  } as any;
});

// ─── Properties ──────────────────────────────────────────────────────────────

describe('Monotonic Expansion Properties', () => {
  it('Property 1: capability monotonicity — higher reputation never loses capabilities', () => {
    fc.assert(
      fc.property(arbMonotonicContract, (contract) => {
        for (let i = 0; i < REPUTATION_ORDER.length - 1; i++) {
          const lower = resolveProtocolSurface(contract, REPUTATION_ORDER[i]);
          const upper = resolveProtocolSurface(contract, REPUTATION_ORDER[i + 1]);

          // Every capability in the lower state must exist in the upper state
          for (const cap of lower.capabilities) {
            if (!upper.capabilities.includes(cap)) {
              return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('Property 2: schema monotonicity — higher reputation never loses schemas', () => {
    fc.assert(
      fc.property(arbMonotonicContract, (contract) => {
        for (let i = 0; i < REPUTATION_ORDER.length - 1; i++) {
          const lower = resolveProtocolSurface(contract, REPUTATION_ORDER[i]);
          const upper = resolveProtocolSurface(contract, REPUTATION_ORDER[i + 1]);

          for (const schema of lower.schemas) {
            if (!upper.schemas.includes(schema)) {
              return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it('Property 3: fail-closed to cold — unknown state always returns cold surface', () => {
    const arbUnknownState = fc.stringOf(
      fc.constantFrom('x', 'y', 'z', '0', '1'),
      { minLength: 1, maxLength: 10 },
    ).filter((s) => !REPUTATION_ORDER.includes(s as any));

    fc.assert(
      fc.property(arbMonotonicContract, arbUnknownState, (contract, unknownState) => {
        const coldSurface = resolveProtocolSurface(contract, 'cold');
        const unknownSurface = resolveProtocolSurface(contract, unknownState as any);

        // Unknown state should resolve to cold
        return (
          JSON.stringify(unknownSurface.capabilities.sort()) ===
          JSON.stringify(coldSurface.capabilities.sort()) &&
          JSON.stringify(unknownSurface.schemas.sort()) ===
          JSON.stringify(coldSurface.schemas.sort())
        );
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: CapabilityCatalog.resolve() is idempotent', () => {
    fc.assert(
      fc.property(
        arbMonotonicContract,
        fc.constantFrom<ReputationStateName>('cold', 'warming', 'established', 'authoritative'),
        (contract, state) => {
          const catalog = new CapabilityCatalog();
          catalog.addResolver(new ReputationResolver(contract));

          const ctx = { reputationState: state };
          const result1 = catalog.resolve(ctx);
          const result2 = catalog.resolve(ctx);

          return (
            JSON.stringify(result1.capabilities.sort()) === JSON.stringify(result2.capabilities.sort()) &&
            JSON.stringify(result1.schemas.sort()) === JSON.stringify(result2.schemas.sort()) &&
            result1.rate_limit_tier === result2.rate_limit_tier
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
