/**
 * Capability Catalog — Pluggable multi-source capability resolution (cycle-043 Phase II)
 *
 * Extracts capability resolution from DynamicContract into a generalized catalog
 * with pluggable resolvers. Capabilities from all resolvers combine via set union
 * (monotonic expansion preserved). Priority is for provenance attribution only.
 *
 * SDD ref: §3.4.6 (DynamicContract), Bridge speculation-1, Post-convergence §II
 * Sprint: 363, Task 2.1
 */

import type {
  DynamicContract,
  ProtocolSurface,
  ReputationStateName,
} from './arrakis-dynamic-contract.js';
import { resolveProtocolSurface } from './arrakis-dynamic-contract.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Context provided to resolvers for capability evaluation */
export interface ResolutionContext {
  /** Current reputation state of the requesting agent */
  reputationState?: ReputationStateName;
  /** Actor identity */
  actorId?: string;
  /** Additional metadata for resolver-specific logic */
  metadata?: Record<string, unknown>;
}

/** A set of capabilities resolved by a single resolver */
export interface CapabilitySet {
  capabilities: string[];
  schemas: string[];
  rate_limit_tier: string;
  ensemble_strategies: string[];
}

/** Provenance record: which resolver granted a capability */
export interface CapabilityProvenance {
  capability: string;
  grantedBy: string[];  // resolver names, highest priority first
}

/** The merged result of all resolvers */
export interface ResolvedCapabilities {
  capabilities: string[];
  schemas: string[];
  rate_limit_tier: string;
  ensemble_strategies: string[];
  provenance: CapabilityProvenance[];
}

/** Pluggable resolver interface */
export interface CapabilityResolver {
  /** Unique name for provenance tracking */
  name: string;
  /** Higher priority = listed first in provenance (NOT override semantics) */
  priority: number;
  /** Resolve capabilities for the given context */
  resolve(context: ResolutionContext): CapabilitySet;
}

// ─── Rate Limit Tier Ordering ────────────────────────────────────────────────

/** Default tier ordering from least to most permissive */
const DEFAULT_TIER_ORDER = ['free', 'basic', 'standard', 'premium', 'enterprise'];

function mostPermissiveTier(a: string, b: string, tierOrder: string[] = DEFAULT_TIER_ORDER): string {
  const indexA = tierOrder.indexOf(a);
  const indexB = tierOrder.indexOf(b);
  // Unknown tiers sort to the beginning (least permissive)
  const effectiveA = indexA === -1 ? -1 : indexA;
  const effectiveB = indexB === -1 ? -1 : indexB;
  return effectiveA >= effectiveB ? a : b;
}

// ─── Capability Catalog ──────────────────────────────────────────────────────

export class CapabilityCatalog {
  private resolvers: CapabilityResolver[] = [];
  private tierOrder: string[];

  constructor(options?: { tierOrder?: string[] }) {
    this.tierOrder = options?.tierOrder ?? DEFAULT_TIER_ORDER;
  }

  /** Register a resolver. Resolvers are evaluated in priority order (highest first). */
  addResolver(resolver: CapabilityResolver): void {
    this.resolvers.push(resolver);
    // Sort by priority descending (highest first for provenance)
    this.resolvers.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Resolve capabilities from all registered resolvers.
   *
   * Merge semantics:
   * - Boolean capabilities: set union (if ANY resolver grants it, it's granted)
   * - Parameterized capabilities (rate_limit_tier): most permissive wins
   * - Schema access: set union of all granted schemas
   * - Provenance: records which resolver(s) granted each capability
   */
  resolve(context: ResolutionContext): ResolvedCapabilities {
    if (this.resolvers.length === 0) {
      return {
        capabilities: [],
        schemas: [],
        rate_limit_tier: 'free',
        ensemble_strategies: [],
        provenance: [],
      };
    }

    const allCapabilities = new Map<string, string[]>(); // capability -> resolver names
    const allSchemas = new Set<string>();
    const allStrategies = new Set<string>();
    let mergedTier = 'free';

    for (const resolver of this.resolvers) {
      const result = resolver.resolve(context);

      // Union boolean capabilities with provenance tracking
      for (const cap of result.capabilities) {
        if (!allCapabilities.has(cap)) {
          allCapabilities.set(cap, []);
        }
        allCapabilities.get(cap)!.push(resolver.name);
      }

      // Union schemas
      for (const schema of result.schemas) {
        allSchemas.add(schema);
      }

      // Union ensemble strategies
      for (const strategy of result.ensemble_strategies) {
        allStrategies.add(strategy);
      }

      // Most permissive tier wins
      mergedTier = mostPermissiveTier(mergedTier, result.rate_limit_tier, this.tierOrder);
    }

    const capabilities = Array.from(allCapabilities.keys());
    const provenance: CapabilityProvenance[] = capabilities.map((cap) => ({
      capability: cap,
      grantedBy: allCapabilities.get(cap)!,
    }));

    return {
      capabilities,
      schemas: Array.from(allSchemas),
      rate_limit_tier: mergedTier,
      ensemble_strategies: Array.from(allStrategies),
      provenance,
    };
  }

  /** Check if a specific capability is granted in the resolved set */
  isGranted(capability: string, context: ResolutionContext): boolean {
    const resolved = this.resolve(context);
    return resolved.capabilities.includes(capability);
  }
}

// ─── Built-in Resolvers ──────────────────────────────────────────────────────

/**
 * ReputationResolver — Wraps existing resolveProtocolSurface() logic.
 *
 * Delegates to the DynamicContract for reputation-based capability resolution.
 * Produces identical results to the original resolveProtocolSurface() call.
 */
export class ReputationResolver implements CapabilityResolver {
  readonly name = 'reputation';
  readonly priority: number;
  private contract: DynamicContract;

  constructor(contract: DynamicContract, priority = 100) {
    this.contract = contract;
    this.priority = priority;
  }

  resolve(context: ResolutionContext): CapabilitySet {
    const state = context.reputationState ?? 'cold';
    const surface = resolveProtocolSurface(this.contract, state);

    return {
      capabilities: [...surface.capabilities],
      schemas: [...surface.schemas],
      rate_limit_tier: surface.rate_limit_tier,
      ensemble_strategies: [...(surface.ensemble_strategies ?? [])],
    };
  }
}

/**
 * FeatureFlagResolver — Evaluates feature flags from environment or config.
 *
 * Reads FEATURE_FLAGS env var as comma-separated capability list,
 * or accepts a static config object. Capabilities granted by feature flags
 * are additive (union) with other resolvers.
 */
export class FeatureFlagResolver implements CapabilityResolver {
  readonly name = 'feature_flags';
  readonly priority: number;
  private flags: Set<string>;
  private schemas: string[];
  private rateLimitTier: string;

  constructor(options?: {
    flags?: string[];
    schemas?: string[];
    rateLimitTier?: string;
    priority?: number;
  }) {
    this.priority = options?.priority ?? 50;
    this.rateLimitTier = options?.rateLimitTier ?? 'free';
    this.schemas = options?.schemas ?? [];

    // Read from options or env var
    if (options?.flags) {
      this.flags = new Set(options.flags);
    } else {
      const envFlags = process.env.FEATURE_FLAGS;
      this.flags = envFlags
        ? new Set(envFlags.split(',').map((f) => f.trim()).filter(Boolean))
        : new Set();
    }
  }

  resolve(_context: ResolutionContext): CapabilitySet {
    return {
      capabilities: Array.from(this.flags),
      schemas: [...this.schemas],
      rate_limit_tier: this.rateLimitTier,
      ensemble_strategies: [],
    };
  }
}
