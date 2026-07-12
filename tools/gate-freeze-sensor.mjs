#!/usr/bin/env node
/**
 * gate-freeze-sensor.mjs — the merge-gate freeze sensor (estate immune kit).
 *
 * The estate-coherence banner COUNTS rotting PRs ("34 rotting PRs") but never diagnoses the
 * CAUSE. Most of the time a stalled backlog is not N independent problems — it is ONE numb
 * required status check that is red on (almost) every open PR, freezing the whole backlog
 * behind it. branch-protection strict-mode compounds it (every PR must also rebase).
 *
 * This sensor finds the ROOT: for a repo's branch-protection required checks, it computes the
 * freeze ratio of each check across the open-PR backlog and names the single check doing the
 * freezing. It makes the gate's verdict legible instead of leaving "the PRs are just stuck."
 *
 * It is the read-only DOCTOR half of the estate-immune triad (doctor → aligner → teeth): the
 * G-DOOR acceptance metric "re-freeze auto-detected" made mechanical. Exit code IS the verdict,
 * so it gates: 0 = no frozen required check, 2 = FROZEN. Wire it into CI or a banner row and the
 * door can never silently re-freeze (which is exactly how it froze: one red "Unit Tests" check
 * stalled 27/27 PRs, while enforce_admins=false let admin-bypass quietly become the only path).
 *
 * Operationalizes standing immune doctrine:
 *   - a CI gate red on every PR is noise = merge-blind  ([[ci-sensors-must-not-be-numb]])
 *   - a gate's verdict is a number you can read, not a vibe  ([[gate-output-never-piped]])
 *   - exists != wired != runs != enforces  ([[verification-ladder-exists-to-verified]])
 *
 * Read-only. Uses the `gh` CLI (caller's auth) — no API key, no mutation, no merge. Hoisted into
 * the repo's checked-in tools/ from the operator's proving-ground original (bonfire/gate-freeze.mjs,
 * born 2026-06-25 out of the loa-freeside finding) per [[hoist-dont-handroll-shared-substrate]].
 * Campaign: estate-immune (bead arrakis-estate-immune-epic-4xw6.2, G1 self-healing gate sensor).
 *
 * The analysis core `analyzeBacklog()` is a PURE function (no I/O) so it is fixture-testable with
 * no live `gh` — see tools/gate-freeze-sensor.test.mjs. `fetchRepoData()` does the gh reads.
 *
 * Usage:
 *   node tools/gate-freeze-sensor.mjs <owner/repo>          # human board (one repo)
 *   node tools/gate-freeze-sensor.mjs <owner/repo> --json   # machine
 *   node tools/gate-freeze-sensor.mjs <owner/repo> --probe  # one-line STATUS tile (banner-style)
 *   node tools/gate-freeze-sensor.mjs                        # infer repo from cwd via gh
 *   node tools/gate-freeze-sensor.mjs --estate --owner=ORG  # THE CONDUCTOR: sweep every repo w/
 *                                              # open PRs, group freezes by root cause, rank the
 *                                              # fixes by PRs-un-numbed-per-fix → a thaw plan.
 *                                              # Re-run as fixes land; exit 2 = still frozen.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--json') ? 'json' : ARGS.includes('--probe') ? 'probe' : 'board';
const REPO_ARG = ARGS.find((a) => !a.startsWith('--'));
export const FREEZE_THRESHOLD = 0.5; // a required check not-green on > half the backlog = FROZEN

// not-green buckets — anything that is not one of these blocks a merge
const PASS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAIL = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
// everything else (PENDING/IN_PROGRESS/QUEUED/EXPECTED/WAITING/null) = pending

function gh(args, quiet = false) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
  });
}
function ghJSON(args, quiet = false) {
  return JSON.parse(gh(args, quiet));
}

function resolveRepo() {
  if (REPO_ARG) return REPO_ARG;
  try {
    const r = ghJSON(['repo', 'view', '--json', 'nameWithOwner']);
    return r.nameWithOwner;
  } catch {
    die('could not infer repo — pass <owner/repo>');
  }
}

function die(msg) {
  console.error(`gate-freeze: ${msg}`);
  process.exit(1);
}

// the worst state of a named check across its (possibly several) runs on a PR
function classify(result) {
  if (PASS.has(result)) return 'pass';
  if (FAIL.has(result)) return 'fail';
  return 'pending';
}

/**
 * parseRequiredContexts(rsc) → string[] — PURE. Extract the required-check context NAMES from a
 * branch-protection `required_status_checks` object. GitHub returns BOTH `contexts[]` (legacy) and
 * `checks[].context` (new); prefer whichever is POPULATED. A naive `contexts || checks…` short-
 * circuits on an EMPTY-but-truthy `contexts: []` and never reaches a populated `checks[]` — the
 * contexts→checks deprecation time-bomb. Length-test instead of truthiness.
 */
