# Sprint Plan — Waggle Loop S1: Consumer Conformance + Four Real Surfaces

**Version:** 1.0
**Date:** 2026-07-09
**Author:** Sprint Planner Agent
**Cycle:** cycle-waggle-s1
**PRD Reference:** grimoires/loa/prd.md (waggle-s1, 2026-07-09)
**SDD Reference:** grimoires/loa/sdd.md (waggle-s1, 2026-07-09)
**Ledger:** sprints registered as global #411–#414

---

## Executive Summary

Wire four dashboard surfaces (badges, access audit, inventories, order events) to real backends, each wire-in **born executable** as a consumer-driven contract suite, closed through the immune rack and recorded in an append-only conformance ledger.

> From prd.md:13: "Every consumer-side failure in the estate renders as a **plausible zero**."
> From sdd.md:13: "One genuinely new organ (the contract harness), one new read seam (ordering event log), one additive schema field (`conformance_ref`), one new doctor. Everything else is wiring of organs that already exist."

Sprint slicing follows SDD §9 directly (already ADR-007-sliced) plus the flatline deltas (SDD §12) assigned to the phase where their subject lands. Suite order follows the cut-vertex rule: "inventory (betweenness 8.0) → activities → audit → ordering" (sdd.md:89).

**Total Sprints:** 4
**Sprint Duration:** ~2.5 days each
**Estimated Completion:** 2026-07-20
**Repos touched:** `freeside-dashboard` (consumer — Sprints 1, 2, 4 + half of 3), `loa-freeside` (Sprint 3, three domain-isolated PRs), operator-adjacent infra ops (Sprint 2)
**Merge posture:** DRAFT PRs while the merge door is frozen (prd.md NFR-3, R-6); reviews via local cheval council, tier-routed.

---

## Sprint Overview

| Sprint | Global # | Theme | Repo / Domain | Scope | Key Deliverables | Depends on |
|--------|----------|-------|---------------|-------|------------------|-----------|
| 1 | 411 | Ack protocol + harness substrate + inventory suite | freeside-dashboard | MEDIUM (6) | `SeamResult<T>`, `tests/contracts/` scaffold + ledger appender, inventory suite, net-new CI (3 lanes), reality-ledger v1 | None |
| 2 | 412 | Badges + audit real | freeside-dashboard + [OPERATOR-ADJACENT] infra | LARGE (7) | Bearer mint contract (GATING), activities suite + cutover, shadow-audit deploy + MOCK_AUDIT deletion, inventory DNS repoint behind threat-model gates | Sprint 1 |
| 3 | 413 | Order log + registry pointer + doctor | loa-freeside (3 PRs by domain) + freeside-dashboard | LARGE (7) | `GET /v1/orders/events`, `conformance_ref` + `expectations[]`, consumer-conformance doctor, inbox adapter + durable cursor + ordering suite | Sprint 1 (CI run for doctor); Sprint 2 non-blocking |
| 4 | 414 | Pulse + coverage close-out + E2E | freeside-dashboard | LARGE (8) | COVERAGE.md ≥95% MUST, DISCREPANCIES.md, catch-set complete, AST silent-zero gate, ledger branch durability, Discord sink adapter + alerting state model, quorum flips, E2E goal validation | Sprints 1–3 |

**Cross-repo rollout invariant** (prd.md §10.8): "registry schema (additive) → producer changes (unwall/deploy/#18) → consumer wiring (dashboard) → DNS/beacon pointer flips. Every intermediate state must be safe." Within each surface, tasks are ordered to respect this; rollback per step is a single revert.

---

## Sprint 1: Ack Protocol + Harness Substrate + Inventory Suite

**Global ID:** #411 · **Repo:** freeside-dashboard · **Domain:** shared (external consumer repo)
**Scope:** MEDIUM (6 tasks)
**Dates:** 2026-07-09 → 2026-07-11

### Sprint Goal
Land the acknowledgment protocol (`SeamResult<T>`) and the contract-harness substrate, prove both on the already-wired inventory seam (fastest green), and enumerate every dashboard surface in the reality-ledger.

> From sdd.md:350 (§9 Phase 1): "`SeamResult` type + seam module conversion for inventory client (already wired seam = fastest green)."
> Dependency edge (sdd.md:373): "1→2→3 (substrate before suites)."

### Deliverables
- [ ] `src/lib/seam/result.ts` with `SeamResult<T>` discriminated union exactly per SDD §6.1; inventory client converted (zero `catch → null` remaining in `src/lib/inventory-api/client.ts`)
- [ ] `tests/contracts/` scaffold: runner conventions, `PROVENANCE.json` sidecar format, hash-chained JSONL ledger appender
- [ ] `tests/contracts/inventory/` suite green in fixture mode; live mode runnable
- [ ] Net-new dashboard CI workflow with three lanes (fixture-blocking / live-cron / live-smoke-on-merge) + `scripts/check-silent-zero.ts` v1
- [ ] `grimoires/loa/reality-ledger.md` (dashboard repo) classifying ALL surfaces; orders (beads) filed for every `sample` row
- [ ] ONE bun version pinned; lockfile authority resolved

