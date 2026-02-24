/**
 * Consumer Contract Verification Tests
 *
 * Verifies that contract.json entrypoints match actual protocol barrel exports
 * and that the conformance vector bundle hash is current.
 *
 * Coverage:
 *   - AC-2.1: Contract pins exact module entrypoints
 *   - AC-2.2: Conformance vector bundle hash matches computed hash
 *   - AC-2.4: Function signatures available in barrel exports
 *   - Catches barrel drift in CI automatically
 *
 * @see grimoires/loa/sdd.md §3.2
 * @see grimoires/loa/sprint.md Sprint 3, Task 3.4
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Load contract from repo root
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const contractPath = join(REPO_ROOT, 'spec', 'contracts', 'contract.json');
const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));

// ---------------------------------------------------------------------------
// Entrypoint Availability Tests
// ---------------------------------------------------------------------------

describe('contract.json — entrypoint availability', () => {
  for (const ep of contract.entrypoints) {
    const { specifier, symbols } = ep;

    if (symbols.length === 0) {
      it(`${specifier}: no runtime symbols required (type-only)`, () => {
        // Type-only entrypoints have no runtime symbols to verify
        expect(symbols).toEqual([]);
      });
      continue;
    }

    describe(specifier, () => {
      // Dynamically import and check each symbol
      let mod: Record<string, unknown>;

      it(`can be imported`, async () => {
        mod = await import(specifier);
        expect(mod).toBeDefined();
      });

      for (const sym of symbols) {
        it(`exports "${sym}"`, async () => {
          if (!mod) {
            mod = await import(specifier);
          }
          expect(sym in mod).toBe(true);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Contract Metadata Tests
// ---------------------------------------------------------------------------

describe('contract.json — metadata', () => {
  it('contract_version is valid semver', () => {
    const semverPattern = /^\d+\.\d+\.\d+$/;
    expect(contract.contract_version).toMatch(semverPattern);
  });

  it('provider_version_range floor is at or below installed hounfour version', () => {
    // Extract the floor version from the range (e.g., ">=7.0.0" → "7.0.0")
    const rangeMatch = contract.provider_version_range.match(/>=?\s*(\d+\.\d+\.\d+)/);
    expect(rangeMatch).not.toBeNull();

    const floorVersion = rangeMatch![1];
    // Read actual installed version
    const hounfourPkgPaths = execSync(
      'find node_modules -path "*/@0xhoneyjar/loa-hounfour/package.json" -not -path "*/.pnpm/*" 2>/dev/null || find ../../node_modules -path "*/@0xhoneyjar/loa-hounfour/package.json" | head -1',
      { cwd: join(REPO_ROOT, 'themes', 'sietch'), encoding: 'utf-8' },
    ).trim();

    if (hounfourPkgPaths) {
      const firstPath = hounfourPkgPaths.split('\n')[0];
      const hounfourPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'themes', 'sietch', firstPath), 'utf-8'));
      const installedVersion = hounfourPkg.version;

      // Compare major.minor.patch — floor must be <= installed
      const floorParts = floorVersion.split('.').map(Number);
      const installedParts = installedVersion.split('.').map(Number);

      const floorIsAtOrBelowInstalled =
        floorParts[0] < installedParts[0] ||
        (floorParts[0] === installedParts[0] && floorParts[1] < installedParts[1]) ||
        (floorParts[0] === installedParts[0] && floorParts[1] === installedParts[1] && floorParts[2] <= installedParts[2]);

      expect(floorIsAtOrBelowInstalled).toBe(true);
    }
    // If we can't find the package, the import tests above already verify availability
  });

  it('informational counts are not gating criteria (AC-2.7)', () => {
    expect(contract.metadata.informational_only).toBeDefined();
    expect(contract.metadata.informational_only.note).toContain('not gating criteria');
  });
});

// ---------------------------------------------------------------------------
// Conformance Vector Bundle Hash
// ---------------------------------------------------------------------------

describe('contract.json — conformance vectors bundle hash', () => {
  it('bundle_hash matches computed hash from spec/vectors/*.json', () => {
    const vectorsDir = join(REPO_ROOT, 'spec', 'vectors');

    // Read all JSON files in sorted order, hash each, then hash the combined output
    const vectorFiles = readdirSync(vectorsDir)
      .filter((f) => f.endsWith('.json'))
      .sort();

    expect(vectorFiles.length).toBeGreaterThan(0);

    // Replicate: find spec/vectors/ -name '*.json' -type f | sort | xargs sha256sum | sha256sum
    const individualHashes = vectorFiles.map((f) => {
      const content = readFileSync(join(vectorsDir, f));
      const hash = createHash('sha256').update(content).digest('hex');
      // Use relative path matching sha256sum output: spec/vectors/<file>
      return `${hash}  ${join('spec', 'vectors', f)}`;
    });

    const combinedInput = individualHashes.join('\n') + '\n';
    const bundleHash = createHash('sha256').update(combinedInput).digest('hex');

    expect(contract.conformance_vectors.bundle_hash).toBe(bundleHash);
  });

  it('vector_count matches actual file count', () => {
    const vectorsDir = join(REPO_ROOT, 'spec', 'vectors');
    const vectorFiles = readdirSync(vectorsDir).filter((f) => f.endsWith('.json'));
    expect(contract.conformance_vectors.vector_count).toBe(vectorFiles.length);
  });
});
