/**
 * doctor-attacks.test.mjs — the three demo attacks as named negative fixtures
 * (house style: each closes a finding by name), plus the two-axis output and
 * exit-code taxonomy (Task 1.3 + 1.4). Each test cites its AS-ID.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { doctor, attestBuild, verifyAttestation, createSigner, runVectors } from '../src/asson.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const wcDir = join(root, 'examples', 'wordcount');
const wcVeve = () => JSON.parse(readFileSync(join(wcDir, 'veve.json'), 'utf8'));

// a throwaway copy of the wordcount CLI we can tamper with
function freshCli() {
  const dir = mkdtempSync(join(tmpdir(), 'asson-cli-'));
  cpSync(wcDir, dir, { recursive: true });
  return dir;
}

test('two-axis: an attested example is L3 (structure) AND attested-dev (tier)', () => {
  const dir = freshCli();
  const signer = createSigner(); // default dev_signature
  const attested = attestBuild(wcVeve(), dir, signer);
  const r = doctor(attested, dir, { publicKey: signer.publicKey });
  assert.equal(r.earned, 3, 'L3 by structure');
  assert.equal(r.attestation_tier, 'attested-dev', 'dev-signed → attested-dev tier');
  assert.ok(r.findings.some(f => f.severity === 'warn' && f.as_id === 'AS-2'), 'dev tier warns');
  assert.equal(r.exit, 3, 'warn-only → exit 3');
  rmSync(dir, { recursive: true, force: true });
});

test('AS-2: a post-attestation edit breaks the attestation (tree_hash diverged)', () => {
  const dir = freshCli();
  const signer = createSigner();
  const attested = attestBuild(wcVeve(), dir, signer);
  assert.equal(verifyAttestation(attested, dir, signer.publicKey).ok, true, 'honest attestation verifies');
  const bin = join(dir, 'bin', 'wordcount.mjs');
  writeFileSync(bin, readFileSync(bin, 'utf8').replace('words.length', 'words.length + 1'));
  assert.equal(verifyAttestation(attested, dir, signer.publicKey).ok, false, 'edited tree must NOT verify');
  rmSync(dir, { recursive: true, force: true });
});

test('AS-3: a veve claiming L5 with L2 evidence earns L2 with a DRIFT finding', () => {
  const dir = freshCli();
  const signer = createSigner();
  const liar = attestBuild(wcVeve(), dir, signer);
  liar.ladder.level = 5; liar.vectors = []; // claim L5, strip the vectors that earn L3
  const r = doctor(liar, dir, { publicKey: signer.publicKey });
  assert.ok(r.earned < 5, `earned ${r.earned} < claimed 5`);
  const drift = r.findings.find(f => f.as_id === 'AS-3');
  assert.ok(drift && drift.severity === 'fail' && drift.message.startsWith('DRIFT'), 'DRIFT is a fail finding');
  assert.equal(r.exit, 1, 'a fail finding → exit 1');
  rmSync(dir, { recursive: true, force: true });
});

test('AS-1/LG-5: attestable-but-empty-ambient is a determinism contradiction (fail)', () => {
  const dir = freshCli();
  const signer = createSigner();
  const oracle = attestBuild(wcVeve(), dir, signer);
  oracle.determinism = { class: 'attestable', declared_by: 'author', ambient: [] }; // names no entropy source
  const r = doctor(oracle, dir, { publicKey: signer.publicKey });
  const lg5 = r.findings.find(f => f.as_id === 'AS-1');
  assert.ok(lg5 && lg5.severity === 'fail' && lg5.message.includes('LG-5'), 'contradiction is a fail');
  assert.equal(r.exit, 1);
  rmSync(dir, { recursive: true, force: true });
});

test('AS-7: a veve with mode=daemon claiming L3 fails (category error)', () => {
  const dir = freshCli();
  const signer = createSigner();
  const daemon = attestBuild(wcVeve(), dir, signer);
  daemon.veve_version = '0.2.0';
  daemon.liveness = { timeout_s: 10, mode: 'daemon' };
  const r = doctor(daemon, dir, { publicKey: signer.publicKey });
  assert.ok(r.findings.some(f => f.as_id === 'AS-7' && f.severity === 'fail' && f.message.includes('daemon')), 'daemon-as-L3 fails');
  assert.notEqual(r.earned, 3, 'a daemon does not earn L3');
  rmSync(dir, { recursive: true, force: true });
});

test('AS-14: a static import outside the CLI dir is a WARN, not a fail (reframed)', () => {
  const dir = freshCli();
  // add a file that statically imports outside the dir
  writeFileSync(join(dir, 'bin', 'leak.mjs'), "import x from '../../../../etc/whatever.mjs';\nexport default x;\n");
  const signer = createSigner();
  const attested = attestBuild(wcVeve(), dir, signer);
  const r = doctor(attested, dir, { publicKey: signer.publicKey });
  const f = r.findings.find(x => x.as_id === 'AS-14');
  assert.ok(f && f.severity === 'warn', 'cross-dir import warns (not fails) — runtime reach is the sandbox concern');
  rmSync(dir, { recursive: true, force: true });
});

test('AS-6: a tampered vector hash makes the doctor fail the run', () => {
  const dir = freshCli();
  const signer = createSigner();
  const v = attestBuild(wcVeve(), dir, signer);
  if (v.vectors?.[0]) v.vectors[0].expect_output_hash = 'sha256:' + '0'.repeat(64);
  const r = doctor(v, dir, { publicKey: signer.publicKey });
  assert.ok(r.findings.some(f => f.as_id === 'AS-6' && f.severity === 'fail'), 'vector mismatch fails');
  assert.equal(r.exit, 1);
  rmSync(dir, { recursive: true, force: true });
});
