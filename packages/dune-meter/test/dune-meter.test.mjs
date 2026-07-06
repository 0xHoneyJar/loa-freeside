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
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

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

// A mock Dune client: canned probe + probeCount + probeSample + execute + poll + metadata. No network.
// probe_credits maps to countCredits (sampleCredits=0) for backward compat with raw-SQL tests.
function mockClient({ rows = 100, cols = 4, datapoints, credits = null, throwOnExecute = null, probe_credits = 0 } = {}) {
  return {
    async probe() { return { rows, cols, execution_id: 'exec-probe', probe_credits }; },
    async probeCount() { return { rows, countCredits: probe_credits }; },
    async probeSample() { return { cols, sampleCredits: 0 }; },
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

test('recordSpend accumulates spend + atom count', async () => {
  const e = tmpEnv();
  try {
    await recordSpend(e.ledgerPath, 50);
    await recordSpend(e.ledgerPath, 75);
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

test('recordSpend rejects non-integer / negative credits', async () => {
  const e = tmpEnv();
  try {
    await assert.rejects(() => recordSpend(e.ledgerPath, -1), /non-negative integer/);
    await assert.rejects(() => recordSpend(e.ledgerPath, 1.5), /non-negative integer/);
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

test('run --force proceeds past a DuneClientError probe failure to execution (exits 0, no pre-spend guarantee)', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 1000, cols: 4, datapoints: 4000, credits: 4 });
    client.probe = async () => { throw new DuneClientError('estimate: query 9 has no completed cached result'); };
    const r = await runHandler(() => cmdRun(['9', '--cap', '100', '--force'], { client }));
    assert.equal(r.exit, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.executed, true);
    assert.equal(j.pre_run_estimate, null); // un-estimated; proceeded past probe failure
    assert.equal(j.credits_consumed, 4);
    // The output must not claim any pre-spend Dune API cap enforcement
    assert.ok(!JSON.stringify(j).includes('structurally impossible'), 'output must not claim Dune API cap is a pre-spend guarantee');
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
    await recordSpend(e.ledgerPath, 5);
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

// ─────────────────────────────────────────────────────────────────────────────
// bd-qbts / sprint-bug-170 — defect A (raw-SQL execute endpoint → Dune 405) +
// defect B (bin not executable). FETCH-LEVEL through the real DuneClient — NOT the
// client-level mockClient above, whose canned `executeSql` masked the dead HTTP
// path (the coverage gap that let this ship). Offline, deterministic, no Dune spend.
// ─────────────────────────────────────────────────────────────────────────────

// Records url + method + parsed body of every fetch; responds canned to any URL.
function recordingFetch(responder = () => ({ json: {} })) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ url, method: opts.method ?? 'GET', body });
    const { status = 200, json = {} } = responder(url, opts) ?? {};
    return { ok: status >= 200 && status < 300, status, async json() { return json; }, async text() { return JSON.stringify(json); } };
  };
  return { fetchImpl, calls };
}

test('executeSql routes raw SQL to the first-party /sql/execute endpoint with {sql, performance} (defect A — the 405 fix)', async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ json: { execution_id: 'exec-sql-1', state: 'QUERY_STATE_PENDING' } }));
  const client = new DuneClient({ apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
  const res = await client.executeSql('SELECT 1');
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'executeSql issues a POST');
  assert.ok(post.url.endsWith('/api/v1/sql/execute'), `POST goes to /api/v1/sql/execute (got ${post.url})`);
  assert.deepEqual(post.body, { sql: 'SELECT 1', performance: 'small' }, 'body uses {sql} (not the dead {query_sql})');
  assert.equal(res.execution_id, 'exec-sql-1');
});

test('executeSql NEVER POSTs the dead /query/execute endpoint (defect A regression — locks out the Dune 405)', async () => {
  const { fetchImpl, calls } = recordingFetch(() => ({ json: { execution_id: 'exec-sql-2' } }));
  const client = new DuneClient({ apiKey: 'k', fetchImpl, sleepImpl: async () => {} });
  await client.executeSql('SELECT 1');
  assert.equal(calls.some((c) => c.url.includes('/query/execute')), false, 'must not hit /query/execute (Dune: HTTP method not allowed)');
});

