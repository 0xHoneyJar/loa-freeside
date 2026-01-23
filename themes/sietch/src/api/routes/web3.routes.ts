/**
 * Web3 Data API Routes
 *
 * API for reading contract data and verifying ownership.
 * Sprint 4: Web3 Layer - Contract Binding API
 *
 * Endpoints:
 * - POST /api/web3/read - Generic contract read
 * - GET /api/web3/token/:chainId/:address - Token metadata
 * - GET /api/web3/nft/:chainId/:address - NFT collection metadata
 * - POST /api/web3/verify-ownership - Ownership verification
 *
 * @see grimoires/loa/sdd.md §6. API Design
 */

import { Router } from 'express';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  adminRateLimiter,
  requireApiKeyAsync,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import {
  contractReadService,
  ContractReadService,
} from '../../services/theme/ContractReadService.js';
import {
  contractValidationService,
} from '../../services/theme/ContractValidationService.js';
import {
  getContractBinding,
  getContractBindingByAddress,
} from '../../db/queries/contract-binding-queries.js';
import {
  chainIdSchema,
  addressSchema,
  contractAbiFragmentSchema,
} from '../../packages/core/validation/theme-schemas.js';
import { isSupportedChainId, getChainName } from '../../config/chains.js';
import { logger } from '../../utils/logger.js';
import { z } from 'zod';

/**
 * Web3 routes (rate limited, API key required)
 */
export const web3Router = Router();

// Apply rate limiting and authentication
web3Router.use(adminRateLimiter);
web3Router.use(requireApiKeyAsync);

// =============================================================================
// Schemas
// =============================================================================

/**
 * Generic contract read request schema
 */
const contractReadRequestSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  functionName: z.string().min(1).max(100),
  args: z.array(z.unknown()).optional().default([]),
  abi: z.array(contractAbiFragmentSchema).min(1),
  // Optional: use a binding instead of providing ABI
  bindingId: z.string().uuid().optional(),
  // Cache control
  skipCache: z.boolean().optional().default(false),
});

/**
 * Ownership verification request schema
 */
const verifyOwnershipRequestSchema = z.object({
  chainId: z.number().int().positive(),
  walletAddress: z.string(),
  contractAddress: z.string(),
  // For ERC721/ERC1155 specific token check
  tokenId: z.string().optional(),
  // Minimum balance requirement (for ERC20/ERC1155)
  minBalance: z.string().optional(),
  // Contract type hint (auto-detected if not provided)
  contractType: z.enum(['erc20', 'erc721', 'erc1155']).optional(),
});

/**
 * Chain ID param schema (for URL params)
 */
const chainIdParamSchema = z.coerce.number().int().positive();

// =============================================================================
// Generic Contract Read
// =============================================================================

/**
 * POST /api/web3/read
 * Generic contract read with caching
 *
 * @body {chainId, address, functionName, args?, abi, skipCache?}
 * @returns Contract call result
 */
