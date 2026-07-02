#!/usr/bin/env node
/**
 * postinstall.mjs — side-effect-gated postinstall wrapper (issue #328)
 *
 * Plain `npm install` / `pnpm install` MUST be deterministic and
 * side-effect-minimal. The hounfour dist rebuild (network clone + compile,
 * see scripts/rebuild-hounfour-dist.sh) therefore no longer runs by default.
 *
 * Contract:
 *   - Default: print a notice and exit 0 (no side effects).
 *   - FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL=1 (or "true"): run the rebuild
 *     and propagate its exit code.
 *   - Explicit rebuild remains available any time: `npm run build:hounfour`.
 *
 * Test hook: FREESIDE_POSTINSTALL_REBUILD_CMD overrides the rebuild command
 * (used by scripts/check-postinstall-wrapper.mjs to verify opt-in dispatch
 * and failure propagation without network access).
 */
import { spawnSync } from 'node:child_process';

const optIn = process.env.FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL;

if (optIn !== '1' && optIn !== 'true') {
  console.log('[postinstall] hounfour dist rebuild skipped (default — no install-time side effects).');
  console.log('[postinstall] Run "npm run build:hounfour" if you need a fresh @0xhoneyjar/loa-hounfour dist,');
  console.log('[postinstall] or set FREESIDE_REBUILD_HOUNFOUR_ON_INSTALL=1 to rebuild during install.');
  process.exit(0);
}

const override = process.env.FREESIDE_POSTINSTALL_REBUILD_CMD;
const result = override
  ? spawnSync(override, { stdio: 'inherit', shell: true })
  : spawnSync('bash', ['scripts/rebuild-hounfour-dist.sh'], { stdio: 'inherit' });

if (result.error) {
  console.error(`[postinstall] rebuild failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
