/**
 * Three-Layer Drift Detection (Task 303.1, Sprint 303)
 *
 * Detects drift between arrakis protocol layer and canonical loa-hounfour.
 *
 * UPGRADE PROCEDURE:
 * When upgrading loa-hounfour to a new version:
 * 1. Update EXPECTED_SHA to the new commit SHA
 * 2. Update CONTRACT_VERSION assertion if version changes
 * 3. Update ALLOWED_FILES if new arrakis extension modules are added
 * 4. Run this test to verify all three layers pass
 * 5. Run full `npm test` to verify no regressions
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACT_VERSION } from '../../../src/packages/core/protocol/arrakis-compat.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXPECTED_SHA = 'd091a3c0d4802402825fc7765bcc888f2477742f';

/**
 * Find an installed package's package.json by walking up the directory tree
 * and checking each node_modules directory. This bypasses the package exports
 * map (which often omits ./package.json) by using direct filesystem access.
 */
function findInstalledPackageJson(packageName: string, startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const candidate = join(dir, 'node_modules', packageName, 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  throw new Error(`Could not find installed package ${packageName} from ${startDir}`);
}

describe('Three-Layer Drift Detection (Task 303.1)', () => {

  // ===========================================================================
  // Layer 1: CONTRACT_VERSION check
  // ===========================================================================

  describe('Layer 1: CONTRACT_VERSION', () => {
    it('CONTRACT_VERSION is 7.0.0', () => {
      expect(CONTRACT_VERSION).toBe('7.0.0');
    });
  });

  // ===========================================================================
  // Layer 2: Installed package version matches expected commit SHA
  // ===========================================================================

  describe('Layer 2: installed package version matches expected commit SHA', () => {
    it('installed package version matches expected commit SHA', () => {
      // Strategy 1: Check gitHead in the installed package.json.
      // The package exports map does not expose ./package.json, so we walk
      // up node_modules directories from the test file to find the package.
      const pkgPath = findInstalledPackageJson('@0xhoneyjar/loa-hounfour', __dirname);
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      if (pkg.gitHead) {
        expect(pkg.gitHead).toBe(EXPECTED_SHA);
        return;
      }

      // Strategy 2 (fallback): Check the dependency reference in the local
      // themes/sietch/package.json or the monorepo root package.json.
      // GitHub tarball installs commonly lack gitHead, so we verify the SHA
      // is present in the dependency specifier itself.
      const localPkgPath = join(__dirname, '../../../package.json');
      const localPkg = JSON.parse(readFileSync(localPkgPath, 'utf-8'));
      const dep =
        localPkg.dependencies?.['@0xhoneyjar/loa-hounfour'] ||
        localPkg.devDependencies?.['@0xhoneyjar/loa-hounfour'] ||
        '';

      if (dep && dep.includes(EXPECTED_SHA)) {
        expect(dep).toContain(EXPECTED_SHA);
        return;
      }

      // Strategy 3 (last resort): Check the monorepo root package.json
      const rootPkgPath = join(__dirname, '../../../../../package.json');
      const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
      const rootDep =
        rootPkg.dependencies?.['@0xhoneyjar/loa-hounfour'] ||
        rootPkg.devDependencies?.['@0xhoneyjar/loa-hounfour'] ||
        '';

      expect(rootDep).toContain(EXPECTED_SHA);
    });
  });

  // ===========================================================================
  // Layer 3: No vendored protocol files remain (allowlist for arrakis extensions)
  // ===========================================================================

  describe('Layer 3: no vendored protocol files remain', () => {
    // Allowlist: arrakis extension modules + KEEP files from export audit
    const ALLOWED_FILES = new Set([
      // Arrakis extension modules (Sprint 300)
      'arrakis-arithmetic.ts',
      'arrakis-compat.ts',
      'arrakis-conservation.ts',
      // KEEP files (local to arrakis, different from v7.0.0)
      'billing-types.ts',
      'billing-entry.ts',
      'guard-types.ts',
      'state-machines.ts',
      'config-schema.ts',
      'economic-events.ts',
      'identity-trust.ts',
      'atomic-counter.ts',
      'jwt-boundary.ts',
      // Barrel
      'index.ts',
    ]);

    // DELETED files that should NOT exist
    const DELETED_FILES = [
      'arithmetic.ts',
      'compatibility.ts',
      'conservation-properties.ts',
      'VENDORED.md',
    ];

    it('deleted vendored files do not exist', () => {
      const protocolDir = join(__dirname, '../../../src/packages/core/protocol');
      const files = readdirSync(protocolDir);

      for (const deleted of DELETED_FILES) {
        expect(files, `vendored file '${deleted}' should have been deleted`).not.toContain(deleted);
      }
    });

    it('every .ts file in protocol/ is in the allowlist', () => {
      const protocolDir = join(__dirname, '../../../src/packages/core/protocol');
      const files = readdirSync(protocolDir);
      const tsFiles = files.filter((f) => f.endsWith('.ts'));

      for (const f of tsFiles) {
        expect(
          ALLOWED_FILES.has(f),
          `unexpected file '${f}' in protocol/ — add to ALLOWED_FILES or remove the file`,
        ).toBe(true);
      }
    });

    it('allowlist is not empty (sanity check)', () => {
      expect(ALLOWED_FILES.size).toBeGreaterThan(0);
    });

    it('protocol directory exists and contains files', () => {
      const protocolDir = join(__dirname, '../../../src/packages/core/protocol');
      const files = readdirSync(protocolDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });
});
