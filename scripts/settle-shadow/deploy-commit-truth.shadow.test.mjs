// deploy-commit-truth.shadow.test.mjs — the consumer's teeth.
//
// Proves the brake's behaviour on a REAL deploy-commit claim: HELD when the running code
// matches the pinned commit, FALSIFIED when it has drifted, INSUFFICIENT when git is
// unreadable — and that in SHADOW it NEVER enforces.
//
// Run: node --test scripts/settle-shadow/deploy-commit-truth.shadow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  runShadow,
  DeployCommitTruthInstrument,
  deployCommitClaim,
  gitHeadReader,
  requiredTierForDomain,
} from './deploy-commit-truth.shadow.mjs';

const now = 1_700_000_000;
const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const instWith = (readHead) => new DeployCommitTruthInstrument('test', readHead);

test('deployed/freeside classifies FAIL_CLOSED → requiredTier settled (must-settle)', () => {
  const { posture, tier } = requiredTierForDomain('deployed/freeside');
  assert.equal(posture, 'FAIL_CLOSED');
  assert.equal(tier, 'settled');
});

test('HELD: running commit matches the claim → settled → SHADOW would-proceed, MISMATCH=0', async () => {
  const { claim, bar } = deployCommitClaim(COMMIT_A);
  const { signed, decision, tile } = await runShadow({ claim, bar, instrument: instWith(async () => COMMIT_A), now });
  assert.equal(signed.snapshot.verdict, 'HELD');
  assert.equal(decision.earned_tier, 'settled');
  assert.equal(decision.proceed, true);
  assert.match(tile, /STATUS=ok/);
  assert.match(tile, /MISMATCH=0/);
});

test('FALSIFIED: running commit DRIFTED from the claim → abstain → would-HALT (the cure)', async () => {
  const { claim, bar } = deployCommitClaim(COMMIT_A);
  const { signed, decision, row, tile } = await runShadow({ claim, bar, instrument: instWith(async () => COMMIT_B), now });
  assert.equal(signed.snapshot.verdict, 'FALSIFIED');
  assert.equal(decision.earned_tier, 'abstained');
  assert.equal(decision.proceed, false);
  assert.equal(row.enforced, false);           // SHADOW never blocks
  assert.match(tile, /STATUS=HALT/);
  assert.match(tile, /MISMATCH=1/);
});

test('INSUFFICIENT: git unreadable → abstain (absence of evidence ≠ proof)', async () => {
  const { claim, bar } = deployCommitClaim(COMMIT_A);
  const { signed, decision } = await runShadow({ claim, bar, instrument: instWith(async () => { throw new Error('no git'); }), now });
  assert.equal(signed.snapshot.verdict, 'INSUFFICIENT');
  assert.equal(decision.proceed, false);
});

test('INSUFFICIENT: a claim with no pinned commit cannot settle', async () => {
  const { claim, bar } = deployCommitClaim(''); // empty expected_commit
  const res = await instWith(async () => COMMIT_A).settle(null, bar);
  assert.equal(res.verdict, 'INSUFFICIENT');
});

test('SHADOW never enforces (enforced=false on every verdict) + trail row shape', async () => {
  const path = join(tmpdir(), `deploy-commit-truth-test-${process.pid}.jsonl`);
  try {
    const { claim, bar } = deployCommitClaim(COMMIT_A);
    const { row } = await runShadow({ claim, bar, instrument: instWith(async () => COMMIT_B), now, trailPath: path });
    const written = JSON.parse(readFileSync(path, 'utf8').trim());
    assert.equal(written.mode, 'SHADOW');
    assert.equal(written.enforced, false);
    assert.equal(written.verdict, 'FALSIFIED');
    assert.equal(written.domain, 'deployed/freeside');
    assert.equal(row.bar_sha, written.bar_sha);
  } finally { rmSync(path, { force: true }); }
});

test('REAL git: claiming the actual HEAD → HELD against this checkout', async () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // freeside root
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const { claim, bar } = deployCommitClaim(head); // pin the real HEAD
  const { signed, decision } = await runShadow({ claim, bar, instrument: new DeployCommitTruthInstrument('real', gitHeadReader(repo)), now });
  assert.equal(signed.snapshot.verdict, 'HELD');   // reading real git, HEAD == pinned HEAD
  assert.equal(decision.proceed, true);
});
