/**
 * Purpose Service Tests — Economic Memory (F-1)
 *
 * Tests AC-2.2.1 through AC-2.2.4 for purpose resolution,
 * unclassified rate monitoring, and configurable purpose maps.
 *
 * @see SDD §4.4 Economic Memory
 * @see Sprint 2, Task 2.2
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  resolvePurpose,
  loadPurposeMap,
  setPurposeMap,
  getPurposeMap,
  getUnclassifiedRate,
  getPurposeBreakdown,
  _resetForTesting,
} from '../purpose-service.js';

// Mock dependencies
vi.mock('../community-scope.js', () => ({
  withCommunityScope: vi.fn(async (_communityId, _pool, fn) => {
    // Create a mock client that tracks queries
    const mockClient = {
      query: vi.fn(),
    };
    return fn(mockClient);
  }),
}));

vi.mock('../feature-flags.js', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

import { isFeatureEnabled } from '../feature-flags.js';
import { withCommunityScope } from '../community-scope.js';

describe('Purpose Service', () => {
  beforeEach(() => {
    _resetForTesting();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.POOL_PURPOSE_MAP;
  });

  // ---------------------------------------------------------------------------
  // AC-2.2.1: resolvePurpose returns correct purpose from config map
  // ---------------------------------------------------------------------------

  describe('resolvePurpose (AC-2.2.1)', () => {
    it('resolves known pool IDs to their purpose', () => {
      expect(resolvePurpose('cheap')).toBe('agent_inference');
      expect(resolvePurpose('standard')).toBe('agent_inference');
      expect(resolvePurpose('reasoning')).toBe('agent_inference');
      expect(resolvePurpose('architect')).toBe('agent_inference');
      expect(resolvePurpose('training')).toBe('agent_training');
      expect(resolvePurpose('governance')).toBe('governance_action');
      expect(resolvePurpose('platform')).toBe('platform_fee');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-2.2.2: Unknown pool_id returns 'unclassified'
  // ---------------------------------------------------------------------------

  describe('resolvePurpose unclassified fallback (AC-2.2.2)', () => {
    it('returns unclassified for unknown pool IDs', () => {
      expect(resolvePurpose('unknown_pool')).toBe('unclassified');
      expect(resolvePurpose('')).toBe('unclassified');
      expect(resolvePurpose('nonexistent')).toBe('unclassified');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature flag gating
  // ---------------------------------------------------------------------------

  describe('resolvePurpose with feature flag disabled', () => {
    it('returns unclassified when FEATURE_PURPOSE_TRACKING is disabled', () => {
      vi.mocked(isFeatureEnabled).mockReturnValue(false);
      expect(resolvePurpose('cheap')).toBe('unclassified');
    });
  });

  // ---------------------------------------------------------------------------
  // AC-2.2.4: Config-based mapping supports runtime reload
  // ---------------------------------------------------------------------------

  describe('loadPurposeMap (AC-2.2.4)', () => {
    it('loads default map when no env var is set', () => {
      const map = loadPurposeMap();
      expect(map.cheap).toBe('agent_inference');
      expect(map.governance).toBe('governance_action');
    });

    it('merges env var map with defaults', () => {
      process.env.POOL_PURPOSE_MAP = JSON.stringify({
        custom_pool: 'transfer',
        cheap: 'platform_fee', // override default
      });

      const map = loadPurposeMap();
      expect(map.custom_pool).toBe('transfer');
      expect(map.cheap).toBe('platform_fee'); // overridden
      expect(map.governance).toBe('governance_action'); // preserved from default
    });

    it('falls back to defaults on invalid JSON', () => {
      process.env.POOL_PURPOSE_MAP = 'not-valid-json';
      const map = loadPurposeMap();
      expect(map.cheap).toBe('agent_inference');
    });
  });

  describe('setPurposeMap', () => {
    it('allows runtime map replacement', () => {
      setPurposeMap({ my_pool: 'refund' });
      expect(resolvePurpose('my_pool')).toBe('refund');
      expect(resolvePurpose('cheap')).toBe('unclassified'); // no longer in map
    });
  });

  describe('getPurposeMap', () => {
    it('returns a copy of the current map', () => {
      const map = getPurposeMap();
      map.cheap = 'refund'; // mutate copy
      expect(resolvePurpose('cheap')).toBe('agent_inference'); // original unchanged
    });
  });

  // ---------------------------------------------------------------------------
  // AC-2.2.3: getUnclassifiedRate
  // ---------------------------------------------------------------------------

  describe('getUnclassifiedRate (AC-2.2.3)', () => {
    it('returns correct rate from query result', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [{ total: '100', unclassified: '15' }],
      });
      vi.mocked(withCommunityScope).mockImplementation(
        async (_communityId, _pool, fn) => fn({ query: mockQuery } as any),
      );

      const result = await getUnclassifiedRate(
        {} as any, // pool mock
        'community-123',
        24,
      );

      expect(result.totalEntries).toBe(100);
      expect(result.unclassifiedEntries).toBe(15);
      expect(result.rate).toBe(0.15);
    });

    it('returns 0 rate when no entries exist', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [{ total: '0', unclassified: '0' }],
      });
      vi.mocked(withCommunityScope).mockImplementation(
        async (_communityId, _pool, fn) => fn({ query: mockQuery } as any),
      );

      const result = await getUnclassifiedRate({} as any, 'community-123');
      expect(result.rate).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // AC-2.4.1: getPurposeBreakdown
  // ---------------------------------------------------------------------------

  describe('getPurposeBreakdown (AC-2.4.1)', () => {
    it('returns mapped rows from community_purpose_breakdown view', async () => {
      const mockQuery = vi.fn().mockResolvedValue({
        rows: [
          { purpose: 'agent_inference', day: '2026-02-23', total_micro: '5000000', entry_count: '10' },
          { purpose: 'governance_action', day: '2026-02-23', total_micro: '1000000', entry_count: '2' },
        ],
      });
      vi.mocked(withCommunityScope).mockImplementation(
        async (_communityId, _pool, fn) => fn({ query: mockQuery } as any),
      );

      const rows = await getPurposeBreakdown({} as any, 'community-123');

      expect(rows).toHaveLength(2);
      expect(rows[0].purpose).toBe('agent_inference');
      expect(rows[0].totalMicro).toBe(5000000n);
      expect(rows[0].entryCount).toBe(10);
      expect(rows[1].purpose).toBe('governance_action');
      expect(rows[1].totalMicro).toBe(1000000n);
    });

    it('applies date filters when from/to provided', async () => {
      const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
      vi.mocked(withCommunityScope).mockImplementation(
        async (_communityId, _pool, fn) => fn({ query: mockQuery } as any),
      );

      await getPurposeBreakdown({} as any, 'community-123', '2026-02-01', '2026-02-28');

      // Verify the query included date params
      const queryCall = mockQuery.mock.calls[0];
      expect(queryCall[1]).toContain('community-123');
      expect(queryCall[1]).toContain('2026-02-01');
      expect(queryCall[1]).toContain('2026-02-28');
    });
  });
});
