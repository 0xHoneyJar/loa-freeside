---
title: SDD — `freeside-cli doctor` beacon-audit verb + ACVP-binding validator (network-plane convergence)
status: active
date: 2026-05-30
domain: network
plane: contract + execution (CLI audit verb · pure validator core)
persona: ARCH (Ostrom) — invariants, blast radius, reversibility; no UI (no craft lens)
authority: ADR-007 §D-6 + Appendix A.2/A.3/A.4 · ADR-008 §D-11 · ADR-009 §D-2/§D-13
consolidates:
  - grimoires/loa/context/sdd-doctor-t2a-candidate.md   (build 1 — the doctor verb)
  - grimoires/loa/context/sdd-acvp-binding-validator-candidate.md (build 2 — the validator)
brief: grimoires/loa/specs/enhance-doctor-acvp-network-plane.md
operator_decisions_resolved: OD-1 (fixture-first) · OD-2 (defer Honeycomb AST recompute) · ACVP-OD (default-FAIL + aspirational allowlist)
ground_sources:
  - packages/freeside-cli/src/verbs/doctor.ts (the STUB) · bin/freeside-cli.ts · package.json
  - packages/freeside-registry/src/registry.ts (ModuleEntry — no beacon_fixture) · dist/beacon-loader.js (lost-from-src loader) · registry.yaml (8 cells, no sealed hashes)
  - packages/beacon-schema/src/beacon-v3.ts (BeaconV3 + AcvpInvariant) · src/index.ts · bin/build-beacon-json.ts (schema-validate only) · tests/{cli.test.ts,fixtures/freeside-inventory-v3.yaml} · package.json (deps: yaml only)
  - packages/events/src/{envelope.ts:24 SCHEMA_VERSION=acvp-l1-v2, jcs.ts JCS+sha256 recipe}
  - freeside-{sonar,auth(=identity-api),mediums}/packages/protocol/beacon.yaml (live building beacons)
  - .github/workflows/cluster-compliance.yml (Tier-B host workflow)
related: ECOSYSTEM-BASELINE (cluster board) · loa-freeside#253 · [[acvp-two-surface-fragmentation]]
---

# SDD: `freeside-cli doctor` beacon-audit verb + ACVP-binding validator

> The awareness surface is hollow at one chokepoint (`doctor()` is a stub → no
> building's beacon resolves), and ACVP is two surfaces sharing a name (a declared
> `acvp_invariant` and an enforced runtime envelope share **zero** code). This
> build makes the beacon **real** and **binds the declaration to the runtime
> envelope** — both through the same vehicle: `packages/freeside-cli/src/verbs/doctor.ts`.

## 0. How to read this SDD

This is **one network-plane build with two organs that share one vehicle**:

| Organ | What it is | Where it lives |
|---|---|---|
| **A — the doctor verb** | The beacon-audit pipeline (resolve → V3-validate → cycle-state → composes_with → sealed-hash recompute → report). The enforcement point. | `packages/freeside-cli/src/verbs/doctor.ts` (replace stub) + new `beacon-resolve.ts` |
| **B — the ACVP-binding validator** | A pure `validateAcvpBindings` core that binds each declared `acvp_invariant` to a real passing proof + to the runtime envelope pin. Surfaced **as a sub-check inside doctor**. | `packages/beacon-schema/src/acvp-bindings.ts` (new pure export) |

The two were authored as separate candidate SDDs; they are consolidated here
because B has no independent surface — it ships **through** A's report. Section
numbering: §1–§2 problem + decisions (both organs), §3 organ A pipeline, §4
organ B validator, §5 file targets, §6 schema change, §7 test plan, §8 CI wiring,
§9 sequencing, §10 scope cuts, §11 risks, §12 acceptance.

---

## 1. Problem & fan-out (verified)

### 1.1 Organ A — `doctor()` is a STUB

`doctor()` (`doctor.ts:33-58`) loops `registry.modules` and pushes one
`severity:"warn"` finding per module — literally `"Beacon validation deferred
(would fetch ${entry.beacon_url})"`. NO fetch, NO V3 validation, NO Tag
resolution, NO hash recompute. Consequence: there is **no enforcement point**
telling an operator which of the 8 registered buildings (`registry.yaml`: sonar,
storage, mint, activities, inventory, score, identity, mediums — all `*-api`) has
a missing/invalid beacon, a placeholder `0000…` hash, or a broken composition
edge. Every placeholder `sealed_schemas.hash`, every `*.0xhoneyjar.xyz` 404
(`registry.yaml:28-31`), and every un-type-checkable `composes_with` edge is
invisible until doctor can detect + report it. **Highest-fan-out audit primitive
in the network layer** — it unblocks beacon resolution for all 8 buildings
simultaneously.

### 1.2 Organ B — ACVP is one doctrine on two disconnected surfaces

| Surface | Artifact | Status |
|---|---|---|
| Runtime envelope (**ENFORCED**) | `packages/events` acvp-l1-v2 — `envelope.ts:24` `SCHEMA_VERSION = "acvp-l1-v2"`; strict struct; full-field Ed25519-over-JCS sig + per-publisher `prev_hash` chain | working, versioned, ~63 tests |
| Beacon declaration (**ASPIRATIONAL**) | `packages/beacon-schema` `AcvpInvariant` — `beacon-v3.ts:172-201`: 7-ID enum + `scope` + `proof_artifact` path | authored, **un-bound** |

`packages/events` and `packages/beacon-schema` share **zero** dependency.
Nothing checks that a declared `proof_artifact` resolves to a passing test, or
that an invariant-ID corresponds to an enforced runtime property. Live
incoherence (verified this session):

- `freeside-sonar/packages/protocol/beacon.yaml:64-73` declares
  `event_completeness` / `monotonicity` / `audit_replay` → `tests/acvp/*.test.ts`.
  **`tests/acvp/` does not exist in sonar** (KF-012, comments openly mark these
  ASPIRATIONAL).
- `freeside-auth` (= the **identity-api** building) `beacon.yaml:59-65` declares
  `idempotency` + `audit_replay` → same dangling `tests/acvp/*` shape.
