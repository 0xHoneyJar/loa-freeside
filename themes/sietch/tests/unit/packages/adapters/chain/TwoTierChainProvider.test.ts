/**
 * TwoTierChainProvider Unit Tests
 *
 * Sprint 35: Score Service Adapter & Two-Tier Orchestration
 *
 * Tests orchestration, degradation modes, caching, and failover behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Address } from 'viem';
import { TwoTierChainProvider } from '../../../../../src/packages/adapters/chain/TwoTierChainProvider.js';
import type {
  INativeReader,
  IScoreService,
  TokenSpec,
  ScoreData,
  LeaderboardEntry,
} from '../../../../../src/packages/core/ports/IChainProvider.js';

// Mock implementations
function createMockNativeReader(overrides: Partial<INativeReader> = {}): INativeReader {
  return {
    hasBalance: vi.fn().mockResolvedValue(true),
    ownsNFT: vi.fn().mockResolvedValue(true),
    getBalance: vi.fn().mockResolvedValue(1000n),
    getNFTBalance: vi.fn().mockResolvedValue(1n),
    isHealthy: vi.fn().mockResolvedValue(true),
    getCurrentBlock: vi.fn().mockResolvedValue(1000000n),
    ...overrides,
  };
}

function createMockScoreData(address: Address): ScoreData {
  return {
    address,
    rank: 5,
    convictionScore: 850,
    activityScore: 75,
    totalBgtHeld: 1000000000000000000000n,
    totalBgtClaimed: 1500000000000000000000n,
    totalBgtBurned: 500000000000000000000n,
    timeWeightedBalance: 800000000000000000000n,
    firstClaimAt: new Date('2024-01-15T10:30:00Z'),
    lastActivityAt: new Date('2024-06-15T14:45:00Z'),
    updatedAt: new Date('2024-06-15T15:00:00Z'),
  };
}

interface MockScoreService extends IScoreService {
  getCircuitBreakerState: () => 'closed' | 'open' | 'half-open';
}

function createMockScoreService(overrides: Partial<MockScoreService> = {}): MockScoreService {
  return {
    getScore: vi.fn().mockImplementation((address: Address) =>
      Promise.resolve(createMockScoreData(address))
    ),
    getScores: vi.fn().mockResolvedValue(new Map()),
    getLeaderboard: vi.fn().mockResolvedValue([] as LeaderboardEntry[]),
    getRank: vi.fn().mockResolvedValue(5),
    isHealthy: vi.fn().mockResolvedValue(true),
    getLastUpdate: vi.fn().mockResolvedValue(new Date()),
    getCircuitBreakerState: vi.fn().mockReturnValue('closed'),
    ...overrides,
  };
}

describe('TwoTierChainProvider', () => {
  let provider: TwoTierChainProvider;
  let mockNativeReader: INativeReader;
  let mockScoreService: MockScoreService;

  const testAddress = '0x1234567890123456789012345678901234567890' as Address;
  const testToken: TokenSpec = {
    type: 'erc20',
    address: '0xbDa130737BDd9618301681329bF2e46A016ff9Ad' as Address,
    chainId: 80084,
  };

  beforeEach(() => {
    mockNativeReader = createMockNativeReader();
    mockScoreService = createMockScoreService();
    provider = new TwoTierChainProvider(mockNativeReader, mockScoreService, 300);
  });

  describe('constructor', () => {
    it('should create provider with native reader and score service', () => {
      expect(provider).toBeDefined();
      expect(provider.getNativeReader()).toBe(mockNativeReader);
      expect(provider.getScoreService()).toBe(mockScoreService);
    });
  });

  describe('checkBasicEligibility', () => {
    describe('balance checks', () => {
      it('should return eligible when balance meets requirement', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockResolvedValue(true);
        vi.mocked(mockNativeReader.getBalance).mockResolvedValue(1000n);

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 500n },
        });

        expect(result.eligible).toBe(true);
        expect(result.source).toBe('native');
        expect(result.context?.balance).toBe(1000n);
      });

      it('should return ineligible when balance is insufficient', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockResolvedValue(false);
        vi.mocked(mockNativeReader.getBalance).mockResolvedValue(100n);

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 500n },
        });

        expect(result.eligible).toBe(false);
        expect(result.source).toBe('native');
        expect(result.context?.balance).toBe(100n);
      });

      it('should handle zero balance requirement', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockResolvedValue(true);
        vi.mocked(mockNativeReader.getBalance).mockResolvedValue(0n);

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 0n },
        });

        expect(result.eligible).toBe(true);
      });
    });

    describe('NFT ownership checks', () => {
      it('should return eligible when user owns NFT', async () => {
        vi.mocked(mockNativeReader.ownsNFT).mockResolvedValue(true);

        const result = await provider.checkBasicEligibility(testAddress, {
          nftOwnership: {
            collection: '0xNFTCollection' as Address,
            chainId: 80084,
          },
        });

        expect(result.eligible).toBe(true);
        expect(result.source).toBe('native');
        expect(result.context?.ownsNft).toBe(true);
      });

      it('should return ineligible when user does not own NFT', async () => {
        vi.mocked(mockNativeReader.ownsNFT).mockResolvedValue(false);

        const result = await provider.checkBasicEligibility(testAddress, {
          nftOwnership: {
            collection: '0xNFTCollection' as Address,
            chainId: 80084,
          },
        });

        expect(result.eligible).toBe(false);
        expect(result.source).toBe('native');
        expect(result.context?.ownsNft).toBe(false);
      });

      it('should check specific token IDs', async () => {
        vi.mocked(mockNativeReader.ownsNFT).mockResolvedValue(true);

        await provider.checkBasicEligibility(testAddress, {
          nftOwnership: {
            collection: '0xNFTCollection' as Address,
            chainId: 80084,
            tokenIds: [1n, 2n, 3n],
          },
        });

        expect(mockNativeReader.ownsNFT).toHaveBeenCalledWith(
          testAddress,
          '0xNFTCollection',
          80084,
          [1n, 2n, 3n]
        );
      });
    });

    describe('combined criteria', () => {
      it('should check both balance and NFT ownership', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockResolvedValue(true);
        vi.mocked(mockNativeReader.ownsNFT).mockResolvedValue(true);
        vi.mocked(mockNativeReader.getBalance).mockResolvedValue(1000n);

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 500n },
          nftOwnership: {
            collection: '0xNFTCollection' as Address,
            chainId: 80084,
          },
        });

        expect(result.eligible).toBe(true);
        expect(mockNativeReader.hasBalance).toHaveBeenCalled();
        expect(mockNativeReader.ownsNFT).toHaveBeenCalled();
      });

      it('should fail if balance check fails even if NFT check passes', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockResolvedValue(false);
        vi.mocked(mockNativeReader.getBalance).mockResolvedValue(100n);
        vi.mocked(mockNativeReader.ownsNFT).mockResolvedValue(true);

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 500n },
          nftOwnership: {
            collection: '0xNFTCollection' as Address,
            chainId: 80084,
          },
        });

        expect(result.eligible).toBe(false);
      });
    });

    describe('error handling', () => {
      it('should return degraded result on error', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockRejectedValue(
          new Error('RPC error')
        );

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 500n },
        });

        expect(result.eligible).toBe(false);
        expect(result.source).toBe('degraded');
        expect(result.error).toBe('RPC error');
      });

      it('should handle unknown errors', async () => {
        vi.mocked(mockNativeReader.hasBalance).mockRejectedValue('Unknown');

        const result = await provider.checkBasicEligibility(testAddress, {
          minBalance: { token: testToken, amount: 500n },
        });

        expect(result.eligible).toBe(false);
        expect(result.source).toBe('degraded');
        expect(result.error).toBe('Unknown error');
      });
    });
  });

  describe('checkAdvancedEligibility', () => {
    describe('rank checks', () => {
      it('should return eligible when rank is within range', async () => {
        const result = await provider.checkAdvancedEligibility(testAddress, {
          minRank: 10, // User is rank 5, which is better (lower)
        });

        expect(result.eligible).toBe(true);
        expect(result.context?.rank).toBe(5);
      });

      it('should return ineligible when rank exceeds minRank', async () => {
        vi.mocked(mockScoreService.getScore).mockResolvedValue({
          ...createMockScoreData(testAddress),
          rank: 15,
        });

        const result = await provider.checkAdvancedEligibility(testAddress, {
          minRank: 10, // User is rank 15, fails min 10
        });

        expect(result.eligible).toBe(false);
        expect(result.context?.rank).toBe(15);
      });

      it('should support maxRank requirement', async () => {
        vi.mocked(mockScoreService.getScore).mockResolvedValue({
          ...createMockScoreData(testAddress),
          rank: 3,
        });

        const result = await provider.checkAdvancedEligibility(testAddress, {
          maxRank: 5, // User rank 3 is higher (lower number), fails max 5
        });

        expect(result.eligible).toBe(false);
      });
    });

    describe('conviction score checks', () => {
      it('should return eligible when conviction score meets requirement', async () => {
        const result = await provider.checkAdvancedEligibility(testAddress, {
          minConvictionScore: 800, // User has 850
        });

        expect(result.eligible).toBe(true);
      });

      it('should return ineligible when conviction score is insufficient', async () => {
        vi.mocked(mockScoreService.getScore).mockResolvedValue({
          ...createMockScoreData(testAddress),
          convictionScore: 500,
        });

        const result = await provider.checkAdvancedEligibility(testAddress, {
          minConvictionScore: 800,
        });

        expect(result.eligible).toBe(false);
      });
    });

    describe('activity score checks', () => {
      it('should check activity score requirement', async () => {
        const result = await provider.checkAdvancedEligibility(testAddress, {
          minActivityScore: 50, // User has 75
        });

        expect(result.eligible).toBe(true);
      });

      it('should fail when activity score is insufficient', async () => {
        vi.mocked(mockScoreService.getScore).mockResolvedValue({
          ...createMockScoreData(testAddress),
          activityScore: 30,
        });

        const result = await provider.checkAdvancedEligibility(testAddress, {
          minActivityScore: 50,
        });

        expect(result.eligible).toBe(false);
      });
    });

    describe('time-weighted requirements', () => {
      it('should check minimum holding days', async () => {
        const result = await provider.checkAdvancedEligibility(testAddress, {
          timeWeighted: {
            minHoldingDays: 30,
            minAverageBalance: 100n,
          },
        });

        // User has firstClaimAt in January 2024, so > 30 days
        expect(result.eligible).toBe(true);
      });

      it('should fail when holding period is insufficient', async () => {
        vi.mocked(mockScoreService.getScore).mockResolvedValue({
          ...createMockScoreData(testAddress),
          firstClaimAt: new Date(), // Just now
        });

        const result = await provider.checkAdvancedEligibility(testAddress, {
          timeWeighted: {
            minHoldingDays: 30,
            minAverageBalance: 100n,
          },
        });

        expect(result.eligible).toBe(false);
      });
    });

    describe('score service failure', () => {
      it('should return degraded result when score service fails', async () => {
        vi.mocked(mockScoreService.getScore).mockRejectedValue(
          new Error('Service unavailable')
        );

        const result = await provider.checkAdvancedEligibility(testAddress, {
          minRank: 10,
        });

        expect(result.eligible).toBe(false);
        expect(result.source).toBe('degraded');
        expect(result.error).toContain('unavailable');
      });
    });
  });

  describe('caching', () => {
    it('should cache score data on successful fetch', async () => {
      await provider.checkAdvancedEligibility(testAddress, { minRank: 10 });

      // Second call should use cached data when score service fails
      vi.mocked(mockScoreService.getScore).mockRejectedValue(
        new Error('Service down')
      );
      // Circuit breaker is now open
      vi.mocked(mockScoreService.getCircuitBreakerState).mockReturnValue('open');

      const result = await provider.checkAdvancedEligibility(testAddress, {
        minRank: 10,
      });

      // Should succeed using cache (circuit breaker open = cached mode)
      expect(result.eligible).toBe(true);
      expect(result.source).toBe('cached');
    });

    it('should use stale cache when service is down', async () => {
      // First fetch succeeds
      await provider.getScoreData(testAddress);

      // Service goes down
      vi.mocked(mockScoreService.getScore).mockRejectedValue(
        new Error('Service down')
      );
      vi.mocked(mockScoreService.isHealthy).mockResolvedValue(false);
      vi.mocked(mockScoreService.getCircuitBreakerState).mockReturnValue('open');

      // Should still get data from cache
      const result = await provider.getScoreData(testAddress);

      expect(result).not.toBeNull();
      expect(result?.rank).toBe(5);
    });

    it('should clear cache when requested', async () => {
      await provider.getScoreData(testAddress);

      const statsBefore = provider.getCacheStats();
      expect(statsBefore.size).toBe(1);

      provider.clearCache();

      const statsAfter = provider.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });

    it('should provide cache statistics', async () => {
      const stats = provider.getCacheStats();

      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('oldestEntryAge');
      expect(stats).toHaveProperty('newestEntryAge');
    });
  });

  describe('getStatus', () => {
    it('should return full mode when both tiers are healthy', async () => {
      vi.mocked(mockNativeReader.isHealthy).mockResolvedValue(true);
      vi.mocked(mockScoreService.isHealthy).mockResolvedValue(true);
      vi.mocked(mockScoreService.getCircuitBreakerState).mockReturnValue('closed');

      const status = await provider.getStatus();

      expect(status.mode).toBe('full');
      expect(status.nativeHealthy).toBe(true);
      expect(status.scoreHealthy).toBe(true);
      expect(status.circuitBreakerState).toBe('closed');
    });

    it('should return partial mode when score service is down', async () => {
      vi.mocked(mockNativeReader.isHealthy).mockResolvedValue(true);
      vi.mocked(mockScoreService.isHealthy).mockResolvedValue(false);

      const status = await provider.getStatus();

      expect(status.mode).toBe('partial');
      expect(status.nativeHealthy).toBe(true);
      expect(status.scoreHealthy).toBe(false);
    });

    it('should return cached mode when circuit breaker is open', async () => {
      vi.mocked(mockNativeReader.isHealthy).mockResolvedValue(true);
      vi.mocked(mockScoreService.isHealthy).mockResolvedValue(true);
      vi.mocked(mockScoreService.getCircuitBreakerState).mockReturnValue('open');

      const status = await provider.getStatus();

      expect(status.mode).toBe('cached');
      expect(status.circuitBreakerState).toBe('open');
    });

    it('should track last score success timestamp', async () => {
      await provider.getScoreData(testAddress);

      const status = await provider.getStatus();

      expect(status.lastScoreSuccess).toBeInstanceOf(Date);
    });

    it('should calculate cache age', async () => {
      await provider.getScoreData(testAddress);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const status = await provider.getStatus();

      expect(status.cacheAgeSeconds).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getNativeReader', () => {
    it('should return the underlying native reader', () => {
      const reader = provider.getNativeReader();
      expect(reader).toBe(mockNativeReader);
    });
  });

  describe('getScoreService', () => {
    it('should return the underlying score service', () => {
      const service = provider.getScoreService();
      expect(service).toBe(mockScoreService);
    });
  });

  describe('degradation matrix (PRD §3.1)', () => {
    it('should handle Tier 1 only (partial degradation)', async () => {
      vi.mocked(mockNativeReader.isHealthy).mockResolvedValue(true);
      vi.mocked(mockScoreService.isHealthy).mockResolvedValue(false);

      // Basic eligibility should work
      const basicResult = await provider.checkBasicEligibility(testAddress, {
        minBalance: { token: testToken, amount: 100n },
      });
      expect(basicResult.source).toBe('native');
      expect(basicResult.eligible).toBe(true);

      // Advanced eligibility should fail gracefully
      vi.mocked(mockScoreService.getScore).mockRejectedValue(
        new Error('Service down')
      );
      const advancedResult = await provider.checkAdvancedEligibility(testAddress, {
        minRank: 10,
      });
      expect(advancedResult.source).toBe('degraded');
    });

    it('should handle cached fallback during circuit breaker open', async () => {
      // Populate cache
      await provider.getScoreData(testAddress);

      // Circuit breaker opens
      vi.mocked(mockScoreService.getCircuitBreakerState).mockReturnValue('open');
      vi.mocked(mockScoreService.getScore).mockRejectedValue(
        new Error('Circuit open')
      );

      const result = await provider.checkAdvancedEligibility(testAddress, {
        minRank: 10,
      });

      expect(result.source).toBe('cached');
      expect(result.eligible).toBe(true);
    });
  });
});
