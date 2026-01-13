/**
 * BadgeEvaluator - Badge Evaluation Service
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Provides badge evaluation logic independent of specific themes.
 * Supports built-in criteria types and custom evaluators.
 *
 * Built-in criteria types:
 * - tenure: Days since first claim
 * - tier_reached: Has reached specific tier
 * - tier_maintained: Has maintained tier for duration
 * - activity: Activity score threshold
 * - conviction: Conviction score threshold
 * - custom: Custom evaluator function
 *
 * @module packages/core/services/BadgeEvaluator
 */

import type {
  IThemeProvider,
  BadgeConfig,
  BadgeDefinition,
  BadgeCriteria,
  EarnedBadge,
  MemberContext,
} from '../ports/IThemeProvider.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Custom badge evaluator function type
 */
export type CustomBadgeEvaluator = (
  badge: BadgeDefinition,
  member: MemberContext
) => boolean | Promise<boolean>;

/**
 * Registry of custom evaluators
 */
export type CustomEvaluatorRegistry = Map<string, CustomBadgeEvaluator>;

/**
 * Badge evaluation result with metadata
 */
export interface BadgeEvaluationResult {
  /** Earned badges */
  earned: EarnedBadge[];
  /** Badges that were checked but not earned */
  notEarned: string[];
  /** Evaluation timestamp */
  evaluatedAt: Date;
  /** Theme used for evaluation */
  themeId: string;
}

/**
 * Batch badge evaluation result
 */
export interface BatchBadgeResult {
  /** Address -> earned badges mapping */
  results: Map<string, EarnedBadge[]>;
  /** Evaluation timestamp */
  evaluatedAt: Date;
  /** Theme used for evaluation */
  themeId: string;
}

/**
 * Badge evaluation options
 */
export interface BadgeEvaluationOptions {
  /** Include not-earned badges in result */
  includeNotEarned?: boolean;
  /** Filter by category */
  categories?: string[];
  /** Skip custom evaluators */
  skipCustom?: boolean;
}

// =============================================================================
// BadgeEvaluator Implementation
// =============================================================================

/**
 * BadgeEvaluator
 *
 * Stateless service for badge evaluation.
 * Can register custom evaluators for complex badge criteria.
 */
export class BadgeEvaluator {
  private readonly customEvaluators: CustomEvaluatorRegistry = new Map();

  /**
   * Register a custom badge evaluator
   *
   * @param name - Evaluator name (matches badge.criteria.customEvaluator)
   * @param evaluator - Evaluator function
   */
  registerCustomEvaluator(name: string, evaluator: CustomBadgeEvaluator): void {
    this.customEvaluators.set(name, evaluator);
  }

  /**
   * Unregister a custom evaluator
   *
   * @param name - Evaluator name
   * @returns true if evaluator was removed
   */
  unregisterCustomEvaluator(name: string): boolean {
    return this.customEvaluators.delete(name);
  }

  /**
   * Get all registered custom evaluator names
   */
  getRegisteredEvaluators(): string[] {
    return Array.from(this.customEvaluators.keys());
  }

  /**
   * Evaluate badges for a member using a theme
   *
   * @param theme - Theme provider with badge configuration
   * @param member - Member context
   * @param options - Evaluation options
   * @returns Badge evaluation result
   */
  async evaluate(
    theme: IThemeProvider,
    member: MemberContext,
    options?: BadgeEvaluationOptions
  ): Promise<BadgeEvaluationResult> {
    const config = theme.getBadgeConfig();
    const earned: EarnedBadge[] = [];
    const notEarned: string[] = [];
    const now = new Date();

    // Filter badges by category if specified
    let badges = config.badges;
    if (options?.categories && options.categories.length > 0) {
      badges = badges.filter((b) => options.categories!.includes(b.category));
    }

    for (const badge of badges) {
      const isEarned = await this.evaluateBadgeCriteria(badge, member, options);

      if (isEarned) {
        earned.push({
          badgeId: badge.id,
          badgeName: badge.displayName,
          emoji: badge.emoji,
          earnedAt: now,
        });
      } else if (options?.includeNotEarned) {
        notEarned.push(badge.id);
      }
    }

    return {
      earned,
      notEarned,
      evaluatedAt: now,
      themeId: theme.themeId,
    };
  }

  /**
   * Evaluate badges for multiple members
   *
   * @param theme - Theme provider
   * @param members - Array of member contexts
   * @param options - Evaluation options
   * @returns Batch results
   */
  async evaluateBatch(
    theme: IThemeProvider,
    members: MemberContext[],
    options?: BadgeEvaluationOptions
  ): Promise<BatchBadgeResult> {
    const results = new Map<string, EarnedBadge[]>();

    for (const member of members) {
      const result = await this.evaluate(theme, member, options);
      results.set(member.address, result.earned);
    }

    return {
      results,
      evaluatedAt: new Date(),
      themeId: theme.themeId,
    };
  }

