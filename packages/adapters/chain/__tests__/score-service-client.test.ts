/**
 * Score Service Client Tests
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * Tests for the ScoreServiceClient and MockScoreServiceClient.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScoreServiceClient, MockScoreServiceClient } from '../score-service-client.js';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Test Setup
// --------------------------------------------------------------------------

const createMockLogger = (): Logger => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
}) as unknown as Logger;

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ScoreServiceClient', () => {
  let client: ScoreServiceClient;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    mockFetch.mockReset();
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  describe('initialization', () => {
    it('should initialize with required config', () => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
      });

      expect(client.getCircuitState()).toBe('closed');
      expect(client.isConnected()).toBe(false); // Not healthy until first check
    });

    it('should merge config with defaults', () => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        timeoutMs: 10000, // Override
      });

      const stats = client.getStats();
      expect(stats.circuitState).toBe('closed');
    });
  });

  describe('getRankedHolders', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        maxRetries: 0, // No retries for predictable tests
      });
    });

    it('should return ranked holders on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          holders: [
            { address: '0x1', rank: 1, score: '1000', balance: '1000000' },
            { address: '0x2', rank: 2, score: '900', balance: '900000' },
          ],
          totalCount: 100,
          computedAt: Date.now(),
        }),
      });

      const response = await client.getRankedHolders({
        communityId: 'guild-123',
        assetType: 'token',
        contractAddress: '0xtoken',
        chainId: '80094',
        limit: 10,
      });

      expect(response.holders).toHaveLength(2);
      expect(response.holders[0]!.rank).toBe(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:50051/v1/ranked-holders',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should throw on server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        client.getRankedHolders({
          communityId: 'guild-123',
          assetType: 'token',
          contractAddress: '0xtoken',
          chainId: '80094',
          limit: 10,
        })
      ).rejects.toThrow('Score Service error: 500');
    });
  });

  describe('getAddressRank', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        maxRetries: 0,
      });
    });

    it('should return address rank on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rank: 42,
          score: '850.5',
          totalHolders: 1000,
          found: true,
        }),
      });

      const response = await client.getAddressRank({
        communityId: 'guild-123',
        address: '0xuser',
        assetType: 'token',
        contractAddress: '0xtoken',
        chainId: '80094',
      });

      expect(response.rank).toBe(42);
      expect(response.found).toBe(true);
    });

    it('should return found=false for unranked address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          rank: 0,
          score: '0',
          totalHolders: 1000,
          found: false,
        }),
      });

      const response = await client.getAddressRank({
        communityId: 'guild-123',
        address: '0xunknown',
        assetType: 'token',
        contractAddress: '0xtoken',
        chainId: '80094',
      });

      expect(response.found).toBe(false);
      expect(response.rank).toBe(0);
    });
  });

  describe('checkActionHistory', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        maxRetries: 0,
      });
    });

    it('should return action history on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPerformed: true,
          count: 5,
          lastPerformedAt: Date.now() - 86400000,
        }),
      });

      const response = await client.checkActionHistory({
        address: '0xuser',
        action: 'swap',
      });

      expect(response.hasPerformed).toBe(true);
      expect(response.count).toBe(5);
    });
  });

  describe('getCrossChainScore', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        maxRetries: 0,
      });
    });

    it('should return cross-chain score on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          address: '0xuser',
          totalScore: '3000',
          chainScores: [
            { chainId: '1', score: '1000' },
            { chainId: '137', score: '1000' },
            { chainId: '80094', score: '1000' },
          ],
          computedAt: Date.now(),
        }),
      });

      const response = await client.getCrossChainScore({
        address: '0xuser',
        chainIds: ['1', '137', '80094'],
      });

      expect(response.totalScore).toBe('3000');
      expect(response.chainScores).toHaveLength(3);
    });
  });

  describe('healthCheck', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        maxRetries: 0,
      });
    });

    it('should return SERVING when healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'SERVING',
          message: 'OK',
        }),
      });

      const response = await client.healthCheck();

      expect(response.status).toBe('SERVING');
      expect(client.getStats().isHealthy).toBe(true);
    });

    it('should return NOT_SERVING on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const response = await client.healthCheck();

      expect(response.status).toBe('NOT_SERVING');
      expect(client.getStats().isHealthy).toBe(false);
    });
  });

  describe('circuit breaker', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
        maxRetries: 0,
        volumeThreshold: 2, // Low threshold for testing
        errorThresholdPercentage: 50,
      });
    });

    it('should track circuit state', () => {
      expect(client.getCircuitState()).toBe('closed');
    });

    it('should record stats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ holders: [], totalCount: 0, computedAt: Date.now() }),
      });

      await client.getRankedHolders({
        communityId: 'test',
        assetType: 'token',
        contractAddress: '0x',
        chainId: '1',
        limit: 10,
      });

      const stats = client.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.successfulRequests).toBe(1);
    });
  });

  describe('stats management', () => {
    beforeEach(() => {
      client = new ScoreServiceClient(logger, {
        endpoint: 'http://localhost:50051',
      });
    });

    it('should reset stats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ holders: [], totalCount: 0, computedAt: Date.now() }),
      });

      await client.getRankedHolders({
        communityId: 'test',
        assetType: 'token',
        contractAddress: '0x',
        chainId: '1',
        limit: 10,
      });

      client.resetStats();

      const stats = client.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
    });
  });
});

describe('MockScoreServiceClient', () => {
  let client: MockScoreServiceClient;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    client = new MockScoreServiceClient(logger);
  });

  describe('getRankedHolders', () => {
    it('should return deterministic holders', async () => {
      const response = await client.getRankedHolders({
        communityId: 'test',
        assetType: 'token',
        contractAddress: '0x',
        chainId: '80094',
        limit: 5,
      });

      expect(response.holders).toHaveLength(5);
      expect(response.holders[0]!.rank).toBe(1);
      expect(response.totalCount).toBe(100);
    });
  });

  describe('getAddressRank', () => {
    it('should return deterministic rank based on address', async () => {
      const response = await client.getAddressRank({
        communityId: 'test',
        address: '0x0000000000000000000000000000000000000001',
        assetType: 'token',
        contractAddress: '0x',
        chainId: '80094',
      });

      expect(response.found).toBe(true);
      expect(response.rank).toBeGreaterThan(0);
    });
  });

  describe('checkActionHistory', () => {
    it('should return deterministic result', async () => {
      const response = await client.checkActionHistory({
        address: '0x0000000000000000000000000000000000000000',
        action: 'swap',
      });

      // Address ending in 0 (even) should have performed
      expect(response.hasPerformed).toBe(true);
    });
  });

  describe('getCrossChainScore', () => {
    it('should aggregate scores across chains', async () => {
      const response = await client.getCrossChainScore({
        address: '0xuser',
        chainIds: ['1', '137'],
      });

      expect(response.chainScores).toHaveLength(2);
      expect(BigInt(response.totalScore)).toBeGreaterThan(0n);
    });
  });

  describe('healthCheck', () => {
    it('should return SERVING when connected', async () => {
      const response = await client.healthCheck();
      expect(response.status).toBe('SERVING');
    });

    it('should return NOT_SERVING when disconnected', async () => {
      client.setConnected(false);
      const response = await client.healthCheck();
      expect(response.status).toBe('NOT_SERVING');
    });
  });

  describe('test helpers', () => {
    it('should allow setting failure mode', async () => {
      client.setFailure(true);

      await expect(
        client.getRankedHolders({
          communityId: 'test',
          assetType: 'token',
          contractAddress: '0x',
          chainId: '80094',
          limit: 10,
        })
      ).rejects.toThrow('Mock Score Service failure');
    });

    it('should allow setting circuit state', () => {
      client.setCircuitState('open');
      expect(client.getCircuitState()).toBe('open');
    });

    it('should allow setting latency', async () => {
      client.setLatency(1);
      const start = Date.now();

      await client.healthCheck();

      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(1);
    });
  });

  describe('close', () => {
    it('should mark as disconnected on close', async () => {
      await client.close();
      expect(client.isConnected()).toBe(false);
    });
  });
});