export function parseRequiredContexts(rsc = {}) {
  const ctx = Array.isArray(rsc.contexts) ? rsc.contexts : [];
  const fromChecks = Array.isArray(rsc.checks) ? rsc.checks.map((c) => c.context).filter(Boolean) : [];
  return ctx.length ? ctx : fromChecks;
}

/**
 * fetchRepoData(repo) → { repo, defaultBranch, required, strict, prs } — the I/O half (gh reads).
 * `required` is the branch-protection required-check contexts, or null if unreadable.
 */
function fetchRepoData(repo) {
  let defaultBranch = 'main';
  try {
    defaultBranch = ghJSON(['api', `repos/${repo}`], true).default_branch || 'main';
  } catch { /* keep default */ }

  let required = null; // null => protection unreadable
  let strict = false;
  try {
    const prot = ghJSON(['api', `repos/${repo}/branches/${defaultBranch}/protection`], true);
    const rsc = prot.required_status_checks || {};
    strict = !!rsc.strict;
    // GitHub returns either contexts[] (legacy) or checks[].context (new) — prefer the populated one.
    required = parseRequiredContexts(rsc);
  } catch {
    required = null;
  }

  const LIMIT = 100;
  const prs = ghJSON([
    'pr', 'list', '--repo', repo, '--state', 'open', '--limit', String(LIMIT),
    '--json', 'number,mergeStateStatus,isDraft,statusCheckRollup',
  ]);
  return { repo, defaultBranch, required, strict, prs, _limit: LIMIT };
}

/**
 * analyzeBacklog({ repo, defaultBranch, required, strict, prs }) → summary — the PURE analysis
 * half (NO I/O). Computes per-check freeze ratios across the open-PR backlog and names the root
 * required check freezing the gate. Fixture-testable.
 */
