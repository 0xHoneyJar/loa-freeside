---
title: "SDD — CubQuests → activities-api Extraction"
cycle: cubquests-activities-extraction
status: candidate
date: 2026-05-30
mode: ARCH (plan-here)
domain: network
prd: grimoires/loa/cycles/cubquests-activities-extraction/prd.md
baseline: grimoires/loa/context/2026-05-30-cubquests-activities-extraction-baseline.md
dispatch_targets: [activities-api, cubquests-interface]
plannable: true
---

# SDD — CubQuests → activities-api Extraction

> Grounding discipline: every file/symbol/table below was read in `activities-api@HEAD` (`/tmp/activities-api-ground`, clone of `0xHoneyJar/activities-api`) or `cubquests-interface` local. References are `path:symbol`, not inferred.

## 1. Context & the corrected model

`activities-api` is the renamed `freeside-quests` — a sealed Effect monorepo (`packages/{protocol,engine,adapters,...}`). It is library-only; this cycle gives it a deployed HTTP runtime and begins a conservation-safe surface cutover. **No data migration** — the live SoR already lives in Railway `cubquest-db`; we swap the *access layer*.

## 2. Persistence — the TWO seams (the load-bearing correction, OQ-1 resolved)

The engine has **two distinct persistence layers**. Conflating them is the trap.

### 2.1 Seam A — `QuestStatePort` (snapshot) — **ALREADY BUILT**
- `packages/engine/src/persistence/adapters/postgres.ts` — a complete, production-shaped adapter (Cycle-Q 2026-05-04 + Cycle-B 2026-05-05 per-tenant hardening).
- Table `quest_state(quest_id, player_key, state_json JSONB, world_slug, phase, updated_at)`, PK `(quest_id, player_key)`; idempotent `INSERT … ON CONFLICT (quest_id, player_key) DO UPDATE`; `Schema.decodeUnknown(QuestState)` defense-in-depth.
- **Per-world Layer instantiation** — one `pg.Pool` per tenant, `TENANT_<TENANT>_DATABASE_URL`; the docstring (`postgres.ts:4-6,37-45`) **names `cubquest-db`** as a provisioned target and asserts a 3-layer cross-tenant boundary (pool / `world_slug` filter / dispatch assertion).
- ⇒ **Snapshot persistence to `cubquest-db` needs no new code** — only composition wiring (a `cubquest` world Layer + `TENANT_CUBQUEST_DATABASE_URL`).

### 2.2 Seam B — Event-sourced ports (`EventStore`/`Reward`/`Progress`/`IdentityResolver`) — **STUBBED**
- `packages/adapters/src/postgres/README.md` declares this dir "intentionally empty — the cubquests-as-module migration cycle" target. Only in-memory adapters + **conformance suites exist** (`packages/adapters/src/conformance/event-store-conformance.ts`, currently `.skip`).
- `packages/protocol/src/ports/EventStoreContract.ts` defines the contract every adapter MUST satisfy — invariants **CL-EventStore-1..7**: append-only (no update/delete, CAS only) · monotonic-sequence per partition · CAS via `expected_tip_hash` (exactly-one-writer-wins) · duplicate-reject by `event_id` (`DuplicateEvent`) · scope-grouped sequence · replay-determinism · nonce-mediated collision.
- ⇒ **This is the genuine FR-A2 work**: implement `makePostgresEventStore/Reward/Progress/IdentityResolver(pool)`, flip the conformance `.skip → .run`, pass **unmodified** (README §"How to land": do NOT fork the suite).

### 2.3 Which seam does the surface need?
The cutover reads/writes **activity progress + completion + reward-grant state**, which is Seam B (event-sourced) for the ACVP path, persisted into `cubquest-db`. Seam A (snapshot) is the Discord-bot quest-state path and is orthogonal to the surface cutover. **This cycle builds Seam B's Postgres adapters.**

## 3. Contract-parity (OQ-1 / G-4 / R-1) — the decomposition

The live surface does completion+reward in ONE atomic idempotent stored proc:
`complete_activity_step_tx(p_step_state, p_completed_steps, p_total_steps, p_reward_common, p_reward_rare, p_reward_legendary, p_idempotency_key, …)` (`cubquests-interface/lib/activities/service.ts:648`), and resource mutations via `apply_resource_mutation(idempotencyKey, common/rare/legendary_transaction_id)` (`lib/resources/service.ts:20`). Resources are **common/rare/legendary** tiers (`user_resources`, `resource_transactions`, `user_activity_progress` — `types/supabase.ts:1822/1607/1766`).

