# Product Requirements Document — Cadence Ledger: the Liveness Expectation Record

> Cycle: **cadence-ledger**. Theme: liveness expectations become a declared,
> derived, verifiable contract in the registry — ADR-012's Phase 0, extended with
> the staleness dimension it lacked. Re-homed 2026-07-04 from a kalfu exploration
> that had grounded on the superseded standalone freeside-cli repo (see
> `grimoires/loa/context/cadence-ledger-rehomed-brief.md` for the supersession
> trail and what survived).
> Previous cycle archived: `prd.prev-2026-07-04-autopoiesis.md` (merged #437).

---
status: draft
created: 2026-07-04
domain: network (packages/freeside-registry — additive schema; no gateway/dash/cli behavior change)
source_brief: grimoires/loa/context/cadence-ledger-rehomed-brief.md
relates: decisions/012-unify-cluster-liveness.md (Proposed — this cycle IS its Phase 0, extended)
discovery: /plan-and-analyze 2026-07-04 — 9 operator-resolved forks (see brief + §8)
---

## 1. Problem Statement

Liveness truth in the cluster is **six drifting representations and one orphaned
reader** (ADR-012 §Context): hand-typed `runtime_state`, a stale probe-snapshot
comment, three hand-rolled probes with divergent health paths, a doctor stub —
while the one hardened reader (`loa-cli/lib/probe.mjs`) already consumes a declared
`service` contract that **no registry declares**.

And even that contract only senses *presence-of-broken*. The estate's dominant
failure class is the **false-coherent**: sonar-api's SVM reconcile lane was silently
down ~5 days (Helius quota exhaustion) and downstream consumers could not
distinguish "collection quiet" from "lane down". What *should* be emitting, how
often, and who owns it is written nowhere machine-readable.

> Citation caveat: the exploration brief cited this incident as "KF-018";
> sonar-api's known-failures.md ends at KF-017 — ID unverified. The incident class
> is grounded: the SVM/Helius pipe exists (sonar PRs #76/#101) and the detection
> recipe lives as tribal knowledge at `sonar-api/SCALE.md` (per-chain
> `chain_metadata` block-lag SLOs, e.g. Berachain < 300 blocks).

## 2. Vision

The **expectation record**: per-cell `expectations[]` in the registry, alongside
ADR-012's `service` health block. Probes dispatch on it, runners diff against it,
sinks alert on its transitions, and the coherence-surface view consumes it
verbatim. Primary primitive: **staleness-against-declared-cadence**
(absence-of-expected); presence-of-broken is the trivial case.

The lane spans three repos in strict order; **this cycle delivers only the
loa-freeside slice** — the declaration layer. The naming IS the anti-corruption
layer: "where is health, and what cadence is expected?" is answered once, in
`packages/freeside-registry`, never re-decided per consumer.

## 3. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | ADR-012 Phase 0 lands | `service: {deployment_url, health_path, expected_status, auth_class, expected_body_marker}` exists in the registry Effect Schema; the 8 appendix cells populated from live-probed values |
| G-2 | score-api's real health path resolved, not transcribed | Its ADR-012 DO-NOT-TRANSCRIBE flag discharged: live probe determines the real path/status before declaring; the 302 is never encoded blind |
| G-3 | Expectations are declarative | `expectations[]` (`ref`, `probe_kind: http\|graphql-lag\|event-max-age`, `target`, `expect`, `cadence`, `owner`) in the schema; sonar's chain-lag SLOs and SVM reconcile cadence exist as the first two real entries |
| G-4 | Consumers keep decoding | Additive-only: `packages/freeside-cli` (registry file: dep) test suite green with zero source changes; absent blocks remain valid |
| G-5 | Declarations are validated, not vibes | Schema round-trip + fixture tests; a cell with `expectations[]` but malformed kind/cadence fails decode loudly |

Out-of-cycle (tracked, not gated here): probe.mjs `probe_kind` dispatch (loa-cli
repo, next cycle) · runner/state-branch/Discord sink · gateway + operator-dash
migration (ADR-012 Phases 1–2) · dual-runner watcher graph.

## 4. Users & Stakeholders

- **Operator** — the WHO; consumer of eventual alerts and the daily pulse.
- **Agents** — the expectation record + typed probe output make "quiet or down?"
  mechanically answerable; no tribal knowledge in the loop.
- **Downstream consumers of the schema** (this cycle's real users):
  `loa-cli/lib/probe.mjs` (already reads `service.*` — G-1 un-orphans it),
  `packages/freeside-cli` doctor (must keep decoding, G-4), gateway +
  operator-dash (ADR-012 Phases 1–2 read the declared fields later).

## 5. Functional Requirements

### FR-1 — `service` health block (ADR-012 Phase 0, verbatim)
Add optional `service` struct to `ModuleEntry` in
`packages/freeside-registry/src/registry.ts` with exactly the fields probe.mjs
already reads: `deployment_url`, `health_path`, `expected_status`, `auth_class`,
`expected_body_marker` (all per ADR-012 §Decision-1). Populate the 8 cells from the
ADR appendix values. Cells without a served URL get NO block (derive-don't-type:
their lifecycle derives from absence).

### FR-2 — score-api live resolution (discharge the flag)
Probe score-api live (follow the `/` 302, test `/health` and the redirect target)
and declare its REAL health contract. The ADR appendix explicitly forbids
transcribing the 302 blind. If no stable liveness path exists, declare nothing and
record why in the cell's `notes`.

### FR-3 — `expectations[]` schema
Optional per-cell array; each entry a discriminated union on `probe_kind`
(`http` | `graphql-lag` | `event-max-age`) with common fields
`{ref: stable identity, cadence, owner}` and kind-specific `target`/`expect`.
`gh-workflow` is deliberately excluded until a consumer exists — premature use
must fail decode loudly. `graphql-lag` is generic-declared (query, rows path, key,
minuend/subtrahend, per-key thresholds) — never sonar-hardcoded.

### FR-4 — sonar's two real entries
- `graphql-lag`: the `chain_metadata` recipe from `sonar-api/SCALE.md` — per-chain
  `block_height − latest_processed_block` thresholds (Berachain < 300 the
  strictest). Endpoint/deployment-id is declared data, never baked (it rotates).
- `event-max-age`: the SVM reconcile cadence check. The exact projection
  (`svm_run_marker.updated_at` or equivalent) MUST be verified against sonar's live
  GraphQL schema before declaring — it was an [ASSUMPTION] in the exploration.

### FR-5 — validation with teeth
Effect Schema decode is the gate: fixture tests for valid/invalid entries
(malformed kind, missing cadence, unknown fields), a registry.yaml full-decode
test, and the freeside-cli consumer suite run against the updated registry (G-4).

## 6. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Zero external SaaS in the truth path (operator-locked; sinks-only exception is a later-phase concern) |
| NFR-2 | Additive schema only — no field removed/retyped; `freeside-cli` decodes with zero source changes |
| NFR-3 | Single-domain PRs (network paths only) per ADR-007 firewall |
| NFR-4 | No new dependencies in freeside-registry |
| NFR-5 | Hand-typed values carry provenance: populated `service` blocks cite ADR-012 appendix probe date; score-api's cites its live resolution (FR-2) |

## 7. Scope

**In**: FR-1..FR-5 in `packages/freeside-registry` (+ its tests; freeside-cli tests run, not modified).
**Out (explicit)**: probe.mjs dispatch (loa-cli repo) · any runner/sink/state-branch ·
gateway `probeTenant()` + operator-dash migration (ADR-012 Phases 1–2, other PRs) ·
`runtime_state` derivation (ADR-012 move-3, `arrakis-ybqz`) · GECKO tile grammar ·
touching `packages/freeside-cli` source · reviving the standalone repo.

## 8. Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| ADR-012 is Proposed, not Accepted | This cycle implements its Phase 0 as specified; landing it is the strongest ratification signal. If the ADR is rejected, the additive schema is revertible in one PR. |
| score-api has no stable health path | FR-2 allows declaring nothing + notes; the flag is discharged either way (resolved or documented-unresolvable). |
| ADR appendix values (probed 2026-06-20) drifted in 2 weeks | Sprint task re-probes all 8 before populating; values carry probe date (NFR-5). |
| sonar SVM projection guess wrong | FR-4 verifies against live schema before declaring; only yaml data changes if wrong. |
| freeside-cli decode breaks on unknown fields | G-4 gate: its suite runs in CI before merge. |
| "KF-018" provenance | PRD does not depend on the ID; §1 caveat carries the honest state. |

## 9. Traceability

Sources: `grimoires/loa/context/cadence-ledger-rehomed-brief.md` (supersession
trail + surviving requirements) · `decisions/012-unify-cluster-liveness.md`
(contract fields, appendix values, score-api flag, phase order) ·
`packages/freeside-registry/src/registry.ts` (live schema shape, verified
2026-07-04) · `loa-cli/lib/probe.mjs:90-180` (reader contract, verified
2026-07-04) · `sonar-api/SCALE.md` (lag recipe + SKP-001) · operator interview
2026-07-04 (9 forks: skip-/ride, full-lane phasing, agent-first registry
indirection, success bars, gh-workflow deferral, state branch, single runner
definition, **lane home = ADR-012 continuation**, **port + supersede stale repo**).
