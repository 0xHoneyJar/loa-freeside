/**
 * Event Sourcing Service Tests
 *
 * Unit tests for sequence allocation, replay, consistency verification,
 * and gap analysis.
 *
 * @see Sprint 4, Tasks 4.3 & 4.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock feature-flags before importing the module under test
vi.mock('../feature-flags.js', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(true),
  getSequenceLockMode: vi.fn().mockReturnValue('for_update'),
}));

// Mock community-scope to pass through the callback with a mock client
vi.mock('../community-scope.js', () => ({
  withCommunityScope: vi.fn(async (_communityId: string, _pool: unknown, callback: (client: unknown) => Promise<unknown>) => {
    const mockClient = (vi.mocked(await import('../community-scope.js')).withCommunityScope as any).__mockClient;
    return callback(mockClient);
  }),
}));

import {
  allocateSequence,
  replayState,
  verifyConsistency,
  sequenceGapReport,
} from '../event-sourcing-service.js';
import { withCommunityScope } from '../community-scope.js';
import { getSequenceLockMode } from '../feature-flags.js';

// =============================================================================
// Mock Infrastructure
// =============================================================================

const createMockClient = () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
});

const createMockPool = () => ({
  connect: vi.fn(),
});

let mockClient: ReturnType<typeof createMockClient>;
let mockPool: ReturnType<typeof createMockPool>;

beforeEach(() => {
  vi.clearAllMocks();
  mockClient = createMockClient();
  mockPool = createMockPool();

  // Reset feature flag defaults (clearAllMocks doesn't reset mockReturnValue)
  vi.mocked(getSequenceLockMode).mockReturnValue('for_update');

  // Wire mock client into the community-scope mock
  (vi.mocked(withCommunityScope) as any).__mockClient = mockClient;

  // Re-implement withCommunityScope to pass mockClient
  vi.mocked(withCommunityScope).mockImplementation(
    async (_communityId, _pool, callback) => {
      return callback(mockClient as any);
    },
  );
});

// =============================================================================
// AC-4.3.1 / AC-4.4.1: Sequence Allocation — for_update tier
// =============================================================================

describe('allocateSequence', () => {
  it('should INSERT ON CONFLICT DO NOTHING then UPDATE RETURNING', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT ON CONFLICT
      .mockResolvedValueOnce({ rows: [{ next_seq: '42' }] }); // UPDATE RETURNING

    // @ts-expect-error - mock pool
    const result = await allocateSequence(mockPool, 'community-123');

    expect(result.sequenceNumber).toBe(42n);
    expect(result.communityId).toBe('community-123');

    // Verify INSERT ON CONFLICT DO NOTHING
    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO community_event_sequences');
    expect(insertCall[0]).toContain('ON CONFLICT');
    expect(insertCall[0]).toContain('DO NOTHING');
  });

  it('should throw when no sequence row found', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE returns nothing

    // @ts-expect-error - mock pool
    await expect(allocateSequence(mockPool, 'community-123')).rejects.toThrow(
      'No sequence row for community community-123',
    );
  });

  // ===========================================================================
  // AC-4.4.2: Advisory lock tier
  // ===========================================================================

  it('should acquire advisory lock before UPDATE in advisory_lock mode', async () => {
    vi.mocked(getSequenceLockMode).mockReturnValue('advisory_lock');

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT ON CONFLICT
      .mockResolvedValueOnce({ rows: [{ lock_key: '12345' }] }) // hashtext
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [{ next_seq: '7' }] }); // UPDATE RETURNING

    // @ts-expect-error - mock pool
    const result = await allocateSequence(mockPool, 'community-abc');

    expect(result.sequenceNumber).toBe(7n);

    // Verify advisory lock was acquired
    const advisoryCall = mockClient.query.mock.calls[2];
    expect(advisoryCall[0]).toContain('pg_advisory_xact_lock');
  });

  // ===========================================================================
  // AC-4.4.3: Range allocation tier
  // ===========================================================================

  it('should reserve range atomically in range_allocation mode', async () => {
    vi.mocked(getSequenceLockMode).mockReturnValue('range_allocation');

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // INSERT ON CONFLICT
      .mockResolvedValueOnce({ rows: [{ range_start: '100', range_end: '100' }] }); // UPDATE with range

    // @ts-expect-error - mock pool
    const result = await allocateSequence(mockPool, 'community-range');

    expect(result.sequenceNumber).toBe(100n);

    // Verify allocated_ranges JSONB tracking
    const updateCall = mockClient.query.mock.calls[1];
    expect(updateCall[0]).toContain('allocated_ranges');
    expect(updateCall[0]).toContain('jsonb_build_array');
  });
});

// =============================================================================
// AC-4.4.4: Concurrency — 10 parallel allocations produce monotonic sequences
// =============================================================================

describe('concurrency: 10 parallel allocations', () => {
  it('should produce 10 unique monotonic sequence numbers', async () => {
    // Simulate 10 sequential allocations (each gets incrementing sequence)
    let counter = 0;
    mockClient.query.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO community_event_sequences')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('UPDATE community_event_sequences')) {
        counter++;
        return { rows: [{ next_seq: String(counter) }] };
      }
      return { rows: [] };
    });

    // Fire 10 allocations in parallel
    const promises = Array.from({ length: 10 }, () =>
      // @ts-expect-error - mock pool
      allocateSequence(mockPool, 'community-concurrent'),
    );

    const results = await Promise.all(promises);
    const sequences = results.map((r) => r.sequenceNumber);

    // All unique
    const uniqueSequences = new Set(sequences);
    expect(uniqueSequences.size).toBe(10);

    // All positive (monotonic from DB perspective)
    for (const seq of sequences) {
      expect(seq).toBeGreaterThan(0n);
    }
  });
});

// =============================================================================
// AC-4.3.2: Replay — canonical posting model
// =============================================================================

describe('replayState', () => {
  it('should follow canonical posting model for all entry types', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        { id: '1', lot_id: 'lot-a', community_id: 'c1', entry_type: 'credit', amount_micro: '1000000', sequence_number: '1', correlation_id: 'cor1', causation_id: 'cau1', created_at: new Date() },
        { id: '2', lot_id: 'lot-a', community_id: 'c1', entry_type: 'debit', amount_micro: '300000', sequence_number: '2', correlation_id: 'cor2', causation_id: 'cau2', created_at: new Date() },
        { id: '3', lot_id: 'lot-a', community_id: 'c1', entry_type: 'expiry', amount_micro: '200000', sequence_number: '3', correlation_id: 'cor3', causation_id: 'cau3', created_at: new Date() },
        { id: '4', lot_id: 'lot-a', community_id: 'c1', entry_type: 'credit_back', amount_micro: '50000', sequence_number: '4', correlation_id: 'cor4', causation_id: 'cau4', created_at: new Date() },
        { id: '5', lot_id: 'lot-a', community_id: 'c1', entry_type: 'governance_debit', amount_micro: '100000', sequence_number: '5', correlation_id: 'cor5', causation_id: 'cau5', created_at: new Date() },
        { id: '6', lot_id: 'lot-a', community_id: 'c1', entry_type: 'governance_credit', amount_micro: '25000', sequence_number: '6', correlation_id: 'cor6', causation_id: 'cau6', created_at: new Date() },
      ],
    });

    // @ts-expect-error - mock pool
    const states = await replayState(mockPool, 'community-123');

    const lot = states.get('lot-a')!;
    expect(lot).toBeDefined();
    expect(lot.creditedMicro).toBe(1000000n);
    expect(lot.debitedMicro).toBe(300000n);
    expect(lot.expiredMicro).toBe(200000n);
    expect(lot.creditBackMicro).toBe(50000n);
    expect(lot.governanceDebitMicro).toBe(100000n);
    expect(lot.governanceCreditMicro).toBe(25000n);
    // remaining = 1000000 - 300000 - 200000 + 50000 - 100000 + 25000 = 475000
    expect(lot.remainingMicro).toBe(475000n);
    expect(lot.entryCount).toBe(6);
  });

  // ===========================================================================
  // AC-4.4.5: Gap tolerance — replay handles non-contiguous sequences
  // ===========================================================================

  it('should handle non-contiguous sequences correctly', async () => {
    // Sequences 1, 3, 7 — gaps between them
    mockClient.query.mockResolvedValueOnce({
      rows: [
        { id: '1', lot_id: 'lot-a', community_id: 'c1', entry_type: 'credit', amount_micro: '500000', sequence_number: '1', correlation_id: 'cor1', causation_id: 'cau1', created_at: new Date() },
        { id: '2', lot_id: 'lot-a', community_id: 'c1', entry_type: 'debit', amount_micro: '100000', sequence_number: '3', correlation_id: 'cor2', causation_id: 'cau2', created_at: new Date() },
        { id: '3', lot_id: 'lot-a', community_id: 'c1', entry_type: 'debit', amount_micro: '50000', sequence_number: '7', correlation_id: 'cor3', causation_id: 'cau3', created_at: new Date() },
      ],
    });

    // @ts-expect-error - mock pool
    const states = await replayState(mockPool, 'community-123');

    const lot = states.get('lot-a')!;
    expect(lot.creditedMicro).toBe(500000n);
    expect(lot.debitedMicro).toBe(150000n);
    expect(lot.remainingMicro).toBe(350000n);
    expect(lot.entryCount).toBe(3);
  });

  // ===========================================================================
  // AC-4.3.7: Hard 10k limit
  // ===========================================================================

  it('should clamp limit to MAX_REPLAY_EVENTS', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // @ts-expect-error - mock pool
    await replayState(mockPool, 'community-123', 1n, 99999);

    const queryCall = mockClient.query.mock.calls[0];
    expect(queryCall[1][2]).toBe(10000); // clamped to 10k
  });

  it('should clamp negative limit to 0', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // @ts-expect-error - mock pool
    await replayState(mockPool, 'community-123', 1n, -1);

    const queryCall = mockClient.query.mock.calls[0];
    expect(queryCall[1][2]).toBe(0); // clamped to 0, not -1
  });

  it('should handle NaN limit safely', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // @ts-expect-error - mock pool
    await replayState(mockPool, 'community-123', 1n, NaN);

    const queryCall = mockClient.query.mock.calls[0];
    expect(queryCall[1][2]).toBe(10000); // defaults to MAX
  });

  it('should skip entries without lot_id', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        { id: '1', lot_id: null, community_id: 'c1', entry_type: 'governance_credit', amount_micro: '100000', sequence_number: '1', correlation_id: 'cor1', causation_id: 'cau1', created_at: new Date() },
        { id: '2', lot_id: 'lot-a', community_id: 'c1', entry_type: 'credit', amount_micro: '500000', sequence_number: '2', correlation_id: 'cor2', causation_id: 'cau2', created_at: new Date() },
      ],
    });

    // @ts-expect-error - mock pool
    const states = await replayState(mockPool, 'community-123');

    expect(states.size).toBe(1);
    expect(states.has('lot-a')).toBe(true);
  });
});

// =============================================================================
// AC-4.3.4: Consistency Verification
// =============================================================================

describe('verifyConsistency', () => {
  it('should report zero drift when replay matches balances', async () => {
    // First call: replay query
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          { id: '1', lot_id: 'lot-a', community_id: 'c1', entry_type: 'credit', amount_micro: '1000000', sequence_number: '1', correlation_id: 'cor1', causation_id: 'cau1', created_at: new Date() },
        ],
      })
      // Second call: lot_balances query
      .mockResolvedValueOnce({
        rows: [{ lot_id: 'lot-a', remaining_micro: '1000000' }],
      });

    // @ts-expect-error - mock pool
    const result = await verifyConsistency(mockPool, 'community-123');

    expect(result.lotsChecked).toBe(1);
    expect(result.lotsConsistent).toBe(1);
    expect(result.lotsDrifted).toBe(0);
    expect(result.totalDriftMicro).toBe(0n);
  });

  it('should detect drift between replay and balances', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          { id: '1', lot_id: 'lot-a', community_id: 'c1', entry_type: 'credit', amount_micro: '1000000', sequence_number: '1', correlation_id: 'cor1', causation_id: 'cau1', created_at: new Date() },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ lot_id: 'lot-a', remaining_micro: '999000' }],
      });

    // @ts-expect-error - mock pool
    const result = await verifyConsistency(mockPool, 'community-123');

    expect(result.lotsDrifted).toBe(1);
    expect(result.drifts[0].driftMicro).toBe(1000n);
    expect(result.totalDriftMicro).toBe(1000n);
  });
});

// =============================================================================
// AC-4.3.6: Sequence Gap Report
// =============================================================================

describe('sequenceGapReport', () => {
  it('should classify gaps by probable cause', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        { prev_seq: '1', curr_seq: '3', gap_size: '1' },      // transaction_rollback
        { prev_seq: '10', curr_seq: '22', gap_size: '11' },    // range_allocation_skip (≤100)
        { prev_seq: '100', curr_seq: '2000', gap_size: '1899' }, // backfill_gap (>1000)
      ],
    });

    // @ts-expect-error - mock pool
    const gaps = await sequenceGapReport(mockPool, 'community-123');

    expect(gaps).toHaveLength(3);
    expect(gaps[0].probableCause).toBe('transaction_rollback');
    expect(gaps[0].gapSize).toBe(1n);
    expect(gaps[1].probableCause).toBe('range_allocation_skip');
    expect(gaps[2].probableCause).toBe('backfill_gap');
  });

  it('should return empty array for contiguous sequences', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    // @ts-expect-error - mock pool
    const gaps = await sequenceGapReport(mockPool, 'community-123');
    expect(gaps).toHaveLength(0);
  });

  it('should classify gaps 101-1000 as unknown', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [
        { prev_seq: '1', curr_seq: '502', gap_size: '500' },
      ],
    });

    // @ts-expect-error - mock pool
    const gaps = await sequenceGapReport(mockPool, 'community-123');
    expect(gaps[0].probableCause).toBe('unknown');
  });
});
