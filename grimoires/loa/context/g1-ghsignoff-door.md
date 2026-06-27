---
status: candidate
mode: arch
date: 2026-06-26
kind: design-doc
goal: grimoires/loa/context/goals/goal-1-unfreeze-the-door.md
beads_bead: arrakis-estate-immune-epic-4xw6.2
domain: shared
use_label: usable
note: The gh-signoff/local-green door. App-zone build (tools/ + grimoires/ + decisions/). The branch-protection flip is the operator's ONE step — documented here, NOT executed by the agent.
---

# G1 / G-DOOR — the gh-signoff / local-green merge gate

> The keystone. `main`'s merge gate is a **broken cut vertex** (EULER, betweenness ≈ 1.0):
> every authored→merged path runs through it, and it currently *severs* the value graph —
> 30 rotting PRs, trapped gate-fix PRs, no council-merge authority are all downstream of
> this one frozen door. Un-freeze it and 4 of 5 apparent estate problems dissolve for free.

## Why it is frozen (grounded 2026-06-26, live `gh api`)

```
main branch protection (live):
  strict: true
  required_status_checks.contexts: ["Build", "Unit Tests", "Lint", "Security Scan", "Docker Build"]
  required_approving_review_count: 2
  enforce_admins: false
```

Three fused failures:

1. **`Unit Tests` is a REQUIRED check that is RED at the tip of `main` itself** — for
   ENVIRONMENT not CODE reasons. A required check red on (almost) every PR is a numb gate:
   it freezes the whole backlog behind one signal ([[ci-sensors-must-not-be-numb]]).
2. **The required-context names are stale / name-collided** — `Build` / `Lint` /
   `Security Scan` / `Docker Build` do not all map to running job names, so even a green
   suite need not deterministically satisfy the gate.
3. **2 approvals + `enforce_admins: false`** — the local cheval council posts ZERO GitHub
   reviews, so 2-of-2 is unmeetable solo, and admin-bypass became *cheaper than the verified
   path* (the consumption-gradient slip at the highest-leverage node).

## The decision (operator-made, not re-litigated)

**gh-signoff / local-green** — the DHH / `basecamp/gh-signoff` / Depot synthesis. Make
LOCAL-green the truth: run the repo's real suite on a dev box; the council runs LOCAL
(cheval **cannot** run in GitHub Actions — no OAuth subscription sessions on ephemeral
runners, `ANTHROPIC_API_KEY` is stripped). Two new signals become the gate; the perpetually-red
cloud checks are demoted to informational (they keep running, just not *required*).

`basecamp/gh-signoff` is a tiny `gh` extension: `gh signoff` posts a `signoff` **commit
status** to a PR, and branch protection requires that status instead of flaky cloud CI. We
implement that exact pattern, specialized to this repo's suite + a refuse-on-red floor + a
cross-model council review.

## The door as doctor → aligner → teeth (the immune triad)

| Role | Instrument | What it does |
|------|-----------|--------------|
| **Doctor** (senses, fails LOUD) | `tools/gate-freeze-sensor.mjs` (the `gate-freeze` sensor; canonical source `~/bonfire/gate-freeze.mjs`) | Computes each required check's freeze-ratio across the open-PR backlog; names the single check doing the freezing. Exit code IS the verdict: `0` = no frozen check, `2` = FROZEN. Run it to *confirm the door stays open*. |
| **Aligner** (makes local-green the truth) | `tools/loa-signoff.sh` + `tools/council-signoff.sh` | Bridge local-green and the local council into the two GitHub signals branch protection requires. |
| **Teeth** (cannot silently re-freeze) | `loa-signoff` + cheval-council fail-closed + the re-freeze sensor on a schedule | A green attestation requires a green suite (no other path writes it). The council never approves a degraded panel. A re-freeze is auto-detected and beaded — the gate cannot silently rot again. |

## The two tools (the build — App-zone, this PR)

### `tools/loa-signoff.sh` — the local-green attestation

