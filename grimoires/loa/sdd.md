# SDD — Public Gate Leak Lifecycle

**Version:** 1.0
**Date:** 2026-07-15
**Cycle:** public-gate-leak-lifecycle
**Traces:** `grimoires/loa/prd.md` (FR-1..FR-10, G-1..G-6),
`grimoires/loa/context/2026-07-15-gate-leak-grounding.md` (all `file:line` seams),
`grimoires/loa/context/2026-07-15-public-gate-leak-lifecycle-seed.md` (operator seed).

> **Grounded-reality rule:** every `path:line` in this SDD is copied from the grounding pass. Implementation
> agents MUST re-open the cited file before editing; if the seam has moved, re-ground — do not patch from
> plausibility ([[grounding]], [[ground-on-origin-not-the-local-checkout]]).

---

## 1. Design Overview

The public Gate Leak lifecycle is a **composition of two existing buildings**, not a third queue:

- **`shadow-audit`** owns the E1 *compute* (`GET /v1/access-risk`), the append-only `EventStore`, and
  feedback binding. This cycle makes its EventStore **durable + fail-loud**, **registers public runs**, and
  adds a typed **`needs_input(access_started_at)`** state on the public path.
- **`ordering`** owns the durable `placed→routing→producing→fulfilled/failed` lifecycle + Postgres outbox.
  This cycle adds a new **anonymous-friendly `gate-leak` preset** that indexes a valid-but-unknown collection
  and produces a durable subject/interest observation, joined to `community-onboarding` only by `order_id`.

A thin **public lifecycle projection** maps internal ordering states + shadow-audit compute outcomes onto the
seed's public journey states, and **append-only attention events** carry a canonical subject + bounded
aggregate demand with **no member data**.

```
                          ┌───────────────────────── shadow-audit (Hono+Zod, no Effect) ─────────────────────────┐
 visitor submits          │  GET/POST public gate-leak path                                                       │
 (chain, contract,        │   ├─ registry known?  ── yes ─► access-start ratified? ── yes ─► computeAccessRisk ──►│─► delivered_e1
  access_started_at?) ───►│   │                                     └─ no ─► needs_input(access_started_at) ◄─────│    (run registered
                          │   │                                                      (resumable)                   │     → feedback binds)
                          │   └─ no (valid but unknown) ─────────────────────────────────────┐                    │
                          │  EventStore (append-only): PostgresEventStore ⟵ fail-loud wiring   │                    │
                          └────────────────────────────────────────────────────────────────┼────────────────────┘
                                                                                            ▼
                          ┌──────────────────────── ordering (Zod+plain TS, no Effect) ─────────────────────────┐
                          │  NEW `gate-leak` preset: placed→routing→producing(index)→fulfilled  (contact optional)│
                          │  outbox tx; idempotency key on index/compute; order_id join → community-onboarding    │
                          └──────────────────────────────────────────────────────────────────────────────────────┘
        every path ─► append-only attention event { subject:(chain_id,contract_address), demand:bounded }  (NO member data)
        every path ─► public lifecycle projection { submitted | resolving_subject | indexing | needs_input | computing | delivered_e1 | refused | unavailable }
```

**Ownership rule (seed):** the dashboard is a medium-specific projection and does **not** own canonical report
runs, artifacts, or graph truth. This cycle ships the upstream contracts; the dashboard BFF is a later cycle.

---

## 2. Component Design

### 2.1 `PostgresEventStore` (FR-1, FR-2 · G-1)

**Location:** `packages/services/shadow-audit/src/event-store-postgres.ts` (new), sibling to the existing
`event-store.ts` `InMemoryEventStore` [grounding §A].

