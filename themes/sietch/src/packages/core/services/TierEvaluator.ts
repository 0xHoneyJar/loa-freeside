/**
 * TierEvaluator - Tier Evaluation Service
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Provides tier evaluation logic independent of specific themes.
 * Supports different ranking strategies:
 * - absolute: Fixed rank ranges
 * - percentage: Percentile-based
 * - threshold: Score-based thresholds
 *
 * @module packages/core/services/TierEvaluator
 */

import type {
  IThemeProvider,
  TierConfig,
  TierDefinition,
  TierResult,
  RankingStrategy,
} from '../ports/IThemeProvider.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Batch tier evaluation result
 */
export interface BatchTierResult {
  /** Address -> TierResult mapping */
  results: Map<string, TierResult>;
  /** Evaluation timestamp */
  evaluatedAt: Date;
  /** Theme used for evaluation */
  themeId: string;
}

/**
 * Tier evaluation options
 */
export interface TierEvaluationOptions {
  /** Include rank within tier */
  includeRankInTier?: boolean;
  /** Track previous tier for demotion */
  previousTiers?: Map<string, string>;
}

// =============================================================================
// TierEvaluator Implementation
// =============================================================================

/**
 * TierEvaluator
 *
 * Stateless service for tier evaluation.
 * Delegates to theme-specific logic or applies generic strategies.
 */
export class TierEvaluator {
  /**
   * Evaluate tier for a single rank using a theme
   *
   * @param theme - Theme provider with tier configuration
   * @param rank - Member's rank (1 = top)
   * @param totalHolders - Total holders for percentage calculations
   * @param options - Evaluation options
   * @returns Tier result
   */
  evaluate(
    theme: IThemeProvider,
    rank: number,
    totalHolders?: number,
    options?: TierEvaluationOptions
  ): TierResult {
    const config = theme.getTierConfig();

    // Use theme's native evaluateTier if available
    const result = theme.evaluateTier(rank, totalHolders);

    // Add rank in tier if requested
    if (options?.includeRankInTier && !result.rankInTier) {
      const tier = config.tiers.find((t) => t.id === result.tierId);
      if (tier && tier.minRank !== undefined) {
        result.rankInTier = rank - tier.minRank + 1;
      }
    }

    // Track previous tier for demotion detection
    if (options?.previousTiers) {
      const previousTier = options.previousTiers.get(result.tierId);
      if (previousTier && previousTier !== result.tierId) {
        result.previousTier = previousTier;
      }
    }

    return result;
  }

  /**
   * Evaluate tiers for multiple members
   *
   * @param theme - Theme provider
   * @param ranks - Map of address -> rank
   * @param totalHolders - Total holders count
   * @param options - Evaluation options
   * @returns Batch results
   */
  evaluateBatch(
    theme: IThemeProvider,
    ranks: Map<string, number>,
    totalHolders?: number,
    options?: TierEvaluationOptions
  ): BatchTierResult {
    const results = new Map<string, TierResult>();

    for (const [address, rank] of ranks) {
      results.set(address, this.evaluate(theme, rank, totalHolders, options));
    }

    return {
      results,
      evaluatedAt: new Date(),
      themeId: theme.themeId,
    };
  }

  /**
   * Evaluate tier using a specific strategy (without theme)
   *
   * @param config - Tier configuration
   * @param rank - Member's rank
   * @param totalHolders - Total holders for percentage calculations
   * @returns Tier result
   */
  evaluateWithConfig(
    config: TierConfig,
    rank: number,
    totalHolders?: number
  ): TierResult {
    switch (config.rankingStrategy) {
      case 'absolute':
        return this.evaluateAbsolute(config.tiers, rank);
      case 'percentage':
        return this.evaluatePercentage(config.tiers, rank, totalHolders ?? rank);
      case 'threshold':
        // Threshold requires score, not rank - fallback to absolute
        return this.evaluateAbsolute(config.tiers, rank);
      default:
        return this.evaluateAbsolute(config.tiers, rank);
    }
  }

