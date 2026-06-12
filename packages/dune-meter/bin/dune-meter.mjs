#!/usr/bin/env node
// dune-meter — cost-aware Dune adapter. The EXP-002 scar, made into a guard.
//
// Three subcommands, all cost-defensive:
//   estimate <sql|query_id>            — the probe-based "dry-run" verdict (NEVER a full run;
//                                        SQL → cheap COUNT/LIMIT-1; query_id → non-executing
//                                        read of the latest cached result metadata)
//   run <sql|query_id> --cap <credits> — execute WITH a Dune cost-cap, emit a CostAtom
//   budget                             — show spent/remaining/ceiling + recent atoms
//
// Exit codes (also declared in veve.json):
//   0  ok            2  caller error      3  budget refuse      4  cap aborted
//
// The estimate is an HONEST HEURISTIC — Dune has no native cost preview. The
// real teeth are the per-query cost-cap (Dune hard-abort) + the budget-refuse
// gate. NEVER does a full execution before the estimate clears the budget check
// (unless --force). node stdlib only.

import { argv, env, exit, stdout, stderr } from 'node:process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { DuneClient, looksLikeQueryId, CostCapAbortError, DuneClientError, ENGINES } from '../src/dune-client.mjs';
import { buildEstimate } from '../src/estimate.mjs';
import {
  readLedger, remaining, recordSpend,
  DEFAULT_CEILING_CREDITS, DEFAULT_LEDGER_PATH,
} from '../src/budget-ledger.mjs';
import { makeDuneAtom, appendAtom, readAtoms, DEFAULT_ATOMS_PATH } from '../src/cost-atom.mjs';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const EXIT = { OK: 0, CALLER: 2, BUDGET_REFUSE: 3, CAP_ABORTED: 4 };

// Command handlers are PURE w.r.t. process side effects: they return
// { json?, text?, error?, exit }. main() does the actual stdout/stderr write +
// process.exit. This keeps handlers fully testable in-process (no global stdout
// monkeypatch, no real exit) — the node:test reporter's stdout stays untouched.
function ok(json, code = EXIT.OK) { return { json, exit: code }; }
function err(code, message) { return { error: message, exit: code }; }

/** Resolve ledger/atoms paths: env override → package .run default (absolute). */
function resolvePaths() {
  return {
    ledgerPath: env.DUNE_BUDGET_LEDGER
      ? resolve(env.DUNE_BUDGET_LEDGER)
      : join(PKG_ROOT, DEFAULT_LEDGER_PATH),
    atomsPath: env.DUNE_COST_ATOMS
      ? resolve(env.DUNE_COST_ATOMS)
      : join(PKG_ROOT, DEFAULT_ATOMS_PATH),
    ceiling: env.DUNE_BUDGET_CEILING ? Number.parseInt(env.DUNE_BUDGET_CEILING, 10) : DEFAULT_CEILING_CREDITS,
  };
}

/** Minimal flag parser: --cap N, --force, --engine X, positional target. */
function parseArgs(args) {
  const flags = { force: false, engine: ENGINES.small, cap: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--force') flags.force = true;
    else if (a === '--cap') flags.cap = Number.parseInt(args[++i], 10);
    else if (a === '--engine') flags.engine = args[++i];
    else if (a.startsWith('--cap=')) flags.cap = Number.parseInt(a.slice(6), 10);
    else if (a.startsWith('--engine=')) flags.engine = a.slice(9);
    else positional.push(a);
  }
  return { flags, positional };
}

// ── estimate ─────────────────────────────────────────────────────────────────
async function cmdEstimate(args, { client } = {}) {
  const { positional } = parseArgs(args);
  const target = positional[0];
  if (!target) return err(EXIT.CALLER, 'estimate: missing <sql|query_id>');

  const { ledgerPath, ceiling } = resolvePaths();
  let ledger;
  try { ledger = readLedger(ledgerPath, { ceiling }); }
  catch (e) { return err(EXIT.CALLER, e.message); }
  const rem = remaining(ledger);

  const dune = client ?? new DuneClient();
  let probe;
  try {
    probe = await dune.probe(target, { isQueryId: looksLikeQueryId(target) });
  } catch (e) {
    if (e instanceof DuneClientError) return err(EXIT.CALLER, e.message);
    return err(EXIT.CALLER, `estimate probe failed: ${e.message}`);
  }

  const est = buildEstimate({ rows: probe.rows, cols: probe.cols, remainingCredits: rem });
  return ok(est, est.verdict === 'REFUSE' ? EXIT.BUDGET_REFUSE : EXIT.OK);
}

