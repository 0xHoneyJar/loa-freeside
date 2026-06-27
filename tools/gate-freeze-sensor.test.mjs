#!/usr/bin/env node
/**
 * Fixture test for gate-freeze-sensor's PURE core (analyzeBacklog) — NO live `gh`, CI-safe.
 * Run: node tools/gate-freeze-sensor.test.mjs   (exit 0 = pass, 1 = fail; the verdict gates.)
 */
import { analyzeBacklog, parseRequiredContexts } from './gate-freeze-sensor.mjs';

let failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { console.error(`  ✗ ${name}`); failed++; }
}
// build a PR fixture: checks = [[name, conclusion, detailsUrl?], ...]
// (detailsUrl distinguishes same-named contexts — how GitHub surfaces a name-collision)
const pr = (number, checks) => ({
  number, mergeStateStatus: 'CLEAN', isDraft: false,
  statusCheckRollup: checks.map(([name, conclusion, detailsUrl]) => ({ name, conclusion, detailsUrl })),
});

// 1. FROZEN — a required check red on > half the backlog → verdict FROZEN, root named.
{
  const r = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [
    pr(1, [['Unit Tests', 'FAILURE']]),
    pr(2, [['Unit Tests', 'FAILURE']]),
    pr(3, [['Unit Tests', 'SUCCESS']]),
  ]});
  check('FROZEN: 2/3 red required check → verdict FROZEN', r.verdict === 'FROZEN');
  check('FROZEN: names the root check', r.root === 'Unit Tests');
  check('FROZEN: freezePct ~67', r.frozenChecks[0].freezePct === 67);
}

// 2. NAME-COLLISION (the real #310 shape) — two "Unit Tests" contexts on one PR, one SUCCESS one
//    FAILURE → worst-wins counts the PR as failing; the duplicate-name smell is surfaced.
{
  const r = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [
    pr(310, [['Unit Tests', 'SUCCESS', 'https://gh/run/1'], ['Unit Tests', 'FAILURE', 'https://gh/run/2']]),
    pr(311, [['Unit Tests', 'FAILURE', 'https://gh/run/3']]),
  ]});
  check('COLLISION: worst-wins → both PRs counted failing', r.frozenChecks[0]?.failOn === 2);
  check('COLLISION: verdict FROZEN', r.verdict === 'FROZEN');
  check('COLLISION: ambiguous-name smell surfaced', r.duplicateRequiredChecks.some((d) => d.name === 'Unit Tests'));
}

// 3. UNGATED — readable protection with NO required checks → CI cannot freeze. With no required
//    set, all failing checks ARE surfaced (informationally) in ungatedFailing.
{
  const r = analyzeBacklog({ repo: 'o/r', required: [], prs: [
    pr(1, [['Lint', 'FAILURE']]), pr(2, [['Lint', 'FAILURE']]),
  ]});
  check('UNGATED: required=[] → verdict UNGATED', r.verdict === 'UNGATED');
  check('UNGATED: non-gated failing check surfaced in ungatedFailing', r.ungatedFailing.some((u) => u.startsWith('Lint')));
}

// 4. UNGATED? — protection unreadable (required=null) → must NOT assert FROZEN.
{
  const r = analyzeBacklog({ repo: 'o/r', required: null, prs: [pr(1, [['Lint', 'FAILURE']])] });
  check('UNGATED?: required=null → verdict UNGATED? (never FROZEN)', r.verdict === 'UNGATED?');
}

// 5. FALSE-POSITIVE GUARD — a non-required check red on every PR must NOT freeze the gate
//    (the real block would be REVIEW). The required check is green.
{
  const r = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [
    pr(1, [['Unit Tests', 'SUCCESS'], ['Security Scan', 'FAILURE']]),
    pr(2, [['Unit Tests', 'SUCCESS'], ['Security Scan', 'FAILURE']]),
  ]});
  check('GUARD: non-required failing check (required check green) → NOT FROZEN', r.verdict !== 'FROZEN');
}

// 6. FLOWING — required check green across the backlog.
{
  const r = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [
    pr(1, [['Unit Tests', 'SUCCESS']]), pr(2, [['Unit Tests', 'SUCCESS']]),
  ]});
  check('FLOWING: all green required check → verdict FLOWING', r.verdict === 'FLOWING');
}

// 7. EMPTY — no open PRs.
{
  const r = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [] });
  check('EMPTY: no open PRs → verdict EMPTY', r.verdict === 'EMPTY');
}

// 8. MISSING — a required check absent from a PR's rollup is not-green (counts toward freeze).
{
  const r = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [
    pr(1, [['Other', 'SUCCESS']]), pr(2, [['Other', 'SUCCESS']]),
  ]});
  check('MISSING: required check absent on all PRs → FROZEN by missing', r.verdict === 'FROZEN' && r.frozenChecks[0].missingOn === 2);
}

// 9. EXIT CODE — the verdict must speak all THREE tiers immune-check.sh reads, not two. UNGATED?
//    (protection unreadable → could-not-ground) is INSUFFICIENT (1), NOT a false HEALTHY (0).
{
  const ungatedQ = analyzeBacklog({ repo: 'o/r', required: null, prs: [pr(1, [['Lint', 'FAILURE']])] });
  check('EXIT: UNGATED? → exitCode 1 (INSUFFICIENT, not 0/HEALTHY)', ungatedQ.exitCode === 1);
  const frozen = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [
    pr(1, [['Unit Tests', 'FAILURE']]), pr(2, [['Unit Tests', 'FAILURE']]),
  ]});
  check('EXIT: FROZEN → exitCode 2', frozen.exitCode === 2);
  const flowing = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [pr(1, [['Unit Tests', 'SUCCESS']])] });
  check('EXIT: FLOWING → exitCode 0', flowing.exitCode === 0);
  const ungated = analyzeBacklog({ repo: 'o/r', required: [], prs: [pr(1, [['Lint', 'SUCCESS']])] });
  check('EXIT: UNGATED (readable, no required) → exitCode 0', ungated.exitCode === 0);
  const empty = analyzeBacklog({ repo: 'o/r', required: ['Unit Tests'], prs: [] });
  check('EXIT: EMPTY → exitCode 0', empty.exitCode === 0);
}

// 10. parseRequiredContexts — prefer the POPULATED source. An empty-but-truthy `contexts: []` must
//     NOT short-circuit past a populated `checks[]` (the contexts→checks deprecation time-bomb).
{
  check('PARSE: legacy contexts[] populated → contexts',
    JSON.stringify(parseRequiredContexts({ contexts: ['Unit Tests'], checks: [] })) === JSON.stringify(['Unit Tests']));
  check('PARSE: empty contexts[] + populated checks[] → checks (no truthy-[] short-circuit)',
    JSON.stringify(parseRequiredContexts({ contexts: [], checks: [{ context: 'Unit Tests' }] })) === JSON.stringify(['Unit Tests']));
  check('PARSE: checks-only (no contexts key) → checks',
    JSON.stringify(parseRequiredContexts({ checks: [{ context: 'Build' }, { context: 'Lint' }] })) === JSON.stringify(['Build', 'Lint']));
  check('PARSE: both empty → []', JSON.stringify(parseRequiredContexts({ contexts: [], checks: [] })) === '[]');
  check('PARSE: neither present → []', JSON.stringify(parseRequiredContexts({})) === '[]');
}

console.log(failed ? `\nFAIL: ${failed} assertion(s) failed` : `\nPASS: all gate-freeze-sensor assertions green`);
process.exit(failed ? 1 : 0);
