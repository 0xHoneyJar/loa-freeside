/**
 * Wallet Address Normalization (Sprint 321, high-4)
 *
 * Policy: Accept any valid Ethereum address input, normalize to lowercase
 * for all storage and lookup. No EIP-55 checksum validation required
 * (addresses are identifiers, not user-facing display).
 */

/**
 * Normalize an Ethereum wallet address to lowercase.
 * Applied at every storage and lookup boundary.
 */
export const normalizeWallet = (addr: string): string => addr.toLowerCase();
