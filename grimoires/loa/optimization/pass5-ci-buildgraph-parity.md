# Pass 5 — CI Workflow & Build-Graph Optimization (Parity Report)

**Discipline:** speed-only, behavior frozen. Measure first, prove behavior unchanged,
one lever family (CI build-graph), minimum diff.
**Date:** 2026-07-06 · **Loop:** extreme-software-optimization, pass 5/5.

## Grounding (measured, not assumed)

- **Required status checks** (`gh api repos/:owner/:repo/branches/main/protection/required_status_checks`):
  the ONLY required context is **`loa-signoff`** (ruleset "primary" is `enforcement: disabled`).
  `loa-signoff` is posted externally (not by any workflow here) and aggregates CI/sietch
  status (see memory `loa-freeside-numb-merge-gate`: "sietch red blocks loa-signoff door").
  → `ci.yml` is effectively load-bearing for the required gate; it is NOT path-filtered.
- **Lockfiles verified present** before adding `cache: 'npm'` (setup-node errors on a missing
  `cache-dependency-path`): `themes/sietch`, `packages/{core,adapters}`, `apps/worker`,
  `packages/{beacon-schema,freeside-registry,freeside-cli}` all have `package-lock.json`.
- **grep -oP inventory** in `.github/workflows/`: `ci.yml` (×3), `protocol-freshness.yml`,
  `post-merge.yml` (release-frozen).

## O5.1 — Dependency caching (LANDED · pure speed, zero risk)

Caching restores `~/.npm` keyed on the hash of the listed lockfiles; `npm ci` still runs and
still produces byte-identical `node_modules`. Job outcome is impossible to change — caching only
warms installs.

| File | Job(s) touched | `cache-dependency-path` | Lever |
|------|----------------|-------------------------|-------|
| `ci.yml` | `unit-tests` | sietch + core + adapters lockfiles | O5.1 npm cache |
| `ci.yml` | `integration-tests` | sietch + core + adapters lockfiles | O5.1 npm cache |
| `ci.yml` | `worker-db-tests` | apps/worker lockfile | O5.1 npm cache |
| `registry-cli-tests.yml` | `registry-cli-tests` | beacon-schema + freeside-registry + freeside-cli lockfiles | O5.1 npm cache |

Diff is **additive only** (21 insertions, 0 deletions): each edit inserts `cache: 'npm'` +
`cache-dependency-path` under an existing `actions/setup-node … node-version` block. No trigger,
job, `run:` step, service, or env was altered. Each added block is marked `# loa:shortcut:`.

**YAML validity:** both files pass `python3 -c "import yaml; yaml.safe_load(open(f))"` ✓.

### Release-behavior attestation (per touched workflow)

- **`ci.yml`** — trigger (`push`/`pull_request` on `main`), all jobs, gates, test commands,
  services, and env are **unchanged**. Only npm-cache config added to three `setup-node` steps.
  Not a release/deploy/tag/publish workflow. Speed-only. ✓
- **`registry-cli-tests.yml`** — trigger, job, per-package `npm ci`/`build`/`test`/`typecheck`
  steps, and gate semantics are **unchanged**. Only npm-cache config added to the one
  `setup-node` step. Not a release/deploy workflow. Speed-only. ✓

## O5.2 — Path filters (NOT LANDED · no provably-safe target)

Rule 5 forbids filtering a required check or any release/deploy/tag/publish job; when unsure
whether a check is required, treat it as required. I enumerated every workflow **without** a
path-filter and confirmed each trigger. None is a safe target:

