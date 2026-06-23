// fatbera-deployed-truth.shadow.test.mjs — the Phase-2 consumer's teeth.
//
// Proves the shadow brake behaves correctly across HELD / FALSIFIED / INSUFFICIENT, that it
// NEVER enforces (shadow), that the trail + tile are shaped right, that the deployed-truth
// instrument binds identity, and that — with no creds — it HONESTLY abstains.
//
// Run: node --test scripts/settle-shadow/fatbera-deployed-truth.shadow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import {
  runShadow,
  DeployedTruthInstrument,
  fatBeraClaim,
  liveReaders,
  requiredTierForDomain,
} from './fatbera-deployed-truth.shadow.mjs';

const now = 1_700_000_000;
const fixedInstrument = (verdict) => ({ sha: 'mock', async settle() { return { verdict }; } });
const claimFor = (domain) => ({ claim: { id: 'c1', domain }, bar: { criterion: '{}', sha: 'sha256:00' } });

test('deployed/fatbera classifies FAIL_CLOSED → requiredTier settled (must-settle)', () => {
  const { posture, tier } = requiredTierForDomain('deployed/fatbera');
  assert.equal(posture, 'FAIL_CLOSED');
  assert.equal(tier, 'settled');
});

test('SHADOW: INSUFFICIENT → abstains, would-HALT, MISMATCH=1, never enforced', async () => {
  const { claim, bar } = claimFor('deployed/fatbera');
  const { decision, row, tile } = await runShadow({ claim, bar, instrument: fixedInstrument('INSUFFICIENT'), now });
  assert.equal(decision.earned_tier, 'abstained');
  assert.equal(decision.proceed, false);
  assert.equal(row.enforced, false);          // shadow observes, never blocks
  assert.equal(row.would_proceed, false);
  assert.match(tile, /STATUS=HALT/);
  assert.match(tile, /MISMATCH=1/);
  assert.match(tile, /MODE=SHADOW/);
});

test('SHADOW: HELD → settled → would-proceed, MISMATCH=0', async () => {
  const { claim, bar } = claimFor('deployed/fatbera');
  const { decision, row, tile } = await runShadow({ claim, bar, instrument: fixedInstrument('HELD'), now });
  assert.equal(decision.earned_tier, 'settled');
  assert.equal(decision.proceed, true);
  assert.equal(row.enforced, false);
  assert.match(tile, /STATUS=ok/);
  assert.match(tile, /MISMATCH=0/);
});

test('SHADOW: FALSIFIED → abstains (a divergent deploy is caught)', async () => {
  const { claim, bar } = claimFor('deployed/fatbera');
  const { decision } = await runShadow({ claim, bar, instrument: fixedInstrument('FALSIFIED'), now });
  assert.equal(decision.earned_tier, 'abstained');
  assert.equal(decision.proceed, false);
});

test('trail row is appended with the SHADOW shape', async () => {
  const path = join(tmpdir(), `fatbera-shadow-test-${process.pid}.jsonl`);
  try {
    const { claim, bar } = claimFor('deployed/fatbera');
    const { row } = await runShadow({ claim, bar, instrument: fixedInstrument('INSUFFICIENT'), now, trailPath: path });
    const written = JSON.parse(readFileSync(path, 'utf8').trim());
    assert.equal(written.mode, 'SHADOW');
    assert.equal(written.enforced, false);
    assert.equal(written.verdict, 'INSUFFICIENT');
    assert.equal(written.domain, 'deployed/fatbera');
    assert.equal(written.would_proceed, false);
    assert.equal(row.bar_sha, written.bar_sha);
  } finally { rmSync(path, { force: true }); }
});

test('the REAL fatBERA claim with live readers (no creds) HONESTLY abstains (INSUFFICIENT)', async () => {
  const { claim, bar } = fatBeraClaim();
  const instrument = new DeployedTruthInstrument('deployed-truth@phase2', liveReaders({})); // empty env → no creds
  const { signed, decision } = await runShadow({ claim, bar, instrument, now });
  assert.equal(signed.snapshot.verdict, 'INSUFFICIENT');
  assert.equal(decision.proceed, false); // must-settle + abstained → would HALT (shadow: observed only)
});

test('full instrument HELD path: a matching, finalized read → HELD → SHADOW would-proceed', async () => {
  const { claim, bar } = fatBeraClaim();
  const exp = JSON.parse(bar.criterion);
  const readers = {
    async readRailway() { return { project: exp.project, environment: exp.environment, service: exp.service, commit: 'deadbeef', credential_source: exp.credential_source }; },
    async readOnChain() { return { chain_id: exp.expected_chain_id, head_block: 100n, read_block: 50n, contract: exp.expected_contract, value: exp.expected_value }; },
  };
  const inst = new DeployedTruthInstrument('x', readers);
  const { signed, decision, tile } = await runShadow({ claim, bar, instrument: inst, now });
  assert.equal(signed.snapshot.verdict, 'HELD');
  assert.equal(decision.earned_tier, 'settled');
  assert.equal(decision.proceed, true);
  assert.match(tile, /STATUS=ok/);
});

test('full instrument FALSIFIED path: on-chain value diverges from the pinned claim → abstain (the cure)', async () => {
  const { claim, bar } = fatBeraClaim();
  const exp = JSON.parse(bar.criterion);
  const readers = {
    async readRailway() { return { project: exp.project, environment: exp.environment, service: exp.service, commit: 'x', credential_source: exp.credential_source }; },
    async readOnChain() { return { chain_id: exp.expected_chain_id, head_block: 100n, read_block: 50n, contract: exp.expected_contract, value: '0xDIVERGED' }; },
  };
  const { signed, decision } = await runShadow({ claim, bar, instrument: new DeployedTruthInstrument('x', readers), now });
  assert.equal(signed.snapshot.verdict, 'FALSIFIED');
  assert.equal(decision.proceed, false);
});

test('identity binding: a HELD-shaped read for the WRONG service is INSUFFICIENT (confused-deputy)', async () => {
  const { bar } = fatBeraClaim();
  const exp = JSON.parse(bar.criterion);
  const readers = {
    async readRailway() { return { project: exp.project, environment: exp.environment, service: 'NOT-fatbera', commit: 'c', credential_source: exp.credential_source }; },
    async readOnChain() { return { chain_id: exp.expected_chain_id, head_block: 100n, read_block: 50n, contract: exp.expected_contract, value: exp.expected_value }; },
  };
  const res = await new DeployedTruthInstrument('x', readers).settle(null, bar);
  assert.equal(res.verdict, 'INSUFFICIENT');
  assert.match(res.measurement, /identity binding/);
});

test('finality: an under-finalized read cannot settle → INSUFFICIENT (absence of finality ≠ proof)', async () => {
  const { bar } = fatBeraClaim();
  const exp = JSON.parse(bar.criterion);
  const readers = {
    async readRailway() { return { project: exp.project, environment: exp.environment, service: exp.service, commit: 'c', credential_source: exp.credential_source }; },
    async readOnChain() { return { chain_id: exp.expected_chain_id, head_block: 102n, read_block: 100n, contract: exp.expected_contract, value: exp.expected_value }; }, // 2 < 8
  };
  const res = await new DeployedTruthInstrument('x', readers).settle(null, bar);
  assert.equal(res.verdict, 'INSUFFICIENT');
  assert.match(res.measurement, /finality/);
});
