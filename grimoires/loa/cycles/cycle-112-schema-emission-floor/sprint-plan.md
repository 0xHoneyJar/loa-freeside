---
title: "Sprint Plan — Schema-Emission Coherence Floor"
cycle: cycle-112-schema-emission-floor
status: candidate
date: 2026-05-31
domain: shared
prd: grimoires/loa/cycles/cycle-112-schema-emission-floor/prd.md
sdd: grimoires/loa/cycles/cycle-112-schema-emission-floor/sdd.md
grounding: grimoires/loa/cycles/cycle-112-schema-emission-floor/grounding-notes.md
provenance: /simstim Phase 5 (PLANNING), expanded from SDD §12 + §13 hardening, 2026-05-31
beads_label: "cycle:cycle-112-schema-emission-floor, domain:shared"
---

# Sprint Plan — cycle-112 (schema-emission coherence floor)

Five sprints, dependency-ordered. The ordering **is** the adoption guarantee
(FR-ADOPT-8): S1→S3 build the on-ramp ("the door"), S4→S5 prove it + close the gap
("the fence"). No fail-block lands before the ergonomic path exists. All work is
`domain:shared`, in-repo (`loa-freeside`); sonar cross-repo + completeness are
cycle-2 (PRD §10).

> **Scope reminder:** WIN = **soundness** (emitted events honor their schema) +
> **adoption** (compliant path cheaper than evasion). NOT completeness/outbox
> (cycle-2). The Flatline-SDD hardening (§13) is folded into the task ACs below.

---

## Sprint S1 — Registry + emit facade + closure-held type-boundary (the keystone)

Everything depends on S1. This is where the §13 hardening concentrates.

| Task | Description | FR / §13 | Acceptance |
|------|-------------|----------|-----------|
| T1.1 | `registry.ts`: phantom `SchemaId<P>` + `schemaId()` + `RegistryEntry<P>` (+ `transform?`) + `PayloadOf<K>`. The `transform` rule (IMP-014): **validation-only by default; `transform:true` is opt-in, reviewed, signs post-transform, and the wire contract documents post-transform.** | FR-1, SKP-005/IMP-001, SKP-004, IMP-014 | `SchemaId<P>` carries payload type; `emit(id, wrongShape)` is a compile error; **negative tsd test: `emit(id, x as any)` does NOT satisfy the type** (SKP-003); events package `tsconfig` is `strict:true` |
| T1.2 | Central static `ENTRIES` + frozen `REGISTRY` + non-throwing `lookupSchema` | FR-1, SKP-001 | unknown id → `undefined` (not throw); existing `nft.mint.detected.v1` entry wired |
| T1.3 | `registry.collision.test.ts`: dup-id fail + `transform:true` review-list + non-transform JCS round-trip | FR-2, SKP-004 | duplicate id fails build; un-reviewed transform fails; round-trip holds |
| T1.4 | `mutex.ts`: per-key async mutex (`withLock`). **Key = `publisherKey`; release in `finally`; acquire-timeout (default 5s) + publish-op timeout → `Left(TimeoutError)` (never hang); cancellation-safe** | SKP-002 (×2)/IMP-004 | concurrent `withLock` serialize; **stalled-publish (mock) → `Left(TimeoutError)`, lock released, queue drains** — not an indefinite hang |
| T1.5 | `transport.ts`: opaque `NatsTransport` + module-private `RAW` WeakMap + `createNatsTransport` (exported) + `internalPublish` (NOT exported) | FR-7, SKP-001/002 | a cell holding `NatsTransport` has no member/exported-fn yielding the raw client; `internalPublish` absent from `index.ts` |
| T1.6 | `emit.ts`: `makeEmitter` → `emit<K>(id, PayloadOf<K>, specifier?)`: lookup→Left, `validateEither` (no transform), sign-original, mutex-wrapped publish, **typed errors split `SchemaEmitError` (validation) vs `TransportEmitError`/`TimeoutError` (infra)**, receipt | FR-3/3a/4/5, ADOPT-1/7, SKP-001/004/005, IMP-007 | valid→`Right`; invalid→`Left(SchemaEmitError)`, NO publish/advance; unknown id→`Left(UnknownSchemaIdError)` (no throw); concurrent emits don't fork |
| T1.7 | `emitRaw<K>(id, subject, payload)`: same validation + subject-family-prefix assert | FR-3, SKP-002/008, OQ-5 | wrong family→`Left(SubjectFamilyError)`; payload still validated |
| T1.8 | Version-coupling: literal-typed `SCHEMA_VERSION` ≡ `ACVP_L1_SCHEMA_VERSION` (type + runtime test) | OQ-4, IMP-008/IMP-010 | type assertion compiles only if literals match; runtime test asserts equality |
| T1.9 | `index.ts` exports + **`package.json` `exports` map**: expose `makeEmitter`, `emit`/`emitRaw` types, `createNatsTransport`, `NatsTransport` type, registry ids — block deep-imports of `./src/transport` / `./dist/...` (no path to `internalPublish` or the raw client) | FR-5, SKP-001/002 | **negative import tests: source-path, dist-path, and path-alias deep imports of `internalPublish` all fail to resolve**; published-package contents audited |
| T1.10 | **Signing-key provisioning contract** (IMP-001): how `makeEmitter` sources its `Signer`; key-absent → exit-78/`EX_CONFIG` (reuse cycle-098 `audit-keys-bootstrap.md` pattern); rotation note. No hardcoded keys; no silent-unsigned path | IMP-001, NFR-Sec-1 | key-absent fails loud (78, routed to bootstrap runbook), never emits unsigned |

