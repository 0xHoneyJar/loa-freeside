/**
 * Story Service
 *
 * Manages Dune-themed narrative fragments for Sietch v3.0 elite member joins.
 * Posts cryptic story fragments when Fedaykin/Naib members complete onboarding.
 *
 * Features:
 * - Random fragment selection with usage balancing
 * - Category-based fragments (fedaykin_join, naib_join)
 * - Automatic posting to #the-door channel
 * - Usage tracking to prevent fragment overuse
 *
 * Usage:
 * - Called during sync task when Fedaykin/Naib promotions occur
 * - Fragments stored in story_fragments table
 * - Seeded with default fragments via seed script
 */

import { logger } from '../utils/logger.js';
import { getDatabase } from '../db/index.js';
import type { Client, TextChannel } from 'discord.js';
import { config } from '../config.js';

/**
 * Story fragment category types
 */
export type FragmentCategory = 'fedaykin_join' | 'naib_join';

/**
 * Story fragment structure
 */
export interface StoryFragment {
  id: string;
  category: FragmentCategory;
  content: string;
  usedCount: number;
}

/**
 * Story Service class
 */
class StoryService {
  /**
   * Get a random story fragment for a category
   * Prefers least-used fragments to balance distribution
   *
   * @param category - Fragment category (fedaykin_join or naib_join)
   * @returns Fragment content or null if none available
   */
  getFragment(category: FragmentCategory): StoryFragment | null {
    const db = getDatabase();

    // Get least-used fragment for category
    // ORDER BY used_count ASC ensures we pick fragments that have been shown least
    // RANDOM() breaks ties randomly among fragments with same used_count
    const fragment = db
      .prepare(
        `
        SELECT id, category, content, used_count
        FROM story_fragments
        WHERE category = ?
        ORDER BY used_count ASC, RANDOM()
        LIMIT 1
      `
      )
      .get(category) as StoryFragment | undefined;

    if (!fragment) {
      logger.warn({ category }, 'No story fragments found for category');
      return null;
    }

    // Increment usage count
    db.prepare(
      `
      UPDATE story_fragments
      SET used_count = used_count + 1
      WHERE id = ?
    `
    ).run(fragment.id);

    logger.debug({ fragmentId: fragment.id, category, usedCount: fragment.usedCount }, 'Selected story fragment');

    // Return updated fragment with new count
    return {
      ...fragment,
      usedCount: fragment.usedCount + 1,
    };
  }

  /**
   * Format fragment content with decorative borders
   *
   * @param content - Raw fragment text
   * @returns Formatted message with decorative borders
   */
  formatFragment(content: string): string {
    const border = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    return `${border}\n${content}\n${border}`;
  }

  /**
   * Post a story fragment to #the-door channel
   *
   * @param discordClient - Discord.js client instance
   * @param category - Fragment category to post
   * @returns True if posted successfully, false otherwise
   */
  async postFragment(discordClient: Client, category: FragmentCategory): Promise<boolean> {
    const channelId = config.discord.channels.theDoor;

    if (!channelId) {
      logger.debug('THE_DOOR channel not configured, skipping story fragment');
      return false;
    }

    // Get fragment
    const fragment = this.getFragment(category);
    if (!fragment) {
      logger.warn({ category }, 'No fragment available for category');
      return false;
    }

    try {
      // Fetch channel
      const channel = await discordClient.channels.fetch(channelId);

      if (!channel?.isTextBased()) {
        logger.error({ channelId }, 'THE_DOOR channel is not text-based');
        return false;
      }

      // Format and post
      const formattedMessage = this.formatFragment(fragment.content);
      await (channel as TextChannel).send(formattedMessage);

      logger.info(
        {
          channelId,
          fragmentId: fragment.id,
          category,
          usedCount: fragment.usedCount,
        },
        'Posted story fragment to #the-door'
      );

      return true;
    } catch (error) {
      logger.error({ error, channelId, category }, 'Failed to post story fragment');
      return false;
    }
  }

  /**
   * Post join fragment based on member's tier promotion
   * Determines appropriate category (fedaykin_join or naib_join)
   *
   * @param discordClient - Discord.js client instance
   * @param tier - Member's new tier
   * @returns True if fragment posted, false if not applicable or failed
   */
  async postJoinFragment(discordClient: Client, tier: string): Promise<boolean> {
    let category: FragmentCategory | null = null;

    // Determine category based on tier
    if (tier === 'naib') {
      category = 'naib_join';
    } else if (tier === 'fedaykin') {
      category = 'fedaykin_join';
    }

    // Only post for elite tiers
    if (!category) {
      logger.debug({ tier }, 'Tier does not trigger story fragment');
      return false;
    }

    return this.postFragment(discordClient, category);
  }

  /**
   * Get all fragments for a category
   * Useful for admin review and debugging
   *
   * @param category - Optional category filter
   * @returns Array of story fragments
   */
  getAllFragments(category?: FragmentCategory): StoryFragment[] {
    const db = getDatabase();

    if (category) {
      return db
        .prepare(
          `
          SELECT id, category, content, used_count
          FROM story_fragments
          WHERE category = ?
          ORDER BY used_count ASC, id ASC
        `
        )
        .all(category) as StoryFragment[];
    }

    return db
      .prepare(
        `
        SELECT id, category, content, used_count
        FROM story_fragments
        ORDER BY category ASC, used_count ASC, id ASC
      `
      )
      .all() as StoryFragment[];
  }

  /**
   * Get fragment statistics
   * Returns count and usage distribution by category
   *
   * @returns Statistics object
   */
  getFragmentStats(): {
    total: number;
    byCategory: Record<string, { count: number; totalUsed: number; avgUsed: number }>;
  } {
    const db = getDatabase();

    const totalRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM story_fragments
      `
      )
      .get() as { count: number };

    const categoryStats = db
      .prepare(
        `
        SELECT
          category,
          COUNT(*) as count,
          SUM(used_count) as total_used,
          AVG(used_count) as avg_used
        FROM story_fragments
        GROUP BY category
      `
      )
      .all() as Array<{
      category: string;
      count: number;
      total_used: number;
      avg_used: number;
    }>;

    const byCategory: Record<string, { count: number; totalUsed: number; avgUsed: number }> = {};

    for (const stat of categoryStats) {
      byCategory[stat.category] = {
        count: stat.count,
        totalUsed: stat.total_used,
        avgUsed: Math.round(stat.avg_used * 100) / 100,
      };
    }

    return {
      total: totalRow.count,
      byCategory,
    };
  }
}

// Export singleton instance
export const storyService = new StoryService();
