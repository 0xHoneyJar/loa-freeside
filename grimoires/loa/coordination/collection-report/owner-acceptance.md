---
status: conditional
acceptance_scope: technical-boundaries-only
human_ack: pending
---

# ACCEPT-LOA — Conditional Technical Owner-Boundary Acceptance

| Field | Value |
|---|---|
| Task | `ACCEPT-LOA` (`collection-report-coordinator-f09.9`) |
| Repository | `0xHoneyJar/loa-freeside` (this worktree) |
| Branch | `coord/collection-report-coordinator-f09.9` |
| Audited baseline | `origin/main` @ `3782fd47e8a20cdaf6325621962bd0443e6781b8` (2026-07-14; matches sprint §2) |
| Master plan | coordinator `grimoires/loa/{prd,sdd,sprint}.md` v0.3 / 0.5 / 0.6 |
| Date | 2026-07-16 |
| Author role | Loa platform multi-boundary audit (KRANZ dispatch; no CR implementation) |
| **Overall verdict** | **conditional** |

This artifact records **technical, conditional acceptance** of Loa’s planned
owner boundaries before CR issue creation (sprint §13). It is **not** human or
operator approval, **not** production readiness, **not** authorization to
implement or create CR issues, and **not** a claim that `origin/main` already
implements collection-report Ordering, shared identity schemas, trust-stream
dependency ledgers, or restricted Gate Leak evidence.

**Hard non-invention rule (this dispatch):** CR-000 Discord viability Go/No-go
and privacy/security co-signatures are **absent** on the audited revision.
This document does **not** invent, forge, backdate, or imply those signatures.

---

## 1. Verdict summary by owner boundary

Notation: `CR-NNN*` means every lettered variant of `CR-NNN`.

| Owner boundary | Verdict | One-line finding |
|---|---|---|
| Shared protocol (CR-001/002/005/009/010) | **blocked** (surface absent) / **conditional** (authority commit) | No `CollectionDeploymentRef`, trust-envelope, or artifact-manifest package on `main`; events-pillar `acvp-l1-v2` ≠ CR-009 Ordering trust envelope |
| Ordering (CR-006/007*/012*/201*/202/204*/205–208) | **conditional** | Durable order + outbox + lifecycle exist for `access-risk-audit` / `community-onboarding` only; no `collection-report`, resolutions, shared work DAG, demands, or restricted cancellation |
| Shadow Audit (CR-000/016/018) | **blocked** (CR-000 + Gateway producer) / **conditional** (boundary) | Live k-anon audit + file `RoleSnapshot` + open collection capability read exist; no Discord Gateway capture epoch, gate-mapping aggregate, or signed Discord-policy authority record |
| Privacy / security (CR-015 + co-sign CR-000/007B/010/014 surfaces) | **blocked** (signatures / review evidence) / **conditional** (boundary) | k-anon bands and contact-consent route are precedent only; no CR-015 disclosure review packet and no privacy/security signature on Discord viability |
| Platform / deployment (CR-013/209A/209B) | **conditional** | Railway deploy runbooks for Ordering + Shadow Audit exist; production signing-key custody registry, mixed-version rehearsal authority, and collection-report flags are absent |
| Coordinator (CR-019 + gate graph) | **conditional** | This acceptance artifact advances the graph; machine-readable gate manifest and operator issue-creation approval remain open |

**Overall: conditional.** Loa accepts the *authority splits* in SDD §3.1 / §6 /
§11 / §17 and will own the Loa-primary CRs named in sprint §12, but
`origin/main` is a **seed substrate**, not the collection-report system. T0/T1
planning may proceed only behind the public closure conditions in §8. T2 /
restricted Gate Leak remains **blocked** until CR-000 is a real signed
Go/No-go (or explicit No-go) and the privacy/security co-signature conditions
close — neither may be invented here.

---

## 2. Exact interfaces produced and consumed

### 2.1 Present on audited `origin/main` (baseline evidence)

#### Shared / cross-cutting

