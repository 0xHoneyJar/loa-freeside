#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const shouldRebuild = process.env.FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL === '1';

if (!shouldRebuild) {
  console.log('[postinstall] Skipping Hounfour dist rebuild. Set FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL=1 to opt in.');
  process.exit(0);
}

const result = spawnSync('bash', ['scripts/rebuild-hounfour-dist.sh'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`[postinstall] Failed to start Hounfour rebuild: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
