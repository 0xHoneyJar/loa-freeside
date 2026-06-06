---
title: "Session — freeside-cli `doctor` T2a + ACVP-binding validator (network-plane convergence)"
trust_tier: ai-derived
read_state: unread
use_label: use_as_background_only
confidence: 0.50
decay_class: working
last_confirmed: 2026-05-30
---

# Session — freeside-cli `doctor` T2a + ACVP-binding validator (network-plane convergence)

> The awareness surface is hollow at one chokepoint, and ACVP is two surfaces sharing a name. This session makes the beacon *real* and *binds the declaration to the runtime envelope* — the cluster's discoverability + ACVP convergence in one network-plane build.

## Context

Two 2026-05-30 grounding sweeps (`wf_ff4fbbad` GROUND · `wf_25b4745e` TEND) found:
1. **`freeside-cli doctor` is a STUB** → no building's beacon resolves. Every `0000…` placeholder hash + every `*.0xhoneyjar.xyz` 404 traces here (the single **highest-fan-out** task on the network plane — unblocks beacon resolution for all 6 buildings).
2. **ACVP is FRAGMENTED** — the runtime envelope (`@0xhoneyjar/events` acvp-l1-v2, *enforced*, ~63 tests) and the BeaconV3 `acvp_invariants` declaration (*unbacked* — nothing validates `proof_artifact`s) share **zero** code. The single converging move is **one validator** binding declaration → proof + runtime, surfaced **through doctor**.

These two builds share the same vehicle (`doctor.ts` + its test harness) → build them as **one cohesive network-plane session**. They are **independent of the cluster-events go-live drill** (operator-bound; do not touch it here). Full board + rationale: `grimoires/freeside-network/ECOSYSTEM-BASELINE.md`.

**Prerequisite:** the repo's required `Unit Tests` CI context must be green for these builds' PRs to land — that's the keystone fix on branch `bug/sprint-bug-332` (`config.ts` logger.fatal guard), which the operator pushes → CI → merges first.

## Run via — `code-implement-and-review` (the Loa `/run` loop) — REQUIRED

Driving composition: `~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml`
  · rails: `inputs(task · scope · operator_context) → implement → review (craft-gate)`

In THIS repo the concrete vehicle is the **Loa rail**: `/architect → /sprint-plan → /run sprint-N`
(= implement → review-sprint → audit-sprint, circuit-breaker-wrapped). The code-diff adversarial gate is **`/fagan`** — NOT `codex-*` (those construct names in the composition are the *deprecated substrate*; the loop **shape** is the point, per memory `feedback_review-loop-substrate`). **Operator directs** at the review/audit loop and at the three open decisions below.

## Load Order

1. `~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml` — the loop
2. `grimoires/loa/context/sdd-doctor-t2a-candidate.md` — **SOURCE OF TRUTH** for build 1 (the doctor verb)
3. `grimoires/loa/context/sdd-acvp-binding-validator-candidate.md` — **SOURCE OF TRUTH** for build 2 (the validator)
4. `grimoires/freeside-network/ECOSYSTEM-BASELINE.md` — why this matters (the gap audit + ACVP verdict)
5. `packages/freeside-cli/src/verbs/doctor.ts` — the STUB to replace
6. `packages/beacon-schema/src/beacon-v3.ts` — BeaconV3 + `AcvpInvariant` schema
7. `packages/events/src/{envelope.ts,jcs.ts}` — the runtime side to bind to (+ the JCS+sha256 hash recipe)

## Persona

ARCH (Ostrom) — structural (invariants, blast radius, reversibility). The work is **contract-plane** (schemas, validators, a CLI verb), **no UI** → Alexander/craft lens is N/A (no visual components, no tokens/motion). Compose `the-arcade` for the CLI verb shape if useful; `noether` is overkill (no smart contracts).

## Open decisions (resolve FIRST — operator-gated; `/architect` surfaces them)

- **OD-1 (doctor §2):** FIXTURE-FIRST vs REMOTE-FIRST beacon source. → recommend fixture-first + re-add `beacon_fixture` to registry `ModuleEntry` (contract change → operator sign-off).
- **OD-2 (doctor §2):** defer Honeycomb Tag AST-hash recompute → emit `tag_hash_unverified` warn.
- **ACVP-OD (acvp §5):** ratify `AcvpInvariant.status: aspirational` enum + own the dated `.freeside/acvp-aspirational-allowlist.yaml` — the single promotion-gate.

## What to Build (dependency-ordered)