- `freeside-mediums` (= **mediums-api**) `beacon.yaml:86-98` is **fully grounded**
  — all 4 `proof_artifact`s reference real files in `packages/protocol/tests/`
  + `packages/cli-renderer/tests/`. (IDs: `schema_enforcement` ×3 +
  `state_machine_totality` — all self-schema / construct-local; no events pin.)
- Several deployed beacons omit `acvp_invariants` entirely.

The population is incoherent. The single converging move is **one validator**
binding declaration → proof + runtime, surfaced through doctor.

---

## 2. Operator decisions — RESOLVED (carried from the build brief)

All three open decisions are resolved by the operator; this SDD treats them as
settled and folds them into the design. Re-stated here for traceability.

- **OD-1 (beacon source mode) → FIXTURE-FIRST.**
  Re-add `beacon_fixture?: string` to the registry `ModuleEntry` schema. Resolve
  in-repo fixtures deterministically; `--remote` returns a structured
  `beacon_unreachable` finding instead of crashing. **This is a contract change**
  to `freeside-registry/src/registry.ts` — `/implement`-gated. Grounding: the
  shipped `ModuleEntry` (`registry.ts:26-32`) has **no** `beacon_fixture` field,
  yet a fully-hardened fixture loader **already exists** at
  `dist/beacon-loader.js` with **no matching `src/beacon-loader.ts`** — it was
  lost from source. We **recover** it (§5), not author from scratch.

- **OD-2 (Honeycomb Tag `schema_hash` recompute) → DEFER.**
  ADR-007 A.2 step-3 wants `schema_hash` recomputed from
  `construct-honeycomb-substrate/lib/ports/<TagName>.ts` — not present in this
  monolith. Implement A.2 **steps 1, 2, 4** (fetch sibling beacon, confirm the
  Tag is declared, fail on name/version/hash **string** mismatch) and emit
  `tag_hash_unverified` (**warn**) for the AST-recompute leg until honeycomb is
  wired.

- **ACVP-OD (un-backed ACVP declarations) → DEFAULT-FAIL + aspirational allowlist.**
  A dangling `proof_artifact` or runtime-vocabulary mismatch is `error` /
  `contract_status: broken` by default — silent aspiration is the disease. The
  single escape hatch: add `status: 'active' | 'aspirational'` (+ optional
  `runtime_class`) to `AcvpInvariant` (§6), and an invariant marked
  `aspirational` must **also** appear in a **dated** allowlist file
  `.freeside/acvp-aspirational-allowlist.yaml` (operator-owned). Allowlisted +
  pre-expiry → `warn` w/ countdown; post-expiry or not-allowlisted → `error`.

### 2.1 Flatline hardening (3-model adversarial pass, 2026-05-30)

This SDD was reviewed by the Flatline Protocol (3 models, 83% agreement, full
confidence — `grimoires/loa/a2a/flatline/doctor-acvp-sdd-review.json`) BEFORE the
autonomous run. Two BLOCKERs + seven HIGH_CONSENSUS items + one disputed item were
integrated (tagged `FL-B0/B1`, `FL-HC0…6`, `FL-D0` at point of use): per-invariant
proof receipts (HC0), null-resolver severity (HC1), achievable-but-not-invisible
G-8 (HC2), build-beacon hash-recompute scope (HC3), `buildingHeadSha` acquisition +
unknown state (HC4), enumerated `check` union (HC5), receipt-borne external
existence (HC6), relaxed receipt freshness (B0), phased report→warn→fail-block
rollout (B1), explicit `now` default (D0). The three operator decisions
(OD-1/OD-2/ACVP-OD) were NOT re-litigated.

---

## 3. Organ A — the doctor pipeline (the verb, end to end)

For each module in `loadRegistry().modules` (8 cells):

1. **Resolve beacon (SoT).** FIXTURE-FIRST (OD-1): if `entry.beacon_fixture` →
   read + `parseYaml` via the recovered `beacon-resolve.ts`; else if `--remote`
   → `fetch(entry.beacon_url)` (skipped this build → `beacon_unreachable` warn,
   §10 SC-6); else → `beacon_deferred` warn. Path hardening mirrors
   `dist/beacon-loader.js:40-50` exactly: `..` reject **before** any fs access →
   `realpathSync` → registry-root containment.
2. **Validate against BeaconV3.** Call `validateBeaconV3(parsed)`
   (`beacon-v3.ts:333-339`). On `{ok:false}` → try `decodeBeacon` (V2,
   exported from `index.ts`). Clean V2 decode → `beacon_legacy_v2` **warn**:
   `"<slug>: BeaconV2 detected, migrate to V3 by <next_review>"` (ADR-007 A.4).
   Neither → `beacon_invalid` **error**.
3. **cycle_state freshness.** `next_review ≥ now` → ok; past → `cycle_review_overdue`
   warn. Assert `next_review − since ≤ 180 days` (ADR-007:379; `beacon-v3.ts:255`
   annotation) → else `cycle_review_window_exceeded` **error**. `now` is injected
   (`opts.now`) for determinism.
4. **composes_with resolution** (ADR-007 A.2). For each sibling key:
   (a) key MUST resolve to a registered module **slug** in the same registry →
   else `compose_unknown_sibling` **error**;
   (b) parse `tag` against the `TagReference` regex (`beacon-v3.ts:108-115`);
   (c) [`--remote` only / fixture-resolvable] fetch the sibling beacon, confirm
   it **declares** the same `TagName@version+hash` → mismatch → `composition_drift`
   **error** (ADR-007 A.2:417);
   (d) AST-hash recompute (A.2 step 3) → `tag_hash_unverified` **warn** (OD-2 defer).
   > **Grounded note**: the canonical `freeside-inventory-v3.yaml` fixture uses
   > compose keys `freeside-sonar` / `freeside-storage` — which are **NOT**
   > registry slugs (registry has `sonar-api` / `storage-api`). So the very
   > reference fixture trips `compose_unknown_sibling`. This is intended: the
   > check is load-bearing, and the test fixtures must encode both the
   > slug-matching and the slug-drift cases explicitly (§7).
