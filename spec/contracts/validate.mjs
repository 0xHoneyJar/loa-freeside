#!/usr/bin/env node
/**
 * Consumer Contract Validator
 *
 * Validates that the installed hounfour version satisfies the consumer contract
 * by dynamically importing each entrypoint specifier and checking for named exports.
 *
 * ESM-compatible: uses import() for resolution, works with package.json exports maps.
 *
 * Usage:
 *   node spec/contracts/validate.mjs                    # uses installed package
 *   node spec/contracts/validate.mjs --run-vectors      # also run conformance tests
 *
 * For hounfour CI: install freeside's contract as a devDependency, then:
 *   pnpm install   # installs hounfour candidate
 *   node node_modules/loa-freeside/spec/contracts/validate.mjs
 *
 * @see SDD cycle-040 §3.2.4
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(await readFile(join(__dirname, 'contract.json'), 'utf-8'));

console.log('=== Consumer Contract Validation ===');
console.log(`Contract version: ${contract.contract_version}`);
console.log(`Provider range: ${contract.provider_version_range}`);

let failures = 0;

// 1. Verify entrypoint availability via dynamic import()
console.log('\n--- Entrypoint Availability ---');
for (const ep of contract.entrypoints) {
  const { specifier, symbols } = ep;
  try {
    const mod = await import(specifier);
    for (const sym of symbols) {
      if (!(sym in mod)) {
        console.log(`FAIL: ${specifier}.${sym} not found in exports`);
        failures++;
      }
    }
  } catch (err) {
    console.log(`FAIL: Cannot import ${specifier}: ${err.message}`);
    failures += symbols.length;
  }
}

if (failures === 0) {
  console.log('PASS: All entrypoints available');
}

// 2. Conformance vectors (optional — consumer CI only, requires vitest + full repo)
const runVectors = process.argv.includes('--run-vectors');
if (runVectors) {
  console.log('\n--- Conformance Vectors ---');
  // Resolve repo root: explicit --repo-root arg or cwd
  const repoRootIdx = process.argv.indexOf('--repo-root');
  const repoRoot = repoRootIdx !== -1 ? process.argv[repoRootIdx + 1] : process.cwd();

  const { execSync } = await import('node:child_process');
  try {
    execSync('npx vitest run spec/conformance/ --reporter=verbose', {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  } catch {
    console.log('FAIL: Conformance vector suite failed');
    failures++;
  }
}

// 3. Report
console.log('\n=== Result ===');
if (failures === 0) {
  console.log('PASS: Contract satisfied');
  process.exit(0);
} else {
  console.log(`FAIL: ${failures} failures detected`);
  process.exit(1);
}
