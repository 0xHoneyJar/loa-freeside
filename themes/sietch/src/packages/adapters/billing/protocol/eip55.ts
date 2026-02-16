/**
 * EIP-55 Checksum Validation — Mixed-Case Address Encoding
 *
 * Validates Ethereum addresses against the EIP-55 mixed-case checksum
 * using viem's getAddress() which uses keccak256 internally.
 *
 * Accepts: valid checksummed addresses, all-lowercase addresses.
 * Rejects: mixed-case addresses that fail the EIP-55 checksum.
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Task 16.4 (BB-67-006)
 *
 * @module packages/adapters/billing/protocol/eip55
 */

import { getAddress, isAddress } from 'viem';

/**
 * Validate an Ethereum address for EIP-55 checksum correctness.
 *
 * - All-lowercase (0x + 40 hex chars): accepted (normalized form)
 * - Mixed-case: must match EIP-55 checksum encoding (keccak256-based)
 *
 * @returns true if the address is valid
 */
export function validateEIP55Checksum(address: string): boolean {
  // Basic format check
  if (!isAddress(address, { strict: false })) {
    return false;
  }

  const stripped = address.slice(2);

  // All-lowercase: always valid (normalized form, no checksum to verify)
  if (stripped === stripped.toLowerCase()) {
    return true;
  }

  // Mixed-case or all-uppercase: must match EIP-55 checksum
  try {
    const checksummed = getAddress(address.toLowerCase());
    return address === checksummed;
  } catch {
    return false;
  }
}

/**
 * Normalize an Ethereum address to lowercase.
 * Returns null if the address is invalid.
 */
export function normalizeAddress(address: string): string | null {
  if (!validateEIP55Checksum(address)) {
    return null;
  }
  return address.toLowerCase();
}