**Implements** the existing port verbatim [obs `event-store.ts:47-55`]:
```ts
interface EventStore {
  appendRunEvent(event: RunEvent): Promise<void>;   // append-only
  appendContact(record: ContactRecord): Promise<void>; // rejects unknown run_id
  getRun(runId: string): Promise<{ ts: string; inputs_hash: string } | undefined>;
}
```
- Backed by `sql/0001_shadow_audit_events.sql` + a **forward migration** `sql/0002_public_gate_leak.sql`
  (adds public-run + telemetry + subject/attention tables — §2.5, §2.6). Uses the same drizzle/`postgres`
  dependency already present for the role store [obs `role-store-postgres.ts`]; **no new DB library**.
- `appendContact` preserves the port contract: look up `getRun(run_id)` first; reject unknown run_id (mirrors
  `InMemoryEventStore` [obs `:58-85`]).
- **Invariants preserved:** `RunEventSchema`/`ContactRecordSchema` stay `.strict()` + member-field-free; the
  adapter never writes a column not in the Zod schema. Append-only: INSERT only, no UPDATE/DELETE.
- **Round-trip test (mandatory):** append via the adapter, read back via `getRun` **through the adapter's own
  read path** — not a stub, not the in-memory double ([[test-the-seam-not-the-stub]], [[fakes-pass-live-finds-it]]).

**Fail-loud wiring (FR-2):** in `src/server.ts` (currently `eventStore: new InMemoryEventStore()` [obs `:178`])
and `bin/http.ts` — select the store like the role store already does [obs `bin/http.ts:151-160`]:
- production/durable-required + `DATABASE_URL` present → `PostgresEventStore` (run migrations on boot, as
  `PostgresOrderStore.runMigrations()` does [grounding §B]).
- durable-required + `DATABASE_URL` absent → **refuse startup** (throw before `serve`), never silently
  fall back. `InMemoryEventStore` remains the explicit **dev/test** default only.

### 2.2 Public run registration (FR-3 · G-2)

**Problem** [grounding §A]: `/v1/access-risk` returns at `audit-router.ts:342` without `recordRun`, so the
teaser `run_id` (`risk_…`) has no backing event and reaction/contact 404 at `getRun`.

**Change:** at public delivery time (both a successful E1 **and** a typed refusal that yields a `run_id`), call
`appendRunEvent` with an aggregate, member-free `RunEvent` reusing the computed `inputs_hash`. Reuse the
existing `recordRun` helper path [obs `audit-router.ts:171-179`] rather than a parallel writer. Registration is
**idempotent on `run_id`** (append-only store keyed by run_id; a replayed identical submission with the same
`inputs_hash:nowUnixSeconds` yields the same run_id and must not double-count demand — §2.6).

After this, `POST /v1/audit/reaction` + `/contact` bind to a public `run_id` within the run window [obs
`:449-491`] with no other change.

### 2.3 `needs_input(access_started_at)` typed state (FR-4 · G-3)

**Problem** [grounding §A]: the public path requires `snapshot_date` and has **no `needs-input` refusal**;
`needs-input` semantics exist only in the authed mode-resolver (`external-mode`, `mode-resolver.ts:81-83`).

**Design:** the public path resolves access-start in this order, and NEVER silently picks a date:
1. If the caller supplies `access_started_at` → use it as `snapshot_date` → compute.
2. Else if the collection has a **ratified gate/access-start** in the registry → derive it → compute.
3. Else → return a typed, resumable **`needs_input(access_started_at)`** projection state (NOT a 200 answer,
   NOT an opaque 400). Add `needs-input` to the refusal enum / a sibling typed state so it carries a stable
   wire status and a machine-readable `required_input: 'access_started_at'`.

**Resumability:** the `needs_input` projection returns a `journey`/`run` handle; a follow-up supplying
`access_started_at` continues the SAME journey to `delivered_e1` without re-submitting the address. The prior
input digest is preserved; the added input is modeled as an **appended event/transition**, never an in-place
mutation (grounding §B immutable-inputs precedent).

**Privacy:** `needs_input` and every refusal string are member-free and sub-k-denominator-free (R-2).

