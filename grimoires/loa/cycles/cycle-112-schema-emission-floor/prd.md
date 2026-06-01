---
title: "PRD — Schema-Emission Coherence Floor"
cycle: cycle-112-schema-emission-floor
status: candidate
date: 2026-05-31
mode: ARCH (plan-here / build-here, v1)
domain: shared
constructs: the-arcade/OSTROM + noether + observer/WEAVER + k-hole/STAMETS
plannable: true
crystallization: grimoires/loa/context/2026-05-31-schema-emission-floor-crystallization.md
related_adr: ADR-008 (factory building-belts), cycle-098 (agent-network audit envelope)
dispatch_targets: []  # v1 builds in-repo; sonar-api cross-repo + completeness deferred to cycle-2 (§10)
provenance: /simstim preplanning scan (Workflow wf_c4c836e0-61c) + operator forks + Flatline Phase-2 (§11) + enforcement-locus protocol panel (wf_05d52db8-18f) + adoption council (§12), 2026-05-31
---

# PRD — Schema-Emission Coherence Floor (cycle-112)

> **The floor AND its on-ramp.** This cycle does not just build a fence that makes
> schema-emission drift impossible — it builds the fence *and* the gate engineers
> actually want to walk through, because a floor nobody adopts is drift that hasn't
> happened yet. The win is **soundness** (every emitted NATS event honors the
> schema its cell declares) made **unbypassable-by-accident** AND **cheaper to
> comply with than to evade**. Read the crystallization brief first — it carries
> the scan evidence, the protocol-panel enforcement-locus verdict, and the
> adoption-council ergonomics behind every claim here.

> **Two scope decisions you must hold while reading.** (1) **Win = soundness, not
> completeness.** The transactional-outbox / state-change⟺event-emit atomicity
> problem leaves cycle-1 **entirely** and becomes cycle-2's headline (§10, C2-0).
> The protocol panel settled this: soundness is the floor; completeness is the
> next storey. (2) **Pilot = in-repo, lint-local.** The original cross-repo
> mint→announce (loa-freeside ↔ sonar-api) is deferred to cycle-2 (§10). We prove
> the primitive where the emit is *written and lintable in one repo* — per Gygax's
> adoption verdict, the worst place to pilot a producer gate is a producer you
> can't CI-block.

---

## 1. Executive Summary

Today the cluster's signed, schema-checked ACVP event envelope
(`publishEnvelope`) is **built, exported, and called by no one** — every one of
the ~11 real NATS event emitters reaches the bus raw, unsigned, and
schema-unvalidated. This cycle raises the floor so that **schema-emission drift
becomes physically futile and immediately detectable**: it ships a typed
`emit(SchemaId, payload)` primitive that schema-validates the payload at
emit-time — *before* it signs and *before* it advances the hash chain — then
wraps the validated payload in the existing `acvp-l1-v2` envelope and publishes.
Raw `.publish` becomes unwriteable outside the events package via a private
transport *type* (not a string-match), plus a CI lint whose allowlist can only
**shrink**.

But a floor is only as real as its adoption. An adversarial game-design council
(Gygax + Arneson, §12) proved that every engineer archetype would silently bypass
this floor as specified — because the compliant path was *more* expensive than the
status quo, the reward accrued in a different repo, and a Redis side-door existed.
So this cycle ships the floor **and its on-ramp as one inseparable deliverable**:
the `emit()` facade is *shorter* than raw `nats.publish` (it closes over the
signer, the per-cell prev-hash store, and the topic, so the call site is
schema-id + payload), a codemod moves the existing ~11 raw emitters onto it, a
scaffold generator makes "add a new event" a one-command operation, the lint
teaches rather than scolds, and the whole thing ramps facade-first / fail-block-last
so nobody hits a wall before the door exists.

