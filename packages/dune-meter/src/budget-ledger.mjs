// budget-ledger.mjs — the credit budget the cost-cap defends.
//
// {ceiling_credits, spent_credits, atoms_count, updated_at}. Integer credits.
// Default ceiling 2500 (Dune free tier: 2,500 credits). Atomic write via
// temp-file + rename so a crash mid-write never leaves a torn ledger — the rename
// is the commit point (POSIX atomic on the same filesystem).
//
// node:fs only. The budget ledger is the SOFT guard (it informs estimate/run
// verdicts); Dune's per-query Query Cost Cap is the HARD guard (it aborts a
// runaway scan at the source). Both exist because EXP-002 had neither.

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

/** Dune free-tier ceiling: 2,500 credits = 2,500,000 datapoints. */
export const DEFAULT_CEILING_CREDITS = 2500;

/** Default ledger path (the CLI passes an absolute path). */
export const DEFAULT_LEDGER_PATH = '.run/dune-budget.json';

/**
 * Read the budget ledger. Returns a fresh ledger at the default ceiling if the
 * file does not exist. Throws on a corrupt (unparseable) file — a corrupt budget
 * ledger is a refuse-to-spend condition, not a silently-reset-to-full one.
 */
export function readLedger(path, { ceiling = DEFAULT_CEILING_CREDITS } = {}) {
  if (!existsSync(path)) {
    return {
      ceiling_credits: ceiling,
      spent_credits: 0,
      atoms_count: 0,
      updated_at: null,
    };
  }
  const raw = readFileSync(path, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`budget-ledger: corrupt ledger at ${path} (${err instanceof Error ? err.message : err}) — refusing to spend`);
  }
  for (const k of ['ceiling_credits', 'spent_credits', 'atoms_count']) {
    if (!Number.isInteger(parsed[k]) || parsed[k] < 0) {
      throw new Error(`budget-ledger: field ${k} is not a non-negative integer — refusing to spend`);
    }
  }
  return parsed;
}

/** Remaining credits = ceiling − spent (clamped at 0, never negative). */
export function remaining(ledger) {
  return Math.max(0, ledger.ceiling_credits - ledger.spent_credits);
}

/**
 * Atomically write the ledger: write a sibling temp file, then rename over the
 * target. The temp file lives in the SAME directory so the rename is atomic
 * (cross-device renames are not). updated_at is stamped to an ISO string.
 */
export function writeLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  const stamped = { ...ledger, updated_at: new Date().toISOString() };
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, JSON.stringify(stamped, null, 2) + '\n', { encoding: 'utf8' });
  renameSync(tmp, path); // atomic commit
  return stamped;
}

/**
 * Decrement the budget by `credits` (record a spend). Reads the current ledger,
 * adds the spend + one atom, writes atomically. Returns the new ledger.
 * `credits` must be a non-negative integer.
 */
export function recordSpend(path, credits, { ceiling = DEFAULT_CEILING_CREDITS } = {}) {
  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error(`budget-ledger: spend must be a non-negative integer (got ${credits})`);
  }
  const ledger = readLedger(path, { ceiling });
  const next = {
    ceiling_credits: ledger.ceiling_credits,
    spent_credits: ledger.spent_credits + credits,
    atoms_count: ledger.atoms_count + 1,
    updated_at: ledger.updated_at,
  };
  return writeLedger(path, next);
}
