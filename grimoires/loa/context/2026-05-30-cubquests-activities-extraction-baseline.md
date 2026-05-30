---
status: candidate
date: 2026-05-30
mode: ARCH (baseline)
constructs: gecko + freeside/KRANZ + the-arcade/OSTROM + k-hole/STAMETS
domain: network
plannable: true
title: CubQuests → activities-api extraction baseline
---

# CubQuests → activities-api Extraction Baseline

## (0) ⚠ PREMISE CORRECTION — 2026-05-30 (operator + repo evidence)

The four lenses read `types/supabase.ts` and concluded "Supabase = live SoR." **That framing is stale.** Corrected truth, in priority order (operator statement > repo evidence > vault corroboration):

1. **The live DB is Railway Postgres** (`cubquest-db` Railway project; read-access verified 2026-05-04 in the freeside-auth POC, `~/vault/raw-sources/freeside-auth/poc-railway-access-2026-05-04.md`). It was **already ported off Supabase-hosting.** Vault `world-registry.md`: *"cubquests · cubquests.com · Next.js + Railway PG."*
2. **The `@supabase/supabase-js` SDK still lives in ~37 files** (`lib/clients/supabase.ts` → `createClient(NEXT_PUBLIC_SUPABASE_URL, …)`) — this is **legacy access-pattern residue the operator is actively removing** ("we're moving away from this"). `DATABASE_URL` (raw Postgres) is present in `lib/env.server.ts` and is the sovereign path.
3. **This collapses the extraction's hardest leg — there is NO data migration.** activities-api's (stubbed) Postgres adapter points at the **same Railway `cubquest-db`**; the cutover is a *code-access swap* (Supabase-SDK direct-read → activities-api HTTP), both over one Postgres underneath. Re-read every "Supabase→activities-api data migration / re-homing" claim below as **"swap the access layer, keep the data in place."** The conservation-invariant re-proving (§(d) fact 3) still stands — that's about the *engine's event-sourced model vs row-state procs*, independent of where the bytes live.
4. **Lineage:** `activities-api` IS the renamed/evolved **`freeside-quests`** — scaffolded 2026-04-28 as installable family instance-4 (six packages: protocol/ports/adapters/mcp-tools/engine/ui), extracting the CubQuests engine; renamed to the `*-api` slug per ADR-009. `cubquests-interface` (dashboard) stays the canonical operator console. (vault `log.md` 2026-04-28.)
5. **The extraction has a SECURITY motivation, not just sovereignty (motivation-candidate, verify in PRD):** the live surface's `OffchainStepConfig.verificationType: "manual"` path **auto-completes with no actual verification** — a hole the engine's eligibility-evaluator + substrate-composition closes. (vault `substrate-mental-model-for-product-builders.md`, `background_only`.)
6. **Contested — do NOT rely:** a vault ai-derived note claims cubquests-interface runs on **Convex**. Repo evidence contradicts (zero Convex deps; Supabase-SDK + `DATABASE_URL`). Treat the Convex claim as wrong/stale.

> Vault items (4·5·6) are `actor_private · background_only` — orientation, not authority; (1)(2)(3) are operator-stated + repo-grounded and ARE load-bearing for planning.

## (a) One-line state

The **engine is library-complete and the surface is flip-ready, but nothing connects them**: `activities-api` is a sealed, ~648-test Effect library with **zero HTTP runtime** (by its own declared design), while `cubquests-interface` runs a live, much-wider Supabase SoR (resource economy + store + polls) with **zero pointer to activities-api**. The extraction has not been started; the only open work is greenfield runtime + a scoped, slow cutover.

> **Naming note for this doc:** the registry slug and canonical building name is `activities-api` (the Activity supertype). "Quests API"/"CubQuests" is the consumer-facing *product* name for the quest subtype, not a separate building. See Fork F2.

## (b) The cluster (repos · role · runtime_state)