| Workflow (no path-filter) | Trigger | Why NOT filtered |
|---------------------------|---------|------------------|
| `ci.yml` | push/PR main | Feeds required `loa-signoff` (sietch-red blocks the door) — treat as required |
| `path-domain-check.yml` | PR | ADR-007 cross-domain **firewall** — must run on every PR |
| `commit-scope-check.yml` | PR | ADR-007 commit-scope governance — must run on every PR |
| `secret-scanning.yml` | push/PR/cron | **Security scan** — never filter |
| `security-audit.yml` | push/PR/cron | **Security audit** — never filter |
| `immune-doctors.yml` | PR/cron | Governance immune sensor (reads branch protection) |
| `immune-verdict-schema.yml` | PR | Governance schema gate |
| `bridgebuilder-pr.yml` | PR | Review-bot gate |
| `fable-readiness.yml` | push/PR main | Readiness gate; scope not provably bounded |
| `e2e-ci.yml` | push main only | Post-merge e2e validation on main; broad scope |
| `post-merge.yml` | push main | **Release automation** — FROZEN |
| `agent-key-rotation.yml` | schedule/dispatch | No push/PR event — path filters inapplicable |
| `dns-drift-check.yml` | schedule/dispatch | inapplicable |
| `oracle.yml` | schedule/dispatch | inapplicable |
| `protocol-freshness.yml` | schedule/dispatch | inapplicable |
| `melange-notify.yml` | issues | inapplicable |
| `melange-resolve.yml` | issue_comment/PR-closed | inapplicable |

**Outcome:** 0 path-filters added. The 17 unfiltered workflows split into
security/governance/review/release gates (filtering = hard-NO) and schedule/issue-triggered
workflows (path filters do not apply). This matches the mission's guidance to report
out-of-scope rather than risk a gate.

## O5.3 — Portable grep (NOT LANDED · not byte-provable for the whole file)

Used the local PCRE engine (ugrep, exposes `grep -oP`/`\K`) as a golden generator and tested
POSIX `sed -nE` equivalents against the **real files** (BSD grep on this macOS host has no `-P`,
so this is the only available reference):

| grep -oP site | POSIX candidate | Parity vs golden |
|---------------|-----------------|------------------|
| `ci.yml` L105 CHANGELOG version | `sed -nE 's/.*## \[([0-9]+\.[0-9]+\.[0-9]+).*/\1/p'` | **byte-identical ✓** |
| `ci.yml` L109 README version | `sed -nE 's/.*version-([0-9]+\.[0-9]+\.[0-9]+).*/\1/p'` | **byte-identical ✓** |
| `ci.yml` L128 markdown-link extraction `\[.*?\]\(\K[^)]+(?=\))` | `grep -oE … \| sed …` | **MISMATCH ✗** |
| `protocol-freshness.yml` L19 `PROTOCOL_VERSION` | `sed -nE "s/.*PROTOCOL_VERSION[[:space:]]*=[[:space:]]*'([^']+)'.*/\1/p"` | unverifiable (target `themes/sietch/src/packages/core/protocol/compatibility.ts` absent in this checkout) |
| `post-merge.yml` L46 PR-number extraction | — | **FROZEN** (release automation) — not touched |

The link-extraction grep is not portably reproducible: on nested-bracket badge lines like
`[![version](img-url)](CHANGELOG.md)` the non-greedy `.*?` + `\K` + lookahead extracts the
**inner image URL**, not the outer target — a POSIX form emits the outer target instead
(mismatch confirmed on `README.md`). Because that grep cannot be converted byte-identically, the
`ci.yml` `validate` job stays non-portable regardless; converting only the two provable version
greps would deliver **zero** portability benefit while touching a job that feeds the required
`loa-signoff` gate. `protocol-freshness` is a weekly cron (not a PR gate) and its target file
isn't in this checkout, so parity is unverifiable here. `post-merge` is release-frozen.

**Decision:** leave all workflow `grep -oP` as-is. The workflows run exclusively on GNU-grep
ubuntu runners, so there is no portability defect actually being hit — the theoretical value
(4.0) does not justify a non-provable change to a gate-feeding or release-frozen job.

## Net result

- **Files changed:** `.github/workflows/ci.yml`, `.github/workflows/registry-cli-tests.yml`
  (O5.1 npm caching only; +21 lines, −0).
- **Not landed (reported out-of-scope):** O5.2 (no provably-safe path-filter target),
  O5.3 (grep -oP not byte-provable for the whole file / release-frozen).
- **Rollback:** `git revert <sha>` (caching is inert config; removing it only slows installs).
