/**
 * ModeSelector - Intelligent Onboarding Mode Selection
 *
 * Sprint 102: Foundation - Sandworm Sense
 *
 * Determines the appropriate onboarding mode based on incumbent detection:
 * - SHADOW: Incumbent detected with high confidence (>= 0.7) and sufficient members (>= 10)
 * - GREENFIELD: No incumbent detected or very low confidence (< 0.4)
 * - HYBRID: Uncertain detection (0.4-0.7) requiring admin confirmation
 *
 * @see PRD FR-1 through FR-3
 * @see SDD §2.1 Component Design
 */

import { createLogger, type ILogger } from '../../../packages/infrastructure/logging/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Onboarding mode determined by ModeSelector
 */
export type OnboardingMode = 'shadow' | 'greenfield' | 'hybrid';

/**
 * Evidence from incumbent detection
 */
export interface DetectionEvidence {
  /** Detected provider type */
  provider: string | null;
  /** Detection confidence (0-1) */
  confidence: number;
  /** Number of members in guild */
  memberCount: number;
  /** Bot ID if detected */
  botId?: string;
  /** Detection method used */
  detectionMethod?: string;
}

/**
 * Mode selection result
 */
export interface ModeSelectionResult {
  /** Selected mode */
  mode: OnboardingMode;
  /** Confidence in selection (0-1) */
  confidence: number;
  /** Human-readable explanation */
  explanation: string;
  /** Whether admin confirmation is recommended */
  requiresAdminConfirmation: boolean;
  /** Original detection evidence */
  evidence: DetectionEvidence;
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Thresholds for mode selection
 */
export const MODE_THRESHOLDS = {
  /** Minimum confidence for shadow mode activation */
  SHADOW_MIN_CONFIDENCE: 0.7,
  /** Minimum member count for shadow mode (small servers default to hybrid) */
  SHADOW_MIN_MEMBERS: 10,
  /** Confidence below which we default to greenfield */
  GREENFIELD_MAX_CONFIDENCE: 0.4,
  /** Default confidence for hybrid mode selections */
  HYBRID_DEFAULT_CONFIDENCE: 0.5,
} as const;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Selects the appropriate onboarding mode based on detection evidence.
 *
 * Decision logic:
 * 1. confidence >= 0.7 AND memberCount >= 10 → SHADOW
 * 2. confidence < 0.4 OR no provider detected → GREENFIELD
 * 3. 0.4 <= confidence < 0.7 → HYBRID (admin confirmation needed)
 * 4. Small servers (< 10 members) with incumbent → HYBRID
 */
export class ModeSelector {
  private readonly log: ILogger;

  constructor(logger?: ILogger) {
    this.log = logger ?? createLogger({ service: 'ModeSelector' });
  }

  /**
   * Select the appropriate onboarding mode based on detection evidence.
   *
   * @param evidence - Detection evidence from IncumbentDetector
   * @returns Mode selection result with explanation
   */
  select(evidence: DetectionEvidence): ModeSelectionResult {
    const { provider, confidence, memberCount } = evidence;

    this.log.debug(
      { provider, confidence, memberCount },
      'Evaluating mode selection'
    );

    // Case 1: No provider detected or very low confidence → Greenfield
    if (!provider || confidence < MODE_THRESHOLDS.GREENFIELD_MAX_CONFIDENCE) {
      return this.createResult('greenfield', evidence, {
        confidence: 1 - (confidence || 0), // High confidence in greenfield when low detection
        explanation: this.explainGreenfield(evidence),
        requiresAdminConfirmation: false,
      });
    }

    // Case 2: High confidence detection with sufficient members → Shadow
    if (
      confidence >= MODE_THRESHOLDS.SHADOW_MIN_CONFIDENCE &&
      memberCount >= MODE_THRESHOLDS.SHADOW_MIN_MEMBERS
    ) {
      return this.createResult('shadow', evidence, {
        confidence,
        explanation: this.explainShadow(evidence),
        requiresAdminConfirmation: false,
      });
    }

    // Case 3: Small server with incumbent → Hybrid (need admin input)
    if (memberCount < MODE_THRESHOLDS.SHADOW_MIN_MEMBERS && provider) {
      return this.createResult('hybrid', evidence, {
        confidence: MODE_THRESHOLDS.HYBRID_DEFAULT_CONFIDENCE,
        explanation: this.explainHybridSmallServer(evidence),
        requiresAdminConfirmation: true,
      });
    }

    // Case 4: Moderate confidence → Hybrid (uncertain, need admin input)
    return this.createResult('hybrid', evidence, {
      confidence: MODE_THRESHOLDS.HYBRID_DEFAULT_CONFIDENCE,
      explanation: this.explainHybridUncertain(evidence),
      requiresAdminConfirmation: true,
    });
  }