5. **sealed_schemas hash recompute.** For each: if the local schema file at `path`
   is resolvable (fixture mode), `recomputeSealedHash(fileText)` =
   `sha256Hex(jcsCanonicalize(JSON.parse(file)))`. Compare to the declared `hash`
   (must match `^[a-f0-9]{64}$`, `beacon-v3.ts:211-218`). Mismatch →
   `sealed_schema_hash_drift` **error**; all-zeros placeholder → same (every live
   building beacon ships `0000…` placeholders today, §11 R-3); unresolvable →
   `sealed_schema_unverified` **warn**.
   > **Grounded note (correction 5)**: `freeside-auth`'s beacon `sealed_schemas`
   > point at `packages/protocol/identity-resolution.schema.json` +
   > `profile-shape.schema.json` which may not exist in that repo → this surfaces
   > as `sealed_schema_unverified` (file-not-found), a **separate** finding from
   > any ACVP allowlist (the allowlist covers `acvp_invariants` only, never
   > sealed schemas).
6. **ACVP binding sub-check** (organ B). Read the building `package.json`
   `cluster.eventsPin` + (if present) `app/.well-known/acvp-proof-receipt.json` +
   the dated allowlist; call `validateAcvpBindings(...)` (§4); fold each
   `AcvpBindingFinding` into the `DoctorFinding` array (mapping `binding`+`id`
   into the `check` string, e.g. `acvp_proof:event_completeness`).
7. **Report.** Aggregate into `DoctorReport` (`doctor.ts:26-31`), bump `summary`,
   set process exit via the existing bin wiring (`freeside-cli.ts:53-58`:
   `summary.error > 0 → 1`).

### 3.1 The JCS+sha256 recipe — REIMPLEMENTED in freeside-cli (correction 2)

The build brief correction 2 (verified): `canonicalize` is **NOT** a dependency
of `beacon-schema` (its `package.json` deps = `yaml` only). The JCS+sha256 recipe
lives **only** in `packages/events/src/jcs.ts` — and per G-4 we MUST NOT import
`events` (runtime) into the contract-plane dependency graph. Therefore
**freeside-cli reimplements the recipe locally**: add `canonicalize@^2` +
`@noble/hashes@^1.6.0` to **freeside-cli**'s `package.json`, and copy the exact
3-line recipe from `jcs.ts:23-42` into a small `freeside-cli/src/lib/jcs.ts`
(or inline in `doctor.ts`). The recipe is byte-stable RFC 8785; a cross-impl
identity test (against `events/jcs.ts` output for a known input) guards the copy.

> **Why not lift the recipe into beacon-schema and share it?** Because the
> sealed-hash recompute is a *doctor* (CLI/execution-plane) concern, and
> beacon-schema must stay dep-light (G-4 keeps `beacon-schema → events` impossible
> and `beacon-schema` deps = `yaml` only). The validator core (organ B) stays
> pure by **injecting** the hash function, not importing it (§4).

---

## 4. Organ B — `validateAcvpBindings` (the pure validator)

### 4.1 Where it lives

A new **pure** export in `beacon-schema`, beside `validateBeaconV3`
(`beacon-v3.ts:333`), surfaced through freeside-cli `doctor` (a thin
orchestrator). New module `packages/beacon-schema/src/acvp-bindings.ts`, exported
from `src/index.ts`. The CLI supplies the impure resolvers (fs/git); the core
takes already-read inputs.

### 4.2 The two bindings

**PROOF binding — does the declared proof exist + pass?**
1. Resolve `proof_artifact` relative to module root (`beacon-v3.ts:189-192`).
   Reject `..` traversal + absolute paths (path-component discipline, L6/L7).
2. **Existence check.** Existence is satisfied by **EITHER** (a) a local
   `fileExists(proof_artifact)` — only possible when the building repo is locally
   resolvable (same-repo / fixture / Tier-A), **OR** (b) a **proof-receipt** that
   asserts the artifact existed + passed (the cluster-side path: doctor in
   loa-freeside CI does **not** have external building repos checked out, so it
   cannot `fileExists` their paths — **FL-HC6**). If **neither** holds → `error`
   (`proof_unverified`) unless promotion-gated (§6). *Default-FAIL is preserved:
   the absence of BOTH a local file and a receipt is an error, never a silent pass.*
3. **Green check** (authoritative, runs in the building's **own** CI — two-tier,
   §8): the building runner executes each proof test; on pass it appends a
   **per-invariant** receipt to `app/.well-known/acvp-proof-receipt.json` — the
   file is an **array** of `AcvpProofReceipt` (one entry per `invariant_id`); a
   single receipt cannot faithfully represent N invariants with independent
   pass/fail states (**FL-HC0**). doctor selects the entry whose `invariant_id`
   matches the invariant under check and checks **freshness** rather than
   re-running cross-repo suites.

**Receipt freshness (FL-B0 — relaxed; no false-positive downgrades).** Strict
`commit_sha == buildingHeadSha` is wrong: a building's HEAD advances on *any*
commit (docs, unrelated code), which would flip a still-valid proof to "stale". So:
- `buildingHeadSha` is acquired (**FL-HC4**) from the registry entry's pinned
  ref/sha if present, else `git ls-remote <git_url> HEAD` at cluster-CI time, else
  **unknown**.
- Head **unknown** → receipt treated **fresh-enough** (`ok`) with a
  `receipt_freshness_unconfirmed` note — NOT downgraded.
- Head **known** → fresh if `receipt.commit_sha == head`, OR `commit_sha` is
  reachable in the building's recent history (ancestor within a bounded window),
  OR a stable CI `pipeline_id` correlates the receipt to the run. Mark `warn`
  (stale → aspirational) **only** when we can **positively** determine the
  `proof_artifact` changed since the receipt SHA. Staleness is **never** a hard
  `error`.

Rationale for the split: doctor runs in loa-freeside CI and cannot cheaply or
trustworthily run 6 external repos' suites, nor see their files. Existence is
local-file-OR-receipt; green-ness is owned at source; the per-invariant receipt
makes green-ness portable; best-effort freshness avoids false downgrades.

**RUNTIME / VOCABULARY binding — does the declared ID mean what it says?**
The anchor is the building `package.json` `cluster.eventsPin` (repo/subdir/package/sha)
— the sovereign **source-distributed** pin (verified on `freeside-sonar/package.json`),
NOT npm. Static ID → runtime-class table (the operator-owned contract, lives in
the validator):

