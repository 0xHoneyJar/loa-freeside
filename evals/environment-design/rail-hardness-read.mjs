#!/usr/bin/env node
// rail-hardness-read — RLAIHF reader for environment-design gradient-health.
// The metric is ALIGNMENT: does each rail's ACTUAL regime achieve its INTENDED regime?
// 100% = every rail in its intended regime (soft seams stay soft, safety stays stick,
// compounding rails reach (3,3)) — NOT 100% hardened (that would gate creativity).
// Dependency-free. Usage: node evals/environment-design/rail-hardness-read.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rows = readFileSync(join(here, 'rail-hardness-ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const n = rows.length;
const pct = (x) => `${Math.round((100 * x) / n)}%`;

// alignment: does ACTUAL achieve INTENDED?
function align(r) {
  const { formation: f, observability: o, payoff_regime: p, hook_backed: h, intended_regime: intent } = r;
  if (intent === 'soft') return h ? { ok: false, tag: 'over-hardened' } : { ok: true, tag: 'soft-ok' };
  if (intent === 'stick-deterred') {
    if (f === 0) return { ok: false, tag: 'cant-form' };
    if (!h) return { ok: false, tag: 'under-hardened' }; // a real stick is hook-backed, not prose
    if (o === 0) return { ok: false, tag: 'blind' };
    return { ok: true, tag: 'stick-ok' };
  }
  if (intent === 'positive-sum-3-3') {
    if (f === 0) return { ok: false, tag: 'cant-form' };
    if (o === 0) return { ok: false, tag: 'blind' };
    if (p !== 'positive-sum-3-3') return { ok: false, tag: 'under-3-3' };
    return { ok: true, tag: '3-3-ok' };
  }
  return { ok: false, tag: 'unknown-intent' };
}

const scored = rows.map((r) => ({ r, a: align(r) }));
const aligned = scored.filter((s) => s.a.ok).length;
const tags = scored.filter((s) => !s.a.ok).reduce((m, s) => ((m[s.a.tag] = (m[s.a.tag] || 0) + 1), m), {});
const threeThree = rows.filter((r) => r.payoff_regime === 'positive-sum-3-3').length;
const hookBacked = rows.filter((r) => r.hook_backed).length;
const overHardened = tags['over-hardened'] || 0;
const alignmentPct = Math.round((100 * aligned) / n);

// --json: machine-gateable summary for the rail-hardness eval grader (B6). The
// reader only REPORTS; the grader DECIDES against the ratchet baseline (FAIL if
// alignment < floor OR over_hardened > max). Additive — human output is default.
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    total: n,
    aligned,
    alignment_pct: alignmentPct,
    over_hardened: overHardened,
    three_three: threeThree,
    hook_backed: hookBacked,
    backlog: tags,
  }));
  process.exit(0);
}

console.log(`\n∴ RAIL-HARDNESS — environment gradient-health  (${n} rails)\n`);
console.log(`  ★ ALIGNMENT        ${pct(aligned)}   ${aligned}/${n} rails in their INTENDED regime   ← push THIS to 100%`);
console.log(`    over-hardened    ${overHardened}      (soft seams wrongly gated — would kill creativity; keep this 0)`);
console.log(`  ─ secondary ratios (not targets in themselves):`);
console.log(`    (3,3) ratio      ${pct(threeThree)}   ${threeThree}/${n} compounding`);
console.log(`    hardness ratio   ${pct(hookBacked)}   ${hookBacked}/${n} hook-backed`);

console.log(`\n  misalignment backlog (the path to 100%):`);
for (const [tag, c] of Object.entries(tags).sort((a, b) => b[1] - a[1])) console.log(`    ${tag.padEnd(15)} ${c}`);

console.log(`\n  rails (misaligned first):`);
for (const { r, a } of [...scored].sort((x, y) => Number(x.a.ok) - Number(y.a.ok))) {
  const g = a.ok ? (a.tag === '3-3-ok' ? '★' : '✓') : '✗';
  console.log(`    ${g} ${r.rail.padEnd(26)} intent:${(r.intended_regime).padEnd(17)} ${a.ok ? a.tag : 'NEEDS: ' + a.tag}`);
}
console.log(`\n  100% = every rail aligned (soft stays soft · safety stays stick · compounding reaches (3,3)).`);
console.log(`  fix order is bottom-up per misaligned rail: formation → observability → payoff/hardness.\n`);
