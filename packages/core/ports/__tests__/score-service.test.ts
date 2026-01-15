/**
 * Score Service Protocol Type Tests
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * Type-level tests to verify the Score Service protocol types are correctly defined.
 */

import { describe, it, expect } from 'vitest';
import type {
  RankedHoldersRequest,
  RankedHoldersResponse,
  AddressRankRequest,
  AddressRankResponse,
  ActionHistoryRequest,
  ActionHistoryResponse,
  CrossChainScoreRequest,
  CrossChainScoreResponse,
  HealthCheckRequest,
  HealthCheckResponse,
  IScoreServiceClient,
  ScoreServiceClientConfig,
} from '../score-service.js';
import { DEFAULT_SCORE_SERVICE_CONFIG } from '../score-service.js';

describe('Score Service Protocol Types', () => {
  describe('Request Types', () => {
    it('should define RankedHoldersRequest correctly', () => {
      const request: RankedHoldersRequest = {
        communityId: 'guild-123',
        assetType: 'token',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: '80094',
        limit: 100,
        offset: 0,
      };

      expect(request.communityId).toBe('guild-123');
      expect(request.assetType).toBe('token');
      expect(request.limit).toBe(100);
    });

    it('should define AddressRankRequest correctly', () => {
      const request: AddressRankRequest = {
        communityId: 'guild-123',
        address: '0x1234567890123456789012345678901234567890',
        assetType: 'nft',
        contractAddress: '0x1234567890123456789012345678901234567890',
        chainId: '1',
      };

      expect(request.address).toBeDefined();
      expect(request.assetType).toBe('nft');
    });

    it('should define ActionHistoryRequest correctly', () => {
      const request: ActionHistoryRequest = {
        address: '0x1234567890123456789012345678901234567890',
        action: 'swap',
        protocol: '0xabcd',
        minCount: 5,
        timeWindowSeconds: 86400,
      };

      expect(request.action).toBe('swap');
      expect(request.minCount).toBe(5);
    });

    it('should define CrossChainScoreRequest correctly', () => {
      const request: CrossChainScoreRequest = {
        address: '0x1234567890123456789012345678901234567890',
        chainIds: ['1', '137', '80094'],
        communityId: 'guild-123',
      };

      expect(request.chainIds).toHaveLength(3);
    });

    it('should define HealthCheckRequest correctly', () => {
      const request: HealthCheckRequest = {
        service: 'score-service',
      };

      expect(request.service).toBe('score-service');
    });
  });

  describe('Response Types', () => {
    it('should define RankedHoldersResponse correctly', () => {
      const response: RankedHoldersResponse = {
        holders: [
          {
            address: '0x1234567890123456789012345678901234567890',
            rank: 1,
            score: '1000.5',
            balance: '1000000000000000000000',
          },
        ],
        totalCount: 100,
        computedAt: Date.now(),
      };

      expect(response.holders).toHaveLength(1);
      expect(response.holders[0]!.rank).toBe(1);
    });

    it('should define AddressRankResponse correctly', () => {
      const response: AddressRankResponse = {
        rank: 42,
        score: '850.75',
        totalHolders: 1000,
        found: true,
      };

      expect(response.rank).toBe(42);
      expect(response.found).toBe(true);
    });

    it('should define ActionHistoryResponse correctly', () => {
      const response: ActionHistoryResponse = {
        hasPerformed: true,
        count: 10,
        lastPerformedAt: Date.now() - 86400000,
      };

      expect(response.hasPerformed).toBe(true);
      expect(response.count).toBe(10);
    });

    it('should define CrossChainScoreResponse correctly', () => {
      const response: CrossChainScoreResponse = {
        address: '0x1234567890123456789012345678901234567890',
        totalScore: '3000',
        chainScores: [
          { chainId: '1', score: '1000' },
          { chainId: '137', score: '1000' },
          { chainId: '80094', score: '1000' },
        ],
        computedAt: Date.now(),
      };

      expect(response.totalScore).toBe('3000');
      expect(response.chainScores).toHaveLength(3);
    });

    it('should define HealthCheckResponse correctly', () => {
      const servingResponse: HealthCheckResponse = {
        status: 'SERVING',
        message: 'OK',
      };

      const notServingResponse: HealthCheckResponse = {
        status: 'NOT_SERVING',
        message: 'Service unavailable',
      };

      expect(servingResponse.status).toBe('SERVING');
      expect(notServingResponse.status).toBe('NOT_SERVING');
    });
  });

  describe('Client Interface', () => {
    it('should define IScoreServiceClient methods', () => {
      // Type-level test - verify interface shape
      const mockClient: IScoreServiceClient = {
        getRankedHolders: async () => ({
          holders: [],
          totalCount: 0,
          computedAt: Date.now(),
        }),
        getAddressRank: async () => ({
          rank: 0,
          score: '0',
          totalHolders: 0,
          found: false,
        }),
        checkActionHistory: async () => ({
          hasPerformed: false,
          count: 0,
        }),
        getCrossChainScore: async () => ({
          address: '0x0',
          totalScore: '0',
          chainScores: [],
          computedAt: Date.now(),
        }),
        healthCheck: async () => ({
          status: 'SERVING',
        }),
        isConnected: () => true,
        getCircuitState: () => 'closed',
        close: async () => {},
      };

      expect(mockClient.isConnected()).toBe(true);
      expect(mockClient.getCircuitState()).toBe('closed');
    });
  });

  describe('Configuration', () => {
    it('should define ScoreServiceClientConfig correctly', () => {
      const config: ScoreServiceClientConfig = {
        endpoint: 'http://score-service:50051',
        timeoutMs: 5000,
        errorThresholdPercentage: 50,
        resetTimeoutMs: 30000,
        volumeThreshold: 10,
        useTls: true,
        maxRetries: 3,
        retryBackoffMs: 100,
      };

      expect(config.endpoint).toBeDefined();
      expect(config.timeoutMs).toBe(5000);
    });

    it('should have correct default configuration', () => {
      expect(DEFAULT_SCORE_SERVICE_CONFIG.timeoutMs).toBe(5000);
      expect(DEFAULT_SCORE_SERVICE_CONFIG.errorThresholdPercentage).toBe(50);
      expect(DEFAULT_SCORE_SERVICE_CONFIG.resetTimeoutMs).toBe(30000);
      expect(DEFAULT_SCORE_SERVICE_CONFIG.volumeThreshold).toBe(10);
      expect(DEFAULT_SCORE_SERVICE_CONFIG.useTls).toBe(false);
      expect(DEFAULT_SCORE_SERVICE_CONFIG.maxRetries).toBe(2);
      expect(DEFAULT_SCORE_SERVICE_CONFIG.retryBackoffMs).toBe(100);
    });
  });
});