web3Router.post('/read', async (req: AuthenticatedRequest, res: Response) => {
  const inputResult = contractReadRequestSchema.safeParse(req.body);
  if (!inputResult.success) {
    const errors = inputResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid request: ${errors}`);
  }

  const input = inputResult.data;

  // Validate chain ID
  if (!isSupportedChainId(input.chainId)) {
    throw new ValidationError(`Unsupported chain ID: ${input.chainId}`);
  }

  // Validate address
  if (!contractValidationService.isValidAddress(input.address)) {
    throw new ValidationError(`Invalid contract address: ${input.address}`);
  }

  // Get ABI from binding if bindingId provided
  let abi = input.abi;
  if (input.bindingId) {
    const binding = getContractBinding(input.bindingId);
    if (!binding) {
      throw new NotFoundError(`Contract binding not found: ${input.bindingId}`);
    }
    abi = binding.abi;
  }

  // Validate ABI
  const abiResult = contractValidationService.validateAbi(abi);
  if (!abiResult.valid) {
    const errorMessages = abiResult.errors.map((e) => e.message).join(', ');
    throw new ValidationError(`Invalid ABI: ${errorMessages}`);
  }

  // Check function exists in ABI
  const functionExists = abi.some((f) => f.name === input.functionName);
  if (!functionExists) {
    throw new ValidationError(`Function '${input.functionName}' not found in ABI`);
  }

  // Execute read
  const result = await contractReadService.readContract(
    input.chainId,
    contractValidationService.normalizeAddress(input.address),
    input.functionName,
    input.args,
    abi,
    { skipCache: input.skipCache }
  );

  if (!result.success) {
    logger.warn(
      { chainId: input.chainId, address: input.address, functionName: input.functionName, error: result.error },
      'Contract read failed'
    );
  }

  res.json({
    success: true,
    data: result,
    meta: {
      chainId: input.chainId,
      chainName: getChainName(input.chainId),
      address: contractValidationService.normalizeAddress(input.address),
      functionName: input.functionName,
    },
  });
});

// =============================================================================
// Token Metadata
// =============================================================================

/**
 * GET /api/web3/token/:chainId/:address
 * Get ERC20 token metadata
 *
 * @returns Token name, symbol, decimals, totalSupply
 */
web3Router.get('/token/:chainId/:address', async (req: AuthenticatedRequest, res: Response) => {
  const chainIdResult = chainIdParamSchema.safeParse(req.params.chainId);
  if (!chainIdResult.success) {
    throw new ValidationError('Invalid chain ID');
  }
  const chainId = chainIdResult.data;

  if (!isSupportedChainId(chainId)) {
    throw new ValidationError(`Unsupported chain ID: ${chainId}`);
  }

  const address = req.params.address;
  if (!address || !contractValidationService.isValidAddress(address)) {
    throw new ValidationError(`Invalid token address: ${address}`);
  }

  const normalizedAddress = contractValidationService.normalizeAddress(address);

  // Standard ERC20 metadata ABI
  const erc20MetadataAbi = [
    { type: 'function', name: 'name', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' as const },
    { type: 'function', name: 'symbol', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' as const },
    { type: 'function', name: 'decimals', inputs: [], outputs: [{ name: '', type: 'uint8' }], stateMutability: 'view' as const },
    { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' as const },
  ];

  // Fetch all metadata in parallel
  const [nameResult, symbolResult, decimalsResult, supplyResult] = await Promise.all([
    contractReadService.readContract(chainId, normalizedAddress, 'name', [], erc20MetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'symbol', [], erc20MetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'decimals', [], erc20MetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'totalSupply', [], erc20MetadataAbi),
  ]);

  // Check if this is actually an ERC20 token
  if (!nameResult.success && !symbolResult.success) {
    throw new ValidationError('Address does not appear to be a valid ERC20 token');
  }

  res.json({
    success: true,
    data: {
      chainId,
      chainName: getChainName(chainId),
      address: normalizedAddress,
      type: 'erc20',
      name: nameResult.success ? nameResult.data : null,
      symbol: symbolResult.success ? symbolResult.data : null,
      decimals: decimalsResult.success ? decimalsResult.data : 18,
      totalSupply: supplyResult.success ? String(supplyResult.data) : null,
    },
    cache: {
      name: nameResult.cached,
      symbol: symbolResult.cached,
      decimals: decimalsResult.cached,
      totalSupply: supplyResult.cached,
    },
  });
});

// =============================================================================
// NFT Collection Metadata
// =============================================================================

/**
 * GET /api/web3/nft/:chainId/:address
 * Get NFT collection metadata (ERC721 or ERC1155)
 *
 * @returns Collection name, symbol, totalSupply (if available)
 */
web3Router.get('/nft/:chainId/:address', async (req: AuthenticatedRequest, res: Response) => {
  const chainIdResult = chainIdParamSchema.safeParse(req.params.chainId);
  if (!chainIdResult.success) {
    throw new ValidationError('Invalid chain ID');
  }
  const chainId = chainIdResult.data;

  if (!isSupportedChainId(chainId)) {
    throw new ValidationError(`Unsupported chain ID: ${chainId}`);
  }

  const address = req.params.address;
  if (!address || !contractValidationService.isValidAddress(address)) {
    throw new ValidationError(`Invalid NFT address: ${address}`);
  }

  const normalizedAddress = contractValidationService.normalizeAddress(address);

  // Standard ERC721/ERC1155 metadata ABI
  const nftMetadataAbi = [
    { type: 'function', name: 'name', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' as const },
    { type: 'function', name: 'symbol', inputs: [], outputs: [{ name: '', type: 'string' }], stateMutability: 'view' as const },
    { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' as const },
    // ERC165 interface check
    { type: 'function', name: 'supportsInterface', inputs: [{ name: 'interfaceId', type: 'bytes4' }], outputs: [{ name: '', type: 'bool' }], stateMutability: 'view' as const },
  ];

  // ERC721 interface ID: 0x80ac58cd
  // ERC1155 interface ID: 0xd9b67a26
  const ERC721_INTERFACE = '0x80ac58cd';
  const ERC1155_INTERFACE = '0xd9b67a26';

  // Fetch metadata and interface checks in parallel
  const [nameResult, symbolResult, supplyResult, is721Result, is1155Result] = await Promise.all([
    contractReadService.readContract(chainId, normalizedAddress, 'name', [], nftMetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'symbol', [], nftMetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'totalSupply', [], nftMetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'supportsInterface', [ERC721_INTERFACE], nftMetadataAbi),
    contractReadService.readContract(chainId, normalizedAddress, 'supportsInterface', [ERC1155_INTERFACE], nftMetadataAbi),
  ]);

  // Determine contract type
  let contractType: 'erc721' | 'erc1155' | 'unknown' = 'unknown';
  if (is721Result.success && is721Result.data === true) {
    contractType = 'erc721';
  } else if (is1155Result.success && is1155Result.data === true) {
    contractType = 'erc1155';
  }

  res.json({
    success: true,
    data: {
      chainId,
      chainName: getChainName(chainId),
      address: normalizedAddress,
      type: contractType,
      name: nameResult.success ? nameResult.data : null,
      symbol: symbolResult.success ? symbolResult.data : null,
      totalSupply: supplyResult.success ? String(supplyResult.data) : null,
      interfaces: {
        erc721: is721Result.success ? is721Result.data : false,
        erc1155: is1155Result.success ? is1155Result.data : false,
      },
    },
    cache: {
      name: nameResult.cached,
      symbol: symbolResult.cached,
      totalSupply: supplyResult.cached,
    },
  });
});

// =============================================================================
// Ownership Verification
// =============================================================================

/**
 * POST /api/web3/verify-ownership
 * Verify token/NFT ownership for a wallet
 *
 * @body {chainId, walletAddress, contractAddress, tokenId?, minBalance?, contractType?}
 * @returns Ownership verification result
 */
web3Router.post('/verify-ownership', async (req: AuthenticatedRequest, res: Response) => {
  const inputResult = verifyOwnershipRequestSchema.safeParse(req.body);
  if (!inputResult.success) {
    const errors = inputResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new ValidationError(`Invalid request: ${errors}`);
  }

  const input = inputResult.data;

  // Validate chain ID
  if (!isSupportedChainId(input.chainId)) {
    throw new ValidationError(`Unsupported chain ID: ${input.chainId}`);
  }

  // Validate addresses
  if (!contractValidationService.isValidAddress(input.walletAddress)) {
    throw new ValidationError(`Invalid wallet address: ${input.walletAddress}`);
  }
  if (!contractValidationService.isValidAddress(input.contractAddress)) {
    throw new ValidationError(`Invalid contract address: ${input.contractAddress}`);
  }

  const normalizedWallet = contractValidationService.normalizeAddress(input.walletAddress);
  const normalizedContract = contractValidationService.normalizeAddress(input.contractAddress);

  let ownershipResult: {
    owns: boolean;
    balance: string;
    meetsMinimum: boolean;
    tokenIds?: string[];
  };

  // Handle based on contract type
  if (input.contractType === 'erc20' || (!input.contractType && !input.tokenId)) {
    // ERC20 balance check
    const balanceResult = await contractReadService.getTokenBalance(
      input.chainId,
      normalizedWallet,
      normalizedContract
    );

    if (!balanceResult.success) {
      throw new ValidationError(`Failed to check balance: ${balanceResult.error}`);
    }

    const balance = BigInt(balanceResult.data!.balance);
    const minBalance = input.minBalance ? BigInt(input.minBalance) : 0n;

    ownershipResult = {
      owns: balance > 0n,
      balance: balance.toString(),
      meetsMinimum: balance >= minBalance,
    };
  } else if (input.contractType === 'erc1155' && input.tokenId) {
    // ERC1155 specific token balance check
    const balanceResult = await contractReadService.getERC1155Balance(
      input.chainId,
      normalizedWallet,
      normalizedContract,
      input.tokenId
    );

    if (!balanceResult.success) {
      throw new ValidationError(`Failed to check ERC1155 balance: ${balanceResult.error}`);
    }

    const balance = balanceResult.data!;
    const minBalance = input.minBalance ? BigInt(input.minBalance) : 1n;

    ownershipResult = {
      owns: balance > 0n,
      balance: balance.toString(),
      meetsMinimum: balance >= minBalance,
      tokenIds: balance > 0n ? [input.tokenId] : [],
    };
  } else {
    // ERC721 ownership check
    const nftResult = await contractReadService.ownsNFT(
      input.chainId,
      normalizedWallet,
      normalizedContract,
      input.tokenId
    );

    if (!nftResult.success) {
      throw new ValidationError(`Failed to check NFT ownership: ${nftResult.error}`);
    }

    const count = nftResult.data!.count;
    const minBalance = input.minBalance ? parseInt(input.minBalance) : 1;

    ownershipResult = {
      owns: count > 0,
      balance: count.toString(),
      meetsMinimum: count >= minBalance,
      tokenIds: nftResult.data!.tokenIds,
    };
  }

  logger.debug(
    {
      chainId: input.chainId,
      wallet: normalizedWallet,
      contract: normalizedContract,
      owns: ownershipResult.owns,
    },
    'Ownership verification completed'
  );

  res.json({
    success: true,
    data: {
      chainId: input.chainId,
      chainName: getChainName(input.chainId),
      walletAddress: normalizedWallet,
      contractAddress: normalizedContract,
      contractType: input.contractType ?? 'auto',
      ...ownershipResult,
    },
  });
});

// =============================================================================
// Chain Health
// =============================================================================

/**
 * GET /api/web3/health
 * Get health status of all supported chains
 *
 * @returns Chain health status
 */
web3Router.get('/health', async (req: AuthenticatedRequest, res: Response) => {
  const { themeChainService } = await import('../../services/theme/ThemeChainService.js');

  const rpcHealth = themeChainService.getRpcHealth();
  const pooledClients = themeChainService.getPooledClients();

  // Group health by chain
  const chainHealth: Record<number, { healthy: boolean; endpoints: typeof rpcHealth }> = {};
  for (const health of rpcHealth) {
    if (!chainHealth[health.chainId]) {
      chainHealth[health.chainId] = { healthy: false, endpoints: [] };
    }
    const entry = chainHealth[health.chainId];
    if (entry) {
      entry.endpoints.push(health);
      if (health.isHealthy) {
        entry.healthy = true;
      }
    }
  }

  res.json({
    success: true,
    data: {
      overall: Object.values(chainHealth).every((c) => c.healthy),
      chains: chainHealth,
      pooledClients: pooledClients.length,
      clients: pooledClients,
    },
  });
});

// =============================================================================
// Supported Chains
// =============================================================================

/**
 * GET /api/web3/chains
 * Get list of supported chains with configuration
 *
 * @returns Supported chain configurations
 */
web3Router.get('/chains', async (req: AuthenticatedRequest, res: Response) => {
  const { getAllChainConfigs } = await import('../../config/chains.js');

  const chains = getAllChainConfigs();

  res.json({
    success: true,
    data: chains.map((chain) => ({
      chainId: chain.chainId,
      name: chain.name,
      blockExplorer: chain.blockExplorer,
      nativeCurrency: chain.nativeCurrency,
      // Don't expose RPC URLs
    })),
    count: chains.length,
  });
});
