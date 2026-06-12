// dune-meter.test.mjs — offline, deterministic unit tests.
//
// NO live Dune call ever runs here (the whole point of the package is cost-
// safety — don't spend credits to test the cost guard). The Dune client is
// mocked: each command takes an injected client with canned probe/execute/poll/
// metadata responses. Tests cover:
//   • estimate verdict logic — OK / WARN / REFUSE thresholds (the 25% + 100% boundaries)
//   • budget-ledger atomic read/write + remaining + recordSpend
//   • cost-atom hash-chain continuity (prev_hash linkage) + tamper detection
//   • exit-code mapping (0 / 2 / 3 / 4) through the CLI command handlers

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { creditsForDatapoints, estimateDatapoints, verdictFor, buildEstimate } from '../src/estimate.mjs';
import {
  readLedger, writeLedger, remaining, recordSpend, DEFAULT_CEILING_CREDITS,
} from '../src/budget-ledger.mjs';
import {
  makeDuneAtom, makeEnvelope, appendAtom, readAtoms, tailHash, GENESIS_PREV_HASH, atomChecksum,
} from '../src/cost-atom.mjs';
import { DuneClient, DuneClientError } from '../src/dune-client.mjs';
import { cmdEstimate, cmdRun, cmdBudget } from '../bin/dune-meter.mjs';

// ── test harness ──────────────────────────────────────────────────────────────
// The command handlers are pure w.r.t. process side effects: they RETURN
// { json?, text?, error?, exit }. No stdout monkeypatch, no real process.exit —
// so the node:test reporter is never clobbered. We normalize to the shape the
// assertions use: { out (stringified json), err (error string), exit }.
async function runHandler(fn) {
  const result = await fn();
  return {
    out: result.json !== undefined ? JSON.stringify(result.json) : (result.text ?? ''),
    err: result.error ?? '',
    exit: result.exit,
  };
}

function tmpEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'dune-meter-'));
  const prev = { L: process.env.DUNE_BUDGET_LEDGER, A: process.env.DUNE_COST_ATOMS, C: process.env.DUNE_BUDGET_CEILING };
  process.env.DUNE_BUDGET_LEDGER = join(dir, 'budget.json');
  process.env.DUNE_COST_ATOMS = join(dir, 'atoms.jsonl');
  delete process.env.DUNE_BUDGET_CEILING;
  return {
    dir,
    ledgerPath: process.env.DUNE_BUDGET_LEDGER,
    atomsPath: process.env.DUNE_COST_ATOMS,
    cleanup() {
      process.env.DUNE_BUDGET_LEDGER = prev.L; process.env.DUNE_COST_ATOMS = prev.A; process.env.DUNE_BUDGET_CEILING = prev.C;
      if (prev.L === undefined) delete process.env.DUNE_BUDGET_LEDGER;
      if (prev.A === undefined) delete process.env.DUNE_COST_ATOMS;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A mock Dune client: canned probe + execute + poll + metadata. No network.
function mockClient({ rows = 100, cols = 4, datapoints, credits = null, throwOnExecute = null } = {}) {
  return {
    async probe() { return { rows, cols, execution_id: 'exec-probe' }; },
    async executeQuery() { if (throwOnExecute) throw throwOnExecute; return { execution_id: 'exec-run' }; },
    async executeSql() { if (throwOnExecute) throw throwOnExecute; return { execution_id: 'exec-run' }; },
    async pollStatus() { if (throwOnExecute) throw throwOnExecute; return { state: 'QUERY_STATE_COMPLETED' }; },
    async resultMetadata() {
      return { datapoints: datapoints ?? rows * cols, credits, raw: {} };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// estimate verdict logic
// ─────────────────────────────────────────────────────────────────────────────

test('creditsForDatapoints rounds up per 1000', () => {
  assert.equal(creditsForDatapoints(0), 0);
  assert.equal(creditsForDatapoints(1), 1);
  assert.equal(creditsForDatapoints(1000), 1);
  assert.equal(creditsForDatapoints(1001), 2);
  assert.equal(creditsForDatapoints(2500000), 2500);
});

test('estimateDatapoints = rows × cols', () => {
  assert.equal(estimateDatapoints(100, 4), 400);
  assert.equal(estimateDatapoints(0, 9), 0);
});

test('verdictFor: OK when est <= 25% of remaining', () => {
  // remaining 2500, 25% = 625. est 625 → OK (inclusive boundary), 626 → WARN.
  assert.equal(verdictFor(625, 2500), 'OK');
  assert.equal(verdictFor(626, 2500), 'WARN');
  assert.equal(verdictFor(0, 2500), 'OK');
});

test('verdictFor: WARN when est > 25% but <= remaining', () => {
  assert.equal(verdictFor(1000, 2500), 'WARN');
  assert.equal(verdictFor(2500, 2500), 'WARN'); // exactly remaining → still affordable → WARN, not REFUSE
});

test('verdictFor: REFUSE when est > remaining', () => {
  assert.equal(verdictFor(2501, 2500), 'REFUSE');
  assert.equal(verdictFor(1, 0), 'REFUSE');
});

test('buildEstimate flags heuristic honestly', () => {
  const est = buildEstimate({ rows: 1000, cols: 5, remainingCredits: 2500 });
  assert.equal(est.estimated_datapoints, 5000);
  assert.equal(est.estimated_credits, 5);
  assert.equal(est.verdict, 'OK');
  assert.equal(est.heuristic, true);
  assert.match(est.note, /no native cost preview/);
});

// ─────────────────────────────────────────────────────────────────────────────
// budget-ledger atomic read/write
// ─────────────────────────────────────────────────────────────────────────────

test('readLedger returns fresh default when absent', () => {
  const e = tmpEnv();
  try {
    const led = readLedger(e.ledgerPath);
    assert.equal(led.ceiling_credits, DEFAULT_CEILING_CREDITS);
    assert.equal(led.spent_credits, 0);
    assert.equal(led.atoms_count, 0);
    assert.equal(remaining(led), 2500);
  } finally { e.cleanup(); }
});

test('writeLedger then readLedger round-trips + stamps updated_at', () => {
  const e = tmpEnv();
  try {
    writeLedger(e.ledgerPath, { ceiling_credits: 2500, spent_credits: 100, atoms_count: 2, updated_at: null });
    const led = readLedger(e.ledgerPath);
    assert.equal(led.spent_credits, 100);
    assert.equal(led.atoms_count, 2);
    assert.equal(remaining(led), 2400);
    assert.ok(typeof led.updated_at === 'string' && led.updated_at.length > 0);
    // atomic write leaves no temp file behind
    const files = readFileSync(e.ledgerPath, 'utf8');
    assert.match(files, /"spent_credits": 100/);
  } finally { e.cleanup(); }
});

test('recordSpend accumulates spend + atom count', () => {
  const e = tmpEnv();
  try {
    recordSpend(e.ledgerPath, 50);
    recordSpend(e.ledgerPath, 75);
    const led = readLedger(e.ledgerPath);
    assert.equal(led.spent_credits, 125);
    assert.equal(led.atoms_count, 2);
    assert.equal(remaining(led), 2375);
  } finally { e.cleanup(); }
});

test('readLedger throws on corrupt ledger (refuse-to-spend, not reset)', () => {
  const e = tmpEnv();
  try {
    writeFileSync(e.ledgerPath, '{ this is not json');
    assert.throws(() => readLedger(e.ledgerPath), /corrupt ledger/);
  } finally { e.cleanup(); }
});

test('recordSpend rejects non-integer / negative credits', () => {
  const e = tmpEnv();
  try {
    assert.throws(() => recordSpend(e.ledgerPath, -1), /non-negative integer/);
    assert.throws(() => recordSpend(e.ledgerPath, 1.5), /non-negative integer/);
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// cost-atom hash-chain continuity
// ─────────────────────────────────────────────────────────────────────────────

test('first atom links to GENESIS_PREV_HASH', () => {
  const e = tmpEnv();
  try {
    assert.equal(tailHash(e.atomsPath), GENESIS_PREV_HASH);
    const atom = makeDuneAtom({ query_id: '123', datapoints_scanned: 4000, credits_consumed: 4, engine: 'small', wall_ms: 1200, ts: 1000 });
    const env = appendAtom(e.atomsPath, atom);
    assert.equal(env.prev_hash, GENESIS_PREV_HASH);
    assert.match(env.checksum, /^sha256:[0-9a-f]{64}$/);
  } finally { e.cleanup(); }
});

test('chain links each atom to the previous checksum', () => {
  const e = tmpEnv();
  try {
    const a1 = appendAtom(e.atomsPath, makeDuneAtom({ query_id: '1', datapoints_scanned: 1000, credits_consumed: 1, engine: 'small', wall_ms: 10, ts: 1 }));
    const a2 = appendAtom(e.atomsPath, makeDuneAtom({ query_id: '2', datapoints_scanned: 2000, credits_consumed: 2, engine: 'small', wall_ms: 20, ts: 2 }));
    const a3 = appendAtom(e.atomsPath, makeDuneAtom({ query_id: '3', datapoints_scanned: 3000, credits_consumed: 3, engine: 'small', wall_ms: 30, ts: 3 }));
    assert.equal(a2.prev_hash, a1.checksum);
    assert.equal(a3.prev_hash, a2.checksum);
    const read = readAtoms(e.atomsPath);
    assert.equal(read.atoms.length, 3);
    assert.equal(read.chain_ok, true);
    assert.equal(read.chain_break, null);
    // the dune-native cost fields survive the round-trip
    assert.equal(read.atoms[2].dune.credits_consumed, 3);
    assert.equal(read.atoms[2].call_class, 'dune');
  } finally { e.cleanup(); }
});

test('readAtoms detects a broken chain (tampered prev_hash)', () => {
  const e = tmpEnv();
  try {
    appendAtom(e.atomsPath, makeDuneAtom({ query_id: '1', datapoints_scanned: 1000, credits_consumed: 1, engine: 'small', wall_ms: 10, ts: 1 }));
    appendAtom(e.atomsPath, makeDuneAtom({ query_id: '2', datapoints_scanned: 2000, credits_consumed: 2, engine: 'small', wall_ms: 20, ts: 2 }));
    // Tamper: rewrite line 2 with a re-checksummed envelope whose prev_hash is wrong.
    const lines = readFileSync(e.atomsPath, 'utf8').split('\n').filter(Boolean);
    const atom2 = makeDuneAtom({ query_id: '2', datapoints_scanned: 2000, credits_consumed: 2, engine: 'small', wall_ms: 20, ts: 2 });
    const forged = makeEnvelope(atom2, GENESIS_PREV_HASH); // wrong link, but self-consistent
    writeFileSync(e.atomsPath, lines[0] + '\n' + JSON.stringify(forged) + '\n');
    const read = readAtoms(e.atomsPath);
    assert.equal(read.chain_ok, false);
    assert.equal(read.chain_break.line, 2);
  } finally { e.cleanup(); }
});

test('readAtoms flags a self-checksum mismatch as malformed', () => {
  const e = tmpEnv();
  try {
    const atom = makeDuneAtom({ query_id: '1', datapoints_scanned: 1000, credits_consumed: 1, engine: 'small', wall_ms: 10, ts: 1 });
    const env = makeEnvelope(atom, GENESIS_PREV_HASH);
    env.atom.dune.credits_consumed = 999; // mutate body after checksum
    writeFileSync(e.atomsPath, JSON.stringify(env) + '\n');
    const read = readAtoms(e.atomsPath);
    assert.equal(read.atoms.length, 0);
    assert.equal(read.malformed.length, 1);
    assert.match(read.malformed[0].reason, /checksum mismatch/);
  } finally { e.cleanup(); }
});

test('makeDuneAtom rejects non-integer cost fields', () => {
  assert.throws(() => makeDuneAtom({ query_id: '1', datapoints_scanned: 1.5, credits_consumed: 1, engine: 'small', wall_ms: 10 }), /non-negative integer/);
  assert.throws(() => makeDuneAtom({ query_id: '1', datapoints_scanned: 1000, credits_consumed: -1, engine: 'small', wall_ms: 10 }), /non-negative integer/);
});

// ─────────────────────────────────────────────────────────────────────────────
// DuneClient.probe — the estimate input MUST NOT full-execute a saved query
// (the design-doc constraint "No full execution"). Fetch is mocked; no network.
// ─────────────────────────────────────────────────────────────────────────────

// A mock fetch recording every call. Each route returns a canned JSON response.
function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET' });
    for (const [match, make] of routes) {
      if (url.includes(match)) {
        const { status = 200, json = {} } = make(url, opts);
        return { ok: status >= 200 && status < 300, status, async json() { return json; }, async text() { return JSON.stringify(json); } };
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

test('probe(query_id) reads cached metadata via results endpoint — NEVER executes', async () => {
  const { fetchImpl, calls } = mockFetch([
    ['/results', () => ({ json: { is_execution_finished: true, result: { metadata: { total_row_count: 500, column_names: ['a', 'b', 'c'] } } } })],
  ]);
  const client = new DuneClient({ apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
  const { rows, cols } = await client.probe('12345', { isQueryId: true });
  assert.equal(rows, 500);
  assert.equal(cols, 3);
  // The whole point: no POST /execute, no /status poll — estimate must not run it.
  assert.equal(calls.some((c) => c.url.includes('/execute')), false, 'estimate must NOT execute a saved query');
  assert.equal(calls.some((c) => c.url.includes('/status')), false, 'estimate must NOT poll an execution');
  assert.ok(calls.every((c) => c.method === 'GET'), 'estimate reads (GET) only — no mutating POST');
  assert.ok(calls.some((c) => c.url.includes('/query/12345/results')), 'reads the cached-results endpoint');
});

test('probe(query_id) raises caller-error (never executes) when no cached result exists', async () => {
  const { fetchImpl, calls } = mockFetch([
    ['/results', () => ({ json: { is_execution_finished: false } })],
  ]);
  const client = new DuneClient({ apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(
    () => client.probe('12345', { isQueryId: true }),
    (e) => e instanceof DuneClientError && /no completed cached result|no cached result/.test(e.message),
  );
  assert.equal(calls.some((c) => c.url.includes('/execute')), false, 'must not execute to fill a missing cache');
});

// ─────────────────────────────────────────────────────────────────────────────
// exit-code mapping through the CLI command handlers (mocked client)
// ─────────────────────────────────────────────────────────────────────────────

test('estimate exit 0 on OK verdict', async () => {
  const e = tmpEnv();
  try {
    const r = await runHandler(() => cmdEstimate(['12345'], { client: mockClient({ rows: 100, cols: 4 }) }));
    assert.equal(r.exit, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.verdict, 'OK');
    assert.equal(j.estimated_datapoints, 400);
  } finally { e.cleanup(); }
});

test('estimate exit 3 on REFUSE verdict (est > remaining)', async () => {
  const e = tmpEnv();
  try {
    // remaining 2500 → 2,500,001 datapoints = 2501 credits > 2500 → REFUSE
    const r = await runHandler(() => cmdEstimate(['12345'], { client: mockClient({ rows: 2500001, cols: 1 }) }));
    assert.equal(r.exit, 3);
    assert.equal(JSON.parse(r.out).verdict, 'REFUSE');
  } finally { e.cleanup(); }
});

test('estimate exit 2 on missing target', async () => {
  const e = tmpEnv();
  try {
    const r = await runHandler(() => cmdEstimate([], { client: mockClient() }));
    assert.equal(r.exit, 2);
    assert.match(r.err, /missing/);
  } finally { e.cleanup(); }
});

test('run exit 2 without required --cap', async () => {
  const e = tmpEnv();
  try {
    const r = await runHandler(() => cmdRun(['12345'], { client: mockClient() }));
    assert.equal(r.exit, 2);
    assert.match(r.err, /--cap/);
  } finally { e.cleanup(); }
});

test('run exit 3 when pre-run estimate refuses (no --force)', async () => {
  const e = tmpEnv();
  try {
    const r = await runHandler(() => cmdRun(['12345', '--cap', '10'], { client: mockClient({ rows: 2500001, cols: 1 }) }));
    assert.equal(r.exit, 3);
    assert.equal(JSON.parse(r.out).refused, true);
    // budget ledger untouched — nothing spent on a refused run
    const led = readLedger(e.ledgerPath);
    assert.equal(led.spent_credits, 0);
  } finally { e.cleanup(); }
});

test('run requires --force when the target cannot be estimated (never-run query_id)', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 1000, cols: 4, datapoints: 4000, credits: 4 });
    client.probe = async () => { throw new DuneClientError('estimate: query 9 has no completed cached result'); };
    const r = await runHandler(() => cmdRun(['9', '--cap', '100'], { client }));
    assert.equal(r.exit, 2);
    assert.match(r.err, /--force/);
    // nothing executed → ledger untouched
    assert.equal(readLedger(e.ledgerPath).spent_credits, 0);
  } finally { e.cleanup(); }
});

test('run --force proceeds past an un-estimatable target (cost-cap is the backstop)', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 1000, cols: 4, datapoints: 4000, credits: 4 });
    client.probe = async () => { throw new DuneClientError('estimate: query 9 has no completed cached result'); };
    const r = await runHandler(() => cmdRun(['9', '--cap', '100', '--force'], { client }));
    assert.equal(r.exit, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.executed, true);
    assert.equal(j.pre_run_estimate, null); // un-estimated; proceeded on the cap alone
    assert.equal(j.credits_consumed, 4);
  } finally { e.cleanup(); }
});

test('run executes, emits a CostAtom, decrements budget (happy path)', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 1000, cols: 4, datapoints: 4000, credits: 4 });
    const r = await runHandler(() => cmdRun(['12345', '--cap', '100'], { client }));
    assert.equal(r.exit, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.executed, true);
    assert.equal(j.credits_consumed, 4);
    assert.equal(j.datapoints_scanned, 4000);
    assert.equal(j.budget.spent_credits, 4);
    assert.equal(j.budget.remaining_credits, 2496);
    // atom was written + chains from genesis
    const read = readAtoms(e.atomsPath);
    assert.equal(read.atoms.length, 1);
    assert.equal(read.chain_ok, true);
    assert.equal(read.atoms[0].dune.credits_consumed, 4);
  } finally { e.cleanup(); }
});

test('run exit 4 when reported spend exceeds --cap (cap-aborted accounting)', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 50000, cols: 4, datapoints: 200000, credits: 200 });
    const r = await runHandler(() => cmdRun(['12345', '--cap', '10', '--force'], { client }));
    assert.equal(r.exit, 4);
    assert.equal(JSON.parse(r.out).cap_exceeded, true);
  } finally { e.cleanup(); }
});

