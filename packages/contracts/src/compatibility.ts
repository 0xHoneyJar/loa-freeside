/**
 * Compatibility Matrix + Version Negotiation
 * Cycle 019 Sprint 2, Task 2.2: Contract version compatibility validation
 *
 * Provides version compatibility checking between arrakis and loa-finn,
 * wired into the JWT claims path for fail-fast negotiation.
 *
 * @see Bridgebuilder Round 6, Finding #2 — Contract Protocol Nucleus
 */

import { satisfies } from './semver-lite.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type CompatibilityStatus = 'supported' | 'deprecated' | 'unsupported';

export interface CompatibilityEntry {
  arrakis_version: string;    // Semver range (e.g., ">=1.0.0 <2.0.0")
  loa_finn_version: string;   // Semver range
  contract_version: string;   // Exact version
  status: CompatibilityStatus;
  notes?: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  status?: CompatibilityStatus;
  reason?: string;
  contract_version?: string;
}

// --------------------------------------------------------------------------
// Compatibility Data
// --------------------------------------------------------------------------

const COMPATIBILITY_MATRIX: CompatibilityEntry[] = [
  {
    arrakis_version: '>=0.1.0',
    loa_finn_version: '>=0.1.0',
    contract_version: '1.0.0',
    status: 'supported',
    notes: 'Initial contract — base pool mapping, JWT claims, usage reports',
  },
  {
    arrakis_version: '>=0.1.0',
    loa_finn_version: '>=0.1.0',
    contract_version: '1.1.0',
    status: 'supported',
    notes: 'Per-model accounting — model_breakdown in usage reports (backward-compatible)',
  },
];

// --------------------------------------------------------------------------
// Functions
// --------------------------------------------------------------------------

/**
 * Get compatibility info for a given arrakis/loa-finn version pair.
 *
 * @returns The matching CompatibilityEntry or undefined if no match
 */
export function getCompatibility(
  arrakisVersion: string,
  loaFinnVersion: string,
): CompatibilityEntry | undefined {
  // Return the newest matching entry
  return [...COMPATIBILITY_MATRIX]
    .reverse()
    .find(
      (entry) =>
        satisfies(arrakisVersion, entry.arrakis_version) &&
        satisfies(loaFinnVersion, entry.loa_finn_version),
    );
}

/**
 * Validate contract version compatibility between arrakis and a peer.
 * Used in the JWT claims path for fail-fast negotiation (AC-2.21).
 *
 * @param contractVersion - The contract version to validate (from arrakis)
 * @param peerContractVersion - The peer's contract version (from loa-finn response)
 * @returns CompatibilityResult with compatible flag and reason
 */
export function validateContractCompatibility(
  contractVersion: string,
  peerContractVersion: string,
): CompatibilityResult {
  // Same version = always compatible
  if (contractVersion === peerContractVersion) {
    return { compatible: true, status: 'supported', contract_version: contractVersion };
  }

  // Check if both versions are in the matrix
  const ourEntry = COMPATIBILITY_MATRIX.find((e) => e.contract_version === contractVersion);
  const peerEntry = COMPATIBILITY_MATRIX.find((e) => e.contract_version === peerContractVersion);

  if (!ourEntry) {
    return {
      compatible: false,
      reason: `Unknown contract version: ${contractVersion}`,
    };
  }

  if (!peerEntry) {
    return {
      compatible: false,
      reason: `Unknown peer contract version: ${peerContractVersion}`,
    };
  }

  // Minor version differences within same major = compatible (semver)
  const ourParts = contractVersion.split('.').map(Number);
  const peerParts = peerContractVersion.split('.').map(Number);

  if (ourParts[0] === peerParts[0]) {
    // Same major version — backward compatible
    const newerVersion = ourParts[1]! >= peerParts[1]! ? contractVersion : peerContractVersion;
    return {
      compatible: true,
      status: 'supported',
      contract_version: newerVersion,
    };
  }

  // Major version mismatch
  return {
    compatible: false,
    status: 'unsupported',
    reason: `Major version mismatch: ${contractVersion} vs ${peerContractVersion}`,
  };
}
