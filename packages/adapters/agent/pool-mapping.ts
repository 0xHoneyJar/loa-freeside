/**
 * Pool Mapping — Tier-Aware Pool Resolution
 * Sprint 3, Task 3.1: Hounfour Phase 4 — Spice Gate
 *
 * Maps model aliases to loa-finn pool IDs with tier-aware `native` handling.
 * Pool IDs match loa-finn vocabulary exactly: cheap, fast-code, reviewer, reasoning, architect.
 *
 * @see SDD §4.3 Pool Routing
 * @see ADR-005 Tier-Aware Native Resolution
 * @see ADR-006 Architect Pool Unreachability
 * @see Hounfour RFC #31 §3.1 Model Catalog — pool vocabulary definition
 * @see Hounfour RFC #31 §12 Agent Distribution via Arrakis — tier routing
 */

import type { AccessLevel, ModelAlias } from '@arrakis/core/ports';

// --------------------------------------------------------------------------
// Pool ID vocabulary (must match loa-finn pool-registry)
// --------------------------------------------------------------------------

export const POOL_IDS = ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'] as const;
export type PoolId = (typeof POOL_IDS)[number];

/** Set for O(1) validation */
export const VALID_POOL_IDS: ReadonlySet<string> = new Set(POOL_IDS);

/**
 * Pool → Provider hint mapping.
 * Determines which AI provider a pool ID is intended for,
 * used by BYOK to route community keys to the correct provider endpoint.
 *
 * @see Bridgebuilder BB3-1 — fixes provider inference from poolId.startsWith()
 * @see byok-provider-endpoints.ts for supported providers
 */
export const POOL_PROVIDER_HINT: Record<PoolId, 'openai' | 'anthropic'> = {
  cheap: 'openai',
  'fast-code': 'openai',
  reviewer: 'openai',
  reasoning: 'anthropic',
  architect: 'anthropic',
};

// --------------------------------------------------------------------------
// Access Level → Pool mapping (from PRD §2.1)
// --------------------------------------------------------------------------

export const ACCESS_LEVEL_POOLS: Record<AccessLevel, { default: PoolId; allowed: PoolId[] }> = {
  free:       { default: 'cheap',     allowed: ['cheap'] },
  pro:        { default: 'fast-code', allowed: ['cheap', 'fast-code', 'reviewer'] },
  enterprise: { default: 'architect', allowed: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'] },
};

// --------------------------------------------------------------------------
// Alias → Pool direct mapping (everything except `native`)
// --------------------------------------------------------------------------

/**
 * Direct alias→pool mapping. `architect` intentionally excluded — see ADR-006.
 *
 * @pattern capability-based-security — Pool IDs are unforgeable capability tokens
 * (Dennis & Van Horn 1966). Tier routing acts as the capability distribution
 * authority: each access level receives only the pool capabilities it is entitled
 * to. See SDD §10.1, ADR-006.
 */
export const ALIAS_TO_POOL: Partial<Record<ModelAlias, PoolId>> = {
  cheap: 'cheap',
  'fast-code': 'fast-code',
  reviewer: 'reviewer',
  reasoning: 'reasoning',
};

// `native` resolves tier-dependently — not in ALIAS_TO_POOL
const NATIVE_POOL: Record<AccessLevel, PoolId> = {
  free: 'cheap',        // Anti-escalation: free tier never gets expensive pool
  pro: 'fast-code',     // Pro tier default
  enterprise: 'architect', // Enterprise gets highest-capability pool
};

// --------------------------------------------------------------------------
// Access Level Type Guard (F-16: eliminate `as any` cast)
// --------------------------------------------------------------------------

const VALID_ACCESS_LEVELS: ReadonlySet<string> = new Set(['free', 'pro', 'enterprise']);

/**
 * Type guard for AccessLevel strings. Separates "unknown access level" (data quality)
 * from "valid access level with mismatched pools" (security concern).
 * @see Bridgebuilder F-16
 */
export function isAccessLevel(s: string): s is AccessLevel {
  return VALID_ACCESS_LEVELS.has(s);
}

// --------------------------------------------------------------------------
// Pool Claim Validation (F-5: confused deputy prevention)
// --------------------------------------------------------------------------

export interface PoolClaimValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Cross-validate pool claims against tier expectations.
 * Catches inconsistent claims (e.g., access_level: "free" with pool_id: "architect").
 *
 * Canonicalization: both allowedPools and expected set are sorted lexicographically
 * and deduplicated before comparison (order-independent, duplicate-tolerant).
 *
 * @see Hounfour RFC #31 §12 Agent Distribution via Arrakis
 */
export function validatePoolClaims(
  poolId: string,
  allowedPools: string[],
  accessLevel: AccessLevel,
): PoolClaimValidation {
  // 1. poolId must be a known pool ID
  if (!VALID_POOL_IDS.has(poolId)) {
    return { valid: false, reason: `unknown pool_id '${poolId}'` };
  }

  // 2. poolId must be in allowedPools (set membership, order-independent)
  if (!allowedPools.includes(poolId)) {
    return { valid: false, reason: `pool_id '${poolId}' not in allowed_pools [${allowedPools.join(', ')}]` };
  }

  // 3. allowedPools must match tier expectations (canonicalized set comparison)
  const tierConfig = ACCESS_LEVEL_POOLS[accessLevel];
  if (!tierConfig) {
    return { valid: false, reason: `unknown access_level '${accessLevel}'` };
  }

  const canonicalize = (arr: readonly string[]): string[] => [...new Set(arr)].sort();
  const expectedSorted = canonicalize(tierConfig.allowed);
  const actualSorted = canonicalize(allowedPools);

  if (
    expectedSorted.length !== actualSorted.length ||
    !expectedSorted.every((v, i) => v === actualSorted[i])
  ) {
    return {
      valid: false,
      reason: `allowed_pools mismatch for tier '${accessLevel}': expected [${expectedSorted.join(', ')}], got [${actualSorted.join(', ')}]`,
    };
  }

  return { valid: true };
}

// --------------------------------------------------------------------------
// Pool Resolution
// --------------------------------------------------------------------------

export interface PoolResolution {
  poolId: PoolId;
  allowedPools: PoolId[];
}

/**
 * Resolve a model alias to a pool ID with tier-aware `native` handling.
 *
 * Resolution rules:
 * - No alias → tier default pool
 * - `native` → tier-aware (free→cheap, pro→fast-code, enterprise→architect)
 * - Direct alias (cheap, fast-code, etc.) → 1:1 pool mapping
 * - Unauthorized pool → silent fallback to tier default (AC-3.4)
 * - Unknown alias → tier default (defense-in-depth)
 */
export function resolvePoolId(
  modelAlias: ModelAlias | undefined,
  accessLevel: AccessLevel,
): PoolResolution {
  const { default: defaultPool, allowed: allowedPools } = ACCESS_LEVEL_POOLS[accessLevel];

  // No alias → use tier default
  if (!modelAlias) {
    return { poolId: defaultPool, allowedPools };
  }

  // native → tier-aware resolution
  if (modelAlias === 'native') {
    return { poolId: NATIVE_POOL[accessLevel], allowedPools };
  }

  // Direct alias → pool
  const pool = ALIAS_TO_POOL[modelAlias];
  if (!pool) {
    return { poolId: defaultPool, allowedPools };
  }

  // Verify authorized — fallback to tier default if not (AC-3.4)
  if (!allowedPools.includes(pool)) {
    return { poolId: defaultPool, allowedPools };
  }

  return { poolId: pool, allowedPools };
}
