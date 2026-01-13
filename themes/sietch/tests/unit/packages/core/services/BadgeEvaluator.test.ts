/**
 * BadgeEvaluator Unit Tests
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Tests for the BadgeEvaluator service.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BadgeEvaluator,
  createBadgeEvaluator,
  badgeEvaluator,
} from '../../../../../src/packages/core/services/BadgeEvaluator.js';
import { BasicTheme } from '../../../../../src/packages/adapters/themes/BasicTheme.js';
import type { MemberContext, BadgeDefinition } from '../../../../../src/packages/core/ports/IThemeProvider.js';

describe('BadgeEvaluator', () => {
  let evaluator: BadgeEvaluator;
  let theme: BasicTheme;

  const createMemberContext = (overrides: Partial<MemberContext> = {}): MemberContext => ({
    address: '0x1234567890123456789012345678901234567890',
    rank: 50,
    currentTier: 'silver',
    convictionScore: 100,
    activityScore: 0,
    firstClaimAt: new Date('2024-01-01'),
    lastActivityAt: new Date(),
    tenureDays: 0,
    ...overrides,
  });

  beforeEach(() => {
    evaluator = new BadgeEvaluator();
    theme = new BasicTheme();
  });

  describe('evaluate', () => {
    it('should return empty for new member', async () => {
      const member = createMemberContext({ tenureDays: 0, activityScore: 0 });
      const result = await evaluator.evaluate(theme, member);

      expect(result.earned).toHaveLength(0);
      expect(result.themeId).toBe('basic');
    });

    it('should award tenure badges', async () => {
      const member = createMemberContext({ tenureDays: 90 });
      const result = await evaluator.evaluate(theme, member);

      const badgeIds = result.earned.map((b) => b.badgeId);
      expect(badgeIds).toContain('early_adopter');
      expect(badgeIds).toContain('veteran');
    });

    it('should award tier_reached badge', async () => {
      const member = createMemberContext({ currentTier: 'gold' });
      const result = await evaluator.evaluate(theme, member);

      const topTier = result.earned.find((b) => b.badgeId === 'top_tier');
      expect(topTier).toBeDefined();
    });

    it('should award activity badge', async () => {
      const member = createMemberContext({ activityScore: 50 });
      const result = await evaluator.evaluate(theme, member);

      const active = result.earned.find((b) => b.badgeId === 'active');
      expect(active).toBeDefined();
    });

    it('should include notEarned when option is set', async () => {
      const member = createMemberContext({ tenureDays: 0, activityScore: 0 });
      const result = await evaluator.evaluate(theme, member, { includeNotEarned: true });

      expect(result.notEarned.length).toBeGreaterThan(0);
      expect(result.notEarned).toContain('early_adopter');
    });

    it('should filter by category', async () => {
      const member = createMemberContext({ tenureDays: 90, activityScore: 50 });
      const result = await evaluator.evaluate(theme, member, { categories: ['tenure'] });

      const badgeIds = result.earned.map((b) => b.badgeId);
      expect(badgeIds).toContain('early_adopter');
      expect(badgeIds).toContain('veteran');
      expect(badgeIds).not.toContain('active'); // Activity category not included
    });

    it('should include evaluation timestamp', async () => {
      const member = createMemberContext({ tenureDays: 30 });
      const before = new Date();
      const result = await evaluator.evaluate(theme, member);
      const after = new Date();

      expect(result.evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.evaluatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('evaluateBatch', () => {
    it('should evaluate multiple members', async () => {
      const members = [
        createMemberContext({ address: '0x1111', tenureDays: 30 }),
        createMemberContext({ address: '0x2222', tenureDays: 90 }),
      ];

      const result = await evaluator.evaluateBatch(theme, members);

      expect(result.results.get('0x1111')?.length).toBe(1); // early_adopter
      expect(result.results.get('0x2222')?.length).toBe(2); // early_adopter + veteran
    });

    it('should include theme ID', async () => {
      const members = [createMemberContext()];
      const result = await evaluator.evaluateBatch(theme, members);
      expect(result.themeId).toBe('basic');
    });
  });

  describe('evaluateWithConfig', () => {
    it('should evaluate with config directly', async () => {
      const config = theme.getBadgeConfig();
      const member = createMemberContext({ tenureDays: 30 });
      const earned = await evaluator.evaluateWithConfig(config, member);

      expect(earned.length).toBeGreaterThan(0);
      expect(earned.some((b) => b.badgeId === 'early_adopter')).toBe(true);
    });

    it('should filter by category', async () => {
      const config = theme.getBadgeConfig();
      const member = createMemberContext({ tenureDays: 90, activityScore: 50 });
      const earned = await evaluator.evaluateWithConfig(config, member, { categories: ['activity'] });

      expect(earned.every((b) => config.badges.find((bd) => bd.id === b.badgeId)?.category === 'activity')).toBe(true);
    });
  });

  describe('custom evaluators', () => {
    it('should register custom evaluator', () => {
      evaluator.registerCustomEvaluator('test', () => true);
      expect(evaluator.getRegisteredEvaluators()).toContain('test');
    });

    it('should unregister custom evaluator', () => {
      evaluator.registerCustomEvaluator('test', () => true);
      const removed = evaluator.unregisterCustomEvaluator('test');
      expect(removed).toBe(true);
      expect(evaluator.getRegisteredEvaluators()).not.toContain('test');
    });

    it('should evaluate custom badge with registered evaluator', async () => {
      // Register a custom evaluator that always returns true
      evaluator.registerCustomEvaluator('contributorCheck', () => true);

      const member = createMemberContext();
      const result = await evaluator.evaluate(theme, member);

      const contributor = result.earned.find((b) => b.badgeId === 'contributor');
      expect(contributor).toBeDefined();
    });

    it('should skip custom evaluators when option is set', async () => {
      evaluator.registerCustomEvaluator('contributorCheck', () => true);

      const member = createMemberContext();
      const result = await evaluator.evaluate(theme, member, { skipCustom: true });

      const contributor = result.earned.find((b) => b.badgeId === 'contributor');
      expect(contributor).toBeUndefined();
    });

    it('should handle async custom evaluator', async () => {
      evaluator.registerCustomEvaluator('contributorCheck', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return true;
      });

      const member = createMemberContext();
      const result = await evaluator.evaluate(theme, member);

      const contributor = result.earned.find((b) => b.badgeId === 'contributor');
      expect(contributor).toBeDefined();
    });

    it('should handle custom evaluator errors gracefully', async () => {
      evaluator.registerCustomEvaluator('contributorCheck', () => {
        throw new Error('Test error');
      });

      const member = createMemberContext();
      const result = await evaluator.evaluate(theme, member);

      // Should not throw, badge just not earned
      const contributor = result.earned.find((b) => b.badgeId === 'contributor');
      expect(contributor).toBeUndefined();
    });
  });

  describe('isBadgeRevocable', () => {
    it('should return true for revocable badges', () => {
      const config = theme.getBadgeConfig();
      // Active badge is revocable
      expect(evaluator.isBadgeRevocable(config, 'active')).toBe(true);
    });

    it('should return false for non-revocable badges', () => {
      const config = theme.getBadgeConfig();
      // Early adopter is not revocable
      expect(evaluator.isBadgeRevocable(config, 'early_adopter')).toBe(false);
    });

    it('should return false for unknown badges', () => {
      const config = theme.getBadgeConfig();
      expect(evaluator.isBadgeRevocable(config, 'unknown')).toBe(false);
    });
  });

  describe('getBadgesByCategory', () => {
    it('should return badges in tenure category', () => {
      const config = theme.getBadgeConfig();
      const tenure = evaluator.getBadgesByCategory(config, 'tenure');

      expect(tenure.length).toBeGreaterThan(0);
      expect(tenure.every((b) => b.category === 'tenure')).toBe(true);
    });

    it('should return empty for unknown category', () => {
      const config = theme.getBadgeConfig();
      const unknown = evaluator.getBadgesByCategory(config, 'unknown');
      expect(unknown).toHaveLength(0);
    });
  });

  describe('getBadgeById', () => {
    it('should return badge definition', () => {
      const config = theme.getBadgeConfig();
      const badge = evaluator.getBadgeById(config, 'early_adopter');

      expect(badge).toBeDefined();
      expect(badge?.displayName).toBe('Early Adopter');
      expect(badge?.emoji).toBe('🌟');
    });

    it('should return undefined for unknown badge', () => {
      const config = theme.getBadgeConfig();
      expect(evaluator.getBadgeById(config, 'unknown')).toBeUndefined();
    });
  });

  describe('factory functions', () => {
    it('createBadgeEvaluator should return BadgeEvaluator instance', () => {
      const instance = createBadgeEvaluator();
      expect(instance).toBeInstanceOf(BadgeEvaluator);
    });

    it('badgeEvaluator singleton should be BadgeEvaluator instance', () => {
      expect(badgeEvaluator).toBeInstanceOf(BadgeEvaluator);
    });
  });
});
