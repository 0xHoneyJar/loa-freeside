#!/usr/bin/env node
/**
 * S2-T2 (SDD §8, IMP-013, G-6) — org-as-code agent gate for `.railway/railway.ts`.
 *
 * Runs `railway config plan --json` (READ-ONLY) and gates it. Two independent checks, in priority order:
 *
 *   1. DESTRUCTIVE GUARD (unconditional, baseline-independent) — any change that is not `severity: safe`,
 *      or whose `kind` deletes/destroys a resource or variable, FAILS. This exists because Railway IaC is
 *      DECLARATIVE: a `.railway/railway.ts` applied against the WRONG project plans to DELETE every
 *      resource it does not declare. On 2026-07-10 a plan run against the (wrongly-linked)
 *      `ordering-service` project read "1 to add, 3 to DESTROY" — it would have deleted ordering-service,
 *      its Postgres, and fulfillment-orchestrator. A destroy must NEVER pass this gate silently.
 *
 *   2. DRIFT GUARD — fingerprint the normalized changeSet, compare to `.railway/plan-baseline.json`.
 *      A mismatch means either someone edited `.railway/railway.ts` (INTENDED → refresh the baseline in
 *      the same PR, which makes the change explicit and reviewable) or Railway drifted out-of-band
 *      (UNINTENDED → investigate before applying).
 *
 * SECRETS: the fingerprint and ALL output use only `kind | severity | summary`. Summaries carry variable
 * NAMES, never values (Railway redacts values as «hidden»). `details` is deliberately EXCLUDED from both
 * the fingerprint and the logs — nothing secret can reach CI logs through this gate.
 *
 * WHY A BASELINE AND NOT "ZERO CHANGES": Railway redacts variable values, so `plan` cannot compare them —
 * it re-plans every `variable.set` on every run even when the value is identical. A "plan must be empty"
 * gate is therefore impossible; the baseline is the honest form.
 *
 * KNOWN LIMIT (honest): this detects STRUCTURAL drift (a variable/build/deploy setting added, removed, or
 * renamed; anything destructive) but NOT a value-only change made in the Railway dashboard — the plan
 * cannot see values. Closing that needs a separate value-attestation; out of scope.
 *
 * This gate NEVER applies. `railway config apply` stays human-gated (NFR-2).
 *
 * Usage:
 *   node .railway/plan-gate.mjs                     # gate (CI)
 *   node .railway/plan-gate.mjs --update-baseline   # regenerate baseline (in the PR that changes the IaC)
 *   node .railway/plan-gate.mjs --plan-file p.json  # gate a captured plan (offline / tests)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = '.railway/plan-baseline.json';

const args = process.argv.slice(2);
const updateBaseline = args.includes('--update-baseline');
const planFileIdx = args.indexOf('--plan-file');
let planFile = null;
if (planFileIdx !== -1) {
  // A bare `--plan-file` (value missing, or the next token is another flag) must NOT silently fall through
  // to `railway config plan` against the LIVE project — that turns an offline check into a live API call.
  const value = args[planFileIdx + 1];
  if (!value || value.startsWith('-')) {
    console.error('FAIL: --plan-file requires a path.  usage: node .railway/plan-gate.mjs --plan-file <plan.json>');
    process.exit(1);
  }
  planFile = value;
}

/** Destructive unless explicitly `safe` AND the kind is not a delete/destroy/remove. */
function isDestructive(change) {
  if (String(change.severity ?? '') !== 'safe') return true;
  return /delete|destroy|remove/i.test(String(change.kind ?? ''));
}

/** Names + shape only — never values. Sorted so the fingerprint is order-independent. */
function normalize(changes) {
  return changes.map((c) => `${c.kind ?? '?'}|${c.severity ?? '?'}|${c.summary ?? '?'}`).sort();
}

const fingerprint = (normalized) => createHash('sha256').update(JSON.stringify(normalized)).digest('hex');

function getPlan() {
  if (planFile) return JSON.parse(readFileSync(planFile, 'utf8'));
  const out = execFileSync('railway', ['config', 'plan', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

let plan;
try {
  plan = getPlan();
} catch (err) {
  console.error('FAIL: could not run `railway config plan --json`.');
  console.error('      CI needs RAILWAY_TOKEN (repo secret) + a linked project/environment.');
  console.error(`      ${String(err.message ?? err).split('\n')[0]}`);
  process.exit(1);
}

const changes = plan?.changeSet?.changes ?? [];
const normalized = normalize(changes);
const fp = fingerprint(normalized);
const env = plan?.currentEnvironment ?? {};

console.log(`railway plan gate — project=${env.projectName ?? '?'} env=${env.environmentName ?? '?'}`);
console.log(`changes: ${changes.length}  fingerprint: ${fp.slice(0, 16)}…`);

// ---- 1. DESTRUCTIVE GUARD (unconditional) --------------------------------
const destructive = changes.filter(isDestructive);
if (destructive.length > 0) {
  console.error(`\nFAIL: ${destructive.length} DESTRUCTIVE change(s) — refusing regardless of baseline.`);
  for (const c of destructive) console.error(`  ✗ ${c.kind} | ${c.severity} | ${c.summary}`);
  console.error('\nRailway IaC is DECLARATIVE — it deletes anything not declared in .railway/railway.ts.');
  console.error('Verify the LINKED PROJECT is correct before anything is applied.');
  process.exit(1);
}

// ---- 2. BASELINE / DRIFT GUARD -------------------------------------------
if (updateBaseline) {
  const doc = {
    _comment:
      'S2-T2 org-as-code baseline. Names/shape only — no secret values (Railway redacts them). Regenerate ' +
      'with `node .railway/plan-gate.mjs --update-baseline` in the same PR that changes .railway/railway.ts.',
    fingerprint: fp,
    changeCount: changes.length,
    changes: normalized,
  };
  writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + '\n');
  console.log(`\n✓ baseline written → ${BASELINE} (${changes.length} changes)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`\nFAIL: no baseline at ${BASELINE}. Create it: node .railway/plan-gate.mjs --update-baseline`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
if (baseline.fingerprint === fp) {
  console.log('\n✓ plan matches baseline — no unexpected drift.');
  process.exit(0);
}

console.error('\nFAIL: plan does NOT match the committed baseline (unexpected drift).');
const base = new Set(baseline.changes ?? []);
const cur = new Set(normalized);
for (const c of normalized) if (!base.has(c)) console.error(`  + in plan, not in baseline: ${c}`);
for (const c of baseline.changes ?? []) if (!cur.has(c)) console.error(`  - in baseline, not in plan: ${c}`);
console.error('\nINTENDED (you edited .railway/railway.ts)? Refresh the baseline in this PR:');
console.error('  node .railway/plan-gate.mjs --update-baseline');
console.error('NOT intended? Railway drifted out-of-band — investigate before applying.');
process.exit(1);