export function analyzeBacklog({ repo, defaultBranch = 'main', required, strict = false, prs, _limit = 100 }) {
  const truncated = prs.length === _limit;

  // tally per check name across PRs: fail/pending/pass/missing + distinct underlying runs.
  const tally = new Map();
  const ensure = (n) => {
    if (!tally.has(n)) tally.set(n, { fail: 0, pending: 0, pass: 0, missing: 0, runs: new Set() });
    return tally.get(n);
  };
  let behind = 0;
  for (const pr of prs) {
    if (pr.mergeStateStatus === 'BEHIND') behind++;
    const perName = new Map();
    for (const c of pr.statusCheckRollup || []) {
      const name = c.name || c.context;
      if (!name) continue;
      const state = classify(c.conclusion || c.state || '');
      const prev = perName.get(name);
      const rank = { fail: 2, pending: 1, pass: 0 }; // worst wins: fail > pending > pass
      if (!prev || rank[state] > rank[prev]) perName.set(name, state);
      ensure(name).runs.add(c.workflowName ? `${c.workflowName}/${name}` : (c.detailsUrl || name));
    }
    const names = required && required.length ? required : [...perName.keys()];
    for (const n of names) {
      const t = ensure(n);
      const st = perName.get(n);
      if (st === undefined) t.missing++;
      else t[st]++;
    }
  }

  const M = prs.length || 1;
  const checks = [...tally.entries()]
    .map(([name, t]) => {
      const notGreen = t.fail + t.pending + t.missing;
      return {
        name,
        fail: t.fail, pending: t.pending, missing: t.missing, pass: t.pass,
        freeze: notGreen / M,
        failRate: t.fail / M,
        duplicateRuns: t.runs.size > 1 ? t.runs.size : 0,
        isRequired: required ? required.includes(name) : null,
      };
    })
    .sort((a, b) => b.failRate - a.failRate || b.freeze - a.freeze);

  // A backlog is FROZEN only behind a CONFIRMED required check that's failing. A failing check NOT
  // in required_status_checks does not block merge — flagging it would be a false positive (the real
  // block is often REVIEW). required=[] (readable, none) → CI cannot freeze. required=null
  // (unreadable) → cannot confirm a gate; do not assert FROZEN.
  const hasRequired = Array.isArray(required) && required.length > 0;
  const frozen = hasRequired
    ? checks.filter((c) => c.isRequired && c.freeze > FREEZE_THRESHOLD && (c.fail > 0 || c.missing > 0))
    : [];
  const root = frozen.sort((a, b) => b.failRate - a.failRate)[0] || null;
  const ungatedFailing = checks
    .filter((c) => c.fail > 0 && !(hasRequired && c.isRequired))
    .slice(0, 6).map((c) => `${c.name} (${c.fail}/${prs.length})`);

  const verdict = root ? 'FROZEN'
    : prs.length === 0 ? 'EMPTY'
    : required === null ? 'UNGATED?'   // protection unreadable — cannot confirm a required gate
    : !hasRequired ? 'UNGATED'         // readable: genuinely no required status checks → CI can't freeze
    : 'FLOWING';

  // Exit code IS the verdict, and it must speak all THREE tiers immune-check.sh reads (0 HEALTHY /
  // 1 INSUFFICIENT / 2 PROBLEM), not just two. UNGATED? = branch protection unreadable = we could
  // NOT ground the freeze question → INSUFFICIENT (1), parallel to instrument-truth-sensor's
  // can't-ground exit. Collapsing it to 0 would let immune-check read a blind gate as HEALTHY — the
  // exact numb-false-green this suite exists to kill ([[ci-sensors-must-not-be-numb]]).
  const exitCode = verdict === 'FROZEN' ? 2 : verdict === 'UNGATED?' ? 1 : 0;

  return {
    repo, defaultBranch, openPRs: prs.length, truncated,
    requiredChecks: required, strict, behindCount: behind,
    verdict, exitCode, root: root ? root.name : null,
    frozenChecks: frozen.map((c) => ({ name: c.name, failOn: c.fail, pendingOn: c.pending, missingOn: c.missing, ofPRs: prs.length, freezePct: Math.round(c.freeze * 100) })),
    duplicateRequiredChecks: checks.filter((c) => c.duplicateRuns && hasRequired && c.isRequired).map((c) => ({ name: c.name, runs: c.duplicateRuns })),
    ungatedFailing,
    checks,
  };
}

function analyzeRepo(repo) {
  return analyzeBacklog(fetchRepoData(repo));
}

function main() {
  if (ARGS.includes('--estate')) return estateMode();
  // Wrap the single-repo read so a `gh` failure (e.g. `gh pr list` unauthenticated) becomes a clean
  // one-line INSUFFICIENT diagnostic, not a raw Node stack trace bleeding into immune-check's tile.
  // (estateMode keeps its OWN per-repo try/catch → ERROR, so it stays resilient — die() here would
  // kill the whole sweep, which is why we catch on the single-repo path only.)
  let summary;
  try {
    summary = analyzeRepo(resolveRepo());
  } catch (e) {
    die(`could not read ${REPO_ARG || 'repo'} (${e.code || e.message}) — INSUFFICIENT`);
  }
  if (MODE === 'json') console.log(JSON.stringify(summary, null, 2));
  else if (MODE === 'probe') console.log(renderProbe(summary));
  else console.log(renderBoard(summary));
  process.exit(summary.exitCode);
}

