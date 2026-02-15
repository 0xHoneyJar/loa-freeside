/**
 * Vendored loa-hounfour Compatibility Check
 *
 * Cross-service protocol version compatibility validation.
 * Used at startup to verify arrakis and loa-finn agree on protocol version.
 *
 * Vendored from: loa-hounfour (pinned commit — see VENDORED.md)
 *
 * @module packages/core/protocol/compatibility
 */

// =============================================================================
// Protocol Version
// =============================================================================

/**
 * Current protocol version for this vendored snapshot.
 * Follows semver: MAJOR.MINOR.PATCH
 *
 * - MAJOR: Breaking wire format changes (incompatible)
 * - MINOR: Additive changes (backward compatible)
 * - PATCH: Bug fixes, doc updates
 */
export const PROTOCOL_VERSION = '4.6.0';

// =============================================================================
// Compatibility Result
// =============================================================================

export interface CompatibilityResult {
  /** Whether the versions are compatible */
  compatible: boolean;
  /** Local version */
  localVersion: string;
  /** Remote version */
  remoteVersion: string;
  /** Compatibility level */
  level: 'exact' | 'minor_compatible' | 'incompatible';
  /** Human-readable message */
  message: string;
}

// =============================================================================
// Version Parsing
// =============================================================================

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(version: string): SemVer | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  };
}

// =============================================================================
// Compatibility Check
// =============================================================================

/**
 * Validate compatibility between local and remote protocol versions.
 *
 * Rules:
 * - Same MAJOR.MINOR → compatible (exact or patch difference)
 * - Same MAJOR, different MINOR → compatible (minor_compatible)
 * - Different MAJOR → incompatible
 *
 * @param localVersion - Local vendored protocol version
 * @param remoteVersion - Remote service protocol version from /health
 */
export function validateCompatibility(
  localVersion: string,
  remoteVersion: string,
): CompatibilityResult {
  const local = parseSemVer(localVersion);
  const remote = parseSemVer(remoteVersion);

  if (!local || !remote) {
    return {
      compatible: false,
      localVersion,
      remoteVersion,
      level: 'incompatible',
      message: `Invalid version format: local=${localVersion}, remote=${remoteVersion}`,
    };
  }

  // Different major version → breaking change
  if (local.major !== remote.major) {
    return {
      compatible: false,
      localVersion,
      remoteVersion,
      level: 'incompatible',
      message: `Major version mismatch: local=${localVersion}, remote=${remoteVersion}`,
    };
  }

  // Same major, same minor → fully compatible
  if (local.minor === remote.minor) {
    return {
      compatible: true,
      localVersion,
      remoteVersion,
      level: local.patch === remote.patch ? 'exact' : 'exact',
      message: local.patch === remote.patch
        ? `Exact match: ${localVersion}`
        : `Patch difference: local=${localVersion}, remote=${remoteVersion}`,
    };
  }

  // Same major, different minor → backward compatible
  return {
    compatible: true,
    localVersion,
    remoteVersion,
    level: 'minor_compatible',
    message: `Minor version difference: local=${localVersion}, remote=${remoteVersion}. Backward compatible.`,
  };
}