| Repo | Role | Runtime state | Grounded at |
|---|---|---|---|
| `0xHoneyJar/activities-api` (github, public) | **Engine/protocol SoR** — sealed Activity supertype + headless state machine. Library only. | **not-built** (no HTTP, no deploy config) | registry.yaml:38-50; HEAD `21ff576` (BeaconV3 PR #19, 2026-05-26) |
| `cubquests-interface` (local: `/Users/zksoju/.../cubquests-interface`, branch `simstim/sovereign-migration`) | **Live surface** + canonical quest-content console. **Railway-Postgres SoR** (`cubquest-db`); Supabase SDK = legacy access, mid-removal. Dynamic Labs auth. | live (Next.js 15, Vercel) | local repo; §(0) correction |
| `quest-discord-bot` (github) | mcp-tools consumer (chat surface) | exists | gh repo view (OSTROM lens) |
| `freeside-characters` (formerly ruggy) | persona substrate; named mcp-tools consumer | exists | beacon `sealed_schemas.consumers` |
| `freeside-ledger` | would-be sovereign home for the Fuel/Crystals/Quantum economy | **does NOT exist** (named in loa-freeside/CLAUDE.md as "not extracted at all") | CLAUDE.md repo-topology |
| **Upstream deps (NOT cluster members):** `identity-api` (deployed), `storage-api` (stub) | substrate the building composes | identity deployed; storage stub | beacon `composes_with` |

**LEGACY — do NOT target:** `quests-api`, `quests-api-bartio` (2024 bartio on-chain Ponder indexers).

## (c) What's shipped (verified)

- **Unified Activity supertype, sealed.** `ActivityKind` discriminated union (quest · mission · badge-claim · raffle-entry · WorldDefined). `period_key` is the quest/mission unifier. Ground: `INTENT.md:16,39,46` — *"Quests and Missions are the SAME thing."* Mirrored on the surface: `cubquests-interface/types/activities.ts:23` — `ActivityKind = "quest" | "mission"`.
- **BeaconV3 beacon shipped** (`packages/protocol/beacon.yaml`, slug `activities-api`, PR #19): 5 read-only capabilities, 7 grounded `acvp_invariants` (each → a real vitest file), `composes_with` identity-api (required, JWT) + storage-api (optional, stub). `cycle_state: candidate`. **Caveat:** `sealed_schemas` hashes are 64-zero placeholders awaiting `freeside-cli doctor` recompute (declaration→proof unbound on the wire).
- **Economy ownership is delegated, by design.** `RewardPort.grant(reward, recipient, originatingEventId)` delegates delivery with D18 idempotency; `ActivityReward.ts:35` models `resource_kind` as an *emission*, not a balance. activities-api tracks grant STATE (Pending→Granted|Failed), not balances.
- **Persistence is contract-first.** `QuestStatePort` is the engine↔persistence seam; postgres adapter is the declared "production default" but the impl dir is a STUB (`packages/adapters/src/postgres/README.md` — *"intentionally empty of implementation"*). Only the in-memory adapter is real, and `INTENT.md:86` marks it TEST-FIXTURE-ONLY (A5).
- **Surface is in a clean flip-ready topology.** Single read-seam `lib/api/platform.ts` (`fetchActivities`/`fetchResources` → `/api/platform/*`); service layer `lib/activities/service.ts` + `lib/resources/service.ts`; atomic ledger semantics in Postgres stored procs (`apply_resource_mutation` @ `lib/resources/service.ts:20`, `complete_activity_step_tx` @ `lib/activities/service.ts:648`, `complete_store_purchase` @ `src/actions/store/purchase-item.ts:149`). Resource ledger tables exist: `types/supabase.ts:1607 resource_transactions`, `:1766 user_activity_progress`, `:1822 user_resources`.
- **Operator already chose the runtime shape.** `grimoires/loa/context/2026-05-28-dogfood-awareness-surface-gaps.md:43`: **API-first, Hyper/hyperjs.ai-style** — one route declaration auto-generates handler + OpenAPI + typed RPC client + MCP server. *"MCP is a generated artifact toggled on demand, not a separate build."* Tracked at `0xHoneyJar/loa-freeside#253`.

## (d) The seam — engine (runtime-hollow) vs surface (Supabase-bound), and the gap

**Engine side (`activities-api`)** — verified absent: no `Bun.serve`/`createServer`/`McpServer`/`StdioServerTransport`/`Hono`/`express`; no `Dockerfile`/`railway.toml`/`nixpacks.toml`/`Procfile`; no `apps/` dir; root scripts are build/test/lint only. The MCP transport is **stdio tool SPECS**, not a running server. The building's INTENT.md *refuses* to be a runtime (`:39` — "Not a runtime. Not a deployment target."). So the registry slug `activities-api` (`runtime_state: not-built`) **over-promises an HTTP API the building declines to be** — this is the GECKO naming-reality-drift flag.

**Surface side (`cubquests-interface`)** — Supabase access is concentrated server-tier (service layer + 4 stored procs); the typed client `lib/api/platform.ts` is a stable boundary. **Correction to one lens claim:** the literal grep "0 `.tsx` touch Supabase" is *imprecise* — 5 server `.tsx` route files import `clients/supabase` (`collection/[id]/page.tsx`, two `opengraph-image.tsx`, two `twitter-image.tsx`). All are **server components** (none `"use client"`), so the substantive claim (zero *client*-side Supabase coupling, all reads via the typed seam) **holds**; the blast-radius conclusion is unchanged.

**The gap between them, three load-bearing facts:**
1. **No runtime to flip TO.** All `activities-{api,mcp,}-production.up.railway.app` 404 (registry, 2026-05-25). A flip is gated on first deploying activities-api — its own runtime-extraction work, the same gate identity-api & score-api each passed.
2. **Coverage is NOT 1:1.** activities-api covers only the activity-supertype core (~40% est., KRANZ). The surface's resource economy (Fuel/Crystals/Quantum), store, polls, and raffle-prize fulfillment have **no home** in the current packages. A naive flip strands them.
3. **Model mismatch.** Engine is event-sourced (append-only EventStore + CAS); Supabase is RPC/row-state with hard-won idempotency (`complete_activity_step_tx`, `apply_resource_mutation`). "Migration" is a re-modeling, not a table copy; the conservation invariants must be re-proven engine-side. **#1 unverified risk** (STAMETS): contract-parity between the surface's stored-proc semantics and the engine's HTTP contract is UNKNOWN until the runtime exists.

**Branch red herring:** `simstim/sovereign-migration` contains **no activities-api migration code** — its 60-commit lead over main is Loa-framework cycle-110 substrate (only 2 product commits: `/ride` cleanup + a Safe `setTotalBadges` ops note). The product cutover has not been branched.

## (e) Remaining legs (ordered)

1. **Build the Hyper HTTP+beacon runtime** over the existing engine + postgres adapter (thin adapter, NOT a rewrite — engine, pg adapter, conformance suite already exist). Serve `/health` + `/.well-known/beacon.json` + the activity-supertype read/write routes. Per operator decision #253.
2. **Provision Railway Postgres + auto-deploy-on-merge** (identity-api / freeside-characters precedent) → `activities.0xhoneyjar.xyz` live. Recompute beacon `sealed_schemas` hashes via `freeside-cli doctor`.
3. **Flip registry `not-built → deployed`** — gated on `/health` 200 **AND** a substantive served beacon **AND** DNS pointed (not liveness-only; avoid the hollow-awareness-surface failure mode #253 named).
4. **Decide the RewardPort/ledger target** (Fork F1) — interim cubquests-Supabase delegation vs scope `freeside-ledger`.
5. **Slow, scoped surface cutover** — service-layer swap behind `lib/*/service.ts`, **resources-ledger domain first** (smallest, conservation-critical), read-shadow → flip-writes per-domain (inventory-Flip-style, emit a loud `completeness:{degraded}` envelope). **Defer** economy/store/polls.
6. **Auth swap (independent parallel leg)** — Dynamic → identity-api Bearer, Move-1 runbook 1:1, lazy-claim over the ~90k Dynamic env. Decoupled from the data cutover; neither blocks the other.

## (f) Decision forks

See the structured return. Summary, ordered by must-decide-first:
- **F1 — Runtime shape & scope** (gates everything): how thin is the Hyper layer, and does it serve writes or read-only first?
- **F2 — Ledger target**: interim cubquests-Supabase vs scope `freeside-ledger`. Determines whether the economy stays trapped.
- **F3 — Cutover scope & sequencing**: supertype-core-only + resources-first dual-write vs eager whole-SoR. (Eager is the scope-blowout trap.)
- **F4 — Registry flip gate**: liveness-only vs substantive-beacon-required.
- **F5 — Auth coupling**: bundle the Dynamic→Bearer swap into the cutover, or run it as an independent parallel leg.

## (g) Recommended first move

**Build the thin Hyper HTTP+beacon runtime over the existing engine, scoped to the activity-supertype core + `/health` + served beacon — a deploy-extraction cycle, NOT a surface flip.** Everything downstream (registry flip, cutover, ledger decision) is blocked on a callable endpoint existing. The library, postgres adapter, and conformance suite already exist; the missing piece is purely the HTTP/beacon skin (verified absent). Run the Dynamic→Bearer auth swap as an independent parallel leg if surface-side capacity exists. Do **not** attempt eager whole-SoR migration, and do **not** flip the registry on liveness alone.

## Where the lenses disagree / what's uncertain

- **REST-vs-MCP is partly stale.** GECKO framed the runtime fork as "MCP read-plane first." The operator's #253 decision (API-first Hyper, MCP auto-generated) supersedes that — the real fork is the *Hyper layer + what it serves*, not the transport. Encoded as F1.
- **Coverage % is an estimate.** KRANZ's "~40%" is a judgment call, not a measured figure — treat as directional.
- **Contract-parity is fully unverified** (STAMETS could not read the engine's HTTP contract because no runtime exists). This is the single biggest unknown; F1/F3 confidence is lowered accordingly.
- **The "0 .tsx Supabase coupling" claim is corrected above** (5 server `.tsx` route files do import it; the substantive UI-decoupling conclusion still holds).