// --estate: sweep every repo with open PRs in an org, group freezes by ROOT CAUSE, and rank the
// fixes by PRs-un-numbed-per-fix. The scattered diagnoses become ONE ordered thaw plan.
function estateMode() {
  const owner = (ARGS.find((a) => a.startsWith('--owner='))?.split('=')[1]) || REPO_ARG || '0xHoneyJar';
  let repos;
  try {
    const hits = ghJSON(['search', 'prs', '--owner', owner, '--state', 'open', '--limit', '200', '--json', 'repository']);
    repos = [...new Set(hits.map((h) => h.repository?.name).filter(Boolean))].map((n) => `${owner}/${n}`);
  } catch {
    die(`could not discover repos for ${owner} (gh search prs failed)`);
  }
  const results = [];
  for (const repo of repos) {
    try { results.push(analyzeRepo(repo)); }
    catch { results.push({ repo, verdict: 'ERROR', frozenChecks: [], openPRs: 0 }); }
  }
  const frozen = results.filter((s) => s.verdict === 'FROZEN');
  const byRoot = new Map();
  for (const s of frozen) {
    const g = byRoot.get(s.root) || { root: s.root, repos: [], prs: 0 };
    g.repos.push(s.repo);
    g.prs += s.frozenChecks[0]?.ofPRs || s.openPRs || 0;
    byRoot.set(s.root, g);
  }
  const plan = [...byRoot.values()].sort((a, b) => b.repos.length - a.repos.length || b.prs - a.prs);
  const out = {
    owner,
    swept: results.length,
    frozen: frozen.length,
    flowing: results.filter((s) => s.verdict === 'FLOWING').length,
    ungated: results.filter((s) => s.verdict === 'UNGATED' || s.verdict === 'UNGATED?').length,
    empty: results.filter((s) => s.verdict === 'EMPTY').length,
    errors: results.filter((s) => s.verdict === 'ERROR').length,
    totalFrozenPRs: frozen.reduce((n, s) => n + (s.frozenChecks[0]?.ofPRs || s.openPRs || 0), 0),
    thawPlan: plan.map((g, i) => ({ rank: i + 1, fix: g.root, unNumbsRepos: g.repos.length, unNumbsPRsUpTo: g.prs, repos: g.repos })),
  };
  if (MODE === 'json') { console.log(JSON.stringify(out, null, 2)); process.exit(out.frozen ? 2 : 0); }
  console.log(renderThawPlan(out));
  process.exit(out.frozen ? 2 : 0);
}

function renderThawPlan(o) {
  const L = [];
  L.push(`  ☾ gate-freeze · ESTATE THAW PLAN · ${o.owner}`);
  L.push(`  swept ${o.swept} repos w/ open PRs  —  ${o.frozen} FROZEN · ${o.flowing} flowing · ${o.ungated} ungated · ${o.empty} empty${o.errors ? ` · ${o.errors} err` : ''}`);
  L.push(`  ~${o.totalFrozenPRs} PRs sit behind a genuinely-required failing gate.`);
  if (o.ungated) L.push(`  (${o.ungated} repos have failing checks but NO required gate → not gate-frozen; their PRs block on REVIEW, not CI. Drive reviews, don't "fix gates".)`);
  if (!o.thawPlan.length) { L.push(`  ✓ no frozen gates — the estate flows.`); return L.join('\n'); }
  L.push('');
  L.push(`  FIX IN THIS ORDER (most repos un-numbed first):`);
  for (const s of o.thawPlan) {
    L.push(`   ${s.rank}. fix '${s.fix}'  →  un-numbs ${s.unNumbsRepos} repo(s), up to ${s.unNumbsPRsUpTo} PRs`);
    L.push(`        ${s.repos.join(', ')}`);
  }
  L.push('');
  L.push(`  (re-run as fixes land — frozen count falls as gates go green. exit 2 = estate still frozen.)`);
  return L.join('\n');
}

