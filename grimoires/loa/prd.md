# Product Requirements Document — Autopoiesis: Immune Cells for the Factory

> Cycle: **autopoiesis**. Theme: the factory grows the ability to see and reject its own
> broken states — homeostasis first (self-maintaining), the produce-loop graduates later.
> Seeded by friction filed 2026-07-03 during the datastore-legibility ship.
> Previous cycle archived: `prd.prev-2026-07-03-datastore-legibility.md` (S2/S3 deferred,
> beads still open — a parallel track, not cancelled).

> **Spine (operator-ratified):** immune cells with teeth, grounded in 4 REAL filed bugs as
> settle-targets. Chosen over the generative "produce-loop" because the operator's own thread
> rejects premature loop-abstractions ("candidate until the meter moves against a real
> settle-target"). The 4 bugs ARE the meter.

---

## 1. Problem Statement

The factory is **blind to its own broken states**, and the operator is the immune system by
hand. Three concrete instances, all discovered in a single ship (2026-07-03) and filed as beads:

- **A PR's "green" means nothing.** `Integration Tests`, `agent-ci`, and `Cluster Compliance`
  are RED on *every* PR — confirmed identical on two PRs that touch entirely disjoint code
  (#433 platform-only, #434 network-only). A real regression would be invisible in the noise.
  > Bead: `arrakis-integration-tests-numb-gate-0is2` — "Integration Tests runs the WHOLE-repo
  > vitest suite and fails on unrelated code (aws-embedded-metrics dep + MigrationEngine)".
  > Bead: `arrakis-cluster-compliance-audit-crash-88ah` — "jq --argjson invalid JSON on
  > in-monolith cells (events-api / git_url=loa-freeside)".

- **A shared package can ship unconsumable and nobody notices** until a downstream consumer
  breaks. `@freeside/adapters` cannot be imported by any cell (broken dist build, dist-only,
  stale `file:` copy) — discovered only because S1-T3 tried to consume it mid-cycle.
  > Bead: `arrakis-adapters-dist-unconsumable-d0tv` (P1).

- **A run can report success having done zero work.** `/run-bridge --resume` marched to
  `JACKED_OUT` with 0 sprints / 0 findings / 0 commits; the documented silent-noop-detect never
  fired. A false-green at the workflow layer.
  > Bead: `arrakis-run-bridge-resume-silent-noop-flzl`.

This is the **Estate immune-system pattern** the operator has already named: every substrate has
two failure modes — **silence** (a sensor that never speaks) and **no-teeth** (a signal with no
consequence). All three problems above are one or both. The cure is the same triad:
**doctor → aligner → teeth**.

> Sources: 4 filed beads (2026-07-03); memory `Estate immune-system pattern`, `CI sensors must
> not be numb`, `Deployed-but-unconsumed pattern`, `Operator-port + consumption gradient`;
> context `compound-effect-philosophy.md`, `cycle-based-compounding.md`; Phase-1 confirmation.

## 2. Vision

The factory can **see and reject** its own broken states without the operator standing in as the
immune system. A green PR means a real this-PR signal; a shared artifact can't stay green while
unimportable; a zero-work run fails loud. Each capability is an **immune cell**: a sensor
(doctor) + a truth-alignment (aligner) + a consequence (teeth). This cycle grows the first three
cells. It does NOT yet build the generative produce-loop (that "autopoiesis proper" graduates
from proven sensors — deferred by design).

> Sources: memory `THE REFUSAL`, `Awareness-arc produce-loop`, `Icebreaker autopoietic loop`
> (the produce-loop thread, explicitly deferred); Phase-1 spine decision.

## 3. Goals & Success Metrics

| ID | Goal | Metric (settle-target) |
|----|------|------------------------|
| **G-1** | A required-check green corresponds to a real, this-PR signal | 0 always-red *required* checks remain; a regression seeded into a changed package turns that package's scoped check red, while an unrelated-package PR stays green |
| **G-2** | No shared package can be "green" while unimportable by any consumer | The consumption doctor FLAGS `@freeside/adapters` (known-broken) and PASSES `@freeside/cluster-fp` and `@freeside/ordering-protocol` (known-good), run over the current tree |
| **G-3** | A zero-work run/bridge completion is caught, never reported as success | Replaying the 2026-07-03 bridge no-op (0 sprints/findings/commits → JACKED_OUT) yields a SUSPECT/non-success verdict from the sensor |
| **G-4** | Advisory does not rot into a new numb gate | Each sensor has a machine-checkable flip criterion (rolling last-5 window + operator-adjudicated ledger + a **seeded qualifier** so the flip is reachable regardless of organic PR volume); **≥1 sensor flips to blocking within this cycle** via its seeded qualifier |

> Sources: the 4 beads as test corpus; operator doctrine "add prod sensor + quiet numb ones"
> (memory `CI sensors must not be numb`); Phase-2 confirmation.

## 4. Users & Stakeholders

- **Primary: the operator (zkSoju)** — today personally triages every red check to decide if a
  PR is safe (the immune system by hand). Success = the operator trusts a green PR and is alerted
  only on real regressions.
- **Secondary: future autonomous cycles / agents** — every `/run`, `/bug`, bridge, and this-agent
  merge decision currently rides on numb signals. Trustworthy sensors make autonomous merge
  decisions safe (connects to memory `Drive review→merge autonomously`).
- **Tertiary: the `loa` framework maintainer (upstream)** — the bridge false-green root fix lands
  in the `loa` repo; this cycle files that upstream and builds the loa-freeside-side sensor.

> Sources: memory `Drive review→merge autonomously`, `loa-freeside numb merge gate`; Phase-3.

## 5. Functional Requirements

Each cell is one immune cell (doctor → aligner → teeth) grounded in a filed bug.

### FR-1 — Trustworthy Green (the S1 settle gate)
The factory produces a **per-PR signal that means something**.
- **FR-1a** Scope required test checks to **changed packages + their transitive dependents**,
  resolved from the **pnpm dependency graph** (`file:`/workspace edges; per-package lockfiles).
  **Fallback-to-full (blocker SKP-002)**: when a PR touches a non-package / cross-cutting path —
  root lockfile, shared `tsconfig`/build tooling, a CI workflow, a schema/contract file, or
  env/config multiple packages read — package-scoping is UNSAFE; run the **full** required set for
  that PR. Conservative by design: a missed dependent is worse than extra CI (Risk R-4).
- **FR-1b** **Quarantine** the known-numb suites (whole-repo `Integration Tests`, `agent-ci`) into
  a non-required, clearly-labelled lane — **but only AFTER the scoped replacement (FR-1a) is proven
  to cover the same real surface** the suite did (no quarantine-first blind spot — blocker
  SKP-001). Maintain a **quarantine→coverage map**: every quarantined check maps to either its
  replacement scoped check OR an explicit accepted-risk entry — no silent loss of protection
  (IMP-007).
- **FR-1c** Fix the `Cluster Compliance` `jq --argjson` crash: the per-cell audit MUST emit valid
  JSON for in-monolith cells (`git_url=loa-freeside`, e.g. `events-api`) so the aggregate never
  aborts. Once fixed it is a **real signal again**; its enforcement posture follows the SAME
  advisory-first + FR-4 flip path as the new sensors — stated explicitly, no ambiguous middle
  (IMP-008). Grounds `arrakis-cluster-compliance-audit-crash-88ah`.
- **FR-1d Required-check migration (IMP-002)**: changing which checks *run* is insufficient — the
  **branch-protection required-check list** MUST be updated in lockstep (drop the quarantined numb
  checks from "required", add the scoped green). A workflow change without the branch-protection
  update leaves the gate functionally broken.
- **Acceptance**: driven by **repeatable fixtures** (not manual proof — IMP-003): a fixture PR
  touching only package X runs only X's + X's-dependents' checks; a fixture PR touching a shared
  config triggers fallback-to-full; a seeded failure in X is caught; a seeded failure in unrelated
  Y is NOT reported by X's PR; the cluster-compliance job completes (no jq crash) on a
  registry-touching PR; branch protection lists exactly the non-numb required checks.

### FR-2 — Consumption Doctor
A shared package cannot be "healthy" if **no consumer can actually import it**.
- **FR-2a** For each shared/published package, the doctor resolves at least one real consumer and
  runs an **import smoke** (build if the package ships `dist`; resolve+import if it ships `src`)
  under the consumer's actual module resolution — the exact gap that hid the adapters break.
- **FR-2b** Verdict per package: `consumable` / `unconsumable` / `no-consumer` (honest — a package
  with zero consumers is a distinct state, not a pass).
- **Acceptance (G-2)**: FLAGS `@freeside/adapters` `unconsumable` (broken dist chain), PASSES
  `@freeside/cluster-fp` + `@freeside/ordering-protocol` `consumable`. Grounds
  `arrakis-adapters-dist-unconsumable-d0tv`.

### FR-3 — False-Green (No-Op) Sensor
A run/bridge that did nothing cannot report success.
- **FR-3a** A sensor over `.run/*state.json` + git delta: a `JACKED_OUT` / completed run with
  **0 sprints AND 0 findings AND 0 commits** is classified **SUSPECT**, surfaced, never treated
  as a clean completion.
- **FR-3b** File the **upstream** issue against the `loa` framework repo for the
  `bridge-orchestrator.sh` root fix (signal-emission marches to completion when undriven;
  silent-noop-detect did not fire). This cycle builds the loa-freeside-side sensor only —
  `.claude/` is System Zone (Risk: scope). **Acceptance (IMP-010)**: FR-3b is DONE when the
  upstream issue is filed *with a reproduction* (the 2026-07-03 no-op state); S3's completion does
  **NOT** block on the upstream fix landing (R-5) — the loa-freeside sensor stands alone.
- **Acceptance (G-3)**: replaying the 2026-07-03 no-op state yields SUSPECT; a genuine run with
  ≥1 commit yields OK. Grounds `arrakis-run-bridge-resume-silent-noop-flzl`.

### FR-4 — Flip Mechanism (the anti-rot)
Every sensor ships **surface-only** but carries a machine-checkable **flip-to-blocking criterion**
with a defined evidence format, adjudicator, and window.
- **FR-4a Criterion (rolling, not cycle-bound — blocker SKP-001)**: a sensor flips when it has
  ≥1 **true catch** AND **0 false-positives** over a **rolling window of the last N=5 evaluations**
  — NOT "across the whole cycle", so low PR volume can't make the criterion structurally
  unmeetable. Evidence = a `flip-ledger` entry per evaluation `{pr, verdict, adjudication}`.
- **FR-4b Adjudication (blocker SKP-002)**: a flagged item becomes a `true-catch` or
  `false-positive` ONLY by explicit **operator adjudication** (or a corroborating second signal)
  recorded in the flip-ledger — never self-declared by the sensor (the generator-never-settles
  rule). A ledger with an unadjudicated flag blocks promotion.
- **FR-4c Seeded qualifier (makes the flip REACHABLE — blocker SKP-001)**: because a cycle may not
  organically produce a qualifying real issue, each sensor's acceptance INCLUDES a **seeded
  regression** — a deliberately-broken-then-reverted fixture PR (re-break the adapters dist / a
  numb-scoped test / a 0-work run) that the sensor MUST catch. This is the deterministic
  "≥1 true catch" that makes the flip criterion attainable regardless of organic PR flow.
- **FR-4d States**: the cycle flip-report lists each sensor's ledger + state ∈
  `{calibrating(window not full, K/5), flip-ready(met, not promoted), blocking}`. `flip-ready` but
  un-promoted is a **cycle failure** (G-4); `calibrating` is a legitimate reported state, never a
  silent limbo.
- **Acceptance**: ≥1 sensor promoted to `blocking` via its seeded qualifier + a clean rolling
  window, with its flip-ledger as evidence (IMP-004).

> Sources: FR-1↔`integration-tests-numb-gate` + `cluster-compliance-audit-crash`;
> FR-2↔`adapters-dist-unconsumable`; FR-3↔`run-bridge-resume-silent-noop`; FR-4↔operator's
> advisory-first-with-flip-criterion decision (Phase teeth-posture). Memory `Environment design
> game-theory` (hook=real gradient, prose=roleplay), `Gate output never piped`.

## 6. Non-Functional Requirements

- **NFR-1 Advisory-first**: sensors report, don't block, until FR-4 flips them. (operator decision)
- **NFR-2 No new numb gates**: every added check MUST be green on unrelated changes — a check
  that is red regardless of the diff is itself the disease and is rejected in review.
- **NFR-3 Grounded settle**: each sensor's acceptance test IS its filed bug (the 4 beads are the
  regression corpus); a sensor with no failing-case test is incomplete (memory
  `verify-the-mechanism-not-the-symptom`).
- **NFR-4 Exit-code integrity**: a sensor's verdict is its exit code / structured output; never
  pipe a gate through `tail`/`|| true` (memory `Gate output never piped`, rule `stash-safety`).
- **NFR-5 Zone discipline**: sensors live in `.github/`, `tools/`, and `loa-cli`/`freeside-cli`;
  `.claude/` (System Zone) is NOT edited — framework fixes go upstream (FR-3b).
- **NFR-6 Cheap to run**: per-PR sensors add negligible wall-clock (scoped, not whole-repo); the
  consumption doctor runs on demand / on shared-package changes, not every PR. **Initial target
  (IMP-009)**: a scoped PR's required checks complete in *less* wall-clock than today's whole-repo
  suite; concrete per-sensor budgets are set at `/architect` once there's implementation data.
- **NFR-7 Shared sensor verdict schema (IMP-005)**: all three sensors emit ONE common structured
  verdict — `{sensor, target, verdict: pass|flag|suspect, evidence, exit_code}` — so verdict
  vocabulary and exit-code semantics don't drift across cells and the FR-4 flip-ledger consumes
  them uniformly. A new sensor conforms to this schema or it doesn't ship.

> Sources: memory `CI sensors must not be numb`, `Gate output never piped`, `Deletion over
> denylist`; rules `zone-system.md`, `stash-safety.md`; Phase-5.

## 7. Scope & Prioritization

**Vertical slice (settle-gate discipline, mirrors datastore-legibility S1):**
- **S1 — Trustworthy Green (settle gate)**: FR-1 + FR-4 mechanism. Landing S1 alone = "a PR's
  green means something again" — the highest-leverage cell (every future cycle's merge rides on
  it). The report says so if S2/S3 slip.
