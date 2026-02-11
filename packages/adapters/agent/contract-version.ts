/**
 * Contract Version — Single Source of Truth
 *
 * Reads the version from @arrakis/loa-finn-contract package.json.
 * This value is included as the `pool_mapping_version` JWT claim,
 * allowing loa-finn to detect version drift at runtime.
 *
 * @see SDD §3.1.5 Pool Mapping Version
 * @see Sprint 1, Task 1.2a
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Load contract version from the contract artifact package.
 * Falls back to '0.0.0' if the package is not installed (dev environments
 * without E2E test dependencies). The fallback triggers warn-mode in
 * loa-finn's PoolClaimValidator, which is the correct behavior for
 * unknown versions from known issuers.
 */
function loadContractVersion(): string {
  try {
    const pkg = require('@arrakis/loa-finn-contract/package.json') as { version: string };
    return pkg.version;
  } catch {
    // Contract package not installed — return fallback version.
    // loa-finn will treat this as unknown and enter warn mode (24h grace).
    return '0.0.0';
  }
}

/** Contract artifact version — used as pool_mapping_version JWT claim value */
export const CONTRACT_VERSION: string = loadContractVersion();
