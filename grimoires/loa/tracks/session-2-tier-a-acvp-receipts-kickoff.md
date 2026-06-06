---
session: 2
date: 2026-05-30
type: kickoff
status: planned
cycle: doctor-acvp-network-plane
domain: network
run_id: 20260530-0b3438
---

# Session 2 — Tier-A ACVP receipts + per-cell resolution + fail-block flip (kickoff)

## Scope
- **T5a** — `freeside-mediums` Tier-A scripts: `build:beacon` (teach sealed-hash recompute) + `acvp:verify` (run 4 proofs → `app/.well-known/acvp-proof-receipt.json`). Lowest risk first (bun, fully grounded).
- **Per-cell resolution** — `doctor.ts` §6: consume receipts (`buildingHeadSha` via `git ls-remote` + the cell's receipt + `package.json.cluster.eventsPin`). The bridge that makes receipts *count*.
- **T5b** — `freeside-sonar` Tier-A scripts; forces the KF-012 dangler decision (port tests / `status: aspirational` / keep dated-allowlisted).
- **T8** — flip the `cluster-compliance` `acvp-bindings` job report-only → fail-block once receipts + allowlist hold.

## Artifacts
- Build doc: `specs/enhance-tier-a-acvp-receipts.md` (source of truth = SDD §4.2/§4.3/§6/§8; no separate arch doc)
- Run trail: `.run/compose/20260530-0b3438/`

## Prior session
Session 1 (sprint-400) shipped + **MERGED** the agent-doable baseline — `freeside-cli doctor` + `validateAcvpBindings` (default-FAIL) + dated allowlist + report-only `acvp-bindings` CI job (PRs #256 keystone + #258, FAGAN-converged over 2 iterations).

## Decisions made (PREPLAN)
- **Receipt consumption is the bridge**: T5a/T5b *write* receipts, but they're UNUSED until per-cell resolution lands (doctor nulls `eventsPin`/`proofReceipts` cluster-side today, `doctor.ts` L383-384). Don't ship receipts without step 3 or nothing turns green.
- **Tier ordering**: mediums first (lowest risk) → per-cell resolution → sonar (KF-012) → flip gate.
- **sonar danglers**: prefer `status: aspirational` (schema-declared clean `warn`) over the operational dated allowlist long-term; (b)+port-tests is the eventual target.
- **Gates**: cross-repo (mediums/sonar) via `/coord`; in-repo (per-cell + T8) via `/run`; `/fagan` on each diff.
- **Driving composition**: `code-implement-and-review`.
- Independent of the operator-bound cluster-events go-live drill — do not touch it.

## Beads
`arrakis-dacvp-epic-bqq6.7` (T5a) · `.8` (T5b) · `.9` (T8) · `.10` (FAGAN-accepts: yq SHA256-pin, local-file strictness, shared path helper).
