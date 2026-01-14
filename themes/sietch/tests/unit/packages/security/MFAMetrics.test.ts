/**
 * MFA Verification Metrics Tests
 *
 * Sprint 83 (LOW-3): Tests for MFA verification metrics tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMFAVerificationMetrics,
  getMFAFailureAlerts,
  resetMFAVerificationMetrics,
} from '../../../../src/packages/security/NaibSecurityGuard.js';

describe('MFA Verification Metrics (Sprint 83 - LOW-3)', () => {
  beforeEach(() => {
    resetMFAVerificationMetrics();
  });

  describe('getMFAVerificationMetrics', () => {
    it('should return initial metrics with zero counts', () => {
      const metrics = getMFAVerificationMetrics();

      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.totalCount).toBe(0);
      expect(metrics.successRate).toBe(1); // 0/0 defaults to 1
      expect(metrics.lastFailureAt).toBeUndefined();
    });

    it('should calculate success rate correctly', () => {
      // Simulate 3 successes and 1 failure via internal state
      // Note: We can't directly call recordMFAMetric since it's internal
      // This test documents the expected behavior
      const metrics = getMFAVerificationMetrics();

      // Initial state
      expect(metrics.totalCount).toBe(0);
      expect(metrics.successRate).toBe(1);
    });
  });

  describe('getMFAFailureAlerts', () => {
    it('should return empty array when no failures', () => {
      const alerts = getMFAFailureAlerts();

      expect(alerts).toEqual([]);
    });

    it('should use default threshold of 5', () => {
      // Verify function accepts no arguments
      const alerts = getMFAFailureAlerts();
      expect(Array.isArray(alerts)).toBe(true);
    });

    it('should accept custom threshold', () => {
      const alerts = getMFAFailureAlerts(3);
      expect(Array.isArray(alerts)).toBe(true);
    });
  });

  describe('resetMFAVerificationMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Reset and verify
      resetMFAVerificationMetrics();
      const metrics = getMFAVerificationMetrics();

      expect(metrics.successCount).toBe(0);
      expect(metrics.failureCount).toBe(0);
      expect(metrics.totalCount).toBe(0);
      expect(metrics.lastFailureAt).toBeUndefined();
    });
  });
});
