# PRD — Shadow Mode Ledger (`shadow-mode-api`): the member-graph composition spine

> **Status**: candidate (planning) · **Cycle**: shadow-mode-ledger · **Date**: 2026-06-25 · **Rev**: v1
> **Mode**: ARCH → SHIP. Evolution-aware (operator-confirmed 2026-06-25), NOT greenfield.
> **Source**: handoff bundle `shadow-mode-ledger-handoff.zip` (PROMPT + ARCHITECTURE + reference impl).
> **Claim tags**: `[OBSERVED]` grounded in repo/probe this cycle · `[DESIGN]` proposed.

---

## 0. Framing decision (load-bearing — read first)

This building is the **missing composition spine** for the Freeside member graph. The repo
already has the *consumers* and the *raw sources*; it lacks the **append-only ledger that
composes member observations across sources over time**. `[OBSERVED]`

What already exists (do NOT rebuild — reuse/reconcile):

| Existing | What it is | Status `[OBSERVED]` | Relationship to this building |
|---|---|---|---|
| `packages/protocol/shadow-audit` | Sealed Zod schemas: `AccessDecisionRecord`, `AuditOutput`, bands (not scores), `Refusal` | **Complete** (#306) | **REUSE** for the access-audit report output |
| `packages/services/shadow-audit` | Stateless audit-service, in-memory event store, EIP-191 auth, rate-limiter, Hono `/v1/audit` | **Complete**, in-memory only | **First consumer** of the ledger (the deployed-but-unconsumed cure) |
| `packages/core/domain/coexistence.ts` + `ports/shadow-ledger.ts` + `ports/shadow-sync.ts` | D4 wedge: `ShadowMemberState`/`ShadowDivergence`(false_positive/false_negative)/`ShadowPrediction`; `IShadowLedger`/`IShadowSync` ports | **Ports defined, NO impl in main**; ScyllaDB CQL `003_shadow_ledger_schema.cql` | **RECONCILE** — legacy incumbent-vs-Arrakis *accuracy* tracker; a special case of the new graph's divergence model |
| `packages/events` | hounfour topic convention + `NftActivity` family (#311) | **Live** | **EXTEND** — add the 7 shadow event topics here |

The new ledger is **net-new architecture** (the spine the others lack), built as an
**evolution**: it reuses the sealed shadow-audit schemas, supersedes the coexistence
divergence concept with a richer multi-source/event-driven model, and binds the existing
Access Audit report as its first live consumer.

**Naming collision** `[OBSERVED]`: the coexistence ScyllaDB keyspace already has a
`shadow_divergences` table (guild/user-keyed, `false_positive`/`false_negative`). The new
ledger's `shadow_divergences` is community/subject-keyed with rank-comparison kinds
(`match`/`freeside_higher`/`incumbent_higher`/`mismatch`). They are **physically separate
stores** (new building owns its own Postgres DB per ARCHITECTURE.md "one owner per fact"),
so no DB-level collision — but to keep the codebase legible the new building's tables/types
carry the **`shadow-mode-api` ownership boundary** and are documented as distinct from the
legacy coexistence keyspace. See SDD for the resolution.

---

## Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Make member-graph **composition ownership** visible as a first-class building | `shadow-mode-api` package owns observations→subjects→edges→divergences→reports; one owner per fact |
| G-2 | **Idempotent, append-only** event ingest from the 5 source classes | Replaying any `event_id` produces zero new observations (AC-1) |
| G-3 | **Conservative** subject identity — split over false-merge | A subject merges ONLY on an identity-api verified link (AC-2..AC-4) |
| G-4 | Explainable **divergence** between incumbent and Freeside-computed roles | Divergence report classifies + explains every subject with role data (AC-5) |
| G-5 | A **read-only** Access Audit report that reuses the sealed shadow-audit schemas | Report emits with evidence counts + caveats; **zero** Discord mutations (AC-6, AC-7) |
| G-6 | Bind the existing **Access Audit service as the first consumer** of the ledger | Audit report can be produced from ledger projections (cure for deployed-but-unconsumed) |

Non-goals (MVP):

- **NG-1** Score / ML / behavior labels (score-api owns; truth-status `estimated` avoided unless a rule is named).
- **NG-2** Person-level merging without identity-api verified evidence.
- **NG-3** A single shared database / vendor migration (PlanetScale/SpacetimeDB). Vendor is secondary; ownership boundary is the point.
- **NG-4** Any write to Discord roles, identity, chain, billing, or scoring sources.
- **NG-5** Live NATS wiring as a hard dependency — `POST /events` is the transport-agnostic ingest seam; a NATS consumer is a thin adapter over it (deferred).

---

## 1. Problem & context

`[OBSERVED]` The cluster is substrate-rich and consumer-poor (deployed-but-unconsumed-pattern,
operator-validated). Sonar (raw chain), identity-api (verified links), Discord onboarding
(action surface), and the coexistence D4 wedge all exist — but there is no **append-only
ledger that explains**, for a community: *what was observed, when, by which source, what was
inferred, what changed, and why a recommended action exists.* The Access Audit report
(#306) currently computes on-demand from sonar+roles with an **in-memory** store; it has no
durable composed member graph behind it.

The shadow ledger is the **integrated-meaning** layer (RAW sonar/discord → DERIVED identity
links/role snapshots → **INTEGRATED shadow member graph + divergences** → PRESENTED
report/UI/agent). The belt arrow runs *into* the ledger; the ledger never pushes decisions
upstream into Sonar or identity-api.

## 2. Users / stakeholders

- **CMs** — read the member graph, unresolved list, divergences, and the access-audit report before any role mutation.
- **Agents / dashboard** — consume member-graph projections.
- **The Access Audit service** (`shadow-audit`) — first programmatic consumer; reuses ledger projections instead of recomputing in-memory.
- **identity-api / Sonar / Discord onboarding** — *upstream sources*; never consumers; never mutated by this building.

## 3. Functional requirements

| ID | Requirement |
|----|-------------|
| FR-1 | Accept events via `POST /events` carrying the `shadow.event.v1` envelope (`event_id`, `community_id`, `name`, `source`, `truth_status`, `observed_at`, `emitted_at`, `payload`, optional `evidence_ref`). |
| FR-2 | Persist every accepted event append-only as a `shadow_observation`, keyed unique by `event_id`. Replaying an `event_id` returns `duplicate` and mutates nothing. |
| FR-3 | Reduce observations into `shadow_subjects` of kind `identity_user` / `discord_member` / `wallet_only` / `unresolved`, with aliases (`identity:`, `discord:`, `wallet:<chain>:<addr>`). |
| FR-4 | Consume the 7 event types: `discord.member.snapshot.v1`, `identity.wallet.linked.v1`, `identity.account.linked.v1`, `sonar.wallet.attributed.v1`, `incumbent.role.observed.v1`, `freeside.role.computed.v1`, `community.config.updated.v1`. |
| FR-5 | Merge subjects ONLY when an `identity.*.linked.v1` event provides a verified link (wallet→identity or discord→identity). Default policy: **prefer split over false merge**. |
| FR-6 | Record `shadow_edges` (attributed evidence) with `truth_status` and `source` for every applied event. Edges are idempotent per `(event_id, edge_kind)`. |
| FR-7 | Classify `shadow_divergences` per subject from `incumbent_roles` vs `freeside_roles` using community `role_rank` config: `match` / `freeside_higher` / `incumbent_higher` / `mismatch`, each with a reason. |
| FR-8 | Serve `GET /communities/:id/member-graph` (subjects + edges + divergences + summary), `GET /communities/:id/unresolved`, `GET /communities/:id/shadow/divergences`. |
| FR-9 | `POST /communities/:id/reports/access-audit` produces a read-only report reusing `shadow-audit`'s sealed `AuditOutput`/`AccessDecisionRecord` shape (evidence counts + caveats). |
| FR-10 | The service performs **zero** mutations against Discord, identity-api, Sonar, billing, or scoring. Enforced by a port boundary that exposes no outbound mutation surface + a test. |
| FR-11 | Persistence behind a port (`ILedgerStore`) with two adapters: in-memory (default/test) and a Postgres seam (the `schema.sql` sketch), selectable by config. |
| FR-12 | **Merge provenance (reversibility-ready).** Every subject merge records the triggering `event_id` + verified link as merge provenance, so a future unlink can reverse it without data loss. |
| FR-13 | Accept an **`identity.link.revoked.v1`** event in the contract that marks a prior verified link revoked. MVP records the revocation observation + provenance; the full re-split cascade is a named fast-follow (see §3.5). |

## 3.5 Trust boundary & non-functional requirements (flatline-integrated, 2026-06-25)

The append-only, explanatory ledger means **a poisoned observation persists and keeps
influencing reports even after correction** — so the ingest boundary is load-bearing.

| ID | Requirement | Origin |
|----|-------------|--------|
| NFR-1 | **Authenticated ingest.** `POST /events` requires a verified service identity. Reuse the cluster's existing **svc-JWT substrate** (identity-api `packages/protocol/svc-jwt-claims.ts` + `POST /v1/auth/service-jwt`) — do NOT invent a new auth scheme. The MVP default is a **FAIL-CLOSED** `StaticProducerPolicy` (source×name×community authz, no JWT needed); an allow-all adapter exists only as a guarded test double. The svc-JWT producer-authentication adapter is composed in when real emitters exist. | flatline SKP CRITICAL-860 |
| NFR-2 | **Per-source authorization.** Each `source` may emit only its allowed event names. In particular **only `source: identity_api` may emit `identity.*.linked.v1`** (the merge-triggering events). Events whose `source` is not authorized for the `name` are rejected, not ingested. | flatline SKP HIGH-735 |
| NFR-3 | **Community scoping.** An event's `community_id` must match the producer's authorized community scope; cross-community events are rejected. | flatline SKP CRITICAL-860 |
| NFR-4 | **Read-only boundary is enforced structurally**, not just by port-absence: a dependency-boundary test (or lint) bans importing any upstream **mutation-capable** client (Discord write client, identity-api write, role dispenser) into the `shadow-mode` packages, and asserts report generation emits no mutation command/event. | flatline SKP HIGH-710 (read-only) |
| NFR-5 | **Reversible identity.** Merges are provenance-tracked (FR-12); `identity.link.revoked.v1` (FR-13) is in the contract from day one so corrections/compromised-account recovery never require a permanent-merge workaround. | flatline SKP HIGH-710 (unlink) |

MVP disposition: NFR-1/2/3 ship as **validated seams** (the reducer rejects unauthorized
source/community via an injectable `IProducerPolicy`; the live svc-JWT adapter is wired when
real emitters exist). NFR-4 ships fully (it is cheap and is the core safety guarantee).
NFR-5 ships the contract + provenance; the unlink re-split cascade is a named fast-follow.

## 4. Truth status (every observation + edge)

`observed` (directly seen) · `attested` (authority/admin) · `inferred` (derived) ·
`estimated` (rule/model — **avoided in MVP unless a rule is named**) · `unsupported`
(requested, unbacked) · `abstained` (intentionally refused). MVP events are `observed` or
`attested`.

## 5. MVP scope (thinnest honest cut)

The **Shadow Member Graph Report**, end to end, in-process:

1. Ingest Discord roster + role snapshots, identity links, Sonar attribution, incumbent roles, freeside-computed roles, community config (idempotent).
2. Compute current shadow subjects; surface unresolved people/wallets.
3. Surface stale access (incumbent role without backing) and missing access (qualifies but no role) via divergences.
4. Generate the access-audit report with evidence + caveats. **Mutate nothing.**

Out of scope (this cycle): live NATS consumer, the dashboard UI, ripping out the coexistence
ScyllaDB ledger, score/conviction bands, external (non-dogfood) communities.

## 6. Acceptance criteria (each becomes a test)

| AC | Criterion | Maps |
|----|-----------|------|
| AC-1 | Replaying the same `event_id` twice is idempotent (one observation, `status:"duplicate"` on replay). | G-2, FR-2 |
| AC-2 | A Discord-only member stays `attribution_quality != verified` (unresolved) until identity-api verifies the link. | G-3, FR-5 |
| AC-3 | A wallet-only chain actor stays `wallet_only` until identity-api verifies it. | G-3, FR-5 |
| AC-4 | A verified `identity.wallet.linked` / `identity.account.linked` merges the wallet/discord alias into the `identity_user` conservatively (aliases + roles unioned, edges re-pointed). | G-3, FR-5 |
| AC-5 | Divergence report classifies incumbent vs Freeside roles (`match`/`freeside_higher`/`incumbent_higher`/`mismatch`) with a human reason, honoring `role_rank`. | G-4, FR-7 |
| AC-6 | Access-audit report includes evidence/summary counts + caveats and reuses the `shadow-audit` sealed output shape. | G-5, FR-9 |
| AC-7 | No code path mutates Discord roles (or any upstream source) — proven by a port-surface test (no outbound mutation method exists) **and** a dependency-boundary test that no mutation-capable upstream client is imported (NFR-4). | G-5, FR-10, NFR-4 |
| AC-8 | The existing Access Audit service can produce its aggregate from ledger projections (first-consumer binding demonstrated by a test/fixture). | G-6 |
| AC-9 | Ingest rejects an event whose `source` is not authorized for its `name` (e.g. a non-`identity_api` source emitting `identity.wallet.linked.v1`) and an event whose `community_id` is outside the producer's scope — proven by negative tests. | NFR-2, NFR-3 |
| AC-10 | A subject merge records merge provenance (triggering `event_id` + verified link); an `identity.link.revoked.v1` event is accepted and recorded without error. | FR-12, FR-13, NFR-5 |

## 7. Constraints & boundaries (from handoff, binding)

- Shadow Mode is **read-only** until explicit go-live; MUST NOT mutate Discord roles in MVP.
- MUST NOT become source of truth for identity, chain, billing, or scoring.
- **Owns**: composed observations, member-graph subjects/aliases/edges, snapshots, divergences, reports.
- NATS = movement; shadow ledger = composed member-graph truth; Postgres = persistence; Dashboard = presentation. Do not collapse these.
- Lives in-monolith as `packages/protocol/shadow-mode` + `packages/services/shadow-mode` (mirrors `shadow-audit`); commit scope `shared/shadow-mode`; extraction to a `freeside-shadow-mode` building deferred per ADR-008 factory direction.

## 8. Risks & open questions

| # | Risk / question | Disposition |
|---|---|---|
| R-1 | Table/type name collision with coexistence `shadow_divergences`. | New building owns a separate Postgres store + ownership-scoped names; documented in SDD. |
| R-2 | Building a 4th parallel shadow substrate (the deployed-but-unconsumed trap). | Mitigated: spine has a real first consumer (AC-8); reuses shadow-audit schemas; reconciles coexistence rather than duplicating. |
| R-3 | Event-driven ledger vs the coexistence 6h-batch `IShadowSync` model. | New ledger is event-driven via `POST /events`; coexistence batch sync is legacy, reconciled later. |
| R-4 | Who emits Discord roster snapshots / does Sonar publish broad attribution? | Out of MVP — ingest is transport-agnostic (`POST /events`); real emitters wired in a later cycle. |
| R-5 | Does the first report target a real community or a fixture? | MVP uses a deterministic demo fixture (handoff `fixtures.ts`); dogfood community wiring deferred. |

## 9. Definition of done

- `packages/protocol/shadow-mode` + `packages/services/shadow-mode` build and pass tests for AC-1..AC-8.
- All 8 ACs covered by runnable tests (idempotent ingest, conservative merge, divergence projection, read-only guarantee, report).
- Zero outbound mutation surface (port-level guarantee + test).
- Draft PR on `feat/shadow-mode-ledger` vs `origin/main`, surgical diff (only `shadow-mode` + the 7 event topics in `packages/events`), `shared/shadow-mode` commit scope, `domain:shared` beads label.