| Interface | Location | Notes |
|---|---|---|
| Ordering product IDs | `packages/protocol/ordering/src/order.ts` | `ProductId = 'access-risk-audit' \| 'community-onboarding'` only |
| Ordering presets + capability needs | `packages/protocol/ordering/src/preset.ts` | Fixed recipes; no `collection-report` |
| Ordering lifecycle event schemas | `packages/protocol/ordering/src/events.ts` | `placed → routing → producing → fulfilled \| failed` |
| Kitchen ingredient / public order projection types | `packages/protocol/ordering/src/kitchen.ts` | Onboarding kitchen surface |
| Shadow Audit sealed order + gating | `packages/protocol/shadow-audit/src/schemas/order.ts` | `nft-balance` only; product `'audit'`; lead-magnet mode |
| Shadow Audit aggregate / k-anon bands | `packages/protocol/shadow-audit/src/schemas/audit-output.ts` | Cohort bands; never a numeric score |
| JCS + SHA-256 helpers (Shadow Audit) | `packages/protocol/shadow-audit/src/jcs.ts` | Useful seed; not the CR-001 shared identity digest package |
| Events-pillar signed envelope | `packages/events/src/envelope.ts` | `SCHEMA_VERSION = "acvp-l1-v2"`; NATS/JetStream cell events — **not** CR-009 transactional Ordering trust envelopes |

#### Ordering service

| Interface | Contract today | Evidence |
|---|---|---|
| `GET /healthz` | Write-route posture reporting | `packages/services/ordering/DEPLOY.md` |
| `POST /v1/orders` | Place preset order → `{ order_id }` | `src/intake.ts`, DEPLOY.md |
| `GET /v1/orders/:id` | Public projection + ingredients / probe_meta | `src/intake.ts`, `src/projection.ts` |
| `POST /v1/orders/:id/advance-ingredient` | Bearer `SERVICE_TOKEN` | DEPLOY.md |
| `POST /v1/orders/:id/reprobe` | Bearer; cooldown 429 | DEPLOY.md |
| Durable store + outbox | `orders`, `order_outbox` | `migrations/001_orders.sql` |
| Lifecycle publisher port | Drain outbox → publisher (at-least-once) | `src/lifecycle-publisher.ts` |
| Order state machine | `placed/routing/producing/fulfilled/failed` | `src/order-state.ts` |
| Ed25519 order signer | Signs canonical audit order (access-risk path) | `src/order-signer.ts` |
| Kitchen probes | Sonar status/ingest + Shadow Audit collection capability | `src/http-building-probes.ts` |

Auth posture today: MVP intake still treats `placed_by` as caller-asserted;
deployed write routes fail closed without `SERVICE_TOKEN`. This is **not** the
SDD §11 subject/resource/action authorization model for collection-report.

#### Shadow Audit service

| Interface | Contract today | Evidence |
|---|---|---|
| `GET /v1/audit` | Anonymous k-anon aggregate; rate-limited; optional `X-API-Key` | `src/http/audit-router.ts`, `DEPLOY.md` |
| `POST /v1/audit` | Named output; AssociationVerifier; **fail-closed 401 until wired** | `src/server.ts`, DEPLOY.md |
| `POST /v1/audit/reaction` | Run-window reaction capture | audit-router |
| `POST /v1/audit/contact` | Consented contact capture | audit-router |
| `GET /v1/audit/view` | Thin HTML view | audit-router |
| `GET /v1/collections/:chain/:contract` | OPEN capability / membership read | audit-router + server key skip |
| File `RoleSnapshot` | Discord role export JSON via `ROLE_SNAPSHOT_PATH` | `src/role-snapshot.ts`, `src/role-source.ts` |
| Collection registry | Operator-supplied `COLLECTION_REGISTRY` map to belt collection ids | DEPLOY.md |
| Settle gate | Ratified collection ledger snapshot at boot | `bin/http.ts` |

### 2.2 Required by plan; absent on `3782fd47`

Zero matches on audited tree for:
`CollectionDeploymentRef`, `collection-report`, `collection_resolver`,
`TrustEnvelope` / CR-009 Ordering envelope, `dependency.ledger`,
`capability.demand`, `gate_mapping`, hierarchical `artifact_manifest` /
Key Index contracts as named by the masters.