  /**
   * Get a human-readable explanation of a mode selection.
   *
   * @param result - Mode selection result
   * @returns Formatted explanation string
   */
  explainSelection(result: ModeSelectionResult): string {
    const modeLabels: Record<OnboardingMode, string> = {
      shadow: '👁️ Shadow Mode',
      greenfield: '🌱 Greenfield Mode',
      hybrid: '🔄 Hybrid Mode',
    };

    const confidenceLabel =
      result.confidence >= 0.8
        ? 'High'
        : result.confidence >= 0.5
          ? 'Medium'
          : 'Low';

    let explanation = `**${modeLabels[result.mode]}** (${confidenceLabel} confidence: ${(result.confidence * 100).toFixed(0)}%)\n\n`;
    explanation += result.explanation;

    if (result.requiresAdminConfirmation) {
      explanation +=
        '\n\n⚠️ **Admin confirmation recommended** before proceeding.';
    }

    return explanation;
  }

  // ===========================================================================
  // Private Explanation Generators
  // ===========================================================================

  private createResult(
    mode: OnboardingMode,
    evidence: DetectionEvidence,
    options: {
      confidence: number;
      explanation: string;
      requiresAdminConfirmation: boolean;
    }
  ): ModeSelectionResult {
    const result: ModeSelectionResult = {
      mode,
      confidence: Math.min(Math.max(options.confidence, 0), 1), // Clamp 0-1
      explanation: options.explanation,
      requiresAdminConfirmation: options.requiresAdminConfirmation,
      evidence,
    };

    this.log.info(
      {
        mode: result.mode,
        confidence: result.confidence.toFixed(3),
        provider: evidence.provider,
        memberCount: evidence.memberCount,
      },
      'Mode selected'
    );

    return result;
  }

  private explainGreenfield(evidence: DetectionEvidence): string {
    if (!evidence.provider) {
      return (
        'No existing token-gating bot detected in this server. ' +
        'Arrakis will start with full features enabled immediately. ' +
        'Run `/arrakis onboard` to complete setup.'
      );
    }

    return (
      `Detection confidence for ${evidence.provider} is too low (${(evidence.confidence * 100).toFixed(0)}%). ` +
      'Treating this as a new server without incumbent. ' +
      'If a token-gating bot exists, run `/arrakis detect` to re-analyze.'
    );
  }

  private explainShadow(evidence: DetectionEvidence): string {
    const providerName = this.formatProviderName(evidence.provider!);

    return (
      `Detected **${providerName}** with ${(evidence.confidence * 100).toFixed(0)}% confidence. ` +
      'Arrakis will operate in observation mode, tracking verification decisions ' +
      'without affecting members. After 14+ days with 95%+ accuracy, ' +
      'migration prompts will begin appearing.'
    );
  }

  private explainHybridSmallServer(evidence: DetectionEvidence): string {
    const providerName = this.formatProviderName(evidence.provider!);

    return (
      `Detected **${providerName}** but server has only ${evidence.memberCount} members. ` +
      'Small servers may have different patterns than typical token-gated communities. ' +
      'Please confirm whether this server uses token-gating before proceeding.'
    );
  }

  private explainHybridUncertain(evidence: DetectionEvidence): string {
    const providerName = this.formatProviderName(evidence.provider!);

    return (
      `Detected possible **${providerName}** presence with ${(evidence.confidence * 100).toFixed(0)}% confidence, ` +
      'which is below our threshold for automatic shadow mode activation. ' +
      'Please confirm whether this server uses token-gating.'
    );
  }

  private formatProviderName(provider: string): string {
    const names: Record<string, string> = {
      collabland: 'Collab.Land',
      matrica: 'Matrica',
      'guild.xyz': 'Guild.xyz',
      other: 'Unknown Provider',
    };
    return names[provider] ?? provider;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ModeSelector instance.
 */
export function createModeSelector(logger?: ILogger): ModeSelector {
  return new ModeSelector(logger);
}

/**
 * Standalone helper to select mode without instantiating class.
 */
export function selectOnboardingMode(
  evidence: DetectionEvidence
): ModeSelectionResult {
  return new ModeSelector().select(evidence);
}
