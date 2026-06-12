#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const canonPath = join(__dirname, '../src/vendor/canon.mjs');

const legbaCorePath = process.argv[2];

// Extract pinned SHA from canon.mjs
const canonSource = readFileSync(canonPath, 'utf8');
const match = canonSource.match(/@ ([0-9a-f]{40})/);

if (!match) {
  console.error("Error: Could not find pinned SHA in src/vendor/canon.mjs");
  process.exit(1);
}

const pinnedSha = match[1];

// Internal consistency (sprint 2.4): the conformance golden's `generated_from`
// SHA must equal the canon pin. If a re-vendor moved one but not the other, the
// package's own provenance is incoherent — a fail, not a warn, even with no
// legba checkout present.
const goldenPath = join(__dirname, '../test/fixtures/canon-golden.json');
if (existsSync(goldenPath)) {
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const goldenShaMatch = String(golden.generated_from ?? '').match(/[0-9a-f]{40}/);
  if (!goldenShaMatch) {
    console.error('Error: conformance golden has no resolvable source SHA in generated_from');
    process.exit(1);
  }
  if (goldenShaMatch[0] !== pinnedSha) {
    console.error('INTERNAL DRIFT: canon pin != conformance golden generated_from SHA');
    console.error(`  canon pin:         ${pinnedSha}`);
    console.error(`  golden generated:  ${goldenShaMatch[0]}`);
    process.exit(1);
  }
}

if (!legbaCorePath) {
  console.error(`Warning: No legba-core path provided. (Pinned to ${pinnedSha})`);
  process.exit(3);
}

if (!existsSync(legbaCorePath)) {
  console.error(`Warning: Provided path does not exist: ${legbaCorePath}`);
  process.exit(3);
}

try {
  const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: legbaCorePath, encoding: 'utf8' }).trim();
  
  if (currentSha !== pinnedSha) {
    console.error(`DRIFT DETECTED!`);
    console.error(`  Pinned SHA:  ${pinnedSha}`);
    console.error(`  Current SHA: ${currentSha}`);
    process.exit(1);
  }
  
  console.log(`OK: Pinned SHA matches legba-core HEAD (${pinnedSha})`);
  process.exit(0);
} catch (err) {
  console.error(`Warning: Could not check git SHA in ${legbaCorePath}`);
  process.exit(3);
}