| Planned interface | Owning CR(s) | Status on `main` |
|---|---|---|
| Shared `CollectionIdentifier` / `CollectionDeploymentRef` / digests / fixtures | CR-001, CR-005 | **Absent** |
| Gate Leak capability scopes + work-key shareability | CR-002 | **Absent** as versioned recipe authority |
| Resolution sessions create/confirm/refresh | CR-006 | **Absent** |
| Public / restricted authorization grants + leases | CR-007A, CR-007B | **Absent** (token MVP ≠ SDD ACL) |
| Signed trust-envelope protocol for Ordering dependency ledger | CR-009 | **Absent** (events pillar is adjacent, not equivalent) |
| Hierarchical artifact-manifest contract | CR-010 | **Absent** |
| Public / restricted dependency ledger + quarantine | CR-012A, CR-012B | **Absent** |
| Production signing-key custody + pinned service-key registry | CR-013 | **Absent** as collection-report custody |
| Restricted disclosure / deletion review packet | CR-015 | **Absent** |
| Discord Gateway capture + gate-mapping aggregate + role snapshot producer | CR-016, CR-018 | **Absent** (file export ≠ Gateway epoch) |
| Machine-readable gate manifest | CR-019 | **Absent** |
| Shared preparation persistence / admission reservation | CR-201A/B/C | **Absent** |
| `collection-report` Ordering preset + staged DAG | CR-202 | **Absent** (`ProductId` enum closed) |
| Sonar / Shadow Audit / Identity preparation adapters | CR-204A/B | **Absent** |
| Gate Leak generation + artifact saga | CR-205 | **Absent** |
| Authenticated report list/detail/artifact projections | CR-206 | **Absent** |
| Backpressure / chaos proof | CR-207 | **Absent** for collection-report |
| Capability-demand API | CR-208 | **Absent** |
| Mixed-version cutover plan + rehearsal | CR-209A/B | **Absent** |
| Discord-policy authority record (Go/No-go) | CR-000 | **Absent — must not be invented** |
| SDD §17 collection-report feature flags | rollout | **Absent** |

### 2.3 Interfaces Loa commits to produce (after CRs; acknowledged, not implemented)

**Shared protocol produces (consumers: Sonar, Inventory, Identity, Storage, Dashboard, Ordering, Shadow Audit):**

- Versioned `CollectionIdentifier`, `NetworkRef`, `CollectionDeploymentRef`,
  `CollectionIdentity`, `CollectionCandidate`, provenance, recognition states
  (CR-001).
- Cross-repo fixture harness + pinned package (CR-005).
- Detached Ed25519 trust envelopes with `(stream_epoch, sequence)`, key registry
  binding, inbox uniqueness, and Ordering reverse-dependency ledger semantics
  (CR-009 / CR-012*).
- Hierarchical `artifact_manifest.v1` wire (CR-010).

**Ordering produces:**

```text
POST   /v1/collection-resolutions
POST   /v1/collection-resolutions/:resolution_id/confirm
POST   /v1/collection-resolutions/:resolution_id/refresh
POST   /v1/orders                         # product=collection-report
GET    /v1/orders/:order_id
GET    /v1/orders?product=collection-report&community_ref=...
POST   /v1/capability-demands
GET    /v1/capability-demands?community_ref=...
GET    /v1/capability-demands/:demand_id
DELETE /v1/capability-demands/:demand_id
POST   /v1/orders/:order_id/restricted-cancellations
POST   /v1/report-attention/:source_kind/:source_id/:transition_sequence/seen
# plus authenticated artifact aggregate / identity-row / export / delete projections (CR-206)
```

**Shadow Audit produces (after CR-000 Go and CR-016/018):**

- Versioned `gate_mapping.v1` aggregate with ratifier, immutable version/digest,
  effective/revoked times, optimistic concurrency, audit history.
- Discord Gateway capture epoch/cursor, role snapshot generations, and signed
  restricted evidence envelopes for Ordering replay (CR-011B participant path
  via Identity + Shadow Audit).
- Discord-policy authority record version bound into restricted work keys
  (CR-000 output) — only when real owners sign.

Schema/version consumers pin: **published shared-protocol package versions from
CR-001/005/009/010** — exact package names/versions TBD at issue creation; hand
mirrors across Dashboard/Sonar are forbidden (CR-005).

---

## 3. Authority and data boundaries

### 3.1 Shared protocol owns

- Cross-VM identity schemas, digests, golden fixtures, and contract harness.
- Trust-envelope wire + key-capability binding semantics (not key custody ops).
- Artifact-manifest schema (Storage implements Key Index; protocol owns wire).

### 3.2 Ordering owns

- Resolution sessions and confirmation (sole writer).
- One durable order per operator request; shared preparation coordination;
  work links; outbox; public and restricted projections.
- Reverse dependency ledger from key/envelope IDs to work, orders, manifests,
  exports, attention, and caches.
