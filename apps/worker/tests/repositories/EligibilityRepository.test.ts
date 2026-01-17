/**
 * Eligibility Repository Tests
 * Sprint S-8: ScyllaDB Integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { EligibilityRepository } from '../../src/repositories/EligibilityRepository.js';
import type { ScyllaClient } from '../../src/infrastructure/scylla/scylla-client.js';
import type { StateManager } from '../../src/services/StateManager.js';
import type { EligibilitySnapshot } from '../../src/infrastructure/scylla/types.js';
import type { TenantRequestContext } from '../../src/services/TenantContext.js';
import type { EligibilityRule, EligibilityChecker } from '../../src/repositories/EligibilityRepository.js';

// Mock ScyllaClient
const createMockScyllaClient = () => ({
  getEligibilitySnapshot: vi.fn(),
  saveEligibilitySnapshot: vi.fn(),
});

// Mock StateManager
const createMockStateManager = () => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
});

const logger = pino({ level: 'silent' });

const createTestContext = (communityId = 'test-community'): TenantRequestContext => ({
  communityId,
  guildId: 'guild-123',
  userId: 'user-456',
  tier: 'enterprise',
  config: {
    communityId,
    guildId: 'guild-123',
    tier: 'enterprise',
    features: {
      customBranding: true,
      advancedAnalytics: true,
      prioritySupport: true,
      unlimitedCommands: true,
    },
    rateLimits: {
      commandsPerMinute: -1,
      eligibilityChecksPerHour: -1,
      syncRequestsPerDay: -1,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  requestId: 'req-test',
  startTime: Date.now(),
});

const testRule: EligibilityRule = {
  ruleId: 'rule-1',
  contractAddress: '0x1234567890abcdef',
  minBalance: '1000000000000000000',
  chainId: 1,
};

const mockChecker: EligibilityChecker = vi.fn();

describe('EligibilityRepository', () => {
  let mockScylla: ReturnType<typeof createMockScyllaClient>;
  let mockState: ReturnType<typeof createMockStateManager>;
  let repo: EligibilityRepository;

  beforeEach(() => {
    mockScylla = createMockScyllaClient();
    mockState = createMockStateManager();
    repo = new EligibilityRepository(
      mockScylla as unknown as ScyllaClient,
      mockState as unknown as StateManager,
      logger,
      300_000 // 5 min cache TTL
    );
    vi.clearAllMocks();
  });

  describe('checkEligibility', () => {
    it('should return cached result from Redis (L1)', async () => {
      const ctx = createTestContext();
      const snapshot: EligibilitySnapshot = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        walletAddress: '0xwallet',
        ruleId: 'rule-1',
        isEligible: true,
        tokenBalance: '1000000000000000000',
        checkedAt: new Date(),
        blockNumber: BigInt(12345),
      };

      mockState.get.mockResolvedValue(JSON.stringify({
        ...snapshot,
        blockNumber: snapshot.blockNumber.toString(),
      }));

      const result = await repo.checkEligibility(
        ctx,
        { profileId: 'profile-1', walletAddress: '0xwallet', ruleId: 'rule-1' },
        testRule,
        mockChecker
      );

      expect(result.isEligible).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(mockChecker).not.toHaveBeenCalled();
      expect(mockScylla.getEligibilitySnapshot).not.toHaveBeenCalled();
    });

    it('should return cached result from ScyllaDB (L2) and warm Redis', async () => {
      const ctx = createTestContext();
      const snapshot: EligibilitySnapshot = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        walletAddress: '0xwallet',
        ruleId: 'rule-1',
        isEligible: true,
        tokenBalance: '1000000000000000000',
        checkedAt: new Date(),
        blockNumber: BigInt(12345),
      };

      mockState.get.mockResolvedValue(null); // Redis miss
      mockScylla.getEligibilitySnapshot.mockResolvedValue(snapshot);

      const result = await repo.checkEligibility(
        ctx,
        { profileId: 'profile-1', walletAddress: '0xwallet', ruleId: 'rule-1' },
        testRule,
        mockChecker
      );

      expect(result.isEligible).toBe(true);
      expect(result.fromCache).toBe(true);
      expect(mockState.set).toHaveBeenCalled(); // Redis warmed
      expect(mockChecker).not.toHaveBeenCalled();
    });

    it('should perform fresh check on cache miss', async () => {
      const ctx = createTestContext();

      mockState.get.mockResolvedValue(null);
      mockScylla.getEligibilitySnapshot.mockResolvedValue(null);
      (mockChecker as ReturnType<typeof vi.fn>).mockResolvedValue({
        isEligible: true,
        balance: '2000000000000000000',
        blockNumber: BigInt(12346),
      });

      const result = await repo.checkEligibility(
        ctx,
        { profileId: 'profile-1', walletAddress: '0xwallet', ruleId: 'rule-1' },
        testRule,
        mockChecker
      );

      expect(result.isEligible).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(result.tokenBalance).toBe('2000000000000000000');
      expect(mockChecker).toHaveBeenCalledWith('0xwallet', testRule);
      expect(mockState.set).toHaveBeenCalled(); // Saved to Redis
      expect(mockScylla.saveEligibilitySnapshot).toHaveBeenCalled(); // Saved to ScyllaDB
    });

    it('should check freshness based on TTL', async () => {
      const ctx = createTestContext();
      const oldSnapshot: EligibilitySnapshot = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        walletAddress: '0xwallet',
        ruleId: 'rule-1',
        isEligible: true,
        tokenBalance: '1000000000000000000',
        checkedAt: new Date(Date.now() - 400_000), // 6+ minutes old (expired)
        blockNumber: BigInt(12345),
      };

      mockState.get.mockResolvedValue(JSON.stringify({
        ...oldSnapshot,
        blockNumber: oldSnapshot.blockNumber.toString(),
      }));
      mockScylla.getEligibilitySnapshot.mockResolvedValue(oldSnapshot);
      (mockChecker as ReturnType<typeof vi.fn>).mockResolvedValue({
        isEligible: false,
        balance: '0',
        blockNumber: BigInt(12350),
      });

      const result = await repo.checkEligibility(
        ctx,
        { profileId: 'profile-1', walletAddress: '0xwallet', ruleId: 'rule-1' },
        testRule,
        mockChecker
      );

      // Should have performed fresh check since cache expired
      expect(result.fromCache).toBe(false);
      expect(result.isEligible).toBe(false);
      expect(mockChecker).toHaveBeenCalled();
    });
  });

  describe('batchCheckEligibility', () => {
    it('should use cache for cached entries and check uncached', async () => {
      const ctx = createTestContext();

      // First request is cached
      mockState.get
        .mockResolvedValueOnce(JSON.stringify({
          communityId: ctx.communityId,
          profileId: 'profile-1',
          walletAddress: '0xwallet1',
          ruleId: 'rule-1',
          isEligible: true,
          tokenBalance: '1000',
          checkedAt: new Date(),
          blockNumber: '12345',
        }))
        .mockResolvedValueOnce(null); // Second is not cached

      (mockChecker as ReturnType<typeof vi.fn>).mockResolvedValue({
        isEligible: false,
        balance: '0',
        blockNumber: BigInt(12346),
      });

      const results = await repo.batchCheckEligibility(
        ctx,
        [
          { profileId: 'profile-1', walletAddress: '0xwallet1', ruleId: 'rule-1' },
          { profileId: 'profile-2', walletAddress: '0xwallet2', ruleId: 'rule-1' },
        ],
        testRule,
        mockChecker
      );

      expect(results).toHaveLength(2);

      // First result from cache
      const cachedResult = results.find((r) => r.profileId === 'profile-1');
      expect(cachedResult?.fromCache).toBe(true);
      expect(cachedResult?.isEligible).toBe(true);

      // Second result from fresh check
      const freshResult = results.find((r) => r.profileId === 'profile-2');
      expect(freshResult?.fromCache).toBe(false);
      expect(freshResult?.isEligible).toBe(false);
    });
  });

  describe('invalidateCache', () => {
    it('should delete Redis cache for specific rule', async () => {
      const ctx = createTestContext();

      await repo.invalidateCache(ctx, 'profile-1', 'rule-1');

      expect(mockState.delete).toHaveBeenCalledWith(
        `eligibility:${ctx.communityId}:profile-1:rule-1`
      );
    });
  });

  describe('getCachedSnapshot', () => {
    it('should return Redis cached snapshot if available', async () => {
      const ctx = createTestContext();
      const snapshot = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        walletAddress: '0xwallet',
        ruleId: 'rule-1',
        isEligible: true,
        tokenBalance: '1000',
        checkedAt: new Date().toISOString(),
        blockNumber: '12345',
      };

      mockState.get.mockResolvedValue(JSON.stringify(snapshot));

      const result = await repo.getCachedSnapshot(ctx, 'profile-1', 'rule-1');

      expect(result).not.toBeNull();
      expect(result?.isEligible).toBe(true);
      expect(mockScylla.getEligibilitySnapshot).not.toHaveBeenCalled();
    });

    it('should fallback to ScyllaDB if Redis cache miss', async () => {
      const ctx = createTestContext();
      const snapshot: EligibilitySnapshot = {
        communityId: ctx.communityId,
        profileId: 'profile-1',
        walletAddress: '0xwallet',
        ruleId: 'rule-1',
        isEligible: true,
        tokenBalance: '1000',
        checkedAt: new Date(),
        blockNumber: BigInt(12345),
      };

      mockState.get.mockResolvedValue(null);
      mockScylla.getEligibilitySnapshot.mockResolvedValue(snapshot);

      const result = await repo.getCachedSnapshot(ctx, 'profile-1', 'rule-1');

      expect(result).toEqual(snapshot);
      expect(mockScylla.getEligibilitySnapshot).toHaveBeenCalled();
    });
  });
});