**Engine-side decomposition** (the parity thesis):

| Surface (atomic proc) | Engine (event-sourced) | Invariant preserved by |
|---|---|---|
| `p_idempotency_key` no-double-apply | append `CompletionEvent` w/ canonical `event_id` | **CL-EventStore-4** duplicate-reject |
| atomic step+reward | `append(CompletionEvent)` → `RewardPort.grant(reward, recipient, originatingEventId)` | CAS tip (CL-EventStore-3) + RewardPort **D18 idempotency** keyed on `originatingEventId` |
| `p_reward_common/rare/legendary` | `ActivityReward.resource_kind` **emission** (not a balance — `ActivityReward.ts:35`) | NG-1 (engine emits, does not hold balances) |
| replay/audit | partition replay | **CL-EventStore-6** replay-determinism |

**G-4 parity suite** (the gate before any write-flip): replay a sample of live `cubquest-db` completion history through the engine HTTP write path and assert **resource conservation** (Σ grants − Σ spends identical to the stored-proc ledger; no double-grant under duplicate `event_id`; no lost-spend under concurrent CAS). This is the single highest-risk deliverable; it runs against live (read-only-replayed) data.

## 4. The ledger-ownership seam (OQ-3 / G-5 vs NG-1 — resolved)

Tension: G-5 "surface resources read from activities-api" vs NG-1 "engine doesn't own balances." Resolution:

- **The engine owns activity/progress/completion + reward-grant STATE** (Seam B events in `cubquest-db`). It SERVES these as reads (the supertype-core read plane, FR-A1).
- **The balance ledger stays in `cubquest-db`** (`user_resources` via `apply_resource_mutation`). The engine's `makePostgresRewardPort` **bridges**: on `grant`, it writes a `resource_transactions` row / calls the existing mutation — it does not invent a second balance store. This honors NG-1 (no balance ownership) while making grants flow through the engine's idempotent event path.
- ⇒ "resources-first cutover" (F3) precisely = **the activity-progress + reward-grant reads move to the engine; balance writes continue through the bridged RewardPort into the existing ledger.** `freeside-ledger` (a later cycle) is where balances eventually become sovereign.

## 5. Runtime (FR-A1 / G-1) — thin Hyper skin

- Per operator #253 + identity-api precedent: a thin **Hyper / hyperjs.ai** HTTP layer over the Effect engine. One route decl → handler + OpenAPI + typed RPC client + MCP (generated, toggled, not a separate build). **OQ-2 resolution:** confirm Hyper composes with Effect at wiring time; fall back to `@effect/platform` HTTP if friction (both are Effect-native — low risk).
- **Serve first (read plane):** `/health` (liveness, canonical), `/.well-known/beacon.json` (the `packages/protocol/beacon.yaml` rendered), activity-supertype **read** routes (list/get activities, progress, reward-grant state). Write routes (completion/grant) land behind the G-4 parity gate.
- Composition root: a `cubquest` world Layer providing Seam-B Postgres adapters from `TENANT_CUBQUEST_DATABASE_URL`.

## 6. Deploy & registry (FR-A3/A4/A5 · G-1/G-2)

