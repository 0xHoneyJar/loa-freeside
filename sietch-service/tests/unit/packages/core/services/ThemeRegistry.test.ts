/**
 * ThemeRegistry Unit Tests
 *
 * Sprint 36: Theme Interface & BasicTheme
 *
 * Tests for the ThemeRegistry service including subscription tier validation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThemeRegistry,
  createThemeRegistry,
  themeRegistry,
} from '../../../../../src/packages/core/services/ThemeRegistry.js';
import { BasicTheme } from '../../../../../src/packages/adapters/themes/BasicTheme.js';
import { SietchTheme } from '../../../../../src/packages/adapters/themes/SietchTheme.js';
import type { IThemeProvider, SubscriptionTier } from '../../../../../src/packages/core/ports/IThemeProvider.js';

// Mock premium theme for testing
const mockPremiumTheme: IThemeProvider = {
  themeId: 'premium-test',
  themeName: 'Premium Test',
  tier: 'premium',
  getTierConfig: () => ({ tiers: [], rankingStrategy: 'absolute' }),
  getBadgeConfig: () => ({ categories: [], badges: [] }),
  getNamingConfig: () => ({
    serverNameTemplate: '{community}',
    categoryNames: { info: '', council: '', general: '', operations: '' },
    terminology: { member: '', holder: '', admin: '' },
  }),
  getChannelTemplate: () => ({ categories: [] }),
  evaluateTier: () => ({ tierId: 'test', tierName: 'Test', roleColor: '#000000' }),
  evaluateBadges: () => [],
};

// Mock enterprise theme for testing
const mockEnterpriseTheme: IThemeProvider = {
  ...mockPremiumTheme,
  themeId: 'enterprise-test',
  themeName: 'Enterprise Test',
  tier: 'enterprise',
};

describe('ThemeRegistry', () => {
  let registry: ThemeRegistry;
  let basicTheme: BasicTheme;

  beforeEach(() => {
    registry = new ThemeRegistry();
    basicTheme = new BasicTheme();
  });

  describe('register', () => {
    it('should register a theme', () => {
      registry.register(basicTheme);
      expect(registry.has('basic')).toBe(true);
    });

    it('should throw if theme already registered', () => {
      registry.register(basicTheme);
      expect(() => registry.register(basicTheme)).toThrow("Theme 'basic' is already registered");
    });
  });

  describe('registerAll', () => {
    it('should register multiple themes', () => {
      registry.registerAll([basicTheme, mockPremiumTheme]);
      expect(registry.size).toBe(2);
      expect(registry.has('basic')).toBe(true);
      expect(registry.has('premium-test')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister a theme', () => {
      registry.register(basicTheme);
      const removed = registry.unregister('basic');
      expect(removed).toBe(true);
      expect(registry.has('basic')).toBe(false);
    });

    it('should return false for non-existent theme', () => {
      const removed = registry.unregister('unknown');
      expect(removed).toBe(false);
    });
  });

  describe('get', () => {
    it('should return theme by ID', () => {
      registry.register(basicTheme);
      const theme = registry.get('basic');
      expect(theme).toBe(basicTheme);
    });

    it('should return undefined for unknown theme', () => {
      expect(registry.get('unknown')).toBeUndefined();
    });
  });

  describe('getOrThrow', () => {
    it('should return theme by ID', () => {
      registry.register(basicTheme);
      const theme = registry.getOrThrow('basic');
      expect(theme).toBe(basicTheme);
    });

    it('should throw for unknown theme', () => {
      expect(() => registry.getOrThrow('unknown')).toThrow("Theme 'unknown' not found");
    });
  });

  describe('getThemeIds', () => {
    it('should return all theme IDs', () => {
      registry.registerAll([basicTheme, mockPremiumTheme]);
      const ids = registry.getThemeIds();
      expect(ids).toContain('basic');
      expect(ids).toContain('premium-test');
    });

    it('should return empty array when no themes', () => {
      expect(registry.getThemeIds()).toHaveLength(0);
    });
  });

  describe('getAllThemes', () => {
    it('should return all themes', () => {
      registry.registerAll([basicTheme, mockPremiumTheme]);
      const themes = registry.getAllThemes();
      expect(themes).toHaveLength(2);
    });
  });

  describe('getAvailableThemes', () => {
    beforeEach(() => {
      registry.registerAll([basicTheme, mockPremiumTheme, mockEnterpriseTheme]);
    });

    it('should return only free themes for free tier', () => {
      const available = registry.getAvailableThemes('free');
      expect(available).toHaveLength(1);
      expect(available[0].themeId).toBe('basic');
    });

    it('should return free and premium themes for premium tier', () => {
      const available = registry.getAvailableThemes('premium');
      expect(available).toHaveLength(2);
      const ids = available.map((t) => t.themeId);
      expect(ids).toContain('basic');
      expect(ids).toContain('premium-test');
      expect(ids).not.toContain('enterprise-test');
    });

    it('should return all themes for enterprise tier', () => {
      const available = registry.getAvailableThemes('enterprise');
      expect(available).toHaveLength(3);
    });
  });

  describe('validateAccess', () => {
    beforeEach(() => {
      registry.registerAll([basicTheme, mockPremiumTheme, mockEnterpriseTheme]);
    });

    it('should allow free tier to access free theme', () => {
      const result = registry.validateAccess('basic', 'free');
      expect(result.allowed).toBe(true);
    });

    it('should deny free tier access to premium theme', () => {
      const result = registry.validateAccess('premium-test', 'free');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('requires premium subscription');
      expect(result.requiredTier).toBe('premium');
    });

    it('should deny free tier access to enterprise theme', () => {
      const result = registry.validateAccess('enterprise-test', 'free');
      expect(result.allowed).toBe(false);
      expect(result.requiredTier).toBe('enterprise');
    });

    it('should allow premium tier to access premium theme', () => {
      const result = registry.validateAccess('premium-test', 'premium');
      expect(result.allowed).toBe(true);
    });

    it('should allow enterprise tier to access all themes', () => {
      expect(registry.validateAccess('basic', 'enterprise').allowed).toBe(true);
      expect(registry.validateAccess('premium-test', 'enterprise').allowed).toBe(true);
      expect(registry.validateAccess('enterprise-test', 'enterprise').allowed).toBe(true);
    });

    it('should deny access to non-existent theme', () => {
      const result = registry.validateAccess('unknown', 'enterprise');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('getWithValidation', () => {
    beforeEach(() => {
      registry.registerAll([basicTheme, mockPremiumTheme]);
    });

    it('should return theme when access is allowed', () => {
      const theme = registry.getWithValidation('basic', 'free');
      expect(theme).toBe(basicTheme);
    });

    it('should throw when access is denied', () => {
      expect(() => registry.getWithValidation('premium-test', 'free')).toThrow(
        /requires premium subscription/
      );
    });

    it('should throw for non-existent theme', () => {
      expect(() => registry.getWithValidation('unknown', 'enterprise')).toThrow(/not found/);
    });
  });

  describe('compareTiers', () => {
    it('should return 0 for same tiers', () => {
      expect(registry.compareTiers('free', 'free')).toBe(0);
      expect(registry.compareTiers('premium', 'premium')).toBe(0);
    });

    it('should return -1 for lower tier', () => {
      expect(registry.compareTiers('free', 'premium')).toBe(-1);
      expect(registry.compareTiers('premium', 'enterprise')).toBe(-1);
    });

    it('should return 1 for higher tier', () => {
      expect(registry.compareTiers('premium', 'free')).toBe(1);
      expect(registry.compareTiers('enterprise', 'premium')).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all themes', () => {
      registry.registerAll([basicTheme, mockPremiumTheme]);
      registry.clear();
      expect(registry.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return number of registered themes', () => {
      expect(registry.size).toBe(0);
      registry.register(basicTheme);
      expect(registry.size).toBe(1);
      registry.register(mockPremiumTheme);
      expect(registry.size).toBe(2);
    });
  });

  describe('factory functions', () => {
    it('createThemeRegistry should return ThemeRegistry instance', () => {
      const instance = createThemeRegistry();
      expect(instance).toBeInstanceOf(ThemeRegistry);
    });

    it('themeRegistry singleton should be ThemeRegistry instance', () => {
      expect(themeRegistry).toBeInstanceOf(ThemeRegistry);
    });
  });

  // =========================================================================
  // Sprint 37: SietchTheme Integration Tests
  // =========================================================================

  describe('SietchTheme integration', () => {
    let sietchTheme: SietchTheme;

    beforeEach(() => {
      sietchTheme = new SietchTheme();
    });

    it('should register SietchTheme', () => {
      registry.register(sietchTheme);
      expect(registry.has('sietch')).toBe(true);
    });

    it('should identify SietchTheme as premium tier', () => {
      registry.register(sietchTheme);
      const theme = registry.get('sietch');
      expect(theme?.tier).toBe('premium');
    });

    it('should deny free tier access to SietchTheme', () => {
      registry.register(sietchTheme);
      const result = registry.validateAccess('sietch', 'free');
      expect(result.allowed).toBe(false);
      expect(result.requiredTier).toBe('premium');
    });

    it('should allow premium tier access to SietchTheme', () => {
      registry.register(sietchTheme);
      const result = registry.validateAccess('sietch', 'premium');
      expect(result.allowed).toBe(true);
    });

    it('should allow enterprise tier access to SietchTheme', () => {
      registry.register(sietchTheme);
      const result = registry.validateAccess('sietch', 'enterprise');
      expect(result.allowed).toBe(true);
    });

    it('should return SietchTheme in available themes for premium', () => {
      registry.register(basicTheme);
      registry.register(sietchTheme);
      const available = registry.getAvailableThemes('premium');
      const themeIds = available.map((t) => t.themeId);
      expect(themeIds).toContain('sietch');
      expect(themeIds).toContain('basic');
    });

    it('should not return SietchTheme in available themes for free tier', () => {
      registry.register(basicTheme);
      registry.register(sietchTheme);
      const available = registry.getAvailableThemes('free');
      const themeIds = available.map((t) => t.themeId);
      expect(themeIds).toContain('basic');
      expect(themeIds).not.toContain('sietch');
    });

    it('should work with getWithValidation for premium tier', () => {
      registry.register(sietchTheme);
      const theme = registry.getWithValidation('sietch', 'premium');
      expect(theme).toBe(sietchTheme);
    });

    it('should throw with getWithValidation for free tier', () => {
      registry.register(sietchTheme);
      expect(() => registry.getWithValidation('sietch', 'free')).toThrow(
        /requires premium subscription/
      );
    });

    it('should register both BasicTheme and SietchTheme', () => {
      registry.registerAll([basicTheme, sietchTheme]);
      expect(registry.size).toBe(2);
      expect(registry.get('basic')?.tier).toBe('free');
      expect(registry.get('sietch')?.tier).toBe('premium');
    });
  });
});
