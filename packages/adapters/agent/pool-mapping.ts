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
import type { RoutingPolicy, TaskType } from '@0xhoneyjar/loa-hounfour';
import {
  POOL_IDS as HOUNFOUR_POOL_IDS,
  TIER_POOL_ACCESS,
  TIER_DEFAULT_POOL,
} from '@0xhoneyjar/loa-hounfour';

// --------------------------------------------------------------------------
// Pool ID vocabulary (hounfour canonical source)
// --------------------------------------------------------------------------

export const POOL_IDS = HOUNFOUR_POOL_IDS;
export type PoolId = (typeof HOUNFOUR_POOL_IDS)[number];

/** Set for O(1) validation */
export const VALID_POOL_IDS: ReadonlySet<string> = new Set(POOL_IDS);

/**
 * Default pool → provider hint mapping.
 * Used as fallback when POOL_PROVIDER_HINTS env var is not set or invalid.
 *
 * @see Bridgebuilder BB3-1 — fixes provider inference from poolId.startsWith()
 * @see byok-provider-endpoints.ts for supported providers
 */
export const DEFAULT_POOL_PROVIDER_HINTS: Record<PoolId, 'openai' | 'anthropic'> = {
  cheap: 'openai',
  'fast-code': 'openai',
  reviewer: 'openai',
  reasoning: 'anthropic',
  architect: 'anthropic',
};

const VALID_PROVIDERS = new Set(['openai', 'anthropic']);

/**
 * Load pool → provider hints from POOL_PROVIDER_HINTS env var (JSON).
 * Falls back to defaults when env var is absent or invalid.
 *
 * Validation (AC-2.13, AC-2.14):
 * - Invalid JSON → warning + defaults used (AC-2.12)
 * - Unknown pool ID → warning (non-fatal, AC-2.13)
 * - Invalid provider value → fatal error (security boundary, AC-2.14)
 *
 * @see Bridgebuilder Round 6, Finding #5 — Provider Policy
 */
function loadPoolProviderHints(): Record<PoolId, 'openai' | 'anthropic'> {
  const raw = process.env['POOL_PROVIDER_HINTS'];
  if (!raw) return { ...DEFAULT_POOL_PROVIDER_HINTS };

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch {
    // AC-2.12: Invalid JSON → startup warning + defaults used
    console.warn('[pool-mapping] POOL_PROVIDER_HINTS env var is not valid JSON — using defaults');
    return { ...DEFAULT_POOL_PROVIDER_HINTS };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    console.warn('[pool-mapping] POOL_PROVIDER_HINTS must be a JSON object — using defaults');
    return { ...DEFAULT_POOL_PROVIDER_HINTS };
  }

  const parsed = parsedUnknown as Record<string, string>;
  const result = { ...DEFAULT_POOL_PROVIDER_HINTS };

  for (const [poolId, provider] of Object.entries(parsed)) {
    // AC-2.14: Invalid provider value → fatal (security boundary)
    if (!VALID_PROVIDERS.has(provider)) {
      throw new Error(
        `[pool-mapping] POOL_PROVIDER_HINTS: invalid provider '${provider}' for pool '${poolId}'. ` +
        `Valid providers: ${[...VALID_PROVIDERS].join(', ')}`,
      );
    }

    // AC-2.13: Unknown pool ID → warning (non-fatal)
    if (!VALID_POOL_IDS.has(poolId)) {
      console.warn(`[pool-mapping] POOL_PROVIDER_HINTS: unknown pool ID '${poolId}' — ignoring`);
      continue;
    }

    result[poolId as PoolId] = provider as 'openai' | 'anthropic';
  }

  return result;
}

/**
 * Pool → Provider hint mapping (configurable via POOL_PROVIDER_HINTS env var).
 * Determines which AI provider a pool ID is intended for,
 * used by BYOK to route community keys to the correct provider endpoint.
 *
 * Format: JSON object mapping pool IDs to providers.
 * Example: POOL_PROVIDER_HINTS='{"cheap":"openai","reasoning":"anthropic"}'
 *
 * @see Bridgebuilder BB3-1, BB6 Finding #5
 */
export const POOL_PROVIDER_HINT: Record<PoolId, 'openai' | 'anthropic'> = loadPoolProviderHints();

// --------------------------------------------------------------------------
// Access Level → Pool mapping (from PRD §2.1)
// --------------------------------------------------------------------------

export const ACCESS_LEVEL_POOLS: Record<AccessLevel, { default: PoolId; allowed: PoolId[] }> = {
  free:       { default: TIER_DEFAULT_POOL.free as PoolId,       allowed: TIER_POOL_ACCESS.free as PoolId[] },
  pro:        { default: TIER_DEFAULT_POOL.pro as PoolId,        allowed: TIER_POOL_ACCESS.pro as PoolId[] },
  enterprise: { default: TIER_DEFAULT_POOL.enterprise as PoolId, allowed: TIER_POOL_ACCESS.enterprise as PoolId[] },
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
// Uses hounfour canonical defaults (enterprise default is 'reviewer', not 'architect')
const NATIVE_POOL: Record<AccessLevel, PoolId> = {
  free: TIER_DEFAULT_POOL.free as PoolId,             // Anti-escalation: free tier never gets expensive pool
  pro: TIER_DEFAULT_POOL.pro as PoolId,               // Pro tier default
  enterprise: TIER_DEFAULT_POOL.enterprise as PoolId,  // Enterprise tier default (hounfour canonical)
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
 * - RoutingPolicy override → personality task-type routing (Sprint 324, Task 3.2)
 * - No alias → tier default pool
 * - `native` → tier-aware (free→cheap, pro→fast-code, enterprise→architect)
 * - Direct alias (cheap, fast-code, etc.) → 1:1 pool mapping
 * - Unauthorized pool → silent fallback to tier default (AC-3.4)
 * - Unknown alias → tier default (defense-in-depth)
 */
export function resolvePoolId(
  modelAlias: ModelAlias | undefined,
  accessLevel: AccessLevel,
  routingOverride?: { policy: RoutingPolicy; personalityId: string; taskType: TaskType },
): PoolResolution {
  // Guard against invalid access levels at runtime — fallback to least-privileged tier
  const level: AccessLevel = isAccessLevel(accessLevel as string) ? accessLevel : 'free';
  const { default: defaultPool, allowed: allowedPools } = ACCESS_LEVEL_POOLS[level];

  // RoutingPolicy override — personality-based task-type routing (Sprint 324)
  // Defense-in-depth: validate shape at runtime even though TS provides compile-time safety
  if (routingOverride) {
    const personalities = Array.isArray(routingOverride.policy?.personalities)
      ? routingOverride.policy.personalities
      : [];

    const personality = personalities.find(
      (p) => p && typeof p === 'object' && p.personality_id === routingOverride.personalityId,
    );

    if (personality && typeof personality.task_routing === 'object') {
      const routedPool = personality.task_routing[routingOverride.taskType] as unknown;
      if (
        typeof routedPool === 'string' &&
        VALID_POOL_IDS.has(routedPool) &&
        allowedPools.includes(routedPool as PoolId)
      ) {
        return { poolId: routedPool as PoolId, allowedPools };
      }
      // Routed pool not authorized for tier or invalid → fallback to tier default
    }
    // Personality not found or malformed → fall through to standard resolution
  }

  // No alias → use tier default
  if (!modelAlias) {
    return { poolId: defaultPool, allowedPools };
  }

  // native → tier-aware resolution
  if (modelAlias === 'native') {
    return { poolId: NATIVE_POOL[level], allowedPools };
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
