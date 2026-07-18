import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'plan-gate.mjs');
const PROJECT_ID = '0bf95b1c-b8f2-4e60-a4a6-50089b521eb0';
const ENVIRONMENT_ID = '2068efa5-0ed4-4cf3-9ae2-89120c4b18d5';
const IDENTITY =
  'resource.update|safe|resource:shadow-audit-api|field:source.branch';

const fingerprint = (changes) =>
  createHash('sha256').update(JSON.stringify([...changes].sort())).digest('hex');

function validPlan() {
  return {
    ok: true,
    currentEnvironment: {
      projectId: PROJECT_ID,
      projectName: 'shadow-audit-api',
      environmentId: ENVIRONMENT_ID,
      environmentName: 'production',
    },
    changeSet: {
      changes: [
        {
          kind: 'resource.update',
          severity: 'safe',
          summary: 'Update shadow-audit-api source.branch',
          details: ['producer-controlled and intentionally ignored'],
        },
      ],
    },
  };
}

function runGate(plan, baselineChanges = [IDENTITY]) {
  const cwd = mkdtempSync(join(tmpdir(), 'railway-plan-gate-'));
  const railwayDir = join(cwd, '.railway');
  mkdirSync(railwayDir);
  const planPath = join(cwd, 'plan.json');
  writeFileSync(planPath, JSON.stringify(plan));
  writeFileSync(
    join(railwayDir, 'plan-baseline.json'),
    JSON.stringify({
      fingerprint: fingerprint(baselineChanges),
      changeCount: baselineChanges.length,
      changes: baselineChanges,
    }),
  );
  return spawnSync(process.execPath, [GATE, '--plan-file', planPath], {
    cwd,
    encoding: 'utf8',
  });
}

function runGateWithRawPlan(rawPlan) {
  const cwd = mkdtempSync(join(tmpdir(), 'railway-plan-gate-raw-'));
  const railwayDir = join(cwd, '.railway');
  mkdirSync(railwayDir);
  const planPath = join(cwd, 'plan.json');
  writeFileSync(planPath, rawPlan);
  return spawnSync(process.execPath, [GATE, '--plan-file', planPath], {
    cwd,
    encoding: 'utf8',
  });
}

test('accepts the trusted target and canonical value-free baseline', () => {
  const result = runGate(validPlan());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /plan matches baseline/);
});

for (const [type, name] of [
  ['service', 'shadow-audit-api'],
  ['database', 'shadow-audit-postgres'],
]) {
  test(`accepts captured safe ${type} creation output`, () => {
    const plan = validPlan();
    plan.changeSet.changes[0] = {
      kind: 'resource.create',
      severity: 'safe',
      summary: `Create ${type} ${name}`,
    };
    const identity = `resource.create|safe|type:${type}|resource:${name}`;
    const result = runGate(plan, [identity]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /plan matches baseline/);
  });
}

test('rejects unknown resource creation types without echoing producer prose', () => {
  const plan = validPlan();
  const marker = 'SENSITIVE_MARKER_DO_NOT_PRINT';
  plan.changeSet.changes[0] = {
    kind: 'resource.create',
    severity: 'safe',
    summary: `Create bucket ${marker}`,
  };
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_SCHEMA_REJECTED/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
});

test('does not reflect malformed plan JSON through exception diagnostics', () => {
  const marker = 'SENSITIVE_MARKER_DO_NOT_PRINT';
  const result = runGateWithRawPlan(`{"malformed":"${marker}"`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_JSON_INVALID/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
});

test('does not reflect Railway subprocess stderr through exception diagnostics', () => {
  const marker = 'SENSITIVE_MARKER_DO_NOT_PRINT';
  const cwd = mkdtempSync(join(tmpdir(), 'railway-plan-gate-exec-'));
  const bin = join(cwd, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'railway'),
    `#!/bin/sh\nprintf '%s\\n' '${marker}' >&2\nexit 1\n`,
    { mode: 0o755 },
  );
  const result = spawnSync(process.execPath, [GATE], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_EXEC_FAILED/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
});

test('fails closed when the target IDs do not match', () => {
  const plan = validPlan();
  plan.currentEnvironment.projectId = '00000000-0000-0000-0000-000000000000';
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_TARGET_MISMATCH/);
});

test('fails closed when changeSet is missing', () => {
  const plan = validPlan();
  delete plan.changeSet;
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_SCHEMA_REJECTED/);
});

test('fails closed on unknown kinds', () => {
  const plan = validPlan();
  plan.changeSet.changes[0].kind = 'future.magic';
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_SCHEMA_REJECTED/);
});

test('fails closed on unknown plan fields', () => {
  const plan = validPlan();
  plan.unexpected = { meaning: 'producer schema changed' };
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_SCHEMA_REJECTED/);
});

test('rejects and never echoes summaries that contain a value', () => {
  const plan = validPlan();
  const marker = 'SENSITIVE_MARKER_DO_NOT_PRINT';
  plan.changeSet.changes[0].summary = `Update shadow-audit-api source.branch ${marker}`;
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PLAN_SCHEMA_REJECTED/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
});

test('rejects destructive changes without echoing producer prose', () => {
  const plan = validPlan();
  const marker = 'SENSITIVE_MARKER_DO_NOT_PRINT';
  plan.changeSet.changes[0] = {
    kind: 'resource.delete',
    severity: 'destructive',
    summary: marker,
  };
  const result = runGate(plan);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DESTRUCTIVE/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
});

test('rejects and never echoes non-canonical baseline entries', () => {
  const marker = 'SENSITIVE_MARKER_DO_NOT_PRINT';
  const result = runGate(validPlan(), [marker]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid or internally inconsistent schema/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
});
