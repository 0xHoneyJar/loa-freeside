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
 * SECRETS: upstream `summary`, `details`, and `diff` are NEVER logged or persisted. Each recognized change
 * kind is converted to a small canonical identity only after its summary matches a strict, kind-specific
 * grammar containing resource/field NAMES and no values. Unknown kinds, severities, fields, or shapes fail
 * closed before normalization.
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
 * The credentialed plan evaluates only `TRUSTED_RAILWAY_CONFIG`, fetched from
 * the default branch by CI. The reviewed `.railway/railway.ts` is required to
 * be byte-identical but is never executed with credentials.
 *
 * Usage:
 *   node .railway/plan-gate.mjs                     # gate (CI)
 *   node .railway/plan-gate.mjs --update-baseline   # regenerate baseline (in the PR that changes the IaC)
 *   node .railway/plan-gate.mjs --plan-file p.json  # gate a captured plan (offline / tests)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASELINE = '.railway/plan-baseline.json';
const TRUSTED_RAILWAY_CONFIG =
  process.env.TRUSTED_RAILWAY_CONFIG ??
  fileURLToPath(new URL('./trusted-tools/railway.ts', import.meta.url));
const EXPECTED_TARGET = Object.freeze({
  projectId: '0bf95b1c-b8f2-4e60-a4a6-50089b521eb0',
  environmentId: '2068efa5-0ed4-4cf3-9ae2-89120c4b18d5',
});

const KNOWN_SEVERITIES = new Set(['safe', 'destructive']);
const KNOWN_KINDS = new Set([
  'resource.create',
  'resource.update',
  'resource.delete',
  'variable.set',
  'variable.delete',
]);
const SAFE_RESOURCE_FIELDS = new Set([
  'source.branch',
  'build.builder',
  'build.dockerfilePath',
  'healthcheck',
  'healthcheckTimeout',
  'rootDirectory',
]);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SAFE_VARIABLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.[A-Z][A-Z0-9_]{0,127}$/;

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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class SafePlanError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function failSchema() {
  throw new SafePlanError('PLAN_SCHEMA_REJECTED');
}

function assertAllowedKeys(record, allowed, label) {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) failSchema(`${label} contains unknown fields`);
}

/**
 * Convert a validated upstream change to a value-free identifier.
 *
 * The summary itself is never returned or logged. The accepted grammars are
 * intentionally narrower than Railway's possible output: a new shape stops the
 * gate until this trusted file is reviewed and extended on the default branch.
 */
function safeChangeIdentity(change, index) {
  if (!isRecord(change)) failSchema(`change ${index} is not an object`);
  assertAllowedKeys(
    change,
    new Set(['kind', 'severity', 'summary', 'details']),
    `change ${index}`,
  );
  const { kind, severity, summary } = change;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) {
    failSchema(`change ${index} has an unknown kind`);
  }
  if (typeof severity !== 'string' || !KNOWN_SEVERITIES.has(severity)) {
    failSchema(`change ${index} has an unknown severity`);
  }
  if (typeof summary !== 'string') failSchema(`change ${index} has no string summary`);

  if (kind === 'resource.delete' || kind === 'variable.delete') {
    // Destructive changes never reach the baseline. Do not parse or repeat
    // producer-controlled prose merely to explain a rejection.
    return `${kind}|${severity}`;
  }

  if (kind === 'resource.create') {
    const match = /^Create (service|database) ([A-Za-z0-9][A-Za-z0-9._/-]{0,127})$/.exec(
      summary,
    );
    if (!match || !SAFE_NAME.test(match[2])) {
      failSchema(`change ${index} has an unknown resource-create summary`);
    }
    return `${kind}|${severity}|type:${match[1]}|resource:${match[2]}`;
  }

  if (kind === 'resource.update') {
    const match = /^Update ([A-Za-z0-9][A-Za-z0-9._/-]{0,127}) ([A-Za-z][A-Za-z0-9_.-]{0,127})$/.exec(
      summary,
    );
    if (!match || !SAFE_NAME.test(match[1]) || !SAFE_RESOURCE_FIELDS.has(match[2])) {
      failSchema(`change ${index} has an unknown resource-update summary`);
    }
    return `${kind}|${severity}|resource:${match[1]}|field:${match[2]}`;
  }

  const match = /^Update variable ([A-Za-z0-9][A-Za-z0-9._-]{0,127}\.[A-Z][A-Z0-9_]{0,127})$/.exec(
    summary,
  );
  if (!match || !SAFE_VARIABLE.test(match[1])) {
    failSchema(`change ${index} has an unknown variable-set summary`);
  }
  return `${kind}|${severity}|variable:${match[1]}`;
}

function validatePlan(value) {
  if (!isRecord(value)) failSchema('top-level result is not an object');
  assertAllowedKeys(
    value,
    new Set([
      'ok',
      'command',
      'file',
      'currentEnvironment',
      'changeSet',
      'diff',
      'diagnostics',
      'currentGraph',
      'desiredGraph',
      'stagedPatch',
      'applyResult',
      'deploymentId',
      'stagedPatchId',
    ]),
    'top-level result',
  );
  if (value.ok !== true) failSchema('top-level ok is not true');
  if (!isRecord(value.currentEnvironment)) failSchema('currentEnvironment is missing');
  if (!isRecord(value.changeSet)) failSchema('changeSet is missing');
  assertAllowedKeys(
    value.currentEnvironment,
    new Set(['projectId', 'projectName', 'environmentId', 'environmentName']),
    'currentEnvironment',
  );
  assertAllowedKeys(value.changeSet, new Set(['changes']), 'changeSet');
  if (!Array.isArray(value.changeSet.changes)) failSchema('changeSet.changes is not an array');

  const env = value.currentEnvironment;
  if (
    env.projectId !== EXPECTED_TARGET.projectId ||
    env.environmentId !== EXPECTED_TARGET.environmentId
  ) {
    throw new SafePlanError('PLAN_TARGET_MISMATCH');
  }

  return value.changeSet.changes.map(safeChangeIdentity).sort();
}

