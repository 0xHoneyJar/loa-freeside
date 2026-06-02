# Sprint Plan — Shadow-Mode Onboarding Substrate + Before/After Comparison

**Version:** 1.1 (sprint-flatline-refined — see Flatline Disposition)
**Date:** 2026-06-01
**Author:** Sprint Planner Agent
**Cycle:** `shadow-onboarding-substrate` (domain: `shared`)
**PRD Reference:** `grimoires/loa/cycles/shadow-onboarding-substrate/prd.md`
**SDD Reference:** `grimoires/loa/cycles/shadow-onboarding-substrate/sdd.md` (v1.2, sprint-flatline-refined)
**Global sprint numbering:** 401–405 (continues from ledger; `doctor-acvp-network-plane` ended at sprint-400)

> **Scope guard.** Cross-repo plan spanning THREE repos — `freeside-worlds` (substrate owner),
> `freeside-characters` (Discord I/O actor), `freeside-dashboard` (web lens). `score-api` is **NOT
> ours** (Zerker's); latent-member data is **MOCKED** for the MVP, real-data gaps tracked as GitHub
> issues (#164/#221), never built here. This plan does NOT touch top-level
> `grimoires/loa/{prd,sdd,sprint}.md` (those are `/ride` platform-as-built snapshots). Tasks that
> execute in a non-monorepo repo are tagged `[repo:freeside-worlds | freeside-characters | freeside-dashboard]`.

---

## Executive Summary

The MVP builds a **universal preview/diff primitive** ("shadow") as a pure Effect-typed substrate
owned + git-distributed by `freeside-worlds`, with thin voiceless I/O lenses in `freeside-characters`
(Discord) and `freeside-dashboard` (web, the **MVP primary render target**). The keystone is the
shadow/comparison engine (PRD R-1, WEAVER: *build it first*). MVP = role **assignment + creation +
scaffolding**, shadow-first, on **Purupuru**, with latent-member data **mocked**, and the **FR-10
authorization floor** in place before any go-live writes to a real server.

The decomposition follows the SDD §9 critical path but splits the keystone across **two** sprints so
the pure core + the `Discrepancy` read-model land **first** — early enough to visualize on mocked
data while the gated-writer / async-job machinery and the §8.4 provable-shadow proof land in the
second. Each sprint is marked as an **independently shippable** boundary.

**Total Sprints:** 5 (global 401–405), **+1 conditional** (S5/406 validation-hardening — only if live integration isn't green by S4, sprint-flatline B8)
**Sprint Duration:** ~2.5 days each (incl. ~0.5d integration buffer per sprint)
**Estimated Completion:** 2026-06-15 (+~2.5d if 406 fires)

---

## Sprint Overview

| Sprint | Global | Theme | Repo(s) | Key Deliverables | Dependencies |
|--------|--------|-------|---------|------------------|--------------|
| S0 | **401** | Keystone — pure core + `Discrepancy` | freeside-worlds | `@freeside-worlds/shadow-substrate` pkg skeleton; PURE `computeProposed`/`diff`/`roleMapVersionHash`; `transition`+guards; error ADT; `Discrepancy`/`ProposedRoster`/`CurrentRoster` schemas; ports as Tags; git-source distribution | None |
| S1 | **402** | Keystone — gate + capability + provable-shadow | freeside-worlds | `GateCheckedRoleWriter` (invocation-time mode read, audit-before-write); `WriteCapability` mint; `WriteIntentBatch` async-job model; `resolveAuthz` preflight; ACVP events; **§8.4 property test (G-3 gate)**; exported-symbol stub table | S0 (401) |
| S2 | **403** | Config surfaces + persistence + FR-10 authz | freeside-worlds | `role-map`/`apply-mode`/`onboarding-lifecycle` surfaces (per-CM composite key); FR-10 write-auth replacing the any-bearer stub; min-viable persistence contract | S1 (402) |
| S3 | **404** | Web lens — before/after comparison (MVP PRIMARY) | freeside-dashboard | Animated current→proposed comparison (motion `^12`); resumable stepper; latent-member counter (MOCKED, honest flag); `bind_map`/`go_live`/`rollback` wiring + job polling; Vercel build credential | S0 (401), S2 (403) |
| S4 | **405** | Discord Layers + Purupuru loop + E2E | freeside-characters | LIVE/MOCK `RosterSource`/`RoleWriter` Layers; cross-repo import-boundary enforcement; CV2 render; FR-9 coexistence + non-destructive rollback; `purupuru.yaml` manifest; `CONFIG_SERVICE_URL` cutover; **E2E goal validation** | S1 (402), S2 (403), S3 (404) |

> **Shippable boundaries.** S0 ships a consumable pure package (visualizable contract on mock data).
> S1 ships the provable gate (G-3 proven before any live writer exists). S2 ships persistence + the
> authz floor (no live write reachable without it). S3 ships the web payoff on mocked data
> (MVP-acceptance render). S4 ships the live Purupuru loop + E2E.
>
> **Integration buffer + minimum-shippable cut-lines (sprint-flatline B8).** Cross-repo integration
> reliably exposes contract drift, dependency gaps, CI/credential delays, and environment mismatch —
> the 5×~2.5d schedule is **optimistic** for that. Each sprint carries an explicit **~0.5d integration
> buffer** (folded into the 2.5d) and a **minimum-shippable cut-line** (the subset that MUST land for the
> next sprint to start):
>
> | Sprint | Minimum-shippable cut-line (must land) | Buffer-eligible (cut first if over) |
> |--------|----------------------------------------|-------------------------------------|
> | S0/401 | pure `computeProposed`/`diff`/`roleMapVersionHash`/`transition` + `Discrepancy` + git-SHA distribution + `substrate-sha.lock` | optional roster-fingerprint advisory polish |
> | S1/402 | `GateCheckedRoleWriter` (invocation-read + read-lock) + §8.4 property test green + per-world create lock | extended reconciliation edge cases |
> | S2/403 | FR-10 `resolveAuthz`/`resolveWriter`/`resolveReader` (≤10s TTL) + per-CM key | persistence-contract doc depth |
> | S3/404 | animated before/after on mock (managed-vs-preexisting distinction) + go-live confirm | motion polish / micro-interactions |
> | S4/405 | live Layers + cross-repo gate lint + Purupuru manifest + cutover | CV2 render polish (FR-5 second target) |
>
> **Conditional S4-E2E split (B8 — operator decision point):** if **live Discord + config-service
> integration is NOT green by the end of S4 implementation**, the **405.E2E task SPLITS into a separate
> validation-hardening sprint (S5 / global 406)** rather than rushing E2E with unvalidated gates. Ledger
> sprint registration for 406 is the operator's act; this plan only flags the trigger + the number.

---

## Sprint 401 (S0): Keystone — Pure Core + the `Discrepancy` Contract

**Repo:** `[repo:freeside-worlds]`
**Duration:** ~2.5 days
**Dates:** 2026-06-02 – 2026-06-04

### Sprint Goal
Stand up the distributed pure substrate package and land the deterministic compute core
(`computeProposed`/`diff`/`roleMapVersionHash`/`transition`) plus the `Discrepancy` read-model, so
the comparison contract exists and is consumable on mocked data before any I/O lands.

### Deliverables
- [ ] New package `@freeside-worlds/shadow-substrate` (`private: true`, git-source SHA-pinned) scaffolded with `effect ^3.10` + `@effect/schema ^0.75`, Bun, and an `index.ts` export barrel.
- [ ] PURE `computeProposed(roleMapConfig, roster) → ProposedRoster` — roster is a parameter, not a port read (SDD §4.2).
- [ ] PURE `diff(currentRoster, proposed, latentCounts) → Discrepancy` carrying `role_map_hash` (SDD §4.2/§6.4).
- [ ] PURE `roleMapVersionHash(rules) → Hex64` — sha256(JCS) over EXACTLY `{role_rules, scaffolding_config, world_config}`, reusing `packages/events` `jcsCanonicalize`+`sha256Hex`; roster **excluded** (SDD §3.3).
- [ ] PURE `transition(applyMode, event, guardInputs) → Effect<ApplyMode, GuardFailed>` over already-resolved guard inputs; no I/O (SDD §4.1/§4.2).
- [ ] Ports `RosterSource` / `RoleWriter` / `ScoreSource` as `Context.Tag`s (signatures only; impls land in S4) (SDD §4.3).
- [ ] Typed error ADT: `GuardFailed("stale_report"|"not_authorized")`, `ShadowGateRejected`, `WriteError`, `AuthzError`, `AuditError`, `RosterError`, `ScoreError` (SDD §7.1).
- [ ] Config-surface payload schemas authored in-package: `RoleMapConfig` (with `RoleRule`, `namespace_prefix`), `ApplyModeConfig`, `OnboardingLifecycle` (incl. `GoLiveJobState`) — reusing `BoundedString` (SDD §3.2).
- [ ] `Discrepancy`/`ProposedRoster`/`CurrentRoster` render-model types exported for the lens (SDD §6.4) — incl. the `managed` per-role flag + `role_count` projection (D2/D3).
- [ ] **Cross-repo version contract (B7):** canonical substrate SHA recorded in `substrate-sha.lock` + shared conformance fixture (hash + frozen schema shapes) + worlds-api CI compat check + SHA-bump rollback procedure (SDD §1.7.1); consumer-side checks in S3/S4.

### Acceptance Criteria
- [ ] `roleMapVersionHash` is **stable across roster changes** — a unit test mutating only roster metadata (member/role counts, snapshot time) produces an **identical** hash (closes IMP-001/SKP-001 flap).
- [ ] `roleMapVersionHash` is byte-deterministic across producers (matches `packages/events` JCS+sha256 output for the same input).
- [ ] `transition` exhaustively tested over the finite event set; illegal transitions fail loud as typed `GuardFailed` (`go_live` with mismatched `report_hash` → `GuardFailed("stale_report")`).
- [ ] `diff` produces a `Discrepancy` whose AFTER marks `created: true` on not-yet-created roles and BEFORE omits them (SDD §6.4 / OQ-3 proposed shape).
- [ ] The pure functions take data and return data — `bun test` runs them with **no Layers / no mocks** (SDD §8.2).
- [ ] Package installs into a consumer via bun git-tarball SHA pin (distribution smoke test).

### Technical Tasks
- [ ] Task 401.1: Scaffold `@freeside-worlds/shadow-substrate` (`private:true`, git-source) with effect/@effect/schema deps, `index.ts` barrel, bun test harness. `[repo:freeside-worlds]` → **[G-4]**
- [ ] Task 401.2: Author the error ADT + config-surface schemas (`RoleMapConfig`/`RoleRule`/`ApplyModeConfig`/`OnboardingLifecycle`/`GoLiveJobState`) reusing `BoundedString`. `[repo:freeside-worlds]` → **[G-4, G-5]**
- [ ] Task 401.3: Implement PURE `roleMapVersionHash` (rules-only, JCS+sha256 via events pkg) + flap-resistance + cross-producer determinism tests. `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 401.4: Implement PURE `computeProposed` + `diff` → `Discrepancy` (created-role marking; latent counts as data param). `[repo:freeside-worlds]` → **[G-2, G-5]**
- [ ] Task 401.5: Implement PURE `transition` + guards (HARD hash-match `go_live`, always-allowed `rollback`, soft-soak advisory only); exhaustive state-machine tests. `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 401.6: Declare ports (`RosterSource`/`RoleWriter`/`ScoreSource`) as `Context.Tag`s (signatures); export `Discrepancy`/`ProposedRoster`/`CurrentRoster` render-model types. `[repo:freeside-worlds]` → **[G-4]**
- [ ] Task 401.7: Distribution smoke test — pin the package by git SHA in a throwaway consumer, import the pure exports, run a `diff` on a fixture. `[repo:freeside-worlds]` → **[G-4]**
- [ ] Task 401.8: **Cross-repo version contract (B7) — substrate side.** Record the canonical substrate git SHA in `grimoires/loa/cycles/shadow-onboarding-substrate/substrate-sha.lock` (single source of truth) + author the shared **conformance fixture** (canonical `roleMapVersionHash` input/output + frozen `Discrepancy`/`AuthzContext`/`WriteCapability` shapes) all three consumers assert identical; add the worlds-api CI compat check (lockfile SHA == canonical) + document the SHA-bump rollback procedure (SDD §1.7.1). Consumer-side CI checks land in 404/405. `[repo:freeside-worlds]` → **[G-4]**

### Dependencies
- None (first sprint — the keystone, per PRD R-1).

### Security Considerations
- **Trust boundaries:** the pure core touches no external input directly; config-surface schemas inherit `BoundedString` (length-capped, control-byte/zero-width-rejecting) so downstream write-side input is hardened at the contract layer.
- **External dependencies:** `effect ^3.10`, `@effect/schema ^0.75` (cluster-standard, already in `config-protocol`); in-repo `packages/events` for JCS+sha256. No net-new third-party deps this sprint.
- **Sensitive data:** none — pure functions, no I/O, no credentials.

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-1 Empty centerpiece (diff engine) | Med | High | This sprint **is** the keystone; pure substrate is highest-confidence build |
| Version-hash flaps between bind/go_live | Med | High | Rules-only hash (SDD §3.3); flap-resistance acceptance test |

### Success Metrics
- 100% of the 4 pure functions covered by data-in/data-out unit tests (no mocks).
- `roleMapVersionHash` flap-resistance test green (hash identical across roster mutation).
- Package importable + `diff` runs in a SHA-pinned consumer (distribution proven).

---

## Sprint 402 (S1): Keystone — The Provable Gate, Capability, and Async-Job Writer

**Repo:** `[repo:freeside-worlds]`
**Duration:** ~2.5 days
**Dates:** 2026-06-05 – 2026-06-07

### Sprint Goal
Land the gate-checked writer, the unforgeable `WriteCapability`, the async write-batch model, the
authz preflight, the ACVP audit events, and **the §8.4 provable-shadow property test** — proving
"SHADOW ⇒ zero writes" before any concrete live writer exists.

### Deliverables
- [ ] `GateCheckedRoleWriter` wrapper: reads `apply_mode` **at invocation** via a `Ref<ApplyMode>` (never captured at Layer-build), rejects all writes under SHADOW emitting `shadow.role.rejected.v1` (SDD §4.4.0/§4.4.3).
- [ ] **Audit-before-write** (strong consistency): `shadow.role.intent.v1` confirmed BEFORE the inner write; emit failure ⇒ `WriteError("audit_unavailable")`, write does NOT run (SDD §4.4.2/§6.3).
- [ ] Branded `WriteCapability` token minted ONLY on an authorized SHADOW→LIVE transition (constructor NOT exported); LIVE writer signatures require it as a **compile-time** gate. **B9 reframe:** the capability prevents accidents; the *enforced* security boundary is `GateCheckedRoleWriter` + server-side authz + write-after-audit, not token unforgeability (SDD §4.4.4). Token carries `authz_decision_id` (B3).
- [ ] `WriteIntentBatch` async-job model: stable `op_id` + `idempotency_key`, check-then-create **serialized per world via a world-scoped advisory lock (B10 TOCTOU fix)**, `roles_created` ledger, 429 backoff+jitter, `max_concurrent` cap (intra-batch only), per-op status, partial-failure reconciliation (SDD §4.4.1).
- [ ] EFFECTFUL `resolveAuthz(actor, world)` service preflight (resolves admin-allowlist via manifest read); result passed as a guard input into pure `transition` — NOT inside it (SDD §4.2/§4.4, design decision §13.2.2).
- [ ] EFFECTFUL `loadCurrentRoster` / `loadLatentCounts` programs requiring their ports (SDD §4.2).
- [ ] `AuthzContext` write-batch binding (`{actor, world, report_hash, token_metadata, transition_version, authz_decision_id, roster_version}`) validated current + hash-matched + decision-id-matched before any write (SDD §6.2, confused-deputy guard + B1 roster-freshness + B3 decision binding).
- [ ] **Roster-freshness re-eval at go_live (B1):** `go_live` recomputes the roster fingerprint and `GuardFailed("roster_drift")`s if newly-qualifying members exceed the threshold (default 0) — separate from the rules-hash guard (SDD §3.3/§4.1/§6.2).
- [ ] ACVP event families registered in `packages/events` registry: `shadow.role.{rejected,intent,applied}.v1`, `shadow.mode.transitioned.v1`, `shadow.authz.decided.v1` (SDD §6.3).
- [ ] Exported-symbol stub table in `index.ts` with PURE/EFFECTFUL markings (SDD §4.6); NO raw live-writer export, NO `WriteCapability` constructor export.

### Acceptance Criteria
- [ ] **§8.4 property test (the G-3 acceptance gate):** `@effect/vitest` + `fast-check`, seq 0–32 events, 1–50 ops/batch, `numRuns ≥ 1000` (CI) / `≥ 200` (pre-commit). For every sequence without a successful `go_live`, the inner writer is invoked **zero** times AND a confirmed `shadow.role.rejected.v1` is emitted per attempted write.
- [ ] Counterexamples proven un-writable: stale `report_hash`; non-allowlisted actor; forged/absent `WriteCapability`; batch `authz.report_hash` ≠ minting transition's hash; batch `authz.authz_decision_id` ≠ capability's (replay against a different/revoked decision, B3); write after a `rollback` re-flipped to SHADOW mid-job.
- [ ] **Roster-drift guard proven (B1):** a `go_live` whose roster drifted by > threshold new qualifying members since report-gen → `GuardFailed("roster_drift")` (re-preview forced), distinct from `stale_report`.
- [ ] **Audit-under-NATS-failure test:** injecting an emitter that fails the intent emit ⇒ inner writer invoked **zero** times, result `WriteError("audit_unavailable")` (SDD §8.4 proof 3).
- [ ] **Reachability test:** package exports contain no un-gated live-writer symbol and no token constructor (SDD §8.4 proof 1).
- [ ] `apply_mode` read-at-invocation proven: a transition flipping the `Ref` to LIVE after Layer provision makes the next `applyBatch` write (no stale SHADOW capture) (SDD §4.4.0 / R-10).
- [ ] **Inverse mode-race proven (B5):** flip the `Ref` to SHADOW (rollback) after a write is dispatched but before the batch terminates → the mode-read-lock serializes the transition to the batch boundary; no write executes under a SHADOW-flipped mode mid-batch (SDD §4.4.0/§4.5).
- [ ] Idempotent create/assign proven: a retried batch re-runs only `pending`/`failed` ops by `idempotency_key`; already-`ok` ops skipped; no double-create (SDD §4.4.1).
- [ ] **Concurrent-batch create race proven safe (B10):** two simultaneous batches targeting the same world/guild → the advisory lock serializes the create span; assert **exactly one** role is created (no duplicate snowflake), the second observes the role present (SDD §4.4.1).

### Technical Tasks
- [ ] Task 402.1: Implement `Ref<ApplyMode>` mechanism (seeded from config surface, updated on `mode.transitioned`) + `GateCheckedRoleWriter` invocation-time read. **B5:** hold a **read-lock on the mode `Ref` for the batch duration** so a concurrent `rollback` (LIVE→SHADOW) cannot interleave mid-batch — the transition is serialized to a batch boundary, never executing a write during a SHADOW window (SDD §4.4.0/§4.5). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.2: Implement audit-before-write emit sequence (`intent` confirmed → write → `applied`; rejection confirmed before SHADOW fail) with `audit_unavailable` fail-loud. `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.3: Implement branded `WriteCapability` as a **compile-time accident-prevention seam** (un-exported constructor, minted only on authorized LIVE transition; required on LIVE `RoleWriter` signatures so a forgotten gate fails to type-check) — NOT a runtime security primitive. Add code comments (on the type + `GateCheckedRoleWriter`) stating the enforced boundary is the gate + server-side authz + write-after-audit, per the B9 reframe (SDD §4.4.4/§1.9). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.4: Implement `WriteIntentBatch` async job — op_ids, idempotency keys, check-then-create, `roles_created` ledger, 429 backoff+jitter, `max_concurrent`, per-op status, reconciliation. **B10:** serialize check-then-create per world via a **world-scoped advisory lock** (Postgres advisory lock keyed on `world_slug`, Redis SETNX / per-world queue fallback) wrapping the create span — `max_concurrent` is intra-batch only and does NOT prevent same-world cross-batch races (SDD §4.4.1). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.5: Implement EFFECTFUL `resolveAuthz` preflight + `AuthzContext` batch binding (current + hash-matched validation + `authz_decision_id` binding, B3). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.9: Implement the **roster-freshness re-evaluation at `go_live`** (B1) — populate `AuthzContext.roster_version` (non-timestamped fingerprint + base count) at report-gen; at `go_live` recompute the fingerprint and `GuardFailed("roster_drift")` when newly-qualifying members exceed `ROSTER_DRIFT_THRESHOLD` (default 0), separate from the rules-hash guard (SDD §3.3/§4.1/§6.2). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.6: Implement EFFECTFUL `loadCurrentRoster` / `loadLatentCounts` (require ports). `[repo:freeside-worlds]` → **[G-2]**
- [ ] Task 402.7: Register `shadow.*` ACVP event families + payload schemas in `packages/events` registry; envelope `acvp-l1-v2`. `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 402.8: Write the §8.4 proofs (property test + audit-under-NATS-failure + reachability) and the exported-symbol stub table. `[repo:freeside-worlds]` → **[G-3]**

### Dependencies
- Sprint 401: the pure core, ports, error ADT, config schemas, `Discrepancy`.

### Security Considerations
- **Trust boundaries:** the two-gate invariant (state gate in substrate + actor gate via `resolveAuthz`) lives here. **B9 reframe (DESIGN CALL):** the enforced boundary is `GateCheckedRoleWriter` (invocation-time `apply_mode` read + server-side `AuthzContext`/`admin_principals` check + write-after-audit); `WriteCapability` is a compile-time accident-prevention layer on top, not an unforgeable runtime secret (SDD §4.4.4). `AuthzContext` binding (now carrying `authz_decision_id`, B3) closes the confused-deputy (B14): a one-time LIVE flip cannot authorize unbound later writes, and a batch cannot be replayed against a different/revoked authz decision.
- **External dependencies:** in-repo `packages/events` (ACVP envelope + registry). No net-new third-party deps.
- **Sensitive data:** ACVP envelopes are signed + hash-chained; the audit trail makes "SHADOW ⇒ zero writes" provable from the trace. No secrets handled in the substrate (authz tokens are verified in S2's config-service, not here).

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-10 apply_mode captured at Layer-build ⇒ go-live no-ops | High | High | Read at invocation via `Ref`/seam (SDD §4.4.0); explicit test |
| R-11 NATS down ⇒ un-audited LIVE write | Med | High | Write-after-audit (SDD §4.4.2); audit-under-failure test |
| R-12 Confused-deputy (flip-once-write-later) | Med | High | `AuthzContext` batch binding validated before write (SDD §6.2) |
| R-9 LIVE apply rate-limited / partial-failure | High | High | Async-job batch model: idempotency, 429 backoff, reconciliation (SDD §4.4.1) |

### Success Metrics
- §8.4 property test green at `numRuns ≥ 1000` — **the G-3 acceptance gate passes**.
- Zero exported symbols expose a raw live-writer path or token constructor (reachability test).
- Audit-under-NATS-failure: 0 inner-writer invocations on emit failure.

---

## Sprint 403 (S2): Config Surfaces, Persistence + the FR-10 Authorization Floor

**Repo:** `[repo:freeside-worlds]`
**Duration:** ~2.5 days
**Dates:** 2026-06-08 – 2026-06-10

### Sprint Goal
Wire the three config surfaces through the existing config seam with the per-CM lifecycle key, and
replace the any-bearer write-auth stub with CM-identity-scoped authorization — closing the R-3 hole
before any go-live can write to a real server.

### Deliverables
- [ ] `role-map`, `apply-mode`, `onboarding-lifecycle` surfaces added to `config-protocol/surface-config.ts` (extend `SurfaceSchema`/`SurfaceConfigMap`/`KNOWN_SURFACES`), preserving BLOCKER-1 `BoundedString` hardening (SDD §3.2).
- [ ] `onboarding-lifecycle` keyed by composite `(world_slug, surface, cm_identity_id)`; config-engine store key extended for this surface only; `role-map`/`apply-mode` stay per-`(world, surface)` (SDD §3.1/§6.1).
- [ ] **FR-10 write-auth (C3) via ONE authoritative `resolveAuthz` (B3/B4):** verify identity-api token (jwks-validator pattern), assert `claims.sub ∈ world.admin_principals` (manifest field, TTL-cached **≤10s**, B6), else 403; emit `shadow.authz.decided.v1` with a stable `authz_decision_id`; **go_live confirm re-checks authz freshly bypassing cache** (B6 DESIGN CALL) (SDD §6.2).
- [ ] **`resolveReader` on the GET path (B4):** the config read path also calls `resolveAuthz` so a revoked admin loses READ access within the ≤10s TTL — identity-verified-but-deauthorized reads are 403'd (`cm == claims.sub` is isolation, not authority) (SDD §6.1).
- [ ] Per-CM read/write isolation: a CM may only read/write their OWN lifecycle record (`cm` query param MUST match `claims.sub`) (SDD §6.1).
- [ ] Min-viable persistence contract verified (state-record shape + version) so config-service is not a hidden late-failing dep (NFR-6).
- [ ] Circularity guard: config-service does NOT authorize writes to the allowlist itself (allowlist lives in the manifest, never a config surface) (SDD §1.9/§6.2 SKP-007).

### Acceptance Criteria
- [ ] New surfaces round-trip through the config seam (GET/PUT) with optimistic-lock version; `verify-message` precedent preserved (additive, no schema migration).
- [ ] `onboarding-lifecycle`: two CMs onboarding the same world get **two distinct records** — neither overwrites the other (SDD §3.1 B1/SKP-006); a CM cannot read another CM's record (`cm` ≠ `claims.sub` → 403).
- [ ] FR-10: a PUT with a valid token whose `claims.sub` is NOT in `admin_principals` → **403** (not accepted as before); an allowlisted CM → 200. Both decisions emit `shadow.authz.decided.v1` (with `authz_decision_id`).
- [ ] **Read-path authority (B4):** a GET by a now-revoked admin → **403** within the ≤10s TTL (revoked admins lose READ, not just write); `resolveReader` shares the `resolveAuthz` flow.
- [ ] **Revocation during in-progress onboarding (B3/B4):** revoke the actor mid-flow → subsequent reads AND writes denied; a batch bound to the old `authz_decision_id` cannot replay against a new/revoked decision.
- [ ] **TTL + go_live freshness (B6 DESIGN CALL):** cache TTL ≤10s; the `go_live` confirm performs a fresh (uncached) `resolveAuthz`.
- [ ] 409 (version conflict), 422 (`BoundedString` violation), 404 (default → `apply_mode=SHADOW`) paths verified (SDD §7.2).
- [ ] Integration tests pass against an in-memory `ConfigStore` (SDD §8.1).

### Technical Tasks
- [ ] Task 403.1: Add the three surfaces to `config-protocol` (`SurfaceSchema`/`SurfaceConfigMap`/`KNOWN_SURFACES`), reusing in-package schemas from S0. **D1:** keep the dependency arrow one-way `shadow-substrate → config-protocol` for `BoundedString` (config-protocol owns it) — re-export the substrate's payload schemas INTO config-protocol; verify no reverse import to avoid a day-one circular dep (SDD §1.4). `[repo:freeside-worlds]` → **[G-1, G-4]**
- [ ] Task 403.2: Extend config-engine store key to the composite `(world, surface, cm_identity_id)` for `onboarding-lifecycle` only; preserve head-pointer + immutable history. `[repo:freeside-worlds]` → **[G-1]**
- [ ] Task 403.3: Implement the **ONE authoritative `resolveAuthz`** decision flow (token verify + `admin_principals` manifest check + `authz_decision_id` + `shadow.authz.decided.v1` emit) backing `resolveWriter`; **B6 DESIGN CALL:** cache TTL **≤10s** (not 60s), and the `go_live` confirm path re-checks authz **freshly** (bypassing cache). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 403.4: Enforce per-CM lifecycle read/write isolation (`cm` query param == `claims.sub`). `[repo:freeside-worlds]` → **[G-1, G-3]**
- [ ] Task 403.5: Integration tests — surface round-trip, 409/403/422/404 paths, per-CM isolation, two-CM non-collision (in-memory ConfigStore). `[repo:freeside-worlds]` → **[G-1, G-3]**
- [ ] Task 403.7: Add **`resolveReader`** on the config GET path wrapping the unified `resolveAuthz` (B4 — a revoked admin loses READ access within the ≤10s TTL, not only write) + a **revocation-during-in-progress-onboarding test**: revoke the actor mid-flow, assert subsequent reads AND writes are denied (SDD §6.1/§6.2). `[repo:freeside-worlds]` → **[G-3]**
- [ ] Task 403.6: Verify + document the min-viable persistence contract (record shape + version) so config-service is not a late-failing dep. **D4:** add a **deployed-config-service smoke test** (hit the live service: new-surface GET/PUT + FR-10 token-format + routing) to catch deploy-time mismatches the in-memory ConfigStore tests can't (SDD §1.7). `[repo:freeside-worlds]` → **[G-1]**

### Dependencies
- Sprint 402: config-surface schemas + ACVP `shadow.authz.decided.v1` event.
- External: identity-api token verification (`@freeside-auth/adapters` jwks-validator pattern) — LIVE.

### Security Considerations
- **Trust boundaries:** this sprint closes R-3 — the highest-severity (High/High) risk. The any-bearer stub is replaced with CM-identity-scoped authz via **one authoritative `resolveAuthz`** backing both `resolveWriter` and `resolveReader` (B3/B4); the allowlist lives in the deploy-bound manifest (not a config surface) so the write path can never self-grant. Tokens are verified, not trusted verbatim. **B6 DESIGN CALL:** the cache TTL is ≤10s (bounding the stale-grant window for read AND write) and the `go_live` confirm re-checks authz freshly bypassing the cache, so the highest-risk write is never gated on a cached grant. Revocation (read + write) takes effect within the ≤10s window.
- **External dependencies:** identity-api jwks-validator (existing pattern); no net-new third-party deps.
- **Sensitive data:** identity-api session/svc tokens — verified via JWKS, never logged; the actor (`claims.sub`) is recorded in the audit event but the token is not.

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-3 config-seam accepts any bearer | High | High | FR-10 floor (C3) — admin allowlist + identity-scoped token; **mandatory MVP** |
| R-14 Two CMs overwrite lifecycle state | Med | Med | Per-CM composite key (SDD §3.1 B1); two-CM non-collision test |

### Success Metrics
- 0 unauthorized writes accepted — every PUT requires `claims.sub ∈ admin_principals` (FR-10 floor live).
- 100% of config-seam error paths (401/403/409/422/404) covered by integration tests.
- Two-CM lifecycle isolation proven (no cross-CM leak/overwrite).

---

## Sprint 404 (S3): Web Lens — The Before/After Comparison (MVP PRIMARY)

**Repo:** `[repo:freeside-dashboard]`
**Duration:** ~2 days
**Dates:** 2026-06-11 – 2026-06-12

### Sprint Goal
Render the substrate's `Discrepancy` as an animated current→proposed comparison with mocked
latent-member counts, plus the resumable cross-medium stepper and the go-live/rollback UI — the
MVP-acceptance render target, runnable on mock data.

### Deliverables
- [ ] Net-new motion dep pinned to **`^12`** (NOT `latest`; verified against Next 16 / React 19) (SDD §2.3 REFINEMENT C).
- [ ] **Before/After comparison component:** animated current roles → proposed roles + latent-member counter, consuming the `Discrepancy` read-model; AFTER marks created roles, BEFORE omits them; **distinguishes managed vs pre-existing/Collab.Land roles (D2 — pre-existing NEVER shown as "would change")** + surfaces the projected 250-role overage predictively (D3) (SDD §5.1/§6.4).
- [ ] Latent-member counter renders the MOCKED `latent_qualified` with an **honest `source:"MOCK"`** flag visible (SDD §8.5 / FR-6).
- [ ] Resumable onboarding stepper keyed by per-CM composite `(world, surface, cm_identity_id)`; link/unlinked/degraded states surfaced (resume banner) (SDD §5.3/§3.4 / FR-2/HC6).
- [ ] Go-live confirm view: hash-match status + authz status + soak advisory (SDD §5.3).
- [ ] `bind_map`/`go_live`/`rollback` events fired through the substrate; config-seam persistence; `go_live` returns a `job_id` and the lens **polls** `onboarding-lifecycle.go_live_job` for progress (SDD §1.5/§9 Phase-3).
- [ ] **Vercel build credential** (`GITHUB_TOKEN`/deploy-key, repo-scoped read to `freeside-worlds`) provisioned for the private git-tarball substrate dep, BEFORE deploy (SDD §1.7 REFINEMENT A — hard build blocker if omitted).
- [ ] `RosterSource` MOCK Layer (shadow) supplied by the dashboard (SDD §1.3 C5).

### Acceptance Criteria
- [ ] CM sees an **animated** before→after render (web DOM) of current roles → proposed + latent counts — the FR-5 "animated" requirement met (MVP-acceptance render target).
- [ ] **Managed vs pre-existing distinction (D2):** Freeside-managed roles render with change affordances; pre-existing/Collab.Land roles render as untouched/locked context and are NEVER shown as "would change"/"would be created".
- [ ] **Predictive 250-limit (D3):** a proposed set that would exceed 250 roles surfaces the projected total + overage in the preview (before go_live).
- [ ] Latent-member numbers display with a visible `MOCK` provenance flag; `latent_qualified.source == "MOCK"` (SDD §8.5).
- [ ] A CM who starts on web and switches medium resumes at the persisted `step` (FR-2); unlinked → "link your identity" block; degraded → recoverable banner (no silent fork) (§3.4).
- [ ] `go_live` returns a `job_id`; the lens polls and renders `{status, progress, roles_created[]}` until terminal (`done|partial_failure|failed`) (SDD §1.5).
- [ ] Dashboard Vercel build resolves the private SHA-pinned substrate tarball (credential proven) — build green.
- [ ] No onboarding logic in the lens — it renders substrate read-models + fires events only (G-4 voiceless-actor check).

### Technical Tasks
- [ ] Task 404.1: Provision the Vercel `GITHUB_TOKEN`/deploy-key build credential + pin `@freeside-worlds/shadow-substrate` by git SHA; verify build resolves the private tarball. **B7:** add the dashboard CI compat check (lockfile SHA == cycle canonical `substrate-sha.lock`) + run the shared conformance fixture (SDD §1.7.1). `[repo:freeside-dashboard]` → **[G-4]**
- [ ] Task 404.2: Add motion `^12`; build the animated before/after comparison component consuming `Discrepancy` (created/removed/added role motion). **D2:** visually distinguish Freeside-MANAGED roles (`managed:true` — active diff styling) from pre-existing/Collab.Land roles (`managed:false` — dimmed/locked context, NEVER shown as "would change"). **D3:** surface the projected 250-role total + overage predictively from `role_count` (SDD §5.1/§6.4). `[repo:freeside-dashboard]` → **[G-2]**
- [ ] Task 404.3: Build the latent-member counter with honest `MOCK` provenance flag. `[repo:freeside-dashboard]` → **[G-2]**
- [ ] Task 404.4: Build the resumable onboarding stepper keyed by per-CM composite; resume banner + unlinked/degraded states. `[repo:freeside-dashboard]` → **[G-1]**
- [ ] Task 404.5: Build the go-live confirm view (hash-match + authz + soft-soak advisory). `[repo:freeside-dashboard]` → **[G-3]**
- [ ] Task 404.6: Wire `bind_map`/`go_live`/`rollback` through the substrate + config-seam persistence; implement the `job_id` poll loop on `onboarding-lifecycle.go_live_job`. `[repo:freeside-dashboard]` → **[G-1, G-2, G-3]**
- [ ] Task 404.7: Supply the `RosterSource` MOCK Layer (shadow) in the dashboard. `[repo:freeside-dashboard]` → **[G-2, G-4]**

### Dependencies
- Sprint 401: the `Discrepancy` contract + pure core (the lens can build on mock as soon as this exists).
- Sprint 403: the config surfaces (persist `bind_map`/lifecycle) + FR-10 authz (go-live confirm reflects authz status).

### Security Considerations
- **Trust boundaries:** the lens is a voiceless actor — it fires events and renders read-models; it holds no onboarding logic and no gate. The two gates remain substrate-side. Per-CM lifecycle isolation is enforced server-side (S2), not in the lens.
- **External dependencies:** net-new motion `^12` (pinned, scoped to the comparison component, SDD R-8). The private substrate tarball requires a repo-scoped read credential on Vercel — a build secret, not a runtime secret.
- **Sensitive data:** the dashboard carries the CM's identity-api session token for FR-10 authz; the build credential (`GITHUB_TOKEN`) is a Vercel build-env secret, never bundled into client output.

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-15 Private git-tarball blocks Vercel build | Med | Med | Provision `GITHUB_TOKEN`/deploy-key BEFORE deploy (SDD §1.7); Task 404.1 first |
| R-8 Motion is a net-new dashboard dep | Low | Low | Single dep, pinned `^12`, scoped to comparison component |

### Success Metrics
- Animated before/after renders on mocked data (MVP-acceptance render target achieved, FR-5).
- Latent-member `MOCK` provenance flag present + honest (G-2 mocked-data acceptance, FL-HC1).
- Cross-medium resume works (web → persisted `step`) (G-1).

---

## Sprint 405 (S4): Discord Lens Layers, the Purupuru Loop + E2E Validation

**Repo:** `[repo:freeside-characters]` (+ Purupuru manifest in `freeside-worlds`)
**Duration:** ~2.5 days
**Dates:** 2026-06-13 – 2026-06-15

### Sprint Goal
Supply the live/mock Discord I/O Layers with cross-repo gate enforcement, provision Purupuru, cut
over config-service for apply, render the second (CV2) target, and run the full E2E goal validation.

### Deliverables
- [ ] LIVE + MOCK `RosterSource` Layers (`GET guild-roles`/members; mock returns fixtures, zero Discord calls) following the `persona-engine ambient/{ports,mock,live}` idiom (SDD §1.3 C4/§4.5).
- [ ] LIVE + MOCK `RoleWriter` Layers — LIVE requires a `WriteCapability` arg, does check-then-create / idempotent assign / 429 backoff; MOCK captures write-intent only (SDD §4.5).
- [ ] **Cross-repo import-boundary enforcement:** static lint (`no-restricted-syntax` forbidding `discord.js` role-mutation outside the single gated adapter) + integration tests proving no un-gated live-writer path — a raw `guild.roles.create`/assign outside the adapter is a CI failure (SDD §8.4 proof 4 / §4.4.4).
- [ ] FR-9: namespaced-role-set coexistence (Freeside-prefixed ids OR explicit handoff, never silent contention) + rollback that is **non-destructive for ASSIGNED roles** (halt assignments, KEEP roles with users, warn) but **GCs created-but-UNASSIGNED Freeside roles (B2)** + a **pre-go_live 250-role quota check (D3)**; `roles_created` ledger distinguishes Freeside-created from pre-existing (SDD §1.5/§4.4.1 / R-6/R-16).
- [ ] Discord CV2 render of the same `Discrepancy` (the medium-agnostic proof; second target) (SDD §1.3 C6/§5.1).
- [ ] **Purupuru precondition:** `purupuru.yaml` world manifest created in `packages/registry/worlds/` with guild id, NFT contracts, member set, and **`admin_principals: [identity_id,...]`** (FR-10 allowlist) (SDD §1.7/§9 Phase-4 / R-7).
- [ ] `CONFIG_SERVICE_URL` cutover for **apply** (shadow-preview already runs on mock) (SDD §9 Phase-4 / NFR-6).
- [ ] Cross-repo issue flags (NOT built): score-api #221 (Purupuru-scoped wallet→score→tier) context comment; #164 (already commented 2026-06-01) tracked (PRD §7 / SDD §9).

### Acceptance Criteria
- [ ] A raw `discord.js` role-mutation outside the gated adapter **fails CI** (lint + integration test) — the gate survives the repo boundary (SDD §8.4 proof 4 / CLUSTER 7).
- [ ] LIVE `RoleWriter` cannot write without a `WriteCapability`; idempotent create/assign proven against a real (or recorded) guild; 429 → backoff, not rollback (SDD §4.4.1).
- [ ] FR-9 coexistence: Freeside touches only namespaced roles; rollback **keeps ASSIGNED roles + warns** but **GCs created-but-UNASSIGNED Freeside roles (B2)**; `roles_created` ledger identifies Freeside-created roles (R-6).
- [ ] **Role-count quota (D3/B2):** a go_live whose `(existing + to-create)` would exceed 250 is **refused** with a clear limit error before any write; repeated go_live/rollback cycles do not accumulate orphan empty roles (GC verified).
- [ ] The same `Discrepancy` renders as a Discord CV2 message (medium-agnosticism proven; G-5).
- [ ] `purupuru.yaml` exists with `admin_principals`, guild id, NFT contracts; FR-10 authz resolves against it.
- [ ] `CONFIG_SERVICE_URL` cutover complete — apply/persist hits the live config-service (NFR-6).

### Task 405.E2E: End-to-End Goal Validation

**Priority:** P0 (Must Complete)
**Goal Contribution:** All goals (G-1, G-2, G-3, G-4, G-5, G-6)

**Description:** Validate every PRD goal end-to-end through the complete Purupuru loop — web-or-Discord
entry, cross-medium resume, animated before/after on mocked latent data, zero unintended writes in
shadow, and a gated go-live.

**Validation Steps:**

| Goal ID | Goal | Validation Action | Expected Result |
|---------|------|-------------------|-----------------|
| G-1 | Medium-agnostic, resumable entry | Start onboarding on web, switch to Discord invite mid-flow | Resumes at the persisted `step` keyed by `(cm_identity × world)` |
| G-2 | Before/after comparison is real | View the comparison on Purupuru with mocked latent data | Animated current→proposed + latent counts render; `source:"MOCK"` flag honest (real-data = separate Phase-2 gate, FL-HC1) |
| G-3 | Shadow-first is provable | Run the §8.4 property test + attempt a SHADOW-mode write | 0 Discord writes/creates under SHADOW; `shadow.role.rejected.v1` audited; property test green |
| G-4 | worlds-api owns + distributes | Inspect the lenses for onboarding logic; confirm substrate consumed via git SHA | Lenses hold no onboarding logic; substrate is git-source SHA-pinned |
| G-5 | Feature-agnostic substrate | Render the same `Discrepancy` in both web DOM and Discord CV2 | Both render from one contract; no substrate change needed per medium |
| G-6 | 1→2 scale | Run the loop on Purupuru | Purupuru manifest provisioned; loop runs on the test ground |

**Acceptance Criteria:**
- [ ] Each goal validated with documented evidence (audit trail + property-test output + screenshots).
- [ ] Integration points verified (web entry → config seam → substrate → Discord write, end-to-end).
- [ ] No goal marked "not achieved" without explicit justification (G-2 real-data is explicitly a separate Phase-2 gate, not a failure).
- [ ] Zero unintended role writes in shadow across the full loop (G-3 primary success).

### Technical Tasks
- [ ] Task 405.1: Implement LIVE + MOCK `RosterSource` Layers (persona-engine idiom). **B7:** add the characters CI compat check (lockfile SHA == cycle canonical `substrate-sha.lock`) + run the shared conformance fixture (SDD §1.7.1). `[repo:freeside-characters]` → **[G-4, G-5]**
- [ ] Task 405.2: Implement LIVE + MOCK `RoleWriter` Layers — LIVE requires `WriteCapability`, check-then-create, idempotent assign, 429 backoff; MOCK captures intent only. `[repo:freeside-characters]` → **[G-3, G-4]**
- [ ] Task 405.3: Add cross-repo import-boundary enforcement — `no-restricted-syntax` lint + integration tests proving no un-gated live-writer path. **D5:** document the lint's **known limits** (does NOT catch dynamic `await import()`, indirect/aliased refs, reflection) alongside the rule — it is accident-prevention, not airtight; the integration tests + runtime gate are the stronger checks (ties to B9, SDD §8.4 proof 4). `[repo:freeside-characters]` → **[G-3]**
- [ ] Task 405.4: Implement FR-9 namespaced-role coexistence + rollback: **non-destructive for ASSIGNED roles (keep, warn)** but **GC created-but-UNASSIGNED Freeside-namespaced roles (B2)** so empty orphans don't accumulate toward Discord's 250-role ceiling; use `roles_created` ledger to distinguish Freeside-created from pre-existing. Add the **pre-go_live role-count quota check** `(existing + to-create) ≤ 250` with a clear refusal (D3/SDD §4.4.1). `[repo:freeside-characters]` → **[G-3]**
- [ ] Task 405.5: Implement the Discord CV2 render of the same `Discrepancy` (second target). `[repo:freeside-characters]` → **[G-5]**
- [ ] Task 405.6: Create `purupuru.yaml` manifest (guild id, NFT contracts, member set, `admin_principals`). `[repo:freeside-worlds]` → **[G-6]**
- [ ] Task 405.7: `CONFIG_SERVICE_URL` cutover for apply/persist — **run the deployed-config-service smoke test (D4) BEFORE the cutover** (routing/schema/token-format against live env). `[repo:freeside-characters]` → **[G-6]**
- [ ] Task 405.8: File/track cross-repo score-api context comments (#221, #164) — NOT built, flag only. `[repo:freeside-characters]` (issue tracking) → **[G-2]**
- [ ] Task 405.E2E: End-to-end goal validation on Purupuru (above). `[repo:all]` → **[G-1..G-6]**

### Dependencies
- Sprint 402: the `GateCheckedRoleWriter`, `WriteCapability`, async-job model, ACVP events.
- Sprint 403: config surfaces + FR-10 authz + the `admin_principals` read path.
- Sprint 404: the web lens (E2E entry surface).
- External: Discord API (the bot's existing discord.js client); Purupuru guild id + NFT contracts + member set (operator precondition, PRD §7); identity-api (FR-2/FR-10) — LIVE.

### Security Considerations
- **Trust boundaries:** this is where the LIVE writer becomes reachable. The branded `WriteCapability` + cross-repo import-boundary lint + integration tests ensure a raw `discord.js` call cannot bypass the substrate gate even from another repo. FR-9 coexistence prevents silent contention with Collab.Land.
- **External dependencies:** discord.js (existing bot client). Purupuru manifest carries `admin_principals` (the FR-10 allowlist) — bootstrap authority is the operator who commits the manifest.
- **Sensitive data:** the bot's Discord token (existing, scoped); `CONFIG_SERVICE_URL` + service token for apply/persist. No score-api credentials (latent data mocked).

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-13 Raw discord.js bypasses the gate across repos | Med | High | Branded `WriteCapability` + import-boundary lint + cross-repo integration tests (SDD §8.4 proof 4) |
| R-6 Scaffolded-role rollback strips user roles | Med | High | Non-destructive default (keep roles, warn); `roles_created` ledger; destructive teardown is explicit + separate |
| R-7 Purupuru not provisioned (no manifest) | High | Med | Phase-4 precondition (Task 405.6); documented assumptions, not assumed |
| R-2 Latent-member data depends on score-api (not ours) | High | Med | MOCKED for MVP (honest flag); real = separate Phase-2 gate (G-2); #164/#221 flagged |

### Success Metrics
- Cross-repo gate proof: a raw `guild.roles.create` outside the adapter fails CI (G-3 survives repo boundary).
- The Purupuru loop runs E2E with **zero unintended role writes in shadow** (primary success, G-3/G-6).
- Same `Discrepancy` renders in both web + CV2 (G-5 medium-agnosticism).

---

## Risk Register

| ID | Risk | Sprint | Probability | Impact | Mitigation | Owner |
|----|------|--------|-------------|--------|------------|-------|
| R-1 | Empty centerpiece (diff engine) | 401 | Med | High | Build keystone first; pure substrate | freeside-worlds |
| R-2 | Latent-member data depends on score-api (not ours) | 404/405 | High | Med | MOCKED for MVP; #164/#221 | (Zerker / flag-only) |
| R-3 | config-seam accepts any bearer | 403 | High | High | FR-10 floor (C3) — mandatory MVP | freeside-worlds |
| R-6 | Scaffolded-role rollback strips user roles | 405 | Med | High | Non-destructive default; `roles_created` ledger | freeside-characters |
| R-7 | Purupuru not provisioned | 405 | High | Med | Phase-4 precondition (Task 405.6) | freeside-worlds / operator |
| R-8 | Motion is a net-new dashboard dep | 404 | Low | Low | Pinned `^12`, scoped | freeside-dashboard |
| R-9 | LIVE apply rate-limited / partial-failure | 402/405 | High | High | Async-job batch model; idempotency; 429 backoff | freeside-worlds |
| R-10 | apply_mode captured at Layer-build | 402 | High | High | Read at invocation via `Ref`/seam | freeside-worlds |
| R-11 | NATS down ⇒ un-audited LIVE write | 402 | Med | High | Write-after-audit strong consistency | freeside-worlds |
| R-12 | Confused-deputy (flip-once-write-later) | 402 | Med | High | `AuthzContext` batch binding | freeside-worlds |
| R-13 | Raw discord.js bypasses gate across repos | 405 | Med | High | Branded `WriteCapability` + import-boundary lint + tests | freeside-characters |
| R-14 | Two CMs overwrite lifecycle state | 403 | Med | Med | Per-CM composite key | freeside-worlds |
| R-15 | Private git-tarball blocks Vercel build | 404 | Med | Med | Provision `GITHUB_TOKEN`/deploy-key before deploy | freeside-dashboard |
| R-16 | Discord 250-role ceiling exhausted by orphan/scaffolded roles | 405 | Med | High | Rollback GC of unassigned Freeside roles (B2) + pre-go_live quota check `(existing+to-create)≤250` (D3) | freeside-worlds/characters |
| R-17 | Cross-repo substrate SHA skew (consumers disagree on schemas/hash/capability) | 401/404/405 | Med | High | Single-SHA version contract (`substrate-sha.lock`) + per-consumer CI compat check + shared conformance fixture + lockstep rollback (B7) | freeside-worlds |
| R-18 | Roster drift between preview and go_live ⇒ blind mass apply | 402 | Med | High | Roster-freshness re-eval at go_live (`GuardFailed("roster_drift")`, threshold 0) separate from rules-hash (B1) | freeside-worlds |
| R-19 | Same-world concurrent batches duplicate-create roles (TOCTOU) | 402 | Med | High | World-scoped advisory lock around check-then-create + concurrency test (B10) | freeside-worlds |
| R-20 | Stale authz grant / revoked admin retains read or write | 403 | Med | High | One `resolveAuthz` (read+write) + ≤10s TTL + go_live fresh re-check + `authz_decision_id` binding (B3/B4/B6) | freeside-worlds |

---

## Success Metrics Summary

| Metric | Target | Measurement Method | Sprint |
|--------|--------|-------------------|--------|
| Pure-function coverage (no mocks) | 100% of 4 pure fns | bun test | 401 |
| Version-hash flap resistance | hash identical across roster mutation | unit test | 401 |
| Provable-shadow property test (G-3 gate) | green at `numRuns ≥ 1000` | `@effect/vitest`+`fast-check` | 402 |
| Un-gated live-writer exports | 0 | reachability test (§8.4 proof 1) | 402 |
| Concurrent same-world creates (B10) | exactly 1 role created | advisory-lock concurrency test | 402 |
| Roster-drift guard (B1) | drift > threshold → `roster_drift` | property/unit test | 402 |
| Unauthorized writes accepted (FR-10) | 0 | config-seam integration tests | 403 |
| Revoked admin read/write (B3/B4) | denied within ≤10s TTL | revocation-mid-flow test | 403 |
| Cross-repo substrate SHA skew (B7) | 0 (all consumers == canonical) | per-repo CI compat + conformance fixture | 401/404/405 |
| 250-role limit (B2/D3) | go_live refused if `>250`; no orphan accumulation | quota check + GC test | 405 |
| Two-CM lifecycle isolation | no cross-CM leak/overwrite | integration test | 403 |
| Animated before/after on mock | renders, `MOCK` flag honest | manual + component test | 404 |
| Cross-medium resume (G-1) | resumes at persisted `step` | E2E | 404/405 |
| Cross-repo gate (G-3 across boundary) | raw discord.js mutation fails CI | lint + integration test | 405 |
| Unintended role writes in shadow | 0 | audit trail + E2E loop | 405 |
| Medium-agnostic render (G-5) | same `Discrepancy` in web + CV2 | E2E | 405 |

---

## Dependencies Map

```
S0 (401) ─────────▶ S1 (402) ─────────▶ S2 (403) ─────────────────▶ S4 (405)
  keystone            keystone            config + FR-10 authz          Discord Layers
  pure core +         gate + capability                                + Purupuru + E2E
  Discrepancy         + provable-shadow                                      ▲
     │                  (G-3 proof)                                          │
     │                                                                       │
     └──────────────────────────────────────────▶ S3 (404) ─────────────────┘
                          (Discrepancy contract)    web lens
                                                     before/after (MOCK)
```

- S0 → S1: gate/capability/async-job build on the pure core + ports + schemas.
- S0 → S3: the web lens can start on the `Discrepancy` contract + mock data as soon as S0 lands (the keystone-first payoff — visualizable early).
- S1, S2 → S3: go-live confirm reflects the gate (S1) + authz status (S2).
- S1, S2, S3 → S4: live I/O + Purupuru loop + E2E need everything upstream.

---

## Appendix

### A. PRD Feature Mapping

| PRD FR | Sprint | Status |
|--------|--------|--------|
| FR-1 Medium-agnostic entry | 404 (web), 405 (Discord) | Planned |
| FR-2 Resumable cross-medium state | 403 (key), 404 (stepper) | Planned |
| FR-3 Substrate-enforced shadow gate | 402 | Planned |
| FR-4 Role MVP (assign+create+scaffold) | 401 (compute), 405 (apply) | Planned |
| FR-5 Before/after comparison | 404 (web primary), 405 (CV2) | Planned |
| FR-6 Latent-member / leads surface (MOCKED) | 404 | Planned |
| FR-7 go_live guard (hash + soft soak) | 401 (hash), 402 (guard) | Planned |
| FR-8 Distributed pure substrate + gated writer | 401, 402 | Planned |
| FR-9 Rollback / coexistence / scaffolded lifecycle | 402 (rollback), 405 (coexistence) | Planned |
| FR-10 MVP authorization floor | 402 (resolveAuthz), 403 (config-service write-auth) | Planned |

### B. SDD Component Mapping

| SDD Component | Sprint | Status |
|---------------|--------|--------|
| C1 `@freeside-worlds/shadow-substrate` (keystone) | 401, 402 | Planned |
| C2 config-protocol surface extensions | 403 | Planned |
| C3 config-service FR-10 write-auth | 403 | Planned |
| C4 RosterSource/RoleWriter Layers (characters) | 405 | Planned |
| C5 Before/after comparison lens (dashboard, PRIMARY) | 404 | Planned |
| C6 Discord CV2 render (second target) | 405 | Planned |

### C. PRD Goal Mapping

| Goal ID | Goal Description | Contributing Tasks | Validation Task |
|---------|------------------|--------------------|-----------------|
| G-1 | Medium-agnostic, resumable entry | 403.1/.2/.4/.5/.6, 404.4/.6 | 405.E2E |
| G-2 | Before/after comparison is real (mocked acceptance) | 401.4, 402.6, 404.2/.3/.6/.7, 405.8 | 405.E2E |
| G-3 | Shadow-first is provable | 401.3/.5, 402.1–.5/.7/.8/.9, 403.3/.4/.5/.7, 404.5/.6, 405.2/.3/.4 | 405.E2E |
| G-4 | worlds-api owns + distributes | 401.1/.2/.6/.7/.8, 403.1, 404.1/.7, 405.1/.2 | 405.E2E |
| G-5 | Feature-agnostic substrate | 401.2/.4, 405.1/.5 | 405.E2E |
| G-6 | 1→2 scale (Purupuru) | 405.6/.7 | 405.E2E |

**Goal Coverage Check:**
- [x] All PRD goals (G-1..G-6) have at least one contributing task.
- [x] All goals have a validation step in the final sprint (Task 405.E2E).
- [x] No orphan tasks — every task is annotated with at least one goal.

**Per-Sprint Goal Contribution:**

- Sprint 401: G-3 (hash + transition), G-2 (diff), G-4 (package/distribution), G-5 (feature-agnostic schemas)
- Sprint 402: G-3 (complete: the provable gate + capability + async-job + ACVP), G-2 (effectful loaders)
- Sprint 403: G-1 (resumable key), G-3 (FR-10 authz floor + per-CM isolation)
- Sprint 404: G-2 (complete: animated render + mocked latent), G-1 (stepper/resume), G-3 (go-live confirm), G-4 (voiceless lens)
- Sprint 405: G-5 (CV2 second target), G-6 (Purupuru loop), G-4 (live Layers), G-3 (cross-repo gate); E2E validation of all goals

---

## Flatline Disposition (sprint, 3-model, 2026-06-01)

A **3-model adversarial Flatline review** (GPT + Opus + gemini-headless tertiary, interactive mode) ran against this sprint plan. Findings file: `/tmp/fl-sprint.json`.

**Counts:** **5 HIGH-CONSENSUS** · **10 blockers** · **5 disputed** · **0 low-value** · **58% model agreement** · confidence `full`.

All blocker/HC/disputed findings were assessed **correct** and integrated (no relitigation). Several are **design-level** and fed back into the SDD (bumped to **v1.2**); the rest are sprint task/sizing changes. Two findings were **DESIGN CALLS** (pre-decided per the integration brief) — flagged below for operator review. The B*/D* labels below are the integration-brief labels; the raw `/tmp/fl-sprint.json` uses repeated `SKP-*`/`IMP-*` ids which do not 1:1 match.

### Finding → sprint task / SDD section map

| Finding | Sev | Fix | Sprint task(s) | SDD section(s) |
|---------|-----|-----|----------------|----------------|
| **B9** *(DESIGN CALL)* | CRIT | `WriteCapability` reframed as a **compile-time accident-prevention seam**, NOT a runtime security primitive; enforced boundary = `GateCheckedRoleWriter` + server-side authz + write-after-audit (+ code comments) | 402.3; S1 deliverable + Security | §1.9, §4.4.4, §4.4.5, §13.2.3 |
| **B1** | HIGH | Roster-freshness re-eval at `go_live`: `AuthzContext.roster_version` + `GuardFailed("roster_drift")` (threshold default 0), separate from the rules-hash guard | 402.9; S1 deliverable + AC | §3.3, §4.1, §6.2, §7.1 |
| **B10** | CRIT | Per-world **advisory lock** serializing check-then-create (TOCTOU) + concurrency test | 402.4; S1 deliverable + AC | §4.4.1 |
| **B5** | HIGH | Mode-`Ref` **read-lock for the batch duration** (inverse rollback race) + inverse-race test | 402.1; S1 AC | §4.4.0, §4.5 |
| **B3/B4/B6** *(B6 DESIGN CALL)* | HIGH | ONE authoritative `resolveAuthz` backing `resolveWriter` + new **`resolveReader`** (revoked admins lose READ too); `authz_decision_id` bound into WriteCapability/AuthzContext; **TTL ≤10s + go_live fresh authz re-check**; revocation-mid-flow test | 403.3, 403.7; S2 deliverables + AC + Security | §1.9, §6.1, §6.2, §4.6 |
| **B7** | HIGH | Cross-repo **single-SHA version contract** (`substrate-sha.lock`) + per-consumer CI compat + shared conformance fixture + lockstep rollback | 401.8, 404.1, 405.1 | §1.7.1 |
| **B8** | HIGH | Explicit integration buffer + minimum-shippable cut-lines + **conditional S4-E2E split → S5/406** if live integration isn't green by S4 | Sprint Overview (buffer table + split trigger), Exec Summary | — |
| **B2** | CRIT | Rollback **GC of created-but-UNASSIGNED** Freeside roles (keep assigned, never strip users) — avoids orphan accumulation toward the 250 ceiling | 405.4; S4 deliverable + AC | §1.5, §4.4.1, R-6/R-16 |
| **D2** | (disp) | Comparison **distinguishes managed vs pre-existing/Collab.Land** roles (`managed` flag; pre-existing never shown as "would change") | 404.2; S3 deliverable + AC | §5.1, §6.4 |
| **D3** | (disp) | Pre-go_live **role-count quota check** `(existing+to-create) ≤ 250` + predictive surfacing in the comparison | 405.4 (quota), 404.2 (surface); S3/S4 AC | §4.4.1, §5.1, §6.4 |
| **D1** | (disp) | `BoundedString` one-way import (`shadow-substrate → config-protocol`); avoid day-one circular dep | 403.1 | §1.4 |
| **D4** | (disp) | **Deployed config-service smoke test** before cutover (routing/schema/token-format vs live env) | 403.6, 405.7 | §1.7 |
| **D5** | (disp) | Document the import-boundary lint's **known limits** (dynamic/indirect imports) — accident-prevention, not airtight (ties B9) | 405.3 | §8.4 proof 4 |

### DESIGN CALLS (operator-reviewable — pre-decided, may be overridden)

1. **B9 — `WriteCapability` is a compile-time accident-prevention seam, NOT a runtime security primitive.** The enforced boundary is `GateCheckedRoleWriter` (invocation-time `apply_mode` read + server-side `AuthzContext`/`admin_principals` check + write-after-audit). The capability stops an honest dev from forgetting the gate; it is not unforgeable at runtime. Acceptance binds to the gate proof (§8.4 exercises the gate path directly), not token possession. *Framing correction — no mechanism weakened.* (SDD §13.2.3.)
2. **B6 — authz cache TTL reduced to ≤10s AND `go_live` confirm re-checks authz freshly (uncached).** Bounds the stale-grant window for read+write; the highest-risk write (the actual apply) is never gated on a cached grant. ≤10s is a chosen ceiling — tunable per deployment. (SDD §13.2.4.)

### Conditional new sprint

- **S5 / global 406 — validation-hardening** *(conditional, B8):* fires **only if** live Discord + config-service integration is NOT green by end of S4. Would absorb the 405.E2E task rather than rush E2E with unvalidated gates. **Ledger sprint registration for 406 is the operator's act** — this plan only flags the trigger + the reserved number.

---

*Generated by Sprint Planner Agent. score-api is NOT ours — latent data mocked, gaps tracked via #164/#221. Global sprint numbering 401–405 continues from ledger (`doctor-acvp-network-plane` ended at 400); +1 conditional 406 (B8). Sprint-flatline (3-model) integrated 2026-06-01 — see Flatline Disposition above + SDD v1.2 §13.*
