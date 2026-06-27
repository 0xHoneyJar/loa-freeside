#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const wrapper = readFileSync('scripts/postinstall.mjs', 'utf8');
const failures = [];

function require(condition, message) {
  if (!condition) failures.push(message);
}

require(
  pkg.scripts?.postinstall === 'node scripts/postinstall.mjs',
  'package.json postinstall must point at scripts/postinstall.mjs',
);

require(
  pkg.scripts?.['build:hounfour'] === 'scripts/rebuild-hounfour-dist.sh',
  'build:hounfour must remain the explicit rebuild command',
);

require(
  wrapper.includes('FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL') && wrapper.includes("=== '1'"),
  'postinstall wrapper must require explicit FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL=1 opt-in',
);

require(
  wrapper.includes('scripts/rebuild-hounfour-dist.sh'),
  'postinstall wrapper must call the existing rebuild script only on opt-in',
);

require(
  wrapper.includes('process.exit(result.status ?? 1)'),
  'postinstall wrapper must propagate rebuild command failure status',
);

if (failures.length > 0) {
  console.error('Postinstall wrapper check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Postinstall wrapper check passed.');
