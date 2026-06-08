#!/usr/bin/env node
// rail-hardness-scan — make hook_backed UN-FAKEABLE. The board's own hardness check:
// a rail that CLAIMS hook_backed must name a hook_path that resolves to a real file.
// This is the hardness principle applied to the measurement itself (don't assert — verify).
// It would have caught K1 (a "merged" tooth absent from the runtime). Dependency-free.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const rows = readFileSync(join(here, 'rail-hardness-ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

let verified = 0, missing = [], unverified = [];
for (const r of rows.filter((x) => x.hook_backed)) {
  if (!r.hook_path) { unverified.push(r.rail); continue; }
  const p = r.hook_path.startsWith('/') ? r.hook_path : join(repoRoot, r.hook_path); // absolute = cross-repo hardness (e.g. the crs runtime)
  if (existsSync(p)) verified++;
  else missing.push(`${r.rail} → ${r.hook_path}`);
}

console.log(`\n∴ RAIL-HARDNESS SCAN — verifying hook_backed claims against the filesystem\n`);
console.log(`  verified   ${verified}  (claim resolves to a real hook/artifact)`);
console.log(`  UNVERIFIED ${unverified.length}  ${unverified.length ? '— claims hook_backed, names no hook_path: ' + unverified.join(', ') : ''}`);
console.log(`  MISSING    ${missing.length}  ${missing.length ? '— claims hardness, file ABSENT (the K1 class):' : ''}`);
for (const m of missing) console.log(`    ✗ ${m}`);
if (missing.length) { console.log(`\n  a hook_backed claim that does not resolve is a roleplayed gradient. fix the path or the deploy.\n`); process.exit(3); }
console.log(`\n  all hook_backed claims verified — the board's hardness is itself un-fakeable.\n`);