Runs the repo's real suite locally; **on GREEN** posts a `loa-signoff` commit status
(`state=success`, `context=loa-signoff`) to the PR's head SHA via `gh api`. **On RED** it
refuses, posts nothing, exits non-zero — *we never sign off a red suite; that is the whole
point.* Read-only w.r.t. the repo; the only mutation is the status POST.

```bash
tools/loa-signoff.sh <pr-number>        # resolve head SHA from the PR, run suite, sign off
tools/loa-signoff.sh --sha <SHA>        # sign off a specific commit
tools/loa-signoff.sh <pr> --dry-run     # run suite, print the intended POST, mutate nothing
```

Suite command is configurable (defaults to the canonical Unit Tests invocation):

```bash
LOA_SIGNOFF_SUITE_CMD="npm test"      # default
LOA_SIGNOFF_SUITE_DIR="themes/sietch" # default — the canonical Unit Tests cwd (ci.yml unit-tests job)
```

> The posted status description names the exact command that was run, so the attestation is
> self-describing about its scope. To fully mirror the cloud `Unit Tests` job (which runs
> `bash scripts/check-redis-imports.sh` before `npm test`), set
> `LOA_SIGNOFF_SUITE_CMD='bash scripts/check-redis-imports.sh && (cd themes/sietch && npm test)'`
> with `LOA_SIGNOFF_SUITE_DIR=.`.

### `tools/council-signoff.sh` — the cross-model council as a GitHub approval

Runs the LOCAL cheval cross-model FAGAN council (codex + cursor + claude, subscription CLIs —
no API key) on a PR's diff via construct-fagan's `council-review-pr.sh` → `cheval-council.sh`.
On a clean verdict it posts an **APPROVING** GitHub review (= 1 of the required approvals).

```bash
tools/council-signoff.sh <pr-number>          # run council; APPROVED → approving review
tools/council-signoff.sh <pr> --dry-run       # run council, print intent, post nothing
tools/council-signoff.sh <pr> --comment-only  # post a COMMENT review (see self-review caveat)
tools/council-signoff.sh <pr> --preflight     # probe voice liveness before dispatch
```

**Fail-closed (the council's load-bearing guarantee, preserved):**

| Council outcome | Action |
|---|---|
| exit 0 · `APPROVED` · `multi_perspective_met` · ≥2 voices survived | `gh pr review --approve` |
| exit 1 · `CHANGES_REQUIRED` | `gh pr review --request-changes` |
| exit 3 · all voices dropped | **NEVER approve** — post nothing, exit 3 |
| exit 2 · council infra error | **NEVER approve** — post nothing, exit 2 |
| `APPROVED` but <2 voices survived (single-perspective) | **NEVER approve** — a halved panel is not a council, exit 3 |

≥2 *distinct families that actually survived* is the bar — convergence alone is not proof
([[council-convergence-not-proof]]).

> **Self-review caveat (operator step):** GitHub forbids approving / requesting-changes on
> your OWN PR. When the council runs under the PR author's identity, use `--comment-only` (a
> COMMENT review is always permitted) and make the commented council **count as** an approval,
> OR run the council under a distinct bot/reviewer identity. This is one of the operator-only
> steps the harness must not auto-resolve.

## THE OPERATOR'S ONE STEP — flip the gate (branch-protection mutation)

The agent does NOT mutate branch protection (no creative latitude for release/gate automation —
it is documented here only). Run these after this PR is reviewed. All are surgical sub-endpoint
PATCHes — they touch ONLY the named setting, not the whole protection object.

**Step 0 — bootstrap admin-merge of THIS door PR (the single sanctioned exception).**
This door PR is itself a gate-fix trapped behind the gate it opens (the new `loa-signoff`
gate is not active until Step 1). Merge it ONCE with the admin override, mirroring the
`adr-007-bootstrap` single-exception pattern. A `decisions/EXCEPTIONS.md` entry records it.