**S1 exit:** the ergonomic, hardened path exists and is unit+type tested (incl. negative type/import tests + stalled-publish + key-absent). No cell migrated yet, no lint blocking yet.

---

## Sprint S2 — Lint + set-subset gate + `events-lint` bin (report-only)

| Task | Description | FR / §13 | Acceptance |
|------|-------------|----------|-----------|
| T2.1 | `no-raw-nats-publish` ESLint rule: flags (a) `internalPublish` deep-import, (b) `.publish` on raw-NATS-typed receiver, (c) `nats`/`@nats-io` import outside composition root, (d) unwrap-to-var dataflow, **(e) `as SchemaId` / `as any` at emit call sites** (SKP-003) | FR-8, ADOPT-4, IMP-005, SKP-003 | fires on the type, not the `.publish(` substring; the 19 Redis/Rabbit/notifier + `INatsPublisher` sites pass; cast-bypass at emit sites flagged |
| T2.2 | `raw-nats-allowlist.yaml`: enumerate the 11 ids (grounding-notes §1) + `emitRaw_allowlist` (3 ids). **Pin the EXPECTED FINAL cardinality** (post-S3+S4): `raw = 0`, `emitRaw = 3` (per T3.0 kill-switch = schema) | FR-9, IMP-008 | both sets seeded verbatim; final-state cardinality documented so the gate asserts a concrete target |
| T2.3 | `check-nats-allowlist-shrinks.sh`: **set-subset** gate (`comm -13`), both sets; append OR count-preserving-swap → exit 1 | FR-9a, IMP-003 | adding any id fails; swapping fails; removing passes |
| T2.4 | Teaching errors: file, NEW-vs-allowlisted, doc link, fix command | ADOPT-6 | sample violation prints all four |
| T2.5 | Package `events-lint` as a bin in `@0xhoneyjar/events` | ADOPT-5 | `npx events-lint` runs standalone |
| T2.6 | Wire lint + gate into CI **report-only** (annotate, exit 0) | ADOPT-8 step 2 | CI shows findings, does not fail-block |
| T2.7 | **Unhandled-`Either` lint**: the `emit()`/`emitRaw()` return MUST be consumed (no fire-and-forget) — an ignored `Left` is a silent dropped event | SKP-001 (#1) | `_ = emit(...)` / bare `await emit(...)` without branching → lint error |

**S2 exit:** drift is *visible* in CI but not yet blocking. The 11 are enumerated, the final cardinality is pinned, and an ignored emit-failure can't slip through.

---

## Sprint S3 — Codemod + scaffold generator (move the grandfathered 11)

| Task | Description | FR / §13 | Acceptance |
|------|-------------|----------|-----------|
| **T3.0** | **PRE-SPRINT DECISION (resolved): `internal.killswitch` gets a REAL schema (`KillSwitchSignalSchema`) and migrates onto `emit()`** — a security-critical control signal SHOULD be ACVP-signed (a forged kill-switch is a DoS vector; signing is a feature here, not overhead). Therefore the raw-allowlist shrinks by those 2 ids → final `raw = 0` | SKP-004, IMP-002/IMP-008 | decision recorded; T2.2 final cardinality (`raw=0, emitRaw=3`) follows from it; no mid-sprint ambiguity |
| T3.1 | `tools/codemod/raw-nats-to-emit.ts` (ts-morph): `recv.publish('subj', obj)` → `emit(SchemaId, obj[, specifier])`; wires `makeEmitter` at composition root; removes the migrated allowlist id | ADOPT-2, FR-9 | dry-run report on the 11; idempotent |
| T3.2 | Codemod handles computed-subject sites → `emitRaw` (event-router ×2, NatsClient ×1), flagged for human review | OQ-5, SKP-008 | the 3 computed sites emit `emitRaw`, listed in report |
| T3.3 | Run codemod on the 8 plain sites (coexistence ×6 incl. pilot family, kill-switch ×2 per T3.0) + author their schemas via T3.5 | ADOPT-2 | 8 sites compile on `emit()`; `raw`-allowlist → 0 |
| T3.5 | `freeside events:new-schema <name>` generator: schema stub + topic helper + registry entry + index export + **stub aspirational invariant whose shape matches S5's enforcement test** (IMP-006) | ADOPT-3, NFR-Ergo-2, IMP-006 | one command → compiling + collision-passing + lint-passing skeleton; stub invariant shape == what `validateAcvpBindings` expects (no S5 churn) |

**S3 exit:** the grandfathered raw emitters are on `emit()`/`emitRaw` (`raw`-allowlist empty, `emitRaw=3`); adding a new event is one command.

---

## Sprint S4 — Pilot migration + verifying consumer + divergence test

| Task | Description | FR / §13 | Acceptance |
|------|-------------|----------|-----------|
| T4.1 | `schemas/parallel-mode-enabled.ts`: `ParallelModeEnabledSchema` (bounded subset + `config_hash`). **Pin the exact config field-subset entering the hash** — exclude volatile fields (timestamps etc.) so the hash doesn't flap | FR-10, IMP-004/IMP-007 | `config_hash = sha256(JCS(stableSubset(config)))` with the subset enumerated + tested for determinism |
| T4.2 | Migrate `parallel-mode-orchestrator.ts:265` onto `emit(ParallelModeEnabled, …)`; observable `Left` handling (log+metric+**correlation-id linking the state-write to the failed emit**); delete its allowlist id | FR-10/11, §3.4, SKP-003 | raw `.publish` gone; emit-Left logs+meters w/ correlation-id; allowlist shrinks |
| T4.3 | Verifying consumer (test harness): resolve schema from registry (NOT `S.Unknown`), assert sig + payload-schema + chain | FR-12 | closed loop passes: registry→emit→envelope→receiver-recheck |
| T4.4 | Divergence-observability test. **Defined injection point: a mock transport that returns `TransportEmitError` after the state-write** → assert divergence log + metric + correlation-id fire | SKP-003/005, IMP-003/IMP-007 | proves the residual gap is *observable*, not silent — via a concrete, deterministic injection |
| **T4.5** | **Scoped recovery contract** (the minimum the fail-block needs — NOT the outbox). emit splits its `Left`: **validation-`Left` → drop (deterministic; retrying a bad payload won't help — correct)** vs **transport-`Left` → bounded transient-retry (capped backoff), then final-`Left` → dead-letter MARKER + correlation-id + an alert with a named owner + a documented manual-reconciliation note.** Full state⟺event atomicity (saga/outbox) STAYS cycle-2 (C2-0). | SKP-001(#4)/SKP-003, IMP-007 | a transient NATS reject retries then dead-letters observably; a validation failure drops without retry; both carry correlation-id; alert + runbook stub exist. **⚠ scope-boundary task — operator-confirm at GO** |

**S4 exit:** the floor is proven end-to-end on a real in-repo seam, one process, zero live-infra — AND a transient transport failure has a bounded retry + dead-letter + alert, not a silent drop. (Durable atomicity is still cycle-2.)

---

## Sprint S5 — Coverage (first in-repo beacon) + ramp to fail-block

| Task | Description | FR / §13 | Acceptance |
|------|-------------|----------|-----------|
| T5.1 | Create `packages/events/beacon.yaml` (slug `freeside-events`, visibility internal) declaring `schema_enforcement` (`runtime_class: envelope`, `status: active`, proof `tests/acvp/schema_enforcement.test.ts`) | FR-13, §8.1 | first in-repo beacon; closes meta-gap arrakis-vl8f |
| T5.2 | Register `freeside-events` in `registry.yaml::modules` | FR-13 | slug resolvable by `validateAcvpBindings` |
| T5.3 | `tests/acvp/schema_enforcement.test.ts`: the proof — emit() validates-then-rejects + raw `.publish` unreachable | FR-13 | green; bound to the invariant |
| T5.4 | CI step asserts `validateAcvpBindings` → `contract_status: bound` for `freeside-events` | FR-14 | CI-visible `bound` (not aspirational/broken) |
| T5.5 | Flip the set-subset gate from report-only → **fail-block** | FR-9a, ADOPT-8 step 3 | new raw emit now fails CI |
| T5.6 | Restagger `.freeside/acvp-aspirational-allowlist.yaml` (the 4 entries all on 2026-08-30 → distinct dates) | ADOPT-8 step 4, grounding §5 | no single-date stack |

**S5 exit:** drift is CI-blocked, the pilot building is `bound`, the aspirational ramp is staggered. The floor holds.

---

## Cross-cutting

- **Beads:** create tasks T1.1–T5.6 (incl. T1.10, T2.7, T3.0, T4.5) with `br` before
  Phase 7 (`cycle:cycle-112-schema-emission-floor`, `domain:shared`). No cross-domain `blocked-by`.
- **Dependency edges:** T3.0 (kill-switch decision) resolves BEFORE S2.2/S3 (pins the
  final allowlist cardinality). S1 blocks all; S2 blocks S5.5; S3 depends on S1; S4
  depends on S1+S3 (schema gen); S5 depends on S4 (proof test).
- **Out of scope (cycle-2, do NOT pull in):** transactional outbox / durable
  state⟺event atomicity / saga (C2-0), sonar cross-repo (C2-1/2/3), broker-seal,
  schema evolution (NG-7). *T4.5's transient-retry + dead-letter is the in-scope
  floor of recovery — NOT the outbox.*
- **Verification per sprint:** unit + type tests (incl. negative type/import tests)
  green; `events-lint` clean on migrated sites; for S4/S5 the integration loop +
  divergence-observability + `bound` assertion.

---

## Flatline sprint-review disposition (2026-05-31)

3-model, 192s, **80% agreement: 7 HC, 3 DISPUTED, 8 BLOCKERS.** Raw:
`flatline-sprint-review.json`. All 8 blockers + 7 HC integrated (10 hardenings):

| Hardening | Findings | Where |
|-----------|----------|-------|
| Mutex timeout/key/finally-release (no indefinite hang on stalled publish) | SKP-002 ×2, IMP-004 | T1.4, T1.6 |
| Unhandled-`Either` lint (no fire-and-forget silent drop) | SKP-001 #1 | T2.7 |
| Package-boundary hardening: `exports` map + negative import tests + cast ban + `strict` | SKP-001 #2, SKP-003 | T1.1, T1.9, T2.1 |
| Signing-key provisioning contract (key-absent → exit-78, no unsigned path) | IMP-001 | T1.10 |
| Kill-switch resolved as PRE-sprint decision → real schema (sign it); final cardinality pinned | SKP-004, IMP-002/008 | T3.0, T2.2 |
| Scoped recovery contract (transient-retry + dead-letter + correlation-id; outbox stays cycle-2) | SKP-001 #4, SKP-003, IMP-007 | T4.5, T4.2 |
| Divergence-test injection point defined | IMP-003 | T4.4 |
| `config_hash` stable field-subset pinned | IMP-007 | T4.1 |
| Stub invariant shape matches enforcement test | IMP-006 | T3.5 |
| `transform` rule made crisp | IMP-014 (disputed→clarified) | T1.1 |

**DISPUTED dispositions:** IMP-013 (intra-sprint dep edges) — deferred, teams
resolve in execution + cross-cutting covers sprint-level deps. IMP-015 (lint JSON
vs human output) — deferred to post-S2 polish (don't over-constrain before the rule
is validated). IMP-014 (transform rule) — clarified into T1.1 rather than left open.

**One task flagged for operator GO (T4.5):** the recovery contract sits on the
soundness/completeness scope line. The integrated version stays *inside* soundness
(transient-retry + dead-letter marker for transport blips; validation failures drop
deterministically) and keeps durable atomicity/outbox in cycle-2 — but it does add
recovery semantics the original scope didn't name. Confirm at GO.

---

*Generated via /simstim Phase 5 (PLANNING), hardened by Phase 6 (Flatline sprint,
3-model — disposition above). Next: Phase 7 — implementation via `/run sprint-plan`
(operator GO checkpoint: code lands in packages/events, which everything imports;
+ confirm T4.5 scope).*