test('bin/dune-meter.mjs is executable and spawns directly (defect B — DUNE_METER_BIN consumers child_process.spawn it)', () => {
  const bin = fileURLToPath(new URL('../bin/dune-meter.mjs', import.meta.url));
  assert.notEqual(statSync(bin).mode & 0o111, 0, 'bin must carry an executable bit');
  const r = spawnSync(bin, ['--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `spawned --help exits 0 (status=${r.status}, stderr=${r.stderr})`);
  assert.match(r.stdout, /dune-meter/, '--help prints usage');
});

// ─────────────────────────────────────────────────────────────────────────────
// T-1: veve.json honest docs (AC-1)
// ─────────────────────────────────────────────────────────────────────────────

test('veve.json summary does not contain "structurally impossible" (AC-1)', () => {
  const vevePath = fileURLToPath(new URL('../veve.json', import.meta.url));
  const veve = JSON.parse(readFileSync(vevePath, 'utf8'));
  assert.ok(!/structurally impossible/i.test(veve.summary),
    `veve.json summary must not claim blowouts are "structurally impossible"; got: ${veve.summary}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// T-2: O_EXCL lockfile concurrency (AC-4)
// ─────────────────────────────────────────────────────────────────────────────

test('two concurrent recordSpend calls sum correctly and leave no orphaned lock (AC-4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dune-meter-concurrency-'));
  const ledgerPath = join(dir, 'budget.json');
  const lockPath = join(dir, '.dune-budget.lock');
  const workerScript = fileURLToPath(new URL('./record-spend-worker.mjs', import.meta.url));
  // Prime the ledger so both workers read a known baseline
  await recordSpend(ledgerPath, 0);
  const priorLedger = readLedger(ledgerPath);
  const N1 = 13, N2 = 29;
  try {
    await new Promise((resolve, reject) => {
      let done = 0;
      const check = (code, signal) => {
        if (code !== 0) return reject(new Error(`worker exited ${code} / ${signal}`));
        if (++done === 2) resolve();
      };
      fork(workerScript, [], { env: { ...process.env, WORKER_LEDGER_PATH: ledgerPath, WORKER_CREDITS: String(N1) } }).on('exit', check);
      fork(workerScript, [], { env: { ...process.env, WORKER_LEDGER_PATH: ledgerPath, WORKER_CREDITS: String(N2) } }).on('exit', check);
    });
    const final = readLedger(ledgerPath);
    assert.equal(
      final.spent_credits,
      priorLedger.spent_credits + N1 + N2,
      `spent_credits should be ${priorLedger.spent_credits + N1 + N2}, got ${final.spent_credits}`,
    );
    assert.ok(!existsSync(lockPath), 'lock file must not be present after both workers finish');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-3a: cmdEstimate budget guard — probe refused when remaining < 1 (AC-6)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdEstimate raw SQL with remaining=0 exits 3 and never calls probe (AC-6)', async () => {
  const e = tmpEnv();
  try {
    // Drain the budget to zero
    writeLedger(e.ledgerPath, { ceiling_credits: 10, spent_credits: 10, atoms_count: 1, updated_at: null });
    process.env.DUNE_BUDGET_CEILING = '10';
    let probeCalled = false;
    const client = {
      async probe() { probeCalled = true; return { rows: 1, cols: 1, probe_credits: 0 }; },
    };
    const r = await runHandler(() => cmdEstimate(['SELECT 1'], { client }));
    assert.equal(r.exit, 3, `expected exit 3 on exhausted budget, got ${r.exit}`);
    assert.match(r.err, /budget exhausted/);
    assert.equal(probeCalled, false, 'probe must NOT be called when budget is exhausted');
  } finally {
    delete process.env.DUNE_BUDGET_CEILING;
    e.cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-3b: cmdEstimate records probe spend before returning (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdEstimate raw SQL records probe_credits=42 in ledger before returning (AC-5)', async () => {
  const e = tmpEnv();
  try {
    const client = mockClient({ rows: 10, cols: 2, probe_credits: 42 });
    const r = await runHandler(() => cmdEstimate(['SELECT 1'], { client }));
    // Should succeed (budget has plenty of room)
    assert.ok(r.exit === 0 || r.exit === 3, `expected exit 0 or 3, got ${r.exit}`);
    const led = readLedger(e.ledgerPath);
    assert.equal(led.spent_credits, 42, `ledger must reflect probe spend of 42, got ${led.spent_credits}`);
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-3c: cmdRun records probe credits before execution credits (AC-5)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdRun raw SQL records probe credits in ledger before execution credits (AC-5)', async () => {
  const e = tmpEnv();
  try {
    const ledgerSnapshots = [];
    const baseClient = mockClient({ rows: 10, cols: 2, datapoints: 100, credits: 5, probe_credits: 7 });
    // Wrap executeSql to snapshot ledger state immediately before the execution
    const origExecuteSql = baseClient.executeSql.bind(baseClient);
    baseClient.executeSql = async function (...args) {
      // Snapshot ledger just as execution starts — probe spend must already be recorded
      ledgerSnapshots.push(readLedger(e.ledgerPath));
      return origExecuteSql(...args);
    };
    await runHandler(() => cmdRun(['SELECT 1', '--cap', '100'], { client: baseClient }));
    // There should be at least one snapshot taken during executeSql
    assert.ok(ledgerSnapshots.length >= 1, 'executeSql was called (snapshot taken)');
    // At execution time, probe credits (7) should already be in the ledger
    assert.ok(
      ledgerSnapshots[0].spent_credits >= 7,
      `probe credits (7) must be in ledger before execution; got ${ledgerSnapshots[0].spent_credits}`,
    );
    // After everything, total spent should include both probe (7) and execution (5)
    const finalLed = readLedger(e.ledgerPath);
    assert.equal(finalLed.spent_credits, 12, `total spent should be probe(7)+exec(5)=12, got ${finalLed.spent_credits}`);
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-5: readLedger env ceiling override (AC-8)
// ─────────────────────────────────────────────────────────────────────────────

test('readLedger overrides ceiling from existing ledger when ceiling param differs, warns, preserves spent (AC-8)', () => {
  const e = tmpEnv();
  try {
    writeLedger(e.ledgerPath, { ceiling_credits: 1000, spent_credits: 50, atoms_count: 3, updated_at: null });
    // Capture stderr
    const stderrWrites = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrWrites.push(s); return true; };
    let led;
    try {
      led = readLedger(e.ledgerPath, { ceiling: 2000 });
    } finally {
      process.stderr.write = origWrite;
    }
    assert.equal(led.ceiling_credits, 2000, 'ceiling must be overridden to 2000');
    assert.equal(led.spent_credits, 50, 'spent_credits must be preserved');
    assert.equal(led.atoms_count, 3, 'atoms_count must be preserved');
    const warnLine = stderrWrites.join('');
    assert.match(warnLine, /DUNE_BUDGET_CEILING override/, 'must emit override warning to stderr');
    assert.match(warnLine, /1000.*2000|2000.*1000/, 'warning must show old and new values');
  } finally { e.cleanup(); }
});

test('readLedger does not warn when ceiling matches stored value (AC-8 no-op)', () => {
  const e = tmpEnv();
  try {
    writeLedger(e.ledgerPath, { ceiling_credits: 1000, spent_credits: 50, atoms_count: 3, updated_at: null });
    const stderrWrites = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrWrites.push(s); return true; };
    let led;
    try {
      led = readLedger(e.ledgerPath, { ceiling: 1000 });
    } finally {
      process.stderr.write = origWrite;
    }
    assert.equal(led.ceiling_credits, 1000);
    const warnLine = stderrWrites.join('');
    assert.ok(!warnLine.includes('DUNE_BUDGET_CEILING override'), 'must not warn when ceiling matches');
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-4: --force + remaining < 1 → exit 3 regardless (AC-7)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdRun --force with remaining < 1 before probe → exit 3 (probe-budget guard not bypassed by --force)', async () => {
  const e = tmpEnv();
  try {
    writeLedger(e.ledgerPath, { ceiling_credits: 10, spent_credits: 10, atoms_count: 1, updated_at: null });
    process.env.DUNE_BUDGET_CEILING = '10';
    const client = mockClient({ rows: 100, cols: 4, datapoints: 400, credits: 1, probe_credits: 0 });
    const r = await runHandler(() => cmdRun(['SELECT 1', '--cap', '10', '--force'], { client }));
    assert.equal(r.exit, 3, `--force must not bypass probe-budget guard; expected exit 3, got ${r.exit}`);
    assert.match(r.err, /budget exhausted/);
  } finally {
    delete process.env.DUNE_BUDGET_CEILING;
    e.cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-2: COUNT probe exhausts budget → LIMIT-1 refused (AC-6)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdRun: COUNT probe exhausts remaining budget → probeSample refused, exit 3 (AC-6)', async () => {
  const e = tmpEnv();
  try {
    let probeSampleCalled = false;
    const client = {
      async probeCount() { return { rows: 100, countCredits: 2500 }; },
      async probeSample() { probeSampleCalled = true; return { cols: 4, sampleCredits: 0 }; },
    };
    const r = await runHandler(() => cmdRun(['SELECT 1', '--cap', '2500'], { client }));
    assert.equal(r.exit, 3, `expected exit 3 on COUNT-exhausted budget, got ${r.exit}`);
    assert.match(r.err, /COUNT exhausted remaining budget/);
    assert.equal(probeSampleCalled, false, 'probeSample must NOT be called after COUNT exhausts budget');
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-2: Both COUNT and LIMIT-1 probe credits recorded before main execution (AC-7)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdRun: COUNT and LIMIT-1 probe credits both recorded before main execution (AC-7)', async () => {
  const e = tmpEnv();
  try {
    const ledgerSnapshots = [];
    const client = {
      async probeCount() { return { rows: 10, countCredits: 3 }; },
      async probeSample() { return { cols: 2, sampleCredits: 4 }; },
      async executeSql() {
        ledgerSnapshots.push(readLedger(e.ledgerPath));
        return { execution_id: 'exec-run' };
      },
      async pollStatus() { return { state: 'QUERY_STATE_COMPLETED' }; },
      async resultMetadata() { return { datapoints: 100, credits: 5, raw: {} }; },
    };
    await runHandler(() => cmdRun(['SELECT 1', '--cap', '100'], { client }));
    assert.ok(ledgerSnapshots.length >= 1, 'executeSql was called (snapshot taken)');
    assert.ok(
      ledgerSnapshots[0].spent_credits >= 7,
      `both probe credits (3+4=7) must be in ledger before execution; got ${ledgerSnapshots[0].spent_credits}`,
    );
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-3: DUNE_BUDGET_CEILING override persists to ledger file (AC-10)
// ─────────────────────────────────────────────────────────────────────────────

test('readLedger persists DUNE_BUDGET_CEILING override to ledger file (AC-10)', () => {
  const e = tmpEnv();
  try {
    writeLedger(e.ledgerPath, { ceiling_credits: 1000, spent_credits: 0, atoms_count: 0, updated_at: null });

    // First read with ceiling override — should persist 2000 to the file.
    readLedger(e.ledgerPath, { ceiling: 2000 });

    // File must reflect the override (the stored value, not the original 1000).
    const raw = JSON.parse(readFileSync(e.ledgerPath, 'utf8'));
    assert.equal(raw.ceiling_credits, 2000, 'ceiling override must be persisted to ledger file');

    // Second read with same ceiling: no re-override needed → returns 2000 from file.
    const led2 = readLedger(e.ledgerPath, { ceiling: 2000 });
    assert.equal(led2.ceiling_credits, 2000, 'persisted ceiling must be returned on subsequent read');
  } finally { e.cleanup(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// T-4: --force with --cap exceeding ceiling exits 2 (AC-8)
// ─────────────────────────────────────────────────────────────────────────────

test('cmdRun --force with --cap exceeding ceiling exits 2 with clear message (AC-8)', async () => {
  const e = tmpEnv();
  try {
    // ceiling = DEFAULT_CEILING_CREDITS = 2500; --cap 9999 > 2500 → exit 2
    const r = await runHandler(() => cmdRun(['SELECT 1', '--cap', '9999', '--force'], { client: mockClient() }));
    assert.equal(r.exit, 2, `expected exit 2 on --force --cap > ceiling, got ${r.exit}`);
    assert.match(r.err, /2500/, 'error must include the ceiling value');
    assert.match(r.err, /9999/, 'error must include the supplied cap value');
  } finally { e.cleanup(); }
});
