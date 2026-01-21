/**
 * Contract Validation Service
 *
 * Validates contract addresses and ABIs for theme builder.
 * Sprint 3: Web3 Layer - Chain Service
 *
 * Features:
 * - Address format validation
 * - Checksum validation and normalization
 * - Zero address rejection
 * - Malicious address blocklist
 * - ABI validation (view/pure functions only)
 * - No receive/fallback functions allowed
 *
 * @see grimoires/loa/sdd.md §8.1 Contract Validation
 */

import { isAddress, getAddress, type Address } from 'viem';
import { logger } from '../../utils/logger.js';
import { isSupportedChainId, getChainName } from '../../config/chains.js';
import type {
  ContractValidationResult,
  ContractValidationError,
  ContractValidationWarning,
  ContractAbiFragment,
  ContractType,
  AbiInput,
  AbiOutput,
} from '../../types/theme-web3.types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Zero address - rejected for safety
 */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Dead address - commonly used for burns, rejected
 */
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

/**
 * Maximum ABI fragments to accept (prevent DoS)
 */
const MAX_ABI_FRAGMENTS = 100;

/**
 * Maximum ABI inputs per function
 */
const MAX_FUNCTION_INPUTS = 10;

/**
 * Common ERC function signatures for type detection
 */
const ERC_SIGNATURES = {
  erc20: ['balanceOf', 'totalSupply', 'decimals', 'symbol', 'name', 'transfer', 'approve'],
  erc721: ['balanceOf', 'ownerOf', 'tokenURI', 'safeTransferFrom', 'approve', 'getApproved'],
  erc1155: ['balanceOf', 'balanceOfBatch', 'uri', 'safeTransferFrom', 'safeBatchTransferFrom'],
} as const;

// =============================================================================
// Malicious Address Blocklist
// =============================================================================

/**
 * Known malicious/scam contract addresses
 *
 * Sources:
 * - Etherscan scam labels
 * - Community reports
 * - Internal security audits
 *
 * This list should be updated periodically.
 */
const MALICIOUS_ADDRESS_LIST: string[] = [
  // Common phishing contracts (examples - add real addresses)
  // '0x...',
];

const MALICIOUS_ADDRESSES: Set<string> = new Set(
  MALICIOUS_ADDRESS_LIST.map((addr) => addr.toLowerCase())
);

/**
 * Add an address to the blocklist (for dynamic updates)
 */
export function addToBlocklist(address: string): void {
  if (isAddress(address)) {
    MALICIOUS_ADDRESSES.add(address.toLowerCase());
    logger.info({ address }, 'Address added to blocklist');
  }
}

/**
 * Check if an address is blocklisted
 */
export function isBlocklisted(address: string): boolean {
  return MALICIOUS_ADDRESSES.has(address.toLowerCase());
}

// =============================================================================
// Types
// =============================================================================

/**
 * Input for contract validation
 */
export interface ValidateContractInput {
  chainId: number;
  address: string;
  abi?: ContractAbiFragment[];
}

/**
 * ABI validation result
 */
export interface AbiValidationResult {
  valid: boolean;
  readFunctions: string[];
  errors: ContractValidationError[];
  warnings: ContractValidationWarning[];
}

// =============================================================================
// ContractValidationService
// =============================================================================

/**
 * ContractValidationService - Contract and ABI validation
 *
 * Validates contracts before they can be used in themes.
 * Security-first approach: only allow safe, read-only operations.
 *
 * @example
 * ```ts
 * const service = new ContractValidationService();
 *
 * // Validate address
 * const result = await service.validateContract({
 *   chainId: 1,
 *   address: '0x...',
 *   abi: [...]
 * });
 *
 * if (!result.valid) {
 *   console.error(result.errors);
 * }
 * ```
 */
export class ContractValidationService {
  // ===========================================================================
  // Public Methods
  // ===========================================================================

  /**
   * Validate a contract for use in theme builder
   *
   * @param input - Validation input
   * @returns Validation result with errors and warnings
   */
  validateContract(input: ValidateContractInput): ContractValidationResult {
    const errors: ContractValidationError[] = [];
    const warnings: ContractValidationWarning[] = [];
    let readFunctions: string[] = [];
    let detectedType: ContractType | undefined;

    // 1. Validate chain ID
    if (!isSupportedChainId(input.chainId)) {
      errors.push({
        code: 'UNSUPPORTED_CHAIN',
        message: `Chain ID ${input.chainId} is not supported`,
      });
    }

    // 2. Validate address format
    if (!isAddress(input.address)) {
      errors.push({
        code: 'INVALID_ADDRESS',
        message: `Invalid address format: ${input.address}`,
      });
      return { valid: false, readFunctions, errors, warnings };
    }

    // 3. Reject zero/dead addresses
    const normalizedAddress = input.address.toLowerCase();
    if (normalizedAddress === ZERO_ADDRESS.toLowerCase()) {
      errors.push({
        code: 'INVALID_ADDRESS',
        message: 'Zero address is not allowed',
      });
    }

    if (normalizedAddress === DEAD_ADDRESS.toLowerCase()) {
      errors.push({
        code: 'INVALID_ADDRESS',
        message: 'Dead address is not allowed',
      });
    }

    // 4. Check blocklist
    if (isBlocklisted(input.address)) {
      errors.push({
        code: 'BLOCKLISTED',
        message: 'This address is on the blocklist due to security concerns',
      });
    }

    // 5. Validate ABI if provided
    if (input.abi && input.abi.length > 0) {
      const abiResult = this.validateAbi(input.abi);
      errors.push(...abiResult.errors);
      warnings.push(...abiResult.warnings);
      readFunctions = abiResult.readFunctions;

      if (abiResult.valid && readFunctions.length > 0) {
        detectedType = this.detectContractType(readFunctions);
      }
    } else {
      warnings.push({
        code: 'NO_READ_FUNCTIONS',
        message: 'No ABI provided - contract type cannot be verified',
      });
    }

    return {
      valid: errors.length === 0,
      type: detectedType,
      readFunctions,
      errors,
      warnings,
    };
  }

