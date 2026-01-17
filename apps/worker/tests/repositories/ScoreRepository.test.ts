/**
 * Score Repository Tests
 * Sprint S-8: ScyllaDB Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { ScoreRepository } from '../../src/repositories/ScoreRepository.js';
import type { ScyllaClient } from '../../src/infrastructure/scylla/scylla-client.js';
import type { Score, ScoreHistoryEntry } from '../../src/infrastructure/scylla/types.js';
import type { TenantRequestContext } from '../../src/services/TenantContext.js';

// Mock ScyllaClient
const createMockScyllaClient = () => ({
  getScore: vi.fn(),
  updateScore: vi.fn(),
  batchUpdateScores: vi.fn(),
  recordScoreHistory: vi.fn(),
  getScoreHistory: vi.fn(),
});

// Mock logger
const logger = pino({ level: 'silent' });

// Test tenant context
const createTestContext = (communityId = 'test-community'): TenantRequestContext => ({
  communityId,
  guildId: 'guild-123',
  userId: 'user-456',
  tier: 'free',
  config: {
    communityId,
    guildId: 'guild-123',
    tier: 'free',
    features: {
      customBranding: false,
      advancedAnalytics: false,
      prioritySupport: false,
      unlimitedCommands: false,
    },
    rateLimits: {
      commandsPerMinute: 10,
      eligibilityChecksPerHour: 100,
      syncRequestsPerDay: 1,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  requestId: 'req-test',
  startTime: Date.now(),
});

describe('ScoreRepository', () => {
  let mockScylla: ReturnType<typeof createMockScyllaClient>;
  let repo: ScoreRepository;

  beforeEach(() => {
    mockScylla = createMockScyllaClient();
    repo = new ScoreRepository(mockScylla as unknown as ScyllaClient, logger);
    vi.clearAllMocks();
  });

  describe('getScore', () => {
    it('should return score when found', async () => {
      const ctx = createTestContext();
      const expectedScore: Score = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        convictionScore: '100.5',
        activityScore: '50.25',
        currentRank: 5,
        updatedAt: new Date(),
      };

      mockScylla.getScore.mockResolvedValue(expectedScore);

      const result = await repo.getScore(ctx, 'profile-1');

      expect(result).toEqual(expectedScore);
      expect(mockScylla.getScore).toHaveBeenCalledWith(ctx.communityId, 'profile-1');
    });

    it('should return null when not found', async () => {
      const ctx = createTestContext();
      mockScylla.getScore.mockResolvedValue(null);

      const result = await repo.getScore(ctx, 'profile-unknown');

      expect(result).toBeNull();
    });

    it('should throw on ScyllaDB error', async () => {
      const ctx = createTestContext();
      mockScylla.getScore.mockRejectedValue(new Error('Connection failed'));

      await expect(repo.getScore(ctx, 'profile-1')).rejects.toThrow('Connection failed');
    });
  });

  describe('getScores', () => {
    it('should return map of scores for multiple profiles', async () => {
      const ctx = createTestContext();
      const score1: Score = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        convictionScore: '100',
        activityScore: '50',
        currentRank: 1,
        updatedAt: new Date(),
      };
      const score2: Score = {
        communityId: ctx.communityId,
        profileId: 'profile-2',
        convictionScore: '200',
        activityScore: '100',
        currentRank: 2,
        updatedAt: new Date(),
      };

      mockScylla.getScore
        .mockResolvedValueOnce(score1)
        .mockResolvedValueOnce(score2)
        .mockResolvedValueOnce(null);

      const result = await repo.getScores(ctx, ['profile-1', 'profile-2', 'profile-3']);

      expect(result.size).toBe(2);
      expect(result.get('profile-1')).toEqual(score1);
      expect(result.get('profile-2')).toEqual(score2);
      expect(result.has('profile-3')).toBe(false);
    });
  });

  describe('updateScore', () => {
    it('should update existing score with delta', async () => {
      const ctx = createTestContext();
      const existingScore: Score = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        convictionScore: '100',
        activityScore: '50',
        currentRank: 5,
        updatedAt: new Date(),
      };

      mockScylla.getScore.mockResolvedValue(existingScore);
      mockScylla.updateScore.mockResolvedValue(undefined);
      mockScylla.recordScoreHistory.mockResolvedValue(undefined);

      const result = await repo.updateScore(ctx, {
        profileId: 'profile-1',
        convictionDelta: '25.5',
        eventType: 'token_hold',
      });

      expect(result.convictionScore).toBe('125.5');
      expect(result.activityScore).toBe('50');
      expect(mockScylla.updateScore).toHaveBeenCalled();
      expect(mockScylla.recordScoreHistory).toHaveBeenCalled();
    });

    it('should create new score when none exists', async () => {
      const ctx = createTestContext();

      mockScylla.getScore.mockResolvedValue(null);
      mockScylla.updateScore.mockResolvedValue(undefined);
      mockScylla.recordScoreHistory.mockResolvedValue(undefined);

      const result = await repo.updateScore(ctx, {
        profileId: 'new-profile',
        convictionDelta: '50',
        activityDelta: '25',
        eventType: 'migration',
      });

      expect(result.communityId).toBe(ctx.communityId);
      expect(result.profileId).toBe('new-profile');
      expect(result.convictionScore).toBe('50');
      expect(result.activityScore).toBe('25');
    });
  });

  describe('batchUpdateScores', () => {
    it('should batch update multiple scores', async () => {
      const ctx = createTestContext();

      mockScylla.getScore.mockResolvedValue(null);
      mockScylla.batchUpdateScores.mockResolvedValue({ success: 2, failed: 0, errors: [] });

      const result = await repo.batchUpdateScores(ctx, [
        { profileId: 'p1', convictionDelta: '10', eventType: 'token_hold' },
        { profileId: 'p2', convictionDelta: '20', eventType: 'token_hold' },
      ]);

      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('getScoreHistory', () => {
    it('should return score history entries', async () => {
      const ctx = createTestContext();
      const history: ScoreHistoryEntry[] = [
        {
          communityId: ctx.communityId,
          profileId: 'profile-1',
          day: '2026-01-15',
          eventTime: new Date(),
          scoreBefore: '90',
          scoreAfter: '100',
          delta: '10',
          eventType: 'token_hold',
        },
      ];

      mockScylla.getScoreHistory.mockResolvedValue(history);

      const result = await repo.getScoreHistory(ctx, 'profile-1', 30);

      expect(result).toEqual(history);
      expect(mockScylla.getScoreHistory).toHaveBeenCalledWith(ctx.communityId, 'profile-1', 30);
    });
  });
});
