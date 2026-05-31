---
title: "Sprint Plan — CubQuests → activities-api Extraction"
cycle: cubquests-activities-extraction
status: candidate
date: 2026-05-30
domain: network
prd: grimoires/loa/cycles/cubquests-activities-extraction/prd.md
sdd: grimoires/loa/cycles/cubquests-activities-extraction/sdd.md
dispatch_targets: [activities-api, cubquests-interface, loa-freeside]
flatline: "3-model headless 2026-05-30 — integrated SDD §12; OQ-4 ratified §13"
---

# Sprint Plan — CubQuests → activities-api Extraction

> **Plan-here / dispatch-there.** Every task carries `[repo:X]` (dispatch target) + `domain:network`. `/coord` dispatches headless agents per `[repo:]` tag; loa-freeside holds the cross-repo beads graph. Test-first where a conformance suite or parity test exists. **No cross-domain `blocked-by`** (all `domain:network`).

## Lane A — runtime-extraction · `[repo:activities-api]`

| Task | What | Acceptance | Dep |
|---|---|---|---|
| **T-A0** [spike] | Hyper↔Effect timeboxed spike (OQ-2 · IMP-003), 1-day box | A `/health` route serves via Hyper, OR documented fallback to `@effect/platform` HTTP | — |
| **T-A1** | Seam-B Postgres adapters: `makePostgresEventStore/Reward/Progress/IdentityResolver` + `event_store` DDL migration (§12.7) | Conformance stubs flipped `.skip→.run`, pass **UNMODIFIED** (CL-EventStore-1..7); CAS at **SERIALIZABLE** (§12.2); `event_id` via `computeEventId` (§12.3). **Test-first** (suite IS the test) | — |
| **T-A2** | Atomicity bridge: `RewardPort.grant` calls **`apply_resource_mutation` INSIDE the event-append txn** (§12.1) | Crash-injection test (kill between append+grant) → BOTH roll back; no completed-but-unrewarded, no double-grant on retry | T-A1 |
| **T-A3** | Hyper HTTP runtime skin: `/health` + `/.well-known/beacon.json` (render `protocol/beacon.yaml`) + activity-supertype **READ** routes | G-1 read plane serves; 5 declared read capabilities resolve | T-A0, T-A1 |
| **T-A4** | G-4 parity suite: replay bounded `cubquest-db` window → engine write path | **0 conservation deviations** AND **0 double-grants** under injected dup `event_id` (§12.4); runs on read-replica + PII redacted (§12.5). **Blocks write-flip** | T-A2 |
| **T-A5** | Railway deploy + DNS `activities.0xhoneyjar.xyz` + `TENANT_CUBQUEST_DATABASE_URL` bind + auto-deploy-on-merge (GH integration, not `railway up`) | `/health`=200 in prod | T-A3 |
| **T-A6** | `freeside-cli doctor` recompute beacon `sealed_schemas` hashes + CI bind | No 64-zero placeholders; declaration→proof bound | T-A3 |

## Lane A (registry flip) · `[repo:loa-freeside]`

| Task | What | Acceptance | Dep |
|---|---|---|---|
| **T-A7** | Flip `registry.yaml activities-api.runtime_state: not-built → deployed` | **GATE-3:** `/health`=200 AND **minimum capability set** (all 5 read caps resolve, §12.7) AND DNS resolves | T-A5, T-A6 |

## Lane A′ — surface cutover (resources-first) · `[repo:cubquests-interface]`

| Task | What | Acceptance | Dep |
|---|---|---|---|
| **T-A′1** | `lib/resources/service.ts` read-shadow (engine reads alongside live, diffed, non-user-facing) | Shadow telemetry + field-level divergence metric emitted | T-A5 |
| **T-A′2** | resources read-flip (serve from engine) + degraded envelope schema (§12.4) | **GATE:** <0.01% field divergence over sample window; degraded reads surfaced not silently served | T-A′1 |
| **T-A′3** | resources **write-flip** | **GATE-SEC-1 (§13): OQ-4 verification-integrity landed** AND **G-4 parity green** (T-A4). Defer until BOTH pass | T-A′2, T-A4, **FF-1** |

## Lane B — auth swap (parallel, independent) · `[repo:cubquests-interface]`

| Task | What | Acceptance | Dep |
|---|---|---|---|
| **T-B1** | Dynamic→identity-api **Bearer** (`/v1/auth/verify`; in-memory store + `jwt:` callback; no cookie) | Login flows via identity-api; Dynamic out of auth critical path | — |
| **T-B2** | `identity_id↔profile_id` mapping owned by identity-api; resolve+cache at auth (§12.6) | Mapping resolves; ownership = identity-api SoR | T-B1 |
| **T-B3** | Lazy-claim over ~90k Dynamic env + **conflict runbook** (wallet-change re-resolve, account-merge group-resolution) | Runbook authored; lazy-claim path live; conflict cases covered | T-B2 |

## Fast-follow (next cycle — tracked, NOT built this cycle)

| ID | What | Why deferred |
|---|---|---|
| **FF-1** | OQ-4 verification-integrity fix | **GATE-SEC-1** — HARD gate before T-A′3 write-flip (§13) |
| **FF-2** | `freeside-ledger` extraction (balances go sovereign) | NG-1 — engine doesn't own balances this cycle |
| **FF-3** | economy/store/polls/raffle cutover | NG-2 — resources-first; never eager |
| **FF-4** | full Supabase-SDK removal (~37 files) | NG-5 — swap the seam, not every file |

## Dependency spine (critical path)

`T-A1 → T-A2 → T-A4(parity)` ‖ `T-A0 → T-A3 → {T-A5, T-A6} → T-A7(registry)` → `T-A′1 → T-A′2 → T-A′3(write-flip, gated by T-A4 + FF-1)`. **Lane B runs fully parallel** from t=0. The write-flip (T-A′3) is the only task with a security+parity double-gate.

## Verification per cycle-done (PRD §2 goals)

G-1 ⇐ T-A3,T-A5 · G-2 ⇐ T-A6,T-A7 · G-3 ⇐ T-A1 · G-4 ⇐ T-A4 · G-5 ⇐ T-A′1,T-A′2 · G-6 ⇐ T-B1,T-B2,T-B3. GATE-SEC-1 (§13) + GATE-3 (T-A7) are hard, non-negotiable.

## Beads + dispatch

On approval: create beads epic `cubquests-activities-extraction` + tasks T-A0..T-B3 with labels `domain:network` + `cycle:cubquests-activities-extraction` + `[repo:X]`; `/coord init` + `/coord dispatch` per repo tag (identity-api precedent). Lane B can dispatch immediately (no deps); Lane A starts at T-A0/T-A1.