- **S2 — Consumption Doctor**: FR-2. Grounds the P1 adapters bug; prevents the next
  deployed-but-unconsumed break.
- **S3 — False-Green Sensor**: FR-3 (+ upstream issue). Closes the workflow-layer false-green.

**In scope**: the 3 sensors, the numb-suite quarantine + honest inventory, the cluster-compliance
jq fix, the flip-criterion mechanism + cycle flip-report.

**Out of scope (explicit)**:
- Making the quarantined suites actually *pass* (aws-embedded-metrics dep, MigrationEngine) — a
  separate hygiene cycle; here we only stop them from being numb *required* gates.
- Fixing the `loa` framework `bridge-orchestrator.sh` (upstream issue only; System Zone).
- The generative **produce-loop** (sense→file→drive autonomously) — graduates from these proven
  sensors in a later cycle; building it now is the deployed-but-unconsumed trap.
- **Datastore-legibility S2/S3** — deferred parallel track (beads `arrakis-824h`, `68eb`,
  `prx8`, `30tk`, `uqj0` remain open).

> Sources: operator slice + teeth-posture decisions; memory `Deployed-but-unconsumed pattern`,
> `Frame primitive self-assay REJECTED`; Phase-6.

## 8. Risks & Dependencies

| ID | Risk | Mitigation |
|----|------|------------|
| **R-1** | Quarantining numb suites hides a real failure they *were* catching | FR-1b honest inventory; the scoped green (FR-1a) must cover the same real surface before a suite is quarantined |
| **R-2** | Advisory rots — sensors never flip, become the new numb gates | FR-4 flip-criterion + G-4 (≥1 flip within cycle is a hard exit condition) |
| **R-3** | Consumption doctor false-positives on legitimately dist-only / no-consumer packages | FR-2b treats `no-consumer` as its own honest state; doctor asks "can a real consumer import it", not "must src-ship" |
| **R-4** | Changed-package scoping misses cross-package impact (a change breaks a dependent not in scope) | FR-1a includes **dependents**, conservatively; fall back to full suite when the dependency graph is ambiguous |
| **R-5** | The bridge root fix is upstream and may not land soon | FR-3a sensor stands alone in loa-freeside regardless of the upstream fix timeline |

