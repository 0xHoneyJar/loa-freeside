#!/usr/bin/env node
/**
 * check-postinstall-wrapper.mjs — validates the issue #328 install contract:
 *
 *   1. package.json "postinstall" points at the wrapper (not the raw rebuild).
 *   2. Default wrapper invocation performs NO rebuild and exits 0.
 *   3. Opt-in (FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL=1) dispatches the rebuild.
 *   4. A failing rebuild propagates a nonzero exit code.
 *
 * Run: node scripts/check-postinstall-wrapper.mjs   (or npm run check:postinstall-wrapper)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
}

// 1. package.json wiring
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
check(
  'package.json postinstall uses the wrapper',
  pkg.scripts?.postinstall === 'node scripts/postinstall.mjs',
  `got: ${JSON.stringify(pkg.scripts?.postinstall)}`,
);
check(
  'explicit build:hounfour command preserved',
  pkg.scripts?.['build:hounfour'] === 'scripts/rebuild-hounfour-dist.sh',
  `got: ${JSON.stringify(pkg.scripts?.['build:hounfour'])}`,
);

const baseEnv = { ...process.env };
delete baseEnv.FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL;
delete baseEnv.FREESIDE_POSTINSTALL_REBUILD_CMD;

// 2. default = skip, exit 0
{
  const r = spawnSync('node', ['scripts/postinstall.mjs'], { env: baseEnv, encoding: 'utf8' });
  check('default invocation exits 0', r.status === 0, `exit=${r.status}`);
  check('default invocation skips rebuild', /skipped/.test(r.stdout), r.stdout.trim().split('\n')[0]);
}

// 3. opt-in dispatches the rebuild (stubbed command; no network)
{
  const r = spawnSync('node', ['scripts/postinstall.mjs'], {
    env: {
      ...baseEnv,
      FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL: '1',
      FREESIDE_POSTINSTALL_REBUILD_CMD: 'echo REBUILD_DISPATCHED',
    },
    encoding: 'utf8',
  });
  check('opt-in invocation dispatches rebuild', r.status === 0 && /REBUILD_DISPATCHED/.test(r.stdout), `exit=${r.status}`);
}

// 4. rebuild failure propagates nonzero exit
{
  const r = spawnSync('node', ['scripts/postinstall.mjs'], {
    env: {
      ...baseEnv,
      FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL: '1',
      FREESIDE_POSTINSTALL_REBUILD_CMD: 'exit 3',
    },
    encoding: 'utf8',
  });
  check('rebuild failure propagates nonzero exit', r.status === 3, `exit=${r.status}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll postinstall wrapper checks passed');