```bash
# SINGLE-USE. Records an EXCEPTIONS.md entry. Do not reuse this bypass for other PRs.
gh pr merge <THIS_PR> --squash --admin --repo 0xHoneyJar/loa-freeside
```

**Step 1 — require `loa-signoff`, demote the flaky cloud checks to informational.**
`strict: true` is kept (operator preference — PRs rebase before merge). `Build` / `Unit Tests`
/ `Lint` / `Security Scan` / `Docker Build` keep running; they are simply no longer *required*.

```bash
gh api -X PATCH repos/0xHoneyJar/loa-freeside/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{
  "strict": true,
  "contexts": ["loa-signoff"]
}
JSON
```

**Step 2 — set the approval bar to what the council can satisfy.**
Pick ONE:

```bash
# Option A (recommended): 1 approval — satisfiable by the council ALONE (council = 1).
gh api -X PATCH repos/0xHoneyJar/loa-freeside/branches/main/protection/required_pull_request_reviews \
  -F required_approving_review_count=1

# Option B (belt-and-suspenders): keep 2 — council = 1, operator = 1.
gh api -X PATCH repos/0xHoneyJar/loa-freeside/branches/main/protection/required_pull_request_reviews \
  -F required_approving_review_count=2
```

**Step 3 (optional) — enable GitHub-native auto-merge** so a PR merges itself once
`loa-signoff` is green and the approval bar is met:

```bash
gh pr merge <pr> --auto --squash --repo 0xHoneyJar/loa-freeside
```

**Verify the new gate (read-only):**

```bash
gh api repos/0xHoneyJar/loa-freeside/branches/main/protection \
  --jq '{contexts: .required_status_checks.contexts, approvals: .required_pull_request_reviews.required_approving_review_count, strict: .required_status_checks.strict}'
# expect: {"contexts":["loa-signoff"], "approvals":1, "strict":true}
```

## The daily flow once the door is open

```bash
tools/loa-signoff.sh <pr>      # green suite → loa-signoff=success on the head SHA
tools/council-signoff.sh <pr>  # clean cross-model council → approving review
# → GitHub auto-merge fires (Step 3) once loa-signoff is green + approval bar met
```

Then the 4 trapped gate-fix PRs (#307 / #308 / #310 / #315) flow through the opened door.

## The re-freeze sensor (teeth — the gate cannot silently rot again)

Wire the `gate-freeze` sensor as the standing re-freeze guard. Its exit code is the verdict
(`0` open, `2` FROZEN), so it gates:

```bash
# canonical source: ~/bonfire/gate-freeze.mjs — lands in-repo as tools/gate-freeze-sensor.mjs
node tools/gate-freeze-sensor.mjs 0xHoneyJar/loa-freeside --probe   # one-line STATUS tile
node tools/gate-freeze-sensor.mjs 0xHoneyJar/loa-freeside           # full board
# exit 2 = a required check is freezing the backlog again → auto-file a bead + alert
```

Run it on a schedule (or post-merge). A non-zero exit means a required check has re-frozen the
backlog — the immune response is to auto-bead it and surface LOUD, never let it rot quietly.
This closes the loop: the door is not just opened, it is *kept* open under a sensor that fails
loud on regression.

## Boundaries / honest state

- **App-zone only.** This PR ships `tools/` + `grimoires/` + `decisions/EXCEPTIONS.md`. It does
  NOT edit `.claude/` (System zone) and does NOT mutate branch protection (operator's step).
- The fixture tests (`tools/*.test.sh`, 19 cases) prove the floors with no live `gh`/cheval. A
  live `loa-signoff --dry-run` was smoke-tested read-only against real `gh`.
- The two-red-cause local suite fix (opossum `./lib/circuit` npm-vs-pnpm + `logger.fatal`) and
  landing `tools/gate-freeze-sensor.mjs` in-repo are tracked separately — this door is the
  structural gate redesign, not the env bug-fixes.
