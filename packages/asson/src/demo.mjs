/**
 * demo.mjs — the full graduation lifecycle on the example CLI, then the attacks.
 * Run from packages/asson:  node src/demo.mjs
 */
import { createSigner, attestBuild, verifyAttestation, harvestVector, runVectors,
         doctor, toCommandPolicy, treeHash } from './asson.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const cliDir = new URL('../examples/wordcount/', import.meta.url).pathname;
const vevePath = join(cliDir, 'veve.json');
const pad = (k, v) => console.log('  ' + k.padEnd(40) + v);
let veve = JSON.parse(readFileSync(vevePath, 'utf8'));

console.log('══ L1→L2: the script exists, the recorder sensed recurrence ══');
pad('claimed level', 'L' + veve.ladder.level);
pad('evidence runs (sensed, not requested)', veve.ladder.evidence_runs.join(', '));

console.log('\n══ L2→L3 step 1: HARVEST vectors — live behavior becomes pinned behavior ══');
veve.vectors = [
  harvestVector(veve, cliDir, { name: 'basic', argv: [], stdin: JSON.stringify({ text: 'the loa pass the gate the loa sign' }) }),
  harvestVector(veve, cliDir, { name: 'empty', argv: [], stdin: JSON.stringify({ text: '' }) }),
  harvestVector(veve, cliDir, { name: 'malformed-input-exits-2', argv: [], stdin: 'not json' }),
];
veve.vectors.forEach(v => pad('harvested: ' + v.name, v.expect_output_hash.slice(0, 28) + '… exit=' + v.expect_exit));

console.log('\n══ L2→L3 step 2: ATTEST the build — house key ceremony, not npm provenance ══');
const signer = createSigner({ signerId: 'asson:freeside-ci', keyVersion: 1 });
veve = attestBuild(veve, cliDir, signer);
writeFileSync(vevePath, JSON.stringify(veve, null, 2));
pad('tree_hash (the codehash)', veve.attestation.tree_hash.slice(0, 34) + '…');
pad('signed_by_key_id', veve.attestation.signed_by_key_id.slice(0, 24) + '…');

console.log('\n══ DOCTOR: earned level computed from evidence, diffed against claims ══');
const report = doctor(veve, cliDir, { publicKey: signer.publicKey });
pad('claimed / earned', `L${report.claimed} / L${report.earned}`);
pad('vectors', report.vectors.map(v => `${v.name}:${v.pass ? 'PASS' : 'FAIL'}`).join('  '));
pad('findings', report.findings.length ? report.findings.map(f => f.message).join(' | ') : '(clean)');

console.log('\n══ L3→L4: derive the finn CommandPolicy entry — publication ≠ legality ══');
console.log(JSON.stringify(toCommandPolicy(veve, cliDir), null, 2).split('\n').map(l => '  ' + l).join('\n'));

console.log('\n══ ATTACK 1: edit the CLI after attestation (supply-chain swap) ══');
const entry = join(cliDir, 'bin/wordcount.mjs');
const original = readFileSync(entry, 'utf8');
writeFileSync(entry, original.replace('words.length', 'words.length + 1 /* off-by-one backdoor */'));
const att = verifyAttestation(veve, cliDir, signer.publicKey);
pad('attestation after edit', att.ok ? 'VALID (BAD)' : 'INVALID — tree_hash diverged, swap caught');
const vecs = runVectors(veve, cliDir);
pad('vectors after edit', vecs.map(v => `${v.name}:${v.pass ? 'PASS' : 'FAIL'}`).join('  '));
writeFileSync(entry, original); // restore

console.log('\n══ ATTACK 2: claim a ladder level evidence does not support ══');
const liar = structuredClone(veve); liar.ladder.level = 5; liar.vectors = [];
const liarReport = doctor(liar, cliDir, { publicKey: signer.publicKey });
pad('claimed / earned', `L${liarReport.claimed} / L${liarReport.earned}`);
pad('drift finding', (liarReport.findings.find(f => f.message.startsWith('DRIFT')) ?? liarReport.findings[0])?.message);

console.log('\n══ ATTACK 3: lie about determinism (the oracle cosplaying as a contract) ══');
const oracle = structuredClone(veve);
oracle.determinism = { class: 'attestable', declared_by: 'author', ambient: [] }; // attestable but names no entropy source
pad('contradiction caught', doctor(oracle, cliDir, { publicKey: signer.publicKey }).findings.find(f => f.message.includes('LG-5'))?.message);

console.log('\n══ restored: final doctor pass ══');
pad('earned', 'L' + doctor(veve, cliDir, { publicKey: signer.publicKey }).earned);
pad('tree_hash stable', treeHash(cliDir) === veve.attestation.tree_hash ? 'YES' : 'NO');