/** Destructive unless explicitly `safe` and a recognized non-delete kind. */
function isDestructiveIdentity(identity) {
  const [kind, severity] = identity.split('|');
  return severity !== 'safe' || kind.endsWith('.delete');
}

function isCanonicalBaselineIdentity(identity) {
  if (typeof identity !== 'string') return false;
  const parts = identity.split('|');
  if (parts[0] === 'resource.create' && parts[1] === 'safe' && parts.length === 4) {
    const type = parts[2].startsWith('type:') ? parts[2].slice('type:'.length) : '';
    const resource = parts[3].startsWith('resource:') ? parts[3].slice('resource:'.length) : '';
    return (type === 'service' || type === 'database') && SAFE_NAME.test(resource);
  }
  if (parts[0] === 'resource.update' && parts[1] === 'safe' && parts.length === 4) {
    const resource = parts[2].startsWith('resource:') ? parts[2].slice('resource:'.length) : '';
    const field = parts[3].startsWith('field:') ? parts[3].slice('field:'.length) : '';
    return SAFE_NAME.test(resource) && SAFE_RESOURCE_FIELDS.has(field);
  }
  if (parts[0] === 'variable.set' && parts[1] === 'safe' && parts.length === 3) {
    const variable = parts[2].startsWith('variable:') ? parts[2].slice('variable:'.length) : '';
    return SAFE_VARIABLE.test(variable);
  }
  return false;
}

const fingerprint = (normalized) => createHash('sha256').update(JSON.stringify(normalized)).digest('hex');

function getPlan() {
  if (planFile) {
    try {
      return JSON.parse(readFileSync(planFile, 'utf8'));
    } catch {
      throw new SafePlanError('PLAN_JSON_INVALID');
    }
  }
  let out;
  try {
    out = execFileSync(
      'railway',
      ['config', 'plan', '--json', '--file', TRUSTED_RAILWAY_CONFIG],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5 * 60 * 1000,
        killSignal: 'SIGTERM',
      },
    );
  } catch {
    throw new SafePlanError('PLAN_EXEC_FAILED');
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new SafePlanError('PLAN_JSON_INVALID');
  }
}

let plan;
let normalized;
try {
  plan = getPlan();
  normalized = validatePlan(plan);
} catch (err) {
  console.error('FAIL: Railway plan could not be evaluated safely.');
  console.error('      CI needs its protected RAILWAY_TOKEN and the exact trusted target.');
  console.error(`      code=${err instanceof SafePlanError ? err.code : 'PLAN_EVALUATION_FAILED'}`);
  process.exit(1);
}

const fp = fingerprint(normalized);

console.log(
  `railway plan gate — target=${EXPECTED_TARGET.projectId}/${EXPECTED_TARGET.environmentId}`,
);
console.log(`changes: ${normalized.length}  fingerprint: ${fp.slice(0, 16)}…`);

// ---- 1. DESTRUCTIVE GUARD (unconditional) --------------------------------
const destructive = normalized.filter(isDestructiveIdentity);
if (destructive.length > 0) {
  console.error(`\nFAIL: ${destructive.length} DESTRUCTIVE change(s) — refusing regardless of baseline.`);
  for (const identity of destructive) console.error(`  ✗ ${identity}`);
  console.error('\nRailway IaC is DECLARATIVE — it deletes anything not declared in .railway/railway.ts.');
  console.error('Verify the trusted project/environment target before anything is applied.');
  process.exit(1);
}

// ---- 2. BASELINE / DRIFT GUARD -------------------------------------------
if (updateBaseline) {
  const doc = {
    _comment:
      'S2-T2 org-as-code baseline. Trusted canonical identities only; no upstream summaries or values. Regenerate ' +
      'with `node .railway/plan-gate.mjs --update-baseline` in the same PR that changes .railway/railway.ts.',
    fingerprint: fp,
    changeCount: normalized.length,
    changes: normalized,
  };
  writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + '\n');
  console.log(`\n✓ baseline written → ${BASELINE} (${normalized.length} changes)`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`\nFAIL: no baseline at ${BASELINE}. Create it: node .railway/plan-gate.mjs --update-baseline`);
  process.exit(1);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`\nFAIL: baseline at ${BASELINE} is not valid JSON.`);
  process.exit(1);
}
if (
  !isRecord(baseline) ||
  Object.keys(baseline).some(
    (key) => !new Set(['_comment', 'fingerprint', 'changeCount', 'changes']).has(key),
  ) ||
  !/^[0-9a-f]{64}$/.test(baseline.fingerprint) ||
  !Number.isSafeInteger(baseline.changeCount) ||
  baseline.changeCount < 0 ||
  !Array.isArray(baseline.changes) ||
  baseline.changes.some((entry) => !isCanonicalBaselineIdentity(entry)) ||
  baseline.changeCount !== baseline.changes.length ||
  fingerprint([...baseline.changes].sort()) !== baseline.fingerprint
) {
  console.error(`\nFAIL: baseline at ${BASELINE} has an invalid or internally inconsistent schema.`);
  process.exit(1);
}
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
