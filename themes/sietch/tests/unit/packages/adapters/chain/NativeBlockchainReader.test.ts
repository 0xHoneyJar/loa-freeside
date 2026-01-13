/**
 * NativeBlockchainReader Unit Tests
 *
 * Sprint 34: Foundation - Phase 0 of SaaS transformation
 *
 * Tests for Tier 1 binary blockchain checks.
 * Uses mocked viem clients to test logic without RPC calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Address } from 'viem';
import { NativeBlockchainReader } from '../../../../../src/packages/adapters/chain/NativeBlockchainReader.js';
import type { TokenSpec, NativeReaderConfig } from '../../../../../src/packages/core/ports/IChainProvider.js';

// Mock viem module
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(),
    http: vi.fn(() => ({})),
    fallback: vi.fn(() => ({})),
  };
});

// Mock viem/chains
vi.mock('viem/chains', () => ({
  berachain: { id: 80084, name: 'Berachain' },
}));

describe('NativeBlockchainReader', () => {
  const TEST_ADDRESS = '0x1234567890123456789012345678901234567890' as Address;
  const TEST_TOKEN_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as Address;
  const TEST_NFT_ADDRESS = '0x9876543210987654321098765432109876543210' as Address;

  const mockConfig: NativeReaderConfig = {
    rpcUrls: ['https://rpc.berachain.com'],
    chainId: 80084,
    timeout: 30000,
    retryCount: 2,
  };

  let mockClient: {
    getBalance: ReturnType<typeof vi.fn>;
    readContract: ReturnType<typeof vi.fn>;
    getBlockNumber: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getBalance: vi.fn(),
      readContract: vi.fn(),
      getBlockNumber: vi.fn(),
    };

    // Mock createPublicClient to return our mock
    const viem = await import('viem');
    vi.mocked(viem.createPublicClient).mockReturnValue(mockClient as unknown as ReturnType<typeof viem.createPublicClient>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('hasBalance', () => {
    it('should return true when balance >= minAmount for native token', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.getBalance.mockResolvedValue(1000000000000000000n); // 1 ETH

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, 500000000000000000n); // 0.5 ETH

      expect(result).toBe(true);
      expect(mockClient.getBalance).toHaveBeenCalledWith({ address: TEST_ADDRESS });
    });

    it('should return false when balance < minAmount for native token', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.getBalance.mockResolvedValue(100000000000000000n); // 0.1 ETH

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, 500000000000000000n); // 0.5 ETH

      expect(result).toBe(false);
    });

    it('should return true when balance >= minAmount for ERC20 token', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(1000000000000000000n); // 1 token

      const token: TokenSpec = { type: 'erc20', address: TEST_TOKEN_ADDRESS, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, 500000000000000000n);

      expect(result).toBe(true);
      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: TEST_TOKEN_ADDRESS,
          functionName: 'balanceOf',
          args: [TEST_ADDRESS],
        })
      );
    });

    it('should return false when balance < minAmount for ERC20 token', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(100000000000000000n);

      const token: TokenSpec = { type: 'erc20', address: TEST_TOKEN_ADDRESS, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, 500000000000000000n);

      expect(result).toBe(false);
    });

    it('should return true for exact balance match', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const exactAmount = 500000000000000000n;
      mockClient.getBalance.mockResolvedValue(exactAmount);

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, exactAmount);

      expect(result).toBe(true);
    });

    it('should handle zero balance', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.getBalance.mockResolvedValue(0n);

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, 1n);

      expect(result).toBe(false);
    });

    it('should return true when checking for zero minAmount', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.getBalance.mockResolvedValue(0n);

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.hasBalance(TEST_ADDRESS, token, 0n);

      expect(result).toBe(true);
    });
  });

  describe('ownsNFT', () => {
    it('should return true when ERC721 balance > 0', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(1n);

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084);

      expect(result).toBe(true);
      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: TEST_NFT_ADDRESS,
          functionName: 'balanceOf',
          args: [TEST_ADDRESS],
        })
      );
    });

    it('should return false when ERC721 balance is 0', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(0n);

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084);

      expect(result).toBe(false);
    });

    it('should return true when address owns specific tokenId (ERC721)', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(TEST_ADDRESS);

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084, [1n]);

      expect(result).toBe(true);
    });

    it('should return false when address does not own specific tokenId', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const otherAddress = '0x0000000000000000000000000000000000000001' as Address;
      // First call: ERC721 ownerOf returns different address
      // Second call: ERC1155 balanceOf returns 0
      mockClient.readContract
        .mockResolvedValueOnce(otherAddress) // ERC721 ownerOf
        .mockResolvedValueOnce(0n); // ERC1155 balanceOf fallback

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084, [1n]);

      expect(result).toBe(false);
    });

    it('should return true if any tokenId is owned', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const otherAddress = '0x0000000000000000000000000000000000000001' as Address;

      // First tokenId owned by other, second owned by test address
      mockClient.readContract
        .mockResolvedValueOnce(otherAddress)
        .mockResolvedValueOnce(TEST_ADDRESS);

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084, [1n, 2n]);

      expect(result).toBe(true);
    });

    it('should return false when balanceOf throws', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockRejectedValue(new Error('Contract not found'));

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084);

      expect(result).toBe(false);
    });
  });

  describe('getBalance', () => {
    it('should return native token balance', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const expectedBalance = 5000000000000000000n;
      mockClient.getBalance.mockResolvedValue(expectedBalance);

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.getBalance(TEST_ADDRESS, token);

      expect(result).toBe(expectedBalance);
    });

    it('should return ERC20 token balance', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const expectedBalance = 100000000n; // 100 tokens (8 decimals)
      mockClient.readContract.mockResolvedValue(expectedBalance);

      const token: TokenSpec = { type: 'erc20', address: TEST_TOKEN_ADDRESS, chainId: 80084 };
      const result = await reader.getBalance(TEST_ADDRESS, token);

      expect(result).toBe(expectedBalance);
    });

    it('should return ERC721 balance (count)', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(3n);

      const token: TokenSpec = { type: 'erc721', address: TEST_NFT_ADDRESS, chainId: 80084 };
      const result = await reader.getBalance(TEST_ADDRESS, token);

      expect(result).toBe(3n);
    });

    it('should return ERC1155 balance for specific tokenId', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(10n);

      const token: TokenSpec = {
        type: 'erc1155',
        address: TEST_NFT_ADDRESS,
        chainId: 80084,
        tokenId: 1n,
      };
      const result = await reader.getBalance(TEST_ADDRESS, token);

      expect(result).toBe(10n);
      expect(mockClient.readContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: 'balanceOf',
          args: [TEST_ADDRESS, 1n],
        })
      );
    });

    it('should throw for ERC20 without address', async () => {
      const reader = new NativeBlockchainReader(mockConfig);

      const token: TokenSpec = { type: 'erc20', address: null, chainId: 80084 };

      await expect(reader.getBalance(TEST_ADDRESS, token)).rejects.toThrow(
        'ERC20 token requires address'
      );
    });

    it('should throw for ERC1155 without tokenId', async () => {
      const reader = new NativeBlockchainReader(mockConfig);

      const token: TokenSpec = { type: 'erc1155', address: TEST_NFT_ADDRESS, chainId: 80084 };

      await expect(reader.getBalance(TEST_ADDRESS, token)).rejects.toThrow(
        'ERC1155 requires tokenId'
      );
    });
  });

  describe('getNFTBalance', () => {
    it('should return NFT count for address', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockResolvedValue(5n);

      const result = await reader.getNFTBalance(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084);

      expect(result).toBe(5n);
    });

    it('should return 0 when balanceOf throws', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.readContract.mockRejectedValue(new Error('Not ERC721'));

      const result = await reader.getNFTBalance(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084);

      expect(result).toBe(0n);
    });
  });

  describe('isHealthy', () => {
    it('should return true when RPC responds', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.getBlockNumber.mockResolvedValue(1000000n);

      const result = await reader.isHealthy();

      expect(result).toBe(true);
    });

    it('should return false when RPC fails', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      mockClient.getBlockNumber.mockRejectedValue(new Error('RPC timeout'));

      const result = await reader.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('getCurrentBlock', () => {
    it('should return current block number', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const expectedBlock = 12345678n;
      mockClient.getBlockNumber.mockResolvedValue(expectedBlock);

      const result = await reader.getCurrentBlock();

      expect(result).toBe(expectedBlock);
    });
  });

  describe('edge cases', () => {
    it('should handle very large balances (BigInt)', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const largeBalance = 999999999999999999999999999n;
      mockClient.getBalance.mockResolvedValue(largeBalance);

      const token: TokenSpec = { type: 'native', address: null, chainId: 80084 };
      const result = await reader.getBalance(TEST_ADDRESS, token);

      expect(result).toBe(largeBalance);
    });

    it('should handle case-insensitive address comparison for NFT ownership', async () => {
      const reader = new NativeBlockchainReader(mockConfig);
      const upperCaseAddress = TEST_ADDRESS.toUpperCase() as Address;
      mockClient.readContract.mockResolvedValue(upperCaseAddress);

      const result = await reader.ownsNFT(TEST_ADDRESS, TEST_NFT_ADDRESS, 80084, [1n]);

      expect(result).toBe(true);
    });
  });
});