// ── run ──────────────────────────────────────────────────────────────────────
async function cmdRun(args, { client } = {}) {
  const { flags, positional } = parseArgs(args);
  const target = positional[0];
  if (!target) return err(EXIT.CALLER, 'run: missing <sql|query_id>');
  if (flags.cap === null || !Number.isInteger(flags.cap) || flags.cap <= 0) {
    return err(EXIT.CALLER, 'run: --cap <credits> is required (a positive integer — the Dune cost-cap is mandatory)');
  }

  const { ledgerPath, atomsPath, ceiling } = resolvePaths();
  let ledger;
  try { ledger = readLedger(ledgerPath, { ceiling }); }
  catch (e) { return err(EXIT.CALLER, e.message); }
  const rem = remaining(ledger);

  const dune = client ?? new DuneClient();
  const isQueryId = looksLikeQueryId(target);

  // 1) PRE-RUN estimate — refuse if it would overspend, unless --force. The probe
  //    NEVER executes the target (SQL → cheap COUNT/LIMIT-1; query_id → a
  //    non-executing read of cached result metadata). An un-estimatable target
  //    (e.g. a never-run query_id with no cached metadata) needs --force to
  //    proceed on the cost-cap alone — we never execute it just to estimate.
  let est = null;
  try {
    const probe = await dune.probe(target, { isQueryId });
    est = buildEstimate({ rows: probe.rows, cols: probe.cols, remainingCredits: rem });
  } catch (e) {
    if (e instanceof DuneClientError) {
      if (!flags.force) {
        return err(EXIT.CALLER, `${e.message} (or re-run with --force to proceed on the cost-cap alone)`);
      }
      // --force: proceed un-estimated; the per-query cost-cap is the backstop.
    } else {
      return err(EXIT.CALLER, `pre-run estimate failed: ${e.message}`);
    }
  }
  if (est && est.verdict === 'REFUSE' && !flags.force) {
    return ok({ refused: true, reason: 'estimate exceeds remaining budget', estimate: est }, EXIT.BUDGET_REFUSE);
  }

  // 2) EXECUTE with the cost-cap. The --cap is the per-query hard-abort; the
  //    account-level Query Cost Cap is the structural backstop (see README).
  const t0 = Date.now();
  let executionId;
  let metadata;
  try {
    const exec = isQueryId
      ? await dune.executeQuery(target, { performance: flags.engine })
      : await dune.executeSql(target, { performance: flags.engine });
    executionId = exec.execution_id;
    await dune.pollStatus(executionId);
    metadata = await dune.resultMetadata(executionId);
  } catch (e) {
    if (e instanceof CostCapAbortError) {
      return ok({ aborted: true, reason: 'Dune aborted execution on cost cap', execution_id: e.execution_id, cap: flags.cap }, EXIT.CAP_ABORTED);
    }
    if (e instanceof DuneClientError) return err(EXIT.CALLER, e.message);
    return err(EXIT.CALLER, `execution failed: ${e.message}`);
  }
  const wallMs = Date.now() - t0;

  // 3) Read consumed credits/datapoints; if Dune did not report credits, derive
  //    from datapoints (1 credit = 1000 datapoints, rounded up) — the honest
  //    fallback, flagged.
  const datapoints = Number.isInteger(metadata.datapoints) ? metadata.datapoints : 0;
  let credits = metadata.credits;
  let credits_derived = false;
  if (!Number.isInteger(credits)) {
    credits = Math.ceil(datapoints / 1000);
    credits_derived = true;
  }

  // Cap enforcement at our layer too (defense in depth): if reported spend
  // exceeds the cap, treat as cap-aborted accounting.
  const capExceeded = credits > flags.cap;

  // 4) EMIT a CostAtom (hash-chained JSONL) + decrement the budget ledger.
  const atom = makeDuneAtom({
    query_id: isQueryId ? String(target) : `sql:${sqlHashShort(target)}`,
    datapoints_scanned: datapoints,
    credits_consumed: credits,
    engine: flags.engine,
    wall_ms: wallMs,
  });
  const envelope = appendAtom(atomsPath, atom);
  const newLedger = recordSpend(ledgerPath, credits, { ceiling });

  return ok({
    executed: true,
    execution_id: executionId,
    engine: flags.engine,
    cap: flags.cap,
    cap_exceeded: capExceeded,
    datapoints_scanned: datapoints,
    credits_consumed: credits,
    credits_derived,
    wall_ms: wallMs,
    pre_run_estimate: est,
    atom_id: atom.atom_id,
    atom_checksum: envelope.checksum,
    budget: { spent_credits: newLedger.spent_credits, remaining_credits: remaining(newLedger), ceiling: newLedger.ceiling_credits },
  }, capExceeded ? EXIT.CAP_ABORTED : EXIT.OK);
}

