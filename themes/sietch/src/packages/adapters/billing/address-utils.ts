/**
 * Address Utilities — EIP-55 Checksum Normalization
 *
 * Storage normalization for Ethereum addresses (20-byte hex).
 * Accepts any valid hex address and returns consistent EIP-55 format.
 * This is NOT a validation gate — binding does not fail on non-checksummed input.
 *
 * Uses viem's getAddress() for spec-compliant EIP-55 checksumming
 * (keccak-256 based mixed-case encoding per EIP-55).
 *
 * SDD refs: §4.2.2 EIP-55 Normalization
 * PRD refs: FR-2.2, NFR-2
 * Sprint refs: Sprint 287, Task 4.1
 *
 * @module adapters/billing/address-utils
 */

import { getAddress, isAddress } from 'viem';

/**
 * Validate that a string is a well-formed Ethereum address.
 * Accepts: 0x prefix + 40 hex characters (case-insensitive).
 * Rejects: wrong length, non-hex chars, missing 0x prefix.
 */
export function isValidAddress(address: string): boolean {
  return isAddress(address);
}

/**
 * Normalize an Ethereum address to EIP-55 checksummed format.
 * Input must be a valid address (use isValidAddress() first).
 *
 * @throws {Error} if address is not a valid hex address
 */
export function normalizeAddress(address: string): string {
  if (!isValidAddress(address)) {
    throw new Error(`Invalid Ethereum address: ${address}`);
  }
  return getAddress(address);
}