| invariant-ID | runtime class | binding obligation |
|---|---|---|
| `hash_chain` | envelope-bound | building MUST declare `cluster.eventsPin` to events at a SHA whose `SCHEMA_VERSION == "acvp-l1-v2"` |
| `schema_enforcement` | envelope-bound OR self-schema | envelope-bound: same pin check; self (mediums-style): `proof_artifact` must exercise `Schema.decodeUnknownSync` round-trip |
| `audit_replay` | **OD case** | envelope-bound (sonar: re-chain) **OR** storage-bound (auth/identity: Postgres append-only). Default: require **EITHER** an `eventsPin` **OR** an explicit `runtime_class: 'storage'` field on the invariant |
| `event_completeness` | envelope-bound | `eventsPin` required |
| `monotonicity` / `idempotency` / `state_machine_totality` | construct-local (no I/O) | NO `eventsPin` required — proof binding only |

Pin-resolution (keeps beacon-schema dep-light, G-4): the validator does **not**
import `events`. It reads `cluster.eventsPin.sha` and resolves that commit's
`SCHEMA_VERSION` via an injected `resolvePinSchemaVersion(sha)`. The CLI
implements that resolver by either (a) `git show <sha>:packages/events/src/envelope.ts`
parsed for `SCHEMA_VERSION` (doctor/cluster-CI run in a loa-freeside checkout —
the only real path today, since no `SCHEMA_VERSIONS.json` exists yet, verified
this session), or (b) a committed `packages/events/SCHEMA_VERSIONS.json`
sha→version map maintained by the events release step (cheap-offline, **future**).
Declared envelope-bound ID + missing/mismatched pin → `error` (vocabulary misuse).

### 4.3 API

```typescript
// pure: takes already-read inputs; does NO fs/git itself except via injected resolvers
export const validateAcvpBindings = (input: {
  beacon: BeaconV3;                          // decoded via validateBeaconV3 first
  moduleRoot: string;
  fileExists: (rel: string) => boolean;      // injected — testable, no fs in core
  eventsPin?: { package: string; sha: string } | null;
  resolvePinSchemaVersion: (sha: string) => string | null;  // injected — no events import
  proofReceipts?: ReadonlyArray<AcvpProofReceipt> | null;  // per-invariant; matched by invariant_id (FL-HC0)
  buildingHeadSha?: string | null;           // null = unknown → freshness unconfirmed, do NOT downgrade (FL-B0/HC4)
  aspirationalAllowlist: ReadonlyArray<{ slug: string; id: string; expires: string }>;
  now?: Date;                                // injected; defaults to caller-supplied time, never wall-clock in the core (G-7, FL-D0)
}): AcvpBindingReport;

export interface AcvpBindingFinding {
  slug: string; invariant_id: string;
  binding: "proof" | "runtime";
  severity: "ok" | "warn" | "error";
  message: string;
  aspirational_until?: string;
}
export interface AcvpBindingReport {
  slug: string; checked_at: string;
  findings: ReadonlyArray<AcvpBindingFinding>;
  summary: { ok: number; warn: number; error: number };
  contract_status: "bound" | "aspirational" | "broken";
}
export interface AcvpProofReceipt {
  slug: string; invariant_id: string; proof_artifact: string;
  test_runner: string; passed_at: string; commit_sha: string;
  pipeline_id?: string;   // optional CI run correlator (FL-B0 freshness fallback)
}
// The on-disk app/.well-known/acvp-proof-receipt.json is an ARRAY of
// AcvpProofReceipt — one entry per invariant_id (FL-HC0). doctor selects the
// entry whose invariant_id matches the invariant under check.
```

The expected acvp-l1-v2 constant is passed in or hardcoded as a known string in
the validator (`"acvp-l1-v2"`) — it is a *contract value*, not a runtime import.

### 4.4 Failure-modes table (the contract, explicit)

| condition | binding | severity | contract_status |
|---|---|---|---|
| local file resolves OR receipt green + fresh | proof | ok | (toward) bound |
| no local file AND no receipt (external, uncheckable) | proof | error (`proof_unverified`) | broken |
| local file resolves, receipt red/absent (non-aspirational) | proof | error | broken |
| receipt present, head unknown → freshness unconfirmed (FL-B0) | proof | ok + `receipt_freshness_unconfirmed` note | (toward) bound |
| receipt present, proof POSITIVELY changed since receipt SHA | proof | warn | aspirational |
| envelope-bound ID + `eventsPin` to acvp-l1-v2 | runtime | ok | (toward) bound |
| envelope-bound ID + no `eventsPin` | runtime | error | broken |
| envelope-bound ID + `eventsPin` to non-acvp-l1-v2 SHA | runtime | error | broken |
| envelope-bound ID + `eventsPin` present but `resolvePinSchemaVersion` → null (unresolvable, e.g. shallow clone) | runtime | warn (`runtime_pin_unresolved`) | aspirational (FL-HC1) |
| `audit_replay` + `runtime_class:'storage'` (no pin) | runtime | ok | (toward) bound |
| construct-local ID (`monotonicity`/`idempotency`/`state_machine_totality`) | runtime | n/a (skip) | — |
| `status:aspirational` + allowlisted + pre-expiry | either | warn | aspirational |
| `status:aspirational` + (not allowlisted OR post-expiry) | either | error | broken |

`contract_status: bound` requires **all** applicable findings `ok`. An aspirational
warn cannot yield `bound` (NFR parallel to the events `verdict_quality` floor:
`clean` is definitionally impossible under degraded quality). `private: true`
invariants are still validated (privacy controls federation visibility, not proof
obligation).

---

## 5. File targets + signatures

### 5.1 Organ A (the verb)