It reuses two shipped, hardened systems — the envelope runtime
(`publishEnvelope`/`subscribeEnvelope`) and the `validateAcvpBindings` contract
validator (PR #258) — and builds exactly two net-new pieces plus their ergonomics:
the `event_type → schema` **registry** (the keystone) and the **type-boundary**.
The floor is proven end-to-end on a **loa-freeside-internal** NATS seam — one of
the coexistence emit sites the scan found (`parallel.mode.*` / `coexist.*`) — so
registry, emit, envelope, and a verifying consumer all close the loop in **one
repo, one process** where build-time collision detection actually works and the
producer is lintable.

> **Pilot reframe (Flatline Phase-2 + Gygax adoption verdict, 2026-05-31).** The
> original pilot was mint→announce across `loa-freeside` + `sonar-api`. Flatline's
> adversarial review found that seam carries the three hardest blockers (cross-repo
> build-time collision is impossible; sonar/Ponder offers no DB txn; a second
> emitter needs its own Ed25519 key + trust-store update). The adoption council
> then found the *decisive* reason to move in-repo: **a cross-repo producer cannot
> be CI-blocked by this repo's lint** — piloting a producer gate on an
> un-lintable producer is the worst possible adoption choice. Decision: prove the
> primitive in-repo, where the lint sits next to the emit. Cross-repo (sonar) +
> completeness (outbox) both become explicit cycle-2 follow-ons (§10).

## 2. Goals

The floor (G-1..G-3, the soundness + keystone), the proof (G-4..G-6), and the
on-ramp (G-7, adoption — co-equal, per "adoption IS the cycle").

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Make malformed/undeclared NATS emission unwriteable (soundness) | Raw `.publish` to NATS is impossible outside `packages/events`; new raw-emit attempts fail CI lint; the lint allowlist can only **shrink** (CI count-delta gate fails on any increase). 0 new raw NATS emits can land. |
| G-2 | Validate payload at emit-time, before sign-and-advance (close the emit-vs-consume asymmetry) | `emit()` rejects a schema-mismatched payload *as a typed failure the caller must handle*, **before** the Ed25519 signature is computed and **before** the prev-hash chain advances. A bad payload never reaches the bus and never forks the chain. |
| G-3 | Establish the `event_type → payload-schema` registry (the keystone) | A single **central static** registry maps every pilot-seam topic to its Effect.Schema; `emit()` and `subscribeEnvelope` both resolve schema from it (no per-call hand-passing); two topics colliding is a build-time error *within the repo*. |
| G-4 | Prove the floor on an in-repo NATS seam end-to-end | A loa-freeside-internal seam (`parallel.mode.*` / `coexist.*`) emits via `emit()`; a real or test consumer verifies it (sig + payload-schema + chain) — the closed loop, one repo, one process. |
| G-5 | Turn the coverage gap green on the pilot building | The pilot building declares real `acvp_invariants` (incl. `schema_enforcement` with `runtime_class: envelope`); `validateAcvpBindings` reports `contract_status: bound` (not `aspirational`/`broken`) for it, CI-visibly. |
| G-6 | Leave a shrinking, visible drift ledger | The ~11 known raw-NATS emit sites are allowlisted and counted; the pilot + codemod empty the migratable entries; remaining entries are tracked for follow-on cycles with staggered expiries. |
| **G-7** | **Make the compliant path the path of least resistance (adoption)** | The `emit()` call site is **≤ the argument count** of the raw `nats.publish` it replaces; the existing ~11 raw emitters are moved onto `emit()` by a **codemod** (not hand-migration); adding a new event is **one command** (`freeside events:new-schema`); the lint ships **report-only for ≥1 sprint before fail-block**; lint errors name the file, the missing-vs-regressed distinction, and the fix command. Adoption metric: a deadline-pressed engineer adding a new event reaches for `emit()` because it is *less* typing than the raw path, not because a rule forces them. |

## 3. Background / Context

The full evidence is in the crystallization brief. The load-bearing facts:

- **The envelope is deployed-but-unconsumed on the publish side.**
  `packages/events/src/publisher.ts:129 publishEnvelope<P>` runs the complete
  `acvp-l1-v2` pipeline (JCS canonicalize → payload_hash → prev_hash chain →
  Ed25519 full-envelope signature → envelope-shape decode) and is exported at
  `index.ts:30` — but has **zero call sites repo-wide**. Its twin
  `subscribeEnvelope` has one real consumer (operator-dash observability), and
  that consumer passes `schema: S.Unknown` (`events-trace.ts:351`) — so even the
  receiver-side soundness capability is currently unexercised.

- **Emit-vs-consume asymmetry (the soundness hole).** `publishEnvelope` validates
  the envelope *shape* at emit but never the per-event *payload* (only
  canonicalizes + hashes it, `publisher.ts:134-135`). Worse: the prev-hash chain
  advances **unconditionally** at `publisher.ts:167` — a structurally-bad payload
  hashes fine, signs fine, and *advances the chain* before any subscriber rejects
  it. Payload schema validation exists only subscribe-side
  (`subscriber.ts:299 decodePayloadEither`), gated *after* the sender has already
  committed. The fix requires a schema the *publisher* can resolve, applied
  **before** sign-and-advance — which is exactly what the registry + `emit()`
  provide (G-2/G-3).

- **No `event_type → schema` registry.** `topics.ts` is a 3-segment subject
  *string builder*; `schemas/` holds exactly one payload schema
  (`nft-mint-detected.ts`); the subscriber takes the schema as a per-call option
  and the publisher takes none. Schema selection is the caller's responsibility,
  with no central map — the keystone net-new piece.

- **The ~11 raw emitters are real and lint-able in-repo.** All ~30 `.publish(`
  sites reach the bus raw; ~11 are true NATS/JetStream ACVP emits, the other ~19
  are non-ACVP overloads (Redis cache-invalidation, RabbitMQ priority queue,
  notifier). Two of the 11 use *computed* subjects (`event-router.ts:346/397`,
  `NatsClient.ts:379`) that a static topic-detector is blind to by design — only
  a transport *type* boundary physically closes them.

- **Two repos, one shared package (the cycle-2 surface).** `@0xhoneyjar/events`
  is transport-agnostic; loa-freeside (workspace `file:`) and `sonar-api`
  (git-tarball subdir, SHA-pinned) both emit through it. `sonar-api`'s invariants
  are already `status:aspirational`. The cross-repo rail is real — and explicitly
  cycle-2 (§10).

This cycle exists because the coherence validator substrate
(`freeside-coherence/substrate`, the cycle's sibling work) made these gaps
machine-visible and filed the meta-gap (`packages/events` declares no invariants
for the protocol it defines). This PRD is the constructive answer: not detect
drift, but make it futile to introduce and trivial to avoid.

## 4. Non-Goals

- **NG-1 — Not completeness (state-change⟺event-emit atomicity).** *(Re-scoped
  this revision.)* The transactional-outbox guarantee — that a crash between a
  state write and its event emit loses neither — is **cycle-2's headline** (§10,
  C2-0), not v1. v1 is soundness-only: an emitted event honors its schema; whether
  every state change *produces* an emit is the next storey. The protocol panel
  settled this explicitly ("the Postgres-outbox problem leaves cycle-1 entirely").
- **NG-2 — Not the HTTP completeness-envelope pillar.** This floor targets the
  **NATS L1 `EventEnvelope` (`acvp-l1-v2`)** only. The HTTP "completeness
  envelope" pillar (`freeside-auth /v1/profile`, mediums proof-receipt → doctor,
  dashboard/coherence trace-readers) is a distinct ACVP layer and is explicitly
  out of scope. Naming this boundary is a deliverable.
