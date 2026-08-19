---
atlas: world-atlas
version: v0.2
supersedes: world-atlas-v0.1.md
date: 2026-05-28
persona: KRANZ × GECKO
status: GROUNDED · GECKO Patrols A+B+C+D synthesis + identity-api Phase 1 PRD + `freeside-auth/packages/engine/src/tenants.yaml` registry
disclaimer: THE MAP IS NOT THE TERRITORY · cluster's best-effort approximation; corrections welcomed + expected
---

# Cluster World Atlas — v0.2

> v0.1 had 2 user-databases mapped. Patrol D opened the curtain on the actual tenant registry: **9 Railway/Supabase user-bearing databases** + the live Dynamic API-pull pipeline. The fragmentation is broader than v0.1 suggested. The unified-spine doctrine has more territory to cover than first read.

## The unified-spine vision (unchanged from v0.1)

**One `user_id` in the identity-api spine, one row per `world_identity` per world the user has joined, with a per-world `nym` and a single per-user `primary_wallet`** — replacing the today-fragmented topology where each tenant has its own user-database with its own conventions.

## The atlas v0.2 — full tenant matrix

Authoritative source: `freeside-auth/packages/engine/src/tenants.yaml` (post-2026-05-04 substrate-of-record audit · "8 Supabase projects extracted to Railway Postgres · 100% parity"). Plus identity-api spine + score-api/score-mibera Supabase.

| Tenant slug | World status | Frontend(s) | DB shape | User table | Railway project_id | Spine status |
|---|---|---|---|---|---|---|
| `mibera` | 🔥 HOT | mibera-honeyroad, mibera-dimensions + freeside-characters (consumer) | split | `midi_profiles` | `44721dce-1ea0-42e7-8b56-bdd01f22e375` | 🟡 3/192 claimed · 189 stuck behind Discord-required gate · Move 1 PR #105 unblocks via lazy claim-on-first-login |
| `cubquest` | 🔥 HOT | cubquests-interface (branch `simstim/sovereign-migration` ACTIVE) | unified | `profiles` (eth+sol) | `57a19fbc-e8d5-485c-bdb1-dc00b1842202` | 🔴 NOT in spine · open issues #38/#46/#23 confirm migration appetite · **Move 2 target** |
| `score-mibera` | 🔥 HOT | score-mibera dashboard | own | `dynamic_users` (sync target) | (Railway PG; was Supabase) | 🔴 NOT in spine · runs independent sync-dynamic.ts pipeline |
| `apdao` | 🌑 COLD declared | none active | config | none | `78cefc68-f24f-45f0-82ca-5c83101be63b` | N/A (no user data) · **billing review** |
| `honeyjar` | 🌑 COLD declared | telemetry | config | none | `bd1641fb-2570-4df6-909b-ed4aa6d3cbed` | N/A · **billing review** |
| `interpol` | 🌑 COLD declared | (unknown) | unified | `sf_users` | `edff22a9-c2a0-4e65-8db5-318f401941a5` | 🔴 declarative-stub (adapter returns null on resolve) |
| `validator` | 🌑 COLD declared | (unknown) | config | none | `8c6d0de7-2797-44cc-923c-4d4fe9fb44f2` | N/A · **billing review** |
| `henlo` | 🌑 COLD declared | (unknown) | unified | `henlo_profiles` | `f7b583cc-7f84-4c8a-945f-a087fa2c2d92` | 🔴 declarative-stub |
| `henlo-old` | ⚰️ FROZEN | (none) | legacy | `crew_members` | `68ae3f8c-5a1c-421d-9aa8-da68ad267811` | `archive_only=true` · **provisioned but unused** · billing waste candidate |
| `thj` | 🌑 COLD declared | honey-interface (DORMANT Mar 31) | "auth-proxy" backend (per Patrol A) | unmapped | (separate) | 🟡 spine row exists · 0 claims · honey-interface uses `.bera` ENS pattern |
| **spine** | 🛡️ SPINE | (server-side; consumed by all) | spine | `users` + `wallet_links` + `world_identity` + `linked_accounts` + 5 more | (separate Railway PG; identity.0xhoneyjar.xyz) | LIVE Phase 1-4 deployed · LBR-1 atomic resolve-or-mint guarantee |

**Worlds count summary:**
- 🔥 3 hot worlds with active frontends + writes (mibera, cubquest, score-mibera)
- 🌑 5 cold declared tenants (apdao, honeyjar, interpol, validator, henlo) — Railway projects provisioned, frontends dormant or unknown
- ⚰️ 1 frozen (henlo-old)
- 🛡️ 1 spine
- **= 10 distinct user-bearing data surfaces**

## The Dynamic export reality (v0.1 had this WRONG)

**Operator's "downloaded Dynamic export" is NOT a file on disk.** Patrol D searched `~/Downloads`, all repos, all bonfire dirs. Only Dynamic-related file: `~/Downloads/AI Library/documents/TheHoneyJar_Dynamic_Agreement.pdf` (legal contract, not data).