- `report:*` grant authority projections consumed under leases (SDD §11.1).
- Capability-demand system of record (Sonar sees aggregates only).

### 3.3 Shadow Audit owns

- Gate-mapping aggregate authority and Discord role / Gateway evidence for Gate
  Leak after CR-000 Go.
- Guild/bot integration authority stream for authorization watermarks.
- Honest refusal for unsupported gate rules (`unsupported_gate_rule` /
  `unsupported-gating` lineage).

### 3.4 Privacy / security owns

- CR-015 restricted-data and aggregate disclosure review.
- Co-signature on CR-000 Discord-policy Go/No-go (with Discord application
  owner).
- Review of retention, disclosure bands, deletion/restore quarantine evidence
  before T2.

### 3.5 Platform / deployment owns

- Production signing-key custody, rotation, compromise response (CR-013).
- Mixed-version rollout plan authority and production cutover rehearsal
  (CR-209A/B) with every service key holder.

### 3.6 Coordinator owns

- Machine-readable gate manifest (CR-019) as exhaustive transitive closure for
  release decisions.
- Tracking of ACCEPT-* artifacts and gate graph readiness; does **not** waive
  owner acceptance by planning-doc agreement alone (sprint §13).

### 3.7 Forbidden inferences and persistence

Loa must not:

| Forbidden | Why | Current risk on `main` |
|---|---|---|
| Invent CR-000 Go / privacy signatures | Sprint G-1; legal/policy | **None present — keep it that way** |
| Treat file `RoleSnapshot` as Gateway-bound `discord_role_snapshot.v1` | CR-016/018 | File path export is dogfood seed only |
| Treat `access-risk-audit` / lead-magnet OrderSchema as Gate Leak recipe | CR-002/202 | Different product; sealed `nft-balance` audit ≠ one-directional leak classification |
| Infer gate mapping from collection or role names | Sprint §15 primary uncertainty | No mapping aggregate yet — do not invent one from registry |
| Infer purpose consent from wallet link, session, or prior audit use | Identity owns CR-017 | Shadow Audit contact consent ≠ Gate Leak purpose grant |
| Collapse recognized / indexed / ready / eligible / proven_ineligible | PRD/SDD truth boundaries | Current Kitchen “indexed” proxy must not be imported as Ordering readiness |
| Claim events-pillar envelopes satisfy CR-009 Ordering ledger | G1B-1 | Different subject model and consumer |
| Use caller `placed_by` as community authorization | SDD §11 | MVP intake still asserts `placed_by` |
| Persist subscriber lists or notification delivery truth in Sonar Kitchen | Ordering owns | Ordering onboarding still carries `contact_email` — must not become Gate Leak fan-in authority |
| Approximate Gate Leak with aggregate-only Discord-free fallback if CR-000 is No-go | Sprint T2 rule | Must keep Gate Leak unavailable with honest external-dependency reason |
| Raise V1 thresholds via env without contract/version update | Sprint thresholds | No collection-report flags yet; when added, CI must hard-lock |

### 3.8 Boundary acknowledgment

Loa **accepts** SDD §3.1: Dashboard presents; Sonar resolves/indexes physically;
Ordering owns sessions/orders/shared work; Shadow Audit owns gate/Discord
evidence; Identity owns links/consent; Storage owns Key Index; protocol owns
shared wire. Loa **rejects** any plan that makes Shadow Audit’s current lead-
magnet audit, Ordering’s onboarding kitchen, or the events pillar a silent
substitute for the collection-report contracts above.

---

## 4. Bottom-up capacity / headcount estimates

Engineering estimate only — **not** operator-approved staffing or calendar
commitment. Complexity taken from sprint CR cards. Conversion used here:
**S ≈ 2–4 eng-days**, **M ≈ 5–8**, **L ≈ 10–16**, with explicit uncertainty.
Excludes Sonar/Inventory/Storage/Identity/Dashboard primary effort (sibling
ACCEPT docs). Includes Loa participation only where Loa is primary.

### 4.1 Shared protocol

| CR | Complexity | Estimate (eng-days) | Uncertainty |
|---|---|---|---|
| CR-001 identity + digests | M | 6–10 | Medium (cross-VM fixtures + NFC/JCS edge cases) |
| CR-002 Gate Leak scopes | M | 5–8 | **High** until live gate-map authority proof |
| CR-005 harness (Loa primary + per-repo S) | S–M | 4–8 Loa + coordination | Medium |
| CR-009 trust envelopes | M | 8–12 | **High** (must not conflate with events pillar) |
| CR-010 artifact manifest | M | 5–8 | Medium (Storage CR-014 coupling) |