- **NG-3 — Not the non-NATS buses.** The ~19 Redis (cache-invalidation),
  RabbitMQ (priority queue), and notifier `.publish` overloads are NOT ACVP
  events; the lint and registry must NOT fire on them — discrimination is by the
  private NATS transport *type*, not the `.publish(` substring (FR-ADOPT-4).
- **NG-4 — Not a full cluster migration.** Only the pilot seam is migrated +
  verified end-to-end this cycle. The other raw NATS emits are codemod-moved onto
  `emit()` where mechanical, else allowlisted and tracked (G-6).
- **NG-5 — Not the broker-sealed channel.** Enforcement is per-cell (library +
  lint), the LayerZero-DVN "validating proxy" anti-pattern all three protocol
  lenses forbid for the NATS plane. The SDD SHOULD keep `emit()`'s shape such that
  a broker seal could later sit under it, but building that seal is out of scope.
- **NG-6 — Not a new envelope version.** This cycle stays on `acvp-l1-v2`. It does
  NOT introduce `trace_id` / `acvp-l1-v3` (the separate Seam A handoff). The
  `emit()` carrot (FR-ADOPT-7) mints a free **`event_id` + auto-managed prev-hash
  chain**, NOT a `trace_id`; if the pilot wants a correlation field it rides
  existing fields or defers.