**The reality: Dynamic data lives in a LIVE API-pull pipeline:**

```
                    Dynamic SDK environment (vendor)
                                 │
                                 ▼ poll /api/v0/environments/{env}/users
                ┌────────────────┴────────────────┐
                │                                 │
                ▼ sync-dynamic.ts                   ▼ sync-dynamic.ts
        ┌──────────────┐                  ┌──────────────┐
        │ score-api    │                  │ score-mibera │
        │ Supabase     │                  │ Railway PG   │
        │ dynamic_users│                  │ dynamic_users│
        └──────────────┘                  └──────────────┘
                                                 +
                              ┌─────────────────────┐
                              │ mibera tenant       │
                              │ midi_profiles       │
                              │ .dynamic_user_id    │ ← derived during sync
                              └─────────────────────┘
```

**Drift risk:** score-api Supabase + score-mibera Railway both run independent `sync-dynamic.ts` against the same Dynamic environment. Two copies of the same dataset diverging. **Open question: is one deprecated post-sovereign-migration?**

Schemas:
- `~/Documents/GitHub/score-api/supabase/migrations/20260129_001_CREATE_dynamic_users.sql` (Jan 29 2026)
- `dynamic_users(dynamic_user_id, wallet_address, additional_wallets jsonb, twitter_handle, twitter_id, email)`

Quarantine pipeline exists but data not located locally:
- `freeside-auth/scripts/__tests__/check-dynamic-quarantine.test.ts`
- `freeside-auth/scripts/check-dynamic-quarantine.sh`

## The unified-auth migration plan — updated for v0.2

```
PHASE 0  Substrate sync (in flight)
  ✅ PR #251 lands cluster auth runbooks + atlas + Bearer doctrine
  🟡 Move 1 PR #105 (mibera-honeyroad) — verify gates, merge
  ⏳ Indexer Envio → Ponder port (sonar-ponder-coordinator active)
  ⏳ Move 3b inventory-api Flip — gated on indexer port + parity

PHASE 1  Hot-world expansion (this PR adds Move 2 cubquests)
  ⏳ Move 5 mibera-dimensions (post-stickers branch landing + Move 1 merge)
  ⏳ Move 2 cubquests-interface (per Move 2 runbook in this PR)
  ⏳ score-mibera — survey: is its dashboard a candidate for Bearer pattern?

PHASE 2  Tenant housekeeping (parallel-safe)
  ⏳ Triage the 5 declarative-stub tenants (apdao, honeyjar, interpol, validator, henlo)
       — survey each project's Railway state + draft cancel-or-wire recommendations
  ⏳ henlo-old archive — Railway project still provisioned; cancel or migrate to cold storage
  ⏳ score-api ↔ score-mibera double-sync — pick one canonical, deprecate the other

PHASE 3  Dynamic-data consolidation
  ⏳ midi_profiles.dynamic_user_id + score-mibera dynamic_users + score-api dynamic_users
       → unified record in identity-api `linked_accounts` table (Dynamic provider already supported)
  ⏳ Cycle-by-cycle, not a Big Bang migration

PHASE 4  Server-side migration (per-consumer, sequential)
  ⏳ `lib/auth/identity.ts` Dynamic JWT cookie check → identity-api session check (per consumer)

PHASE 5  Vendor excision (per-consumer, optional)
  ⏳ Each consumer chooses when to flip Dynamic → RainbowKit+wagmi

PHASE 6  Data consolidation (long-tail)
  ⏳ midi_profiles → archival read-only
  ⏳ Per-world content federates on read per identity-api compose pattern
```

## v0.2 amendments captured

What changed from v0.1 → v0.2:
1. **10 distinct user-data surfaces revealed** (v0.1 mapped 2)
2. **Dynamic export framing corrected** — live API-pull pipeline, not a file
3. **cubquests confirmed as Move 2 target** (Patrol D analysis)
4. **5 declarative-stub tenants surfaced** — paid Railway infrastructure with no live writes
5. **henlo-old billing waste flagged** — `archive_only=true` but still provisioned
6. **score-api ↔ score-mibera double-sync risk surfaced** — drift between two `dynamic_users` tables
7. **freeside-characters clarified** — NOT a world; consumer of mibera tenant via `RAILWAY_MIBERA_DATABASE_URL`

## v0.2 → v0.3 amendments expected

- Operator response on Dynamic export ambiguity (one-shot file? OR confirm it's just the live pipeline?)
- cubquests Move 2 outcome
- Tenant housekeeping decisions (cancel cold tenants? maintain?)
- score-api vs score-mibera canonical sync choice
- Multi-method auth UX shape (operator-named earlier: prompt-for-username on first login)

## Cite

Patrol D synthesis: `/private/tmp/claude-501/.../tasks/a10bf082a130a0eff.output` (preserved in conversation history)
Tenant registry source: `~/Documents/GitHub/freeside-auth/packages/engine/src/tenants.yaml`
Dynamic sync scripts: `~/Documents/GitHub/score-api/scripts/ops/sync-dynamic.ts` + mirror in score-mibera