**Subtotal shared protocol: ~28–46 eng-days** · assumed **0.5–1.0 FTE** protocol
maintainer through foundation.

### 4.2 Ordering

| CR | Complexity | Estimate (eng-days) | Uncertainty |
|---|---|---|---|
| CR-006 resolution sessions | M | 6–10 | Medium |
| CR-007A public authz | M | 6–10 | High (new ACL vs MVP token) |
| CR-007B restricted policy | M | 6–10 | High (blocked on CR-000 path) |
| CR-012A public ledger | L | 10–16 | High |
| CR-012B restricted ledger | L | 10–16 | High |
| CR-201A public shared work | L | 12–18 | High |
| CR-201B restricted evidence | L | 12–18 | **Very high** |
| CR-201C admission reservation | M | 5–8 | Medium |
| CR-202 collection-report preset | L | 12–18 | High (staged DAG certificate) |
| CR-204A Sonar adapter | L | 10–14 | Medium–high |
| CR-204B restricted adapters | L | 10–16 | High |
| CR-205 generation + artifact saga | L | 12–18 | High |
| CR-206 projections | M | 6–10 | Medium |
| CR-207 backpressure/chaos | M | 6–10 | Medium–high |
| CR-208 capability demand | M | 5–8 | Medium |

**Subtotal Ordering: ~128–200 eng-days** · assumed **1.5–2.0 FTE** Ordering
maintainers through S2; **+0.5 FTE** during CR-201B/205/209 peak.

### 4.3 Shadow Audit

| CR | Complexity | Estimate (eng-days) | Uncertainty |
|---|---|---|---|
| CR-000 viability packet (evidence assembly only) | S | 2–4 eng + **external owner calendar** | Calendar-bound; unknown ≠ Go |
| CR-016 gate + Discord producer | L | 12–18 | **Very high** (Gateway intents/limits) |
| CR-018 active-guild capture feasibility | M | 5–8 | High |

**Subtotal Shadow Audit eng: ~19–30 eng-days** plus Discord application owner
and privacy/security review time **outside** eng-days. Assumed **0.5–1.0 FTE**
Shadow Audit after Go.

### 4.4 Privacy / security, platform, coordinator, ops

| CR | Complexity | Estimate | Uncertainty |
|---|---|---|---|
| CR-015 disclosure review | M | 5–8 eng-days + review board time | High (legal/policy) |
| CR-013 key custody | L | 10–16 | High (HSM/process) |
| CR-209A cutover plan | L | 8–12 | Medium |
| CR-209B rehearsal | L | 8–14 | High (env availability) |
| CR-019 gate manifest | M | 4–7 | Medium |
| CR-403 metadata snapshot decision | S | 1–3 | Low |
| CR-404 capacity dashboard/runbook | M | 5–8 | Medium |

**Subtotal: ~41–68 eng-days** · platform **0.5 FTE**; coordinator **0.25 FTE**;
ops **0.25 FTE** post-rehearsal (re-estimate after CR-404).

### 4.5 Aggregate Loa-primary

| Aggregate | Value |
|---|---|
| Central estimate | **~280 eng-days** (arithmetic midpoint of the component range; any different planning anchor requires an explicit U-14 derivation) |
| Range | **~216–344 eng-days** |
| Assumed peak headcount | **3.0–4.0 planned FTE** during S2/S3, assuming protocol, Ordering, and Shadow Audit upper-bound peaks do not overlap; the coincident upper envelope is approximately **5.0 FTE** |
| Assumptions | Upstream Sonar/Inventory/Identity/Storage ACCEPT conditions close without redesign; CR-000 resolves within 10 business days once started; protocol, Ordering, and Shadow Audit upper-bound peaks are staggered; no second queue invented; Railway Ordering/Shadow Audit remain deployable seeds |
| Retention / capacity fixtures Loa must meet (V1 thresholds) | 50k subjects; 500-subject pages; ≤1k Gateway deltas / 5m; ≤60s auth projection lag; ≤30s lease; ≤2s DB skew; 500 rows/page; 1 MiB ceilings; 30-day max restricted retention; disclosure bands per sprint; 20 demands/subject; 500/community — **none measured for collection-report on `main`** |

An issue without a reconfirmed estimate at creation remains **not ready**
(sprint §13).

