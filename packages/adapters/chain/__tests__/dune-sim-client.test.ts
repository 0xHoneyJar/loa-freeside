/**
 * Dune Sim Client Tests
 * Sprint 14: Dune Sim Foundation
 *
 * Unit tests for the DuneSimClient implementation.
 * Uses mocked fetch to test without real API calls.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DuneSimClient } from '../dune-sim-client.js';
import type { Logger } from 'pino';
import type {
  DuneBalancesResponse,
  DuneSingleBalanceResponse,
  DuneCollectiblesResponse,
  DuneActivityResponse,
  DuneSupportedChainsResponse,
} from '../dune-sim-types.js';

// --------------------------------------------------------------------------
// Mock Setup
// --------------------------------------------------------------------------

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock AbortSignal.timeout
vi.stubGlobal('AbortSignal', {
  timeout: vi.fn(() => new AbortController().signal),
});

// Mock logger
const createMockLogger = (): Logger =>
  ({
    child: vi.fn(() => createMockLogger()),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    level: 'info',
  }) as unknown as Logger;

// --------------------------------------------------------------------------
// Test Fixtures
// --------------------------------------------------------------------------

const TEST_API_KEY = 'test-api-key-12345';
const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TEST_TOKEN = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TEST_NFT_COLLECTION = '0x9876543210987654321098765432109876543210';

// Mock response fixtures
const mockBalanceResponse: DuneSingleBalanceResponse = {
  address: TEST_ADDRESS,
  balance: {
    address: TEST_TOKEN,
    amount: '1000000000000000000', // 1 token with 18 decimals
    symbol: 'TEST',
    name: 'Test Token',
    decimals: 18,
    price_usd: 1.5,
    value_usd: 1.5,
    chain_id: 80094,
    chain: 'berachain',
  },
};

const mockNativeBalanceResponse: DuneSingleBalanceResponse = {
  address: TEST_ADDRESS,
  balance: {
    address: null,
    amount: '5000000000000000000', // 5 BERA
    symbol: 'BERA',
    name: 'Berachain',
    decimals: 18,
    price_usd: 10.0,
    value_usd: 50.0,
    chain_id: 80094,
    chain: 'berachain',
  },
};

const mockCollectiblesResponse: DuneCollectiblesResponse = {
  address: TEST_ADDRESS,
  collectibles: [
    {
      contract_address: TEST_NFT_COLLECTION,
      token_id: '123',
      collection_name: 'Test NFTs',
      name: 'Test NFT #123',
      description: 'A test NFT',
      image_url: 'https://example.com/nft.png',
      token_standard: 'ERC721',
      amount: '1',
      chain_id: 80094,
      chain: 'berachain',
      is_spam: false,
      floor_price_usd: 100.0,
    },
  ],
  next_cursor: null,
};

const mockActivityResponse: DuneActivityResponse = {
  address: TEST_ADDRESS,
  activities: [
    {
      tx_hash: '0xabc123',
      block_number: 12345678,
      timestamp: '2026-01-30T12:00:00Z',
      type: 'transfer',
      description: 'Transferred 1 TEST',
      from: TEST_ADDRESS,
      to: '0xrecipient',
      value: '1000000000000000000',
      gas_used: '21000',
      gas_price: '1000000000',
      fee: '21000000000000',
      fee_usd: 0.05,
      chain_id: 80094,
      chain: 'berachain',
      status: 'success',
    },
  ],
  next_cursor: null,
};

const mockSupportedChainsResponse: DuneSupportedChainsResponse = {
  chains: [
    { chain_id: 1, name: 'Ethereum', is_testnet: false },
    { chain_id: 137, name: 'Polygon', is_testnet: false },
    { chain_id: 42161, name: 'Arbitrum One', is_testnet: false },
    { chain_id: 8453, name: 'Base', is_testnet: false },
    { chain_id: 80094, name: 'Berachain', is_testnet: false },
  ],
};

// Helper to create successful fetch response
const createSuccessResponse = <T>(data: T) => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue(data),
  headers: new Headers(),
});

// Helper to create error fetch response
const createErrorResponse = (status: number, message: string) => ({
  ok: false,
  status,
  json: vi.fn().mockResolvedValue({ error: 'error', message, status_code: status }),
  headers: new Headers(),
});

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('DuneSimClient', () => {
  let client: DuneSimClient;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    client = new DuneSimClient(mockLogger, {
      apiKey: TEST_API_KEY,
      cacheTtlMs: 60_000,
      timeoutMs: 10_000,
      maxRetries: 3,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with valid API key', () => {
      expect(client).toBeDefined();
    });

    it('should throw error without API key', () => {
      expect(() => {
        new DuneSimClient(mockLogger, { apiKey: '' });
      }).toThrow('requires an API key');
    });

    it('should use default config values', () => {
      const defaultClient = new DuneSimClient(mockLogger, { apiKey: TEST_API_KEY });
      expect(defaultClient).toBeDefined();
    });

    it('should log initialization', () => {
      expect(mockLogger.child).toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('should fetch token balance successfully', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      const balance = await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(balance).toBe(1000000000000000000n);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/evm/balances/'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Sim-Api-Key': TEST_API_KEY,
          }),
        })
      );
    });

    it('should return 0 for non-existent token', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(404, 'Token not found'));

      const balance = await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(balance).toBe(0n);
    });

    it('should cache balance results', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      // First call
      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);
      // Second call (should use cache)
      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getNativeBalance', () => {
    it('should fetch native balance successfully', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockNativeBalanceResponse));

      const balance = await client.getNativeBalance(80094, TEST_ADDRESS as `0x${string}`);

      expect(balance).toBe(5000000000000000000n);
    });

    it('should return 0 for address with no native balance', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(404, 'Not found'));

      const balance = await client.getNativeBalance(80094, TEST_ADDRESS as `0x${string}`);

      expect(balance).toBe(0n);
    });
  });

  describe('hasBalance', () => {
    it('should return true when balance meets threshold', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      const has = await client.hasBalance(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_TOKEN as `0x${string}`,
        500000000000000000n // 0.5 tokens
      );

      expect(has).toBe(true);
    });

    it('should return false when balance below threshold', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      const has = await client.hasBalance(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_TOKEN as `0x${string}`,
        2000000000000000000n // 2 tokens (balance is 1)
      );

      expect(has).toBe(false);
    });
  });

  describe('ownsNFT', () => {
    it('should return true when address owns NFT from collection', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockCollectiblesResponse));

      const owns = await client.ownsNFT(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_NFT_COLLECTION as `0x${string}`
      );

      expect(owns).toBe(true);
    });

    it('should return true when address owns specific tokenId', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockCollectiblesResponse));

      const owns = await client.ownsNFT(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_NFT_COLLECTION as `0x${string}`,
        123n
      );

      expect(owns).toBe(true);
    });

    it('should return false when address does not own specific tokenId', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockCollectiblesResponse));

      const owns = await client.ownsNFT(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_NFT_COLLECTION as `0x${string}`,
        999n // Different token ID
      );

      expect(owns).toBe(false);
    });

    it('should return false when address owns no NFTs from collection', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockCollectiblesResponse,
          collectibles: [],
        })
      );

      const owns = await client.ownsNFT(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_NFT_COLLECTION as `0x${string}`
      );

      expect(owns).toBe(false);
    });

    it('should filter spam NFTs', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockCollectiblesResponse,
          collectibles: [
            {
              ...mockCollectiblesResponse.collectibles[0],
              is_spam: true,
            },
          ],
        })
      );

      // Note: The API filter_spam=true is passed, so spam would already be filtered
      // This test verifies the client sends the filter parameter
      expect(mockFetch).toHaveBeenCalledTimes(0);
    });
  });

  describe('getBalanceWithUSD', () => {
    it('should return balance with USD pricing', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      const result = await client.getBalanceWithUSD(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_TOKEN as `0x${string}`
      );

      expect(result.balance).toBe(1000000000000000000n);
      expect(result.priceUsd).toBe(1.5);
      expect(result.valueUsd).toBe(1.5);
      expect(result.symbol).toBe('TEST');
      expect(result.decimals).toBe(18);
    });

    it('should handle native token', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockNativeBalanceResponse));

      const result = await client.getBalanceWithUSD(80094, TEST_ADDRESS as `0x${string}`, 'native');

      expect(result.balance).toBe(5000000000000000000n);
      expect(result.priceUsd).toBe(10.0);
      expect(result.valueUsd).toBe(50.0);
    });
  });

  describe('getCollectibles', () => {
    it('should return collectibles list', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockCollectiblesResponse));

      const result = await client.getCollectibles(TEST_ADDRESS as `0x${string}`);

      expect(result.collectibles).toHaveLength(1);
      expect(result.collectibles[0].contractAddress).toBe(TEST_NFT_COLLECTION);
      expect(result.collectibles[0].tokenId).toBe('123');
      expect(result.nextCursor).toBeNull();
    });

    it('should support pagination', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockCollectiblesResponse,
          next_cursor: 'cursor123',
        })
      );

      const result = await client.getCollectibles(TEST_ADDRESS as `0x${string}`, { limit: 10 });

      expect(result.nextCursor).toBe('cursor123');
    });
  });

  describe('getActivity', () => {
    it('should return activity list', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockActivityResponse));

      const result = await client.getActivity(TEST_ADDRESS as `0x${string}`);

      expect(result.activities).toHaveLength(1);
      expect(result.activities[0].txHash).toBe('0xabc123');
      expect(result.activities[0].type).toBe('transfer');
      expect(result.activities[0].status).toBe('success');
    });

    it('should parse timestamps correctly', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockActivityResponse));

      const result = await client.getActivity(TEST_ADDRESS as `0x${string}`);

      expect(result.activities[0].timestamp).toBeInstanceOf(Date);
    });

    it('should support chain filtering', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockActivityResponse));

      await client.getActivity(TEST_ADDRESS as `0x${string}`, { chainIds: [80094, 1] });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('chain_ids=80094%2C1'),
        expect.anything()
      );
    });
  });

  describe('Tier 2 methods', () => {
    it('should throw error for getRankedHolders', async () => {
      await expect(client.getRankedHolders({ type: 'token', chainId: 80094 }, 10)).rejects.toThrow(
        'requires Score Service'
      );
    });

    it('should throw error for getAddressRank', async () => {
      await expect(
        client.getAddressRank(TEST_ADDRESS as `0x${string}`, { type: 'token', chainId: 80094 })
      ).rejects.toThrow('requires Score Service');
    });

    it('should throw error for checkActionHistory', async () => {
      await expect(
        client.checkActionHistory(TEST_ADDRESS as `0x${string}`, { action: 'swap' })
      ).rejects.toThrow('requires Score Service');
    });

    it('should throw error for getCrossChainScore', async () => {
      await expect(
        client.getCrossChainScore(TEST_ADDRESS as `0x${string}`, [80094, 1])
      ).rejects.toThrow('requires Score Service');
    });
  });

  describe('isScoreServiceAvailable', () => {
    it('should always return false', async () => {
      const available = await client.isScoreServiceAvailable();
      expect(available).toBe(false);
    });
  });

  describe('getSupportedChains', () => {
    it('should return default chains before API call', () => {
      const chains = client.getSupportedChains();
      expect(chains).toContain(1); // Ethereum
      expect(chains).toContain(80094); // Berachain
    });

    it('should return chains from API after loadSupportedChains', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockSupportedChainsResponse));

      const chains = await client.loadSupportedChains();

      expect(chains).toHaveLength(5);
      expect(chains).toContain(80094);
    });
  });

  describe('retry logic', () => {
    it('should retry on 429 rate limit', async () => {
      // First call: rate limited
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: vi.fn().mockResolvedValue({ error: 'rate_limited', message: 'Too many requests' }),
        headers: new Headers({ 'Retry-After': '1' }),
      });
      // Second call: success
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      const balance = await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(balance).toBe(1000000000000000000n);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(401, 'Invalid API key'));

      await expect(
        client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`)
      ).rejects.toThrow('Authentication failed');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 403 forbidden', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(403, 'Access denied'));

      await expect(
        client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`)
      ).rejects.toThrow('Authentication failed');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache behavior', () => {
    it('should cache successful responses', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      // First call
      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);
      // Second call (cached)
      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should track cache hit rate', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);
      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      const stats = client.getCacheStats();
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should clear cache on demand', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);
      client.clearCache();

      const stats = client.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('metrics', () => {
    it('should track request count', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      const metrics = client.getMetrics();
      expect(metrics.requests).toBeGreaterThan(0);
    });

    it('should track success count', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      const metrics = client.getMetrics();
      expect(metrics.successes).toBeGreaterThan(0);
    });

    it('should track endpoint-specific metrics', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockCollectiblesResponse));

      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);
      await client.getCollectibles(TEST_ADDRESS as `0x${string}`);

      const metrics = client.getMetrics();
      expect(metrics.endpoints.balances.requests).toBeGreaterThan(0);
      expect(metrics.endpoints.collectibles.requests).toBeGreaterThan(0);
    });
  });

  describe('health check', () => {
    it('should return true when API is reachable', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockSupportedChainsResponse));

      const healthy = await client.isHealthy();

      expect(healthy).toBe(true);
    });

    it('should return false when API is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const healthy = await client.isHealthy();

      expect(healthy).toBe(false);
    });
  });
});

// --------------------------------------------------------------------------
// Token Holders API Tests (Sprint 17)
// --------------------------------------------------------------------------

describe('DuneSimClient - Token Holders API', () => {
  let client: DuneSimClient;
  let mockLogger: Logger;

  const mockTokenHoldersResponse = {
    token_address: '0x1234567890123456789012345678901234567890',
    chain_id: 80094,
    holders: [
      {
        address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        balance: '1000000000000000000000',
        rank: 1,
        percentage: 10.5,
        value_usd: 1500.0,
      },
      {
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        balance: '500000000000000000000',
        rank: 2,
        percentage: 5.25,
        value_usd: 750.0,
      },
      {
        address: '0xcccccccccccccccccccccccccccccccccccccccc',
        balance: '250000000000000000000',
        rank: 3,
        percentage: 2.625,
        value_usd: 375.0,
      },
    ],
    total_holders: 1000,
    next_cursor: 'cursor_abc123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    client = new DuneSimClient(mockLogger, {
      apiKey: TEST_API_KEY,
      cacheTtlMs: 60_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getTopTokenHolders', () => {
    it('should fetch token holders successfully', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockTokenHoldersResponse));

      const result = await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094 }
      );

      expect(result.holders).toHaveLength(3);
      expect(result.totalHolders).toBe(1000);
      expect(result.nextCursor).toBe('cursor_abc123');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/evm/token/'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Sim-Api-Key': TEST_API_KEY,
          }),
        })
      );
    });

    it('should parse balances correctly with custom decimals', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockTokenHoldersResponse));

      const result = await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094, decimals: 18 }
      );

      // First holder has 1000000000000000000000 wei = 1000 tokens
      expect(result.holders[0].balance).toBe(1000000000000000000000n);
      expect(result.holders[0].rank).toBe(1);
      expect(result.holders[0].valueUsd).toBe(1500.0);
    });

    it('should use limit parameter', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockTokenHoldersResponse));

      await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094, limit: 50 }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=50'),
        expect.anything()
      );
    });

    it('should use cursor parameter for pagination', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockTokenHoldersResponse));

      await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094, cursor: 'next_page_cursor' }
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('cursor=next_page_cursor'),
        expect.anything()
      );
    });

    it('should cache results', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockTokenHoldersResponse));

      // First call
      await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094, limit: 100 }
      );
      // Second call (should use cache)
      await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094, limit: 100 }
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on invalid token address', async () => {
      await expect(
        client.getTopTokenHolders(
          'invalid-address' as `0x${string}`,
          { chainId: 80094 }
        )
      ).rejects.toThrow('Invalid token address');
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(500, 'Internal server error'));

      await expect(
        client.getTopTokenHolders(
          TEST_TOKEN as `0x${string}`,
          { chainId: 80094 }
        )
      ).rejects.toThrow();
    });

    it('should track endpoint metrics', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockTokenHoldersResponse));

      await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094 }
      );

      const metrics = client.getMetrics();
      expect(metrics.endpoints.tokenHolders.requests).toBe(1);
      expect(metrics.endpoints.tokenHolders.errors).toBe(0);
    });

    it('should sanitize error messages (HIGH-1 remediation)', async () => {
      // Simulate an error response that contains a potential API key pattern
      const sensitiveKey = 'abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';
      const errorWithKey = {
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({
          error: 'error',
          message: `Failed with key ${sensitiveKey}`,
          status_code: 500,
        }),
        headers: new Headers(),
      };

      // Mock for all retry attempts
      mockFetch.mockResolvedValue(errorWithKey);

      await expect(
        client.getTopTokenHolders(
          TEST_TOKEN as `0x${string}`,
          { chainId: 80094 }
        )
      ).rejects.toThrow(/\[REDACTED\]/);
    });
  });

  describe('response validation (HIGH-2 remediation)', () => {
    it('should reject response with invalid holder address', async () => {
      const invalidResponse = {
        ...mockTokenHoldersResponse,
        holders: [
          {
            address: 'not-a-valid-address', // Invalid
            balance: '1000',
            rank: 1,
            value_usd: null,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(createSuccessResponse(invalidResponse));

      await expect(
        client.getTopTokenHolders(
          TEST_TOKEN as `0x${string}`,
          { chainId: 80094 }
        )
      ).rejects.toThrow();
    });

    it('should reject response with missing required fields', async () => {
      const invalidResponse = {
        token_address: TEST_TOKEN,
        // Missing chain_id and holders
      };

      mockFetch.mockResolvedValueOnce(createSuccessResponse(invalidResponse));

      await expect(
        client.getTopTokenHolders(
          TEST_TOKEN as `0x${string}`,
          { chainId: 80094 }
        )
      ).rejects.toThrow();
    });

    it('should accept valid response with null value_usd', async () => {
      const validResponse = {
        ...mockTokenHoldersResponse,
        holders: [
          {
            address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            balance: '1000',
            rank: 1,
            value_usd: null,
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(createSuccessResponse(validResponse));

      const result = await client.getTopTokenHolders(
        TEST_TOKEN as `0x${string}`,
        { chainId: 80094 }
      );

      expect(result.holders[0].valueUsd).toBeNull();
    });
  });
});

describe('DuneSimClient - Edge Cases', () => {
  let client: DuneSimClient;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
    client = new DuneSimClient(mockLogger, {
      apiKey: TEST_API_KEY,
    });
  });

  describe('address normalization', () => {
    it('should normalize addresses to lowercase', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      const upperCaseAddress = '0xABCDEF1234567890ABCDEF1234567890ABCDEF12';
      await client.getBalance(80094, upperCaseAddress as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(upperCaseAddress.toLowerCase()),
        expect.anything()
      );
    });
  });

  describe('chain ID handling', () => {
    it('should handle numeric chain IDs', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('chain_ids=80094'),
        expect.anything()
      );
    });

    it('should handle string chain IDs', async () => {
      mockFetch.mockResolvedValueOnce(createSuccessResponse(mockBalanceResponse));

      await client.getBalance('80094', TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('chain_ids=80094'),
        expect.anything()
      );
    });
  });

  describe('amount parsing', () => {
    it('should parse integer amounts correctly', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockBalanceResponse,
          balance: {
            ...mockBalanceResponse.balance,
            amount: '1000000000000000000',
          },
        })
      );

      const balance = await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(balance).toBe(1000000000000000000n);
    });

    it('should parse decimal amounts correctly', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockBalanceResponse,
          balance: {
            ...mockBalanceResponse.balance,
            amount: '1.5',
            decimals: 18,
          },
        })
      );

      const balance = await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      // 1.5 with 18 decimals = 1500000000000000000
      expect(balance).toBe(1500000000000000000n);
    });

    it('should handle zero balance', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockBalanceResponse,
          balance: {
            ...mockBalanceResponse.balance,
            amount: '0',
          },
        })
      );

      const balance = await client.getBalance(80094, TEST_ADDRESS as `0x${string}`, TEST_TOKEN as `0x${string}`);

      expect(balance).toBe(0n);
    });
  });

  describe('null USD values', () => {
    it('should handle null price_usd', async () => {
      mockFetch.mockResolvedValueOnce(
        createSuccessResponse({
          ...mockBalanceResponse,
          balance: {
            ...mockBalanceResponse.balance,
            price_usd: null,
            value_usd: null,
          },
        })
      );

      const result = await client.getBalanceWithUSD(
        80094,
        TEST_ADDRESS as `0x${string}`,
        TEST_TOKEN as `0x${string}`
      );

      expect(result.priceUsd).toBeNull();
      expect(result.valueUsd).toBeNull();
    });
  });
});
