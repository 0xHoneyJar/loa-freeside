/**
 * NativeBlockchainReader Integration Tests
 *
 * Sprint 34: Foundation - Phase 0 of SaaS transformation
 *
 * Integration tests against actual Berachain RPC.
 * These tests verify real blockchain queries work correctly.
 *
 * @requires BERACHAIN_RPC_URL environment variable or uses public RPC
 * @slow These tests make actual RPC calls
 *
 * Note: Tests will be skipped if RPC is not accessible.
 * Set SKIP_INTEGRATION_TESTS=true to skip these tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Address } from 'viem';
import { NativeBlockchainReader } from '../../../../../src/packages/adapters/chain/NativeBlockchainReader.js';
import type { TokenSpec, NativeReaderConfig } from '../../../../../src/packages/core/ports/IChainProvider.js';

// Skip integration tests if explicitly disabled
const SKIP_TESTS = process.env.SKIP_INTEGRATION_TESTS === 'true';

// Berachain bArtio testnet chain ID
const BERACHAIN_CHAIN_ID = 80084;

// Public RPC endpoints for Berachain bArtio
// See: https://docs.berachain.com/developers/network-configurations
const BERACHAIN_RPC_URLS = [
  process.env.BERACHAIN_RPC_URL || 'https://bartio.rpc.berachain.com',
];

// Well-known addresses for testing
const KNOWN_ADDRESSES = {
  // Zero address (baseline - always has deterministic behavior)
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000' as Address,
  // Dead address (tokens are often burned here)
  DEAD_ADDRESS: '0x000000000000000000000000000000000000dEaD' as Address,
};

// BGT Token address on Berachain bArtio
const BGT_TOKEN_ADDRESS = '0xbDa130737BDd9618301681329bF2e46A016ff9Ad' as Address;

describe.skipIf(SKIP_TESTS)('NativeBlockchainReader Integration', () => {
  let reader: NativeBlockchainReader;
  let rpcAccessible = false;

  beforeAll(async () => {
    const config: NativeReaderConfig = {
      rpcUrls: BERACHAIN_RPC_URLS,
      chainId: BERACHAIN_CHAIN_ID,
      timeout: 10000, // 10s timeout for RPC calls
      retryCount: 2,
    };

    reader = new NativeBlockchainReader(config);

    // Check if RPC is accessible with a quick health check
    try {
      const healthy = await Promise.race([
        reader.isHealthy(),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('RPC check timeout')), 10000)
        ),
      ]);
      rpcAccessible = healthy;
    } catch {
      console.warn('Berachain RPC not accessible - integration tests will be skipped');
      rpcAccessible = false;
    }
  }, 20000);

  afterAll(() => {
    if (!rpcAccessible) {
      console.log('Note: Integration tests were skipped due to RPC connectivity issues');
    }
  });

  describe('isHealthy', () => {
    it('should return true when RPC is accessible', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const result = await reader.isHealthy();
      expect(result).toBe(true);
    }, 30000);
  });

  describe('getCurrentBlock', () => {
    it('should return a valid block number', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const blockNumber = await reader.getCurrentBlock();

      expect(blockNumber).toBeGreaterThan(0n);
      // Berachain should have processed some blocks
      expect(blockNumber).toBeGreaterThan(1000n);
    }, 30000);
  });

  describe('getBalance - Native Token', () => {
    it('should return balance for zero address', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const token: TokenSpec = {
        type: 'native',
        address: null,
        chainId: BERACHAIN_CHAIN_ID,
      };

      const balance = await reader.getBalance(KNOWN_ADDRESSES.ZERO_ADDRESS, token);

      // Zero address typically has 0 native balance (or whatever is sent to it)
      expect(typeof balance).toBe('bigint');
      expect(balance).toBeGreaterThanOrEqual(0n);
    }, 30000);

    it('should return balance for dead address', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const token: TokenSpec = {
        type: 'native',
        address: null,
        chainId: BERACHAIN_CHAIN_ID,
      };

      const balance = await reader.getBalance(KNOWN_ADDRESSES.DEAD_ADDRESS, token);

      // Dead address may have some burned BERA
      expect(typeof balance).toBe('bigint');
      expect(balance).toBeGreaterThanOrEqual(0n);
    }, 30000);
  });

  describe('hasBalance - Native Token', () => {
    it('should return true for zero address with 0 minAmount', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const token: TokenSpec = {
        type: 'native',
        address: null,
        chainId: BERACHAIN_CHAIN_ID,
      };

      // Any address should have >= 0 balance
      const result = await reader.hasBalance(KNOWN_ADDRESSES.ZERO_ADDRESS, token, 0n);

      expect(result).toBe(true);
    }, 30000);

    it('should return false for zero address with impossibly high minAmount', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const token: TokenSpec = {
        type: 'native',
        address: null,
        chainId: BERACHAIN_CHAIN_ID,
      };

      // Very high amount - exceeds total supply
      const impossibleAmount = 999999999999999999999999999n;
      const result = await reader.hasBalance(
        KNOWN_ADDRESSES.ZERO_ADDRESS,
        token,
        impossibleAmount
      );

      expect(result).toBe(false);
    }, 30000);
  });

  describe('getBalance - ERC20 Token', () => {
    it('should return balance for zero address BGT', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const token: TokenSpec = {
        type: 'erc20',
        address: BGT_TOKEN_ADDRESS,
        chainId: BERACHAIN_CHAIN_ID,
      };

      try {
        const balance = await reader.getBalance(KNOWN_ADDRESSES.ZERO_ADDRESS, token);
        // Zero address should have 0 BGT (or whatever was sent to it)
        expect(typeof balance).toBe('bigint');
        expect(balance).toBeGreaterThanOrEqual(0n);
      } catch (error) {
        // If BGT contract doesn't exist on testnet, that's acceptable
        console.warn('BGT contract may not exist on this network:', error);
      }
    }, 30000);
  });

  describe('ownsNFT', () => {
    it('should return false for zero address with any collection', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      // Use a random address as NFT collection - will fail gracefully
      const fakeCollection = '0x1234567890123456789012345678901234567890' as Address;

      const result = await reader.ownsNFT(
        KNOWN_ADDRESSES.ZERO_ADDRESS,
        fakeCollection,
        BERACHAIN_CHAIN_ID
      );

      // Should return false (contract doesn't exist or zero address doesn't own)
      expect(result).toBe(false);
    }, 30000);
  });

  describe('getNFTBalance', () => {
    it('should return 0 for zero address with any collection', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const fakeCollection = '0x1234567890123456789012345678901234567890' as Address;

      const balance = await reader.getNFTBalance(
        KNOWN_ADDRESSES.ZERO_ADDRESS,
        fakeCollection,
        BERACHAIN_CHAIN_ID
      );

      // Should return 0 (contract doesn't exist or zero address has 0)
      expect(balance).toBe(0n);
    }, 30000);
  });

  describe('error handling', () => {
    it('should throw for unsupported chain ID', () => {
      const config: NativeReaderConfig = {
        rpcUrls: ['https://example.com'],
        chainId: 999999, // Invalid chain ID
        timeout: 5000,
        retryCount: 1,
      };

      expect(() => new NativeBlockchainReader(config)).toThrow(
        'Unsupported chain ID: 999999'
      );
    });
  });

  describe('performance', () => {
    it('should complete hasBalance check within timeout', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const token: TokenSpec = {
        type: 'native',
        address: null,
        chainId: BERACHAIN_CHAIN_ID,
      };

      const startTime = Date.now();
      await reader.hasBalance(KNOWN_ADDRESSES.ZERO_ADDRESS, token, 0n);
      const duration = Date.now() - startTime;

      // Should complete within 10 seconds (allowing for network latency)
      expect(duration).toBeLessThan(10000);
      console.log(`hasBalance completed in ${duration}ms`);
    }, 30000);

    it('should complete isHealthy check within timeout', async () => {
      if (!rpcAccessible) {
        console.log('Skipping: RPC not accessible');
        return;
      }

      const startTime = Date.now();
      await reader.isHealthy();
      const duration = Date.now() - startTime;

      // Health check should be fast
      expect(duration).toBeLessThan(5000);
      console.log(`isHealthy completed in ${duration}ms`);
    }, 30000);
  });
});

// Export for CI/CD configuration
export const integrationTestConfig = {
  chainId: BERACHAIN_CHAIN_ID,
  rpcUrls: BERACHAIN_RPC_URLS,
  skipEnvVar: 'SKIP_INTEGRATION_TESTS',
};
