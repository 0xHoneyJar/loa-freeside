# PRD — Public Gate Leak Lifecycle (the first free rung)

**Version:** 1.0
**Date:** 2026-07-15
**Cycle:** public-gate-leak-lifecycle
**Domain:** `shared` (composes the `shadow-audit` + `ordering` buildings; no platform/network cross)
**Branch:** `feat/public-gate-leak-lifecycle`, stacked on `origin/feat/shadow-audit-mvp`
**Author:** simstim discovering-requirements (autonomous cycle `simstim-20260715-008e0d78`)

> **Sources this PRD traces to:**
> `grimoires/loa/context/2026-07-15-public-gate-leak-lifecycle-seed.md` (the operator seed),
> `grimoires/loa/context/2026-07-15-gate-leak-grounding.md` (two `file:line`-anchored grounding passes over
> `shadow-audit` + `ordering`). Every architectural claim below is grounded there, not inferred.

---

## 1. Problem & Vision

**The move (operator seed):** *Freeside's first sellable moment is a free, login-less "Gate Leak Preview".*
A visitor pastes an NFT contract address and — when the prerequisites exist — gets an honest, aggregate,
k-anonymous read of how much access has leaked (holders who qualified at a snapshot but have since sold/lapsed).
Value precedes signup. Contact, auth, and claim are optional follow-ons. The primary next action after this
rung is **Enhance → Holder Role Drift**; paid monitoring/history, x402, credits, CRM, and member-level
artifacts are explicitly out of scope.

**Why now (grounded reality):** the compute already exists. `shadow-audit` ships a public, unauthenticated,
registry-gated, k-anonymous `GET /v1/access-risk` that returns a `run_id`, `inputs_hash`, and an explicit
on-chain upper-bound disclosure [grounding §A]. `ordering` ships a durable `placed→routing→producing→
fulfilled/failed` lifecycle with a Postgres transactional outbox [grounding §B]. What is missing is the thin
*lifecycle around the free rung*: a valid submission today is either answered ephemerally (no durable record,
no feedback binding) or **refused before any interest is ever observed**. The cluster's signature failure is
substrate shipping without a durable, honest consumer path — this cycle closes that for the public entrance.

**The cycle problem (the cure):** make a valid, login-less submission a *first-class durable observation* —
answered honestly when it can be, resumably parked when a semantic prerequisite is missing, and privacy-safely
counted as demand either way — **without** corrupting the existing k-anon/refusal invariants, without
member-level data in shared events, and without collapsing a report run into an onboarding order.

**Scope discipline:** this is the *smallest canonical backend lifecycle* needed to later hang a dashboard BFF
slice on. It builds no UI, no payments, no immutable artifact history, no member-level exports, no graph
enrichment beyond a validated `(chain_id, contract_address)` subject + bounded aggregate interest.

---

## 2. Goals & Success Metrics

