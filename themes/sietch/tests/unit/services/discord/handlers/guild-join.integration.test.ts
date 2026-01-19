/**
 * Guild Join Integration Test
 *
 * Sprint 102: Foundation - Sandworm Sense
 *
 * Tests mode selection boundaries and explanation generation.
 * Uses ModeSelector directly since handler integration depends on
 * external storage adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ModeSelector,
  createModeSelector,
  MODE_THRESHOLDS,
} from '../../../../../src/services/discord/handlers/ModeSelector.js';

// Mock the logger module
vi.mock('../../../../../src/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    child: vi.fn().mockReturnThis(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// =============================================================================
// Integration Tests
// =============================================================================

describe('Guild Join Integration', () => {
  describe('Mode Selection Boundaries', () => {
    const testCases = [
      // Shadow mode cases - high confidence + sufficient members
      { provider: 'collabland', confidence: 0.7, members: 10, expected: 'shadow', desc: 'at exact shadow threshold' },
      { provider: 'matrica', confidence: 0.95, members: 1000, expected: 'shadow', desc: 'high confidence large server' },
      { provider: 'guild.xyz', confidence: 0.8, members: 50, expected: 'shadow', desc: 'medium-high confidence' },

      // Greenfield cases - no provider or very low confidence
      { provider: null, confidence: 0, members: 100, expected: 'greenfield', desc: 'no provider detected' },
      { provider: 'collabland', confidence: 0.39, members: 500, expected: 'greenfield', desc: 'below greenfield threshold' },
      { provider: null, confidence: 0.1, members: 50, expected: 'greenfield', desc: 'low confidence no provider' },

      // Hybrid cases - moderate confidence or small server
      { provider: 'collabland', confidence: 0.5, members: 100, expected: 'hybrid', desc: 'moderate confidence' },
      { provider: 'matrica', confidence: 0.69, members: 200, expected: 'hybrid', desc: 'just below shadow threshold' },
      { provider: 'collabland', confidence: 0.95, members: 5, expected: 'hybrid', desc: 'high confidence but small server' },
      { provider: 'guild.xyz', confidence: 0.4, members: 100, expected: 'hybrid', desc: 'at greenfield upper boundary' },
    ];

    it.each(testCases)(
      'should select $expected mode: $desc',
      ({ provider, confidence, members, expected }) => {
        const selector = createModeSelector();
        const result = selector.select({
          provider,
          confidence,
          memberCount: members,
        });

        expect(result.mode).toBe(expected);
      }
    );
  });

  describe('Admin Confirmation Requirements', () => {
    it('should NOT require admin confirmation for shadow mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'collabland',
        confidence: 0.9,
        memberCount: 100,
      });

      expect(result.mode).toBe('shadow');
      expect(result.requiresAdminConfirmation).toBe(false);
    });

    it('should NOT require admin confirmation for greenfield mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: null,
        confidence: 0,
        memberCount: 100,
      });

      expect(result.mode).toBe('greenfield');
      expect(result.requiresAdminConfirmation).toBe(false);
    });

    it('should REQUIRE admin confirmation for hybrid mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'matrica',
        confidence: 0.5,
        memberCount: 100,
      });

      expect(result.mode).toBe('hybrid');
      expect(result.requiresAdminConfirmation).toBe(true);
    });
  });

  describe('Confidence Score Handling', () => {
    it('should preserve confidence for shadow mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'collabland',
        confidence: 0.85,
        memberCount: 100,
      });

      expect(result.confidence).toBe(0.85);
    });

    it('should invert confidence for greenfield mode (high confidence in "no incumbent")', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: null,
        confidence: 0.1,
        memberCount: 100,
      });

      // 1 - 0.1 = 0.9 (high confidence that it's greenfield)
      expect(result.confidence).toBe(0.9);
    });

    it('should use default confidence for hybrid mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'other',
        confidence: 0.55,
        memberCount: 100,
      });

      expect(result.confidence).toBe(MODE_THRESHOLDS.HYBRID_DEFAULT_CONFIDENCE);
    });

    it('should clamp confidence to 0-1 range', () => {
      const selector = createModeSelector();

      // Test with invalid high value
      const result1 = selector.select({
        provider: null,
        confidence: 1.5,
        memberCount: 100,
      });
      expect(result1.confidence).toBeLessThanOrEqual(1);

      // Test with invalid negative value
      const result2 = selector.select({
        provider: null,
        confidence: -0.5,
        memberCount: 100,
      });
      expect(result2.confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Explanation Generation', () => {
    it('should generate human-readable explanation for shadow mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'collabland',
        confidence: 0.9,
        memberCount: 100,
      });

      const explanation = selector.explainSelection(result);

      expect(explanation).toContain('👁️ Shadow Mode');
      expect(explanation).toContain('Collab.Land');
      expect(explanation).toContain('90%');
      expect(explanation).not.toContain('Admin confirmation recommended');
    });

    it('should include admin warning for hybrid mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'matrica',
        confidence: 0.5,
        memberCount: 100,
      });

      const explanation = selector.explainSelection(result);

      expect(explanation).toContain('🔄 Hybrid Mode');
      expect(explanation).toContain('Admin confirmation recommended');
    });

    it('should explain greenfield with onboard instructions', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: null,
        confidence: 0,
        memberCount: 100,
      });

      const explanation = selector.explainSelection(result);

      expect(explanation).toContain('🌱 Greenfield Mode');
      expect(result.explanation).toContain('/arrakis onboard');
    });

    it('should explain small server hybrid mode', () => {
      const selector = createModeSelector();
      const result = selector.select({
        provider: 'collabland',
        confidence: 0.95,
        memberCount: 5,
      });

      expect(result.mode).toBe('hybrid');
      expect(result.explanation).toContain('5 members');
      expect(result.explanation).toContain('Small servers');
    });
  });

  describe('Provider Name Formatting', () => {
    const providerTests = [
      { slug: 'collabland', display: 'Collab.Land' },
      { slug: 'matrica', display: 'Matrica' },
      { slug: 'guild.xyz', display: 'Guild.xyz' },
      { slug: 'other', display: 'Unknown Provider' },
      { slug: 'custom_bot', display: 'custom_bot' }, // Unknown passed through
    ];

    it.each(providerTests)(
      'should format $slug as $display',
      ({ slug, display }) => {
        const selector = createModeSelector();
        const result = selector.select({
          provider: slug,
          confidence: 0.9,
          memberCount: 100,
        });

        expect(result.explanation).toContain(display);
      }
    );
  });

  describe('Performance Requirements', () => {
    it('should complete mode selection in under 10ms', () => {
      const selector = createModeSelector();

      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        selector.select({
          provider: 'collabland',
          confidence: Math.random(),
          memberCount: Math.floor(Math.random() * 1000),
        });
      }
      const duration = performance.now() - start;

      // 100 selections should complete in under 100ms (1ms each avg)
      expect(duration).toBeLessThan(100);
    });
  });
});
