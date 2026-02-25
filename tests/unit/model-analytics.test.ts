/**
 * ModelAnalytics — Unit tests (Task 3.3)
 */

import { describe, it, expect, vi } from 'vitest';
import { ModelAnalytics } from '../../packages/adapters/storage/model-analytics.js';

// ─── Mock helpers ────────────────────────────────────────────────────────────

function createMockPool(queryResult: any = { rows: [] }) {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
  };
}

function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

const timeRange = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ModelAnalytics', () => {
  describe('getScoreTrend', () => {
    it('should return time-bucketed average scores', async () => {
      const mockPool = createMockPool({
        rows: [
          { bucket: new Date('2026-01-01'), avg_score: '0.85', observation_count: '10' },
          { bucket: new Date('2026-01-02'), avg_score: '0.90', observation_count: '15' },
          { bucket: new Date('2026-01-03'), avg_score: '0.78', observation_count: '8' },
        ],
      });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.getScoreTrend('gpt-4', 'day', timeRange);

      expect(result).toHaveLength(3);
      expect(result[0].avg_score).toBe(0.85);
      expect(result[0].observation_count).toBe(10);
      expect(result[1].avg_score).toBe(0.90);
    });

    it('should pass granularity to date_trunc', async () => {
      const mockPool = createMockPool({ rows: [] });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      await analytics.getScoreTrend('gpt-4', 'week', timeRange);

      expect(mockPool.query).toHaveBeenCalledOnce();
      const [_sql, params] = mockPool.query.mock.calls[0];
      expect(params[0]).toBe('week');
    });

    it('should reject invalid granularity', async () => {
      const mockPool = createMockPool({ rows: [] });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      await expect(
        analytics.getScoreTrend('gpt-4', 'minute' as any, timeRange),
      ).rejects.toThrow('Invalid granularity: minute');
    });

    it('should handle empty results', async () => {
      const mockPool = createMockPool({ rows: [] });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.getScoreTrend('gpt-4', 'day', timeRange);
      expect(result).toEqual([]);
    });
  });

  describe('compareModels', () => {
    it('should return side-by-side metrics for multiple models', async () => {
      const mockPool = createMockPool({
        rows: [
          {
            model_id: 'gpt-4',
            avg_quality_score: '0.88',
            total_observations: '100',
            avg_latency_ms: '120.5',
            p95_latency_ms: '250.0',
          },
          {
            model_id: 'claude-3',
            avg_quality_score: '0.91',
            total_observations: '80',
            avg_latency_ms: '95.3',
            p95_latency_ms: '180.0',
          },
        ],
      });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.compareModels(['gpt-4', 'claude-3'], timeRange);

      expect(result).toHaveLength(2);
      expect(result[0].model_id).toBe('gpt-4');
      expect(result[0].avg_quality_score).toBe(0.88);
      expect(result[0].p95_latency_ms).toBe(250.0);
      expect(result[1].model_id).toBe('claude-3');
      expect(result[1].total_observations).toBe(80);
    });

    it('should return empty array for empty modelIds', async () => {
      const mockPool = createMockPool({ rows: [] });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.compareModels([], timeRange);
      expect(result).toEqual([]);
      // Should not even call the database
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should pass modelIds as array parameter', async () => {
      const mockPool = createMockPool({ rows: [] });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      await analytics.compareModels(['gpt-4', 'claude-3'], timeRange);

      const [_sql, params] = mockPool.query.mock.calls[0];
      expect(params[0]).toEqual(['gpt-4', 'claude-3']);
    });
  });

  describe('getTaskTypeBreakdown', () => {
    it('should show observation distribution by task type', async () => {
      const mockPool = createMockPool({
        rows: [
          { task_type: 'summarize', observation_count: '50', avg_score: '0.82' },
          { task_type: 'code', observation_count: '30', avg_score: '0.91' },
          { task_type: 'unspecified', observation_count: '20', avg_score: '0.75' },
        ],
      });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.getTaskTypeBreakdown('gpt-4', timeRange);

      expect(result).toHaveLength(3);
      expect(result[0].task_type).toBe('summarize');
      expect(result[0].observation_count).toBe(50);
      expect(result[0].avg_score).toBe(0.82);
    });

    it('should handle empty results', async () => {
      const mockPool = createMockPool({ rows: [] });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.getTaskTypeBreakdown('unknown-model', timeRange);
      expect(result).toEqual([]);
    });
  });

  describe('getAggregateRatio', () => {
    it('should show the ratio of unspecified vs typed observations', async () => {
      const mockPool = createMockPool({
        rows: [{ aggregate_count: '20', task_specific_count: '80' }],
      });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.getAggregateRatio('gpt-4', timeRange);

      expect(result.aggregate).toBe(20);
      expect(result.taskSpecific).toBe(80);
    });

    it('should handle zero observations', async () => {
      const mockPool = createMockPool({
        rows: [{ aggregate_count: '0', task_specific_count: '0' }],
      });
      const analytics = new ModelAnalytics(mockPool as any, createMockLogger());

      const result = await analytics.getAggregateRatio('gpt-4', timeRange);

      expect(result.aggregate).toBe(0);
      expect(result.taskSpecific).toBe(0);
    });
  });
});
