/**
 * Tier→Access Mapper
 * Sprint S1-T3 + S3-T8: Default mapping with per-community PostgreSQL overrides + Redis cache
 *
 * Maps community tier (1-9) → access level → allowed model aliases.
 * Config-driven with sensible defaults from PRD §2.1.
 * Per-community overrides queried from community_agent_config.tier_overrides (FR-2.2).
 * Override results cached in Redis at agent:tier:override:{communityId} (TTL 5min).
 *
 * @see SDD §4.3 Tier→Access Mapper
 * @see PRD FR-2.1 Default Tier Mapping
 * @see PRD FR-2.2 Per-community tier overrides
 */

import type { AccessLevel, ModelAlias } from '@arrakis/core/ports';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Mapping entry for a single tier */
export interface TierMapping {
  accessLevel: AccessLevel;
  aliases: ModelAlias[];
}

/** Configuration for the tier→access mapper */
export interface TierMappingConfig {
  /** Default tier→access mapping (used when no community override) */
  defaults: Record<number, TierMapping>;
}

/** Provider interface for querying community tier overrides from DB */
export interface TierOverrideProvider {
  getTierOverrides(communityId: string): Promise<Record<string, TierMapping> | null>;
}

/** Cache TTL for tier overrides in Redis (5 minutes) */
const TIER_OVERRIDE_CACHE_TTL_S = 300;

// --------------------------------------------------------------------------
// Default Mapping (from PRD §2.1)
// --------------------------------------------------------------------------

/** Default tier→access mapping: 1-3→free, 4-6→pro, 7-9→enterprise */
export const DEFAULT_TIER_MAP: TierMappingConfig = {
  defaults: {
    1: { accessLevel: 'free', aliases: ['cheap'] },
    2: { accessLevel: 'free', aliases: ['cheap'] },
    3: { accessLevel: 'free', aliases: ['cheap'] },
    4: { accessLevel: 'pro', aliases: ['cheap', 'fast-code', 'reviewer'] },
    5: { accessLevel: 'pro', aliases: ['cheap', 'fast-code', 'reviewer'] },
    6: { accessLevel: 'pro', aliases: ['cheap', 'fast-code', 'reviewer'] },
    7: { accessLevel: 'enterprise', aliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'] },
    8: { accessLevel: 'enterprise', aliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'] },
    9: { accessLevel: 'enterprise', aliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'] },
  },
};

// --------------------------------------------------------------------------
// Tier→Access Mapper
// --------------------------------------------------------------------------

export class TierAccessMapper {
  private readonly config: TierMappingConfig;
  private readonly redis?: Redis;
  private readonly overrideProvider?: TierOverrideProvider;
  private readonly logger?: Logger;

  constructor(
    config?: TierMappingConfig,
    deps?: { redis?: Redis; overrideProvider?: TierOverrideProvider; logger?: Logger },
  ) {
    this.config = config ?? DEFAULT_TIER_MAP;
    this.redis = deps?.redis;
    this.overrideProvider = deps?.overrideProvider;
    this.logger = deps?.logger;
  }

  /**
   * Resolve access level and allowed model aliases for a given tier.
   * Checks per-community overrides first (FR-2.2), falls through to defaults.
   *
   * @param tier - Community tier (1-9)
   * @param communityId - Optional community ID for override lookup
   * @returns Access level and allowed model aliases
   * @throws Error if tier is out of range
   */
  async resolveAccess(
    tier: number,
    communityId?: string,
  ): Promise<{ accessLevel: AccessLevel; allowedModelAliases: ModelAlias[] }> {
    // Validate tier before any override resolution to prevent bypass
    const mapping = this.config.defaults[tier];
    if (!mapping) {
      throw new Error(`Invalid tier: ${tier}. Expected 1-9.`);
    }

    // Check per-community overrides if communityId provided and cache/provider available
    if (communityId && (this.redis || this.overrideProvider)) {
      const override = await this.getOverride(communityId, tier);
      if (override) {
        return {
          accessLevel: override.accessLevel,
          allowedModelAliases: [...override.aliases],
        };
      }
    }

    // Fall through to default mapping
    return {
      accessLevel: mapping.accessLevel,
      allowedModelAliases: [...mapping.aliases],
    };
  }

  /**
   * Validate that a requested model alias is allowed for the user's access level.
   *
   * @param alias - Requested model alias
   * @param allowed - Array of allowed model aliases for the user's tier
   * @returns True if the alias is permitted
   */
  validateModelRequest(alias: ModelAlias, allowed: ModelAlias[]): boolean {
    return allowed.includes(alias);
  }

  // --------------------------------------------------------------------------
  // Override Resolution (S3-T8)
  // --------------------------------------------------------------------------

  /**
   * Get tier override for a community, using Redis cache with DB fallback.
   * Cache key: agent:tier:override:{communityId} (TTL 5min)
   */
  private async getOverride(communityId: string, tier: number): Promise<TierMapping | null> {
    const cacheKey = `agent:tier:override:${communityId}`;

    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
          // Cache hit — parse and look up tier
          if (cached === 'null') return null; // Negative cache (no overrides)
          const overrides = JSON.parse(cached) as Record<string, TierMapping>;
          return overrides[String(tier)] ?? null;
        }
      } catch (err) {
        this.logger?.warn({ err, communityId }, 'TierAccessMapper: Redis cache read error');
      }
    }

    // Cache miss — query DB via provider
    if (!this.overrideProvider) return null;

    try {
      const overrides = await this.overrideProvider.getTierOverrides(communityId);

      // Cache result in Redis (including null for negative caching)
      if (this.redis) {
        try {
          const value = overrides ? JSON.stringify(overrides) : 'null';
          await this.redis.set(cacheKey, value, 'EX', TIER_OVERRIDE_CACHE_TTL_S);
        } catch (err) {
          this.logger?.warn({ err, communityId }, 'TierAccessMapper: Redis cache write error');
        }
      }

      if (!overrides) return null;
      return overrides[String(tier)] ?? null;
    } catch (err) {
      this.logger?.error({ err, communityId }, 'TierAccessMapper: DB query error — using defaults');
      return null;
    }
  }
}