---

## 5. Mixed-version behavior, flags, deploy order, rollback limits

### 5.1 Acknowledged matrix (SDD §16.6)

| Pairing | Required behavior |
|---|---|
| New Dashboard → old Ordering | Fail closed behind server flag |
| Old Dashboard → new Ordering | Continue reading existing projections |
| New Ordering → old Sonar | Compatibility adapter **or** reject before accept |
| New Sonar → old Ordering | Ignore safely or translate at versioned boundary |
| New Ordering → old Identity / Shadow Audit lacking MVCC/Gateway/erasure/epochs | **Refuse restricted admission before order creation** |
| New manifests → old Storage | Remain provisional; cannot fulfill |
| Rollback with in-flight work | Preserve every accepted order and evidence generation |
| Expand/deploy/constrain | Rollback allowed until all readers support constrained schema |

### 5.2 Feature flags Loa will honor (server-evaluated; SDD §17)

- `collection_resolver_enabled`
- `collection_report_ordering_enabled`
- `collection_report_async_enabled`
- `collection_public_preparation_enabled`
- `collection_report_restricted_enabled`
- `collection_report_restricted_rows_enabled`
- `report_notifications_enabled`
- `resolver_operation_enabled[namespace:reference:operation]`

**None exist on `3782fd47`.** Closest live controls (`SERVICE_TOKEN` write
posture, `KITCHEN_*`, `ROLE_SNAPSHOT_PATH`, `AUDIT_K`) are **not** substitutes.

### 5.3 Deploy position (Loa-owned sequence)

This is a deployment sequence, not an exhaustive tier-closure or dependency
list. The coordinator master sprint tier table and CR-019 manifest remain
canonical for T0/T1/T2 membership and transitive closure.

1. CR-001/005 fixtures published before any consumer implements recognition UI
   against hand mirrors.
2. CR-009 + CR-013 key registry before CR-011A/012A ledger closure.
3. T1 public preparation path
   (CR-201A/CR-201C/CR-202/CR-203/CR-204A) behind public flags before any
   user-visible async preparation; its C1/C2 prerequisites include
   CR-006/CR-007A/CR-009/CR-011A/CR-012A/CR-013.
4. CR-000 signed record **before** CR-007B/016/201B/204B restricted work is
   issue-ready for T2 (CR-010 may proceed after G-1 Go per sprint chain C3).
5. CR-012B/015/205/206 restricted E2E before `collection_report_restricted_*`
   flags.
6. T0 support demand (CR-208) may proceed independently after
   CR-006/007A/102.
7. CR-209A plan before CR-209B rehearsal; rehearsal before production constrain.

### 5.4 Rollback limits

- May disable new collection-report admission while preserving accepted orders.
- May disable restricted / notification / network flags independently.
- Must **not** roll back by deleting pending reports, work links, or evidence
  generations.
- Must **not** enable restricted flags if CR-000 authority is expired, revoked,
  or unsigned.
- Must **not** treat events-pillar key rotation as Ordering trust-envelope
  custody without CR-013 binding.

---

## 6. Operational ownership

| Concern | Owner | Current state on `main` | Gap |
|---|---|---|---|
| Ordering HTTP health / token rotation | Ordering maintainer | DEPLOY.md + `docs/token-rotation-runbook.md` | No collection-report runbook |
| Ordering outbox drain / stuck producing | Ordering | Outbox publisher port exists | No shared-work / DAG reconciliation alerts |
| Shadow Audit live correctness (registry/RPC) | Shadow Audit | DEPLOY.md live-correctness gate | File snapshot staleness ops only |
| Discord Gateway capture / intent limits | Shadow Audit + Discord app owner | **Missing** | CR-016/018 + CR-000 standing renewal |
| Trust-stream gap / epoch reset / key revoke | Ordering ledger + producers | Events pillar ≠ ledger | CR-009/012*/013 |
| Restricted deletion / restore quarantine | Privacy + Storage + Ordering | **Missing** | CR-014/015/205 |
| Capacity dashboard | Ops (CR-404) | Absent | Need shared SLO board |
| Gate graph / release closure | Coordinator (CR-019) | Planning YAML only | Machine-readable manifest |
| Safe disable of restricted program | Platform + privacy + Discord app owner | N/A | Must follow CR-000 expiry/revocation semantics |