  /**
   * Evaluate badges using a specific config (without theme)
   *
   * @param config - Badge configuration
   * @param member - Member context
   * @param options - Evaluation options
   * @returns Array of earned badges
   */
  async evaluateWithConfig(
    config: BadgeConfig,
    member: MemberContext,
    options?: BadgeEvaluationOptions
  ): Promise<EarnedBadge[]> {
    const earned: EarnedBadge[] = [];
    const now = new Date();

    let badges = config.badges;
    if (options?.categories && options.categories.length > 0) {
      badges = badges.filter((b) => options.categories!.includes(b.category));
    }

    for (const badge of badges) {
      const isEarned = await this.evaluateBadgeCriteria(badge, member, options);

      if (isEarned) {
        earned.push({
          badgeId: badge.id,
          badgeName: badge.displayName,
          emoji: badge.emoji,
          earnedAt: now,
        });
      }
    }

    return earned;
  }

  /**
   * Evaluate a single badge criteria
   */
  private async evaluateBadgeCriteria(
    badge: BadgeDefinition,
    member: MemberContext,
    options?: BadgeEvaluationOptions
  ): Promise<boolean> {
    const { criteria } = badge;

    switch (criteria.type) {
      case 'tenure':
        return this.evaluateTenure(criteria, member);

      case 'tier_reached':
        return this.evaluateTierReached(criteria, member);

      case 'tier_maintained':
        return this.evaluateTierMaintained(criteria, member);

      case 'activity':
        return this.evaluateActivity(criteria, member);

      case 'conviction':
        return this.evaluateConviction(criteria, member);

      case 'custom':
        if (options?.skipCustom) {
          return false;
        }
        return this.evaluateCustom(badge, member);

      default:
        return false;
    }
  }

  /**
   * Evaluate tenure-based badge
   */
  private evaluateTenure(criteria: BadgeCriteria, member: MemberContext): boolean {
    const threshold = criteria.threshold ?? 0;
    return member.tenureDays >= threshold;
  }

  /**
   * Evaluate tier-reached badge
   */
  private evaluateTierReached(criteria: BadgeCriteria, member: MemberContext): boolean {
    const tierRequired = criteria.tierRequired;
    if (!tierRequired) {
      return false;
    }

    // Check current tier or highest ever reached
    return (
      member.currentTier === tierRequired ||
      member.highestTier === tierRequired
    );
  }

  /**
   * Evaluate tier-maintained badge
   */
  private evaluateTierMaintained(criteria: BadgeCriteria, member: MemberContext): boolean {
    const tierRequired = criteria.tierRequired;
    const durationDays = criteria.durationDays ?? 0;

    if (!tierRequired) {
      return false;
    }

    // Simplified: check if current tier matches and tenure is sufficient
    // Full implementation would track tier history
    return member.currentTier === tierRequired && member.tenureDays >= durationDays;
  }

  /**
   * Evaluate activity-based badge
   */
  private evaluateActivity(criteria: BadgeCriteria, member: MemberContext): boolean {
    const threshold = criteria.threshold ?? 0;
    return member.activityScore >= threshold;
  }

  /**
   * Evaluate conviction-based badge
   */
  private evaluateConviction(criteria: BadgeCriteria, member: MemberContext): boolean {
    const threshold = criteria.threshold ?? 0;
    return member.convictionScore >= threshold;
  }

  /**
   * Evaluate custom badge using registered evaluator
   */
  private async evaluateCustom(
    badge: BadgeDefinition,
    member: MemberContext
  ): Promise<boolean> {
    const evaluatorName = badge.criteria.customEvaluator;
    if (!evaluatorName) {
      return false;
    }

    const evaluator = this.customEvaluators.get(evaluatorName);
    if (!evaluator) {
      // Custom evaluator not registered - badge not earned
      return false;
    }

    try {
      return await evaluator(badge, member);
    } catch {
      // Error in custom evaluator - badge not earned
      return false;
    }
  }

  /**
   * Check if a badge is revocable
   *
   * @param config - Badge configuration
   * @param badgeId - Badge ID to check
   * @returns true if badge can be revoked
   */
  isBadgeRevocable(config: BadgeConfig, badgeId: string): boolean {
    const badge = config.badges.find((b) => b.id === badgeId);
    return badge?.revocable ?? false;
  }

  /**
   * Get badges by category
   *
   * @param config - Badge configuration
   * @param category - Category to filter
   * @returns Badges in the category
   */
  getBadgesByCategory(config: BadgeConfig, category: string): BadgeDefinition[] {
    return config.badges.filter((b) => b.category === category);
  }

  /**
   * Get badge by ID
   *
   * @param config - Badge configuration
   * @param badgeId - Badge ID
   * @returns Badge definition or undefined
   */
  getBadgeById(config: BadgeConfig, badgeId: string): BadgeDefinition | undefined {
    return config.badges.find((b) => b.id === badgeId);
  }
}

/**
 * Factory function to create BadgeEvaluator instance
 */
export function createBadgeEvaluator(): BadgeEvaluator {
  return new BadgeEvaluator();
}

/**
 * Singleton instance for convenience
 */
export const badgeEvaluator = new BadgeEvaluator();
