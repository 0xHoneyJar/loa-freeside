/**
 * PartitionManager — Type annotation fix verification (Task 1.1)
 *
 * Validates that the query type parameter matches the actual SQL columns
 * returned by checkPartitionHealth().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg Pool
const mockQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockQuery,
  release: mockRelease,
});

vi.mock('pg', () => ({
  Pool: vi.fn(() => ({
    connect: mockConnect,
  })),
}));

describe('PartitionManager.checkPartitionHealth()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse bound_expr into range_start and range_end', async () => {
    // The SQL returns { partition_name, bound_expr } — NOT range_start/range_end directly
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          partition_name: 'audit_trail_2026_02',
          bound_expr: "FOR VALUES FROM ('2026-02-01') TO ('2026-03-01')",
        },
        {
          partition_name: 'audit_trail_2026_03',
          bound_expr: "FOR VALUES FROM ('2026-03-01') TO ('2026-04-01')",
        },
      ],
    });

    // Import after mocks are set up
    const { PartitionManager } = await import(
      '../../packages/adapters/storage/partition-manager.js'
    );

    const pm = new PartitionManager(
      { connect: mockConnect } as any,
      { warn: vi.fn(), info: vi.fn() } as any,
    );

    const result = await pm.checkPartitionHealth();

    // Verify parsed partitions have range_start/range_end from bound_expr parsing
    expect(result.partitions).toHaveLength(2);
    expect(result.partitions[0]).toEqual({
      partition_name: 'audit_trail_2026_02',
      range_start: '2026-02-01',
      range_end: '2026-03-01',
    });
    expect(result.partitions[1]).toEqual({
      partition_name: 'audit_trail_2026_03',
      range_start: '2026-03-01',
      range_end: '2026-04-01',
    });
  });

  it('should handle missing bound_expr gracefully', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          partition_name: 'audit_trail_unknown',
          bound_expr: null,
        },
      ],
    });

    const { PartitionManager } = await import(
      '../../packages/adapters/storage/partition-manager.js'
    );

    const pm = new PartitionManager(
      { connect: mockConnect } as any,
      { warn: vi.fn(), info: vi.fn() } as any,
    );

    const result = await pm.checkPartitionHealth();

    expect(result.partitions[0]).toEqual({
      partition_name: 'audit_trail_unknown',
      range_start: 'unknown',
      range_end: 'unknown',
    });
  });
});
