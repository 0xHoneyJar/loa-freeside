---
title: "PRD — CubQuests → activities-api Extraction"
cycle: cubquests-activities-extraction
status: candidate
date: 2026-05-30
mode: ARCH (plan-here)
domain: network
constructs: gecko + the-arcade/OSTROM + freeside/KRANZ + k-hole/STAMETS
plannable: true
baseline: grimoires/loa/context/2026-05-30-cubquests-activities-extraction-baseline.md
dispatch_targets: [activities-api, cubquests-interface]
---

# PRD — CubQuests → activities-api Extraction

> **Plan-here / dispatch-there.** This PRD is authored in `loa-freeside` (the network parent that owns the registry + cross-building coordination). The *build* dispatches cross-repo to `activities-api` (engine/runtime) and `cubquests-interface` (surface) via `/coord`. Read the baseline first — esp. **§0 PREMISE CORRECTION** (SoR is Railway Postgres `cubquest-db`, NOT Supabase; **no data migration**; cutover = access-layer swap).

## 1. Summary

Turn **CubQuests** into a sovereign freeside building. `activities-api` (the renamed/evolved `freeside-quests`) is a sealed, ~648-test Effect **library** for the unified Activity supertype (quest = multi-step activity, mission = single-step; + badge-claim, raffle-entry) — but it has **zero HTTP runtime** and its `QuestStatePort` Postgres adapter is a **stub**. `cubquests-interface` is the live Next.js surface whose SoR already lives on **Railway Postgres `cubquest-db`**, accessed through a *legacy* `@supabase/supabase-js` SDK that is being removed.

This cycle stands up the engine as a deployed API and begins a **scoped, conservation-safe** cutover of the surface to consume it — **without moving any data** and **without absorbing the resource economy**. A second, independent lane swaps surface auth from Dynamic → identity-api Bearer.

## 2. Goals