function renderProbe(s) {
  const tag = s.verdict === 'FROZEN' ? '⚠ gate-freeze' : '✓ gate-freeze';
  if (s.verdict === 'EMPTY') return `${tag} ${s.repo} · no open PRs`;
  if (s.verdict === 'UNGATED' || s.verdict === 'UNGATED?') {
    const why = s.verdict === 'UNGATED?' ? 'branch protection unreadable' : 'no required status checks';
    const fail = (s.ungatedFailing || []).length ? ` · ${s.ungatedFailing.length} non-required check(s) failing (${s.ungatedFailing[0]}…)` : '';
    return `· gate-freeze ${s.repo} · UNGATED (${why}) · ${s.openPRs} open PRs${fail} — CI can't block merge; PRs blocked by REVIEW, if anything`;
  }
  if (s.verdict === 'FLOWING') {
    const strictNote = s.strict && s.behindCount ? ` · ${s.behindCount} behind(strict)` : '';
    return `${tag} ${s.repo} · no frozen required check · ${s.openPRs} open PRs${strictNote}`;
  }
  const r = s.frozenChecks[0];
  const cause = r.failOn > 0 ? `red ${r.failOn}/${r.ofPRs}`
    : r.missingOn > 0 ? `missing ${r.missingOn}/${r.ofPRs}`
    : `pending ${r.pendingOn}/${r.ofPRs}`;
  const more = s.frozenChecks.length > 1 ? ` (+${s.frozenChecks.length - 1} more)` : '';
  const strictNote = s.strict && s.behindCount ? ` · +${s.behindCount} behind(strict)` : '';
  const dup = s.duplicateRequiredChecks.length ? ` · ${s.duplicateRequiredChecks.length} ambiguous-name` : '';
  return `${tag} ${s.repo} · FROZEN: '${r.name}' ${cause}${more}${strictNote}${dup}`;
}

function renderBoard(s) {
  const L = [];
  L.push(`  ∴ gate-freeze · ${s.repo} (${s.defaultBranch})  —  ${s.openPRs} open PRs`);
  if (s.requiredChecks === null) {
    L.push(`    branch protection: UNREADABLE (not admin or none) — scoring ALL checks, cannot confirm which are required`);
  } else {
    L.push(`    required checks: [${s.requiredChecks.join(', ') || '(none)'}]   strict(rebase): ${s.strict}`);
  }
  if (s.verdict === 'EMPTY') { L.push(`    calm — no open PRs.`); return L.join('\n'); }
  if (s.verdict === 'UNGATED' || s.verdict === 'UNGATED?') {
    const why = s.verdict === 'UNGATED?' ? 'branch protection unreadable — cannot confirm any required check' : 'branch protection has NO required status checks';
    L.push(`    ~ UNGATED — ${why}.`);
    L.push(`      CI cannot block merge here. ${(s.ungatedFailing || []).length ? `Failing (non-required, informational): ${s.ungatedFailing.join(', ')}.` : ''}`);
    L.push(`      If these PRs are stuck, the block is REVIEW (or nothing) — not a gate. Drive reviews, don't "fix the gate".`);
    return L.join('\n');
  }
  if (s.verdict === 'FLOWING') {
    L.push(`    ✓ no required check is frozen across the backlog.`);
    if (s.strict && s.behindCount) L.push(`    note: ${s.behindCount}/${s.openPRs} PRs are BEHIND (strict-mode rebase needed) — flow-limiter, not a freeze.`);
  } else {
    L.push(`    ⚠ FROZEN — the backlog is stuck behind ${s.frozenChecks.length} required check(s):`);
    for (const c of s.frozenChecks) {
      L.push(`      · ${c.name}  —  red on ${c.failOn}/${c.ofPRs}` +
        (c.pendingOn ? `, pending ${c.pendingOn}` : '') +
        (c.missingOn ? `, missing ${c.missingOn}` : '') +
        `  (${c.freezePct}% not-green)`);
    }
    L.push(`    ROOT (fix this first): ${s.root}`);
    if (s.strict && s.behindCount) L.push(`    compounded by strict-rebase: ${s.behindCount}/${s.openPRs} PRs also BEHIND.`);
  }
  if (s.duplicateRequiredChecks.length) {
    L.push(`    smell: required check name maps to multiple runs (ambiguous gate): ` +
      s.duplicateRequiredChecks.map((d) => `${d.name}×${d.runs}`).join(', '));
  }
  if (s.truncated) L.push(`    (NOTE: open-PR list hit the 100-PR cap — counts are a floor.)`);
  return L.join('\n');
}

// run as CLI only (not when imported by the test). Use pathToFileURL (percent-encodes paths with
// spaces/special chars) instead of a hand-built `file://` string — matches instrument-truth-sensor.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