- **MODIFY `packages/freeside-cli/src/verbs/doctor.ts`** — replace the stub body:
  - `export interface DoctorOptions { remote?: boolean; baselineRegistryPath?: string; now?: Date }`
  - `export const doctor = async (opts?: DoctorOptions): Promise<DoctorReport>` (now **async**).
  - Keep `DoctorFinding` / `DoctorReport` / `Severity` exports; extend `check` to a
    documented string-literal union (FL-HC5 — `check` is downstream-facing API
    surface; enumerate, do not scatter literals): `"beacon_deferred" |
    "beacon_unreachable" | "beacon_invalid" | "beacon_legacy_v2" |
    "beacon_auth_required" | "cycle_review_overdue" | "cycle_review_window_exceeded"
    | "compose_unknown_sibling" | "composition_drift" | "tag_hash_unverified" |
    "sealed_schema_hash_drift" | "sealed_schema_unverified" | "proof_unverified" |
    "receipt_freshness_unconfirmed" | "runtime_pin_unresolved" |
    \`acvp_proof:${invariant_id}\` | \`acvp_runtime:${invariant_id}\``
    (the two `acvp_*` carry the `invariant_id` as a `:`-suffix).
  - Add pure, unit-testable helpers (no I/O): `checkCycleState(beacon, now)`,
    `checkComposesWith(slug, beacon, registry)`, `recomputeSealedHash(schemaJsonText)`,
    `checkSealedSchemas(slug, beacon, resolveSchema)`.
- **NEW `packages/freeside-cli/src/verbs/beacon-resolve.ts`** — recover the loader
  lost from src (correction 1). Lift `resolveFixturePath` + `classifyBeacon` +
  `loadBeacon` **verbatim** from `dist/beacon-loader.js:40-105` into supported TS
  source. Signature: `resolveBeacon(entry, registryRoot): { kind:"v3", beacon } |
  { kind:"legacy", beacon } | { kind:"error", error }`. (Decode-attempt
  discrimination, NOT `schema_version`-string discrimination — see the loader's
  D-S2-1 deviation note; verified the schema requires `Literal("3")` so a V3
  beacon carries `schema_version: "3"`, but the loader's try-V3-then-V2 approach
  is the resilient one and is preserved.)
- **NEW `packages/freeside-cli/src/lib/jcs.ts`** — copy the `jcsCanonicalize` +
  `sha256Hex` recipe from `events/src/jcs.ts:23-42` (correction 2 — reimplement,
  do NOT import events). 3 lines of logic + the CJS-interop cast for `canonicalize@2`.
- **MODIFY `packages/freeside-registry/src/registry.ts`** — OD-1 contract change:
  add `beacon_fixture: Schema.optional(Schema.String)` to `ModuleEntry`. Also add
  the fields `registry.yaml` already carries but the schema silently strips today
  (verified: `deployment_url`, `runtime_state`, `notes` present in YAML, absent
  from `Schema.Struct`): `deployment_url: Schema.optionalWith(Schema.NullOr(Schema.String), …)`,
  `runtime_state: Schema.optional(Schema.Literal("deployed","scaffolded","not-built"))`,
  `notes: Schema.optional(Schema.String)`. **This is the operator-gated contract change.**
- **MODIFY `packages/freeside-cli/bin/freeside-cli.ts`** — `doctor` case →
  `await doctor(parseFlags(args))`; thread `--remote` / `--baseline` / `--acvp`;
  make `main` async (currently `const main = (): number`, `process.exit(main())`
  → `process.exit(await main())`).
- **MODIFY `packages/freeside-cli/package.json`** — add deps `canonicalize@^2` +
  `@noble/hashes@^1.6.0` (correction 2: NOT inherited from beacon-schema; add here).
- **NEW `packages/freeside-cli/tests/doctor.test.ts`** + `tests/fixtures/`.

### 5.2 Organ B (the validator)

- **MODIFY `packages/beacon-schema/src/beacon-v3.ts`** — add `status` (+ optional
  `runtime_class`) to `AcvpInvariant` (§6). Schema change — `/implement`-gated.
- **NEW `packages/beacon-schema/src/acvp-bindings.ts`** — the pure
  `validateAcvpBindings` core + `AcvpBindingFinding` / `AcvpBindingReport` /
  `AcvpProofReceipt` types + the static ID→runtime-class table.
- **MODIFY `packages/beacon-schema/src/index.ts`** — export `validateAcvpBindings`
  + the new types (mirror the `validateBeaconV3` export at lines 18-24).
- **MODIFY `packages/beacon-schema/tests/schema.test.ts`** — cover the new
  `status` field (default `"active"`, accepts `"aspirational"`, rejects others).
- **NEW `packages/beacon-schema/tests/acvp-bindings.test.ts`** + fixtures.

### 5.3 Reuse, do NOT reimplement

`validateBeaconV3` / `decodeBeacon` (beacon-schema, already exported). The fixture
loader (recover from `dist`, don't re-author). The JCS recipe is **copied** (not
imported) into freeside-cli to respect G-4 — that is an intentional, audited dup
of 3 lines, guarded by a cross-impl identity test.

---

## 6. Schema change — `AcvpInvariant.status` + `runtime_class` (ACVP-OD)

`packages/beacon-schema/src/beacon-v3.ts`, the `AcvpInvariant` struct
(`:184-196`). Add:

```typescript
status: Schema.optionalWith(
  Schema.Literal("active", "aspirational"),
  { default: () => "active" },
).annotations({
  description:
    "active = backed by a passing proof + correct runtime binding; " +
    "aspirational = declared-but-not-yet-backed (MUST appear dated in " +
    ".freeside/acvp-aspirational-allowlist.yaml — warns w/ countdown, errors at expiry)",
}),
runtime_class: Schema.optional(
  Schema.Literal("envelope", "storage", "construct-local"),
).annotations({
  description:
    "Disambiguates audit_replay binding (ACVP-OD): 'storage' = Postgres " +
    "append-only (auth/identity); 'envelope' = events re-chain (sonar). " +
    "Optional; the validator's ID→class table is the default.",
}),
```

Default `"active"` is load-bearing: existing beacons keep working and a missing
`status` does **not** mean "aspirational free pass" — it means "claims to be
backed", which the validator then **enforces** (default-FAIL on a missing proof).
`additionalProperties` is not set on this struct, so the bump is additive and
JSON-Schema export stays consistent (mirrors the `BeaconV3JsonSchema` export at
`index.ts:38`).

### 6.1 The allowlist file — `.freeside/acvp-aspirational-allowlist.yaml`

