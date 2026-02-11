/**
 * Agent Metrics Unit Tests
 * Sprint 4, Task 4.1: EMF metrics emission
 *
 * @see SDD §3.5.1 Metric Definitions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentMetrics } from '../../packages/adapters/agent/agent-metrics.js';
import type { FeatureType } from '../../packages/adapters/agent/agent-metrics.js';

// --------------------------------------------------------------------------
// Mock EMF Logger
// --------------------------------------------------------------------------

function createMockMetricsLogger() {
  return {
    setNamespace: vi.fn(),
    setDimensions: vi.fn(),
    putMetric: vi.fn(),
    setProperty: vi.fn(),
    flush: vi.fn(async () => {}),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('AgentMetrics', () => {
  let metrics: AgentMetrics;
  let mockEmfLogger: ReturnType<typeof createMockMetricsLogger>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEmfLogger = createMockMetricsLogger();
    metrics = new AgentMetrics(mockLogger as any);
    // Override the createLogger to return our mock
    metrics.createLogger = vi.fn(() => mockEmfLogger as any);
  });

  describe('emitRequestComplete', () => {
    it('emits RequestLatency with feature dimension (AC-5.4, AC-5.7)', async () => {
      await metrics.emitRequestComplete({
        latencyMs: 150,
        feature: 'baseline',
        statusCode: 200,
        communityId: 'c1',
        poolId: 'cheap',
        isStream: false,
      });

      expect(mockEmfLogger.setNamespace).toHaveBeenCalledWith('Arrakis/AgentGateway');
      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ feature: 'baseline' });
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('RequestLatency', 150, expect.anything(), expect.anything());
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('RequestCount', 1, expect.anything());
      expect(mockEmfLogger.flush).toHaveBeenCalled();
    });

    it('emits Error5xxCount on 5xx status', async () => {
      await metrics.emitRequestComplete({
        latencyMs: 500,
        feature: 'ensemble',
        statusCode: 503,
        communityId: 'c1',
        poolId: 'fast-code',
        isStream: false,
      });

      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('Error5xxCount', 1, expect.anything());
    });

    it('emits RateLimitCount on 429 status', async () => {
      await metrics.emitRequestComplete({
        latencyMs: 10,
        feature: 'baseline',
        statusCode: 429,
        communityId: 'c1',
        poolId: 'cheap',
        isStream: false,
      });

      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('RateLimitCount', 1, expect.anything());
    });

    it('distinguishes byok feature type', async () => {
      await metrics.emitRequestComplete({
        latencyMs: 200,
        feature: 'byok',
        statusCode: 200,
        communityId: 'c1',
        poolId: 'architect',
        isStream: true,
      });

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ feature: 'byok' });
      expect(mockEmfLogger.setProperty).toHaveBeenCalledWith('isStream', true);
    });

    it('emits structured log event', async () => {
      await metrics.emitRequestComplete({
        latencyMs: 100,
        feature: 'baseline',
        statusCode: 200,
        communityId: 'c1',
        poolId: 'cheap',
        isStream: false,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'agent_request_complete' }),
        'agent_request_complete',
      );
    });

    it('handles flush failure gracefully', async () => {
      mockEmfLogger.flush.mockRejectedValueOnce(new Error('flush failed'));

      await metrics.emitRequestComplete({
        latencyMs: 100,
        feature: 'baseline',
        statusCode: 200,
        communityId: 'c1',
        poolId: 'cheap',
        isStream: false,
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to emit request metrics',
      );
    });
  });

  describe('emitBudgetFinalize', () => {
    it('emits CommittedReportedDelta with accounting_mode dimension (AC-5.9)', async () => {
      await metrics.emitBudgetFinalize({
        committedReportedDelta: 50,
        accountingMode: 'standard',
        communityId: 'c1',
      });

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ accounting_mode: 'standard' });
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('CommittedReportedDelta', 50, expect.anything());
    });

    it('excludes BYOK via accounting_mode dimension', async () => {
      await metrics.emitBudgetFinalize({
        committedReportedDelta: 0,
        accountingMode: 'byok',
        communityId: 'c1',
      });

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ accounting_mode: 'byok' });
    });
  });

  describe('emitPoolClaimEvent', () => {
    it('emits PoolClaimMismatch counter (AC-5.8)', async () => {
      await metrics.emitPoolClaimEvent({ poolId: 'fast-code', type: 'mismatch' });

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ pool_id: 'fast-code' });
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('PoolClaimMismatch', 1, expect.anything());
    });

    it('emits PoolClaimReject counter', async () => {
      await metrics.emitPoolClaimEvent({ poolId: 'reasoning', type: 'reject' });

      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('PoolClaimReject', 1, expect.anything());
    });
  });

  describe('emitCircuitBreakerState', () => {
    it('emits gauge with component dimension', async () => {
      await metrics.emitCircuitBreakerState({ state: 2, component: 'loa-finn' });

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ component: 'loa-finn' });
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('CircuitBreakerState', 2, expect.anything());
    });
  });

  describe('emitRedisLatency', () => {
    it('emits RedisLatency distribution', async () => {
      await metrics.emitRedisLatency(3.5, 'budget-reserve');

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ operation: 'budget-reserve' });
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('RedisLatency', 3.5, expect.anything());
    });
  });

  describe('emitRateLimitHit', () => {
    it('emits with dimension label', async () => {
      await metrics.emitRateLimitHit('community', 'c1');

      expect(mockEmfLogger.setDimensions).toHaveBeenCalledWith({ dimension: 'community' });
      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('RateLimitHit', 1, expect.anything());
    });
  });

  describe('emitFinalizeFailure', () => {
    it('emits failure count and structured error log', async () => {
      await metrics.emitFinalizeFailure('c1', 'Redis timeout');

      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('FinalizeFailure', 1, expect.anything());
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'finalize_failure' }),
        'finalize_failure',
      );
    });
  });

  describe('emitReservationAge', () => {
    it('emits ReservationAge distribution', async () => {
      await metrics.emitReservationAge(45000);

      expect(mockEmfLogger.putMetric).toHaveBeenCalledWith('ReservationAge', 45000, expect.anything());
    });
  });
});