- **NG-7 — Not schema evolution / versioning** *(IMP-004, high-consensus).* The
  registry's "one topic, one schema" guarantee (FR-2) deliberately does NOT define
  how a topic's schema *changes* over time. Explicitly deferred. v1 freezes the
  pilot topic's schema.
- **NG-8 — Not the cross-repo (sonar-api) migration.** Re-scoped out per Flatline
  + the adoption verdict (un-lintable producer); see §10. v1 is in-repo only.

## 5. Functional Requirements

### Registry (the keystone)
- **FR-1** — A `event_type → payload-schema` registry SHALL exist in
  `@0xhoneyjar/events`, mapping each topic to its Effect.Schema as a **central
  static declaration** (all bindings resolvable at build time from one module —
  NOT runtime per-cell registration, which cannot be statically collision-checked;
  Flatline ROOT 1/3). Cells reference registry entries; they do not mutate the
  registry at import time.
- **FR-2** — Two topics declared with conflicting schemas SHALL be a build-time
  error within the repo (one topic, one schema). *Scope honesty (Flatline blocker
  4): build-time collision detection is a single-repo guarantee. Cross-repo
  collision is deferred to cycle-2 (§10, C2-3).*

### The emit primitive (soundness)
- **FR-3** — `emit(SchemaId | topic, payload)` SHALL validate `payload` against
  the registry-resolved schema **at emit-time, before signing and before advancing
  the prev-hash chain**, and SHALL refuse to emit on mismatch. This closes both the
  emit-vs-consume asymmetry AND the unconditional-chain-advance seam
  (`publisher.ts:167`): a bad payload never signs, never advances, never reaches
  the bus.
- **FR-3a** *(IMP-002, high-consensus)* — The emit-time mismatch behavior SHALL be
  a **typed failure the caller must handle** (an Effect failure / `Result`, NOT a
  thrown exception and NOT silent), so a schema mismatch is a value the call site
  cannot ignore. The exact type is an SDD decision; the *contract* (caller-visible,
  non-throwing) is fixed here.
- **FR-4** — `emit()` SHALL wrap the validated payload in the `acvp-l1-v2` envelope
  via the existing `publishEnvelope` pipeline (reuse, not rebuild).
- **FR-5** — `emit()` SHALL be the only sanctioned NATS emission path; its
  signature SHALL make the schema first-class and SHALL NOT expose the raw
  transport, the signer, or the prev-hash store as call-site foot-guns (those are
  closed over per-cell — FR-ADOPT-1).

### The on-ramp (adoption — the council's 8, absorbed)
- **FR-ADOPT-1** *(THE ONE THING)* — `emit()` SHALL be produced by a per-cell
  factory `makeEmitter({ cell })` that **closes over** the signer, the prev-hash
  store, `emittedBy`, and the topic-resolution, so the call site is
  `emit(SchemaId, payload)` — **≤ the argument count of the raw `nats.publish`** it
  replaces. The factory SHALL own the F-003 chain-fork mitigation (a single
  per-cell prev-hash store, advanced only after FR-3 validation passes). The
  8-field `publishEnvelope` opts-bag SHALL be demoted to a documented **escape
  hatch**, not the ergonomic path.
- **FR-ADOPT-2** — A **codemod** SHALL move the existing ~11 raw NATS emitters onto
  `emit()` (not hand-migration); the migrated seams' allowlist entries SHALL be
  removed by the same change. The allowlist SHALL be frozen shrink-only (FR-9a):
  adding an entry fails CI.
