/**
 * AuditExportService — Unit tests (Task 3.2)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditExportService } from '../../packages/adapters/storage/audit-export-service.js';
import type { ExportConfig } from '../../packages/adapters/storage/audit-export-service.js';

// ─── Mock pg client & pool ───────────────────────────────────────────────────

function createMockPool(rows: any[] = []) {
  const batchSize = 500;
  let fetchCount = 0;

  const mockClient = {
    query: vi.fn().mockImplementation((sql: string, _params?: any[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.startsWith('DECLARE')) {
        return { rows: [] };
      }
      if (sql.startsWith('FETCH')) {
        const start = fetchCount * batchSize;
        const batch = rows.slice(start, start + batchSize);
        fetchCount++;
        return { rows: batch };
      }
      if (sql.startsWith('CLOSE')) {
        return { rows: [] };
      }
      // exportStats query
      return {
        rows: [{
          row_count: String(rows.length),
          min_time: new Date('2026-01-01'),
          max_time: new Date('2026-01-31'),
          unique_models: rows.map((r) => r.payload?.model_id).filter(Boolean),
          unique_task_types: rows.map((r) => r.payload?.request_context?.task_type).filter(Boolean),
        }],
      };
    }),
    release: vi.fn(),
  };

  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
    query: vi.fn().mockImplementation((_sql: string, _params?: any[]) => {
      return {
        rows: [{
          row_count: String(rows.length),
          min_time: new Date('2026-01-01'),
          max_time: new Date('2026-01-31'),
          unique_models: [...new Set(rows.map((r) => r.payload?.model_id).filter(Boolean))],
          unique_task_types: [...new Set(rows.map((r) => r.payload?.request_context?.task_type).filter(Boolean))],
        }],
      };
    }),
  };

  return { mockPool, mockClient };
}

function createMockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

function makeRow(modelId: string, taskType: string, score: number, hash: string) {
  return {
    entry_hash: hash,
    event_time: new Date('2026-01-15T12:00:00Z'),
    payload: {
      model_id: modelId,
      latency_ms: 150,
      request_context: {
        reputation_state: 'established',
        capabilities: ['read', 'write'],
        pool_id: 'pool-1',
        task_type: taskType,
        delegation_chain: [modelId],
        ensemble_strategy: 'voting',
      },
      quality_observation: {
        score,
        dimensions: { accuracy: score, coherence: score * 0.9 },
      },
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AuditExportService', () => {
  const timeRange = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };

  describe('exportToStream', () => {
    it('should produce valid JSON Lines output', async () => {
      const rows = [
        makeRow('gpt-4', 'summarize', 0.85, 'hash-1'),
        makeRow('claude-3', 'code', 0.92, 'hash-2'),
      ];
      const { mockPool } = createMockPool(rows);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: true,
      };

      const lines: string[] = [];
      for await (const line of service.exportToStream(config)) {
        lines.push(line);
      }

      expect(lines).toHaveLength(2);

      // Each line should be valid JSON ending with newline
      for (const line of lines) {
        expect(line.endsWith('\n')).toBe(true);
        const parsed = JSON.parse(line.trim());
        expect(parsed).toHaveProperty('state');
        expect(parsed).toHaveProperty('action');
        expect(parsed).toHaveProperty('reward');
        expect(parsed).toHaveProperty('provenance');
      }
    });

    it('should include state/action/reward/provenance fields', async () => {
      const rows = [makeRow('gpt-4', 'summarize', 0.85, 'hash-abc')];
      const { mockPool } = createMockPool(rows);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: true,
      };

      const lines: string[] = [];
      for await (const line of service.exportToStream(config)) {
        lines.push(line);
      }

      const record = JSON.parse(lines[0].trim());

      expect(record.state.reputation_state).toBe('established');
      expect(record.state.pool_id).toBe('pool-1');
      expect(record.state.task_type).toBe('summarize');
      expect(record.action.model_id).toBe('gpt-4');
      expect(record.action.ensemble_strategy).toBe('voting');
      expect(record.reward.quality_score).toBe(0.85);
      expect(record.reward.latency_ms).toBe(150);
      expect(record.provenance.entry_hash).toBe('hash-abc');
    });

    it('should omit provenance when includeProvenance is false', async () => {
      const rows = [makeRow('gpt-4', 'summarize', 0.85, 'hash-1')];
      const { mockPool } = createMockPool(rows);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: false,
      };

      const lines: string[] = [];
      for await (const line of service.exportToStream(config)) {
        lines.push(line);
      }

      const record = JSON.parse(lines[0].trim());
      expect(record.provenance).toBeUndefined();
    });

    it('should handle empty result set', async () => {
      const { mockPool } = createMockPool([]);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: true,
      };

      const lines: string[] = [];
      for await (const line of service.exportToStream(config)) {
        lines.push(line);
      }

      expect(lines).toHaveLength(0);
    });

    it('should release client even on error', async () => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] }) // BEGIN
          .mockRejectedValueOnce(new Error('DB connection lost')), // DECLARE fails
        release: vi.fn(),
      };
      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      };
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: true,
      };

      await expect(async () => {
        for await (const _line of service.exportToStream(config)) {
          // should throw
        }
      }).rejects.toThrow('DB connection lost');

      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it('should handle missing payload fields gracefully', async () => {
      const rows = [{
        entry_hash: 'hash-empty',
        event_time: new Date('2026-01-15T12:00:00Z'),
        payload: {},
      }];
      const { mockPool } = createMockPool(rows);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: true,
      };

      const lines: string[] = [];
      for await (const line of service.exportToStream(config)) {
        lines.push(line);
      }

      const record = JSON.parse(lines[0].trim());
      expect(record.state.reputation_state).toBe('unknown');
      expect(record.action.model_id).toBe('');
      expect(record.reward.quality_score).toBe(0);
    });
  });

  describe('exportStats', () => {
    it('should return aggregate stats without loading data', async () => {
      const rows = [
        makeRow('gpt-4', 'summarize', 0.85, 'h1'),
        makeRow('claude-3', 'code', 0.92, 'h2'),
        makeRow('gpt-4', 'code', 0.78, 'h3'),
      ];
      const { mockPool } = createMockPool(rows);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: false,
      };

      const stats = await service.exportStats(config);

      expect(stats.row_count).toBe(3);
      expect(stats.time_range).toBe(timeRange);
      expect(stats.unique_models).toContain('gpt-4');
      expect(stats.unique_models).toContain('claude-3');
    });

    it('should handle empty stats', async () => {
      const { mockPool } = createMockPool([]);
      const service = new AuditExportService(mockPool as any, createMockLogger());

      const config: ExportConfig = {
        timeRange,
        format: 'jsonl',
        includeProvenance: false,
      };

      const stats = await service.exportStats(config);
      expect(stats.row_count).toBe(0);
    });
  });
});
