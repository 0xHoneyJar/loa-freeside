/**
 * AuditQueryService + AuditBackedInteractionHistoryProvider — Unit tests (Task 3.1)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AuditQueryService,
  AuditBackedInteractionHistoryProvider,
} from '../../packages/adapters/storage/audit-query-service.js';

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

// ─── AuditQueryService Tests ─────────────────────────────────────────────────

describe('AuditQueryService', () => {
  describe('queryByDomainTag', () => {
    it('should return entries matching domain tag within time range', async () => {
      const mockPool = createMockPool({
        rows: [
          { entry_id: '1', entry_hash: 'h1', event_type: 'model_performance', actor_id: 'a1', domain_tag: 'routing', payload: {}, event_time: new Date() },
        ],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.queryByDomainTag('routing', timeRange);

      expect(result).toHaveLength(1);
      expect(result[0].domain_tag).toBe('routing');
      expect(mockPool.query).toHaveBeenCalledOnce();

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('domain_tag = $1');
      expect(sql).toContain('event_time >= $2 AND event_time < $3');
      expect(params).toEqual(['routing', timeRange.from, timeRange.to]);
    });
  });

  describe('queryByEventType', () => {
    it('should return entries matching event type within time range', async () => {
      const mockPool = createMockPool({
        rows: [
          { entry_id: '2', entry_hash: 'h2', event_type: 'model_performance', actor_id: 'a1', domain_tag: 'routing', payload: {}, event_time: new Date() },
        ],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.queryByEventType('model_performance', timeRange);

      expect(result).toHaveLength(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('event_type = $1');
      expect(params[0]).toBe('model_performance');
    });
  });

  describe('queryByActorId', () => {
    it('should return entries matching actor ID within time range', async () => {
      const mockPool = createMockPool({ rows: [] });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      await service.queryByActorId('actor-42', timeRange);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('actor_id = $1');
      expect(params[0]).toBe('actor-42');
    });
  });

  describe('getModelPerformanceHistory', () => {
    it('should extract structured records from JSONB payloads', async () => {
      const mockPool = createMockPool({
        rows: [{
          entry_hash: 'perf-hash',
          event_time: new Date('2026-01-15'),
          payload: {
            model_id: 'gpt-4',
            latency_ms: 200,
            quality_observation: { score: 0.85, dimensions: { accuracy: 0.9 } },
            request_context: { pool_id: 'cheap', task_type: 'summarize', delegation_id: 'd-1' },
          },
        }],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getModelPerformanceHistory('gpt-4', timeRange);

      expect(result).toHaveLength(1);
      expect(result[0].model_id).toBe('gpt-4');
      expect(result[0].quality_score).toBe(0.85);
      expect(result[0].dimensions).toEqual({ accuracy: 0.9 });
      expect(result[0].latency_ms).toBe(200);
      expect(result[0].pool_id).toBe('cheap');
      expect(result[0].task_type).toBe('summarize');
      expect(result[0].delegation_id).toBe('d-1');
      expect(result[0].entry_hash).toBe('perf-hash');
    });

    it('should handle missing payload fields with defaults', async () => {
      const mockPool = createMockPool({
        rows: [{ entry_hash: 'h1', event_time: new Date(), payload: {} }],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getModelPerformanceHistory('gpt-4', timeRange);

      expect(result[0].quality_score).toBe(0);
      expect(result[0].dimensions).toEqual({});
      expect(result[0].latency_ms).toBe(0);
      expect(result[0].pool_id).toBe('');
    });
  });

  describe('getModelPairInteractions', () => {
    it('should aggregate interactions between two models', async () => {
      const mockPool = createMockPool({
        rows: [
          {
            event_time: new Date(),
            payload: {
              model_id: 'modelA',
              quality_observation: { score: 0.8 },
              request_context: { delegation_id: 'chain-modelA-modelB-123' },
            },
          },
          {
            event_time: new Date(),
            payload: {
              model_id: 'modelA',
              quality_observation: { score: 0.9 },
              request_context: { delegation_id: 'chain-modelA-modelB-456' },
            },
          },
        ],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getModelPairInteractions('modelA', 'modelB', timeRange);

      expect(result).toHaveLength(1);
      expect(result[0].model_pair).toEqual(['modelA', 'modelB']);
      expect(result[0].quality_score).toBe(0.85); // average of 0.8 and 0.9
      expect(result[0].observation_count).toBe(2);
    });

    it('should return empty array when no pair interactions found', async () => {
      const mockPool = createMockPool({ rows: [] });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getModelPairInteractions('modelA', 'modelB', timeRange);
      expect(result).toEqual([]);
    });

    it('should escape LIKE metacharacters in model IDs', async () => {
      const mockPool = createMockPool({ rows: [] });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      await service.getModelPairInteractions('model%A', 'model_B', timeRange);

      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain("ESCAPE '\\\\'");
      // Escaped: % → \%, _ → \_
      expect(params[3]).toBe('%model\\%A%');
      expect(params[4]).toBe('%model\\_B%');
    });
  });

  describe('getQualityDistribution', () => {
    it('should return histogram with 10 buckets', async () => {
      const mockPool = createMockPool({
        rows: [
          { score: '0.85' }, { score: '0.82' }, { score: '0.91' },
          { score: '0.45' }, { score: '0.73' },
        ],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getQualityDistribution('gpt-4', timeRange);

      expect(result.model_id).toBe('gpt-4');
      expect(result.buckets).toHaveLength(10);
      expect(result.total_observations).toBe(5);
      expect(result.mean_score).toBeGreaterThan(0);
      expect(result.median_score).toBeGreaterThan(0);

      // Verify bucket ranges
      expect(result.buckets[0].range_start).toBe(0);
      expect(result.buckets[0].range_end).toBe(0.1);
      expect(result.buckets[9].range_start).toBe(0.9);
      expect(result.buckets[9].range_end).toBe(1.0);
    });

    it('should return empty distribution for no data', async () => {
      const mockPool = createMockPool({ rows: [] });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getQualityDistribution('unknown', timeRange);

      expect(result.total_observations).toBe(0);
      expect(result.buckets).toEqual([]);
      expect(result.mean_score).toBe(0);
    });

    it('should filter NaN scores', async () => {
      const mockPool = createMockPool({
        rows: [{ score: 'NaN' }, { score: '0.5' }, { score: 'invalid' }],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getQualityDistribution('gpt-4', timeRange);

      expect(result.total_observations).toBe(1); // Only 0.5 is valid
    });
  });

  describe('getDomainTagActivity', () => {
    it('should return aggregate summary per domain tag', async () => {
      const mockPool = createMockPool({
        rows: [
          { domain_tag: 'routing', entry_count: '100', first_entry: new Date('2026-01-01'), last_entry: new Date('2026-01-31'), distinct_actors: '5' },
          { domain_tag: 'governance', entry_count: '50', first_entry: new Date('2026-01-05'), last_entry: new Date('2026-01-28'), distinct_actors: '3' },
        ],
      });
      const service = new AuditQueryService(mockPool as any, createMockLogger());

      const result = await service.getDomainTagActivity(timeRange);

      expect(result).toHaveLength(2);
      expect(result[0].domain_tag).toBe('routing');
      expect(result[0].entry_count).toBe(100);
      expect(result[0].distinct_actors).toBe(5);
    });
  });
});

// ─── AuditBackedInteractionHistoryProvider Tests ─────────────────────────────

describe('AuditBackedInteractionHistoryProvider', () => {
  it('should wire getModelPairInteractions to InteractionHistoryProvider interface', async () => {
    const mockPool = createMockPool({
      rows: [{
        event_time: new Date(),
        payload: {
          model_id: 'modelA',
          quality_observation: { score: 0.85 },
          request_context: { delegation_id: 'chain-modelA-modelB' },
        },
      }],
    });
    const queryService = new AuditQueryService(mockPool as any, createMockLogger());
    const provider = new AuditBackedInteractionHistoryProvider(queryService, timeRange);

    const result = await provider.getInteractions('modelA', 'modelB');

    expect(result).toHaveLength(1);
    expect(result[0].model_pair).toEqual(['modelA', 'modelB']);
    expect(result[0].quality_score).toBe(0.85);
  });

  it('should use default time range from constructor', async () => {
    const mockPool = createMockPool({ rows: [] });
    const queryService = new AuditQueryService(mockPool as any, createMockLogger());
    const customRange = { from: new Date('2026-06-01'), to: new Date('2026-07-01') };
    const provider = new AuditBackedInteractionHistoryProvider(queryService, customRange);

    await provider.getInteractions('a', 'b');

    const [_sql, params] = mockPool.query.mock.calls[0];
    expect(params[0]).toEqual(customRange.from);
    expect(params[1]).toEqual(customRange.to);
  });
});
