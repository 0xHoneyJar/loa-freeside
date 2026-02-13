/**
 * Token Estimator — Calibration Harness
 * Cycle 019 Sprint 3, Task 3.4: BB6 Finding #7
 *
 * Extracts and improves the rough token estimation from AgentGateway.
 * Provides configurable chars-per-token with model-specific overrides,
 * plus a calibration harness that tracks estimate vs actual accuracy.
 *
 * @see SDD §4.1 Agent Gateway Facade
 * @see Bridgebuilder Round 6, Finding #7 — Token Estimator Calibration
 */

import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface TokenEstimatorConfig {
  /** Default characters per token (default: 4) */
  defaultCharsPerToken?: number;
  /** Per-model overrides for chars per token */
  modelOverrides?: Record<string, number>;
  /** Circular buffer size for calibration samples (default: 1000) */
  calibrationBufferSize?: number;
  /** Log calibration stats every N recordings (default: 100) */
  calibrationLogInterval?: number;
  /** Emit metric when estimate error exceeds this threshold (default: 0.5 = 50%) */
  driftThreshold?: number;
}

export interface CalibrationStats {
  /** Mean absolute percentage error */
  meanError: number;
  /** 95th percentile absolute percentage error */
  p95Error: number;
  /** Number of samples in the buffer */
  sampleCount: number;
}

interface CalibrationSample {
  estimated: number;
  actual: number;
  modelAlias: string;
  error: number; // absolute percentage error
}

// --------------------------------------------------------------------------
// Default Model Overrides
// --------------------------------------------------------------------------

/** Well-known model families and their typical chars-per-token ratios */
const DEFAULT_MODEL_OVERRIDES: Record<string, number> = {
  // Claude models tend to tokenize slightly more efficiently (~3.5 chars/token)
  'claude-3-opus': 3.5,
  'claude-3-sonnet': 3.5,
  'claude-3-haiku': 3.5,
  'claude-3.5-sonnet': 3.5,
  'claude-3.5-haiku': 3.5,
  // GPT models at roughly ~4 chars/token (matches default)
};

// --------------------------------------------------------------------------
// TokenEstimator
// --------------------------------------------------------------------------

export class TokenEstimator {
  private readonly defaultCharsPerToken: number;
  private readonly modelOverrides: Record<string, number>;
  private readonly buffer: CalibrationSample[];
  private readonly bufferSize: number;
  private readonly logInterval: number;
  private readonly driftThreshold: number;
  private readonly log?: Logger;
  private bufferIndex = 0;
  private totalRecordings = 0;

  constructor(logger?: Logger, config?: TokenEstimatorConfig) {
    this.log = logger?.child({ component: 'TokenEstimator' });
    this.defaultCharsPerToken = config?.defaultCharsPerToken ?? 4;
    this.modelOverrides = {
      ...DEFAULT_MODEL_OVERRIDES,
      ...config?.modelOverrides,
    };
    this.bufferSize = config?.calibrationBufferSize ?? 1000;
    this.logInterval = config?.calibrationLogInterval ?? 100;
    this.driftThreshold = config?.driftThreshold ?? 0.5;
    this.buffer = [];
  }

  /**
   * Estimate input tokens from message content.
   * Uses model-specific chars-per-token when available (AC-3.20).
   */
  estimate(
    messages: ReadonlyArray<{ content: string }>,
    options?: { modelAlias?: string },
  ): number {
    const charsPerToken = this.getCharsPerToken(options?.modelAlias);
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / charsPerToken);
  }

  /**
   * Record actual token count for calibration (AC-3.21).
   * Stores estimate/actual pair in a circular buffer.
   * Emits drift metric when error exceeds threshold (AC-3.22).
   */
  recordActual(estimated: number, actual: number, modelAlias: string): void {
    if (actual <= 0 || estimated <= 0) return;

    const error = Math.abs(estimated - actual) / actual;

    const sample: CalibrationSample = { estimated, actual, modelAlias, error };

    // Circular buffer insertion
    if (this.buffer.length < this.bufferSize) {
      this.buffer.push(sample);
    } else {
      this.buffer[this.bufferIndex % this.bufferSize] = sample;
    }
    this.bufferIndex++;
    this.totalRecordings++;

    // Drift detection (AC-3.22)
    if (error > this.driftThreshold) {
      this.log?.warn(
        {
          estimated,
          actual,
          modelAlias,
          errorPct: Math.round(error * 100),
        },
        'token_estimate_drift',
      );
    }

    // Periodic calibration logging
    if (this.totalRecordings % this.logInterval === 0) {
      const stats = this.getCalibrationStats();
      this.log?.info(
        {
          ...stats,
          meanErrorPct: Math.round(stats.meanError * 100),
          p95ErrorPct: Math.round(stats.p95Error * 100),
          totalRecordings: this.totalRecordings,
        },
        'token_estimator_calibration',
      );
    }
  }

  /**
   * Compute calibration statistics from buffered samples (AC-3.21).
   */
  getCalibrationStats(): CalibrationStats {
    if (this.buffer.length === 0) {
      return { meanError: 0, p95Error: 0, sampleCount: 0 };
    }

    const errors = this.buffer.map((s) => s.error);
    const sorted = [...errors].sort((a, b) => a - b);

    const mean = errors.reduce((sum, e) => sum + e, 0) / errors.length;
    const p95Index = Math.min(
      Math.ceil(sorted.length * 0.95) - 1,
      sorted.length - 1,
    );

    return {
      meanError: mean,
      p95Error: sorted[p95Index] ?? 0,
      sampleCount: this.buffer.length,
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private getCharsPerToken(modelAlias?: string): number {
    if (!modelAlias) return this.defaultCharsPerToken;

    // Exact match first
    if (this.modelOverrides[modelAlias] !== undefined) {
      return this.modelOverrides[modelAlias];
    }

    // Prefix match (e.g., 'claude-3.5-sonnet-20240620' matches 'claude-3.5-sonnet')
    for (const [prefix, cpt] of Object.entries(this.modelOverrides)) {
      if (modelAlias.startsWith(prefix)) return cpt;
    }

    return this.defaultCharsPerToken;
  }
}