| ID | Goal | Success metric |
|----|------|----------------|
| **G-1** | **Durable, fail-loud EventStore.** A Postgres `EventStore` adapter for `shadow-audit`, wired fail-loud in production. | `PostgresEventStore implements EventStore` round-trips `appendRunEvent`/`appendContact`/`getRun` through the real adapter (read back by the reader's path, not a stub); production wiring refuses startup when the durable store is required but `DATABASE_URL` is absent; no in-memory store masquerades as a durable run. Closes seed gap 5. |
| **G-2** | **Public runs are registered; feedback binds.** A successful or refused public Gate Leak attempt is registered so reaction/contact can bind to its `run_id`. | A `run_id` returned by the public path is resolvable by `getRun`; `POST /v1/audit/reaction` + `/contact` bound to a public `run_id` succeed within the run window instead of 404-ing. Closes seed gap 4. |
| **G-3** | **Honest semantic-prerequisite state.** When a contract alone cannot establish access-start, the public path returns a typed, resumable `needs_input(access_started_at)` state — never a silently chosen date called "Gate Leak". | For a valid collection with no ratified access-start, the public path returns a typed `needs_input` projection (not a 200 answer, not an opaque 400); supplying `access_started_at` resumes to a delivered E1 without re-submitting. Closes seed gap 1. |
| **G-4** | **Anonymous intake for valid-but-unknown collections.** A valid submission for a collection not yet in the registry creates a durable interest/onboarding observation instead of being refused into the void — contact optional, source/attribution explicit. | A valid unknown contract yields a durable `indexing` observation via a new anonymous-friendly ordering preset (contact NOT required; explicit non-dashboard `source`), **without** widening `CommunityOnboardingInputs` or mutating any immutable input digest. Closes seed gaps 2 + 3. |
| **G-5** | **Typed public lifecycle projection + privacy-safe attention.** A short, typed projection distinguishing the public journey states, plus append-only attention/demand events that carry a canonical subject but no member/wallet/email/IP. | The projection enumerates at least `submitted → resolving_subject → indexing → needs_input(access_started_at) → computing → delivered_e1 → refused | unavailable`; attention events contain a `(chain_id, contract_address)` subject + bounded aggregate interest and are schema-forbidden from carrying raw wallets, roles, holdings, free-text, email, or IP. Closes seed gaps 6 + 7 (contract only; dashboard BFF is a later cycle). |
| **G-6** | **Idempotency, anti-abuse, migrations, contract tests — the invariants hold.** Retries reuse expensive work; distinct human journeys still contribute bounded aggregate demand; existing k-anon/cache/global-budget/union/typed-refusal invariants remain intact; production fails closed when durable upstream is unavailable. | Idempotent replay of a submission does not duplicate indexing/compute yet distinct journeys increment aggregate interest; a known-bad regression input pins each invariant; migrations apply cleanly; contract tests cover the new schemas; no public path silently degrades to an in-memory stub. |
| **G-7** *(amendment 2026-07-15)* | **Public interaction transport — bounded feedback + enhance-intent.** A login-less caller holding a public Gate Leak run's `run_id` + server-issued `journey_token` capability can durably register a bounded `feedback` (reaction enum) or `enhance_intent` (CTA-target enum) demand signal against that run's canonical subject — closing the gap where `AttentionKindSchema` names `enhance_intent`/`feedback` and §2 names "willingness-to-advance", yet no route ever emits them and the only public reaction transport (`POST /v1/audit/reaction`) hard-codes the internal `dogfood-full` mode. | A dedicated public interaction route derives the subject **and** `public-gate-leak` mode from the registered run (never the caller); appends the matching `feedback`/`enhance_intent` attention kind, idempotent on `(journey_token, kind)`, plus the bounded value as a `public-gate-leak` `RunEvent`; rejects missing/malformed/mismatched-capability/expired/non-public runs fail-closed; a durable read-back proves a `public-gate-leak` `feedback`/`enhance_intent` attention event bound to the run's subject + capability — no wallet/email/IP/free-text/role/holding/browser-controlled `subject`/`placed_by`. Leaves the internal `dogfood-full` reaction/contact behavior unchanged. |

> Metrics are **evidence layers, not one funnel** (seed): proof-of-interest (G-4/G-5), proof-of-delivered-value
> (G-2/G-3), and proof-of-willingness-to-advance (Enhance intent) stay separately measurable.

---

## 3. Users & Stakeholders

- **Anonymous visitor** — pastes a contract, expects honest value or an honest "not yet / need one more thing",
  with no login. Primary user.
- **Returning/claiming user** — later attaches contact, notification, or claim intent to a prior run; must find
  the run still bound.
- **Community operator (subject)** — the collection being observed; a submission is *interest*, never an
  assertion of ownership, membership, or gate semantics about them.
- **Downstream dashboard BFF (future consumer)** — a later cycle consumes this typed projection; this cycle
  ships the upstream contract it will bind to, not the page.
- **Freeside platform** — owns k-anon / privacy / budget invariants that this cycle must not weaken.

---

## 4. Functional Requirements

| ID | Requirement | Traces |
|----|-------------|--------|
| FR-1 | Provide a `PostgresEventStore` implementing the existing `EventStore` port (`appendRunEvent`, `appendContact`, `getRun`) over `sql/0001_shadow_audit_events.sql` (+ a forward migration for public-run + telemetry columns), preserving append-only + no-member-field invariants. | G-1 |
| FR-2 | Wire the durable EventStore fail-loud in production: when durability is required, absence of `DATABASE_URL` refuses startup; `InMemoryEventStore` remains the explicit dev/test default only. | G-1, G-6 |
| FR-3 | Register the public Gate Leak run (success **and** typed refusal) in the EventStore at delivery time so its `run_id` is resolvable by `getRun` and by the reaction/contact routes. | G-2 |
| FR-4 | Add a typed `needs_input(access_started_at)` state to the public path for a valid collection lacking a ratified access-start; make it resumable (supplying the input continues the same journey to a delivered E1) without silently choosing a date. | G-3 |
| FR-5 | Introduce a new anonymous-friendly `gate-leak` product/preset in `protocol/ordering` (contact optional; explicit `source`/attribution; `.strict()`) that rides the existing order lifecycle to index a valid-but-unknown collection and produce a durable subject/interest observation. | G-4 |
| FR-6 | Define the narrow `order_id`-keyed join from a gate-leak observation into `community-onboarding` (attach contact/notification/claim intent later as an appended event/transition) — never by widening `CommunityOnboardingInputs` or mutating an input digest. | G-4 |
| FR-7 | Define a short typed **public lifecycle projection** enumerating the seed journey states and a minimal internal poll to read it (the dashboard-owned public POST/poll BFF is explicitly deferred). | G-5 |
| FR-8 | Emit append-only, privacy-safe **attention/demand events** carrying a canonical `(chain_id, contract_address)` subject + bounded aggregate interest; schema-forbid raw wallets, roles, holdings, free-text feedback, email, IP. | G-5, G-6 |
| FR-9 | Separate idempotent work reuse from demand measurement: a replayed submission reuses indexing/compute (no duplicate expensive work) while distinct journeys still contribute bounded aggregate interest. | G-6 |
| FR-10 | Ship migrations, anti-abuse bounds (reuse the existing cache + identity-independent global budget; do not regress k-anon), and contract/round-trip tests — each new invariant pinned by a known-bad regression input. | G-6 |
| FR-11 *(amendment 2026-07-15)* | Add the smallest public **interaction** route (`POST /v1/access-risk/:runId/interaction`), authenticated by the run's `run_id` + server-issued `journey_token` capability. Body is a strict discriminated union — `feedback` → a bounded reaction enum (`ReactionSchema`); `enhance_intent` → a bounded CTA-target enum (`CtaInteractionSchema`, previously defined-but-unused) — with NO wallet/email/IP/free-text/role/holding/`subject`/`placed_by`. The route derives the subject from the durable public run, appends the matching `AttentionKind` (idempotent on `(journey_token, kind)`) **and** persists the bounded value as a `public-gate-leak` `RunEvent`; it is fail-closed on missing/malformed/mismatched-capability/expired/non-public runs and does not alter the existing internal `dogfood-full` `/v1/audit/reaction` + `/contact`. | G-7, G-5, R-2 |

---

## 5. Non-Goals (hard boundary — seed Build Boundary)

- ❌ Dashboard page, animation, lead-magnet UI, account-claim UI.
- ❌ Payments, x402, credits, paid monitoring/history.
- ❌ Canonical immutable report artifacts / history; member-level E3 exports.
- ❌ Graph enrichment beyond a validated subject/interest observation.
- ❌ The public **address-based POST/poll dashboard BFF** (later dashboard-owned cycle — this cycle ships only
  the upstream typed contract it will consume).
- ❌ Widening `CommunityOnboardingInputs`, or routing the anonymous journey through the onboarding recipe
  (grounding §C: structurally unsafe).
- ❌ Introducing Effect-TS into `shadow-audit` or `ordering` (both are Zod + plain-TS; grounding §A/§B).
- ❌ Gemini / Grok-via-Cursor / Cursor model routes (this cycle: Codex + Claude + Grok-headless only).

---

## 6. Technical Constraints (grounded)

- **Compose, don't fork.** Prefer composition of the existing Ordering + Shadow-Audit lifecycles over a third
  independent lead-magnet queue (seed). New `gate-leak` preset rides the existing order lifecycle + outbox.
- **Immutable validated inputs.** Preserve them or model later input as an explicit event/transition; never
  mutate an input digest invisibly (grounding §B: `inputs_digest` excluded from `OrderPatch`).
- **Privacy is a hard invariant.** No raw member wallets/roles/holdings/free-text/email/IP in shared
  attention/graph events. Existing k-anon, cache, global budget, union semantics, typed refusals stay intact.
- **A submission is not an assertion.** A product-interest observation may create/reference a canonical
  `(chain_id, contract_address)` subject but may not assert community ownership, membership, identity, or gate
  semantics.
- **Fail closed.** Public production paths fail closed when durable upstream services are unavailable; no
  in-memory stub may masquerade as a queued/durable run.
- **Match the idiom.** async-Promise + Zod + discriminated-union result unions + tagged-refusal (Zod enum +
  `REFUSAL_HTTP_STATUS` map). Follow Effect only where a package already uses it (neither of these does).
- **Short, typed, strict, readable** contracts/policies — a human reviewer must be able to read them.

---

## 7. Risks & Dependencies

| Risk | Severity | Mitigation |
|------|----------|------------|
| **R-1: base-branch `ordering` preset drift.** `protocol/ordering/src/preset.ts` is stale vs its own tests + orchestrator (missing `metadata_snapshot`/`metadata-snapshot`) [grounding §D]. Extending `preset.ts` against a stale recipe would reason against a wrong shape. | High | Sprint 0 step: confirm base-branch `ordering-protocol` test state *before* extending; if red, reconcile the drift as a scoped prerequisite or add the new preset without disturbing the drifted recipe. Verify-first; do not scope-creep an unrelated fix. |
| **R-2: privacy leak via a sibling channel.** k-anon on the aggregate can leak through a refusal string, error path, telemetry event, or the new projection (cf. prior sub-k leak through refusal prose). | High | Enumerate every exit channel (200, typed refusal, `needs_input`, attention event, poll projection, logs) and pin the no-member/no-sub-k-denominator invariant as a schema `.strict()` + a known-bad regression test, not a comment. |
| **R-3: teaser-run registration widening the run schema with member data.** Registering public runs must not smuggle member fields into `RunEvent`. | Med | Keep `RunEventSchema` `.strict()` + member-field-free; add only aggregate/telemetry columns; round-trip test through the real Postgres adapter (read back by the reader's path). |
| **R-4: retries inflating demand OR dedup erasing distinct journeys.** | Med | Idempotency key on expensive work (index/compute) keyed to the subject; distinct-journey demand keyed to a distinct order_id/journey token; a test asserts both properties on the same replay. |
| **R-5: scope creep into the dashboard/payments.** | Med | Non-Goals §5 are enforced by the sprint acceptance criteria; the projection is a contract + internal poll only. |
| **Dependency:** live Postgres for the round-trip + fail-loud tests; the existing `shadow-audit` registry + `access-risk` compute; the `ordering` outbox drain (note: no scheduler wires `publishOutbox` in `bin/` today — the gate-leak lifecycle must not assume an already-running drain [grounding §B]). | — | — |

---

## 8. Acceptance (cycle-level)

The cycle is done when: a valid login-less submission for a **known** collection with a ratified access-start
delivers a durable, feedback-bindable E1; the same for a collection **missing** access-start returns a typed
resumable `needs_input`; a valid **unknown** collection creates a durable anonymous interest/indexing
observation instead of a void refusal; every path emits privacy-safe attention with a canonical subject and no
member data; the EventStore is Postgres-backed and fail-loud in production; and every new invariant is pinned by
a known-bad regression test — all with zero changes to the dashboard, payments, artifact history, CRM, or
member-level surfaces.