  /**
   * Validate an ABI for theme builder use
   *
   * Only allows view/pure functions. Rejects:
   * - Payable functions
   * - State-changing functions
   * - receive/fallback
   * - Constructor
   *
   * @param abi - ABI fragments to validate
   * @returns Validation result
   */
  validateAbi(abi: ContractAbiFragment[]): AbiValidationResult {
    const errors: ContractValidationError[] = [];
    const warnings: ContractValidationWarning[] = [];
    const readFunctions: string[] = [];

    // Check size limits
    if (abi.length > MAX_ABI_FRAGMENTS) {
      errors.push({
        code: 'INVALID_ABI',
        message: `ABI too large: ${abi.length} fragments (max: ${MAX_ABI_FRAGMENTS})`,
      });
      return { valid: false, readFunctions, errors, warnings };
    }

    for (const fragment of abi) {
      // Only allow function types
      if (fragment.type !== 'function') {
        errors.push({
          code: 'INVALID_ABI',
          message: `Only function fragments allowed, got: ${fragment.type}`,
        });
        continue;
      }

      // Only allow view/pure functions
      if (fragment.stateMutability !== 'view' && fragment.stateMutability !== 'pure') {
        errors.push({
          code: 'INVALID_ABI',
          message: `Function '${fragment.name}' must be view or pure, got: ${fragment.stateMutability}`,
        });
        continue;
      }

      // Validate inputs
      if (fragment.inputs && fragment.inputs.length > MAX_FUNCTION_INPUTS) {
        warnings.push({
          code: 'COMPLEX_ABI',
          message: `Function '${fragment.name}' has many inputs (${fragment.inputs.length})`,
        });
      }

      // Validate input types
      if (fragment.inputs) {
        for (const input of fragment.inputs) {
          if (!this.isValidAbiType(input.type)) {
            errors.push({
              code: 'INVALID_ABI',
              message: `Invalid input type '${input.type}' in function '${fragment.name}'`,
            });
          }
        }
      }

      // Validate output types
      if (fragment.outputs) {
        for (const output of fragment.outputs) {
          if (!this.isValidAbiType(output.type)) {
            errors.push({
              code: 'INVALID_ABI',
              message: `Invalid output type '${output.type}' in function '${fragment.name}'`,
            });
          }
        }
      }

      // This function is valid
      readFunctions.push(fragment.name);
    }

    if (readFunctions.length === 0 && errors.length === 0) {
      warnings.push({
        code: 'NO_READ_FUNCTIONS',
        message: 'ABI contains no valid read functions',
      });
    }

    return {
      valid: errors.length === 0,
      readFunctions,
      errors,
      warnings,
    };
  }

  /**
   * Normalize an address to checksummed format
   *
   * @param address - Address to normalize
   * @returns Checksummed address
   * @throws Error if address is invalid
   */
  normalizeAddress(address: string): Address {
    if (!isAddress(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
    return getAddress(address);
  }

  /**
   * Validate address format only (quick check)
   */
  isValidAddress(address: string): boolean {
    return isAddress(address);
  }

  /**
   * Check if address is a contract (not just EOA)
   *
   * Note: This requires an RPC call. Use sparingly.
   *
   * @param chainId - Chain ID
   * @param address - Address to check
   * @param getCode - Function to get bytecode (injected for testing)
   * @returns true if address has code
   */
  async isContract(
    chainId: number,
    address: string,
    getCode: (address: Address) => Promise<string>
  ): Promise<boolean> {
    if (!isAddress(address)) {
      return false;
    }

    try {
      const code = await getCode(getAddress(address));
      return code !== '0x' && code !== '0x0' && code.length > 2;
    } catch {
      return false;
    }
  }

  /**
   * Detect contract type from read functions
   */
  detectContractType(readFunctions: string[]): ContractType {
    const functionSet = new Set(readFunctions.map((f) => f.toLowerCase()));

    // Check ERC1155 first (it's most specific)
    const erc1155Matches = ERC_SIGNATURES.erc1155.filter((sig) =>
      functionSet.has(sig.toLowerCase())
    );
    if (erc1155Matches.length >= 3) {
      return 'erc1155';
    }

    // Check ERC721
    const erc721Matches = ERC_SIGNATURES.erc721.filter((sig) =>
      functionSet.has(sig.toLowerCase())
    );
    if (erc721Matches.length >= 3) {
      return 'erc721';
    }

    // Check ERC20
    const erc20Matches = ERC_SIGNATURES.erc20.filter((sig) =>
      functionSet.has(sig.toLowerCase())
    );
    if (erc20Matches.length >= 3) {
      return 'erc20';
    }

    return 'custom';
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Validate a Solidity type string
   */
  private isValidAbiType(type: string): boolean {
    // Basic type patterns
    const validPatterns = [
      /^u?int(\d+)?$/,          // int, uint, int256, uint256
      /^bytes(\d+)?$/,          // bytes, bytes32
      /^address$/,              // address
      /^bool$/,                 // bool
      /^string$/,               // string
      /^tuple$/,                // tuple (struct)
      /^.+\[\]$/,               // arrays
      /^.+\[\d+\]$/,            // fixed arrays
    ];

    const normalizedType = type.replace(/\s/g, '').toLowerCase();

    return validPatterns.some((pattern) => pattern.test(normalizedType));
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Default ContractValidationService instance
 */
export const contractValidationService = new ContractValidationService();