New operator-owned file in loa-freeside (the `.freeside/` dir does **not** exist
yet — create it). Shape:

```yaml
# .freeside/acvp-aspirational-allowlist.yaml
# Operator-owned promotion gate. Each entry: a dated grace window for an
# acvp_invariant declared `status: aspirational`. After `expires`, doctor
# errors. Not-listed + aspirational also errors (no silent third option).
version: 1
allowlist:
  - slug: sonar-api
    id: event_completeness
    expires: "2026-08-30"      # operator-set deadline
    reason: "KF-012 — tests/acvp/ not yet ported from blue-green reconciliation gate"
  - slug: sonar-api
    id: audit_replay
    expires: "2026-08-30"
    reason: "KF-012 — bound by green-vs-blue reconciliation, not unit test yet"
  # identity-api (freeside-auth) danglers backfilled in §9 step 6
```

`monotonicity` is construct-local → it never needs an `eventsPin`, but its
`proof_artifact` (`tests/acvp/monotonicity.test.ts`) is still dangling in sonar →
still needs an allowlist entry until the test lands. The §9 backfill enumerates
the full sonar + identity-api dangler set with operator-set deadlines.

---

## 7. Test plan (test-first; deterministic)

Harness: `node:test` via `tsx --test` (matches both packages' existing
`"test"` scripts) + `execFileSync` for CLI smoke — mirror
`beacon-schema/tests/cli.test.ts` exactly.

### 7.1 Organ B unit tests (`beacon-schema/tests/acvp-bindings.test.ts`)

Pure fixtures, injected `fileExists` / `resolvePinSchemaVersion` / `now`:

| fixture | expected |
|---|---|
| grounded mediums (4 proofs exist, self-schema IDs, no pin) | all `ok`, `contract_status: bound` |
| dangling sonar (proofs absent, `status` unset → default active) | `error` per dangling proof, `broken` |
| dangling sonar + allowlisted (pre-expiry, `status: aspirational`) | `warn` w/ `aspirational_until`, `aspirational` |
| dangling sonar + allowlisted (post-expiry) | `error`, `broken` |
| `aspirational` but NOT in allowlist | `error`, `broken` |
| `hash_chain` ID + no `eventsPin` | runtime `error`, `broken` |
| `hash_chain` ID + `eventsPin` resolving to acvp-l1-v2 + green receipt | `ok` |
| `event_completeness` + `eventsPin` to non-acvp-l1-v2 sha | runtime `error`, `broken` |
| `audit_replay` + `runtime_class: storage`, no pin | runtime `ok` |
| `audit_replay`, no pin, no `runtime_class` | runtime `error` (OD default) |
| proof exists but receipt stale (`commit_sha != buildingHeadSha`) | proof `warn`, `aspirational` |

### 7.2 Organ B schema tests (extend `schema.test.ts`)

`status` defaults to `"active"`; accepts `"aspirational"`; rejects other strings;
`runtime_class` optional, accepts the 3 literals; a beacon with neither field
decodes unchanged (additive bump).

### 7.3 Organ A unit + CLI tests (`freeside-cli/tests/doctor.test.ts`)

Fixtures under `freeside-cli/tests/fixtures/`:
`beacon-valid-v3.yaml` (clone of `freeside-inventory-v3.yaml`),
`beacon-legacy-v2.yaml`, `beacon-bad-hash.yaml` (all-zeros),
`beacon-stale-cycle.yaml`, `beacon-window-exceeded.yaml`,
`beacon-compose-unknown.yaml`, `beacon-compose-drift.yaml`,
`beacon-malformed.yaml`, a schema JSON file (for real sealed-hash recompute), and
`registry-fixture.yaml` pointing modules at the above via `beacon_fixture`.

Unit (pure helpers): valid → 0 errors; legacy-v2 → 1 `beacon_legacy_v2` warn w/
migrate date; bad-hash → `sealed_schema_hash_drift` error **and**
`recomputeSealedHash` returns the correct 64-hex for a known JSON; stale →
`cycle_review_overdue` warn (inject `opts.now`); window → `cycle_review_window_exceeded`
error; compose-unknown (a key not a registry slug) → `compose_unknown_sibling`;
compose-drift → `composition_drift`; malformed → `beacon_invalid`; TagReference
regex accept/reject table; **JCS cross-impl identity** (the copied recipe matches
`events/jcs.ts` output for a known input).

CLI smoke (`execFileSync`): exit 1 on any error fixture; exit 0 all-valid;
`--remote` unreachable → `beacon_unreachable`, NO crash; deterministic (identical
inputs → byte-identical report modulo `checked_at`).

---

## 8. CI wiring (two-tier)

- **Tier A — building-local (authoritative green-check), in each `freeside-*` repo.**
  Add a `build:beacon` script (the `build-beacon-json` YAML→JSON adapter, exit 1
  on schema fail). **Correction 4 (verified): `build-beacon-json` does NOT
  recompute sealed hashes today — it is schema-validate + YAML→JSON only**
  (`build-beacon-json.ts:44-67`). So the Tier-A `build:beacon` for the first
  building (mediums) must be **taught** to recompute the sealed-schema hashes
  (reuse the same `recomputeSealedHash`/JCS recipe doctor uses) before emitting
  `app/.well-known/beacon.json` — otherwise the emitted JSON keeps the `0000…`
  placeholders and doctor flags it forever. Add an `acvp:verify` script that runs
  the declared proof tests via the building runner (mediums: `bun test`) and
  writes `app/.well-known/acvp-proof-receipt.json`. Building CI fails if a
  declared non-aspirational `proof_artifact` is red/missing.