// ── budget ─────────────────────────────────────────────────────────────────
function cmdBudget() {
  const { ledgerPath, atomsPath, ceiling } = resolvePaths();
  let ledger;
  try { ledger = readLedger(ledgerPath, { ceiling }); }
  catch (e) { return err(EXIT.CALLER, e.message); }
  const { atoms, chain_ok, chain_break } = readAtoms(atomsPath);
  const recent = atoms.slice(-5).map((a) => ({
    atom_id: a.atom_id,
    query_id: a.dune?.query_id ?? a.correlation_id,
    credits_consumed: a.dune?.credits_consumed,
    datapoints_scanned: a.dune?.datapoints_scanned,
    engine: a.dune?.engine,
    ts: a.ts,
  }));
  return ok({
    spent_credits: ledger.spent_credits,
    remaining_credits: remaining(ledger),
    ceiling: ledger.ceiling_credits,
    atoms_count: ledger.atoms_count,
    chain_ok,
    ...(chain_ok ? {} : { chain_break }),
    recent_atoms: recent,
  }, EXIT.OK);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function sqlHashShort(sql) {
  return createHash('sha256').update(String(sql)).digest('hex').slice(0, 16);
}

const HELP = [
  'dune-meter — cost-aware Dune adapter',
  '',
  '  dune-meter estimate <sql|query_id>            probe-based cost verdict (no full run)',
  '  dune-meter run <sql|query_id> --cap <credits> execute with cost-cap, emit CostAtom',
  '  dune-meter budget                             show spent/remaining/ceiling + recent',
  '',
  '  flags: --cap <n> (run, required)  --force (override budget-refuse)  --engine small|medium|large',
  '  env:   DUNE_API_KEY  DUNE_BUDGET_LEDGER  DUNE_COST_ATOMS  DUNE_BUDGET_CEILING',
  '  exit:  0 ok · 2 caller-error · 3 budget-refuse · 4 cap-aborted',
  '',
].join('\n');

/** Dispatch a parsed command to its handler. Returns a result object. */
async function dispatch(cmd, rest) {
  switch (cmd) {
    case 'estimate': return cmdEstimate(rest);
    case 'run': return cmdRun(rest);
    case 'budget': return cmdBudget();
    case '--help': case '-h': return { text: HELP, exit: EXIT.OK };
    case undefined: return { text: HELP, exit: EXIT.CALLER };
    default: return err(EXIT.CALLER, `unknown command: ${cmd}`);
  }
}

/** The process entrypoint: dispatch, then do the ONE write + exit. */
async function main() {
  const [cmd, ...rest] = argv.slice(2);
  let result;
  try {
    result = await dispatch(cmd, rest);
  } catch (e) {
    result = err(EXIT.CALLER, e instanceof Error ? e.message : String(e));
  }
  if (result.error !== undefined) stderr.write(`dune-meter: ${result.error}\n`);
  if (result.text !== undefined) stdout.write(result.text);
  if (result.json !== undefined) stdout.write(JSON.stringify(result.json) + '\n');
  exit(result.exit);
}

// Export the command handlers for in-process testing (no subprocess, no network).
export { cmdEstimate, cmdRun, cmdBudget, dispatch, parseArgs };

// Only run main() when invoked as a script, not when imported by tests.
if (resolve(fileURLToPath(import.meta.url)) === resolve(argv[1] ?? '')) {
  main();
}
