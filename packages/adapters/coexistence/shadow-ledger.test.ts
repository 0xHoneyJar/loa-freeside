/**
 * ScyllaDBShadowLedger Tests
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Tests for the ScyllaDB-backed shadow ledger implementation.
 *
 * @see SDD §7.1.3 Shadow Ledger Schema
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pino } from 'pino';
import {
  ScyllaDBShadowLedger,
  createScyllaDBShadowLedger,
  type IScyllaClient,
} from './shadow-ledger.js';
import type {
  ShadowMemberState,
  ShadowDivergence,
  ShadowPrediction,
  IncumbentState,
  ArrakisEligibilityResult,
} from '@arrakis/core/domain';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockLogger = pino({ level: 'silent' });

function createMockScyllaClient(
  executeResult: { rows: Record<string, unknown>[] } = { rows: [] }
): IScyllaClient {
  return {
    execute: vi.fn().mockResolvedValue(executeResult),
    batch: vi.fn().mockResolvedValue(undefined),
  };
}

function createMemberState(
  guildId: string,
  userId: string,
  overrides: Partial<ShadowMemberState> = {}
): ShadowMemberState {
  return {
    guildId,
    userId,
    incumbentRoles: new Set(['role-1', 'role-2']),
    arrakisEligible: true,
    arrakisTier: 'holder',
    convictionScore: 0.85,
    divergenceFlag: false,
    lastSyncAt: new Date('2024-01-15T12:00:00Z'),
    ...overrides,
  };
}

function createMemberStateRow(state: ShadowMemberState): Record<string, unknown> {
  return {
    guild_id: state.guildId,
    user_id: state.userId,
    incumbent_roles: Array.from(state.incumbentRoles),
    arrakis_eligible: state.arrakisEligible,
    arrakis_tier: state.arrakisTier,
    conviction_score: state.convictionScore,
    divergence_flag: state.divergenceFlag,
    last_sync_at: state.lastSyncAt.toISOString(),
  };
}

function createDivergenceRow(
  guildId: string,
  userId: string,
  detectedAt: Date,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    guild_id: guildId,
    user_id: userId,
    detected_at: detectedAt.toISOString(),
    incumbent_state: JSON.stringify({ hasRole: true, roles: ['role-1'] }),
    arrakis_state: JSON.stringify({ eligible: false, tier: null, score: 0 }),
    divergence_type: 'false_positive',
    resolved: false,
    resolved_at: null,
    ...overrides,
  };
}

function createPredictionRow(
  predictionId: string,
  guildId: string,
  userId: string,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    prediction_id: predictionId,
    guild_id: guildId,
    user_id: userId,
    predicted_at: new Date().toISOString(),
    prediction_type: 'role_grant',
    predicted_value: 'holder',
    verified_at: null,
    actual_value: null,
    correct: null,
    ...overrides,
  };
}

// =============================================================================
// Shadow Member State Tests
// =============================================================================

describe('ScyllaDBShadowLedger', () => {
  describe('getMemberState', () => {
    it('should return member state when found', async () => {
      const state = createMemberState('guild-1', 'user-1');
      const mockScylla = createMockScyllaClient({
        rows: [createMemberStateRow(state)],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getMemberState('guild-1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.guildId).toBe('guild-1');
      expect(result!.userId).toBe('user-1');
      expect(result!.arrakisEligible).toBe(true);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['guild-1', 'user-1'],
        { prepare: true }
      );
    });

    it('should return null when not found', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getMemberState('guild-1', 'user-1');

      expect(result).toBeNull();
    });
  });

  describe('getGuildStates', () => {
    it('should return all member states for guild', async () => {
      const states = [
        createMemberState('guild-1', 'user-1'),
        createMemberState('guild-1', 'user-2'),
      ];
      const mockScylla = createMockScyllaClient({
        rows: states.map(createMemberStateRow),
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getGuildStates('guild-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.userId).toBe('user-1');
      expect(result[1]!.userId).toBe('user-2');
    });

    it('should respect limit parameter', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      await ledger.getGuildStates('guild-1', 500);

      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        ['guild-1', 500],
        { prepare: true }
      );
    });
  });

  describe('getDivergentMembers', () => {
    it('should return only divergent members', async () => {
      const divergent = createMemberState('guild-1', 'user-1', { divergenceFlag: true });
      const mockScylla = createMockScyllaClient({
        rows: [createMemberStateRow(divergent)],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getDivergentMembers('guild-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.divergenceFlag).toBe(true);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('divergence_flag = true'),
        ['guild-1'],
        { prepare: true }
      );
    });
  });

  describe('saveMemberState', () => {
    it('should save member state', async () => {
      const mockScylla = createMockScyllaClient();
      const state = createMemberState('guild-1', 'user-1');

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.saveMemberState(state);

      expect(result).toEqual(state);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO shadow_member_state'),
        expect.arrayContaining(['guild-1', 'user-1']),
        { prepare: true }
      );
    });
  });

  describe('saveMemberStates (batch)', () => {
    it('should batch save multiple states', async () => {
      const mockScylla = createMockScyllaClient();
      const states = [
        createMemberState('guild-1', 'user-1'),
        createMemberState('guild-1', 'user-2'),
        createMemberState('guild-1', 'user-3'),
      ];

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const count = await ledger.saveMemberStates(states);

      expect(count).toBe(3);
      expect(mockScylla.batch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ query: expect.stringContaining('INSERT') }),
        ]),
        { prepare: true }
      );
    });

    it('should return 0 for empty array', async () => {
      const mockScylla = createMockScyllaClient();

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const count = await ledger.saveMemberStates([]);

      expect(count).toBe(0);
      expect(mockScylla.batch).not.toHaveBeenCalled();
    });
  });

  describe('deleteMemberState', () => {
    it('should delete member state', async () => {
      const mockScylla = createMockScyllaClient();

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.deleteMemberState('guild-1', 'user-1');

      expect(result).toBe(true);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM shadow_member_state'),
        ['guild-1', 'user-1'],
        { prepare: true }
      );
    });
  });

  describe('deleteGuildStates', () => {
    it('should delete all guild states and return count', async () => {
      const mockScylla = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ count: 15 }] }) // COUNT query
          .mockResolvedValueOnce({ rows: [] }), // DELETE query
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const count = await ledger.deleteGuildStates('guild-1');

      expect(count).toBe(15);
      expect(mockScylla.execute).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Divergence Recording Tests
  // ===========================================================================

  describe('recordDivergence', () => {
    it('should record false_positive divergence', async () => {
      const mockScylla = createMockScyllaClient();

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);

      const incumbentState: IncumbentState = {
        hasRole: true,
        roles: ['role-1'],
      };

      const arrakisResult: ArrakisEligibilityResult = {
        eligible: false,
        tier: null,
        score: 0,
      };

      const result = await ledger.recordDivergence(
        'guild-1',
        'user-1',
        incumbentState,
        arrakisResult
      );

      expect(result.divergenceType).toBe('false_positive');
      expect(result.resolved).toBe(false);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO shadow_divergences'),
        expect.arrayContaining(['guild-1', 'user-1']),
        { prepare: true }
      );
    });

    it('should record false_negative divergence', async () => {
      const mockScylla = createMockScyllaClient();

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);

      const incumbentState: IncumbentState = {
        hasRole: false,
        roles: [],
      };

      const arrakisResult: ArrakisEligibilityResult = {
        eligible: true,
        tier: 'holder',
        score: 0.85,
      };

      const result = await ledger.recordDivergence(
        'guild-1',
        'user-1',
        incumbentState,
        arrakisResult
      );

      expect(result.divergenceType).toBe('false_negative');
    });
  });

  describe('getDivergences', () => {
    it('should query divergences with filters', async () => {
      const mockScylla = createMockScyllaClient({
        rows: [createDivergenceRow('guild-1', 'user-1', new Date())],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getDivergences({
        guildId: 'guild-1',
        divergenceType: 'false_positive',
        resolved: false,
        limit: 10,
      });

      expect(result).toHaveLength(1);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('divergence_type = ?'),
        expect.arrayContaining(['guild-1', 'false_positive', false]),
        { prepare: true }
      );
    });

    it('should return empty array when no matches', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getDivergences({ guildId: 'guild-1' });

      expect(result).toEqual([]);
    });
  });

  describe('resolveDivergence', () => {
    it('should mark divergence as resolved', async () => {
      const detectedAt = new Date('2024-01-15T12:00:00Z');
      const mockScylla = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [createDivergenceRow('guild-1', 'user-1', detectedAt, {
            resolved: true,
            resolved_at: new Date().toISOString(),
          })] }), // SELECT
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.resolveDivergence('guild-1', 'user-1', detectedAt);

      expect(result).not.toBeNull();
      expect(result!.resolved).toBe(true);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE shadow_divergences'),
        expect.arrayContaining(['guild-1', 'user-1', detectedAt]),
        { prepare: true }
      );
    });

    it('should return null when divergence not found', async () => {
      const mockScylla = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [] }) // UPDATE
          .mockResolvedValueOnce({ rows: [] }), // SELECT returns empty
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.resolveDivergence('guild-1', 'user-1', new Date());

      expect(result).toBeNull();
    });
  });

  describe('getDivergenceCounts', () => {
    it('should return counts by type', async () => {
      const mockScylla = createMockScyllaClient({
        rows: [
          { divergence_type: 'false_positive', count: 10 },
          { divergence_type: 'false_negative', count: 5 },
        ],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const counts = await ledger.getDivergenceCounts('guild-1');

      expect(counts.false_positive).toBe(10);
      expect(counts.false_negative).toBe(5);
    });

    it('should filter by since date', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });
      const since = new Date('2024-01-01');

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      await ledger.getDivergenceCounts('guild-1', since);

      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('detected_at >= ?'),
        expect.arrayContaining(['guild-1', since]),
        { prepare: true }
      );
    });
  });

  // ===========================================================================
  // Prediction Tracking Tests
  // ===========================================================================

  describe('recordPrediction', () => {
    it('should record prediction with UUID', async () => {
      const mockScylla = createMockScyllaClient();

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.recordPrediction(
        'guild-1',
        'user-1',
        'role_grant',
        'holder'
      );

      expect(result.predictionId).toBeDefined();
      expect(result.predictionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(result.predictionType).toBe('role_grant');
      expect(result.predictedValue).toBe('holder');
      expect(result.verifiedAt).toBeNull();
      expect(result.correct).toBeNull();
    });
  });

  describe('getPredictions', () => {
    it('should query predictions with filters', async () => {
      const mockScylla = createMockScyllaClient({
        rows: [createPredictionRow('pred-1', 'guild-1', 'user-1')],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getPredictions({
        guildId: 'guild-1',
        predictionType: 'role_grant',
        verified: false,
        limit: 10,
      });

      expect(result).toHaveLength(1);
    });

    it('should filter by correct flag', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      await ledger.getPredictions({ guildId: 'guild-1', correct: true });

      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('correct = ?'),
        expect.arrayContaining(['guild-1', true]),
        { prepare: true }
      );
    });
  });

  describe('getUnverifiedPredictions', () => {
    it('should return only unverified predictions', async () => {
      const mockScylla = createMockScyllaClient({
        rows: [createPredictionRow('pred-1', 'guild-1', 'user-1')],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.getUnverifiedPredictions('guild-1');

      expect(result).toHaveLength(1);
      expect(mockScylla.execute).toHaveBeenCalledWith(
        expect.stringContaining('verified_at IS NULL'),
        ['guild-1'],
        { prepare: true }
      );
    });
  });

  describe('verifyPrediction', () => {
    it('should mark prediction as correct when values match', async () => {
      const mockScylla = {
        execute: vi.fn()
          .mockResolvedValueOnce({
            rows: [createPredictionRow('pred-1', 'guild-1', 'user-1', {
              predicted_value: 'holder',
            })],
          }) // Find
          .mockResolvedValueOnce({ rows: [] }), // Update
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.verifyPrediction('pred-1', 'holder');

      expect(result).not.toBeNull();
      expect(result!.correct).toBe(true);
      expect(result!.actualValue).toBe('holder');
    });

    it('should mark prediction as incorrect when values differ', async () => {
      const mockScylla = {
        execute: vi.fn()
          .mockResolvedValueOnce({
            rows: [createPredictionRow('pred-1', 'guild-1', 'user-1', {
              predicted_value: 'holder',
            })],
          }) // Find
          .mockResolvedValueOnce({ rows: [] }), // Update
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.verifyPrediction('pred-1', 'whale');

      expect(result).not.toBeNull();
      expect(result!.correct).toBe(false);
      expect(result!.actualValue).toBe('whale');
    });

    it('should return null when prediction not found', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const result = await ledger.verifyPrediction('nonexistent', 'holder');

      expect(result).toBeNull();
    });
  });

  describe('verifyPredictions (batch)', () => {
    it('should verify multiple predictions', async () => {
      const callCount = { n: 0 };
      const mockScylla = {
        execute: vi.fn().mockImplementation(() => {
          callCount.n++;
          if (callCount.n % 2 === 1) {
            // Find query
            return Promise.resolve({
              rows: [createPredictionRow('pred-1', 'guild-1', 'user-1', {
                predicted_value: 'holder',
              })],
            });
          }
          // Update query
          return Promise.resolve({ rows: [] });
        }),
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const count = await ledger.verifyPredictions([
        { predictionId: 'pred-1', actualValue: 'holder' },
        { predictionId: 'pred-2', actualValue: 'whale' },
      ]);

      expect(count).toBe(2);
    });
  });

  // ===========================================================================
  // Accuracy Calculation Tests
  // ===========================================================================

  describe('calculateAccuracy', () => {
    it('should calculate accuracy from verified predictions', async () => {
      const mockScylla = createMockScyllaClient({
        rows: [
          { correct: true },
          { correct: true },
          { correct: true },
          { correct: false },
          { correct: true },
        ],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const accuracy = await ledger.calculateAccuracy(
        'guild-1',
        new Date('2024-01-01'),
        new Date('2024-01-31')
      );

      expect(accuracy).toBe(0.8); // 4/5
    });

    it('should return 0 for no predictions', async () => {
      const mockScylla = createMockScyllaClient({ rows: [] });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const accuracy = await ledger.calculateAccuracy(
        'guild-1',
        new Date('2024-01-01')
      );

      expect(accuracy).toBe(0);
    });
  });

  describe('getAccuracyTrend', () => {
    it('should return accuracy trend over time', async () => {
      let callIndex = 0;
      const mockScylla = {
        execute: vi.fn().mockImplementation(() => {
          callIndex++;
          // Different accuracies for different time periods
          if (callIndex === 1) {
            return Promise.resolve({
              rows: [{ correct: true }, { correct: true }], // 100%
            });
          }
          if (callIndex === 2) {
            return Promise.resolve({
              rows: [{ correct: true }, { correct: false }], // 50%
            });
          }
          return Promise.resolve({
            rows: [{ correct: true }, { correct: true }, { correct: true }], // 100%
          });
        }),
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const trend = await ledger.getAccuracyTrend('guild-1', 7, 3);

      expect(trend).toHaveLength(3);
      expect(trend[0]!.accuracy).toBe(1.0);
      expect(trend[1]!.accuracy).toBe(0.5);
      expect(trend[2]!.accuracy).toBe(1.0);
    });
  });

  // ===========================================================================
  // Stats & Analytics Tests
  // ===========================================================================

  describe('getStats', () => {
    it('should aggregate guild statistics', async () => {
      let callIndex = 0;
      const mockScylla = {
        execute: vi.fn().mockImplementation(() => {
          callIndex++;
          if (callIndex === 1) {
            // Member stats
            return Promise.resolve({
              rows: [{ total: 100, divergent: 5 }],
            });
          }
          if (callIndex === 2) {
            // Prediction stats
            return Promise.resolve({
              rows: [{ total: 200, verified: 150, correct: 142 }],
            });
          }
          // Last sync
          return Promise.resolve({
            rows: [{ last_sync: '2024-01-15T12:00:00Z' }],
          });
        }),
        batch: vi.fn(),
      };

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const stats = await ledger.getStats('guild-1');

      expect(stats.totalMembers).toBe(100);
      expect(stats.divergentMembers).toBe(5);
      expect(stats.divergenceRate).toBeCloseTo(0.05);
      expect(stats.totalPredictions).toBe(200);
      expect(stats.verifiedPredictions).toBe(150);
      expect(stats.accuracy).toBeCloseTo(142 / 150);
    });

    it('should handle empty guild gracefully', async () => {
      const mockScylla = createMockScyllaClient({
        rows: [{ total: 0, divergent: 0, verified: 0, correct: 0 }],
      });

      const ledger = new ScyllaDBShadowLedger(mockScylla, mockLogger);
      const stats = await ledger.getStats('empty-guild');

      expect(stats.totalMembers).toBe(0);
      expect(stats.divergenceRate).toBe(0);
      expect(stats.accuracy).toBe(0);
    });
  });

  // ===========================================================================
  // Factory Function Tests
  // ===========================================================================

  describe('createScyllaDBShadowLedger', () => {
    it('should create ScyllaDBShadowLedger instance', () => {
      const mockScylla = createMockScyllaClient();
      const ledger = createScyllaDBShadowLedger(mockScylla, mockLogger);

      expect(ledger).toBeInstanceOf(ScyllaDBShadowLedger);
    });
  });
});
