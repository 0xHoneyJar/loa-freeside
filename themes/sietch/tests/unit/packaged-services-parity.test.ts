/**
 * repo-root packages/services: test resolution vs production packaging parity.
 *
 * Route files reach repo-root `packages/services` through a 4-up relative
 * specifier (`../../../../packages/services/x.js`). Three things have to agree
 * for that to work in production, and each is maintained in a different file:
 *
 *   1. `themes/packages/services/x.d.ts`  — the compile stub, satisfies tsc
 *   2. `vitest.workspace.ts` alias        — resolves the specifier under test
 *   3. `Dockerfile` esbuild list          — emits the .js production loads
 *
 * (1) and (2) will happily go green without (3). `event-sourcing-service` did
 * exactly that: aliased for tests, stubbed for the compiler, never built into
 * the image, so `runVerificationAsync`'s dynamic import would have thrown
 * ERR_MODULE_NOT_FOUND on the deployed /communities/:id/events/verify job while
 * CI stayed green. A dynamic import inside an async function is invisible to
 * both the type checker and every test that does not execute that branch.
 *
 * This asserts the invariant directly: anything the test alias can resolve, the
 * image must also build.
 *
 * Origin: PR #428 review thread T70 / comment 5088281843.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SIETCH_ROOT = join(__dirname, '..', '..');

/** Module basenames the vitest workspace maps to real implementations. */
function aliasedServiceModules(): string[] {
  const src = readFileSync(join(SIETCH_ROOT, 'vitest.workspace.ts'), 'utf8');
  // The alias is a regex literal with the modules as an alternation group:
  //   /^(?:\.\.\/)+packages\/services\/(a|b|c)\.js$/
  const group = /packages\\\/services\\\/\(([^)]+)\)/.exec(src);
  if (!group) throw new Error('packages/services alias not found in vitest.workspace.ts');
  return group[1].split('|').map((s) => s.trim()).filter(Boolean);
}

/** Module basenames the production image compiles into /packages/services. */
function packagedServiceModules(): string[] {
  const dockerfile = readFileSync(join(SIETCH_ROOT, 'Dockerfile'), 'utf8');
  return [...dockerfile.matchAll(/\/repo\/packages\/services\/([\w-]+)\.ts/g)].map((m) => m[1]);
}

describe('packages/services test resolution matches production packaging', () => {
  it('every module the vitest alias resolves is built into the image', () => {
    const aliased = aliasedServiceModules();
    const packaged = packagedServiceModules();

    expect(aliased.length).toBeGreaterThan(0);
    expect(packaged.length).toBeGreaterThan(0);

    const missing = aliased.filter((m) => !packaged.includes(m));
    expect(
      missing,
      `aliased in vitest.workspace.ts but not built by the Dockerfile: ${missing.join(', ')}. ` +
        'Tests would resolve these; production would throw ERR_MODULE_NOT_FOUND. ' +
        'Add them to the esbuild list.',
    ).toEqual([]);
  });

  it('every module the image builds has a source file to build', () => {
    // Catches the reverse drift: a renamed/removed source silently producing an
    // esbuild failure only at image-build time.
    const repoServices = join(SIETCH_ROOT, '..', '..', 'packages', 'services');
    for (const mod of packagedServiceModules()) {
      expect(() => readFileSync(join(repoServices, `${mod}.ts`), 'utf8')).not.toThrow();
    }
  });
});
