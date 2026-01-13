/**
 * TierEvaluator Unit Tests
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Tests for the TierEvaluator service.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TierEvaluator,
  createTierEvaluator,
  tierEvaluator,
} from '../../../../../src/packages/core/services/TierEvaluator.js';
import { BasicTheme } from '../../../../../src/packages/adapters/themes/BasicTheme.js';
import type { TierConfig, TierDefinition } from '../../../../../src/packages/core/ports/IThemeProvider.js';

describe('TierEvaluator', () => {
  let evaluator: TierEvaluator;
  let theme: BasicTheme;

  beforeEach(() => {
    evaluator = new TierEvaluator();
    theme = new BasicTheme();
  });

  describe('evaluate', () => {
    it('should delegate to theme evaluateTier', () => {
      const result = evaluator.evaluate(theme, 5);
      expect(result.tierId).toBe('gold');
      expect(result.tierName).toBe('Gold');
    });

    it('should add rankInTier when option is set', () => {
      const result = evaluator.evaluate(theme, 15, undefined, {
        includeRankInTier: true,
      });
      expect(result.tierId).toBe('silver');
      expect(result.rankInTier).toBe(5); // 15 - 11 + 1
    });

    it('should evaluate all tier boundaries', () => {
      expect(evaluator.evaluate(theme, 1).tierId).toBe('gold');
      expect(evaluator.evaluate(theme, 10).tierId).toBe('gold');
      expect(evaluator.evaluate(theme, 11).tierId).toBe('silver');
      expect(evaluator.evaluate(theme, 50).tierId).toBe('silver');
      expect(evaluator.evaluate(theme, 51).tierId).toBe('bronze');
      expect(evaluator.evaluate(theme, 100).tierId).toBe('bronze');
    });

    it('should handle ranks beyond tier limits', () => {
      const result = evaluator.evaluate(theme, 150);
      expect(result.tierId).toBe('bronze');
    });
  });

  describe('evaluateBatch', () => {
    it('should evaluate multiple ranks', () => {
      const ranks = new Map([
        ['0x1111', 5],
        ['0x2222', 25],
        ['0x3333', 75],
      ]);

      const result = evaluator.evaluateBatch(theme, ranks);

      expect(result.results.get('0x1111')?.tierId).toBe('gold');
      expect(result.results.get('0x2222')?.tierId).toBe('silver');
      expect(result.results.get('0x3333')?.tierId).toBe('bronze');
      expect(result.themeId).toBe('basic');
    });

    it('should include evaluation timestamp', () => {
      const ranks = new Map([['0x1111', 5]]);
      const before = new Date();
      const result = evaluator.evaluateBatch(theme, ranks);
      const after = new Date();

      expect(result.evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.evaluatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('evaluateWithConfig', () => {
    it('should evaluate with absolute strategy', () => {
      const config: TierConfig = {
        tiers: [
          { id: 'top', name: 'top', displayName: 'Top', minRank: 1, maxRank: 5, roleColor: '#FF0000', permissions: [] },
          { id: 'mid', name: 'mid', displayName: 'Mid', minRank: 6, maxRank: 20, roleColor: '#00FF00', permissions: [] },
          { id: 'low', name: 'low', displayName: 'Low', minRank: 21, maxRank: null, roleColor: '#0000FF', permissions: [] },
        ],
        rankingStrategy: 'absolute',
      };

      expect(evaluator.evaluateWithConfig(config, 3).tierId).toBe('top');
      expect(evaluator.evaluateWithConfig(config, 10).tierId).toBe('mid');
      expect(evaluator.evaluateWithConfig(config, 50).tierId).toBe('low');
    });

    it('should evaluate with percentage strategy', () => {
      // For percentage, minRank/maxRank represent percentile thresholds
      const config: TierConfig = {
        tiers: [
          { id: 'elite', name: 'elite', displayName: 'Elite', minRank: 90, maxRank: null, roleColor: '#FF0000', permissions: [] },
          { id: 'standard', name: 'standard', displayName: 'Standard', minRank: 50, maxRank: 90, roleColor: '#00FF00', permissions: [] },
          { id: 'basic', name: 'basic', displayName: 'Basic', minRank: 0, maxRank: 50, roleColor: '#0000FF', permissions: [] },
        ],
        rankingStrategy: 'percentage',
      };

      // Rank 1 out of 100 = 100th percentile
      const result = evaluator.evaluateWithConfig(config, 1, 100);
      expect(result.tierId).toBe('elite');

      // Rank 50 out of 100 = 51st percentile
      const result2 = evaluator.evaluateWithConfig(config, 50, 100);
      expect(result2.tierId).toBe('standard');
    });

    it('should handle invalid rank < 1', () => {
      const config = theme.getTierConfig();
      const result = evaluator.evaluateWithConfig(config, 0);
      expect(result.tierId).toBe('gold'); // First tier
    });
  });

  describe('isDemotion', () => {
    it('should detect demotion from gold to silver', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isDemotion(config, 'gold', 'silver')).toBe(true);
    });

    it('should detect demotion from silver to bronze', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isDemotion(config, 'silver', 'bronze')).toBe(true);
    });

    it('should not detect demotion for same tier', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isDemotion(config, 'gold', 'gold')).toBe(false);
    });

    it('should not detect demotion for promotion', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isDemotion(config, 'bronze', 'gold')).toBe(false);
    });
  });

  describe('isPromotion', () => {
    it('should detect promotion from silver to gold', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isPromotion(config, 'silver', 'gold')).toBe(true);
    });

    it('should detect promotion from bronze to silver', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isPromotion(config, 'bronze', 'silver')).toBe(true);
    });

    it('should not detect promotion for same tier', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isPromotion(config, 'gold', 'gold')).toBe(false);
    });

    it('should not detect promotion for demotion', () => {
      const config = theme.getTierConfig();
      expect(evaluator.isPromotion(config, 'gold', 'bronze')).toBe(false);
    });
  });

  describe('getTierIndex', () => {
    it('should return correct index for gold', () => {
      const config = theme.getTierConfig();
      expect(evaluator.getTierIndex(config, 'gold')).toBe(0);
    });

    it('should return correct index for silver', () => {
      const config = theme.getTierConfig();
      expect(evaluator.getTierIndex(config, 'silver')).toBe(1);
    });

    it('should return correct index for bronze', () => {
      const config = theme.getTierConfig();
      expect(evaluator.getTierIndex(config, 'bronze')).toBe(2);
    });

    it('should return -1 for unknown tier', () => {
      const config = theme.getTierConfig();
      expect(evaluator.getTierIndex(config, 'unknown')).toBe(-1);
    });
  });

  describe('getTierById', () => {
    it('should return tier definition for gold', () => {
      const config = theme.getTierConfig();
      const tier = evaluator.getTierById(config, 'gold');
      expect(tier).toBeDefined();
      expect(tier?.displayName).toBe('Gold');
      expect(tier?.roleColor).toBe('#FFD700');
    });

    it('should return undefined for unknown tier', () => {
      const config = theme.getTierConfig();
      expect(evaluator.getTierById(config, 'unknown')).toBeUndefined();
    });
  });

  describe('factory functions', () => {
    it('createTierEvaluator should return TierEvaluator instance', () => {
      const instance = createTierEvaluator();
      expect(instance).toBeInstanceOf(TierEvaluator);
    });

    it('tierEvaluator singleton should be TierEvaluator instance', () => {
      expect(tierEvaluator).toBeInstanceOf(TierEvaluator);
    });
  });
});