1. **beacon-schema: add `status` field to `AcvpInvariant`** (acvp §8.1) — schema change, /implement-gated; bump beacon-schema tests.
2. **beacon-schema: `validateAcvpBindings` pure core** (acvp §4) — new `src/acvp-bindings.ts` + `index.ts` export + unit fixtures (grounded-mediums → pass, dangling-sonar → error, allowlisted-aspirational → warn, hash_chain-no-pin → error). Pure: injected `fileExists` + `resolvePinSchemaVersion`.
3. **freeside-cli `doctor`: replace the STUB** (doctor §3-4) — the beacon-audit pipeline (resolve → `validateBeaconV3` → cycle-state → `composes_with` → sealed-hash-recompute → report) AND fold `validateAcvpBindings` in as a sub-check. Add `canonicalize` + `@noble/hashes` deps. `doctor.test.ts` + fixtures (doctor §5).
4. **Tier-A wiring — ONE building first (`mediums`, grounded, lowest risk)** (acvp §6) — `build:beacon` + `acvp:verify` scripts → `acvp-proof-receipt.json`. Then `sonar` (forces the KF-012 allowlist decision).
5. **Tier-B cluster job** (acvp §6) — extend `.github/workflows/cluster-compliance.yml` with an `acvp-bindings` job (PR-block + nightly-issue). **NOTE:** that workflow is currently RED (Python-yq-vs-Go-yq config bug + unguarded aggregation glob) — fix it in the same pass (ECOSYSTEM-BASELINE §open-risks / `wf_25b4745e` diag:ci-red).
6. **Backfill the aspirational allowlist** for sonar/auth danglers with operator-set deadlines.

## Design Rules

- Pure core, injected resolvers (`fileExists`, `resolvePinSchemaVersion`) — unit-testable without fs/git (mirror `validateBeaconV3`).
- **Reuse, don't reimplement**: `validateBeaconV3`/`decodeBeacon` (beacon-schema), `jcsCanonicalize`/`sha256Hex` (`events/jcs.ts`).
- **Default = FAIL** for un-backed ACVP declarations; the ONLY non-fail path is `status: aspirational` + a dated allowlist entry (warn + countdown → error at expiry).
- doctor **AUDITS, does not emit `beacon.json`** (that's `build-beacon-json`'s job — SC-3).
- Test-first; deterministic (inject `now`); `node:test` + `execFileSync` harness (mirror `beacon-schema/tests/cli.test.ts`).
- Runtime binding reads `cluster.eventsPin.sha` and resolves SCHEMA_VERSION via `git show` (or a committed `SCHEMA_VERSIONS.json`) — **no** beacon-schema → events runtime import (keep dep graph light).

## What NOT to Build (Barth)

- NO Honeycomb AST-hash recompute (OD-2 defer). NO `beacon.json` emission in doctor (SC-3).
- NO auth-gated fetch for internal/unlisted (SC-2). NO HTTP server / federation manifest (SC-5).
- NO sietch refactor. NO touching the cluster-events go-live path (separate operator drill).
- NO running 6 external repos' test suites inside doctor (receipt-based; Tier-A owns green-ness).

## Verify

- `cd packages/beacon-schema && npm test` — `validateAcvpBindings` fixtures green.
- `cd packages/freeside-cli && npm test` — `doctor.test.ts`: G-1..G-7 (8/8 modules represented; bad-hash → exit 1; compose-drift → error; legacy-v2 → 1 warn; injectable `now`).
- `freeside-cli doctor` against the registry → every building yields ≥1 finding; placeholder hashes + dangling `proof_artifact`s surface as errors.
- KF-012 sonar danglers: land in the allowlist (dated) OR fail — no silent third option.
- Loa gates: `/run` wraps implement→review-sprint→audit-sprint; `/fagan` on the diff.

## Key References

| topic | path |
|---|---|
| doctor SDD (build 1) | `grimoires/loa/context/sdd-doctor-t2a-candidate.md` |
| ACVP-validator SDD (build 2) | `grimoires/loa/context/sdd-acvp-binding-validator-candidate.md` |
| cluster board / why | `grimoires/freeside-network/ECOSYSTEM-BASELINE.md` |
| the STUB to replace | `packages/freeside-cli/src/verbs/doctor.ts` |
| BeaconV3 + AcvpInvariant | `packages/beacon-schema/src/beacon-v3.ts` |
| runtime envelope to bind | `packages/events/src/{envelope,jcs}.ts` |
| CI-red (cluster-compliance yq) | `ECOSYSTEM-BASELINE.md` §open-risks + `wf_25b4745e` diag:ci-red |
| keystone prereq (Unit Tests) | branch `bug/sprint-bug-332` — push→CI→merge first |