- **FR-ADOPT-3** — A scaffold generator (`freeside events:new-schema <name>`) SHALL
  make adding a new event **one command**: it scaffolds the schema file, the
  topic helper, the registry/index export, and a stub `acvp_invariant`. Adding an
  event without the generator SHALL be *more* work than with it (the carrot is
  structural).
- **FR-ADOPT-4** — The lint SHALL discriminate by the private NATS transport
  **type**, not the `.publish(` substring, so the ~19 non-ACVP `.publish` sites
  (Redis/RabbitMQ/notifier) pass untouched and the 2 computed-subject NATS emits
  are caught. `NatsLike` SHALL be made nominal / un-importable outside the events
  package (FR-7 is the type-level half; this is the lint-precision half).
- **FR-ADOPT-5** — The lint SHALL ship as a runnable bin (`events-lint`) inside
  `@0xhoneyjar/events`, so any consumer installing the package (including
  git-tarball consumers like sonar in cycle-2) can self-enforce without copying
  CI config.
- **FR-ADOPT-6** — Lint failures SHALL **teach**: name the offending file, state
  whether the violation is a *new* raw emit (regression) vs an existing
  *allowlisted* one (no-op), link the one-paragraph doc, and name the fix command
  (`freeside events:new-schema` or "use the cell's `emit()`"). No bare
  "forbidden token" output.
- **FR-ADOPT-7** *(the carrot)* — `emit()` SHALL mint, for free, what the raw path
  makes the developer hand-manage: a fresh `event_id`, the correctly-advanced
  prev-hash link, and a **producer-visible acceptance receipt** (the
  payload-validated + signed envelope returned to the caller, so the producer can
  see its own event was accepted without subscribing). *(Per NG-6: `event_id` and
  chain only — NOT `trace_id`.)*
- **FR-ADOPT-8** *(the ramp)* — Rollout ordering SHALL be: (1) facade + codemod
  land first; (2) lint runs **report-only for ≥1 sprint**; (3) only then does the
  count-delta gate fail-block; (4) aspirational-invariant expiries SHALL be
  **staggered**, not all stacked on a single date. No engineer hits a fail-block
  before the ergonomic door exists.

### The type-boundary (enforcement)
- **FR-7** — The raw NATS transport (`NatsLike.publish`) SHALL be private to
  `packages/events` such that no other package can call `nats.publish` /
  `jetstream.publish` directly (type-level + module-boundary). Pairs with
  FR-ADOPT-4 (the lint-precision half).
- **FR-8** — A CI lint SHALL fail on any NEW raw NATS `.publish` outside the
  events package, while allowlisting the existing ~11 sites. Scoped to
  NATS/JetStream by transport type; SHALL NOT fire on Redis/RabbitMQ/notifier.
- **FR-9** — The allowlist SHALL be machine-readable; the pilot migration +
  codemod SHALL remove the migrated seams' entries.
- **FR-9a** *(Flatline ROOT 4, CRITICAL — the monotonic-shrink property)* — CI
  SHALL enforce that the allowlist can **only shrink**: a count-delta check fails
  the build if the entry count rises versus the base branch. Adding a new raw emit
  + allowlisting it (the universal bypass the council found) is therefore
  impossible without an explicit, reviewed allowlist-increase that CI flags.
  Without this, G-1's "physically impossible" is false.

### The in-repo pilot
- **FR-10** — A loa-freeside-internal NATS seam SHALL be migrated onto `emit()`.
  Target: one of the coexistence emit sites the scan found
  (`parallel-mode-orchestrator.ts` `parallel.mode.*` or `shadow-sync-job.ts`
  `coexist.*`) — chosen because the **producer is in this repo and lintable**
  (the decisive adoption criterion), not for any Postgres co-location (moot now
  that completeness is cycle-2).
- **FR-11** — The migrated seam SHALL emit through `emit()` end-to-end:
  schema-validated → envelope → NATS, with the raw `.publish` removed and its
  allowlist entry deleted (FR-9).
- **FR-12** — A consumer (real or test harness) SHALL verify the migrated event
  (sig + payload-schema + chain) — the closed loop, proving registry + emit() +
  envelope + receiver-recheck in one repo, one process.

