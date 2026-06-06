---
title: "Session — Tier-A ACVP receipts + per-cell resolution + fail-block flip (doctor-acvp completion)"
trust_tier: ai-derived
read_state: unread
use_label: use_as_background_only
confidence: 0.50
decay_class: working
last_confirmed: 2026-05-30
---

# Session — Tier-A ACVP receipts + per-cell resolution + fail-block flip (doctor-acvp completion)

> The baseline shipped: `doctor` is real and `validateAcvpBindings` enforces default-FAIL — but cluster-side it reports every building as un-backed/aspirational because **no proof receipts exist yet and doctor doesn't resolve per-cell inputs**. This session closes the loop: write the receipts (mediums → sonar), teach doctor to consume them per-cell, then flip the gate to fail-block. That's "converge ACVP" made *real* across the cluster.

## Context

The **agent-doable baseline is MERGED to `main`** (PRs #256 bug-332 + #258 doctor-acvp, FAGAN-converged over 2 iterations). On `main` now: `freeside-cli doctor` (beacon-audit pipeline), `validateAcvpBindings` (pure proof+runtime binding, default-FAIL), `.freeside/acvp-aspirational-allowlist.yaml` (5 dated KF-012 danglers), and a **report-only** `acvp-bindings` job in `cluster-compliance.yml`.

What's left to complete the original intent (make the awareness surface + ACVP binding *real*, not just declared):
1. **T5a/T5b — Tier-A receipts** (cross-repo): each building runs its declared proof tests in its OWN CI and writes `app/.well-known/acvp-proof-receipt.json`. `mediums` first (fully grounded, lowest risk), then `sonar` (KF-012 — surfaces the dangler decision).
2. **Per-cell resolution** (loa-freeside): doctor currently sets `eventsPin`/`proofReceipts` **null cluster-side** (FAGAN iter-2 fix — `doctor.ts` L383-384 + the per-cell comment at L373). Wire the per-cell read (each building's receipt + `package.json.cluster.eventsPin` + `buildingHeadSha` via `git ls-remote`) so the receipts are actually *consumed* and backed buildings report `bound`.
3. **T8 — flip the gate** (loa-freeside): a named PR flips the `acvp-bindings` job report-only → fail-block, once receipts + allowlist deadlines hold.

This is **cross-repo** (`freeside-mediums`, `freeside-sonar`, `loa-freeside`) — dispatch via `/coord`. It is still **independent of the operator-bound cluster-events go-live drill** — do not touch that.

## Run via — `code-implement-and-review` (cross-repo, the Loa `/run` loop) — REQUIRED

Driving composition: `~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml`
  · rails: `implement (the scripts / resolution) → review (/fagan the diff) → operator directs at the loop`

Cross-repo dimension: the implement step runs in **external repos** via `/coord dispatch` (mediums, sonar) for T5a/T5b, and **in-repo** (`/run`) for the per-cell-resolution + T8 work in loa-freeside. `/fagan` is the code-diff gate (per memory `feedback_review-loop-substrate`; codex-* in the composition are deprecated names — the loop SHAPE is the point). Operator directs at the review loop + the dangler/flip decisions.

## Load Order

1. `~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml` — the loop
2. `grimoires/loa/cycles/doctor-acvp-network-plane/sdd.md` — **SOURCE OF TRUTH** (§6 allowlist, §8 two-tier CI, §4.2 the receipt+freshness contract, §4.3 `AcvpProofReceipt` shape). Flatline-hardened; honor FL-B0/HC0-6.
3. `packages/beacon-schema/src/acvp-bindings.ts` (on main) — the validator that CONSUMES receipts: `AcvpProofReceipt {slug, invariant_id, proof_artifact, test_runner, passed_at, commit_sha, pipeline_id?}`; freshness = receipt commit-bound to `buildingHeadSha` → `ok`, else aspirational (FAGAN iter-2).
4. `packages/freeside-cli/src/verbs/doctor.ts` (on main) — §6 sub-check: `eventsPin`/`proofReceipts` are **null cluster-side** today (the per-cell TODO to implement). `safeResolve` is the symlink-safe path resolver to reuse.
5. `packages/beacon-schema/bin/build-beacon-json.ts` — the YAML→JSON adapter to TEACH sealed-hash recompute (correction 4: it's schema-validate-only today).
6. `.github/workflows/cluster-compliance.yml` (on main) — the `acvp-bindings` job (report-only, FL-B1 Phase 0) to flip in T8; and the per-cell checkout it'll need.
7. Targets: `freeside-mediums/{package.json,packages/protocol/beacon.yaml,packages/protocol/tests/,packages/cli-renderer/tests/}` · `freeside-sonar/{package.json,packages/protocol/beacon.yaml}`.

## Persona

ARCH (Ostrom) — contract-plane (the receipt is a new sealed artifact; per-cell resolution is a contract between doctor and the cells). Cross-repo via `/coord`. Craft lens N/A (no UI). `the-arcade` for the CLI/script verb shape if useful.

## What to Build (dependency-ordered)

### 1. T5a — `freeside-mediums` Tier-A scripts (cross-repo, lowest risk first)
mediums is **fully grounded** (4 proof_artifacts exist: `packages/protocol/tests/{decode,cross-repo-audit,overrides}.test.ts` + `packages/cli-renderer/tests/smoke.test.ts`; IDs = `schema_enforcement` ×3 + `state_machine_totality`; bun-based, `test: bun test`).
- `build:beacon` script — YAML→JSON adapter (reuse `@0xhoneyjar/beacon-schema` build-beacon-json) **taught to recompute sealed_schemas hashes** = `sha256Hex(jcsCanonicalize(JSON.parse(schemaFile)))` (the cluster recipe; else emitted beacon keeps `0000…` and doctor flags it forever — correction 4). Exit 1 on schema fail.
- `acvp:verify` script — run the 4 declared proof tests via `bun test <path>`; on all-pass, write `app/.well-known/acvp-proof-receipt.json` = an **ARRAY** of per-invariant `AcvpProofReceipt` (FL-HC0): `{slug:"mediums-api", invariant_id, proof_artifact, test_runner:"bun", passed_at, commit_sha:$(git rev-parse HEAD)}`. Building CI fails if a declared non-aspirational proof is red.

### 2. Verify the receipt shape round-trips
The receipt must satisfy `AcvpProofReceipt` (acvp-bindings.ts) AND doctor's freshness check: `commit_sha == buildingHeadSha` → `ok`. Confirm a hand-run of `validateAcvpBindings` with the mediums receipt + `buildingHeadSha = mediums HEAD` yields `contract_status: bound`.

### 3. Per-cell resolution in doctor (loa-freeside — the bridge that CONSUMES receipts)
In `doctor.ts` §6, replace the cluster-side `eventsPin = null; proofReceipts = null` with real per-cell resolution **when the cell is resolvable**:
- `buildingHeadSha` ← `git ls-remote <entry.git_url> HEAD` (or the registry's pinned ref).
- `proofReceipts` ← fetch/read the cell's `app/.well-known/acvp-proof-receipt.json` (cluster-CI: shallow-clone or raw-fetch per-cell; reuse the cluster-compliance audit job's clone pattern).
- `eventsPin` ← read the cell's `package.json.cluster.eventsPin`.
Keep null + un-backed/aspirational when a cell is NOT resolvable (the current safe default). Add fixtures + tests for the resolvable path.

### 4. T5b — `freeside-sonar` Tier-A scripts (forces the KF-012 decision)
Same `build:beacon` + `acvp:verify`. sonar's 3 invariants (`event_completeness`/`monotonicity`/`audit_replay`) are comment-tagged `ASPIRATIONAL` but carry **no `status:` field** in `beacon.yaml` → they default to `status: active` → default-FAIL → they only escape `error` via the dated T6 allowlist. `tests/acvp/` is **absent** (KF-012), so `acvp:verify` finds nothing to back them. **Decision point (operator), three paths:** (a) port the real `tests/acvp/*.test.ts` (close KF-012, danglers → `bound`); (b) set `status: aspirational` on the 3 invariants in `beacon.yaml` (schema-declared → clean `warn`, no allowlist entry needed — the cleaner long-lived state); or (c) keep them on the dated allowlist until 2026-08-30. (b)+(a) is the eventual target. `eventsPin` 271310a0 → acvp-l1-v2 ✓ (verified), so the runtime binding for the envelope-bound IDs is satisfiable once tests land.

### 5. T8 — flip the `acvp-bindings` gate (loa-freeside, the named PR)
Once mediums (+ sonar) receipts are consumed and every live dangler is receipt-backed or dated-allowlisted: a separate PR `chore(network): acvp-bindings → fail-block` flips the cluster-compliance job report-only → PR-blocking on `error` (FL-B1 Phase 2). Also have the job CHECKOUT/fetch each cell's receipt so per-cell resolution (step 3) has its inputs.

## Design Rules
- **Reuse, don't reinvent**: the JCS+sha256 recipe (`events/jcs.ts` / the copied `freeside-cli/src/lib/jcs.ts`), `validateBeaconV3`, `safeResolve` (symlink containment), `build-beacon-json`. The receipt shape is `AcvpProofReceipt` — match it exactly.
- **Per-invariant receipts** (FL-HC0): the receipt file is an ARRAY, one entry per invariant_id. Doctor matches by `slug + invariant_id + proof_artifact` (slug-scoped — FAGAN iter-1, no confused-deputy).
- **Freshness is commit-bound** (FL-B0): a receipt only yields `ok`/`bound` when `commit_sha == buildingHeadSha`; else aspirational. So the receipt must be written at the building's current HEAD + re-written on each green CI run.
- **Default-FAIL holds**: a building with no receipt + no local proof → `error` (un-backed), unless `status: aspirational` + dated-allowlisted.
- **Two-tier**: green-ness is owned at the SOURCE (the building's own CI writes the receipt); doctor cluster-side only checks existence + freshness, never re-runs cross-repo suites (SC-7).

## What NOT to Build (Barth)
- NO re-running external suites inside doctor (receipt-based only). NO touching the cluster-events go-live drill. NO `beacon.json` emission in doctor (SC-3 — that's `build:beacon`). NO porting sonar's tests/acvp unless the operator green-lights closing KF-012 in this pass (else keep allowlisted). NO flipping the gate (T8) before receipts + allowlist hold.

## Verify
- mediums: `bun run build:beacon` emits a beacon with REAL sealed hashes (no `0000…`); `bun run acvp:verify` writes a valid `acvp-proof-receipt.json` (array, 4 entries).
- loa-freeside: `freeside-cli doctor` (with per-cell resolution + mediums checked out/fetched) reports `mediums-api` → `contract_status: bound` (was aspirational); `cd packages/freeside-cli && npm test` green (new per-cell-resolution tests).
- sonar: `acvp:verify` runs; danglers either backed (if tests ported) or surfaced as allowlisted-aspirational (warn + countdown), never silent.
- T8 PR: the `acvp-bindings` job fails a PR that introduces an un-backed, un-allowlisted invariant.
- Loa gates: `/coord` dispatch for cross-repo; `/run` for in-repo; `/fagan` on each diff.

## Key References
| topic | path |
|---|---|
| SDD (source of truth) | `grimoires/loa/cycles/doctor-acvp-network-plane/sdd.md` (§4.2/§4.3/§6/§8) |
| validator (consumes receipts) | `packages/beacon-schema/src/acvp-bindings.ts` (on main) |
| doctor per-cell TODO | `packages/freeside-cli/src/verbs/doctor.ts` §6 (eventsPin/proofReceipts null) |
| hash-recompute target | `packages/beacon-schema/bin/build-beacon-json.ts` |
| Tier-B job to flip | `.github/workflows/cluster-compliance.yml` (`acvp-bindings`) |
| allowlist (T6, dated) | `.freeside/acvp-aspirational-allowlist.yaml` |
| mediums (T5a) | `~/Documents/GitHub/freeside-mediums` (bun; 4 proofs grounded) |
| sonar (T5b) | `~/Documents/GitHub/freeside-sonar` (KF-012; eventsPin 271310a0) |
| beads | `arrakis-dacvp-epic-bqq6.7` (T5a) · `.8` (T5b) · `.9` (T8) · `.10` (FAGAN-accepts) |
