# Software Design Document — Shadow Mode Ledger (`shadow-mode-api`)

> **Status**: candidate · **Cycle**: shadow-mode-ledger · **Date**: 2026-06-25 · traces to `grimoires/loa/prd.md` (v1).
> **Claim tags**: `[OBSERVED]` grounded in repo this cycle · `[DESIGN]` proposed.
> **Posture**: evolution-aware. Mirror `shadow-audit`'s package conventions; reuse its sealed schemas; extend `packages/events`.

## 0. Traceability (PRD → SDD)

| PRD | SDD section |
|-----|-------------|
| G-1, FR-1..3, FR-11 | §2 packages · §4 ledger store port · §5 reducer |
| G-2, FR-2, AC-1 | §5.1 idempotent ingest |
| G-3, FR-5, FR-12, AC-2..4, AC-10 | §5.3 conservative subject merge + provenance |
| G-4, FR-7, AC-5 | §5.4 divergence classification |
| G-5, FR-9..10, NFR-4, AC-6..7 | §6 access-audit report (reuse) · §7 read-only boundary |
| G-6, AC-8 | §6.2 first-consumer binding |
| NFR-1..3, FR-13, AC-9 | §8 ingest trust boundary |

## 1. Architecture overview

`shadow-mode-api` is an in-process **append-only ledger + reducer + read API**. Events arrive
(transport-agnostic) at `POST /events`, are persisted as immutable observations, reduced into
a member graph (subjects/aliases/edges/divergences), and served as projections. It mutates
nothing upstream. `[DESIGN]`

```
producers ──(shadow.event.v1)──▶ POST /events ──▶ ProducerPolicy(authz) ──▶ ShadowLedger.ingest
                                                                                   │
                                            append-only ──▶ ILedgerStore (observations)
                                                                                   │ reduce
                                              subjects · aliases · edges · divergences
                                                                                   │ project
       GET /member-graph · GET /unresolved · GET /shadow/divergences · POST /reports/access-audit
```

The reference implementation in the handoff (`ShadowLedger` over `Map`s) is the **executable
contract**; this SDD hardens it behind ports and the trust boundary from PRD §3.5.

## 2. Packages (mirror `shadow-audit`) `[OBSERVED]` convention

```
packages/protocol/shadow-mode      @freeside/shadow-mode-protocol   (Zod sealed schemas, topic builders)
  src/index.ts
  src/schemas/
    envelope.ts        EventEnvelope<shadow.event.v1> + ShadowEvent union
    events.ts          8 payload schemas (the consumed event names)
    subject.ts         ShadowSubject, SubjectKind, attribution_quality
    edge.ts            ShadowEdge, ShadowObservation, TruthStatus
    divergence.ts      ShadowDivergence, DivergenceKind
    report.ts          ShadowReport (re-exports shadow-audit AuditOutput shape)
    common.ts          SourceKind, WalletRef, alias helpers (reuse shadow-audit common where possible)
  src/topics.ts        buildTopic() helpers for the 8 subjects (hounfour 3-segment)

packages/services/shadow-mode      @freeside/shadow-mode-service    (reducer + ports + HTTP)
  src/shadow-ledger.ts             the reducer (ingest → reduce → project)
  src/ports/
    ledger-store.ts                ILedgerStore (append observation, upsert subject/edge/divergence/report, queries)
    producer-policy.ts             IProducerPolicy (verifyProducer: source×name×community authz)
  src/adapters/
    in-memory-store.ts             InMemoryLedgerStore (default/test) — the reference Map model
    postgres-store.ts              PostgresLedgerStore (seam; schema in sql/0001_shadow_mode.sql)
    static-producer-policy.ts      FAIL-CLOSED MVP default (source×name×community authz)
    allow-all-policy.ts            test double ONLY (guarded; never the deployed default)
    svc-jwt-policy.ts              [DESIGN] production producer-auth over identity-api svc-JWT (deferred wiring)
  src/http/shadow-router.ts        Hono router (the 5 endpoints)
  src/access-audit.ts              report builder (reuses @freeside/shadow-audit-protocol)
  sql/0001_shadow_mode.sql         Postgres schema (from handoff schema.sql, ownership-scoped)
  src/__tests__/                   AC-1..AC-10
```