- **Tier B — cluster-side, in loa-freeside.** Extend
  `.github/workflows/cluster-compliance.yml` (registry-driven, nightly cron +
  PR-on-`registry.yaml`) with an `acvp-bindings` job that runs `freeside-cli
  doctor --acvp` per module — path-existence + runtime-vocabulary +
  receipt-freshness (NOT re-running tests).
  **Rollout phases (FL-B1 — the gate is introduced transitionally, never
  fail-blocking before receipts + allowlist exist):**
  - **Phase 0 — report-only** (lands with T7): the job runs `doctor --acvp` and
    posts findings as PR annotations / a job summary; it **never fails** the PR,
    and opens the nightly issue-on-drift (mirrors `cluster-compliance.yml:187-219`).
    This is the state the moment T7 merges.
  - **Phase 1 — warn + dated deadline**: after T6 (allowlist) **and** the first
    Tier-A receipt (T5a, mediums) land, the job annotates `error`s as warnings with
    the allowlist countdown. Still non-blocking.
  - **Phase 2 — fail-block**: after T5b (sonar receipt) lands and every live
    dangler is either receipt-backed or in the dated allowlist, a **named flip PR**
    (`chore(network): acvp-bindings → fail-block`) sets the job to fail the PR on
    `error`. Only this PR makes the gate blocking.
  > **Workflow is currently RED** (per the build brief / ECOSYSTEM-BASELINE
  > §open-risks): `cluster-compliance.yml:61-65` installs `yq` via apt **or**
  > `pip install yq` (Python-yq) as a fallback, then `:74` calls `yq -o=json`
  > which is **Go-yq** syntax — Python-yq does not accept `-o=json`. Pin the
  > installer to Go-yq (mikefarah) explicitly. Also `:153` aggregates
  > `audit-results/*.json` via `jq -s` with **no guard** for zero matches (a
  > glob that matches nothing passes the literal string to jq). Guard both in the
  > same pass (this is a network-domain CI fix, in-scope here).
- **beacon-schema repo CI:** the new `acvp-bindings.test.ts` runs under the
  existing `"test"` script (already runs `tests/*.test.ts`).

---

## 9. Sequencing (dependency-ordered)