### 2.4 `gate-leak` ordering preset (FR-5, FR-6 · G-4)

**Location:** `packages/protocol/ordering/src/preset.ts` (add a new preset next to
`COMMUNITY_ONBOARDING_PRESET`) — **without** widening `CommunityOnboardingInputs` (grounding §C: structurally
unsafe). ⚠️ **R-1 first:** confirm base-branch `ordering-protocol` tests pass before touching `preset.ts`; if
the `metadata_snapshot` drift [grounding §D] makes them red, reconcile it as a scoped prerequisite or add the
new preset in a way that does not disturb the drifted recipe.

**New product id** in the `ProductId` union [obs `order.ts:8-15`]: `'gate-leak'`.

**Anonymous-friendly input schema** (`.strict()`, contact OPTIONAL, explicit non-dashboard source):
```ts
const GateLeakInputs = z.object({
  chain_id: z.string().min(1),
  contract_address: z.string().min(1),
  access_started_at: z.string().date().optional(),   // absent → needs_input downstream
  source: z.enum(['public_gate_leak']),              // NOT 'dashboard_onboarding'
  attribution: z.string().min(1).optional(),         // referrer/campaign, no PII
  contact_email: z.string().email().optional(),      // OPTIONAL — value precedes signup
}).strict();
```

**Recipe** (rides the existing lifecycle; minimal — this is the free rung, not the full onboarding recipe):
```
resolve-subject   → canonical (chain_id, contract_address) subject (no ownership assertion)
index-collection  → only when registry-unknown (reuses the sonar collection-index capability)
compute-gate-leak → calls shadow-audit access-risk compute (or needs_input)
```
- A **known** collection with ratified access-start may short-circuit index and deliver E1 directly through
  shadow-audit; ordering is engaged for the **unknown-but-valid** case (durable indexing + interest) so the
  submission is never a void refusal (closes gap 2/3).
- **Contact optional:** the preset produces its interest observation with no `contact_email`; a later
  `community-onboarding` join attaches contact/notification/claim intent (FR-6).

**Narrow join (FR-6):** a `gate-leak` order's result references a `community-onboarding` order by `order_id`
via a typed `join`/`result_ref` — added as an appended event, never by mutating either order's immutable
`inputs`/`inputs_digest` [grounding §B]. No preset input is widened.

### 2.5 Public lifecycle projection (FR-7 · G-5)

**Location:** `packages/protocol/shadow-audit/` (a new `public-journey.ts` schema) + a minimal internal read in
`shadow-audit` service. **Not** the dashboard BFF (deferred).