Deps mirror shadow-audit: protocol = zod; service = hono + `@freeside/shadow-mode-protocol`
(`file:../../protocol/shadow-mode`) + `@freeside/shadow-audit-protocol` (report reuse). vitest 4.

## 3. Domain model `[DESIGN]` (from handoff `types.ts`, harmonized)

- `SourceKind` = `discord | identity_api | sonar | incumbent_bot | manual_config | freeside`
- `TruthStatus` = `observed | attested | inferred | estimated | unsupported | abstained`
- `SubjectKind` = `identity_user | discord_member | wallet_only | unresolved`
- `DivergenceKind` = `match | freeside_higher | incumbent_higher | mismatch`
- `EventEnvelope<TName, TPayload>` carries `event_id, schema_version:"shadow.event.v1", community_id, name, source, truth_status, observed_at, emitted_at, evidence_ref?, payload`.
- `ShadowSubject` = subject_id, community_id, kind, identity_user_id?, discord_user_id?, display_name?, wallets[], aliases[], current_roles[], incumbent_roles[], freeside_roles[], attribution_quality (`verified|observed_only|unresolved`), last_seen_at, **merge_provenance?** (event_id + verified link — FR-12).

Subject identity rule: a subject's `subject_id` is `${community_id}:${alias}`; aliases are
`identity:<user_id>`, `discord:<id>`, `wallet:<chain>:<addr-lowercased>`. The `aliasToSubject`
index resolves an alias to its owning subject.

## 4. `ILedgerStore` port `[DESIGN]`

```ts
interface ILedgerStore {
  // ATOMIC idempotent append (flatline SKP-001/002): returns true iff newly inserted.
  // Postgres: INSERT ... ON CONFLICT (event_id) DO NOTHING RETURNING event_id.
  // In-memory: a single synchronous check-and-set (atomic in JS's single thread).
  // There is NO separate check-then-act; the caller never races.
  appendObservationIfAbsent(o: ShadowObservation): boolean;
  // The reducer's apply() runs inside withTransaction so observation + projection
  // updates commit together (flatline SKP-003 partial-failure). In-memory is a no-op wrapper.
  withTransaction<T>(fn: () => T): T;
  getSubject(id: string): ShadowSubject | undefined;
  findSubjectByAlias(communityId: string, alias: string): ShadowSubject | undefined;
  upsertSubject(s: ShadowSubject): void;
  deleteSubject(id: string): void;                                // ONLY used by conservative merge (absorb)
  upsertAlias(communityId: string, alias: string, subjectId: string): void;
  hasEdge(edgeId: string): boolean;
  upsertEdge(e: ShadowEdge): void;
  reassignEdges(fromSubjectId: string, toSubjectId: string): void;
  upsertDivergence(d: ShadowDivergence): void;
  upsertReport(r: ShadowReport): void;
  // queries (community-scoped projections)
  subjects(communityId: string): ShadowSubject[];
  edges(communityId: string): ShadowEdge[];
  divergences(communityId: string): ShadowDivergence[];
}
```

The port exposes **no method that mutates an upstream source** (NFR-4 by construction). The
in-memory adapter is the reference `Map` model; the Postgres adapter implements the same
surface over `sql/0001_shadow_mode.sql`.

## 5. `ShadowLedger` reducer `[DESIGN]` (hardened port of the reference impl)

### 5.0 Append-only invariant (flatline SKP-004) — truth vs projection
**`shadow_observations` is the append-only truth layer** — never updated or deleted. The
member graph (`subjects`/`aliases`/`edges`/`divergences`) is a **derived projection**,
rebuildable by replaying observations in order. So conservative merge (§5.3) mutates the
*projection* (absorbs a subject), never the truth; the absorbed identity survives in the
observation log + `merge_provenance`. This reconciles "append-only" with "subjects mutate".

