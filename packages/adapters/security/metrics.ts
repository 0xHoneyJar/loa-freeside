/**
 * Vault & Security Metrics
 *
 * Sprint S-22: Vault Integration & Kill Switch
 *
 * Prometheus metrics for monitoring:
 * - Vault operations (sign, verify, encrypt, decrypt)
 * - Token lifecycle (renewals, revocations)
 * - Key rotations
 * - Kill switch status
 *
 * @see SDD §6.4.2 (S-22.9)
 */

import { VAULT_METRICS_PREFIX } from '@freeside/core/ports';

// =============================================================================
// Types
// =============================================================================

/**
 * Counter metric interface.
 */
export interface CounterMetric {
  inc(labels?: Record<string, string>): void;
  inc(value: number, labels?: Record<string, string>): void;
}

/**
 * Gauge metric interface.
 */
export interface GaugeMetric {
  set(value: number, labels?: Record<string, string>): void;
  inc(labels?: Record<string, string>): void;
  dec(labels?: Record<string, string>): void;
}

/**
 * Histogram metric interface.
 */
export interface HistogramMetric {
  observe(value: number, labels?: Record<string, string>): void;
}

/**
 * Complete Vault metrics interface.
 */
export interface VaultMetrics {
  /** Counter: Vault operations by type and status */
  operations: CounterMetric;
  /** Histogram: Vault operation latency */
  latency: HistogramMetric;
  /** Counter: Token renewals */
  tokenRenewals: CounterMetric;
  /** Counter: Key rotations by key name */
  keyRotations: CounterMetric;
  /** Gauge: Kill switch active (0 or 1) */
  killSwitchActive: GaugeMetric;
  /** Counter: Kill switch activations */
  killSwitchActivations: CounterMetric;
  /** Counter: Kill switch deactivations */
  killSwitchDeactivations: CounterMetric;
  /** Counter: MFA verification attempts */
  mfaVerifications: CounterMetric;
  /** Counter: OAuth token encryptions */
  oauthEncryptions: CounterMetric;
  /** Counter: OAuth token decryptions */
  oauthDecryptions: CounterMetric;
  /** Counter: Wallet challenge creations */
  walletChallenges: CounterMetric;
}

// =============================================================================
// Metric Definitions
// =============================================================================

/**
 * Metric name definitions with descriptions.
 */
export const VAULT_METRIC_DEFINITIONS = {
  // Vault Operations
  operations: {
    name: `${VAULT_METRICS_PREFIX}operations_total`,
    help: 'Total Vault operations',
    type: 'counter',
    labels: ['operation', 'status'],
  },
  latency: {
    name: `${VAULT_METRICS_PREFIX}operation_latency_seconds`,
    help: 'Vault operation latency in seconds',
    type: 'histogram',
    labels: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  },

  // Token Lifecycle
  tokenRenewals: {
    name: `${VAULT_METRICS_PREFIX}token_renewals_total`,
    help: 'Total token renewals',
    type: 'counter',
  },

  // Key Rotations
  keyRotations: {
    name: `${VAULT_METRICS_PREFIX}key_rotations_total`,
    help: 'Total key rotations',
    type: 'counter',
    labels: ['key'],
  },

  // Kill Switch
  killSwitchActive: {
    name: `${VAULT_METRICS_PREFIX}kill_switch_active`,
    help: 'Kill switch status (1 = active, 0 = inactive)',
    type: 'gauge',
  },
  killSwitchActivations: {
    name: `${VAULT_METRICS_PREFIX}kill_switch_activations_total`,
    help: 'Total kill switch activations',
    type: 'counter',
  },
  killSwitchDeactivations: {
    name: `${VAULT_METRICS_PREFIX}kill_switch_deactivations_total`,
    help: 'Total kill switch deactivations',
    type: 'counter',
  },

  // MFA
  mfaVerifications: {
    name: `${VAULT_METRICS_PREFIX}mfa_verifications_total`,
    help: 'Total MFA verification attempts',
    type: 'counter',
    labels: ['status'],
  },

  // OAuth Token Encryption
  oauthEncryptions: {
    name: `${VAULT_METRICS_PREFIX}oauth_encryptions_total`,
    help: 'Total OAuth token encryptions',
    type: 'counter',
    labels: ['status'],
  },
  oauthDecryptions: {
    name: `${VAULT_METRICS_PREFIX}oauth_decryptions_total`,
    help: 'Total OAuth token decryptions',
    type: 'counter',
    labels: ['status'],
  },

  // Wallet Verification
  walletChallenges: {
    name: `${VAULT_METRICS_PREFIX}wallet_challenges_total`,
    help: 'Total wallet verification challenges created',
    type: 'counter',
    labels: ['status'],
  },
} as const;

// =============================================================================
// No-Op Metrics Implementation
// =============================================================================

/**
 * Create no-op metrics for testing or when Prometheus not available.
 * Each metric gets its own instance to allow independent spying in tests.
 */
export function createNoOpVaultMetrics(): VaultMetrics {
  const createNoOpCounter = (): CounterMetric => ({ inc: () => {} });
  const createNoOpGauge = (): GaugeMetric => ({ set: () => {}, inc: () => {}, dec: () => {} });
  const createNoOpHistogram = (): HistogramMetric => ({ observe: () => {} });

  return {
    operations: createNoOpCounter(),
    latency: createNoOpHistogram(),
    tokenRenewals: createNoOpCounter(),
    keyRotations: createNoOpCounter(),
    killSwitchActive: createNoOpGauge(),
    killSwitchActivations: createNoOpCounter(),
    killSwitchDeactivations: createNoOpCounter(),
    mfaVerifications: createNoOpCounter(),
    oauthEncryptions: createNoOpCounter(),
    oauthDecryptions: createNoOpCounter(),
    walletChallenges: createNoOpCounter(),
  };
}

// =============================================================================
// Metrics Helpers
// =============================================================================

/**
 * Track a Vault operation.
 */
export const VaultMetricsHelper = {
  /**
   * Track operation success.
   */
  success(metrics: VaultMetrics, operation: string, durationMs: number): void {
    metrics.operations.inc({ operation, status: 'success' });
    metrics.latency.observe({ operation }, durationMs / 1000);
  },

  /**
   * Track operation error.
   */
  error(metrics: VaultMetrics, operation: string, durationMs: number): void {
    metrics.operations.inc({ operation, status: 'error' });
    metrics.latency.observe({ operation }, durationMs / 1000);
  },

  /**
   * Track MFA verification.
   */
  mfaVerification(metrics: VaultMetrics, success: boolean): void {
    metrics.mfaVerifications.inc({ status: success ? 'success' : 'failure' });
  },

  /**
   * Track kill switch state change.
   */
  killSwitchStateChange(metrics: VaultMetrics, active: boolean): void {
    metrics.killSwitchActive.set(active ? 1 : 0);
    if (active) {
      metrics.killSwitchActivations.inc();
    } else {
      metrics.killSwitchDeactivations.inc();
    }
  },

  /**
   * Track OAuth token operation.
   */
  oauthOperation(
    metrics: VaultMetrics,
    operation: 'encrypt' | 'decrypt',
    success: boolean
  ): void {
    if (operation === 'encrypt') {
      metrics.oauthEncryptions.inc({ status: success ? 'success' : 'error' });
    } else {
      metrics.oauthDecryptions.inc({ status: success ? 'success' : 'error' });
    }
  },

  /**
   * Track wallet challenge creation.
   */
  walletChallenge(metrics: VaultMetrics, success: boolean): void {
    metrics.walletChallenges.inc({ status: success ? 'success' : 'error' });
  },
};