1. Railway service + Postgres binding to `cubquest-db` (read existing; reuse the freeside-auth POC access path verified 2026-05-04). **Auto-deploy-on-merge via GH integration** — NOT `railway up` (freeside-characters precedent, [[freeside-characters-deploy]]).
2. DNS `activities.0xhoneyjar.xyz` → Railway.
3. `freeside-cli doctor` recomputes beacon `sealed_schemas` hashes (closes the 64-zero placeholder; binds declaration→proof). CI gate.
4. **Registry flip (this repo, `packages/freeside-registry/registry.yaml`)** `runtime_state: not-built → deployed` ONLY when **`/health`=200 AND beacon `capabilities` non-empty AND DNS resolves** (G-2's 3-gate; avoids the hollow-awareness failure mode #253 named).

## 7. Lane B — auth swap (G-6, independent)

- `cubquests-interface`: replace Dynamic with identity-api **Bearer** (`/v1/auth/verify` → `{user_id, primary_wallet, session:{token}}`, [[verify-resp-body-shape]]; in-memory store + `jwt:` callback; no cookie dependency, [[identity-api-cookies-host-only]]).
- Lazy-claim over the ~90k Dynamic env ([[dynamic-export-reality]]); Move-1 runbook composes 1:1 ([[mibera-dimensions-substrate-shape]]).
- **OQ-3 bridge:** `identity_id ↔ profile_id` — the auth swap introduces `identity_id`; map it to the existing `profiles.id` (the surface migration already adds `dynamic_user_id` to profiles). The RewardPort recipient keys on this mapping.
- **Independent of Lane A** — neither blocks the other; can dispatch immediately.

## 8. Cutover sequencing (read-shadow → flip)

Per-domain behind the service seam (`cubquests-interface/lib/*/service.ts` — the single chokepoint, zero client coupling):
1. **Read-shadow**: engine reads run alongside live reads, diffed, NOT user-facing.
2. **Flip-reads**: serve from engine; `completeness:{degraded}` envelope on fallback (inventory-Flip precedent).
3. **Flip-writes**: ONLY after G-4 parity green for that domain. **Resources domain first** (conservation-critical, smallest).
4. **Deferred (NG-2):** economy/store/polls/raffle-fulfillment.

## 9. Dispatch plan (plan-here → /coord there)

| Work | Repo | Lane |
|---|---|---|
| Seam-B Postgres adapters + conformance flip (FR-A2) | `activities-api` | A |
| Hyper runtime skin + read routes + beacon serve (FR-A1) | `activities-api` | A |
| G-4 parity suite (replay `cubquest-db` → engine) | `activities-api` | A |
| Railway deploy + DNS + `cubquest-db` bind (FR-A3) | `activities-api` (+ operator infra) | A |
| beacon `doctor` hash recompute (FR-A4) | `activities-api` | A |
| registry `not-built→deployed` flip (FR-A5) | **loa-freeside** (this repo) | A |
| resources `service.ts` read-shadow→flip (FR-A′) | `cubquests-interface` | A′ |
| Dynamic→Bearer swap (FR-B) | `cubquests-interface` | B |

`/coord` dispatches headless agents per `[repo:]` tag (identity-api precedent, [[identity-api-coord-mechanism]]); loa-freeside holds the cross-repo beads graph (`domain:network`).

## 10. Risks & resolved open questions

- **R-1 (HIGH) contract-parity** → §3 decomposition + §4 ledger bridge; G-4 suite gates writes. Mitigated, not eliminated — the replay must run against real data before any flip.
- **OQ-1 RESOLVED** (§3): surface atomic proc ↔ engine event-append+grant.
- **OQ-2** (Hyper vs Effect-Platform) → §5; low risk, both Effect-native.
- **OQ-3 RESOLVED** (§4/§7): engine owns activity+grant state; balances stay in `cubquest-db` via bridged RewardPort; identity_id↔profile_id mapped at auth swap.
- **OQ-4** (security: manual-verification auto-complete) → **fast-follow next cycle** (operator call 2026-05-30) — not entangled with the cutover.
- **R-2** Flatline degraded (Google-only) — note at each gate; lean `/fagan` for diffs.

## 11. Acceptance (cycle-done)

G-1 (health+beacon+DNS) · G-2 (registry flipped on 3-gate, no placeholder hashes) · G-3 (Seam-B pg adapters pass conformance unmodified) · G-4 (parity suite green on resources) · G-5 (resources reads served by engine w/ degraded envelope) · G-6 (Bearer auth, Dynamic out of critical path). Deferred legs (NG-1/NG-2/NG-5) tracked as follow-up cycles.

## 12. Flatline integration — 3-model headless review (2026-05-30)

Reviewed by `claude-headless + codex-headless + gemini-headless` (cheval). Consensus **HIGH=8 · DISPUTED=4 · BLOCKERS=10 · 71% agreement · confidence:full**. Raw: `/tmp/fl_sdd_out.json` (+ `grimoires/loa/a2a/flatline/`). The findings cluster on the §3/§4 write-path. Integrated amendments:

### 12.1 Atomicity — the central correction (BLOCKERS SKP-001 ×3 @850-880 · IMP-002 @922 highest)
**§3/§4 are AMENDED:** the engine's Postgres adapter MUST wrap `{CAS event-append → reward mutation}` in **ONE Postgres transaction**. The `RewardPort` bridge MUST call the existing **`apply_resource_mutation` inside that same transaction** — NOT a separate `resource_transactions` write (resolves the divergence risk SKP-003/740 · IMP-006). This restores the legacy stored proc's single-transaction atomicity that the naïve append-then-grant decomposition broke. A crash between append and grant must roll back BOTH.

### 12.2 CAS isolation (BLOCKER SKP-002 @890 CRITICAL)
The `makePostgresEventStore` CAS (`expected_tip_hash`, CL-EventStore-3) MUST run at **SERIALIZABLE** isolation (or `SELECT … FOR UPDATE` on the partition tip row). READ COMMITTED admits phantom reads → two racing writers both see the same tip → double-append. The conformance suite's concurrency test (CL-EventStore-3) is the proof.

### 12.3 event_id derivation pinned (BLOCKER SKP-002 @760 · IMP-006)
Idempotency = duplicate-reject by canonical `event_id`. The SDD pins derivation to the protocol's **`computeEventId` (§5.6)** — deterministic over `{activity, player, step, nonce}`, NOT over wall-clock/request-id (which would make legit retries look distinct → double-grant) and NOT so broad it rejects legitimate distinct completions. The G-4 suite asserts retry-determinism.

### 12.4 Parity + read-shadow become real gates (IMP-004 @905 · IMP-013 @805 · SKP-004)
**§8 is AMENDED** with explicit gate criteria:
- **G-4 parity:** sample = full replay of a bounded window of `cubquest-db` completion history; **acceptance = 0 conservation deviations** (Σgrant−Σspend identical) AND 0 double-grants under injected duplicate `event_id`. Any deviation BLOCKS the write-flip.
- **Read-shadow:** acceptance threshold = **<0.01% field-level divergence** over a defined sample window before read-flip; ≥ threshold → block + remediate. A shadow without a threshold is observability, not a gate.
- **Degraded envelope:** `completeness:{status: degraded, reason, fallback_source}` — schema specified; consumers MUST surface degraded reads, not silently serve them (IMP-008).

### 12.5 Data-safety on live replay (BLOCKERS SKP-003/750 · SKP-004/720)
G-4 replays production `cubquest-db` (90k+ users). **Mandate:** replay runs in an isolated env against a read-replica/snapshot; PII (wallets, identifiers) is hashed/redacted in all logs, traces, and fixtures; NO production data in dev traces. The replay path is assert-only — it MUST NOT mutate source state (enforced by read-replica + no-write connection).

### 12.6 identity_id ↔ profile_id mapping (IMP-005 @875 · BLOCKER SKP-002/750 · IMP-014)
**§7 is AMENDED:** the mapping is **owned by identity-api** (the SoR); `cubquests-interface` resolves `identity_id → profiles.id` at auth time and caches. Conflict resolution for lazy-claim: primary-wallet change → re-resolve via identity-api primary; account-merge → identity-api group-resolution wins (composes with the wallet-group primary-enforcement pattern). A **lazy-claim conflict runbook** is a Lane-B deliverable.

### 12.7 Smaller integrations
- **Event-store DDL (IMP-001 @910):** the `event_store` table DDL (partition_key, event_id PK, monotonic_sequence, envelope JSONB, scope) ships in the migration alongside the adapter — foundational, documented, not implied.
- **Runtime spike (IMP-003 @847):** OQ-2 becomes an explicit **timeboxed Hyper spike** (Lane-A task 0) with `@effect/platform` HTTP as the pre-declared fallback if Hyper↔Effect friction.
- **Registry min-capability set (IMP-011 disputed @760):** G-2's "non-empty capabilities" sharpened to a **minimum required set** (the 5 declared read capabilities must all resolve), not merely non-empty.

### 12.8 ESCALATED to operator — does NOT auto-integrate
**OQ-4 security deferral (BLOCKER SKP-001 @920 CRITICAL — see §13).** The models split: gpt+gemini flag deferring the manual-verification hole as a CRITICAL design risk; opus scores the tracking-issue remedy at 0 (process, not design). This challenges the operator's 2026-05-30 "fast-follow" call and is resolved in §13, not here.

## 13. OQ-4 security — operator escalation (RATIFIED 2026-05-30)

Flatline (920 CRITICAL): *"any actor who can trigger a completion event without real verification can self-grant resource rewards; G-4 parity validates conservation math, not verification integrity."* **Status: RATIFIED by operator 2026-05-30 — option A.**

**GATE-SEC-1 (hard, load-bearing):** OQ-4 (the manual-verification auto-complete fix) stays a fast-follow, BUT the verification-integrity fix MUST land before **ANY reward-granting write-flip** (sprint task T-A′3). The new runtime ships the READ plane first (writes deferred per §8), so the self-grant surface is not widened until the write-flip — and GATE-SEC-1 blocks that flip until verification is real. "Fast-follow someday" → "fast-follow, mandatory-before-writes." This gate is a non-negotiable acceptance criterion on the resources write-flip.