> **Prerequisite (operator-side, NOT this build):** the repo's required `Unit
> Tests` CI context must be green for these PRs to land — keystone fix on branch
> `bug/sprint-bug-332` (`config.ts` `logger.fatal` guard), which the operator
> pushes → CI → merges first.

1. **(operator-gated `/implement`) beacon-schema: add `status` + `runtime_class`
   to `AcvpInvariant`** (§6) — schema change; bump `schema.test.ts`.
2. **beacon-schema: `validateAcvpBindings` pure core** (§4) — new `acvp-bindings.ts`
   + `index.ts` export + unit fixtures (grounded mediums → pass, dangling sonar →
   error, allowlisted-aspirational → warn, hash_chain-no-pin → error).
3. **freeside-cli: recover `beacon-resolve.ts` + copy `lib/jcs.ts`** (corrections
   1, 2); add the two deps; OD-1 registry `ModuleEntry` contract change.
4. **freeside-cli `doctor`: replace the STUB** (§3) — the beacon-audit pipeline
   + fold `validateAcvpBindings` in as the §3.6 sub-check; `doctor.test.ts` +
   fixtures.
5. **Tier-A wiring — ONE building first (`mediums`, grounded, lowest risk)** (§8) —
   `build:beacon` (taught to recompute sealed hashes, correction 4) + `acvp:verify`
   → `acvp-proof-receipt.json`. Then `sonar` (forces the KF-012 allowlist decision).
6. **Backfill `.freeside/acvp-aspirational-allowlist.yaml`** for sonar + identity-api
   danglers with operator-set deadlines (§6.1).
7. **Tier-B cluster job** (§8) — extend `cluster-compliance.yml` with the
   `acvp-bindings` job in **report-only** mode (FL-B1 Phase 0) **and fix the RED
   yq/glob bugs in the same pass**. The job does NOT fail-block on merge.
8. **Flip to fail-block** (FL-B1 Phase 2) — a separate named PR
   (`chore(network): acvp-bindings → fail-block`) flips the gate to blocking, only
   AFTER T5a + T5b receipts and the T6 allowlist deadlines are in place. This is
   the single PR that makes the contract surface enforce.

Land BEFORE the cluster-events go-live drill (baseline strengthening) but this is
**NOT itself drill-blocking** — the drill's silent-failure risk is cold-start
chain coherence + SHA-pin propagation, not this validator's absence. Do NOT touch
the go-live path here.

---

## 10. Scope cuts (Barth)

- **SC-1** No Honeycomb Tag AST `schema_hash` recompute (OD-2 defer) → emit
  `tag_hash_unverified` warn.
- **SC-2** No auth-gated fetch for `unlisted` / `internal`; public + fixture only;
  internal → `beacon_auth_required` warn (inventory-api is `internal`).
- **SC-3** doctor **AUDITS, does not emit `/.well-known/beacon.json`** — that is
  `build-beacon-json`'s job. doctor MAY *share* `recomputeSealedHash` with the
  Tier-A `build:beacon` so the building writes REAL hashes (§8), but it does not
  generate the artifact itself.
- **SC-4** No remediation / auto-fix / PR — report + exit code only.
- **SC-5** No HTTP server / federation manifest (`buildCompactManifest`, separate
  cycle).
- **SC-6** Remote `beacon_url` fetch is fixture-first this build — `--remote`
  returns `beacon_unreachable` (all 6 `*.0xhoneyjar.xyz` 404 today). Real fetch
  is a follow-up.
- **SC-7** No running 6 external repos' test suites inside doctor (receipt-based;
  Tier-A owns green-ness).
- **SC-8** No `events` runtime import into beacon-schema/freeside-cli (G-4) — the
  JCS recipe is copied, the `SCHEMA_VERSION` is resolved via injected resolver.
- **SC-9** No sietch refactor. No touching the cluster-events go-live drill.

---

## 11. Risks & mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| **R-1** Recovered `beacon-resolve.ts` drifts from the hardened `dist` loader (silently weaker path containment) | high (security: traversal) | Lift `resolveFixturePath` **verbatim** (`..`-reject → realpath → containment); add a traversal-rejection test (`../etc/passwd` → throws) before any happy-path test |
| **R-2** Copied JCS recipe diverges from `events/jcs.ts` → sealed-hash mismatches across the cluster | high | Cross-impl identity test in `doctor.test.ts` (copied recipe output === a frozen known hash); the recipe is 3 lines + the CJS-interop cast — low surface |
| **R-3** Every live building beacon ships `0000…` placeholder hashes today → doctor will flag ALL of them `sealed_schema_hash_drift` on first run (noisy red) | medium | Expected + correct — that IS the gap doctor exists to surface. Tier-A `build:beacon` (correction 4, taught to recompute) is the remediation path; sequence mediums first to prove the receipt+hash flow before turning the cluster job to fail-block |
| **R-4** OD-1 registry `ModuleEntry` change is a contract change consumed by `loadRegistry()` across CLI verbs | medium | Additive optional fields only (`beacon_fixture` + the 3 already-in-YAML fields); existing `list`/`inspect` verbs unaffected (Effect strips→now keeps); `git revert` is clean rollback |
| **R-5** `resolvePinSchemaVersion` via `git show` requires the events history in the checkout; shallow clones (`--depth=1` in cluster-compliance) lack it | medium | doctor runs in loa-freeside's own checkout (full history). The cluster job clones *cells*, not events — events is local. Document the `SCHEMA_VERSIONS.json` offline path as the future hardening when cells need it standalone |
| **R-6** Tier-B yq/glob RED bug blocks the new `acvp-bindings` job from ever going green | medium | Fix the yq pin + glob guard in the same PR as the job addition (§8); the job is useless added to a red workflow |
| **R-7** Default-FAIL flips KF-012 + identity-api danglers to hard errors immediately on merge | low (intended) | The allowlist (§6.1) with operator-set deadlines is the honest escape; sequence the allowlist backfill (step 6) BEFORE the Tier-B fail-block (step 8) so danglers land in the allowlist before the gate bites |
| **R-8** Receipt staleness false-positives downgrade valid `bound` invariants to `aspirational` on unrelated building commits | medium (FL-B0) | Freshness is best-effort: head-unknown → no downgrade (`receipt_freshness_unconfirmed`); stale only on a positively-detected proof change; staleness never hard-errors (§4.2) |
| **R-9** A new fail-blocking contract surface lands across multiple PRs (validator → allowlist → receipts → gate) — fail-block could bite before backing exists | high (FL-B1) | Phased rollout (§8): report-only → warn+deadline → fail-block; a single named PR flips the gate, only after receipts + allowlist land |

---

## 12. Acceptance criteria (G-style — both organs)

**Organ A (doctor):**
- **G-1** doctor validates every registry module's beacon via `validateBeaconV3`;
  no module silently skipped (each yields ≥1 finding). *8/8 modules in `findings`.*
- **G-2** Invalid/placeholder `sealed_schemas.hash` DETECTED by recompute
  (JCS+sha256) → error. *bad-hash fixture → exit 1; `recomputeSealedHash` returns
  correct 64-hex.*
- **G-3** `composes_with` edges type-checked: unknown-sibling (key not a registry
  slug) + name/version/hash drift → errors (ADR-007 A.2).
- **G-4** V2 broadcasts → A.4 migration warn (not error); valid V3 passes clean.
- **G-5** `next_review` overdue → warn; `next_review − since > 180d` → error
  (injectable `now`).
- **G-6** Exit: any error → 1, else 0 (preserve `freeside-cli.ts:53-58`).
- **G-7** Deterministic: identical inputs → byte-identical report modulo
  `checked_at`.

**Organ B (ACVP validator):**
- **G-8** Every declared non-aspirational `proof_artifact` is classified into
  exactly one of: (a) locally existence-checked, (b) receipt-asserted green +
  fresh-enough, (c) dated-allowlisted aspirational, or (d) **explicitly surfaced**
  as `error`/`warn` (`proof_unverified` — un-checkable external w/o a receipt) —
  i.e. **0 SILENTLY-dangling** proofs (FL-HC2: an un-checkable proof is never
  invisible; it surfaces — it just may be a warn rather than a hard error during
  the report-only/warn rollout phases).
- **G-9** Every envelope-bound invariant-ID is bound to a building declaring
  `cluster.eventsPin` at an acvp-l1-v2 SHA (machine-checked via injected
  resolver); mismatch → error.
- **G-10** Aspirational declarations fail CI unless promotion-gated — KF-012's
  sonar danglers surface as a CI failure (or a dated allowlist entry) on the next
  sonar beacon PR. No silent third option.
- **G-11** Validator is dependency-light: `beacon-schema` dep graph unchanged
  except its own pure core (no `beacon-schema → events` import; the JCS recipe is
  copied into freeside-cli, not shared from beacon-schema).
- **G-12** `contract_status: bound` is impossible while any applicable finding is
  warn/error (the verdict-quality-floor parallel).

---

## Appendix — grounding corrections folded in (verified this session)

1. **Fixture loader lost from src** — `dist/beacon-loader.js` (hardened: `..`-reject
   + realpath + containment + try-V3-then-V2 `classifyBeacon`) has **no**
   `src/beacon-loader.ts`. Recovered into `freeside-cli/src/verbs/beacon-resolve.ts`
   (§5.1), NOT re-authored. `ModuleEntry` lacks `beacon_fixture` today (OD-1 re-adds it).
2. **`canonicalize` is NOT in beacon-schema** — its deps = `yaml` only. The JCS+sha256
   recipe lives only in `events/jcs.ts`. freeside-cli reimplements it with its own
   `canonicalize@^2` + `@noble/hashes@^1.6.0` (§3.1, §5.1) — no `beacon-schema → events`
   import (G-4). (The doctor candidate SDD's claim "canonicalize in beacon-schema already"
   was wrong; corrected here.)
3. **`registry.yaml` carries no sealed hashes** — placeholders (`0000…`) live in the
   **building beacons** (verified on sonar/auth/mediums). doctor recomputes from the
   building's local schema file; the registry only carries discovery metadata.
4. **`build-beacon-json` does NOT recompute sealed hashes** — it is schema-validate +
   YAML→JSON only (`build-beacon-json.ts:44-67`). The Tier-A `build:beacon` for mediums
   must be **taught** to recompute (§8) or emitted beacons keep `0000…` placeholders forever.
5. **`freeside-auth` beacon `sealed_schemas` point at possibly-non-existent files**
   (`identity-resolution.schema.json` / `profile-shape.schema.json`) — surfaces as
   `sealed_schema_unverified` (a separate doctor finding, NOT covered by the ACVP
   allowlist, which is `acvp_invariants`-only).