**Dependencies**: the 4 filed beads (test corpus); `tools/lib/domain-classify.sh` + the
path-domain infra (scoping precedent); the package dependency graph (pnpm `file:` deps,
per-package lockfiles — see memory `pnpm file: dep stale-store`); `freeside-cli`/`loa-cli` as a
sensor surface; `.github/workflows` for the CI lane changes.

> Sources: memory `pnpm-file-dep-stale-store`, `Confirm the gate before the freeze`; Phase-7.

---

> **Traceability**: FR-1 → `arrakis-integration-tests-numb-gate-0is2` +
> `arrakis-cluster-compliance-audit-crash-88ah`; FR-2 → `arrakis-adapters-dist-unconsumable-d0tv`;
> FR-3 → `arrakis-run-bridge-resume-silent-noop-flzl`; FR-4 → operator advisory-first + flip
> decision. Cross-cycle: memory `Estate immune-system pattern`, `Operator-port + consumption
> gradient`, `CI sensors must not be numb`. Prior cycle (deferred):
> `prd.prev-2026-07-03-datastore-legibility.md`.
>
> **Flatline review (2026-07-03, `a2a/flatline/prd-review.json`)**: 3-model, envelope **DEGRADED**
> (grok-headless voice failed; gpt-5.2 + codex-headless carried, 80% agreement — NOT a clean
> APPROVED, treat as a strong 2-voice pass). All **4 blockers** + **7 HIGH_CONSENSUS** + **2
> disputed** integrated: FR-1a fallback-to-full + pnpm graph; FR-1b quarantine-only-after-proven +
> coverage map; FR-1d branch-protection migration; FR-4 rewritten (rolling window + operator
> adjudication + seeded qualifier — fixes the "must-flip may be impossible" logic flaw); NFR-7
> shared verdict schema; FR-3b bounded upstream acceptance; NFR-6 initial perf target.