### Acceptance Criteria
- [ ] Inventory surface renders `data | error | stale` — non-2xx and dead-host produce an explicit error state, never `null`/empty (FR-3 AC3; the `catch { return null }` sites at client.ts:40,144 are gone)
- [ ] Suite pins the three ACTUALLY-consumed endpoints — `GET /holdings/:wallet`, `GET /nfts/:contract/owner/:address`, `GET /profile/:address` (SDD D-4 grounded correction; NOT the PRD's `metadata/:contract/:tokenId`)
- [ ] Failure-injection case passes: upstream fault yielding 200-empty does NOT render as a real zero (prd.md §10.2: "An empty collection is authoritative ONLY when fresh … and `complete`")
- [ ] Machine-readable seam-contract bounds file lands beside the suite with §10.1 values (inventory: timeout 8s, cadence 15m, max age 30m), tier `PROPOSED`, clock-skew ±30s
- [ ] Every ledger record carries `prev_hash` (sha256 over canonical JSON/JCS) + genesis rule per seam (SDD D-8, §12.5); duplicate `idempotency_key` is a no-op (prd.md §10.7)
- [ ] Fixture-mode contract lane is BLOCKING in dashboard CI; live lanes are informational-never-required (prd.md §10.6 — "Two lanes, never conflated")
- [ ] `check-silent-zero.ts` v1 (grep-tier) fails CI on any catch→`[]`/`null`/`0`/empty-object in the four surfaces' data modules (FR-6 AC1)
- [ ] reality-ledger enumerates ALL dashboard surfaces with `live | sample(order:<ref>) | delete-proposed` (prd.md §10.9: "an S1 deliverable, not emergent"); every fabricated community card carries label + order ref (FR-6 AC2)

### Technical Tasks
- [ ] **Task 1.1** — Create `src/lib/seam/result.ts` (`SeamResult<T>` + `SeamError` per sdd.md:228-239, plus `observed_at`/checkpoint/completeness fields per prd.md §10.2); convert `inventoryFetch`/`fetchProfilePicture` (client.ts:40,144) to return `SeamResult`; render branches on it (end-user surface: explicit "Unavailable" + `conformance.violation` log line, per D-9) → **[G-1, G-2]**
- [ ] **Task 1.2** — Scaffold `tests/contracts/`: `CONTRACT_MODE=fixture|live` convention (D-1), fixture `PROVENANCE.json` sidecars (source URL, capture command, capture time, response-header subset, sha256 — SDD §12.9), ledger appender writing §5.2 records with JCS-canonical `prev_hash` chain + per-seam genesis rule → **[G-3, G-4]**
- [ ] **Task 1.3** — `tests/contracts/inventory/` suite: 3 endpoints × shape/error/staleness MUST cases, dead-host-silence catch-set case (NFR-4 seed), 200-empty failure-injection (§10.2), §10.1 bounds file; runs under `bun test` in both modes → **[G-2, G-3]**
- [ ] **Task 1.4** — Net-new CI workflow (grounded gap: "none runs `bun test` today" — sdd.md:165): (a) fixture-mode contract job, BLOCKING on PR; (b) live-mode cron job + ledger artifact upload; (c) live-smoke-on-merge lane (one canary MUST per wired seam, informational, result lands in ledger — SDD §12.7; starts with inventory, grows as seams wire in); plus `scripts/check-silent-zero.ts` v1 in the blocking lane → **[G-1, G-3]**
- [ ] **Task 1.5** — Author `grimoires/loa/reality-ledger.md` (dashboard repo): one row per surface `surface | classification | seam | suite | last-verified` (SDD §5.3); file a bead for every `sample(order:<ref>)` row (G-5 backpressure); record the S2+ deferral list for the repo-wide silent-zero sweep (prd.md §10.9) → **[G-5]**
- [ ] **Task 1.6** — Pin ONE bun version (1.3.11, Docker today — sdd.md:157) across CI/local; resolve bun.lock vs pnpm-lock authority split; document in the contracts README → **[G-3]**

### Dependencies
- None (first sprint). Inventory seam is already live: `inventory-api-production-3f25.up.railway.app` (`/health` 200 — sdd.md:119); suite runs against it via `INVENTORY_API_URL` before the Sprint 2 DNS repoint.

### Security Considerations
- **Trust boundaries:** every seam response decodes through @effect/schema before use; decode failure → `SeamResult error(kind: "decode")` (SDD §7.1). Inventory reads are public — no credentials involved in this sprint.
- **External dependencies:** none added. No zod in the dashboard (sdd.md:156); no Pact broker — "the 'broker' is the registry pointer + git" (sdd.md:167).
- **Sensitive data:** fixtures must not capture tokens/PII; PROVENANCE sidecars record capture commands for review. `SeamError.detail` is "sanitized; never leaks tokens" (sdd.md:237).

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-5: inventory is a cut vertex (betweenness 8.0) — suite failures fan wide | Med | High | This is WHY it goes first (sdd.md:89); failure becomes visible + attributable |
| R-8: cross-engine drift (suites under bun, prod under node) | Med | Med | Pin one bun version (Task 1.6); live-mode assertions are engine-independent (sdd.md:388) |
| Fixture tautology — fixture-green ≠ wire-in correct | Med | High | PROVENANCE-pinned real captures + live smoke lane (§12.7) from day one |

### Success Metrics
- Inventory suite: 100% of enumerated MUST cases pass in fixture mode; live mode returns a verdict (pass/fail/error — never silent)
- 0 catch→zero paths remaining in the inventory data module (grep + gate green)
- reality-ledger rows == total dashboard surfaces (complete enumeration, spot-checked)

---

## Sprint 2: Badges + Audit Real

**Global ID:** #412 · **Repo:** freeside-dashboard + [OPERATOR-ADJACENT] Railway/DNS ops · **Domain:** shared
**Scope:** LARGE (7 tasks)
**Dates:** 2026-07-12 → 2026-07-14

### Sprint Goal
Cut the badge surface over to activities-api behind a server-side Bearer, deploy the shadow-audit service and delete the MOCK_AUDIT path, and repoint inventory's canonical DNS behind the public-read threat-model gates.

> Dependency edge (sdd.md:373): "7→8 (deploy before cutover)."

### Deliverables
- [ ] Bearer mint contract documented + integration-tested (GATING — SDD §12.2)
- [ ] `src/lib/activities-api/client.ts` + badge surface cutover; score-api facade retired from this surface; catalog grid labeled `sample` with order filed
- [ ] `tests/contracts/activities/` suite green (fixture) incl. full auth negatives
- [ ] shadow-audit Railway service deployed from monolith, fail-closed auth
- [ ] `MOCK_AUDIT` + mock branch DELETED; `tests/contracts/shadow-audit/` suite green
- [ ] Inventory canonical DNS → -3f25 with threat-model gates satisfied; registry `beacon_url` truth restored

### Acceptance Criteria
- [ ] FR-1 AC1: a Mibera member with granted badges sees them render from live activities-api data — scope is **the session member's earned badges (self-Bearer)** (SDD D-2); member-view via service-token route is OUT of S1 by default (sdd.md §11.4)
- [ ] FR-1 AC2: unreachable activities-api or invalid Bearer renders an explicit error state (never an empty grid); the silent-401 drift class has a named suite case
- [ ] Bearer is minted and held **server-side ONLY** — never reaches the browser; issuer=identity-api, audience=activities-api, TTL + refresh documented in fixture notes; negative cases: wrong audience, expired, wrong issuer, rotation (prd.md §10.5, SDD §12.2)
- [ ] **Gate honored:** "If the session→token exchange does not exist upstream, FR-1 blocks LOUDLY and files the identity-api order — no facade fallback" (sdd.md:410)
- [ ] Badge seed precondition (SDD §12.8): pinned test identity returns ≥1 badge OR suite fails loud with documented operator seed step; "200-empty ≠ green during bootstrap"
- [ ] FR-2 AC1: member audit page shows real access decisions; `getAudit()` is live-only, unreachable → LOUD error (operator surface, D-9)
- [ ] FR-2 AC2 satisfied as designed: Railway service deployed **from the monolith repo** — "no new repo, no code move" (sdd.md:112); `SHADOW_AUDIT_API_URL` resolution recorded
- [ ] Shadow-audit auth fails CLOSED: "service refuses startup when `SHADOW_AUDIT_API_KEY` is absent; constant-time verification" (sdd.md:413); suite asserts unauthenticated + wrong-key → 401 **against the DEPLOYED configuration**; S1 exposure is operator-scoped only, TLS-only (prd.md §10.5)
- [ ] FR-3 AC2: ONE canonical URL across producer, registry, consumer; inventory-api#18 (beacon serving) verified/merged
- [ ] §10.4 gates pass BEFORE the edge wall drops: per-IP rate limit (PROPOSED 60 req/min) + 429 with Retry-After, pagination caps + address validation, cache headers, circuit breaker + daily provider cost ceiling, CORS allowlist, reads-only exposure verified, one-step rollback rehearsed; consumer suite asserts 429/503 render loud

### Technical Tasks
- [ ] **Task 2.1** — **[GATING, P0]** Document + integration-test the identity-api Bearer exchange (endpoint, `sub`/`aud`/`iss` claims, TTL, refresh, server-only storage, log redaction — SDD §12.2); wrong-audience/expired/wrong-issuer/rotation tests; if exchange missing upstream → halt FR-1 lane, file identity-api order → **[G-2]**
- [ ] **Task 2.2** — `src/lib/activities-api/client.ts`: `fetchEarnedBadges(bearer): Promise<SeamResult<Badge[]>>` against `GET /v1/badges` (producer truth: BadgeIssued events for the AUTHENTICATED identity, reads.ts:274-288); badge page cutover off `getDemoBadges` (badges.ts:162) and off the score-api facade (client.ts:1502); catalog grid stays `sample`-labeled + badge-index order filed (D-2) → **[G-1, G-2]**
- [ ] **Task 2.3** — `tests/contracts/activities/` suite: 200 shape `{items, total_count}` + cursor contract; missing/invalid token → 401 never 200-empty; staleness bound 10m, timeout 5s, cadence 15m (§10.1); auth negatives from Task 2.1 → **[G-2, G-3]**
- [ ] **Task 2.4** — Badge seed precondition check (§12.8): assert pinned test identity (§10.9: versioned Mibera holder fixture, TWO independent observations, expiry date, PROVENANCE) returns ≥1 badge; else XFAIL + bead + operator seed step (grant via B1 path) documented (R-7: activities event tables may be EMPTY) → **[G-2]**
- [ ] **Task 2.5** — **[OPERATOR-ADJACENT]** Deploy shadow-audit as a Railway service from the monolith (existing `packages/services/shadow-audit/bin/http.ts` + Dockerfile + railway.toml — D-3); env checklist from bin/http.ts:9-16 (`OPERATED_COMMUNITIES`, `COLLECTION_REGISTRY`, `RPC_URL_<chain>`); make `SHADOW_AUDIT_API_KEY` mandatory-fail-closed (§12.3); live-correctness spot-check per its header warning → **[G-2]**
- [ ] **Task 2.6** — Dashboard audit cutover: set `SHADOW_AUDIT_URL/KEY/ENABLED` env; DELETE `MOCK_AUDIT` + mock branch of `getAudit()` (mock-audit.ts:27,67 — silence rule, config-client precedent); loud error state; `tests/contracts/shadow-audit/` suite (schema per `parseAuditOutput` types; unauth → loud 401 render; cross-member access → denial; §10.1 bounds: 5s/15m/15m) → **[G-1, G-2, G-3]**
- [ ] **Task 2.7** — **[OPERATOR-ADJACENT]** Inventory public-read cutover: §10.4 threat-model gates verified on -3f25, THEN canonical DNS `inventory.0xhoneyjar.xyz` → -3f25; dashboard default URL stays canonical host (`INVENTORY_API_URL` override until DNS lands — D-4); verify inventory-api#18 state; registry `beacon_url` fixed; 429/503-render-loud cases added to inventory suite → **[G-2]**

### Dependencies
- Sprint 1: `SeamResult`, contracts scaffold, CI lanes (suites land in existing lanes)
- External: identity-api Bearer mintability ([ASSUMPTION confirmed at PRD pre-gen gate] — prd.md:190; Task 2.1 verifies mechanically and is the circuit breaker if wrong)
- External: badge grant existence (R-7/B1 — READ wiring does NOT block on it; AC1 evidence does)
- Operator: Railway service creation, DNS change (Tasks 2.5, 2.7 flagged [OPERATOR-ADJACENT])

### Security Considerations
- **Trust boundaries:** Bearer server-side only (never browser — prd.md §10.5); shadow-audit is an operator surface, S1 exposure operator-scoped only, member-self deferred to S2; inventory goes public-read behind §10.4 controls, writes stay fenced.
- **External dependencies:** none added; shadow-audit deploys as-committed ("zero new code to deploy" — sdd.md:162).
- **Sensitive data:** `SHADOW_AUDIT_API_KEY` in Railway env only, rotation documented; token TTL + refresh + log redaction documented (§12.2); suite fixtures scrub auth headers.

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-1: Bearer secret drift → silent 401s | Med | High | Suite asserts auth flow incl. 401-distinct-from-empty; live cron makes drift loud within a day (sdd.md:381) |
| R-7: activities event tables EMPTY; B1 donation wallet list in no repo | High | Med | Explicit Phase-2 precondition (Task 2.4); XFAIL + order if grants absent; READ path doesn't block |
| R-2: DNS/edge change is operator-adjacent infra | Med | Med | Smallest diff — read-path unwall only; keyed fallback documented; one-step rollback rehearsed (§10.4) |
| Bearer exchange doesn't exist upstream | Low | High | Task 2.1 is GATING with a loud block + identity-api order — no facade fallback (§12.2) |

### Success Metrics
- Badge surface: live render for the pinned test identity (or documented XFAIL-pending-grant with order ref)
- 0 references to `MOCK_AUDIT` in the dashboard repo (deleted, not flagged off)
- Activities + shadow-audit suites: 100% MUST cases enumerated and passing in fixture mode; auth negatives all present
- Inventory suite green against canonical DNS host post-flip

---

## Sprint 3: Order Log + Registry Pointer + Doctor

**Global ID:** #413 · **Repos:** loa-freeside (3 PRs, domain-isolated per ADR-007) + freeside-dashboard · **Domains:** platform/services, network/registry, platform/tools, shared
**Scope:** LARGE (7 tasks)
**Dates:** 2026-07-15 → 2026-07-17

### Sprint Goal
Serve the order lifecycle log over HTTP, point the registry at the suites via `conformance_ref`, register the consumer-conformance doctor on the immune rack, and wire the dashboard inbox to consume the log with a durable cursor.

> Dependency edges (sdd.md:373): "10→13 (endpoint before adapter); 11 independent; 12 depends on 3 (needs a CI run to read)."
> ADR-007: each monolith PR stays inside ONE domain — three separate PRs below.

### Deliverables
- [ ] **PR-A (platform/services):** `GET /v1/orders/events` on ordering service, deployed
- [ ] **PR-B (network/registry):** `conformance_ref` additive field + `expectations[]` blocks for the four wired buildings
- [ ] **PR-C (platform/tools):** `tools/consumer-conformance-doctor.mjs` + rack registration
- [ ] Dashboard: ordering client + inbox adapter + durable cursor + `tests/contracts/ordering/` suite
- [ ] Demo inbox feed labeled `sample` → deleted on live-green; #401 filed as order

### Acceptance Criteria
- [ ] `GET /v1/orders/events?since=<seq>&limit=<n≤500>` serves `order_outbox` rows `WHERE seq > $1 AND subject LIKE 'orders.lifecycle.%' AND published = true ORDER BY seq` (sdd.md:181-190); partial index added; 400 on non-integer params
- [ ] Endpoint NEVER serves raw `payload` jsonb — versioned `PublicLifecycleEvent` strict allowlist (`seq, order_id, subject, event_version, occurred_at, status, public_note?`), snapshot test fails if any non-allowlisted field escapes; unknown versions project as `{…, opaque: true}`; `orders.orchestrator.*` stays ops-private (sdd.md:196, SKP-003 CRITICAL)
- [ ] Route is DEFAULT-DENY behind service-scoped Bearer (`ORDERS_EVENTS_READ_TOKEN`, constant-time compare), rate-limited; suite asserts refusal: no token, wrong token, rotated token (sdd.md:269, SKP-001 CRITICAL)
- [ ] `conformance_ref: Schema.optional(Schema.String)` on `ExpectationCommon` (registry.ts:63-67) — additive, decode-safe; value shape `<repo>#<path>@<git-ref>` with worked example (prd.md §10.9); freeside-cli decode conformance vectors stay green (NFR-1); `expectations[]` blocks for the four wired buildings carry `conformance_ref` + cadence, giving each building its minimal rack-probe ack (prd.md §10.3)
- [ ] Doctor re-derives verdict from live `gh` reads (dashboard workflow conclusion + ledger artifact), never self-declared (D-7); evidence selection pinned: repo, workflow ID, branch=main, event∈{schedule,push}, mode=live, artifact name exact, max age 26h; anything else ⇒ `unknown`, "never healthy-by-default" (§12.6)
- [ ] Doctor registered in `tools/immune-instruments.yaml` with literal ground-source tokens; runs in `immune-doctors.yml` (cron `17 13 * * *`), informational-never-required — always exits 0 in CI, verdict via job summary + `::warning::` (D-7; FR-5 AC1)
- [ ] FR-4 AC2: suite folds an order's lifecycle events through the state machine (`packages/protocol/ordering/src/events.ts` — contract of record) and asserts equality with `GET /v1/orders/:id` state; canonical event-sequence fixtures: happy path, duplicate delivery, gap, late event, mid-replay crash (prd.md FR-4)
- [ ] Dedup identity is `seq` — NOT `(order_id, subject)`; "routing/producing/failed legitimately repeat" (sdd.md:128); unknown event versions render as `unknown-event`, never dropped
- [ ] Cursor durability (§12.1): `next_since` persisted in durable store (`orders_inbox_cursor(consumer_id, next_since, updated_at)` or config-service KV) with read-modify-write under a lease; replay capped (`?limit` + max 3 pages/request cycle); contract cases: cold-start resume; two concurrent instances don't double-advance
- [ ] Envelope verification is EVIDENCE, not a gate: verify failures → `violation(provenance)` in the ledger without blocking render; trust-root design filed as S2 order (Legba lane) (§12.4)
- [ ] FR-4 AC1/AC3: real order events render in Hub inbox with lifecycle state; AC scope is replay of existing events; #401 (shadow_preview stalls NEW orders) filed as an order, not hidden

### Technical Tasks
- [ ] **Task 3.1** — **[P0] PR-A (platform/services):** `GET /v1/orders/events` on ordering service (Hono): seq-cursor read of `order_outbox`, `published = true` filter, `PublicLifecycleEvent` allowlist projection + snapshot test (the `toPublicOrder` discipline, projection.ts:5-9), default-deny service Bearer + rate limit, partial index, `next_since` semantics; vitest producer tests (cursor, redaction, limit clamp — sdd.md:338); deploy to Railway → **[G-2]**
- [ ] **Task 3.2** — **PR-B (network/registry):** `conformance_ref` on `ExpectationCommon` + `expectations[]` blocks (with §10.1 cadences) for activities, shadow-audit, inventory, ordering; worked example `freeside-dashboard#tests/contracts/activities@main`; beacon-schema conformance vectors + freeside-cli decode green (NFR-1; D-6 — "It is DATA, nothing in loa-freeside dispatches on it") → **[G-3]**
- [ ] **Task 3.3** — **PR-C (platform/tools):** `tools/consumer-conformance-doctor.mjs` (`execFileSync('gh')` reads; SAATY-lite ranking impact × staleness × recurrence — "dumb first", sdd.md:65; §12.6 pinned evidence selection; honest 0/2/1 exit contract in the tool, workflow wrapper absorbs it); `immune-instruments.yaml` registration with literal tokens (two-part lint contract); job in `immune-doctors.yml`; doctor detects ledger chain forks/truncation/missing predecessors ⇒ `unknown` (§12.5) → **[G-3, G-4]**
- [ ] **Task 3.4** — Dashboard `src/lib/ordering-api/client.ts`: `fetchOrderEvents(since): Promise<SeamResult<OrderEventPage>>`; Hounfour envelope verify via installed `@0xhoneyjar/events` as evidence-only (§12.4); `src/lib/adapters/orders-inbox-adapter.ts` folding lifecycle events → inbox threads, registered in `resolveInboxFeedSource()` as source `"orders"` (`INBOX_SOURCE=orders` + `ORDERING_API_URL`) → **[G-1, G-2]**
- [ ] **Task 3.5** — Durable cursor (§12.1): persistence table/KV + lease + replay cap; contract cases for cold-start resume and concurrent no-double-advance → **[G-2]**
- [ ] **Task 3.6** — `tests/contracts/ordering/` suite: event-sequence fixtures (happy/duplicate/gap/late/mid-replay-crash) with expected projections; replay-fold == projection equality (FR-4 AC2); auth negatives (no/wrong/rotated token); unknown-version → `unknown-event`; §10.1 bounds (5s timeout, 5m cadence, 2m event-max-age from newest `seq`) → **[G-2, G-3]**
- [ ] **Task 3.7** — Demo feed cutover: `getDemoInboxFeed` (hub-inbox.ts:107) labeled `sample` at cutover, deleted once suite is green against live (FR-4 AC1); #401 filed as order; reality-ledger rows updated → **[G-1, G-5]**

### Dependencies
- Task 3.1 → Tasks 3.4/3.5/3.6 (endpoint before adapter — sdd.md:373); doc-level ordering, not beads deps (cross-domain)
- Task 3.3 → Sprint 1 Task 1.4 (doctor needs a dashboard CI run + artifact to read)
- Task 3.2 is independent (can land any time — additive)
- ordering-service is DEPLOYED (`ordering-service-production.up.railway.app`, registry.yaml:247); `order_outbox.seq` already exists (store-postgres.ts:253) — no schema change, read path only

### Security Considerations
- **Trust boundaries:** `/v1/orders/events` is default-deny on a public Railway URL — "'already-public projection' describes the FIELD boundary, not an access grant" (sdd.md:269); `ORDERS_EVENTS_READ_TOKEN` held server-side by the dashboard only; constant-time compare; allowlist projection prevents payload leakage; Byzantine boundary: envelope verify is evidence until the trust-root lands (§12.4).
- **External dependencies:** none new — `@0xhoneyjar/events` already installed (earns its keep, D-5); doctor uses read-only `gh` with default token, "degraded-not-false verdict on missing scope" (R-9).
- **Sensitive data:** no raw outbox payloads leave the service; `orders.orchestrator.*` never served; doctor records commit provenance, no secrets.

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| R-3: #401 stalls NEW orders → feed shows only replayed history | High | Med | AC scoped to replay (D-5); #401 filed as order; golden thread (Azuki order 6ddc06f5) remains settle target |
| R-6: merge door frozen (--admin merges) | High | Low | DRAFT PRs; doctor informational-never-required so S1 adds zero new freeze surface (D-7) |
| R-9: doctor reads cross-repo CI via gh token scope | Low | Med | Read-only gh; degraded-not-false verdict (gate-freeze-sensor precedent) |
| Serverless cursor loss → replay-from-0 duplicate fan-out | Med | Med | §12.1 durable cursor + lease + page cap (Task 3.5) |

### Success Metrics
- Events endpoint: p50 < 200ms for `limit=100` reads (indexed); 0 non-allowlisted fields in snapshot test
- Ordering suite: replay-fold equality holds on all five canonical fixtures
- Doctor produces a verdict from real CI evidence on its first cron run (any of pass/fail/`unknown` — never silent, never healthy-by-default)
- freeside-cli decode vectors: 100% green post-`conformance_ref` (NFR-1)

---

## Sprint 4 (Final): Pulse + Coverage Close-out + E2E Goal Validation

**Global ID:** #414 · **Repo:** freeside-dashboard · **Domain:** shared
**Scope:** LARGE (8 tasks)
**Dates:** 2026-07-18 → 2026-07-20

### Sprint Goal
Close the loop: coverage accounting, catch-set completion, AST-tier silent-zero enforcement, durable ledger serialization, the tested Discord sink with the alerting state model, quorum-gated reality-ledger flips — then validate all five PRD goals end-to-end.

### Deliverables
- [ ] `tests/contracts/COVERAGE.md` + generator: MUST-coverage ≥95% per wired building or documented gap
- [ ] `tests/contracts/DISCREPANCIES.md` populated from wiring findings
- [ ] Catch-set complete: all four NFR-4 seeds pinned
- [ ] `check-silent-zero.ts` upgraded to AST-aware + one behavioral fault-injection test per surface
- [ ] Conformance ledger durably serialized to the `conformance-ledger` branch
- [ ] Discord sink adapter TESTED (mock webhook) + first digest durably queued + alerting state model implemented
- [ ] reality-ledger flips governed by quorum; E2E validation evidence for G-1..G-5

### Acceptance Criteria
- [ ] G-3 coverage denominator honest: "enumerated MUST clauses per suite's COVERAGE.md; score = passing MUST / enumerated MUST; XFAIL = documented gap, never a pass" (prd.md §10.6)
- [ ] Catch-set contains the four seeds: 24-vs-0 parity, Zod-cap swallow (actions.ts:1908), dead-host silence, sonar#120 zero-holders — sonar#120 as XFAIL with bead ref, classified `violation(indexer)`, "not suite-weakening" (prd.md §10.9; NFR-4)
- [ ] `check-silent-zero.ts` detects: catch-clauses, `.catch(`, `?? []`-on-seam-results, optional-chain-with-default in seam modules (ts-morph — SDD §12.9); FR-6 AC1: zero remaining catch→zero paths on the four S1 surfaces
- [ ] Ledger durability (§12.5): live-mode cron commits ledger segments to dedicated branch (append-only path per seam, run_id + commit provenance); per-record sha256 + `prev_hash` over JCS; doctor `unknown` on fork/truncation verified end-to-end
- [ ] G-4 acceptance rule met exactly: "S1 ships the sink adapter WITH a test (mock webhook) plus durable digest queueing in the ledger; live delivery activates the moment the operator provides the webhook URL, with no code change" (prd.md FR-7 — S1 is decidable without the webhook, cures SKP-010)
- [ ] Alerting state model per prd.md FR-7: per-seam state starts `UNKNOWN` (no alert on first observation); `broken` after 2 consecutive failures (hysteresis); `working` on 1 green; missed cadence window IS an observation (`stale`); transitions computed in event-time (`observed_at`) order; sink delivery bounded retry/backoff; undeliverable alerts dead-letter into the ledger, loud in next digest — "sinks fail soft, the record never lies"
- [ ] Quorum rule live (prd.md §10.3): reality-ledger flips to `live` ONLY on dashboard suite green AND rack probe green; disagreement = a violation in the ledger, not a pass; red merge-smoke sets seam state to `violation` preventing `live` classification (§12.7)
- [ ] Task 4.E2E completed with documented evidence per goal (table below)

### Technical Tasks
- [ ] **Task 4.1** — Coverage matrix generator + `COVERAGE.md`: every consumed endpoint/field × MUST/SHOULD per building; ≥95% MUST or gap documented (FR-5 AC2) → **[G-3]**
- [ ] **Task 4.2** — `DISCREPANCIES.md`: producer-vs-consumer divergences found during Sprints 1–3 wiring (skill Pattern 5 artifact); each discrepancy gets a bead or a documented wontfix → **[G-3, G-5]**
- [ ] **Task 4.3** — Pin remaining catch-set seeds (24-vs-0 parity, Zod-cap swallow, sonar#120-as-XFAIL-with-bead); catch-set "grows only from behavior" (sdd.md:334) → **[G-1]**
- [ ] **Task 4.4** — Upgrade `check-silent-zero.ts` to ts-morph AST detection + one behavioral test per surface (inject upstream fault, assert error-state render — §12.9); gate green across all four surfaces → **[G-1]**
- [ ] **Task 4.5** — Ledger branch durability (§12.5): cron job commits segments to `conformance-ledger` branch; JCS canonical hashing verified; genesis rule per seam; end-to-end tamper test (mutate a line → doctor emits `unknown`) → **[G-4]**
- [ ] **Task 4.6** — Discord sink adapter + digest: adapter with mock-webhook test; digest builder over ledger (working→broken / broken→fixed transitions + worlds-onboarding progress + order-log lines — FR-7); alerting state model (UNKNOWN start, 2-fail hysteresis, 1-green recovery, missed-cadence=stale, event-time ordering, bounded retry + dead-letter); first digest durably queued in the ledger; live delivery flips on `DISCORD_WEBHOOK_URL` provision with no code change → **[G-4]**
- [ ] **Task 4.7** — Quorum + reality-ledger finalization: `live` classification requires suite green AND rack probe green (registry `expectations[]` from Task 3.2 are the probe blocks); disagreement recorded as violation; merge-smoke red → `violation`; final reality-ledger pass over all surfaces → **[G-2, G-5]**
- [ ] **Task 4.E2E** — **[P0]** End-to-End Goal Validation (see below) → **[G-1, G-2, G-3, G-4, G-5]**

### Task 4.E2E: End-to-End Goal Validation

**Priority:** P0 (Must Complete)
**Goal Contribution:** All goals (G-1..G-5)

| Goal ID | Goal | Validation Action | Expected Result |
|---------|------|-------------------|-----------------|
| G-1 | Zero silent zeros on wired surfaces | Run `check-silent-zero.ts` (AST tier) + per-surface fault-injection tests | 0 catch→zero paths on the four surfaces; error/stale states render distinctly |
| G-2 | Four surfaces REAL for Mibera | Live-mode suite run against all four seams with the pinned holder fixture | Badges (or documented XFAIL-pending-grant + order), audit, inventories, order events all render live data; suites green against live seams |
| G-3 | Requirements executable | Inspect dashboard CI: 4 suites present + blocking fixture lane; `COVERAGE.md` ≥95% MUST per building or documented gap; `DISCREPANCIES.md` exists; registry decode vectors green with `conformance_ref` | All artifacts present; coverage numbers computed (not asserted) |
| G-4 | The pulse breathes | Run sink adapter test suite (mock webhook); verify first digest record queued in ledger with `prev_hash` chain intact; doctor cron verdict from real evidence | Tested-adapter + queued-digest evidence per prd.md FR-7 acceptance rule — decidable without the webhook |
| G-5 | Backpressure register live | Audit reality-ledger: every surface classified; every `sample` row carries `order:<bead-ref>`; every wiring gap has a filed bead | Complete classification; `br list` resolves every referenced order |

**Acceptance Criteria:**
- [ ] Each goal validated with documented evidence (file refs, CI run URLs, ledger records)
- [ ] Integration points verified (suite → ledger → doctor → digest flows end-to-end)
- [ ] No goal marked "not achieved" without explicit justification + order filed

### Dependencies
- Sprints 1–3 complete (all four suites + doctor + ledger appender exist)
- Operator: Discord webhook URL is explicitly NOT a dependency (G-4 decidable without it)
- Badge grant existence feeds G-2 evidence (XFAIL path is the documented fallback)

### Security Considerations
- **Trust boundaries:** digest content comes from the hash-chained ledger only; webhook URL (when provided) stored as secret, never committed; dead-letters carry no secrets.
- **External dependencies:** ts-morph (dev-only, AST lint — not in the truth path; NFR-2 preserved).
- **Sensitive data:** ledger records carry evidence refs, never tokens; OIDC attestation signing is explicitly S2 (§12.5).

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Coverage <95% MUST on a building at close | Med | Med | Documented gap in COVERAGE.md is an accepted outcome (FR-5 AC2 "or gap documented"); gap gets a bead |
| Alerting state model flaps on marginal seams | Med | Low | 2-fail hysteresis + transition-only alerting by design (FR-7); tune thresholds S2 — bounds are PROPOSED tier |
| Ledger branch conflicts (concurrent CI writers) | Low | Med | "One writer per lane" (prd.md §10.7); append-only path per seam; idempotency_key no-op on duplicates |

### Success Metrics
- MUST coverage ≥0.95 per wired building (or documented gap + bead)
- 4/4 catch-set seeds pinned and running
- 1 digest record durably queued; sink adapter test suite green
- 5/5 goals with documented E2E evidence

---

## Risk Register

| ID | Risk | Sprint | Probability | Impact | Mitigation | Owner |
|----|------|--------|-------------|--------|------------|-------|
| R-1 | Identity Bearer secret drift → silent 401s | 2 | Med | High | Suite asserts auth flow; live cron surfaces drift within a day | Dashboard lane |
| R-2 | Inventory unwall = operator-adjacent infra change | 2 | Med | Med | Read-path only; §10.4 gates; one-step rollback rehearsed | Operator + dashboard |
| R-3 | #401 stalls NEW orders — feed is replay-only | 3 | High | Med | AC scoped to replay; #401 filed as order | Ordering lane |
| R-4 | sonar#120 zero-holders poisons holdings truth | 1, 4 | High | Med | XFAIL catch-set case + bead; `violation(indexer)` classification; Dune-differential is S2 | Conformance lane |
| R-5 | inventory/score cut-vertex SPOFs | 1 | Med | High | Inventory suite FIRST; failures visible + attributable | Conformance lane |
| R-6 | Merge door frozen (--admin merges) | all | High | Low | DRAFT PRs; doctor informational; heal via bead qbt0r lane | Operator |
| R-7 | Activities event tables EMPTY + B1 wallet list in no repo | 2 | High | Med | Phase-2 precondition task; XFAIL-pending-grant + order | Operator/Gumi + dashboard |
| R-8 | Cross-engine drift (bun suites vs node prod) | 1 | Med | Med | One pinned bun version; live assertions engine-independent | Dashboard lane |
| R-9 | Doctor gh token scope | 3 | Low | Med | Read-only gh; degraded-not-false verdict | Rack lane |

---

## Success Metrics Summary

| Metric | Target | Measurement Method | Sprint |
|--------|--------|-------------------|--------|
| Silent-zero paths on the four surfaces | 0 | `check-silent-zero.ts` (grep v1 → AST v2) in blocking CI | 1, 4 |
| Contract suites wired | 4/4 buildings | `tests/contracts/{inventory,activities,shadow-audit,ordering}/` in CI | 1–3 |
| MUST coverage per building | ≥95% (or documented gap) | COVERAGE.md generator — computed, never asserted | 4 |
| Surfaces rendering live data | 4/4 (badge XFAIL path documented) | Live-mode suite runs + reality-ledger quorum flips | 2–4 |
| Ledger integrity | Chain verifies end-to-end | Tamper test → doctor `unknown` | 4 |
| Pulse decidability (G-4) | Tested adapter + 1 queued digest | Mock-webhook suite + ledger record | 4 |
| Reality-ledger completeness | 100% of surfaces classified | Row count vs surface enumeration; every `sample` has order ref | 1, 4 |
| Registry decode safety (NFR-1) | 100% conformance vectors green | beacon-schema test-vectors + freeside-cli decode | 3 |

---

## Dependencies Map

```
Sprint 1 (dashboard) ──────▶ Sprint 2 (dashboard + ops) ──────▶ Sprint 4 (dashboard)
   │  SeamResult + scaffold      │  badges + audit + DNS            ▲  pulse + coverage + E2E
   │  + inventory suite + CI     │  (2.5 deploy → 2.6 cutover)      │
   │                             │                                  │
   └────────▶ Sprint 3 (monolith 3 PRs + dashboard) ───────────────┘
              PR-A platform/services (3.1) ─▶ dashboard adapter (3.4→3.5→3.6→3.7)
              PR-B network/registry  (3.2) ─▶ quorum probes (4.7)
              PR-C platform/tools    (3.3) ◀─ needs Sprint 1 CI run to read
```

Cross-repo rollout order per surface (prd.md §10.8): registry (additive) → producer → consumer → pointer flip; every intermediate state safe; rollback per step = one revert.

---

## Appendix

### A. PRD Feature Mapping

| PRD Feature | Sprint | Tasks | Status |
|-------------|--------|-------|--------|
| FR-1 Badges real (activities-api) | 2 | 2.1–2.4 | Planned |
| FR-2 Access audit live | 2 | 2.5, 2.6 | Planned |
| FR-3 Inventories real (public reads) | 1, 2 | 1.1, 1.3, 2.7 | Planned |
| FR-4 World events via order lifecycle | 3 | 3.1, 3.4–3.7 | Planned |
| FR-5 Contract harness + registry pointer | 1, 3, 4 | 1.2–1.4, 3.2, 3.3, 4.1 | Planned |
| FR-6 Silence rule codified | 1, 4 | 1.1, 1.4, 1.5, 4.3, 4.4 | Planned |
| FR-7 The pulse (Discord) | 4 | 4.5, 4.6 | Planned (webhook-independent per acceptance rule) |

### B. SDD Component Mapping

| SDD Decision / Component | Sprint | Tasks |
|--------------------------|--------|-------|
| D-1 Harness in consumer, bun test | 1 | 1.2, 1.6 |
| D-2 Badges → self-Bearer route | 2 | 2.1–2.4 |
| D-3 shadow-audit deploy + MOCK_AUDIT deletion | 2 | 2.5, 2.6 |
| D-4 Inventory DNS + typed errors + real endpoints | 1, 2 | 1.1, 1.3, 2.7 |
| D-5 / §6.3 Order events HTTP log-read | 3 | 3.1, 3.4, 3.6 |
| D-6 conformance_ref additive field | 3 | 3.2 |
| D-7 consumer-conformance doctor | 3 | 3.3 |
| D-8 / §5.2 Conformance ledger | 1, 4 | 1.2, 4.5 |
| D-9 / §6.1 SeamResult + silent-zero gate | 1, 4 | 1.1, 1.4, 4.4 |
| §12.1 Durable inbox cursor | 3 | 3.5 |
| §12.2 Bearer mint gating | 2 | 2.1 |
| §12.3 Shadow-audit fail-closed | 2 | 2.5, 2.6 |
| §12.4 Envelope trust-root scope pin | 3 | 3.4 |
| §12.5 Ledger branch durability | 4 | 4.5 |
| §12.6 Doctor evidence pinning | 3 | 3.3 |
| §12.7 Live smoke on merge | 1, 4 | 1.4, 4.7 |
| §12.8 Badge seed precondition | 2 | 2.4 |
| §12.9 AST gate + fixture hygiene | 1, 4 | 1.2, 4.4 |

### C. PRD Goal Mapping

| Goal ID | Goal | Contributing Tasks | Validation Task |
|---------|------|-------------------|-----------------|
| G-1 | Zero silent zeros on wired operator surfaces | 1.1, 1.4, 2.2, 2.6, 3.4, 3.7, 4.3, 4.4 | Sprint 4: Task 4.E2E |
| G-2 | Four surfaces REAL for Mibera | 1.1, 1.3, 2.1–2.7, 3.1, 3.4, 3.5, 3.6, 4.7 | Sprint 4: Task 4.E2E |
| G-3 | Requirements executable | 1.2, 1.3, 1.4, 1.6, 2.3, 2.6, 3.2, 3.3, 3.6, 4.1, 4.2 | Sprint 4: Task 4.E2E |
| G-4 | The pulse breathes | 1.2, 3.3, 4.5, 4.6 | Sprint 4: Task 4.E2E |
| G-5 | Backpressure register live | 1.5, 3.7, 4.2, 4.7 | Sprint 4: Task 4.E2E |

**Goal Coverage Check:**
- [x] All PRD goals have at least one contributing task
- [x] All goals have a validation task in final sprint (Task 4.E2E)
- [x] No orphan tasks (every task annotated with ≥1 goal)

**Per-Sprint Goal Contribution:**

- Sprint 1: G-1 (partial: ack protocol + gate v1), G-2 (partial: inventory), G-3 (partial: harness + CI), G-4 (partial: ledger format), G-5 (partial: reality-ledger v1)
- Sprint 2: G-1 (badges/audit surfaces), G-2 (badges + audit + inventory cutover), G-3 (two suites)
- Sprint 3: G-1 (inbox surface), G-2 (order events), G-3 (registry pointer + doctor), G-4 (doctor), G-5 (orders filed)
- Sprint 4: G-1 complete, G-3 complete (coverage), G-4 complete (pulse), G-5 complete (quorum flips) + E2E validation of all goals

### D. Assumptions Carried (explicit)

1. **[ASSUMPTION confirmed at PRD pre-gen gate]** identity-api Bearer mintable today (prd.md:190) — Sprint 2 Task 2.1 verifies mechanically and is the circuit breaker if wrong (blocks LOUDLY + files identity-api order, §12.2).
2. **[ASSUMPTION]** at least one Mibera badge grant exists or can be seeded via the B1 path during Sprint 2 — if wrong, FR-1 AC1 evidence lands as XFAIL-pending-grant + order (SDD §11.2, §12.8); the READ wiring is unaffected.
3. **[ASSUMPTION]** operator availability for the three [OPERATOR-ADJACENT] ops (shadow-audit Railway service, inventory DNS, threat-model review) within Sprint 2's window — if delayed, Sprint 3 proceeds (no hard dependency), and the affected suites stay fixture-green with `live` classification withheld by quorum.
4. Member-view badges (service-token route) are OUT of S1 scope (SDD §11.4 default). Discord webhook URL is S2 (G-4 decidable without it). "Top-20 worlds" order pin is verified during S1 against the internal-team request (prd.md:190) — no sprint task blocks on it.

---

*Generated by Sprint Planner Agent — cycle-waggle-s1, 2026-07-09*
