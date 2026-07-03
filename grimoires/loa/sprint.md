# Sprint Plan — Autopoiesis: Immune Cells for the Factory

**Version:** 1.0
**Date:** 2026-07-03
**Author:** Sprint Planner Agent
**PRD Reference:** grimoires/loa/prd.md (flatline-hardened 2026-07-03)
**SDD Reference:** grimoires/loa/sdd.md (v1.1, flatline-SDD-hardened 2026-07-03)

> Cycle: **autopoiesis**. Three immune cells (sensor + aligner + teeth) grounded in 4 REAL filed
> beads as settle-targets, plus a cross-cutting flip mechanism. Extends the EXISTING estate-immune
> framework (`tools/immune-check.sh` + `immune-instruments.yaml` + ground-truth lint) — greenfield
> is explicitly rejected (SDD §0).
>
> Previous plan archived: `sprint.prev-2026-07-03-datastore-legibility.md` (S2/S3 a deferred
> parallel track, beads still open — not cancelled).
>
> **Settle-gate discipline (mirrors datastore-legibility S1→S2→S3).** Sequencing is a settle order,
> NOT beads `blocked-by`: **S1 = Trustworthy Green** (the settle gate — "a PR's green means
> something again") → **S2 = Consumption Doctor** → **S3 = False-Green Sensor**. S1 landing alone is
> a real win; the cycle report says so explicitly if S2/S3 slip (PRD §7, SDD §7).
>
> **Domain purity (ADR-007, CI-enforced).** Every task classifies as **`domain:shared`** — CI
> tooling is the default case in `tools/lib/domain-classify.sh`. Sensors **READ** packages, never
> edit their source, so no commit crosses the platform↔network firewall. Every commit uses a
> `shared/<x>` scope. `path-domain-check.yml` stays green by construction (SDD §1.9, R-7).
>
> **Zone discipline (NFR-5).** All sensor logic in `tools/`, CI wiring in `.github/workflows/`, the
> jq fix in `.github/scripts/`, schemas in `grimoires/loa/schemas/`, state in `.run/immune/` +
> git-tracked `tools/`. **`.claude/` (System Zone) is NOT touched** — the bridge root fix goes
> upstream (FR-3b).

---

## Executive Summary

Grow the factory's first three immune cells so it can **see and reject its own broken states**
without the operator standing in as the immune system by hand. Each cell is grounded in a filed
bug (NFR-3 — the 4 beads ARE the regression corpus) and emits ONE shared verdict record (NFR-7)
aggregated by the existing `tools/immune-check.sh`. The exit code IS the verdict (NFR-4); blocking
authority is layered OUTSIDE the sensor via a branch-protection required-list + an operator-adjudicated
flip-ledger (advisory-first, NFR-1). Promotion to blocking is **never automatic from CI** — it is an
operator act (`tools/flip-promote.sh`, admin-write PAT), because the default `github.token` cannot
write branch protection (`administration` is not a grantable scope — probed, SDD §0).

**Total Sprints:** 3 (S1 LARGE, S2 SMALL, S3 MEDIUM)
**Sprint Duration:** ~2.5 days each
**Global sprint numbers (ledger):** S1 = 407, S2 = 408, S3 = 409

---

## Sprint Overview

| Sprint | Theme | Scope | Key Deliverables | Settle order |
|--------|-------|-------|------------------|--------------|
| S1 (#407) | Trustworthy Green (settle gate) + flip mechanism | LARGE (9) | `scope-checks-sensor.sh`, `scope-classify.sh`, jq-crash fix, verdict schema, flip-ledger/report/promote, quarantine coverage-map | The settle gate |
| S2 (#408) | Consumption Doctor | SMALL (3) | `consumption-doctor.sh` (build-vs-resolve import smoke over probed real consumers) | fan-out |
| S3 (#409) | False-Green Sensor + upstream issue + E2E | MEDIUM (5) | `false-green-sensor.sh` (`.run` state + git delta), upstream `loa` issue, E2E goal validation | fan-out |

---

## Sprint S1 (#407): Trustworthy Green — the settle gate

**Duration:** ~2.5 days
**Scope:** LARGE (9 tasks)
**Grounds beads:** `arrakis-integration-tests-numb-gate-0is2`, `arrakis-cluster-compliance-audit-crash-88ah`

### Sprint Goal
A per-PR required-check green means a real *this-PR* signal again — scoped to changed packages +
their transitive dependents, with fallback-to-full on cross-cutting change, plus the anti-rot flip
mechanism so advisory never becomes the new numb gate.

### Deliverables
- [ ] `tools/scope-checks-sensor.sh` — scopes required checks to changed packages + transitive dependents; emits the NFR-7 verdict; `--probe`/`--json`
- [ ] `tools/lib/scope-classify.sh` — pnpm reverse-graph walker (deps + peerDeps + devDeps), cross-cutting → fallback-to-full
- [ ] `.github/scripts/audit-cluster-cells.sh` — jq `--argjson` crash fixed for in-monolith cells (`git_url=loa-freeside`)
- [ ] `grimoires/loa/schemas/immune-verdict.schema.json` — the shared verdict contract + ajv CI check
- [ ] `tools/flip-ledger.jsonl` + `tools/flip-report.sh` — main-branch-single-writer ledger + rolling-window state machine
- [ ] `tools/flip-promote.sh` — operator-run required-list migration (admin PAT)
- [ ] `tools/quarantine-coverage-map.yaml` — quarantine gated on per-package coverage-diff equivalence proof
- [ ] All new instruments registered in `tools/immune-instruments.yaml` (auto-forced by the name-glob ground-truth lint)
- [ ] bats fixtures covering every SDD §6.1 FR-1 acceptance row + the seeded qualifier flip

### Acceptance Criteria
- [ ] A fixture PR touching only package X runs **only** X's + X-dependents' checks, each a concrete `pnpm --filter <pkg> <cmd>` command (SDD §4.2)
- [ ] A fixture PR touching a **peer/dev-dep-only** dependent of X puts that dependent IN scope (peer+dev edges walked, not runtime-only — IMP-006)
- [ ] A fixture PR touching a shared `tsconfig`/workflow/lockfile/**generated-code/dev-tooling** path yields `verdict=full` (fallback-to-full)
- [ ] A seeded failure in X is caught by X's PR and is **NOT** reported by an unrelated Y's PR
- [ ] `cluster-compliance` completes with **no jq crash** on a registry-touching PR that includes `events-api` (`git_url=loa-freeside`)
- [ ] Quarantine of `integration-tests`/`agent-ci` from the required-list happens **only after** a per-package coverage-diff proves `uncovered_file == []` (or explicit accepted-risk) — else quarantine is blocked (SKP-003)
- [ ] `flip-promote.sh` with the PAT **absent** prints the exact operator command + missing scope and exits 1 — **never silently skips**, never reports success (IMP-001/IMP-008)
- [ ] The verdict schema validates via ajv in CI; a record that fails the schema does not ship (NFR-7); `schema_version` present, additive-only compat with existing `immune-check.sh` doctor records (IMP-005)
- [ ] ≥1 sensor reaches `flip-ready` via its **seeded qualifier** (break-then-revert fixture) + a clean rolling last-N=10 window (0 false-positives, 0 unadjudicated), and the operator promotion (`flip-promote.sh`) reaches `blocking` (G-4)
- [ ] The ground-truth lint (`check-instrument-ground-truth.sh`) passes — proves all new instruments are registered

### Technical Tasks

- [ ] **S1-T1** [SDD §1.4/§4.2, FR-1a] `tools/lib/scope-classify.sh` — build the changed-package set from `git diff --name-only <base>...<head>`, classify each path to its owning `packages/<pkg>`, reverse-walk transitive dependents over **`dependencies` + `peerDependencies` + `devDependencies`** (`file:`/`@freeside/*` specifiers parsed from every `packages/*/package.json`; NO root workspace manifest exists). Cross-cutting/generated-code/dev-tooling paths → signal fallback-to-full. Sibling to `tools/lib/domain-classify.sh`. → **[G-1]**
- [ ] **S1-T2** [SDD §1.4/§4.2, FR-1a] `tools/scope-checks-sensor.sh` — consume `scope-classify.sh`; on cross-cutting change emit `verdict=full` and run the entire required set; else map each in-scope package to a **concrete runnable command** (`pnpm --filter <pkg> test|build`) in `evidence.commands[]` — a package that resolves to no runnable command is reported, never silently dropped. Emit the NFR-7 verdict record; `--probe`/`--json`; exit-code = verdict. → **[G-1]**
- [ ] **S1-T3** [SDD §4.5, FR-1c] Fix the `jq --argjson` crash in `.github/scripts/audit-cluster-cells.sh` — guard in-monolith cells (`git_url == loa-freeside`, e.g. `events-api`) so each per-cell record is valid JSON; validate each with `jq empty` before aggregation so one bad cell can't abort the whole audit. Grounds `arrakis-cluster-compliance-audit-crash-88ah`. → **[G-1]**
- [ ] **S1-T4** [SDD §3.1, NFR-7] `grimoires/loa/schemas/immune-verdict.schema.json` — JSON Schema for `{schema_version, sensor, target, verdict, evidence, exit_code, generated_at}`; freeze the `verdict → exit_code` mapping (0/1/2 inherited verbatim from `immune-check.sh`); additive-only-within-major compat rule (IMP-005); wire an ajv 8.18 CI check that fails a non-conforming `--json` record. → **[G-1, G-2, G-3]**
- [ ] **S1-T5** [SDD §3.2/§3.3, FR-4a/b/c/d] `tools/flip-ledger.jsonl` (git-tracked, never truncated) + `tools/flip-report.sh` — **main-branch-single-writer** append (no PR-parallel writes); rolling **last-N=10** window; `flip-ready` requires ≥1 `seeded:true`+`true-catch` AND 0 false-positives AND 0 unadjudicated; adjudication is an **operator git commit** (provenance = git authorship, never self-adjudicated); states `{calibrating, flip-ready, blocking}` — `calibrating` is a legitimate reported state, never silent limbo. → **[G-4]**
- [ ] **S1-T6** [SDD §3.7/§5.4, FR-1d/FR-4] `tools/flip-promote.sh` — **operator-run** required-list migration via `gh api PUT .../branches/main/protection` with an operator-held admin-write PAT; preconditions verified (sensor `flip-ready` + PAT present) before any API call; `--remove` rollback (blocking → flip-ready); **PAT-absent → print the exact operator command + missing scope, exit 1, never silent-skip / never false success** (IMP-008). NOT a PR-time CI action. → **[G-1, G-4]**
- [ ] **S1-T7** [SDD §3.4, FR-1b/SKP-003/IMP-007] `tools/quarantine-coverage-map.yaml` + the objective equivalence gate — a suite (`integration-tests` @ `ci.yml:232`, `agent-ci` @ `agent-ci.yml:109`) leaves the required-list ONLY after a **per-package coverage-diff** proves `set(scoped test files) ⊇ set(quarantined-suite files attributable to pkg)`; any `uncovered_file` (not accepted-risk) blocks quarantine; `rollback_log` records any un-quarantine (post-quarantine escape the old suite would have caught). Audited by `scope-checks-sensor.sh`. → **[G-1]**
- [ ] **S1-T8** [SDD §1.4/§7, FR-1d] Register `scope-checks-sensor`, `flip-report`, `flip-promote` (+ any `.mjs`) in `tools/immune-instruments.yaml` with literal ground-source tokens (the name-glob lint auto-forces this in-PR); extend `tools/immune-check.sh` `doctors[]` to aggregate S1's records; once a check is `flip-ready`, run `flip-promote.sh` for the branch-protection migration (operator step). → **[G-1, G-4]**
- [ ] **S1-T9** [SDD §6.1, NFR-3] bats fixtures for every FR-1 acceptance row — scoped-run, peer/dev-dep dependent in-scope, fallback-to-full, seeded-failure caught-in-X/not-in-Y, cluster-compliance no-crash, PAT-absent promotion, coverage-diff equivalence — plus the **seeded break-then-revert qualifier** that drives the G-4 flip. Use `*_PROBE_CMD` fixture seams (no live `gh`/CI needed). → **[G-1, G-4]**

### Dependencies
- Existing immune substrate: `tools/immune-check.sh`, `tools/immune-instruments.yaml`, `tools/check-instrument-ground-truth.sh`, `.github/workflows/immune-doctors.yml` (verdict/exit contract + name-glob lint reused verbatim).
- `tools/lib/domain-classify.sh` — classification precedent for `scope-classify.sh`.
- pnpm per-package `pnpm-lock.yaml` + `package.json` `file:`/`@freeside/*` specifiers (the graph source — no root `pnpm-workspace.yaml`).
- **Operator-held admin-write PAT** for the FR-1d branch-protection migration (NOT the default CI token).

### Security Considerations
- **Trust boundaries:** `git diff` output + `package.json` specifiers are the sensor's inputs — read-only, no execution of untrusted content. The admin-write PAT (`flip-promote.sh`) is operator-held, never committed, never exposed to PR-triggered workflows (mirrors the `immune-doctors.yml` PAT-gating that defeats pwn-request exfiltration).
- **External dependencies:** no new runtime deps (bash + `jq` + ajv 8.18 already root). `.mjs` only where graph/JSON logic is unwieldy (OQ-4, lean bash).
- **Sensitive data:** no secrets in any verdict record or the ledger (cluster-compliance already forbids secrets in cell configs); `flip-promote.sh` reads the PAT from env only.
- **Exit-code integrity (NFR-4):** capture `$?` BEFORE any pipe; never `| tail`, `|| true`, or `2>/dev/null` on the verdict path; advisory-ness expressed via `continue-on-error: true` / absence from the required-list, never by masking the exit code.

### Risks & Mitigation
| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| R-4/R-10: scoped walk misses a cross-package (peer/dev-dep) dependent | Med | High | reverse-walk includes peerDeps+devDeps; generated-code/dev-tooling → **fallback-to-full** (conservative — a missed dependent is worse than extra CI) |
| R-1/R-11: quarantine drops protection the scoped set doesn't truly replace | Med | High | quarantine gated on an **objective per-package coverage-diff** (`uncovered_file==[]`) + rollback trigger + `rollback_log` — not a subjective judgment |
| R-2: advisory rots into a new numb gate | High | High | FR-4 rolling-window flip + seeded qualifier; **G-4: ≥1 flip within cycle is a hard exit condition** |
| R-9: flip-ledger concurrency / merge-conflict / tamper | Low | Med | **main-branch-single-writer** (no PR-parallel writes → no conflicts); adjudication = operator git commit; git history = tamper trail |
| R-12: promotion never happens (operator PAT step forgotten) | Med | Med | `flip-ready` un-promoted at cycle end is a **hard G-4 cycle failure**; PAT-absent path prints the exact command; state machine surfaces `flip-ready` explicitly |
| R-6: NFR-7 schema drift vs existing exit contract | Med | Med | one schema file is SoT; `verdict→exit` frozen at 0/1/2; ajv-enforced in CI |

### Success Metrics
- 0 always-red *required* checks remain after the FR-1d migration (G-1 settle-target).
- A scoped PR's required checks complete in **less** wall-clock than today's whole-repo suite (NFR-6 initial target; concrete budgets = OQ-3, set with impl data).
- ≥1 sensor `blocking` via seeded qualifier + clean rolling last-10 window, flip-ledger as evidence (G-4).

---

## Sprint S2 (#408): Consumption Doctor

**Duration:** ~2.5 days
**Scope:** SMALL (3 tasks)
**Grounds bead:** `arrakis-adapters-dist-unconsumable-d0tv` (P1)

### Sprint Goal
A shared package cannot be reported "healthy" while no real consumer can import it — an import
smoke run under each consumer's actual module resolution, over the probed real consumers.

### Deliverables
- [ ] `tools/consumption-doctor.sh` — per-package import smoke, build-vs-resolve by ship shape, emits the NFR-7 verdict
- [ ] Registered in `immune-instruments.yaml`; aggregated by `immune-check.sh`; wired on shared-package change + nightly (NFR-6)

### Acceptance Criteria
- [ ] `@freeside/adapters` (ships `dist`, consumed by `packages/services/shadow-audit`) → **build-then-import → `flag` (unconsumable)** — the exact known-broken path that hid the break
- [ ] `@freeside/cluster-fp` (ships `src`, consumed by `packages/services/ordering`) → **resolve+import → `pass` (consumable)**
- [ ] `@freeside/ordering-protocol` (ships `src`, consumed by `packages/services/ordering`) → **resolve+import → `pass` (consumable)**
- [ ] A shared package with zero real consumers → **`no-consumer`** (a distinct honest state per FR-2b, exit 0, NOT a false pass and NOT a `flag`)
- [ ] Runs on `packages/**` shared-package change + nightly, **not** every PR (NFR-6)
- [ ] Verdict conforms to `immune-verdict.schema.json` (ajv-validated)

### Technical Tasks

- [ ] **S2-T1** [SDD §1.4/§3.5/§4.3, FR-2a] `tools/consumption-doctor.sh` — for each shared `@freeside/*` package read `exports`/`main`; if it ships `dist` → **build dist then `node -e "import('@freeside/<pkg>')"`** under the consumer's resolution; if it ships `src` → **resolve+import** the `src` entry under the consumer's resolution. Exercises the **probed real consumers** (SDD §3.5), not a synthetic harness. → **[G-2]**
- [ ] **S2-T2** [SDD §4.3/§5.2, FR-2b] Verdict logic + fixtures: `consumable → pass (0)`, `unconsumable → flag (2)`, `no-consumer → 0` (honest distinct state, never collapsed into pass or flag). G-2 acceptance fixtures over the current tree: adapters→flag, cluster-fp + ordering-protocol→pass. Grounds `arrakis-adapters-dist-unconsumable-d0tv`. → **[G-2]**
- [ ] **S2-T3** [SDD §7, NFR-6/NFR-7] Register `consumption-doctor` in `tools/immune-instruments.yaml` (ground-source token); extend `immune-check.sh` `doctors[]`; wire a workflow trigger on `packages/**` change + a nightly cron (advisory `continue-on-error`). → **[G-2]**

### Dependencies
- **S1-T4** — the shared verdict schema (`immune-verdict.schema.json`) must exist so S2's records conform. (Settle order, not a beads block — S2 can be authored against the schema draft.)
- Package `exports`/`main` fields; the probed real consumers (`packages/services/{shadow-audit,ordering}`); pnpm 9.15.4 for build/resolve.

### Security Considerations
- **Trust boundaries:** reads package manifests + builds/imports package code — the packages are first-party (same repo), read-only inputs; the doctor never edits a package's source (domain purity, R-7).
- **Sensitive data:** none; no secrets in the import smoke.

### Risks & Mitigation
| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| R-3: false-positive on legitimately dist-only / no-consumer packages | Med | Med | FR-2b `no-consumer` is its own honest state; asks "can a real consumer import it", not "must src-ship" |
| domain-firewall trip if the doctor edits a package | Low | Med | doctor is read-only; commits are `shared/<x>` scope only (R-7) |

### Success Metrics
- The doctor FLAGS `@freeside/adapters` and PASSES `@freeside/cluster-fp` + `@freeside/ordering-protocol` over the current tree (G-2 settle-target).

---

## Sprint S3 (#409, Final): False-Green Sensor + upstream issue + E2E

**Duration:** ~2.5 days
**Scope:** MEDIUM (5 tasks incl. E2E)
**Grounds bead:** `arrakis-run-bridge-resume-silent-noop-flzl`

### Sprint Goal
A run/bridge that did nothing can never report success — a sensor over `.run/*state.json` + git
delta catches the zero-work completion, degraded state fails conservative (never a false pass), and
the upstream root-cause issue is filed against `loa`.

### Deliverables
- [ ] `tools/false-green-sensor.sh` — `.run` state + git delta → `suspect` on zero-work completion; degraded input → `insufficient`
- [ ] Upstream `loa` issue filed **with a reproduction** (the 2026-07-03 no-op state) — FR-3b
- [ ] Registered in `immune-instruments.yaml`; aggregated by `immune-check.sh`
- [ ] E2E validation of all four goals

### Acceptance Criteria
- [ ] Replaying the 2026-07-03 no-op state (well-formed + `JACKED_OUT` + 0 sprints/0 findings/0 commits) → **`suspect` (exit 2)**
- [ ] A genuine run with ≥1 commit/finding/sprint → **`pass` (exit 0)**
- [ ] **Absent** `.run/*state.json` for a completion under evaluation → **`insufficient` (exit 1)** — cannot prove work ⇒ cannot pass
- [ ] **Partial** state (missing `sprints`/`findings`/`commits` keys) → **`insufficient` (exit 1)** — missing counters ≠ zero counters (never infer 0 to pass)
- [ ] **Malformed** state (invalid/unparseable JSON) → **`insufficient` (exit 1)** — a corrupt file is never a false `pass` (IMP-009)
- [ ] Non-terminal state (RUNNING/HALTED) → nothing to assert (exit 0)
- [ ] FR-3b DONE = the upstream `loa` issue is filed **with the reproduction**; S3 completion does **NOT** block on the upstream fix landing (R-5)

### Technical Tasks

- [ ] **S3-T1** [SDD §1.4/§4.4, FR-3a] `tools/false-green-sensor.sh` — read `.run/bridge-state.json` + `.run/sprint-plan-state.json` + a git rev-range; `state==JACKED_OUT/complete AND sprints==0 AND findings==0 AND commits==0` → `suspect`. Implement the §4.4 degraded-input table exactly: absent/partial/malformed → **`insufficient` (exit 1)**, never a false `pass`. Emit the NFR-7 verdict; runnable post-run + manually. Grounds `arrakis-run-bridge-resume-silent-noop-flzl`. → **[G-3]**
- [ ] **S3-T2** [SDD §6.1, NFR-3/IMP-009] bats fixtures: replay the 2026-07-03 no-op → `suspect`; a ≥1-commit run → `pass`; absent + partial (missing counters) + malformed-JSON `.run` state → `insufficient` for each. Use `*_PROBE_CMD` fixture seams. → **[G-3]**
- [ ] **S3-T3** [SDD §7, FR-3b/R-5] File the upstream `loa` issue via `gh issue create` against the `loa` repo — `bridge-orchestrator.sh` marches to completion when undriven; silent-noop-detect did not fire — **with a reproduction** (the 2026-07-03 no-op state). Confirm the owning repo/path first (OQ-5). Does not block S3 completion. `.claude/` is System Zone — the fix is upstream. → **[G-3]**
- [ ] **S3-T4** [SDD §7, NFR-7] Register `false-green-sensor` in `tools/immune-instruments.yaml` (ground-source token); extend `immune-check.sh` `doctors[]`; wire runnable in the post-run / Stop-hook path (advisory). → **[G-3]**
- [ ] **S3-T5 (E2E):** End-to-End Goal Validation — see below. **Priority P0.** → **[G-1, G-2, G-3, G-4]**

### Task S3.E2E: End-to-End Goal Validation

**Priority:** P0 (Must Complete)
**Goal Contribution:** All goals (G-1, G-2, G-3, G-4)

**Validation Steps:**

| Goal ID | Goal | Validation Action | Expected Result |
|---------|------|-------------------|-----------------|
| G-1 | A required-check green = a real this-PR signal | Inspect the branch-protection required-list after migration; run a seeded regression in package X on a fixture PR | 0 always-red required checks remain; X's scoped check red, an unrelated-package PR green |
| G-2 | No shared package green while unimportable | Run `consumption-doctor.sh --all` over the current tree | adapters → `flag`; cluster-fp + ordering-protocol → `pass`; a no-consumer pkg → `no-consumer` |
| G-3 | A zero-work completion is caught | Run `false-green-sensor.sh` against the replayed 2026-07-03 no-op state, and against a real run | no-op → `suspect`; real run → `pass`; degraded → `insufficient` |
| G-4 | Advisory doesn't rot into a numb gate | Run `flip-report.sh`; confirm ≥1 sensor promoted to `blocking` via its seeded qualifier + clean last-10 window | ≥1 sensor `blocking`, flip-ledger shows the operator-adjudicated seeded true-catch; no `flip-ready`-but-unpromoted sensor at cycle end |

**Acceptance Criteria:**
- [ ] Each goal validated with documented evidence (a re-runnable command per the verdict `evidence.source`)
- [ ] The ground-truth lint passes (all 3 sensors + flip tooling registered)
- [ ] `immune-check.sh --json` aggregates all three sensors' records without a flag day (IMP-005 compat)
- [ ] If S2/S3 slipped, the cycle report states so explicitly — S1 landing alone is a real win (PRD §7)

### Dependencies
- **S1-T4** — the shared verdict schema (settle order). S3 is otherwise independent of S1/S2 (the sensor stands alone — R-5).
- `.run` state shapes; git; `gh issue create` against `loa` (FR-3b, one-time).

### Security Considerations
- **Trust boundaries (L5/L6 untrusted-body rule):** `.run/*state.json` bodies are UNTRUSTED — the sensor parses counters, never interprets body content as instructions; a malformed body is `insufficient`, never executed.
- **Sensitive data:** none in verdict records; the upstream issue must not inline any secret or vault content (summarize in operator voice).

### Risks & Mitigation
| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| R-5: the upstream bridge fix may not land soon | High | Low | FR-3a sensor stands alone in loa-freeside; FR-3b acceptance = issue filed **with reproduction**, not fix landed |
| IMP-009: a corrupt state file false-passes | Med | High | §4.4 table: absent/partial/malformed all → `insufficient` (exit 1), never `pass`; fixtures pin each degraded case |

### Success Metrics
- Replaying the 2026-07-03 no-op yields a SUSPECT/non-success verdict (G-3 settle-target).
- Upstream `loa` issue filed with a reproduction (FR-3b DONE).

---

## Risk Register

| ID | Risk | Sprint | Prob | Impact | Mitigation |
|----|------|--------|------|--------|------------|
| R-1 | Quarantine hides a real failure the numb suite caught | S1 | Med | High | quarantine only after per-package coverage-diff proves equivalence; coverage map audited |
| R-2 | Advisory rots into a new numb gate | S1 | High | High | FR-4 rolling-window flip + seeded qualifier; **G-4 ≥1 flip is a hard exit condition** |
| R-3 | Consumption doctor false-positives on dist-only/no-consumer | S2 | Med | Med | FR-2b `no-consumer` is its own honest state |
| R-4/R-10 | Scoping misses a cross-package (peer/dev-dep) dependent | S1 | Med | High | transitive dependents incl. peerDeps+devDeps; fallback-to-full on ambiguity |
| R-5 | Upstream bridge fix may not land soon | S3 | High | Low | sensor stands alone; acceptance = issue filed, not fix landed |
| R-6 | NFR-7 schema drift vs existing `immune-check.sh` exit contract | S1 | Med | Med | one schema file SoT; `verdict→exit` frozen at 0/1/2; ajv-enforced |
| R-7 | Domain-firewall trip if a sensor commit edits a package's source | S1-S3 | Med | Med | sensors READ packages, never edit; all commits `shared/<x>` scope |
| R-8 | pnpm graph built from per-package lockfiles (no root workspace file) | S1 | Med | Med | build edges from `packages/*/package.json` specifiers; fallback-to-full on parse ambiguity |
| R-9 | Flip-ledger concurrency / merge-conflict / tamper | S1 | Low | Med | main-branch-single-writer; adjudication = operator git commit; git history = tamper trail |
| R-11 | Quarantine drops protection the scoped set doesn't replace | S1 | Med | High | objective per-package coverage-diff + rollback trigger + `rollback_log` |
| R-12 | Promotion never happens (operator PAT step forgotten) | S1 | Med | Med | `flip-ready` un-promoted at cycle end = hard G-4 failure; PAT-absent path prints command |

---

## Success Metrics Summary

| Metric | Target | Measurement | Sprint |
|--------|--------|-------------|--------|
| Always-red *required* checks | 0 | branch-protection required-list post-migration | S1 |
| Scoped-PR wall-clock | < today's whole-repo suite | CI timing (concrete budget = OQ-3) | S1 |
| Sensors promoted to blocking | ≥1 (via seeded qualifier) | `flip-report.sh` + flip-ledger | S1 |
| adapters verdict | `flag` (unconsumable) | `consumption-doctor.sh` over current tree | S2 |
| cluster-fp + ordering-protocol verdict | `pass` (consumable) | `consumption-doctor.sh` over current tree | S2 |
| 2026-07-03 no-op replay verdict | `suspect` | `false-green-sensor.sh` | S3 |
| Upstream `loa` issue | filed with reproduction | `gh issue view` | S3 |

---

## Dependencies Map

```
Existing immune substrate (immune-check.sh + immune-instruments.yaml + ground-truth lint)
        │  (extended by every sensor; verdict/exit contract reused verbatim)
        ▼
S1 (#407) ──────────────▶ S2 (#408) ──────────────▶ S3 (#409)
 Trustworthy Green         Consumption Doctor         False-Green + E2E
 (settle gate)             (fan-out)                  (fan-out)
   │                          │                          │
   └─ verdict schema (S1-T4) ─┴──────────────────────────┘  (shared NFR-7 contract)

Settle order, NOT beads blocked-by. S1 landing alone = "a PR's green means something again."
```

---

## Appendix

### A. PRD Feature Mapping

| PRD FR | Sprint | Task | Status |
|--------|--------|------|--------|
| FR-1a (scoped checks + fallback-to-full) | S1 | S1-T1, S1-T2 | Planned |
| FR-1b (quarantine + coverage map) | S1 | S1-T7 | Planned |
| FR-1c (cluster-compliance jq fix) | S1 | S1-T3 | Planned |
| FR-1d (branch-protection migration) | S1 | S1-T6, S1-T8 | Planned |
| FR-2a/b (consumption doctor) | S2 | S2-T1, S2-T2 | Planned |
| FR-3a (false-green sensor) | S3 | S3-T1, S3-T2 | Planned |
| FR-3b (upstream loa issue) | S3 | S3-T3 | Planned |
| FR-4a/b/c/d (flip mechanism) | S1 | S1-T5, S1-T6, S1-T9 | Planned |
| NFR-7 (shared verdict schema) | S1 | S1-T4 | Planned |

### B. SDD Component Mapping

| SDD Component | Sprint | Task | Status |
|---------------|--------|------|--------|
| `tools/lib/scope-classify.sh` (§1.4/§4.2) | S1 | S1-T1 | Planned |
| `tools/scope-checks-sensor.sh` (§4.2) | S1 | S1-T2 | Planned |
| `.github/scripts/audit-cluster-cells.sh` fix (§4.5) | S1 | S1-T3 | Planned |
| `immune-verdict.schema.json` (§3.1) | S1 | S1-T4 | Planned |
| `flip-ledger.jsonl` + `flip-report.sh` (§3.2/§3.3) | S1 | S1-T5 | Planned |
| `flip-promote.sh` (§3.7) | S1 | S1-T6 | Planned |
| `quarantine-coverage-map.yaml` (§3.4) | S1 | S1-T7 | Planned |
| `immune-instruments.yaml` + `immune-check.sh` extension (§1.4) | S1/S2/S3 | S1-T8, S2-T3, S3-T4 | Planned |
| `tools/consumption-doctor.sh` (§4.3/§3.5) | S2 | S2-T1 | Planned |
| `tools/false-green-sensor.sh` (§4.4) | S3 | S3-T1 | Planned |

### C. PRD Goal Mapping

| Goal ID | Goal Description | Contributing Tasks | Validation Task |
|---------|------------------|-------------------|-----------------|
| G-1 | A required-check green corresponds to a real this-PR signal | S1-T1, S1-T2, S1-T3, S1-T4, S1-T6, S1-T7, S1-T8, S1-T9 | S3-T5 (E2E) |
| G-2 | No shared package "green" while unimportable | S1-T4, S2-T1, S2-T2, S2-T3 | S3-T5 (E2E) |
| G-3 | A zero-work run/bridge completion is caught | S1-T4, S3-T1, S3-T2, S3-T3, S3-T4 | S3-T5 (E2E) |
| G-4 | Advisory does not rot into a new numb gate | S1-T5, S1-T6, S1-T8, S1-T9 | S3-T5 (E2E) |

**Goal Coverage Check:**
- [x] All PRD goals have at least one contributing task
- [x] All goals have a validation task in the final sprint (S3-T5 E2E)
- [x] No orphan tasks — every task annotates ≥1 goal

**Per-Sprint Goal Contribution:**

- **S1 (#407):** G-1 (complete: scoped green + jq fix + migration), G-4 (complete: flip mechanism + seeded-qualifier flip), G-2/G-3 (partial: shared verdict schema)
- **S2 (#408):** G-2 (complete: consumption doctor)
- **S3 (#409):** G-3 (complete: false-green sensor + upstream issue), E2E validation of all goals

### D. Beads Traceability (NFR-3 — the 4 beads ARE the regression corpus)

| Bead (settle-target) | Grounded by task | Sprint |
|----------------------|------------------|--------|
| `arrakis-integration-tests-numb-gate-0is2` | S1-T2 (scoped replacement) + S1-T7 (quarantine + coverage-diff) | S1 |
| `arrakis-cluster-compliance-audit-crash-88ah` | S1-T3 (jq `--argjson` fix) | S1 |
| `arrakis-adapters-dist-unconsumable-d0tv` (P1) | S2-T1 + S2-T2 (import smoke → `flag`) | S2 |
| `arrakis-run-bridge-resume-silent-noop-flzl` | S3-T1 + S3-T2 (`.run` state → `suspect`) | S3 |

Each sensor's acceptance test IS its filed bug (NFR-3). New sprint tasks carry a `related` beads
dependency to the grounding bug; a sensor with no failing-case fixture is incomplete.

### E. Open Questions (from SDD §9 — resolve at implementation)

| # | Question | Owner | Lean default |
|---|----------|-------|--------------|
| OQ-3 | Concrete per-sensor wall-clock budgets (NFR-6) | S1 impl | set once S1 has impl data |
| OQ-4 | bash vs `.mjs` for the sensors | S1 impl | bash + `jq`; `.mjs` only if the graph walk is unwieldy |
| OQ-5 | Which `loa` repo/path owns `bridge-orchestrator.sh` (FR-3b) | S3 impl | confirm before filing |
| OQ-6 | `flip-promote.sh` local-run commit-and-push discipline (audit entry not orphaned) | S1 impl | refuse unless on up-to-date `main`, then commit the event |
| OQ-7 | Per-package test-file attribution for the coverage-diff (§3.4) | S1 impl | derive from `vitest --coverage` file list filtered by `packages/<pkg>/` |

---

## Flatline sprint review (2026-07-03) — task refinements

3-model, envelope **DEGRADED** (grok-headless voice failed; gpt-5.2 + codex-headless at 100%
agreement — strong 2-voice pass, NOT a clean 3-model APPROVED). 3 blockers + 7 HIGH_CONSENSUS,
all task-level. Result: `a2a/flatline/sprint-review.json`. Each maps to a bead acceptance addition:

| Finding | Bead | Refinement (fold into acceptance) |
|---|---|---|
| **BLOCKER** SKP-001 ×2 / IMP-001 | **S1-T6 `arrakis-2cq7`** (flip-promote) | GitHub branch-protection PUT is a **full replace**, not a merge. `flip-promote.sh` MUST **read-modify-write**: GET current protection → add the one required check to `required_status_checks.checks` → PUT the merged whole. Never PUT a partial config (would clobber other required checks / review rules). Same for `--remove` rollback. |
| **BLOCKER** SKP-002 | **S1-T5 `arrakis-rbit`** (flip-ledger) | Add a ledger **validator**: every entry must be well-formed (schema) AND every adjudication entry must be **operator-authored** (git authorship check on the commit that added it); forged/malformed entries are rejected (a promotion that reads them fails closed). |
| IMP-008 | **S1-T6 `arrakis-2cq7`** | `--remove` rollback validates restoration (re-GET confirms the check is gone + other settings intact), records the ledger transition + evidence. |
| IMP-002 | **S1-T4** (verdict schema) | Pin **verdict normalization** rules (the `pass\|flag\|suspect` enum → 0/2/1 exit mapping is the single source; sensors emit only normalized verdicts) so semantics can't diverge. |
| IMP-003 | **S1-T8 `arrakis-whk4`** / aggregator | Define **mixed-state aggregation** in `immune-check.sh`: worst-verdict-wins (`suspect`>`flag`>`insufficient`>`pass`); an `insufficient` never silently reads as `pass` (false-green guard). |
| IMP-004 | **S1-T1/T2** (scope-classify/sensor) | Pin **conservative fallback** for scope-classification failure modes — parse failure, dependency cycle, ambiguous package ownership → **fallback-to-full** (never a silent partial scope). |
| IMP-009 | **S2-T1 `arrakis-r4s7`** (consumption-doctor) | Specify **consumer-discovery semantics**: multiple consumers → smoke against all (or a pinned representative + record which); stale/removed consumer → `no-consumer` honest state, not a pass. |
| IMP-007 | **sprint sequencing** | S1-as-settle-gate ↔ continuation: promotion is per-sensor and operator-gated; a partially-promoted S1 does NOT block S2/S3 start (they only need S1-T4's verdict schema). No accidental partial promotion. |

The two BLOCKER beads (`arrakis-2cq7`, `arrakis-rbit`) were updated with these acceptance additions.

---

*Generated by Sprint Planner Agent · grounded in prd.md (flatline-hardened) + sdd.md v1.1 (flatline-SDD-hardened) · flatline-sprint-reviewed 2026-07-03*