  /**
   * Evaluate using absolute rank ranges
   */
  private evaluateAbsolute(tiers: TierDefinition[], rank: number): TierResult {
    // Handle invalid rank
    if (rank < 1) {
      const topTier = tiers[0];
      return {
        tierId: topTier?.id ?? 'unknown',
        tierName: topTier?.displayName ?? 'Unknown',
        roleColor: topTier?.roleColor ?? '#888888',
        rankInTier: 1,
      };
    }

    // Find matching tier
    for (const tier of tiers) {
      const minRank = tier.minRank ?? 0;
      const maxRank = tier.maxRank;

      if (rank >= minRank && (maxRank === null || maxRank === undefined || rank <= maxRank)) {
        return {
          tierId: tier.id,
          tierName: tier.displayName,
          roleColor: tier.roleColor,
          rankInTier: rank - minRank + 1,
        };
      }
    }

    // No matching tier - return last tier as default
    const lastTier = tiers[tiers.length - 1];
    return {
      tierId: lastTier?.id ?? 'unknown',
      tierName: lastTier?.displayName ?? 'Unknown',
      roleColor: lastTier?.roleColor ?? '#888888',
      rankInTier: rank - (lastTier?.minRank ?? 0) + 1,
    };
  }

  /**
   * Evaluate using percentile-based ranking
   */
  private evaluatePercentage(
    tiers: TierDefinition[],
    rank: number,
    totalHolders: number
  ): TierResult {
    // Calculate percentile (lower rank = better percentile)
    const percentile = ((totalHolders - rank + 1) / totalHolders) * 100;

    // For percentage strategy, minRank/maxRank represent percentile thresholds
    for (const tier of tiers) {
      const minPct = tier.minRank ?? 0;
      const maxPct = tier.maxRank;

      if (percentile >= minPct && (maxPct === null || maxPct === undefined || percentile < maxPct)) {
        return {
          tierId: tier.id,
          tierName: tier.displayName,
          roleColor: tier.roleColor,
        };
      }
    }

    // Default to last tier
    const lastTier = tiers[tiers.length - 1];
    return {
      tierId: lastTier?.id ?? 'unknown',
      tierName: lastTier?.displayName ?? 'Unknown',
      roleColor: lastTier?.roleColor ?? '#888888',
    };
  }

  /**
   * Check if a tier change is a demotion
   *
   * @param config - Tier configuration
   * @param previousTierId - Previous tier ID
   * @param newTierId - New tier ID
   * @returns true if this is a demotion
   */
  isDemotion(config: TierConfig, previousTierId: string, newTierId: string): boolean {
    const previousIndex = config.tiers.findIndex((t) => t.id === previousTierId);
    const newIndex = config.tiers.findIndex((t) => t.id === newTierId);

    // Higher index = lower tier (tiers are ordered highest first)
    return newIndex > previousIndex;
  }

  /**
   * Check if a tier change is a promotion
   *
   * @param config - Tier configuration
   * @param previousTierId - Previous tier ID
   * @param newTierId - New tier ID
   * @returns true if this is a promotion
   */
  isPromotion(config: TierConfig, previousTierId: string, newTierId: string): boolean {
    const previousIndex = config.tiers.findIndex((t) => t.id === previousTierId);
    const newIndex = config.tiers.findIndex((t) => t.id === newTierId);

    // Lower index = higher tier
    return newIndex < previousIndex && newIndex >= 0;
  }

  /**
   * Get tier index (0 = highest tier)
   *
   * @param config - Tier configuration
   * @param tierId - Tier ID
   * @returns Index or -1 if not found
   */
  getTierIndex(config: TierConfig, tierId: string): number {
    return config.tiers.findIndex((t) => t.id === tierId);
  }

  /**
   * Get tier by ID
   *
   * @param config - Tier configuration
   * @param tierId - Tier ID
   * @returns Tier definition or undefined
   */
  getTierById(config: TierConfig, tierId: string): TierDefinition | undefined {
    return config.tiers.find((t) => t.id === tierId);
  }
}

/**
 * Factory function to create TierEvaluator instance
 */
export function createTierEvaluator(): TierEvaluator {
  return new TierEvaluator();
}

/**
 * Singleton instance for convenience
 */
export const tierEvaluator = new TierEvaluator();
