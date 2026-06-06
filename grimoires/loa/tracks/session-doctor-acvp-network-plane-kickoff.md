---
session: cluster-events-network-plane
date: 2026-05-30
type: kickoff
status: planned
run_id: 20260530-deafce
---

# Session — freeside-cli doctor-T2a + ACVP-binding validator (kickoff)

## Scope
- Replace the `freeside-cli doctor` STUB with the real beacon-audit pipeline (fetch → `validateBeaconV3` → cycle-state → `composes_with` → sealed-hash-recompute → report) — unblocks beacon resolution for all 6 buildings (the highest-fan-out network-plane task).
- Build `validateAcvpBindings` (beacon-schema pure export) binding declared `acvp_invariants` → `proof_artifact` + the runtime envelope (`@0xhoneyjar/events` acvp-l1-v2); surface it THROUGH doctor. Converges ACVP from two-surfaces-sharing-a-name → one validated contract.
- Two-tier CI: Tier-A per-building `acvp:verify` receipt; Tier-B `cluster-compliance.yml` `acvp-bindings` job (+ fix the Python-yq-vs-Go-yq config bug that has cluster-compliance RED).
- Default-FAIL for un-backed declarations; single promotion-gate = `status: aspirational` + dated allowlist (closes KF-012 sonar danglers).

## Artifacts
- Build doc (source of truth): `grimoires/loa/specs/enhance-doctor-acvp-network-plane.md`
- doctor SDD: `grimoires/loa/context/sdd-doctor-t2a-candidate.md`
- ACVP-validator SDD: `grimoires/loa/context/sdd-acvp-binding-validator-candidate.md`
- Cluster board / why: `grimoires/freeside-network/ECOSYSTEM-BASELINE.md`

## Run via
`code-implement-and-review` (the Loa `/run` loop): `/architect → /sprint-plan → /run sprint-N` (implement → review-sprint → audit-sprint); `/fagan` on the diff. Operator directs at the review/audit loop + the 3 open decisions.

## Prior session (2026-05-30 — GECKO grounding + TEND)
Grounded the whole freeside cluster (map↔territory reconciled), strengthened the baseline (hygiene + 5 memory-drift corrections + ECOSYSTEM-BASELINE.md + go-live de-risk runbook), and fixed the keystone (`logger.fatal` CI regression, branch `bug/sprint-bug-332`, reviewed APPROVED pending operator push→CI). NATS broker is LIVE (Path ε); "wire into NATS" is now an operator drill. These builds are the **agent-doable baseline** (ACVP convergence + awareness surface), independent of the operator-bound go-live drill.

## Decisions made (PREPLAN)
- doctor **OD-1**: FIXTURE-FIRST (re-add `beacon_fixture` to registry `ModuleEntry` — operator sign-off).
- doctor **OD-2**: defer Honeycomb AST-hash recompute (`tag_hash_unverified` warn).
- **ACVP-OD**: `status: aspirational` enum + dated allowlist as the single promotion-gate (operator-ratified, /implement).
- ONE cohesive build (shared vehicle `doctor.ts` + test harness), not two separate sessions.

## Prerequisite
The keystone (`bug/sprint-bug-332`) must be pushed → CI-green → merged FIRST — it's the required `Unit Tests` gate that these build PRs inherit on rebase.
