---
title: Sprint Plan — freeside-cli doctor beacon-audit verb + ACVP-binding validator
cycle: doctor-acvp-network-plane
domain: network
status: v1.0
date: 2026-05-30
mode: ARCH (Ostrom)
prd_reference: null   # entered at /architect — SDD §1 (problem) + §12 (G-1..G-12) are the PRD-equivalent
sdd_reference: grimoires/loa/cycles/doctor-acvp-network-plane/sdd.md
ledger: doctor-acvp-network-plane · sprint 400 (global) = sprint-1 (local) · next_sprint_number now 401
beads_epic: arrakis-dacvp-epic-bqq6
beads_cycle_label: cycle:doctor-acvp-network-plane
beads_sprint_label: sprint:400
authored_via: direct (the /sprint-plan fork failed twice on transport/session-limit; deliverables authored inline per the SDD §9 sequencing — gate satisfied: sprint plan + beads + ledger registration all present)
prerequisite: bug/sprint-bug-332 (Unit Tests CI green) merges to main BEFORE these PRs land — operator-side, NOT a sprint task
---

# Sprint Plan — `freeside-cli doctor` + ACVP-binding validator (sprint 400 / sprint-1)

## Executive Summary

One **network-domain** sprint that makes the cluster's awareness surface real and converges ACVP. Two organs share one vehicle (`doctor.ts`): **A** = the beacon-audit verb (resolve → V3-validate → cycle-state → composes_with → sealed-hash recompute → report), **B** = a pure `validateAcvpBindings` core surfaced *through* doctor. All three operator decisions are **resolved** (OD-1 fixture-first · OD-2 defer Honeycomb AST · ACVP-OD default-FAIL + dated allowlist). Default = **FAIL** for un-backed ACVP declarations; the only non-fail path is `status: aspirational` + a dated allowlist entry. Closes KF-012.

Run via the Loa `/run` loop (implement → review-sprint → audit-sprint, circuit-breaker-wrapped); `/fagan` on the diff. Operator directs at the review/audit loop.

| Task | Bead | Goals (SDD §12) | Deps | Repo | Scope |
|------|------|-----------------|------|------|-------|
| **T1** schema: `status` + `runtime_class` on `AcvpInvariant` (§6) | `…bqq6.1` | G-8/G-10/G-12 | — (ready) | loa-freeside | S (contract change, operator-approved) |
| **T2** `validateAcvpBindings` pure core (§4) + index export + tests | `…bqq6.2` | G-8/G-9/G-11/G-12 | T1 | loa-freeside | M |
| **T3** recover `beacon-resolve.ts` + `lib/jcs.ts` + deps + `ModuleEntry` (OD-1, §5.1) | `…bqq6.3` | G-1/G-2/G-7/G-11 | — (ready) | loa-freeside | M (contract change, operator-approved) |
| **T4** replace doctor STUB (§3) + fold ACVP sub-check (§3.6) + `doctor.test.ts` | `…bqq6.4` | G-1..G-7 | T2, T3 | loa-freeside | L |
| **T6** backfill `.freeside/acvp-aspirational-allowlist.yaml` (§6.1) | `…bqq6.5` | G-10 | T1 | loa-freeside | S |
| **T7** Tier-B `cluster-compliance.yml` acvp-bindings job + fix RED yq/glob (§8) | `…bqq6.6` | G-10 | T4 | loa-freeside | M |
| **T5a** `[repo:freeside-mediums]` build:beacon (recompute hashes) + acvp:verify (§8) | `…bqq6.7` | G-8 | T4 | **external** | M (cross-repo dispatch) |
| **T5b** `[repo:freeside-sonar]` build:beacon + acvp:verify (§8) | `…bqq6.8` | G-8/G-10 | T4 | **external** | M (cross-repo dispatch) |

Bead prefix: `arrakis-dacvp-epic-bqq6` (epic) · `.1`–`.8` (tasks). All carry `domain:network`. In-repo tasks carry `sprint:400`; cross-repo carry `cross-repo` (excluded from `/run sprint-1`).

## Dependency DAG (verified — no cycles)

```
T1 (.1) ─┬─→ T2 (.2) ─┐
         └─→ T6 (.5)  ├─→ T4 (.4) ─┬─→ T7 (.6)            [in-repo /run]
T3 (.3) ──────────────┘            ├─→ T5a (.7)  [dispatch]
                                   └─→ T5b (.8)  [dispatch]
```

Ready now: **T1** and **T3** (the two unblocked entry points). `/run sprint-1` walks the in-repo DAG (T1·T3 → T2·T6 → T4 → T7). T5a/T5b are cross-repo follow-ups dispatched via `/coord` after T4 lands.

## Sequencing (SDD §9)

1. **T1** schema (`/implement`-gated — operator approved ACVP-OD) — gates T2, T4, T6.
2. **T2** validator pure core (blocked-by T1).
3. **T3** doctor substrate: recovered loader + copied JCS recipe + deps + `ModuleEntry` change (parallel to T1/T2; no deps).
4. **T4** replace the doctor stub + fold the ACVP sub-check (blocked-by T2, T3).
5. **T6** allowlist backfill (blocked-by T1) — land BEFORE T7's fail-block bites (R-7).
6. **T7** Tier-B cluster job + fix the RED `cluster-compliance.yml` in the same pass (R-6).
7. **T5a → T5b** Tier-A wiring in external repos (mediums grounded → lowest risk first; then sonar forces the KF-012 allowlist) — `/coord` dispatch, not this repo's `/implement`.

## Acceptance criteria

Full bar = SDD §12 **G-1 … G-12** (Organ A: G-1..G-7; Organ B: G-8..G-12). Verify gates per SDD §"Verify":
- `cd packages/beacon-schema && npm test` — `validateAcvpBindings` + schema fixtures green.
- `cd packages/freeside-cli && npm test` — `doctor.test.ts` G-1..G-7 (8/8 modules; bad-hash → exit 1; compose-drift → error; legacy-v2 → 1 warn; injectable `now`; JCS cross-impl identity).
- `freeside-cli doctor` against the registry → every building yields ≥1 finding; placeholder hashes + dangling `proof_artifact`s surface as errors.
- KF-012 sonar danglers: land in the dated allowlist OR fail — no silent third option.

## Scope cuts

Per SDD §10 (SC-1..SC-9): no Honeycomb AST recompute (OD-2 → `tag_hash_unverified` warn) · no `beacon.json` emission in doctor (SC-3) · `--remote` returns `beacon_unreachable` this build (SC-6) · no events runtime import (G-4 — JCS recipe copied) · no sietch refactor · no touching the cluster-events go-live drill (SC-9).
