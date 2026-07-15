# Sprint Plan — Public Gate Leak Lifecycle

**Cycle:** public-gate-leak-lifecycle
**Traces:** `grimoires/loa/prd.md` (G-1..G-6, FR-1..FR-10), `grimoires/loa/sdd.md` (§2–§7),
`grimoires/loa/context/2026-07-15-gate-leak-grounding.md`.
**Domain:** `shared` (shadow-audit + ordering). Commit scope: `shared/gate-leak`.
**Execution:** `/run sprint-plan`, run-bridge depth 3, allow-high. Stacked draft PR → `feat/shadow-audit-mvp`.

> Sequencing is strict: **S0 gates S1**; S1 gates S2/S3 (they need the durable EventStore). Each task ships
> with a runnable check that FAILS if its logic breaks (Karpathy #4). Contract tests first where a schema is
> the contract. No task widens `CommunityOnboardingInputs` or introduces Effect-TS.

---

## Sprint 0 — Verify-First Baseline (R-1)

**Goal:** establish a clean, honest baseline before extending the drifted `ordering` preset. No feature code.

| Task | Acceptance criteria | Traces |
|------|---------------------|--------|
| S0-T1 | Run base-branch `@freeside/ordering-protocol` + `shadow-audit` test suites; record pass/fail honestly. | R-1 |
| S0-T2 | Resolve the `preset.ts` `metadata_snapshot`/`metadata-snapshot` drift [grounding §D]: EITHER reconcile the 5-step source to the canonical 6-step form its tests+orchestrator require, OR confirm the new `gate-leak` preset can be added without touching the drifted recipe. Decision + rationale recorded in the PR. | R-1 |
| S0-T3 | Confirm a live Postgres is reachable for round-trip/fail-loud tests (or provision an ephemeral one in CI). | G-1 dep |

**Gate:** baseline test state known and green (or drift explicitly quarantined) before S1 touches shared files.

---

## Sprint 1 — Durable EventStore + Public Run Registration (G-1, G-2)

**Goal:** the EventStore is Postgres-backed and fail-loud; public runs are registered so feedback binds.

| Task | Acceptance criteria | Traces |
|------|---------------------|--------|
| S1-T1 | `sql/0002_public_gate_leak.sql` forward migration adds `public_gate_leak_runs` + `gate_leak_attention` + `gate_leak_subject` (SDD §3), additive only; applies idempotently on boot. Test: migration runs twice, no error. | FR-1, FR-10 |
| S1-T2 | `PostgresEventStore implements EventStore` (`event-store-postgres.ts`), append-only, `.strict()` + member-free, reusing existing drizzle/`postgres` dep. **Round-trip test**: `appendRunEvent`→`getRun` and `appendContact` (unknown run_id rejected) through the REAL adapter, read by the reader's path — not the in-memory double. | FR-1, R-3, G-1 |
| S1-T3 | Fail-loud wiring in `server.ts` + `bin/http.ts`: durable-required + `DATABASE_URL` present → Postgres (run migrations on boot); durable-required + absent → **throws before serve**; InMemory stays explicit dev/test default. Test: missing-URL startup throws; present-URL selects Postgres. | FR-2, G-1, G-6 |
| S1-T4 | Register the public run (success + typed refusal) at delivery via the existing `recordRun` path; idempotent on `run_id`; `RunEventSchema` stays member-free. Test: a public `run_id` resolves via `getRun`. | FR-3, G-2, R-3 |
| S1-T5 | Feedback binding: `POST /v1/audit/reaction` + `/contact` bound to a public `run_id` succeed within the run window (previously 404). Test: register → react/contact resolve; expired window → 404. | FR-3, G-2 |

**Gate:** round-trip + fail-loud + binding tests green; no member field reaches the store.

---

## Sprint 2 — Semantic Prerequisite + Projection + Attention (G-3, G-5)

**Goal:** honest resumable `needs_input`; typed public projection; privacy-safe attention.

| Task | Acceptance criteria | Traces |
|------|---------------------|--------|
| S2-T1 | Typed `needs_input(access_started_at)` on the public path (add to refusal enum / sibling typed-state + `REFUSAL_HTTP_STATUS`). Resolution order: caller input → ratified registry access-start → `needs_input`; NEVER silently choose a date. Test: valid collection, no access-start → typed `needs_input` with `required_input:'access_started_at'`. | FR-4, G-3 |
| S2-T2 | Resumability: a POST variant carrying `access_started_at` continues the SAME journey to `delivered_e1` without re-submitting; added input modeled as an appended event, prior input digest preserved. Test: needs_input → supply → delivered_e1, no digest mutation. | FR-4, G-3 |
| S2-T3 | Public journey projection schema (`protocol/shadow-audit/public-journey.ts`) enumerating `submitted → resolving_subject → indexing → needs_input → computing → delivered_e1 → refused | unavailable`; pure mapper (ordering state × compute outcome), no member data. Minimal internal poll to read it (NOT the dashboard BFF). Test: each state maps correctly; `unavailable` on durable-down. | FR-7, G-5 |
| S2-T4 | Append-only attention events (`AttentionEvent` `.strict()`, member-forbidden) on every path: subject `(chain_id,contract_address)` + `journey_token` + `kind`. Test: a known-bad payload with wallet/email/free-text/sub-k denominator is rejected/absent (R-2). | FR-8, G-5, R-2 |
| S2-T5 | Privacy sweep: enumerate ALL exit channels (200 E1, refusal, needs_input, attention, poll, logs); each pinned member-free + sub-k-safe by a known-bad regression test, not a comment. | R-2, G-5 |

**Gate:** resume test + every-exit-channel privacy tests green.

---

## Sprint 3 — Anonymous Intake + Narrow Join + Idempotency (G-4, G-6)

**Goal:** a valid unknown collection becomes a durable interest observation, contact optional, without
corrupting immutable inputs.

| Task | Acceptance criteria | Traces |
|------|---------------------|--------|
| S3-T1 | New `gate-leak` product in `ProductId` union + `GateLeakInputs` `.strict()` schema (contact OPTIONAL; `source:'public_gate_leak'`; `access_started_at?`, `attribution?`). `CommunityOnboardingInputs` untouched. Test: anonymous (no email) input parses; a `dashboard_onboarding` source is NOT required. | FR-5, G-4 |
| S3-T2 | `gate-leak` preset recipe (resolve-subject → index-collection[unknown only] → compute-gate-leak) rides the existing lifecycle + outbox; unknown-but-valid contract → durable `indexing` observation instead of void refusal. Test: valid unknown contract yields a durable order + subject, no `unindexed-contract` dead-end. | FR-5, G-4 |
| S3-T3 | Narrow `order_id`-keyed join from gate-leak → `community-onboarding` as an appended event/transition; attaches contact/notification/claim intent later. Test: join never mutates either `inputs`/`inputs_digest`. | FR-6, G-4, R-1 |
| S3-T4 | Idempotency vs demand: expensive work (index/compute) deduped by subject+inputs_hash key; distinct-journey demand keyed to distinct `journey_token`. **Single test asserts BOTH**: replay reuses work AND two distinct journeys each count once. | FR-9, G-6, R-4 |
| S3-T5 | Anti-abuse + drain: reuse existing per-IP + cache + identity-independent global budget; ensure the gate-leak path does not assume an already-running outbox drain [grounding §B] — invoke `publishOutbox` inline or add the scheduler in scope (smaller wins; disclosed in PR). Test: budget bound holds; outbox event is published. | FR-10, G-6, R-5 |

**Gate:** immutability + idempotency-vs-demand + anti-abuse tests green.

---

## Cross-Sprint Definition of Done

- All G-1..G-6 acceptance metrics (PRD §2) demonstrably met by a runnable test.
- Zero changes to dashboard, payments, artifact history, CRM, or member-level surfaces (Non-Goals §5).
- No Effect-TS introduced; no `CommunityOnboardingInputs` widening; no in-memory stub masquerading as durable.
- Every new invariant pinned by a known-bad regression input.
- Stacked draft PR → `feat/shadow-audit-mvp`, commit scope `shared/gate-leak`, PR body notes the S3 drain
  decision + the S0 drift resolution.