**CODEOWNERS** today defaults broadly to `@janitooor`; that is repository review
ownership, **not** named collection-report on-call for Ordering/Shadow Audit/
key incidents.

**Ops acknowledgment:** Ordering on-call owns order/outbox/shared-work
incidents and subscriber-visible Needs attention. Shadow Audit on-call owns
Gateway/role/mapping health after those surfaces exist. Platform owns key
compromise. Privacy owns disclosure/deletion incidents. Coordinator owns gate
manifest truth. Discord application owner owns CR-000 renewal.

---

## 7. Current evidence

### 7.1 Audit evidence (this acceptance)

| Claim | Proof |
|---|---|
| Audited tree matched sprint loa-freeside baseline before this artifact was authored | `origin/main` @ `3782fd47…`, verified 2026-07-16 |
| Product enum lacks collection-report | `packages/protocol/ordering/src/order.ts` |
| Order lifecycle + outbox exist | `order-state.ts`, `migrations/001_orders.sql`, `lifecycle-publisher.ts` |
| Shadow Audit k-anon + file RoleSnapshot | `audit-router.ts`, `role-source.ts`, DEPLOY.md |
| No collection-report protocol symbols | Tree search: zero hits for listed symbols in §2.2 |
| No CR-000 / Discord-policy authority artifact | No `*cr-000*` / Discord-policy record in repo |
| Events envelope is `acvp-l1-v2` | `packages/events/src/envelope.ts` |
| Order ed25519 signer exists for audit path | `order-signer.ts` |
| Railway deploy seeds | `packages/services/{ordering,shadow-audit}/DEPLOY.md` |

### 7.2 Existing tests (precedent only — not collection-report gate evidence)

| Area | Observation |
|---|---|
| Ordering service | 25 test files under `packages/services/ordering/src/__tests__/` |
| Shadow Audit service | ~2210 lines across `__tests__/` (DEPLOY.md cites 105-test unit suite historically) |
| Protocol packages | `packages/protocol/{ordering,shadow-audit}` carry fixture + schema tests |

These validate current onboarding / lead-magnet behavior. They do **not**
satisfy G0/G1/G1B/G3/G4/G4A/G4B or any collection-report CR verification.

### 7.3 Lightweight validation performed for this docs dispatch

| Check | Result |
|---|---|
| Branch is `coord/collection-report-coordinator-f09.9` | Pass |
| Audited worktree matched `origin/main` @ `3782fd47` before the authoring commit | Pass (verified 2026-07-16) |
| Required sections present in this artifact (verdicts, interfaces, boundaries, forbidden inferences, capacity, mixed-version/flags/rollback, ops, evidence, unresolved, closure) | Pass (author checklist) |
| Claim spot-check: `ProductId` enum contents | Pass |
| Claim spot-check: absence of `CollectionDeploymentRef` / `capability.demand` / trust-envelope symbols | Pass |
| Claim spot-check: no CR-000 signature file invented or referenced as existing | Pass |
| Package vitest execution in this worktree | **Not run** — `vitest` binary not installed in package/`node_modules` here; docs-only dispatch does not claim suite green |

---

## 8. Unresolved evidence and exact gate-closing conditions

