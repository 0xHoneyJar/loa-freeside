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

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

const LOCK_MAX_ATTEMPTS = 10;
const LOCK_RETRY_MS = 100;
const LOCK_STALE_S = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire an O_EXCL lockfile. Loops up to LOCK_MAX_ATTEMPTS times.
 * Stale lock (mtime > 60s AND process gone) is cleared and retried once.
 */
async function acquireLock(lockPath) {
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeSync(fd, String(process.pid));
      return fd;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Check for stale lock
      try {
        const stat = statSync(lockPath);
        const ageS = (Date.now() - stat.mtimeMs) / 1000;
        if (ageS > LOCK_STALE_S) {
          const storedPid = Number(readFileSync(lockPath, 'utf8').trim());
          let gone = false;
          try { process.kill(storedPid, 0); } catch (ke) { if (ke.code === 'ESRCH') gone = true; }
          if (gone) {
            try { unlinkSync(lockPath); } catch (_) { /* lost race, continue */ }
            continue; // retry immediately
          }
        }
      } catch (_) { /* stat/read failed — contended, fall through to sleep */ }
      await sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error('budget-ledger: could not acquire lock after 10 attempts');
}

function releaseLock(lockPath, fd) {
  try { closeSync(fd); } catch (_) {}
  try { unlinkSync(lockPath); } catch (_) {}
}

/** Dune free-tier ceiling: 2,500 credits = 2,500,000 datapoints. */
export const DEFAULT_CEILING_CREDITS = 2500;

/** Default ledger path (the CLI passes an absolute path). */
export const DEFAULT_LEDGER_PATH = '.run/dune-budget.json';

/**
 * Read the budget ledger. Returns a fresh ledger at the default ceiling if the
 * file does not exist. Throws on a corrupt (unparseable) file — a corrupt budget
 * ledger is a refuse-to-spend condition, not a silently-reset-to-full one.
 */
export function readLedger(path, { ceiling } = {}) {
  // `ceiling` is an EXPLICIT operator override (DUNE_BUDGET_CEILING) — callers pass it
  // ONLY when the env var is set. Defaulting it here made every env-less invocation
  // "override" a persisted lower ceiling back UP to 2500: a silent budget raise, the
  // exact inversion of what a ceiling is for (BB #448 HIGH).
  if (!existsSync(path)) {
    return {
      ceiling_credits: ceiling ?? DEFAULT_CEILING_CREDITS,
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
  if (ceiling !== undefined && ceiling !== parsed.ceiling_credits) {
    process.stderr.write(
      `dune-meter: DUNE_BUDGET_CEILING override active: ${parsed.ceiling_credits} → ${ceiling} credits\n`
    );
    writeLedger(path, { ...parsed, ceiling_credits: ceiling });
    parsed.ceiling_credits = ceiling;
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
 * Decrement the budget by `credits` (record a spend). Uses an O_EXCL lockfile to
 * serialize the read-modify-write, preventing concurrent callers from dropping each
 * other's spends. Returns the new ledger.
 * `credits` must be a non-negative integer.
 */
export async function recordSpend(path, credits, { ceiling } = {}) {
  if (!Number.isInteger(credits) || credits < 0) {
    throw new Error(`budget-ledger: spend must be a non-negative integer (got ${credits})`);
  }
  const lockPath = join(dirname(path), '.dune-budget.lock');
  let fd;
  try {
    fd = await acquireLock(lockPath);
  } catch (err) {
    throw new Error(`budget-ledger: could not acquire lock — spend of ${credits} credits is unrecorded; add these credits manually. (${err.message})`);
  }
  try {
    const ledger = readLedger(path, { ceiling });
    const next = {
      ceiling_credits: ledger.ceiling_credits,
      spent_credits: ledger.spent_credits + credits,
      atoms_count: ledger.atoms_count + 1,
      updated_at: ledger.updated_at,
    };
    return writeLedger(path, next);
  } finally {
    releaseLock(lockPath, fd);
  }
}
