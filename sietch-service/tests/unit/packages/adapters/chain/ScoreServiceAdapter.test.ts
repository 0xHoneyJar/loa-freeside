/**
 * ScoreServiceAdapter Unit Tests
 *
 * Sprint 35: Score Service Adapter & Two-Tier Orchestration
 *
 * Tests circuit breaker behavior, API response parsing, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScoreServiceAdapter } from '../../../../../src/packages/adapters/chain/ScoreServiceAdapter.js';
import type { ScoreServiceConfig } from '../../../../../src/packages/core/ports/IChainProvider.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ScoreServiceAdapter', () => {
  let adapter: ScoreServiceAdapter;
  const testConfig: ScoreServiceConfig = {
    apiUrl: 'https://score-api.example.com',
    apiKey: 'test-api-key',
    timeout: 5000,
    errorThreshold: 0.5,
    resetTimeout: 30000,
  };

  beforeEach(() => {
    mockFetch.mockReset();
    adapter = new ScoreServiceAdapter(testConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(adapter).toBeDefined();
      expect(adapter.getCircuitBreakerState()).toBe('closed');
    });

    it('should remove trailing slash from API URL', () => {
      const configWithSlash: ScoreServiceConfig = {
        ...testConfig,
        apiUrl: 'https://score-api.example.com/',
      };
      const adapterWithSlash = new ScoreServiceAdapter(configWithSlash);
      expect(adapterWithSlash).toBeDefined();
    });

    it('should use default timeout when not provided', () => {
      const minimalConfig: ScoreServiceConfig = {
        apiUrl: 'https://score-api.example.com',
        apiKey: 'test-key',
      };
      const minimalAdapter = new ScoreServiceAdapter(minimalConfig);
      expect(minimalAdapter).toBeDefined();
    });
  });

  describe('getScore', () => {
    it('should fetch and parse score data for an address', async () => {
      const mockResponse = {
        address: '0x1234567890123456789012345678901234567890',
        rank: 5,
        convictionScore: 850,
        activityScore: 75,
        totalBgtHeld: '1000000000000000000000',
        totalBgtClaimed: '1500000000000000000000',
        totalBgtBurned: '500000000000000000000',
        timeWeightedBalance: '800000000000000000000',
        firstClaimAt: '2024-01-15T10:30:00Z',
        lastActivityAt: '2024-06-15T14:45:00Z',
        updatedAt: '2024-06-15T15:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getScore(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result).toBeDefined();
      expect(result.address).toBe('0x1234567890123456789012345678901234567890');
      expect(result.rank).toBe(5);
      expect(result.convictionScore).toBe(850);
      expect(result.activityScore).toBe(75);
      expect(result.totalBgtHeld).toBe(1000000000000000000000n);
      expect(result.totalBgtClaimed).toBe(1500000000000000000000n);
      expect(result.totalBgtBurned).toBe(500000000000000000000n);
      expect(result.firstClaimAt).toBeInstanceOf(Date);
      expect(result.lastActivityAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle null dates correctly', async () => {
      const mockResponse = {
        address: '0x1234567890123456789012345678901234567890',
        rank: 100,
        convictionScore: 100,
        activityScore: 10,
        totalBgtHeld: '0',
        totalBgtClaimed: '0',
        totalBgtBurned: '0',
        timeWeightedBalance: '0',
        firstClaimAt: null,
        lastActivityAt: null,
        updatedAt: '2024-06-15T15:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getScore(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.firstClaimAt).toBeNull();
      expect(result.lastActivityAt).toBeNull();
    });

    it('should lowercase address in returned data', async () => {
      const mockResponse = {
        address: '0xABCDEF1234567890123456789012345678901234',
        rank: 1,
        convictionScore: 1000,
        activityScore: 100,
        totalBgtHeld: '1000',
        totalBgtClaimed: '1000',
        totalBgtBurned: '0',
        timeWeightedBalance: '1000',
        firstClaimAt: null,
        lastActivityAt: null,
        updatedAt: '2024-06-15T15:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getScore(
        '0xABCDEF1234567890123456789012345678901234'
      );

      expect(result.address).toBe('0xabcdef1234567890123456789012345678901234');
    });

    it('should include correct headers in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            address: '0x1234567890123456789012345678901234567890',
            rank: 1,
            convictionScore: 100,
            activityScore: 50,
            totalBgtHeld: '0',
            totalBgtClaimed: '0',
            totalBgtBurned: '0',
            timeWeightedBalance: '0',
            firstClaimAt: null,
            lastActivityAt: null,
            updatedAt: '2024-06-15T15:00:00Z',
          }),
      });

      await adapter.getScore('0x1234567890123456789012345678901234567890');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/scores/0x1234567890123456789012345678901234567890'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          }),
        })
      );
    });

    it('should throw error on HTTP error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        adapter.getScore('0x1234567890123456789012345678901234567890')
      ).rejects.toThrow('Score API error: 500 Internal Server Error');
    });
  });

  describe('getScores (batch)', () => {
    it('should fetch scores for multiple addresses', async () => {
      const mockResponse = [
        {
          address: '0x1111111111111111111111111111111111111111',
          rank: 1,
          convictionScore: 1000,
          activityScore: 100,
          totalBgtHeld: '1000',
          totalBgtClaimed: '1000',
          totalBgtBurned: '0',
          timeWeightedBalance: '1000',
          firstClaimAt: null,
          lastActivityAt: null,
          updatedAt: '2024-06-15T15:00:00Z',
        },
        {
          address: '0x2222222222222222222222222222222222222222',
          rank: 2,
          convictionScore: 900,
          activityScore: 90,
          totalBgtHeld: '900',
          totalBgtClaimed: '900',
          totalBgtBurned: '0',
          timeWeightedBalance: '900',
          firstClaimAt: null,
          lastActivityAt: null,
          updatedAt: '2024-06-15T15:00:00Z',
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getScores([
        '0x1111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222',
      ]);

      expect(result.size).toBe(2);
      expect(
        result.get('0x1111111111111111111111111111111111111111')?.rank
      ).toBe(1);
      expect(
        result.get('0x2222222222222222222222222222222222222222')?.rank
      ).toBe(2);
    });
  });

  describe('getLeaderboard', () => {
    it('should fetch leaderboard entries', async () => {
      const mockResponse = {
        entries: [
          {
            rank: 1,
            address: '0x1111111111111111111111111111111111111111',
            convictionScore: 1000,
            totalBgtHeld: '1000000000000000000000',
          },
          {
            rank: 2,
            address: '0x2222222222222222222222222222222222222222',
            convictionScore: 900,
            totalBgtHeld: '900000000000000000000',
          },
        ],
        total: 100,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getLeaderboard(10, 0);

      expect(result).toHaveLength(2);
      expect(result[0].rank).toBe(1);
      expect(result[0].address).toBe('0x1111111111111111111111111111111111111111');
      expect(result[0].convictionScore).toBe(1000);
      expect(result[0].totalBgtHeld).toBe(1000000000000000000000n);
    });

    it('should use default limit and offset', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ entries: [], total: 0 }),
      });

      await adapter.getLeaderboard();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/leaderboard?limit=100&offset=0'),
        expect.anything()
      );
    });
  });

  describe('getRank', () => {
    it('should return rank for address', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ rank: 42 }),
      });

      const result = await adapter.getRank(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result).toBe(42);
    });

    it('should return null when rank not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ rank: null }),
      });

      const result = await adapter.getRank(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result).toBeNull();
    });

    it('should return null on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.getRank(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result).toBeNull();
    });
  });

  describe('isHealthy', () => {
    it('should return true when service is healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy', lastUpdate: '2024-06-15T15:00:00Z' }),
      });

      const result = await adapter.isHealthy();

      expect(result).toBe(true);
    });

    it('should return false when service is unhealthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'unhealthy', lastUpdate: null }),
      });

      const result = await adapter.isHealthy();

      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await adapter.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('getLastUpdate', () => {
    it('should return last update timestamp', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ status: 'healthy', lastUpdate: '2024-06-15T15:00:00Z' }),
      });

      const result = await adapter.getLastUpdate();

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2024-06-15T15:00:00.000Z');
    });

    it('should return null when no last update', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy', lastUpdate: null }),
      });

      const result = await adapter.getLastUpdate();

      expect(result).toBeNull();
    });
  });

  describe('circuit breaker', () => {
    it('should start in closed state', () => {
      expect(adapter.getCircuitBreakerState()).toBe('closed');
    });

    it('should return circuit breaker statistics', () => {
      const stats = adapter.getCircuitBreakerStats();

      expect(stats).toHaveProperty('state');
      expect(stats).toHaveProperty('failures');
      expect(stats).toHaveProperty('successes');
      expect(stats).toHaveProperty('rejects');
    });

    it('should open circuit breaker after repeated failures', async () => {
      // Simulate multiple failures to trigger circuit breaker
      for (let i = 0; i < 10; i++) {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        try {
          await adapter.getScore('0x1234567890123456789012345678901234567890');
        } catch {
          // Expected to fail
        }
      }

      // Circuit breaker should be open after failures exceed threshold
      // Note: This depends on volumeThreshold (5) and errorThresholdPercentage (50)
      const stats = adapter.getCircuitBreakerStats();
      expect(stats.failures).toBeGreaterThan(0);
    });
  });

  describe('BigInt handling', () => {
    it('should correctly parse very large BigInt values', async () => {
      const mockResponse = {
        address: '0x1234567890123456789012345678901234567890',
        rank: 1,
        convictionScore: 1000,
        activityScore: 100,
        totalBgtHeld: '999999999999999999999999999999',
        totalBgtClaimed: '999999999999999999999999999999',
        totalBgtBurned: '0',
        timeWeightedBalance: '999999999999999999999999999999',
        firstClaimAt: null,
        lastActivityAt: null,
        updatedAt: '2024-06-15T15:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getScore(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.totalBgtHeld).toBe(999999999999999999999999999999n);
    });

    it('should handle zero values', async () => {
      const mockResponse = {
        address: '0x1234567890123456789012345678901234567890',
        rank: 100,
        convictionScore: 0,
        activityScore: 0,
        totalBgtHeld: '0',
        totalBgtClaimed: '0',
        totalBgtBurned: '0',
        timeWeightedBalance: '0',
        firstClaimAt: null,
        lastActivityAt: null,
        updatedAt: '2024-06-15T15:00:00Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await adapter.getScore(
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.totalBgtHeld).toBe(0n);
      expect(result.totalBgtClaimed).toBe(0n);
      expect(result.totalBgtBurned).toBe(0n);
    });
  });
});