| ID | Goal | Metric (done = true) |
|----|------|----------------------|
| **G-1** | `activities-api` has a live HTTP runtime | `https://activities.0xhoneyjar.xyz/health` → 200 **AND** `/.well-known/beacon.json` served with **non-empty** `capabilities` **AND** DNS resolves |
| **G-2** | Registry reflects reality (no hollow flip) | `registry.yaml activities-api.runtime_state` flips `not-built → deployed` **only** when G-1's 3-gate holds; `freeside-cli doctor` recomputes `sealed_schemas` hashes (zero 64-zero placeholders remain) |
| **G-3** | Persistence is real, not a fixture | `QuestStatePort` Postgres adapter implemented against Railway `cubquest-db`; passes the **same conformance suite** as the in-memory adapter; reads live data |
| **G-4** | Contract-parity proven (the #1 risk) | A parity test asserts the engine's HTTP contract preserves the surface's stored-proc conservation invariants for the **resources domain** — **no double-grant, no lost-spend** — green against live `cubquest-db` |
| **G-5** | Surface resources-domain reads from the engine | `cubquests-interface/lib/resources/service.ts` reads via `activities-api` HTTP behind the existing service seam (read-shadow → flip), emitting a loud `completeness:{degraded}` envelope on fallback |
| **G-6** | Auth sovereignty (Lane B, independent) | `cubquests-interface` authenticates via identity-api Bearer (`/v1/auth/verify`); Dynamic removed from the auth critical path; lazy-claim over the ~90k Dynamic env |

## 3. Users / stakeholders

- **Operator** (zkSoju / THJ) — owns the cluster; HITL throughout.
- **Live CubQuests players** (~90k Dynamic env) — must see zero regression in resources/quests during cutover.
- **Future consumer worlds** — Purupuru Year 2, Honey Port, Mibera (per vault world-registry) — the reason this is a *building*, not an app.
- **Downstream MCP consumers** — `quest-discord-bot`, `freeside-characters` (declared in the beacon).

## 4. Functional requirements

### Lane A — runtime-extraction (dispatch → `activities-api`)
- **FR-A1** Build a thin **Hyper / hyperjs.ai-style** HTTP runtime over the existing Effect engine (operator decision #253): one route declaration → handler + OpenAPI + typed RPC client + MCP (MCP is a *generated artifact*, not a separate build). Serve `/health`, `/.well-known/beacon.json`, and the **activity-supertype read routes** first.
- **FR-A2** Implement the **event-sourced** Postgres adapters (`makePostgresEventStore/Reward/Progress/IdentityResolver` under `packages/adapters/src/postgres/`) against Railway `cubquest-db`, then flip the existing conformance stubs `.skip → .run`; they MUST pass **unmodified** (CL-EventStore-1..7). NOTE: the *snapshot* `QuestStatePort` Postgres adapter (`packages/engine/src/persistence/adapters/postgres.ts`) is **already implemented** (Cycle-Q/B; targets `TENANT_<T>_DATABASE_URL` incl. `cubquest-db`) — only the event-store seam is stubbed. See SDD §2.
- **FR-A3** Provision Railway + auto-deploy-on-merge (identity-api / freeside-characters precedent — GH integration, **not** `railway up`). Point `activities.0xhoneyjar.xyz`.
- **FR-A4** `freeside-cli doctor` recomputes beacon `sealed_schemas` hashes; CI binds declaration → proof (closes the 64-zero-placeholder gap).
- **FR-A5** (loa-freeside, this repo) Flip `registry.yaml` per **G-2's 3-gate**.

### Lane A′ — scoped surface cutover (dispatch → `cubquests-interface`)
- **FR-A′1** Swap **only** `lib/resources/service.ts` to read via `activities-api` HTTP behind the service seam — **resources domain first** (smallest, conservation-critical).
- **FR-A′2** Read-shadow → flip-writes per-domain; emit `completeness:{degraded}` envelope on fallback (inventory-Flip precedent).
- **FR-A′3** Contract-parity gate (G-4) MUST pass before any **write** flips.

### Lane B — auth swap (dispatch → `cubquests-interface`, independent/parallel)
- **FR-B1** Replace Dynamic with identity-api Bearer (`/v1/auth/verify` → `{user_id, primary_wallet, session:{token}}`; in-memory store + `jwt:` callback; no cookie dependency — VerifyResp Bearer pattern).
- **FR-B2** Lazy-claim over the ~90k Dynamic env (no eager backfill); host-only-cookie constraint respected (cross-subdomain ⇒ Bearer).

## 5. Non-goals (explicit — these are the scope-blowout traps)

- **NG-1 (Fork F2)** activities-api does **NOT** own resource balances (Fuel/Crystals/Quantum). `RewardPort` delegates; the sovereign `freeside-ledger` is a **later cycle**. Do not re-merge the bounded contexts the schema deliberately split.
- **NG-2 (Fork F3)** **NO eager whole-SoR migration.** Economy, store, polls, and raffle-prize fulfillment cutover are **DEFERRED**.
- **NG-3** **NO data migration.** Data stays in Railway `cubquest-db`; this is an access-layer swap.
- **NG-4** The `cubquests-interface` dashboard stays the **canonical operator console** — not rebuilt, not replaced.
- **NG-5** Do not rip out all 37 legacy Supabase-SDK files at once; swap the **service seam**, leave the rest for follow-up.

## 6. Risks

| ID | Risk | Sev | Mitigation |
|----|------|-----|------------|
| **R-1** | **Contract-parity unverified** — engine is event-sourced (append-only EventStore + CAS); surface is row-state with hard-won idempotent procs (`complete_activity_step_tx`, `apply_resource_mutation`). "Migration" is a re-modeling. | **HIGH** | G-4 parity suite **before** any write-flip; read-shadow first; resources domain (conservation-critical) is the proving ground. |
| **R-2** | Flatline DEGRADED (only Google key live; Anthropic configured-but-unavailable, OpenAI absent) → single-voice adversarial gates. | MED | Note in each gate; operator may set keys; lean on `/fagan` for code diffs. |
| **R-3** | Legacy Supabase-SDK residue (37 files) → partial-migration confusion. | MED | Cutover swaps the seam, not every file (NG-5). |
| **R-4** | Beacon `sealed_schemas` placeholders → ACVP declaration↔proof unbound on the wire. | MED | FR-A4 `freeside-cli doctor` recompute + CI bind. |
| **R-5** | Auth lane on a live ~90k base. | MED | Independent leg, lazy-claim, proven on mibera-interface/mibera-dimensions. |

## 7. Dependencies

- **identity-api** (deployed, `identity-api-production-317b.up.railway.app`) — Lane B Bearer.
- **Railway `cubquest-db`** read/write access (read verified 2026-05-04, freeside-auth POC).
- **freeside-cli `doctor`** — beacon hash recompute (FR-A4).
- **`registry.yaml`** (this repo, `packages/freeside-registry/`) — FR-A5 flip.

## 8. Open questions (resolve in SDD)

- **OQ-1** Does the pg adapter read the **same schema** the cubquests stored procs write, or through a translation layer? (the event-sourced ↔ row-state mismatch — the load-bearing SDD decision; drives G-4.)
- **OQ-2** Runtime confirm: Hyper (hyperjs.ai) vs Effect-Platform HTTP — which composes most cleanly with the existing Effect engine? (#253 says Hyper.)
- **OQ-3** `identity_id ↔ profile_id` bridge — who owns it once auth is Bearer? (composes with NG-1 / the unowned-economy seam.)
- **OQ-4** Security motivation (`verificationType:"manual"` auto-completes) — is closing it **in-scope this cycle** or a fast-follow? (Currently framed as a benefit of the eligibility-evaluator, not an FR — confirm.)

## 9. Cutover sequencing (the ordered legs)

1. **G-3** pg adapter (gates everything downstream).
2. **G-1 / FR-A1–A3** runtime + deploy → `activities.0xhoneyjar.xyz`.
3. **G-2 / FR-A4–A5** beacon hashes + registry flip (3-gate).
4. **G-4** contract-parity suite (resources domain).
5. **G-5 / FR-A′1–A′3** resources read-shadow → flip.
6. **Lane B (G-6)** runs in **parallel** from the start — neither blocks the other.

> **Deferred to follow-up cycles:** economy/store/polls/raffle cutover (NG-2), `freeside-ledger` extraction (NG-1), full Supabase-SDK removal (NG-5).