### 5.1 Idempotent ingest (AC-1) — atomic, no race
`ingest(event)` runs in `store.withTransaction(...)`: `if
(!store.appendObservationIfAbsent(obs)) return {status:"duplicate"}` (the append IS the
idempotency check — atomic, so concurrent delivery of the same `event_id` applies exactly
once, flatline SKP-001/002). On a fresh insert, dispatch on `event.name` to the apply-handler
**within the same transaction** (flatline SKP-003), return `{status:"ingested"}`. Edges are
idempotent per `${event_id}:${edge_kind}` (AC-1 covers both).

### 5.2 Apply handlers (one per event name) — port the reference `applyX` methods
discord.member.snapshot → `discord_member` subject + roles + `discord_member_seen` edge;
sonar.wallet.attributed → `wallet_only` subject + `sonar_<edge_kind>` edge;
incumbent.role.observed → set `incumbent_roles` + recompute divergence;
freeside.role.computed → locate subject (by locator) or `unresolved` + set `freeside_roles` + recompute divergence;
community.config.updated → store `role_rank/watched_contracts/incumbent_bot_ids`.

### 5.3 Conservative subject merge + provenance (AC-2..4, AC-10, FR-5/FR-12)
`identity.wallet.linked` / `identity.account.linked` create/load an `identity_user`
(`attribution_quality="verified"`), add the wallet/discord alias, and **merge** any pre-existing
`wallet_only`/`discord_member` subject for that alias into the identity_user:
union wallets/aliases/roles, re-point edges, delete the absorbed subject, record
`merge_provenance = { event_id, link: <wallet|account> }`. A Discord-only or wallet-only
subject **never** becomes `verified` without such an event (AC-2/AC-3). `identity.link.revoked.v1`
is accepted + recorded as an observation/edge **and downgrades** the affected subject's
`attribution_quality` `verified → observed_only` + flags it for re-split (flatline SKP-004 —
a revoked link must not leave a subject `verified` indefinitely). The full alias re-split
cascade is a named fast-follow; MVP guarantees the **downgrade + flag** (AC-10).

### 5.4 Divergence classification (AC-5)
`recompute(subject)`: skip if no incumbent/freeside roles. Else classify with `role_rank`:
equal sets → `match`; else compare `maxRank` → `freeside_higher` / `incumbent_higher`; else
`mismatch`. Persist a `ShadowDivergence` keyed `${community}:${subject_id}` with a human reason.

### 5.5 Projections
`getMemberGraph` / `getUnresolved` (attribution_quality≠verified) / `getDivergences` — pure
reads over the store, community-scoped, with the summary counts from the reference impl.

## 6. Access-audit report (G-5, FR-9, AC-6) — REUSE, don't redefine

`createAccessAuditReport(communityId)` builds a `ShadowReport` whose `summary` is shaped from
the existing **`@freeside/shadow-audit-protocol` `AuditOutput`/`AccessDecisionRecord`** vocabulary
(bands, evidence, provenance, caveats) `[OBSERVED]` — the ledger is the durable backing the
in-memory audit-service lacked. Caveats are mandatory ("read-only", "wallet-only ≠ person",
"only identity-verified links merge").

### 6.2 First-consumer binding (AC-8)
A test/fixture demonstrates the existing audit aggregate (`holder_turnover`, `sold_lapsed`,
`stale_access`) can be derived from ledger projections + the access-decision records — the
shadow-read-then-graduate cure for deployed-but-unconsumed. (Full service swap is a fast-follow;
this cycle proves the binding with a fixture.)

## 7. Read-only boundary (NFR-4, AC-7) — enforced two ways

1. **Port surface**: `ILedgerStore` and all service ports expose no upstream-mutation method.
2. **Dependency boundary test**: a unit test scans the `shadow-mode` package imports and fails
   if any mutation-capable upstream client is imported (Discord write client, role dispenser,
   identity-api write, sonar write). Report generation is asserted to emit no command/event.

## 8. Ingest trust boundary (NFR-1..3, AC-9) — `IProducerPolicy`

```ts
interface IProducerPolicy {
  // returns ok, or a typed rejection (unauthorized_source | cross_community | unknown_event)
  verifyProducer(ctx: { source: SourceKind; name: EventName; communityId: string; producer?: ProducerIdentity }): PolicyResult;
}
```

