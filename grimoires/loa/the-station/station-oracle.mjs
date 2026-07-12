#!/usr/bin/env node
// station-oracle — the coherence surface, made small.
//
// Reads the real station and speaks ONE true sentence: the loudest drift right now.
// Agreement is silence. Drift is the only thing that speaks. If the station is coherent,
// the oracle nearly holds its tongue. Run it whenever you want the station to tell you
// the one thing — `node grimoires/loa/the-station/station-oracle.mjs`.
//
// No deps. Reads packages/freeside-registry/registry.yaml (crude, robust) + the working tree.
// A gift that stays true, because it re-reads the world every time it's asked.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };

// ── read the station ──────────────────────────────────────────────────────────
const reg = (() => {
  try { return readFileSync(resolve(ROOT, 'packages/freeside-registry/registry.yaml'), 'utf8'); } catch { return ''; }
})();
const states = [...reg.matchAll(/runtime_state:\s*([a-z-]+)/g)].map((m) => m[1]);
const deployed = states.filter((s) => s === 'deployed').length;
const scaffolded = states.filter((s) => s === 'scaffolded').length;
const notBuilt = states.filter((s) => s === 'not-built').length;
const total = states.length;

const orderLocalOnly = sh('git log --oneline origin/cycle/shadow-audit-runtime-ordering..HEAD 2>/dev/null')
  .split('\n').filter((l) => /order|ordering/i.test(l)).length;
const openBeads = Number(sh('br list --status open 2>/dev/null | grep -c "○"')) || 0;
const censusEdgeless = /arrakis-w3h2/.test(sh('br list 2>/dev/null')) ; // the edgeless-census bug still open

// ── the drift signals, each with a weight (konesans-flavored: non-compensatory) ──
const signals = [
  censusEdgeless && {
    w: 0.9,
    say: `the sky is still edgeless — ${deployed} lights lit, ${total} total, and almost no orbits drawn between them (arrakis-w3h2). the station does not yet know its own shape.`,
  },
  orderLocalOnly > 0 && {
    w: 0.85,
    say: `the order system is born and unlit — ${orderLocalOnly} commits local, never pushed, tested-spine not deployed. it knows how to fulfill an order. it is waiting for one operator move (S3-T1: a registry edge + a grant).`,
  },
  scaffolded > 0 && {
    w: 0.4,
    say: `${scaffolded} building${scaffolded > 1 ? 's are' : ' is'} scaffolded and breathing but not lit — capability declared, runtime withheld.`,
  },
  notBuilt > 0 && {
    w: 0.3,
    say: `${notBuilt} building${notBuilt > 1 ? 's were' : ' was'} declared into the registry and never built — names without bodies.`,
  },
].filter(Boolean).sort((a, b) => b.w - a.w);

// ── speak ─────────────────────────────────────────────────────────────────────
const C = { dim: '\x1b[2m', cyan: '\x1b[36m', gold: '\x1b[33m', reset: '\x1b[0m' };
console.log('');
console.log(`${C.dim}∴ the station, asked${C.reset}`);
if (signals.length === 0) {
  console.log(`${C.gold}  the station hums. nothing drifts loud enough to speak. coherence is quiet.${C.reset}`);
} else {
  const loudest = signals[0];
  console.log(`${C.cyan}  ${loudest.say}${C.reset}`);
  if (signals.length > 1) console.log(`${C.dim}  (${signals.length - 1} quieter drift${signals.length - 1 > 1 ? 's' : ''} below it — silence, for now.)${C.reset}`);
}
console.log(`${C.dim}  ${openBeads} beads open · agreement is silence · only drift speaks${C.reset}`);
console.log('');