| ID | Severity | Unresolved evidence | Exact closure condition | Unblocks |
|---|---|---|---|---|
| U-1 | **Blocker (T2)** | No signed Discord-policy Go/No-go | Discord application owner + privacy/security owner sign versioned CR-000 record (verification, `GUILD_MEMBERS` intent, limits, terms determination, purposes/data classes, effective time, ≤90-day expiry, emergency revocation). **Unknown/pending at deadline = No-go for T2.** | G-1; CR-007B/016/018 issue-ready for restricted; T2 |
| U-2 | **Blocker** | Shared identity schemas unpublished | CR-001 + CR-005 publish pinned package + golden fixtures decoded by ≥1 Dashboard and ≥1 Sonar consumer test | G0; all identity consumers |
| U-3 | **Blocker** | Gate Leak scopes / work keys unratified | CR-002 fixtures prove shareability, one-directional classification, 80% coverage rule, mapping authority | G1; CR-202 |
| U-4 | **Blocker** | No resolution / stale-selection contract | CR-006 races + digest CAS fixtures | Public order intake |
| U-5 | **Blocker** | No CR-009 Ordering trust envelope | Envelope vectors + one producer/consumer replay (with Sonar CR-011A) | G1B-1; CR-012A |
| U-6 | **Blocker** | No dependency ledger / quarantine | CR-012A/012B parity + gap/epoch/key-compromise fixtures | G1B-2/3; restricted persistence |
| U-7 | **Blocker** | No production key custody registry | CR-013 pinned registry, rotation, compromise drill | Public+restricted signed intake |
| U-8 | **Blocker (restricted)** | No Gateway/gate-map producer | CR-016/018 prove epoch/cursor, mapping aggregate, capture feasibility | G1B-3; CR-204B/201B |
| U-9 | **Blocker (T2)** | No CR-015 disclosure/deletion review | Privacy/security signed review packet against sprint disclosure bands + retention | G1B-4/G4B |
| U-10A | **Blocker** | No T1 public preparation path | CR-201A/CR-201C/CR-202/CR-203/CR-204A land behind public flags with admission limits and their C1/C2 prerequisites closed | T1 public preparation proof |
| U-10B | **Blocker (T2)** | No authenticated report list/detail/artifact projections | CR-206 lands behind restricted flags after its privacy, storage, authorization, and evidence dependencies close | T2 report return path |
| U-10C | **Blocker** | No recognition-only support-demand API | CR-208 lands after CR-006/007A/102 with bounded, non-ordering demand semantics | T0 support demand |
| U-11 | High | No collection-report feature flags / CI hard lock | Flags from §5.2 + tests proving restricted enablement cannot bypass CR-019 manifest | Any production enablement |
| U-12 | High | No mixed-version rehearsal | CR-209A matrix + CR-209B operator-signed rehearsal evidence | Integration release candidate |
| U-13 | High | No CR-019 machine-readable gate manifest | Approved manifest is exhaustive transitive closure | Release decisions |
| U-14 | Medium | Headcount/capacity unconfirmed by humans | Operator ack of §4 (or revised numbers) recorded in coordinator | Issue-creation readiness |
| U-15 | Medium | No named collection-report on-call / runbooks | CR-404 + named owners for Ordering, Shadow Audit, keys, Discord renewal | Ops acceptance |
| U-16 | Medium | This artifact is not human owner sign-off | Authorized Loa boundary owners explicitly acknowledge §1–§8 after review | Final ACCEPT-LOA human gate |

**Coordinator rule:** Loa CR implementation issues stay **not ready** while their
row’s blocker conditions remain open. Planning agreement in PRD/SDD/sprint is
insufficient (sprint §13). CR-000 and privacy/security signatures **must be
external real artifacts** — absence here is evidence, not permission to invent.

---

## 9. Explicit non-claims

- Does **not** authorize implementing any CR, opening issues, push, PR, or merge.
- Does **not** invent or imply CR-000 Discord viability Go or privacy/security
  co-signatures.
- Does **not** accept production enablement of collection recognition or Gate
  Leak.
- Does **not** equate `access-risk-audit`, community-onboarding kitchen, file
  RoleSnapshot, or events-pillar envelopes with collection-report contracts.
- Does **not** treat current `placed_by` MVP auth as SDD §11 authorization.
- Does **not** claim vitest suites were executed in this worktree.
- If CR-000 is No-go: T0 recognition substrate and T1 controlled public
  preparation may remain; Gate Leak stays unavailable with an honest
  external-dependency reason — **no aggregate-only approximation**.

---

## 10. Sign-off state

| Role | Status |
|---|---|
| Loa multi-boundary technical acceptance (this artifact) | **conditional** |
| Shared-protocol maintainer human ack | **pending** (U-16) |
| Ordering maintainer human ack | **pending** (U-16) |
| Shadow Audit maintainer human ack | **pending** (U-16) |
| Privacy/security owner | **unsigned** (U-1, U-9) — do not invent |
| Discord application owner | **unsigned** (U-1) — do not invent |
| Platform/deployment owner | **pending** |
| Coordinator / CR-019 | **pending** |
| Operator confirmation of §4 capacity | **pending** (U-14) |

**Strongest caveat:** `origin/main` already has a persuasive Ordering outbox
lifecycle and a Shadow Audit k-anon Gate-Leak-*shaped* lead magnet, which makes
it dangerously easy to treat those seeds as the collection-report system — while
CR-000 Discord viability and privacy/security signatures are still **missing
entirely**; inventing either signature, or silently upgrading file RoleSnapshots
and `access-risk-audit` into restricted Gate Leak authority, would falsify G-1,
G1B-3, and every T2 release claim that depends on them.