**The MVP default policy is FAIL-CLOSED, not allow-all** (flatline SKP-001/003, sev 860–870 —
a `PermissivePolicy` default would let a forged `identity_api` event merge subjects in any
deployed/shared env). The shipped default is `StaticProducerPolicy`:

- **NFR-2**: a static map of `source → allowed event names`. Only `identity_api` may emit
  `identity.*.linked.v1` / `identity.link.revoked.v1`. Any other `source`→`name` combination is
  **rejected** (401), not ingested (AC-9). This requires no JWT and ships fully in the MVP.
- **NFR-3**: `communityId` must be within the producer's declared scope; reject cross-community (AC-9).
- **NFR-1**: `StaticProducerPolicy` (the fail-closed MVP default, source/name/community checks) is
  composed with `SvcJwtPolicy` `[DESIGN]` (production producer *authentication* — verifies the
  identity-api svc-JWT, `packages/protocol/svc-jwt-claims.ts`, `POST /v1/auth/service-jwt`) when
  real emitters exist. An `AllowAllPolicy` exists **only as a test double** and is guarded so it
  can never be the deployed default (a config/assert refuses it outside `NODE_ENV=test`).

The router calls `verifyProducer` before `ingest`; a rejection short-circuits to 401 and writes
no observation. `verifyProducer` is pure (no I/O) for the static checks, so the trust boundary
holds even before producer authentication is wired.

## 9. Persistence (FR-11) `sql/0001_shadow_mode.sql`

Postgres (timestamptz/jsonb), from the handoff `schema.sql`, ownership-scoped to this building
(distinct store from the legacy coexistence ScyllaDB keyspace; resolves the `shadow_divergences`
name collision physically). Tables: `shadow_observations` (PK event_id), `shadow_subjects`,
`shadow_subject_aliases`, `shadow_edges`, `shadow_snapshots`, `shadow_divergences`,
`shadow_reports`. MVP runs on the in-memory adapter; the SQL is the migration seam, not wired to a live DB this cycle.

## 10. HTTP (Hono, mirror audit-router) `[OBSERVED]` convention

`POST /events` (202, `verifyProducer` then `ingest`) · `GET /communities/:id/member-graph` (200) ·
`GET /communities/:id/unresolved` (200) · `GET /communities/:id/shadow/divergences` (200) ·
`POST /communities/:id/reports/access-audit` (201) · `GET /health` (200). Errors: 401
(producer rejected), 400 (envelope invalid via Zod), 404 (unknown route).

## 11. Topics (`packages/events`) `[OBSERVED]` convention

Add 8 `buildTopic()` helpers (hounfour 3-segment, all 8 names validate): `discord.member.snapshot.v1`,
`identity.wallet.linked.v1`, `identity.account.linked.v1`, `identity.link.revoked.v1`,
`sonar.wallet.attributed.v1`, `incumbent.role.observed.v1`, `freeside.role.computed.v1`,
`community.config.updated.v1`. Pure additive export — no change to existing topics.

## 12. Test plan (AC → test)

| AC | Test |
|----|------|
| AC-1 | `ingest` same event twice → 1 observation, 2nd `duplicate` |
| AC-2 | discord snapshot only → subject `unresolved`/`observed_only` |
| AC-3 | sonar attribution only → `wallet_only`, not verified |
| AC-4 | identity.wallet.linked after wallet_only → merged `identity_user`, aliases/roles unioned, edges re-pointed |
| AC-5 | incumbent+freeside roles + role_rank → correct DivergenceKind + reason |
| AC-6 | report has summary counts + caveats, shaped to AuditOutput vocab |
| AC-7 | port-surface has no mutation method **+** dependency-boundary import test passes |
| AC-8 | audit aggregate derivable from ledger projections (fixture) |
| AC-9 | non-identity source emitting identity.*.linked → rejected; cross-community → rejected |
| AC-10 | merge records provenance; identity.link.revoked accepted without error |

Full demo fixture = handoff `fixtures.ts` (alice verified path + a wallet-only bob).

## 13. Out of scope (this cycle)

Live NATS consumer; dashboard UI; coexistence ScyllaDB ledger removal; score/conviction bands;
external (non-dogfood) communities; live Postgres + svc-JWT wiring (seams only).