test('run exit 4 when Dune aborts on cost cap (CostCapAbortError)', async () => {
  const e = tmpEnv();
  try {
    const { CostCapAbortError } = await import('../src/dune-client.mjs');
    const client = mockClient({ throwOnExecute: new CostCapAbortError('aborted', 'exec-x') });
    // probe still works; execute throws the cap abort
    client.probe = async () => ({ rows: 10, cols: 2, execution_id: 'p' });
    const r = await runHandler(() => cmdRun(['12345', '--cap', '100'], { client }));
    assert.equal(r.exit, 4);
    assert.equal(JSON.parse(r.out).aborted, true);
  } finally { e.cleanup(); }
});

test('run derives credits from datapoints when Dune reports none', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 1000, cols: 3, datapoints: 3001, credits: null });
    const r = await runHandler(() => cmdRun(['12345', '--cap', '100'], { client }));
    const j = JSON.parse(r.out);
    assert.equal(j.credits_derived, true);
    assert.equal(j.credits_consumed, 4); // ceil(3001/1000)
  } finally { e.cleanup(); }
});

test('budget reports spent/remaining/ceiling + recent atoms + chain status', async () => {
  const e = tmpEnv();
  try {
    appendAtom(e.atomsPath, makeDuneAtom({ query_id: '7', datapoints_scanned: 5000, credits_consumed: 5, engine: 'small', wall_ms: 100, ts: 1 }));
    recordSpend(e.ledgerPath, 5);
    const r = await runHandler(() => cmdBudget());
    assert.equal(r.exit, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.spent_credits, 5);
    assert.equal(j.remaining_credits, 2495);
    assert.equal(j.ceiling, 2500);
    assert.equal(j.chain_ok, true);
    assert.equal(j.recent_atoms.length, 1);
    assert.equal(j.recent_atoms[0].credits_consumed, 5);
  } finally { e.cleanup(); }
});

test('budget recent_atoms caps at last 5', async () => {
  const e = tmpEnv();
  try {
    for (let i = 1; i <= 7; i++) {
      appendAtom(e.atomsPath, makeDuneAtom({ query_id: String(i), datapoints_scanned: 1000 * i, credits_consumed: i, engine: 'small', wall_ms: 10, ts: i }));
    }
    const r = await runHandler(() => cmdBudget());
    const j = JSON.parse(r.out);
    assert.equal(j.recent_atoms.length, 5);
    assert.equal(j.recent_atoms[0].query_id, '3'); // atoms 3..7
    assert.equal(j.recent_atoms[4].query_id, '7');
  } finally { e.cleanup(); }
});
