/**
 * NativeBlockchainReader - Tier 1 Direct Blockchain Queries
 *
 * Sprint 34: Foundation - Phase 0 of SaaS transformation
 *
 * Implements INativeReader for binary blockchain checks via viem.
 * NO external dependencies beyond RPC - always available.
 *
 * Supported operations:
 * - hasBalance: Check if address has minimum token balance
 * - ownsNFT: Check if address owns NFT from collection
 * - getBalance: Get exact token balance
 * - getNFTBalance: Get NFT count
 *
 * @module packages/adapters/chain/NativeBlockchainReader
 */

import {
  createPublicClient,
  http,
  fallback,
  type Address,
  type PublicClient,
  type Chain,
  erc20Abi,
} from 'viem';
import { berachain } from 'viem/chains';
import type {
  INativeReader,
  TokenSpec,
  NativeReaderConfig,
} from '../../core/ports/IChainProvider.js';

/**
 * ERC721 balanceOf ABI fragment
 */
const ERC721_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * ERC721 ownerOf ABI fragment
 */
const ERC721_OWNER_OF_ABI = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * ERC1155 balanceOf ABI fragment
 */
const ERC1155_BALANCE_OF_ABI = [
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Chain ID to viem chain mapping
 * Extend as needed for multi-chain support
 */
const CHAIN_MAP: Record<number, Chain> = {
  80084: berachain, // Berachain mainnet
};

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<NativeReaderConfig> = {
  timeout: 30000,
  retryCount: 2,
};

/**
 * NativeBlockchainReader
 *
 * Tier 1 implementation using viem for direct RPC queries.
 * Binary checks (hasBalance, ownsNFT) optimized for <100ms response.
 */
export class NativeBlockchainReader implements INativeReader {
  private readonly clients: Map<number, PublicClient> = new Map();
  private readonly config: Required<NativeReaderConfig>;
  private readonly defaultChainId: number;

  constructor(config: NativeReaderConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    } as Required<NativeReaderConfig>;
    this.defaultChainId = config.chainId;

    // Initialize client for default chain
    this.getOrCreateClient(config.chainId);
  }

  /**
   * Get or create a viem client for a specific chain
   */
  private getOrCreateClient(chainId: number): PublicClient {
    let client = this.clients.get(chainId);

    if (!client) {
      const chain = CHAIN_MAP[chainId];
      if (!chain) {
        throw new Error(`Unsupported chain ID: ${chainId}. Add to CHAIN_MAP.`);
      }

      const transports = this.config.rpcUrls.map((url) =>
        http(url, {
          timeout: this.config.timeout,
          retryCount: this.config.retryCount,
          retryDelay: 1000,
        })
      );

      client = createPublicClient({
        chain,
        transport: fallback(transports, {
          rank: true,
          retryCount: 3,
          retryDelay: 1000,
        }),
      });

      this.clients.set(chainId, client);
    }

    return client;
  }

  /**
   * Check if address has at least minAmount of token
   *
   * Performance target: <100ms
   */
  async hasBalance(
    address: Address,
    token: TokenSpec,
    minAmount: bigint
  ): Promise<boolean> {
    const balance = await this.getBalance(address, token);
    return balance >= minAmount;
  }

  /**
   * Check if address owns any token from NFT collection
   *
   * For ERC721:
   * - If tokenIds provided: Check ownerOf for each
   * - If no tokenIds: Check balanceOf > 0
   *
   * For ERC1155:
   * - Must provide tokenIds
   * - Check balanceOf for each tokenId
   */
  async ownsNFT(
    address: Address,
    collection: Address,
    chainId: number,
    tokenIds?: bigint[]
  ): Promise<boolean> {
    const client = this.getOrCreateClient(chainId);

    // If specific tokenIds provided, check ownership of each
    if (tokenIds && tokenIds.length > 0) {
      // Try ERC721 ownerOf first
      try {
        const ownerChecks = await Promise.all(
          tokenIds.map(async (tokenId) => {
            try {
              const owner = await client.readContract({
                address: collection,
                abi: ERC721_OWNER_OF_ABI,
                functionName: 'ownerOf',
                args: [tokenId],
              });
              return owner.toLowerCase() === address.toLowerCase();
            } catch {
              // Token might not exist or be ERC1155
              return false;
            }
          })
        );
        if (ownerChecks.some((owned) => owned)) {
          return true;
        }
      } catch {
        // Not ERC721, try ERC1155
      }

      // Try ERC1155 balanceOf
      try {
        const balanceChecks = await Promise.all(
          tokenIds.map(async (tokenId) => {
            const balance = await client.readContract({
              address: collection,
              abi: ERC1155_BALANCE_OF_ABI,
              functionName: 'balanceOf',
              args: [address, tokenId],
            });
            return balance > 0n;
          })
        );
        return balanceChecks.some((hasBalance) => hasBalance);
      } catch {
        return false;
      }
    }

    // No specific tokenIds - check ERC721 balanceOf
    try {
      const balance = await client.readContract({
        address: collection,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      return balance > 0n;
    } catch {
      return false;
    }
  }

  /**
   * Get exact token balance for address
   */
  async getBalance(address: Address, token: TokenSpec): Promise<bigint> {
    const client = this.getOrCreateClient(token.chainId);

    switch (token.type) {
      case 'native': {
        return client.getBalance({ address });
      }

      case 'erc20': {
        if (!token.address) {
          throw new Error('ERC20 token requires address');
        }
        return client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        });
      }

      case 'erc721': {
        if (!token.address) {
          throw new Error('ERC721 token requires address');
        }
        return client.readContract({
          address: token.address,
          abi: ERC721_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [address],
        });
      }

      case 'erc1155': {
        if (!token.address) {
          throw new Error('ERC1155 token requires address');
        }
        if (token.tokenId === undefined) {
          throw new Error('ERC1155 requires tokenId');
        }
        return client.readContract({
          address: token.address,
          abi: ERC1155_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [address, token.tokenId],
        });
      }

      default:
        throw new Error(`Unsupported token type: ${token.type}`);
    }
  }

  /**
   * Get NFT balance (count of tokens owned)
   */
  async getNFTBalance(
    address: Address,
    collection: Address,
    chainId: number
  ): Promise<bigint> {
    const client = this.getOrCreateClient(chainId);

    try {
      return await client.readContract({
        address: collection,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
    } catch {
      // Collection might not support balanceOf (some ERC1155)
      return 0n;
    }
  }

  /**
   * Check if the reader is healthy (RPC responding)
   */
  async isHealthy(): Promise<boolean> {
    try {
      const client = this.getOrCreateClient(this.defaultChainId);
      await client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current block number
   */
  async getCurrentBlock(): Promise<bigint> {
    const client = this.getOrCreateClient(this.defaultChainId);
    return client.getBlockNumber();
  }
}

/**
 * Factory function to create NativeBlockchainReader
 */
export function createNativeReader(config: NativeReaderConfig): INativeReader {
  return new NativeBlockchainReader(config);
}