**Typed states** (Zod enum; the seed's model, discriminated union with state-specific payloads):
```ts
type PublicJourneyState =
  | 'submitted' | 'resolving_subject' | 'indexing'
  | { needs_input: 'access_started_at' }
  | 'computing' | 'delivered_e1' | 'refused' | 'unavailable';
```
- The projection is a **pure mapper** from (ordering `OrderState` + ingredient checklist) × (shadow-audit
  compute result / refusal) → `PublicJourneyState` — mirroring the existing `projection.ts` redaction-mapper
  pattern [grounding §B, `projection.ts:11-29`]. No member data crosses it.
- Read via a minimal internal poll (analogous to `GET /v1/orders/:id` [obs `intake.ts:155-160`]); the public
  address-based POST/poll BFF is the later dashboard cycle (Non-Goal §5).
- `refused` carries the typed refusal code; `unavailable` is the fail-closed state when durable upstream is
  down (never a masquerading in-memory stub).

### 2.6 Attention / demand events (FR-8, FR-9 · G-5, G-6)

**Location:** `packages/protocol/shadow-audit/` attention schema + a table in `sql/0002_public_gate_leak.sql`.

**Schema (`.strict()`, member-forbidden):**
```ts
const AttentionEvent = z.object({
  subject_chain_id: z.string().min(1),
  subject_contract_address: z.string().min(1),   // canonical (chain_id, contract) subject
  journey_token: z.string().min(1),              // opaque; distinguishes distinct journeys
  kind: z.enum(['submitted','delivered_e1','needs_input','refused','enhance_intent','feedback']),
  ts: z.string().datetime(),
}).strict();                                       // .strict() STRUCTURALLY forbids wallets/roles/email/IP/free-text
```
- A canonical subject may be created/referenced but **asserts no ownership/membership/identity/gate semantics**
  (seed constraint; enforced by the schema carrying only chain_id+contract).
- **Idempotency vs demand (FR-9):** expensive work (index/compute) is deduped by an **idempotency key keyed to
  the subject + inputs_hash** (mirrors `ingredientJobIdempotencyKey` [grounding §B, `kitchen.ts:103-105`]) so a
  retry reuses work; **distinct-journey demand** is keyed to a distinct `journey_token` so two different humans
  submitting the same collection each count once, but one human's retry does not. A single test asserts **both**
  properties on the same replay (R-4).

---

### 2.7 Public interaction transport (FR-11 · G-7) — *amendment 2026-07-15*

**Problem** [grounding, this cycle]: `AttentionKindSchema` (`public-journey.ts`) admits `enhance_intent` +
`feedback`, and `gate_leak_attention.kind`'s CHECK already lists both — but the router's local `attention()`
helper only accepts the four *automatic* lifecycle kinds, so **no route ever emits `enhance_intent`/`feedback`**.
The only public reaction transport, `POST /v1/audit/reaction`, hard-codes `mode: 'dogfood-full'` and binds via
`getRun` (the internal dogfood store), so it is **not** a public Gate Leak feedback channel. `CtaInteractionSchema`
(`event-store.ts`) is defined-but-unused. This section closes that seam **without** widening the EventStore port
or the schemas — every durable primitive already exists.

**Route:** `POST /v1/access-risk/:runId/interaction` (sibling of the existing `:runId/resume` + `:runId` poll).

**Request contract** (`.strict()` discriminated union; reuses existing service enums, no new payload fields):
```ts
// feedback  → the bounded "does this match?" reaction (worse|expected|surprised)
// enhance_intent → the bounded willingness-to-advance CTA target (product|conversation)
z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('feedback'),       journey_token: z.string().min(1).max(128), reaction: ReactionSchema }).strict(),
  z.object({ kind: z.literal('enhance_intent'), journey_token: z.string().min(1).max(128), target:   CtaInteractionSchema }).strict(),
])
```
The `subject` and `run mode` are **derived from the durable run**, never accepted from the caller — the body has
no `subject`/`placed_by`/`chain`/`contract`, and `.strict()` structurally rejects any smuggled member/PII field.

**Capability + fail-closed order** (each step is a pinned known-bad regression input):
1. Rate-limit via the teaser limiter (shared with the other public routes).
2. Parse body → `400` on malformed / unknown discriminant / extra field.
3. `getPublicGateLeakJourney(runId)` → `404` if absent (a non-public / unknown `run_id` is not in this store — this
   is what makes "non-public runs fail-closed" structural, since dogfood runs live only in `getRun`).
4. `journey.journey_token === body.journey_token` → `404` on mismatch (no existence oracle for a caller without
   the capability).
5. `isRunWithinWindow(journey, now, runWindow)` → `404` when expired (same 24h window as reaction/contact).

**Durable writes** (both already on the `EventStore` port; **no port change**):
- `appendAttention({ subject: journey.subject, journey_token, kind, ts })` — the demand/proof event. Idempotent on
  `(journey_token, kind)`; returns `{ created }`.
- **Only when `created === true`**, `appendRunEvent({ run_id, mode: 'public-gate-leak', inputs_hash: journey.inputs_hash,
  reaction? | cta_interaction?, stale_set_size: 0, reruns: 0, ts })` — persists the bounded value under the run's
  **own** `public-gate-leak` mode (contrast the `dogfood-full` reaction handler).

**Retry semantics (explicit + tested):** attention idempotency is the anchor. A repeat interaction of the same
`(journey_token, kind)` returns `created=false` → the route writes **no** second `RunEvent` and replies `200
{ ok:true, deduplicated:true }` — a journey cannot inflate demand (or the aggregate) by retrying, and a differing
later value is a no-op, not an error (mirrors the `AttentionEvent` "counts once" contract, R-4). Attention is
written before the value row so the weakest-link proof (the demand event) is the durable half if a write is
interrupted.

**Untouched:** `POST /v1/audit/reaction` + `/v1/audit/contact` keep their `dogfood-full` behavior verbatim.

---

## 3. Data Model & Migrations (FR-1, FR-10)

New forward migration `packages/services/shadow-audit/sql/0002_public_gate_leak.sql` (additive; never alters the
existing `shadow_audit_run_events`/`shadow_audit_contacts` shape [grounding §A]):

| Table | Key columns | Purpose |
|-------|-------------|---------|
| `public_gate_leak_runs` | `run_id TEXT PK`, `inputs_hash CHAR(64)`, `subject_chain_id`, `subject_contract_address`, `outcome TEXT CHECK IN (delivered_e1, needs_input, refused, unavailable)`, `refusal_code TEXT NULL`, `ts TIMESTAMPTZ` | Durable public-run registration (FR-3); member-free. |
| `gate_leak_attention` | `id BIGSERIAL PK`, `subject_chain_id`, `subject_contract_address`, `journey_token TEXT`, `kind TEXT CHECK(...)`, `ts TIMESTAMPTZ`, `UNIQUE(journey_token, kind)` for idempotent demand | Append-only attention/demand (FR-8/FR-9); `.strict()`-mirrored, no member columns. |
| `gate_leak_subject` | `subject_chain_id`, `subject_contract_address`, `first_seen_ts`, `PRIMARY KEY(chain_id,contract_address)` | Canonical subject; no ownership fields. |

All CHECK constraints mirror the Zod enums (single source of wire truth, matching the existing
`REFUSAL_HTTP_STATUS` discipline [grounding §A]). Migrations apply idempotently on boot
(`runMigrations()` pattern [grounding §B]).

---

## 4. API / Contract Surface

| Method | Path | Building | Change |
|--------|------|----------|--------|
| GET/POST | public gate-leak entry (reuse/extend `/v1/access-risk` + a POST variant for `access_started_at` resume) | shadow-audit | Register run (FR-3); return typed `needs_input` (FR-4). Existing k-anon/cache/budget/refusal invariants unchanged. |
| POST | `/v1/audit/reaction`, `/v1/audit/contact` | shadow-audit | **No change** — now resolve because the public run is registered (FR-3). Keep `dogfood-full` mode. |
| POST | `/v1/access-risk/:runId/interaction` | shadow-audit | **New, minimal (FR-11 · amendment).** Capability = `run_id` + `journey_token`; strict `feedback`/`enhance_intent` union; derives subject + `public-gate-leak` mode from the durable run; appends `AttentionKind` + bounded value; fail-closed. |
| POST | ordering intake for `gate-leak` product | ordering | New preset (FR-5); anonymous-friendly; `.strict()`. |
| GET | internal poll for public journey projection | shadow-audit | New, minimal (FR-7); NOT the dashboard BFF. |

**Wire-status discipline:** `needs_input` gets a stable status via the refusal enum + `REFUSAL_HTTP_STATUS`
map extension (or a sibling typed-state map). No raw ad-hoc HTTP codes.

---

## 5. Security & Privacy (R-2, R-3 · hard invariants)

- **Every exit channel is member-free and sub-k-safe.** Enumerate and pin: `200` E1, typed refusal,
  `needs_input`, attention event, poll projection, and logs. `.strict()` schemas structurally forbid member
  fields; a known-bad regression input (a payload attempting to smuggle a wallet/email/sub-k denominator) must
  be **rejected/absent**, pinned by test (not a comment) — the sibling-channel-leak lesson
  ([[audit-the-sibling-channels]]).
- **k-anon preserved:** the new path reuses `computeAccessRisk`'s existing k-anon cohorting [grounding §A]; the
  registration/attention layer never re-publishes an exact sub-k denominator.
- **Anti-abuse:** reuse the existing per-IP (best-effort) + cache + identity-independent **global budget**
  [grounding §A]; the durable registration adds a per-subject idempotency key so abuse cannot inflate expensive
  work. Public paths stay unauthenticated (FR: value precedes signup).
- **Fail closed (R-5):** durable-upstream-down → `unavailable`, never an in-memory masquerade.

---

## 6. Testing Strategy (FR-10 · G-6)

| Layer | Test | Pins |
|-------|------|------|
| Round-trip | append→getRun through **real** `PostgresEventStore` (read by reader's path) | G-1, R-3 |
| Fail-loud | startup with durable-required + no `DATABASE_URL` **throws** | G-1, FR-2 |
| Feedback binding | register public run → reaction/contact resolve within window (previously 404) | G-2 |
| Semantic prereq | valid collection, no access-start → typed `needs_input`; supply → resumes to `delivered_e1` | G-3 |
| Anonymous intake | valid unknown contract → durable `indexing` observation, contact absent, `source:'public_gate_leak'`; `CommunityOnboardingInputs` untouched | G-4 |
| Immutability | join to community-onboarding never mutates either `inputs_digest` | G-4, R-1 |
| Privacy | each exit channel rejects/omits member data + sub-k denominator (known-bad inputs) | G-5, R-2 |
| Idempotency vs demand | replay reuses index/compute AND distinct journeys each count once | G-6, R-4 |
| Migration | `0002` applies idempotently on boot | FR-10 |

Every non-trivial branch leaves a runnable check that fails if the logic breaks (Karpathy #4). Contract tests
first where a schema is the contract.

---

## 7. Sprint Decomposition (preview — detailed in `sprint.md`)

- **Sprint 0 (verify-first):** confirm base-branch `ordering-protocol` + `shadow-audit` test state; resolve or
  route around the `preset.ts` `metadata_snapshot` drift (R-1). Gate: clean baseline before extending.
- **Sprint 1 (durability + registration · G-1, G-2):** `PostgresEventStore`, fail-loud wiring, `0002`
  migration, register public runs, feedback binds. Round-trip + fail-loud + binding tests.
- **Sprint 2 (semantic prereq + projection + attention · G-3, G-5):** typed `needs_input(access_started_at)`
  resumable state, public journey projection mapper + internal poll, privacy-safe attention events. Privacy +
  resume tests.
- **Sprint 3 (anonymous intake + join + idempotency · G-4, G-6):** `gate-leak` ordering preset, `order_id`
  join to community-onboarding, subject idempotency vs distinct-journey demand, anti-abuse. Immutability +
  idempotency-vs-demand tests.

---

## 8. Open Questions (resolved by grounding unless noted)

- **Extend `/v1/access-risk` GET vs add a POST?** — A POST variant is cleanest for the `access_started_at`
  resume + journey handle; the GET stays for the zero-input first probe. Sprint 2 settles the exact surface
  against the existing router; either way the k-anon/budget path is reused, not reimplemented.
- **Does the gate-leak preset run inside the same ordering service deploy?** — Yes; it rides the existing
  lifecycle/outbox in `services/ordering`. Note the outbox drain has no scheduler in `bin/` today [grounding
  §B]; Sprint 3 must not assume an already-running drain (either invoke `publishOutbox` inline for the
  gate-leak path or add the scheduler within scope, whichever is smaller — decided against the code at
  implementation time, disclosed in the PR).
