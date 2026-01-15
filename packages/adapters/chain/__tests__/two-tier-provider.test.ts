/**
 * Two-Tier Chain Provider Tests
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * Integration tests for the TwoTierChainProvider orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TwoTierChainProvider,
  InMemoryCache,
  type EligibilityRule,
} from '../two-tier-provider.js';
import { MockScoreServiceClient } from '../score-service-client.js';
import { TestMetrics } from '../metrics.js';
import type { NativeBlockchainReader } from '../native-reader.js';
import type { Address, ChainId } from '../../../core/ports/chain-provider.js';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Test Setup
// --------------------------------------------------------------------------

const createMockLogger = (): Logger =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as Logger;

const createMockNativeReader = (): NativeBlockchainReader => {
  const mock = {
    hasBalance: vi.fn().mockResolvedValue(true),
    ownsNFT: vi.fn().mockResolvedValue(true),
    getBalance: vi.fn().mockResolvedValue(1000000000000000000n),
    getNativeBalance: vi.fn().mockResolvedValue(5000000000000000000n),
    getRankedHolders: vi.fn().mockRejectedValue(new Error('Tier 2 only')),
    getAddressRank: vi.fn().mockRejectedValue(new Error('Tier 2 only')),
    checkActionHistory: vi.fn().mockRejectedValue(new Error('Tier 2 only')),
    getCrossChainScore: vi.fn().mockRejectedValue(new Error('Tier 2 only')),
    isScoreServiceAvailable: vi.fn().mockResolvedValue(false),
    getSupportedChains: vi.fn().mockReturnValue([80094, 1, 137]),
  };
  return mock as unknown as NativeBlockchainReader;
};

describe('TwoTierChainProvider', () => {
  let provider: TwoTierChainProvider;
  let nativeReader: NativeBlockchainReader;
  let scoreClient: MockScoreServiceClient;
  let cache: InMemoryCache;
  let metrics: TestMetrics;
  let logger: Logger;

  const testAddress: Address = '0x1234567890123456789012345678901234567890';
  const testContract: Address = '0xabcdef1234567890123456789012345678901234';

  beforeEach(() => {
    logger = createMockLogger();
    nativeReader = createMockNativeReader();
    scoreClient = new MockScoreServiceClient(logger);
    cache = new InMemoryCache();
    metrics = new TestMetrics();

    provider = new TwoTierChainProvider(
      nativeReader,
      scoreClient,
      cache,
      metrics,
      logger
    );
  });

  describe('initialization', () => {
    it('should initialize with all dependencies', () => {
      expect(provider.getScoreServiceCircuitState()).toBe('closed');
      expect(provider.getNativeReader()).toBe(nativeReader);
      expect(provider.getScoreServiceClient()).toBe(scoreClient);
    });
  });

  describe('checkBasicEligibility', () => {
    describe('token_balance rule', () => {
      it('should check token balance via native reader', async () => {
        const rule: EligibilityRule = {
          id: 'rule-1',
          communityId: 'guild-123',
          ruleType: 'token_balance',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            minAmount: '1000000000000000000', // 1 token
          },
        };

        const result = await provider.checkBasicEligibility(rule, testAddress);

        expect(result.eligible).toBe(true);
        expect(result.source).toBe('native');
        expect(result.confidence).toBe(1.0);
        expect(nativeReader.hasBalance).toHaveBeenCalledWith(
          80094,
          testAddress,
          testContract,
          1000000000000000000n
        );
      });

      it('should return not eligible when balance insufficient', async () => {
        vi.mocked(nativeReader.hasBalance).mockResolvedValue(false);

        const rule: EligibilityRule = {
          id: 'rule-2',
          communityId: 'guild-123',
          ruleType: 'token_balance',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            minAmount: '100000000000000000000', // 100 tokens
          },
        };

        const result = await provider.checkBasicEligibility(rule, testAddress);

        expect(result.eligible).toBe(false);
        expect(result.source).toBe('native');
      });
    });

    describe('nft_ownership rule', () => {
      it('should check NFT ownership via native reader', async () => {
        const rule: EligibilityRule = {
          id: 'rule-3',
          communityId: 'guild-123',
          ruleType: 'nft_ownership',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {},
        };

        const result = await provider.checkBasicEligibility(rule, testAddress);

        expect(result.eligible).toBe(true);
        expect(result.source).toBe('native');
        expect(nativeReader.ownsNFT).toHaveBeenCalledWith(
          80094,
          testAddress,
          testContract,
          undefined
        );
      });

      it('should check specific token ID ownership', async () => {
        const rule: EligibilityRule = {
          id: 'rule-4',
          communityId: 'guild-123',
          ruleType: 'nft_ownership',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            tokenId: '42',
          },
        };

        await provider.checkBasicEligibility(rule, testAddress);

        expect(nativeReader.ownsNFT).toHaveBeenCalledWith(
          80094,
          testAddress,
          testContract,
          42n
        );
      });
    });

    describe('unsupported rule types', () => {
      it('should throw for score_threshold rule', async () => {
        const rule: EligibilityRule = {
          id: 'rule-5',
          communityId: 'guild-123',
          ruleType: 'score_threshold',
          chainId: 80094,
          contractAddress: testContract,
          parameters: { maxRank: 100 },
        };

        await expect(
          provider.checkBasicEligibility(rule, testAddress)
        ).rejects.toThrow("Basic eligibility doesn't support rule type");
      });
    });

    it('should record metrics on check', async () => {
      const rule: EligibilityRule = {
        id: 'rule-6',
        communityId: 'guild-123',
        ruleType: 'token_balance',
        chainId: 80094,
        contractAddress: testContract,
        parameters: { minAmount: '1' },
      };

      await provider.checkBasicEligibility(rule, testAddress);

      expect(metrics.eligibilityChecks).toHaveLength(1);
      expect(metrics.eligibilityChecks[0]!.ruleType).toBe('token_balance');
      expect(metrics.eligibilityChecks[0]!.source).toBe('native');
    });
  });

  describe('checkAdvancedEligibility', () => {
    describe('delegates to checkBasicEligibility', () => {
      it('should delegate token_balance to basic check', async () => {
        const rule: EligibilityRule = {
          id: 'rule-7',
          communityId: 'guild-123',
          ruleType: 'token_balance',
          chainId: 80094,
          contractAddress: testContract,
          parameters: { minAmount: '1' },
        };

        const result = await provider.checkAdvancedEligibility(rule, testAddress);

        expect(result.source).toBe('native');
        expect(nativeReader.hasBalance).toHaveBeenCalled();
      });

      it('should delegate nft_ownership to basic check', async () => {
        const rule: EligibilityRule = {
          id: 'rule-8',
          communityId: 'guild-123',
          ruleType: 'nft_ownership',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {},
        };

        const result = await provider.checkAdvancedEligibility(rule, testAddress);

        expect(result.source).toBe('native');
      });
    });

    describe('score_threshold rule', () => {
      it('should use Score Service for rank check', async () => {
        const rule: EligibilityRule = {
          id: 'rule-9',
          communityId: 'guild-123',
          ruleType: 'score_threshold',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            assetType: 'token',
            maxRank: 100,
          },
        };

        // Use address that will be found (rank <= 50)
        const address: Address = '0x0000000000000000000000000000000000000010';
        const result = await provider.checkAdvancedEligibility(rule, address);

        expect(result.source).toBe('score_service');
        expect(result.confidence).toBe(1.0);
        expect(result.details.rank).toBeDefined();
      });

      it('should return not eligible when rank exceeds maxRank', async () => {
        const rule: EligibilityRule = {
          id: 'rule-10',
          communityId: 'guild-123',
          ruleType: 'score_threshold',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            assetType: 'token',
            maxRank: 5, // Very restrictive
          },
        };

        // Use address that will have high rank
        const address: Address = '0x00000000000000000000000000000000000000ff';
        const result = await provider.checkAdvancedEligibility(rule, address);

        // MockScoreServiceClient returns rank based on last 2 chars
        // 0xff % 100 + 1 = 256 % 100 + 1 = 57, but found = false for rank > 50
        expect(result.eligible).toBe(false);
      });
    });

    describe('activity_check rule', () => {
      it('should use Score Service for activity check', async () => {
        const rule: EligibilityRule = {
          id: 'rule-11',
          communityId: 'guild-123',
          ruleType: 'activity_check',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            actionType: 'swap',
          },
        };

        // Address ending in even digit has performed
        const address: Address = '0x0000000000000000000000000000000000000010';
        const result = await provider.checkAdvancedEligibility(rule, address);

        expect(result.source).toBe('score_service');
        expect(result.eligible).toBe(true);
      });
    });

    describe('degradation (Score Service unavailable)', () => {
      beforeEach(() => {
        scoreClient.setFailure(true);
      });

      it('should fall back to native reader for score_threshold', async () => {
        const rule: EligibilityRule = {
          id: 'rule-12',
          communityId: 'guild-123',
          ruleType: 'score_threshold',
          chainId: 80094,
          contractAddress: testContract,
          parameters: {
            assetType: 'token',
            maxRank: 100,
          },
        };

        const result = await provider.checkAdvancedEligibility(rule, testAddress);

        expect(result.source).toBe('native_degraded');
        expect(result.confidence).toBe(0.5); // Degraded confidence
        expect(nativeReader.hasBalance).toHaveBeenCalledWith(
          80094,
          testAddress,
          testContract,
          1n // Any balance check
        );
      });

      it('should record degradation metrics', async () => {
        const rule: EligibilityRule = {
          id: 'rule-13',
          communityId: 'guild-123',
          ruleType: 'score_threshold',
          chainId: 80094,
          contractAddress: testContract,
          parameters: { assetType: 'token', maxRank: 100 },
        };

        await provider.checkAdvancedEligibility(rule, testAddress);

        expect(metrics.degradations).toHaveLength(1);
        expect(metrics.degradations[0]!.ruleType).toBe('score_threshold');
      });

      it('should deny activity_check when not cached', async () => {
        const rule: EligibilityRule = {
          id: 'rule-14',
          communityId: 'guild-123',
          ruleType: 'activity_check',
          chainId: 80094,
          contractAddress: testContract,
          parameters: { actionType: 'swap' },
        };

        const result = await provider.checkAdvancedEligibility(rule, testAddress);

        expect(result.source).toBe('native_degraded');
        expect(result.eligible).toBe(false); // Deny when no cache
        expect(result.confidence).toBe(0.0);
      });

      it('should use cached activity check result when available', async () => {
        // Pre-populate cache
        await cache.set(`activity:${testAddress}:swap`, true);

        const rule: EligibilityRule = {
          id: 'rule-15',
          communityId: 'guild-123',
          ruleType: 'activity_check',
          chainId: 80094,
          contractAddress: testContract,
          parameters: { actionType: 'swap' },
        };

        const result = await provider.checkAdvancedEligibility(rule, testAddress);

        expect(result.source).toBe('native_degraded');
        expect(result.eligible).toBe(true); // Cached value
        expect(result.confidence).toBe(0.8); // Higher confidence from cache
      });
    });
  });

  describe('Tier 1 IChainProvider methods', () => {
    it('should delegate hasBalance to native reader', async () => {
      await provider.hasBalance(80094, testAddress, testContract, 1000n);
      expect(nativeReader.hasBalance).toHaveBeenCalled();
    });

    it('should delegate ownsNFT to native reader', async () => {
      await provider.ownsNFT(80094, testAddress, testContract, 42n);
      expect(nativeReader.ownsNFT).toHaveBeenCalled();
    });

    it('should delegate getBalance to native reader', async () => {
      const balance = await provider.getBalance(80094, testAddress, testContract);
      expect(balance).toBe(1000000000000000000n);
    });

    it('should delegate getNativeBalance to native reader', async () => {
      const balance = await provider.getNativeBalance(80094, testAddress);
      expect(balance).toBe(5000000000000000000n);
    });
  });

  describe('Tier 2 IChainProvider methods', () => {
    it('should get ranked holders via Score Service', async () => {
      const holders = await provider.getRankedHolders(
        { type: 'token', contractAddress: testContract, chainId: 80094 },
        10
      );

      expect(holders).toHaveLength(10);
      expect(holders[0]!.rank).toBe(1);
    });

    it('should get address rank via Score Service', async () => {
      // Use address that will be found
      const address: Address = '0x0000000000000000000000000000000000000001';
      const rank = await provider.getAddressRank(address, {
        type: 'token',
        contractAddress: testContract,
        chainId: 80094,
      });

      expect(rank).toBeGreaterThan(0);
    });

    it('should check action history via Score Service', async () => {
      // Address ending in even digit
      const address: Address = '0x0000000000000000000000000000000000000010';
      const hasPerformed = await provider.checkActionHistory(address, {
        action: 'swap',
      });

      expect(hasPerformed).toBe(true);
    });

    it('should get cross-chain score via Score Service', async () => {
      const score = await provider.getCrossChainScore(testAddress, [80094, 1]);

      expect(score.chainScores).toBeDefined();
      expect(BigInt(score.totalScore)).toBeGreaterThan(0n);
    });
  });

  describe('service status', () => {
    it('should check Score Service availability', async () => {
      const available = await provider.isScoreServiceAvailable();
      expect(available).toBe(true); // MockScoreServiceClient defaults to healthy
    });

    it('should return false when Score Service unhealthy', async () => {
      scoreClient.setConnected(false);
      const available = await provider.isScoreServiceAvailable();
      expect(available).toBe(false);
    });

    it('should return supported chains from native reader', () => {
      const chains = provider.getSupportedChains();
      expect(chains).toEqual([80094, 1, 137]);
    });
  });
});

describe('InMemoryCache', () => {
  let cache: InMemoryCache;

  beforeEach(() => {
    cache = new InMemoryCache();
  });

  it('should store and retrieve values', async () => {
    await cache.set('key1', 'value1');
    const value = await cache.get<string>('key1');
    expect(value).toBe('value1');
  });

  it('should return null for missing keys', async () => {
    const value = await cache.get<string>('nonexistent');
    expect(value).toBeNull();
  });

  it('should expire entries after TTL', async () => {
    await cache.set('key2', 'value2', { ttl: 1 }); // 1ms TTL
    await new Promise((r) => setTimeout(r, 5));
    const value = await cache.get<string>('key2');
    expect(value).toBeNull();
  });

  it('should clear all entries', async () => {
    await cache.set('key3', 'value3');
    await cache.set('key4', 'value4');
    cache.clear();
    expect(await cache.get('key3')).toBeNull();
    expect(await cache.get('key4')).toBeNull();
  });
});