### Coverage (the teeth)
- **FR-13** — The pilot building SHALL declare real `acvp_invariants` in its
  BeaconV3 — at minimum `schema_enforcement` with `runtime_class: envelope`,
  bound to a real proof artifact.
- **FR-14** — `validateAcvpBindings` SHALL report `contract_status: bound` for the
  pilot building (not `aspirational`/`broken`), and this status SHALL be CI-visible
  (the check runs in CI and its `bound` result is asserted). *(IMP-006: the
  report-only→fail-block flip for OTHER buildings stays out of scope per NG-4, but
  the pilot building's `bound` status is asserted in CI this cycle.)*

## 6. Non-Functional Requirements

- **NFR-Ergo-1** *(adoption, load-bearing)* — The `emit()` call site SHALL be no
  more verbose than the raw `nats.publish` it replaces (argument count and import
  count both ≤ baseline). If compliance costs more keystrokes than evasion, G-7
  fails regardless of the lint.
- **NFR-Ergo-2** — The `freeside events:new-schema` generator SHALL produce a
  compiling, registry-wired, lint-passing skeleton on first run (no manual
  follow-up edits required to pass CI for the scaffold itself).
- **NFR-Compat-1** — Migrating the pilot SHALL NOT break existing
  `subscribeEnvelope` consumers; `acvp-l1-v2` wire format is unchanged.
- **NFR-Compat-2** — The registry SHALL be additive: cells not yet migrated
  continue to work (their raw emits are allowlisted, not broken).
- **NFR-Perf-1** — Emit-time schema validation SHALL add negligible latency
  relative to the existing JCS+hash+sign cost already in `publishEnvelope`.
- **NFR-Sec-1** — The type-boundary SHALL NOT weaken the existing Ed25519
  full-envelope signature binding (EVT-001 stays closed). FR-3's validate-before-sign
  ordering SHALL NOT create a path where an unsigned payload reaches the bus.

> *Completeness NFRs (at-least-once delivery, consumer idempotency on `event_id`,
> DLQ-on-stuck-relay) moved with the outbox to cycle-2 (§10, C2-0). They are NOT
> v1 requirements.*

## 7. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **The floor ships but nobody adopts it** (the council's core finding) | **High** | G-7 + FR-ADOPT-1..8: facade shorter than raw, codemod the 11, one-command scaffold, report-only-first ramp. Adoption is a *goal with a metric*, not a hope. |
| `emit()` facade more verbose than raw `nats.publish` (compliance costs more than evasion) | High | NFR-Ergo-1 is a hard gate; FR-ADOPT-1 closes over signer/store/topic so the call site is schema-id + payload |
| Redis side-door (`stateManager.publish`) becomes the universal bypass | High | FR-ADOPT-4: lint keys on the NATS transport *type*; the Redis path is a different type and is out of scope (NG-3), but the SDD MUST confirm no NATS emit hides behind a Redis-shaped wrapper |
| Registry forced runtime-per-cell instead of static (re-introduces ROOT 1) | High | FR-1 mandates central static; the SDD must NOT design import-time `register()` mutation |
| Type-boundary refactor of `NatsLike` breaks the operator-dash subscriber | Medium | NFR-Compat-1; the boundary is on the *publish* transport, subscribe path untouched |
| Lint over-fires on Redis/Rabbit `.publish` (the 30-vs-11 trap) | Medium | FR-8 + FR-ADOPT-4 type-based discrimination; explicit carve-out list in the SDD |
| Allowlist bypass (append a new raw emit) | High→closed | FR-9a count-delta gate: allowlist can only shrink |
| **Deferred to cycle-2 (§10):** completeness/outbox; sonar Ed25519 key + trust-store; sonar/Ponder no DB txn; cross-repo registry distribution | High | Out of v1 scope per NG-1/NG-8; §10 carries them as the explicit cycle-2 problem set |

## 8. Dependencies

- **Reuse (shipped):** `packages/events` runtime (envelope/publisher/subscriber/
  jcs/signer); `packages/beacon-schema validateAcvpBindings` (PR #258).
- **Cycle-2 (deferred, §10):** the governance transactional outbox
  (`packages/services/governance-{service,outbox-worker}.ts`) is the reuse anchor
  for completeness — it does NOT enter v1. `0xHoneyJar/sonar-api` cross-repo
  migration likewise depends on this cycle's primitive landing first.
- **Sibling work:** the coherence validator substrate (`freeside-coherence/
  substrate`) — its detectors are an ADDITIONAL, optional verifier. *(IMP-005: the
  binding floor for G-1/G-6 is the lint + count-delta gate (FR-8/FR-9a),
  self-contained in this cycle; the detectors are not a prerequisite.)*
- **Tooling:** beads (`br`) for task tracking; `domain:shared`.

## 9. Open Questions

- **OQ-1 (registry shape):** FR-1 fixes "central static." Remaining for the SDD:
  hand-maintained `Record<topic, Schema>` vs a codegen step that collects per-file
  schema declarations into one static map (both build-time-collision-checkable; the
  codegen path scales better but costs a build step — and it's the natural home for
  the `events:new-schema` generator, FR-ADOPT-3).
- **OQ-2 (pilot seam pick):** which coexistence seam — `parallel.mode.enabled`
  (clean single config-write + publish) or a `coexist.*` shadow-sync event? SDD
  reads both (`parallel-mode-orchestrator.ts:262`, `shadow-sync-job.ts:331`) and
  picks the one whose emit is cleanest to wrap and whose consumer is easiest to
  stand up as the FR-12 verifier.
- **OQ-3 (lint mechanism):** ESLint custom rule (keyed on the NATS transport type)
  vs the TypeScript module-boundary alone (private `NatsLike` may suffice) vs the
  coherence detector as a CI step — and how `events-lint` (FR-ADOPT-5) packages
  whichever wins as a runnable bin. FR-7/FR-8/FR-9a/FR-ADOPT-4 are the contract.
- **OQ-4 (envelope version coupling):** `events SCHEMA_VERSION` and the contract
  validator's `ACVP_L1_SCHEMA_VERSION` are two separate string literals that agree
  today with no compile-time link (Flatline IMP-010). Add a compile-time assertion
  they match? *(Small, high-value; SDD to scope — lean: yes.)*
- **OQ-5 (codemod scope):** FR-ADOPT-2's codemod must handle the 2 computed-subject
  emits (`event-router.ts:346/397`, `NatsClient.ts:379`) — do they migrate cleanly
  onto a static SchemaId, or do they need a per-call topic argument that the
  registry still validates? SDD decides; this is the hardest codemod case.

---

## 10. Cycle-2: the deferred problem set (completeness + cross-repo)

Two structurally-distinct problems leave cycle-1 so the floor can land clean.
Recorded here so the deferral is tracked, not lost:

- **C2-0 — Completeness (the transactional outbox).** *(Headline cycle-2 item,
  moved from v1 this revision.)* Guaranteeing state-change ⟺ event-emit atomicity:
  the event writes to a txn-coupled outbox in the same DB transaction as the state
  change, a relay drains it at-least-once, consumers dedup on `event_id`. The reuse
  anchor is the existing governance outbox
  (`packages/services/governance-{service,outbox-worker}.ts`:
  txn-coupled row + `FOR UPDATE SKIP LOCKED` + DLQ). For emitters lacking a
  co-located relational txn (the sonar/Ponder case), the authorized fallback is
  **inbox-dedup / consumer-side reconciliation**, NOT bare JetStream durable-ack
  (which does not close the state-committed-but-event-lost window). This is the
  *second storey* — soundness (cycle-1) must hold first.
- **C2-1 — Ed25519 signing identity for sonar-api** (Flatline blocker 2, CRITICAL).
  A second independently-deployed emitter needs its own signing key (bootstrap +
  rotation per `audit-keys-bootstrap.md`) OR a shared key (single-point
  compromise). The subscriber's trust-store must accept sonar-originated
  signatures.
- **C2-2 — Completeness on Ponder** (Flatline blockers 8, 13). sonar is mid-port
  to Ponder, whose indexer runs handlers synchronously during block processing
  with no externally-accessible DB transaction. Confirm sonar's emit path
  (`ponder-runtime/src/lib/nats-publisher.ts`, `outbox-flush.ts` — sonar may
  ALREADY have an outbox-flush worth reusing).
- **C2-3 — Cross-repo registry distribution** (Flatline blockers 1, 3, 4). The
  central static registry is build-time-collision-checkable within ONE repo. Two
  separately-built repos need a published-registry + version-pin protocol so a
  topic's schema is consistent across both, plus the coordinated
  `@0xhoneyjar/events` version bump (sonar consumes via SHA-pinned git-tarball — it
  will NOT auto-receive a bump). `events-lint` shipping as a bin (FR-ADOPT-5) is
  the cycle-1 down-payment that lets sonar self-enforce here.

Cycle-2 is gated on cycle-112 landing. It is the *true* cross-repo + completeness
proof — sequenced after the primitive is real and adopted.

## 11. Flatline Phase-2 disposition (2026-05-31)

3-model review (claude-headless + codex-headless + gemini-headless), 218s, 61%
agreement, confidence: full. Raw: `flatline-prd-review.json`.

- **13 BLOCKERS → 4 roots, all dispositioned:** ROOT 1 (registry cross-repo
  build-time) → FR-1 central-static + §10 defer. ROOT 2 (sonar/Ponder no DB txn) →
  re-pilot in-repo (FR-10) + completeness→cycle-2 (C2-0/C2-2). ROOT 3 (sonar
  Ed25519) → C2-1. ROOT 4 (allowlist not monotonic — CRITICAL) → **FR-9a**.
- **6 HIGH_CONSENSUS → all integrated:** IMP-001 (C2-0 fallback named),
  IMP-002 (FR-3a typed-failure), IMP-003 (dedup → C2-0), IMP-004 (NG-7), IMP-005
  (Dep §8 de-contradicted), IMP-006 (FR-14 CI-visible).
- **5 DISPUTED → noted for SDD:** IMP-009 (drift-check scope), IMP-010 (version
  coupling → OQ-4), IMP-011 (perf → NFR-Perf-1 qualitative for v1), IMP-012
  (naming), IMP-013 (cross-repo rollback → §10).

## 12. Adoption-council disposition (Gygax + Arneson, 2026-05-31)

A game-design council composed via `/compose` (construct-gygax + construct-arneson)
stress-tested the floor as a *game its players (cluster engineers) would try to
win cheaply*. Verdict: **the floor as originally specified would be silently
bypassed by all four engineer archetypes**, because (a) the compliant `emit()`
facade didn't actually exist — the package ships an 8-field `publishEnvelope`
opts-bag, *more* expensive than raw `nats.publish`; (b) the reward (cross-repo
coherence) accrued in a different repo than the cost; (c) the Redis side-door
(`stateManager.publish`) was a universal bypass; (d) the pilot's producer (sonar)
was cross-repo and un-lintable — the worst adoption choice.

**THE ONE THING** (council's words): *"Ship the `emit(SchemaId, payload)` facade —
the one promised in the floor — and codemod the grandfathered 11 onto it, BEFORE
you sharpen any lint."*

Operator decision: **"Absorb all 8 — adoption IS the cycle."** → FR-ADOPT-1..8 +
G-7 + NFR-Ergo-1/2, co-equal with the floor. The reframe: cycle-1 is not "build
the floor," it is "build the floor AND its on-ramp so it actually gets used."

Pilot decision (operator: *"Go with what Gygax would suggest"*): **re-pilot
in-repo** — put the lint where the emits are written; the sonar cross-repo pilot
becomes its own cycle (§10). Already reflected in FR-10 + NG-8.

---

*Generated via /simstim Phase 1 (DISCOVERY); revised by Phase 2 (Flatline,
3-model) → §11; reconciled with the enforcement-locus protocol panel
(soundness-only win) and the adoption council (§12) — 2026-05-31. Next: Phase 3 —
Architecture (SDD). Forks resolved in preplanning; see crystallization brief for
provenance.*