// ═══════════════════ v0.2.0 additions ═══════════════════
const { livenessVerdict, checkpointPacket, DEFAULT_POLICY } = await import('./liveness.mjs');
const { hashObj } = await import('./asson.mjs');

console.log('\n══ v0.2 — GRADUATE THE DOCTRINE: lexicon-lint (words-with-teeth §2 as a tool) ══');
const lexDir = new URL('../examples/lexicon-lint/', import.meta.url).pathname;
let lexVeve = JSON.parse(readFileSync(join(lexDir, 'veve.json'), 'utf8'));
lexVeve.vectors = [
  harvestVector(lexVeve, lexDir, { name: 'live-specimen-competitive', argv: [],
    stdin: JSON.stringify({ text: 'the offchain funds probably belong to us', rel: 'competitive' }) }),
  harvestVector(lexVeve, lexDir, { name: 'tagged-testimony-clean', argv: [],
    stdin: JSON.stringify({ text: 'Principal believed THJ-owned probably [testimony: ES, conf=M]', rel: 'competitive' }) }),
  harvestVector(lexVeve, lexDir, { name: 'casual-rel-warn-tier', argv: [],
    stdin: JSON.stringify({ text: 'this is probably fine lol', rel: 'casual' }) }),
];
lexVeve = attestBuild(lexVeve, lexDir, signer);
writeFileSync(join(lexDir, 'veve.json'), JSON.stringify(lexVeve, null, 2));
const lexReport = doctor(lexVeve, lexDir, { publicKey: signer.publicKey });
pad('lexicon-lint earned', 'L' + lexReport.earned + ' (claimed L' + lexReport.claimed + ')');
pad('vectors', lexReport.vectors.map(v => `${v.name}:${v.pass ? 'PASS' : 'FAIL'}`).join('  '));
pad('exit semantics pinned', 'live specimen exits 3 (competitive) · casual exits 0 (warn-tier)');

console.log('\n══ v0.2 — THE WATCHDOG: liveness verdicts over a legba-format span log ══');
const t0ms = Date.now() - 100_000;
const mkMove = (i, tool, inputHash, offS) => ({
  record: { kind: 'tool_call', determinism: 're_executable', tool, input_hash: inputHash,
    output_hash: 'sha256:' + 'o'.repeat(64), seq: i, ts: new Date(t0ms + offS * 1000).toISOString() },
  record_hash: hashObj({ i, tool, inputHash, offS }),
});
const healthy = [mkMove(0,'dpr_curve','sha256:'+'a'.repeat(64),0), mkMove(1,'word_count','sha256:'+'b'.repeat(64),20), mkMove(2,'checksum','sha256:'+'c'.repeat(64),45)];
pad('healthy span', livenessVerdict(healthy, DEFAULT_POLICY, { nowMs: t0ms + 60_000 }).action);
const spinning = [...healthy, mkMove(3,'dpr_curve','sha256:'+'d'.repeat(64),50), mkMove(4,'dpr_curve','sha256:'+'d'.repeat(64),55), mkMove(5,'dpr_curve','sha256:'+'d'.repeat(64),60)];
const sv = livenessVerdict(spinning, DEFAULT_POLICY, { nowMs: t0ms + 62_000 });
pad('spinning span (same tool+input ×3)', sv.action + ' — repeats=' + sv.spin.max_repeats + ' (visible from hashes alone)');
const stalled = livenessVerdict(healthy, DEFAULT_POLICY, { nowMs: t0ms + 200_000 });
pad('stalled span (silent 155s)', stalled.action + ' — the recorder makes silence loud');
const exhausted = livenessVerdict(healthy, { ...DEFAULT_POLICY, budget: { tool_calls: 3, wall_s: 9999 } }, { nowMs: t0ms + 60_000 });
pad('exhausted budget (3/3 calls)', exhausted.action);
const cp = checkpointPacket({ span_id: 'run:demo:span:0', run_id: 'run:demo' }, healthy, 'budget_exhausted');
pad('checkpoint packet (chess clock)', cp.verdict.status + ' · moves=' + cp.move_count + ' · work preserved, gate judges');

console.log('\n══ v0.2 — fork window: a 0.1.0 veve is valid but warned ══');
const old = structuredClone(veve); old.veve_version = '0.1.0'; delete old.liveness;
const oldFindings = doctor(old, cliDir, { publicKey: signer.publicKey }).findings;
pad('0.1.0 under the window', (oldFindings.find(f => f.message.startsWith('fork-warn')) ?? {message:'(none)'}).message);
