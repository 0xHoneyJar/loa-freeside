/**
 * Metrics Unit Tests
 *
 * Sprint 68: Observability Metrics
 *
 * Tests the Sprint 68 metrics functions:
 * - Task 68.3: Gossip convergence histogram
 * - Task 68.4: Fast-path latency histogram
 * - Task 68.5: MFA counters
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordGossipConvergence,
  recordFastPathLatency,
  recordMfaAttempt,
  recordMfaSuccess,
  recordMfaTimeout,
  getPrometheusMetrics,
  recordHttpRequest,
} from '../../../src/utils/metrics.js';

// Mock the db module to avoid database dependencies
vi.mock('../../../src/db/index.js', () => ({
  getHealthStatus: () => ({
    lastSuccessfulQuery: new Date(),
    inGracePeriod: false,
  }),
  getCurrentEligibility: () => [],
  getCurrentNaibSeats: () => [],
  getActiveWaitlistRegistrations: () => [],
  getAlertStats: () => ({ totalSent: 0 }),
}));

describe('Metrics Module', () => {
  describe('recordHttpRequest', () => {
    it('should record HTTP requests', () => {
      recordHttpRequest('GET', '/api/health', 200, 15);

      const output = getPrometheusMetrics();
      expect(output).toContain('sietch_http_requests_total{method="GET",route="/api/health",status="200"}');
    });
  });

  describe('Task 68.3: Gossip Convergence Metric', () => {
    it('should record gossip convergence times', () => {
      // Record some convergence times
      recordGossipConvergence(0.5);
      recordGossipConvergence(1.2);
      recordGossipConvergence(0.3);

      const output = getPrometheusMetrics();

      // Check histogram is present
      expect(output).toContain('# HELP sietch_gossip_convergence_seconds');
      expect(output).toContain('# TYPE sietch_gossip_convergence_seconds histogram');

      // Check buckets
      expect(output).toContain('sietch_gossip_convergence_seconds_bucket{le="0.1"}');
      expect(output).toContain('sietch_gossip_convergence_seconds_bucket{le="0.5"}');
      expect(output).toContain('sietch_gossip_convergence_seconds_bucket{le="1"}');
      expect(output).toContain('sietch_gossip_convergence_seconds_bucket{le="+Inf"}');

      // Check sum and count
      expect(output).toContain('sietch_gossip_convergence_seconds_sum');
      expect(output).toContain('sietch_gossip_convergence_seconds_count');
    });

    it('should correctly bucket values', () => {
      // Record a value below the first bucket
      recordGossipConvergence(0.05);

      const output = getPrometheusMetrics();

      // Value 0.05 should be in bucket 0.1 and all higher buckets
      expect(output).toMatch(/sietch_gossip_convergence_seconds_bucket\{le="0\.1"\} \d+/);
    });

    it('should have expected bucket boundaries', () => {
      const output = getPrometheusMetrics();

      // Expected buckets: 0.1, 0.25, 0.5, 1, 2, 5, 10, +Inf
      expect(output).toContain('le="0.1"');
      expect(output).toContain('le="0.25"');
      expect(output).toContain('le="0.5"');
      expect(output).toContain('le="1"');
      expect(output).toContain('le="2"');
      expect(output).toContain('le="5"');
      expect(output).toContain('le="10"');
      expect(output).toContain('le="+Inf"');
    });
  });

  describe('Task 68.4: Fast-Path Latency Metric', () => {
    it('should record fast-path latency by operation type', () => {
      recordFastPathLatency('redis_cache_hit', 5);
      recordFastPathLatency('eligibility_check', 25);
      recordFastPathLatency('redis_cache_hit', 8);

      const output = getPrometheusMetrics();

      // Check histogram is present
      expect(output).toContain('# HELP sietch_fast_path_latency_ms');
      expect(output).toContain('# TYPE sietch_fast_path_latency_ms histogram');

      // Check operation labels
      expect(output).toContain('operation="redis_cache_hit"');
      expect(output).toContain('operation="eligibility_check"');
    });

    it('should have expected bucket boundaries', () => {
      recordFastPathLatency('test_op', 1);
      const output = getPrometheusMetrics();

      // Expected buckets: 5, 10, 25, 50, 100, 250, 500, +Inf
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="5"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="10"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="25"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="50"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="100"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="250"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="500"}');
      expect(output).toContain('sietch_fast_path_latency_ms_bucket{operation="test_op",le="+Inf"}');
    });

    it('should track sum and count per operation', () => {
      recordFastPathLatency('unique_op', 10);
      recordFastPathLatency('unique_op', 20);
      recordFastPathLatency('unique_op', 30);

      const output = getPrometheusMetrics();

      expect(output).toContain('sietch_fast_path_latency_ms_sum{operation="unique_op"}');
      expect(output).toContain('sietch_fast_path_latency_ms_count{operation="unique_op"}');
    });
  });

  describe('Task 68.5: MFA Metrics', () => {
    describe('recordMfaAttempt', () => {
      it('should record MFA attempts by method and tier', () => {
        recordMfaAttempt('totp', 'MEDIUM');
        recordMfaAttempt('duo', 'CRITICAL');
        recordMfaAttempt('totp', 'HIGH');

        const output = getPrometheusMetrics();

        expect(output).toContain('# HELP sietch_mfa_attempt_total');
        expect(output).toContain('# TYPE sietch_mfa_attempt_total counter');
        expect(output).toContain('sietch_mfa_attempt_total{method="totp",tier="MEDIUM"}');
        expect(output).toContain('sietch_mfa_attempt_total{method="duo",tier="CRITICAL"}');
        expect(output).toContain('sietch_mfa_attempt_total{method="totp",tier="HIGH"}');
      });

      it('should increment counters for repeated attempts', () => {
        // Record multiple attempts with same method/tier
        recordMfaAttempt('backup', 'LOW');
        recordMfaAttempt('backup', 'LOW');
        recordMfaAttempt('backup', 'LOW');

        const output = getPrometheusMetrics();

        // Should have counter >= 3 for this combo
        expect(output).toMatch(/sietch_mfa_attempt_total\{method="backup",tier="LOW"\} \d+/);
      });
    });

    describe('recordMfaSuccess', () => {
      it('should record MFA successes by method and tier', () => {
        recordMfaSuccess('totp', 'MEDIUM');
        recordMfaSuccess('duo', 'CRITICAL');

        const output = getPrometheusMetrics();

        expect(output).toContain('# HELP sietch_mfa_success_total');
        expect(output).toContain('# TYPE sietch_mfa_success_total counter');
        expect(output).toContain('sietch_mfa_success_total{method="totp",tier="MEDIUM"}');
        expect(output).toContain('sietch_mfa_success_total{method="duo",tier="CRITICAL"}');
      });
    });

    describe('recordMfaTimeout', () => {
      it('should record MFA timeouts by method and tier', () => {
        recordMfaTimeout('duo', 'HIGH');
        recordMfaTimeout('totp', 'MEDIUM');

        const output = getPrometheusMetrics();

        expect(output).toContain('# HELP sietch_mfa_timeout_total');
        expect(output).toContain('# TYPE sietch_mfa_timeout_total counter');
        expect(output).toContain('sietch_mfa_timeout_total{method="duo",tier="HIGH"}');
        expect(output).toContain('sietch_mfa_timeout_total{method="totp",tier="MEDIUM"}');
      });
    });

    it('should support all risk tiers', () => {
      const tiers = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

      for (const tier of tiers) {
        recordMfaAttempt('totp', tier);
      }

      const output = getPrometheusMetrics();

      for (const tier of tiers) {
        expect(output).toContain(`tier="${tier}"`);
      }
    });

    it('should support all MFA methods', () => {
      const methods = ['totp', 'duo', 'backup'];

      for (const method of methods) {
        recordMfaAttempt(method, 'MEDIUM');
      }

      const output = getPrometheusMetrics();

      for (const method of methods) {
        expect(output).toContain(`method="${method}"`);
      }
    });
  });

  describe('Prometheus Output Format', () => {
    it('should produce valid Prometheus text format', () => {
      // Record some metrics
      recordGossipConvergence(0.5);
      recordFastPathLatency('test', 10);
      recordMfaAttempt('totp', 'MEDIUM');

      const output = getPrometheusMetrics();

      // Check overall format
      expect(output).toMatch(/^# HELP/m);
      expect(output).toMatch(/^# TYPE/m);

      // Check it ends with newline
      expect(output.endsWith('\n')).toBe(true);

      // Check no empty lines between metric blocks
      expect(output).not.toContain('\n\n\n');
    });

    it('should include standard application metrics', () => {
      const output = getPrometheusMetrics();

      expect(output).toContain('sietch_members_total');
      expect(output).toContain('sietch_naib_seats_total');
      expect(output).toContain('sietch_naib_seats_filled');
      expect(output).toContain('sietch_waitlist_registrations');
    });

    it('should include Node.js process metrics', () => {
      const output = getPrometheusMetrics();

      expect(output).toContain('nodejs_heap_size_total_bytes');
      expect(output).toContain('nodejs_heap_size_used_bytes');
      expect(output).toContain('nodejs_process_uptime_seconds');
    });
  });
});
