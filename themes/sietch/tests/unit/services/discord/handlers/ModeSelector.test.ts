/**
 * ModeSelector Unit Tests
 *
 * Sprint 102: Foundation - Sandworm Sense
 *
 * Tests the mode selection logic for intelligent onboarding:
 * - Shadow mode: High confidence + sufficient members
 * - Greenfield: No incumbent or very low confidence
 * - Hybrid: Uncertain detection requiring admin confirmation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ModeSelector,
  createModeSelector,
  selectOnboardingMode,
  MODE_THRESHOLDS,
  type DetectionEvidence,
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

describe('ModeSelector', () => {
  let modeSelector: ModeSelector;

  beforeEach(() => {
    modeSelector = createModeSelector();
  });

  describe('Shadow Mode Selection', () => {
    it('should select shadow mode with high confidence and sufficient members', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.95,
        memberCount: 500,
        botId: '704521096837464076',
        detectionMethod: 'bot_id',
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('shadow');
      expect(result.confidence).toBe(0.95);
      expect(result.requiresAdminConfirmation).toBe(false);
      expect(result.evidence).toEqual(evidence);
    });

    it('should select shadow mode at exact threshold (0.7 confidence, 10 members)', () => {
      const evidence: DetectionEvidence = {
        provider: 'matrica',
        confidence: MODE_THRESHOLDS.SHADOW_MIN_CONFIDENCE, // 0.7
        memberCount: MODE_THRESHOLDS.SHADOW_MIN_MEMBERS, // 10
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('shadow');
      expect(result.requiresAdminConfirmation).toBe(false);
    });

    it('should include proper explanation for shadow mode', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.85,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.explanation).toContain('Collab.Land');
      expect(result.explanation).toContain('85%');
      expect(result.explanation).toContain('observation mode');
    });
  });

  describe('Greenfield Mode Selection', () => {
    it('should select greenfield mode when no provider detected', () => {
      const evidence: DetectionEvidence = {
        provider: null,
        confidence: 0,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('greenfield');
      expect(result.confidence).toBe(1); // High confidence in greenfield when no detection
      expect(result.requiresAdminConfirmation).toBe(false);
    });

    it('should select greenfield mode with very low confidence (< 0.4)', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.35, // Below GREENFIELD_MAX_CONFIDENCE
        memberCount: 500,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('greenfield');
      expect(result.requiresAdminConfirmation).toBe(false);
    });

    it('should select greenfield at threshold boundary (< 0.4)', () => {
      const evidence: DetectionEvidence = {
        provider: 'guild.xyz',
        confidence: MODE_THRESHOLDS.GREENFIELD_MAX_CONFIDENCE - 0.01, // 0.39
        memberCount: 200,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('greenfield');
    });

    it('should include proper explanation for greenfield mode', () => {
      const evidence: DetectionEvidence = {
        provider: null,
        confidence: 0,
        memberCount: 50,
      };

      const result = modeSelector.select(evidence);

      expect(result.explanation).toContain('No existing token-gating bot');
      expect(result.explanation).toContain('/arrakis onboard');
    });
  });

  describe('Hybrid Mode Selection', () => {
    it('should select hybrid mode for small server with incumbent', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.9, // High confidence
        memberCount: 5, // Below SHADOW_MIN_MEMBERS threshold
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('hybrid');
      expect(result.requiresAdminConfirmation).toBe(true);
      expect(result.explanation).toContain('5 members');
    });

    it('should select hybrid mode for moderate confidence (0.4-0.7)', () => {
      const evidence: DetectionEvidence = {
        provider: 'matrica',
        confidence: 0.55, // Between GREENFIELD_MAX and SHADOW_MIN
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('hybrid');
      expect(result.requiresAdminConfirmation).toBe(true);
      expect(result.explanation).toContain('55%');
      expect(result.explanation).toContain('below our threshold');
    });

    it('should select hybrid at exact boundary (0.4 confidence)', () => {
      const evidence: DetectionEvidence = {
        provider: 'guild.xyz',
        confidence: MODE_THRESHOLDS.GREENFIELD_MAX_CONFIDENCE, // 0.4
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('hybrid');
      expect(result.requiresAdminConfirmation).toBe(true);
    });

    it('should select hybrid just below shadow threshold', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: MODE_THRESHOLDS.SHADOW_MIN_CONFIDENCE - 0.01, // 0.69
        memberCount: 500,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('hybrid');
    });

    it('should have default confidence of 0.5 for hybrid mode', () => {
      const evidence: DetectionEvidence = {
        provider: 'other',
        confidence: 0.5,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('hybrid');
      expect(result.confidence).toBe(MODE_THRESHOLDS.HYBRID_DEFAULT_CONFIDENCE);
    });
  });

  describe('Edge Cases', () => {
    it('should clamp confidence to 0-1 range', () => {
      const evidence: DetectionEvidence = {
        provider: null,
        confidence: 1.5, // Invalid: > 1
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      // Since confidence > 0, it's treated as potential detection
      // But 1.5 normalized should still be clamped to 1
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should handle zero member count', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.95,
        memberCount: 0,
      };

      const result = modeSelector.select(evidence);

      // Zero members should trigger hybrid (small server path)
      expect(result.mode).toBe('hybrid');
      expect(result.requiresAdminConfirmation).toBe(true);
    });

    it('should handle negative confidence gracefully', () => {
      const evidence: DetectionEvidence = {
        provider: null,
        confidence: -0.5, // Invalid
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.mode).toBe('greenfield');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should preserve original evidence in result', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.85,
        memberCount: 200,
        botId: '704521096837464076',
        detectionMethod: 'bot_id',
      };

      const result = modeSelector.select(evidence);

      expect(result.evidence).toEqual(evidence);
    });
  });

  describe('Provider Name Formatting', () => {
    it('should format Collab.Land correctly', () => {
      const evidence: DetectionEvidence = {
        provider: 'collabland',
        confidence: 0.9,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.explanation).toContain('Collab.Land');
    });

    it('should format Guild.xyz correctly', () => {
      const evidence: DetectionEvidence = {
        provider: 'guild.xyz',
        confidence: 0.9,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.explanation).toContain('Guild.xyz');
    });

    it('should format Matrica correctly', () => {
      const evidence: DetectionEvidence = {
        provider: 'matrica',
        confidence: 0.9,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      expect(result.explanation).toContain('Matrica');
    });

    it('should handle unknown provider gracefully', () => {
      const evidence: DetectionEvidence = {
        provider: 'unknown_provider',
        confidence: 0.9,
        memberCount: 100,
      };

      const result = modeSelector.select(evidence);

      // Should use the provider name as-is if not in known list
      expect(result.explanation).toContain('unknown_provider');
    });
  });

  describe('explainSelection', () => {
    it('should format shadow mode explanation', () => {
      const result = modeSelector.select({
        provider: 'collabland',
        confidence: 0.9,
        memberCount: 100,
      });

      const explanation = modeSelector.explainSelection(result);

      expect(explanation).toContain('👁️ Shadow Mode');
      expect(explanation).toContain('High confidence');
      expect(explanation).toContain('90%');
    });

    it('should format greenfield mode explanation', () => {
      const result = modeSelector.select({
        provider: null,
        confidence: 0,
        memberCount: 100,
      });

      const explanation = modeSelector.explainSelection(result);

      expect(explanation).toContain('🌱 Greenfield Mode');
    });

    it('should format hybrid mode explanation with admin warning', () => {
      const result = modeSelector.select({
        provider: 'matrica',
        confidence: 0.5,
        memberCount: 100,
      });

      const explanation = modeSelector.explainSelection(result);

      expect(explanation).toContain('🔄 Hybrid Mode');
      expect(explanation).toContain('Admin confirmation recommended');
    });
  });

  describe('Factory Functions', () => {
    it('should create ModeSelector with createModeSelector', () => {
      const selector = createModeSelector();

      expect(selector).toBeInstanceOf(ModeSelector);
    });

    it('should provide standalone selectOnboardingMode helper', () => {
      const result = selectOnboardingMode({
        provider: 'collabland',
        confidence: 0.95,
        memberCount: 500,
      });

      expect(result.mode).toBe('shadow');
    });
  });
});
