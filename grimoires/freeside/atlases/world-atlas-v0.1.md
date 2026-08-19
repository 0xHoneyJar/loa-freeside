---
atlas: world-atlas
version: v0.1
date: 2026-05-28
persona: KRANZ × GECKO
status: DRAFT · grounded in identity-api Phase 1 PRD §2.2/§2.3 + Patrol A/B findings 2026-05-28 · Patrol C pending may add rows
disclaimer: THE MAP IS NOT THE TERRITORY · this is the cluster's best-effort approximation of what worlds exist, what databases back them, and what the unified-spine vision looks like in motion · corrections welcomed and expected
---

# Cluster World Atlas — v0.1

> KRANZ Coordinate-act discipline says: read the registry facts before drafting the cutover. GECKO Diagnose says: name what's there + what's missing. This atlas is both — the cluster's worlds, who fronts them, what database backs them, where the spine has reached, and the gaps.

## The unified-spine vision (in one sentence)

**One `user_id` in the identity-api spine, one row per `world_identity` per world the user has joined, with a per-world `nym` and a single per-user `primary_wallet`** — replacing the today-fragmented topology where each world has its own user-database with its own username conventions and its own auth surface.

The spine doesn't replace the worlds. Each world still owns its world-specific content (profiles, achievements, leaderboards, dimensions). The spine is the **identity bone** — the shared skeleton that lets a user at `mibera.0xhoneyjar.xyz` and `cubquests.0xhoneyjar.xyz` and `thj.0xhoneyjar.xyz` be recognizably the same human, with per-world handles, without re-authenticating from scratch at each.

## The atlas (worlds × auth state)

| World slug | Display name | Frontend(s) today | Current user-database | Spine status | Notes |
|---|---|---|---|---|---|
| `mibera` | Mibera | mibera-honeyroad, mibera-dimensions | `midi_profiles` PG (shared by 2 frontends) | **🟡 partial** — seeded ✅ · 3 of ~192 users claimed nyms · 189 wallet-only users stuck behind Discord-required gate | The active world. Move 1 substrate-prep PR #105 awaiting review unblocks lazy claim-on-first-login |
| `thj` (presumed) | THJ | honey-interface (DORMANT) | ❓ "auth-proxy" backend per Patrol A; not directly mapped | **🟡 seeded ✅ · zero claimed nyms** | PRD §2.2 says THJ + mibera-world seeded at deploy. The honey-interface frontend is dormant (last meaningful commit Mar 31); no clear user-write surface today. Older THJ era used `.bera` ENS for display names |
| `cubquests` (suspected) | CubQuests | cubquests-interface (not in patrol scope; deduced) | ❓ cubquests-own user DB (per `mibera-honeyroad/lib/auth/jwt.ts` comment: "matches midi-interface and cubquests-interface patterns") | **🔴 NOT in spine** — needs seed + integration | freeside-auth `jwt.ts` cross-references the cubquests pattern, suggesting it's a sibling honey-road-class consumer. Needs explicit operator confirmation |
| (Patrol C pending) | ... | ... | ... | ... | Patrol C dragnet may surface more world slugs in grimoires/proposals across the cluster |

## The user-database fragmentation (today's reality)

```
                         identity-api spine
                              │
                              │   3 of ~192 mibera users
                              ▼
                         ┌─────────┐
                         │ spine PG│   (worlds, world_identity, users, wallet_links, linked_accounts)
                         └─────────┘
                              ▲
                              │ Phase 4 backfill (T4.4)
                              │ wrote 3; gated by Discord-required at backfill-midi-profiles.ts:134
                              │
                         ┌─────────┐
                  ┌──────│ midi_profiles│──────┐
                  │      └─────────┘     │      │
                  ▼                       ▼      │
            mibera-honeyroad      mibera-dimensions
            (Dynamic JWT             (Dynamic JWT
              verify path)             verify path)
                  │                       │
                  └──── share writes ─────┘
                  
   ❓ cubquests own DB           ❓ honey-interface auth-proxy backend
   (not yet inventoried)         (presumed THJ-era; dormant)
```

**Observation (KRANZ telemetry over claims):** Patrol B says **only ONE user-database is written by the 8 server-side cells in scope** — the spine itself. All other user data lives in app-level databases (midi_profiles, presumed cubquests DB, presumed THJ-era state). The fragmentation is in the **frontends**, not in the server-side substrate.

## Spine state today (telemetry)

From identity-api migration `0001_init_spine.up.sql` + PRD §2.2:

- Tables: `users`, `wallet_links`, `linked_accounts`, `worlds`, `world_identity`, `audit_events`, `auth_nonces`
- Seeded worlds at deploy: **THJ + mibera-world** (per PRD comment; concrete slug names: `thj` and `mibera`)
- Currently populated: `mibera` only (3 nyms claimed; `thj` row exists but no claims)
- LBR-1 atomic resolve-or-mint guarantees future SIWE flows are race-safe (concurrent verify → one user_id + one wallet_link)
- audit_events.actor field encodes provenance: `'self' | 'sietch-redirect' | 'backfill' | <world_slug>` — every spine write is traceable

## The Discord-required gate (the substrate bug)

`freeside-auth/scripts/backfill-midi-profiles.ts:134` requires BOTH `discord_id` AND `wallet_address` to call `linkVerifiedWallet`. Result: 189 wallet-only midi users never enter the spine. Operator's own commentary in PR #9: *"189 of 192 midi users are wallet-only and won't be claimed here until a wallet-only spine-registration API exists."*

**Two paths to unblock:**

A. **Runtime SIWE creates spine entries lazily.** This is what Move 1 (PR #105) enables for honey-road. When a wallet-only user visits the consumer + connects via Dynamic + the new useEffect fires SIWE flow → `POST /v1/auth/verify` LBR-1 atomic resolve-or-mint creates the spine row. Discord-required is only in the BATCH backfill path, not the runtime SIWE path. **This is the operator's "lazy claim-on-first-login" decision from 2026-05-27.**

B. **Patch the backfill to relax the Discord gate.** Run wallet-only batch migration. Risk: introduces 189 spine rows for users who may never return; spine-side housekeeping if the user later tries to claim Discord.

Operator-decided: A (Move 1). B is dropped.

## The unified-auth migration vision (what the operator named today)

Architecture target:

```
                   ┌────────────────────────────────┐
                   │  identity-api spine            │
                   │  • one user_id per human       │
                   │  • per-world world_identity    │
                   │  • per-user primary_wallet     │
                   │  • multi-method auth ports     │
                   └────────────────────────────────┘
                              ▲
                              │ Bearer pattern (or future cookie-scoped)
                              │
   ┌──────────────────────────┼──────────────────────────────┐
   │                          │                              │
   ▼                          ▼                              ▼
auth adapters at the edge — coexist, swap independently per-consumer
   │                          │                              │
[wallet/SIWE]            [email/passkey]              [Dynamic SDK]
 wagmi-driven            future · WebAuthn          (vendor; coexist;
                                                     migrate gradually)
```

**The doctrine:** push auth methods to the edge as adapters. The spine is auth-method-agnostic. Each consumer chooses its UI driver; the spine accepts whoever-it-is via SIWE-write or other adapter.

**The migration shape, per-consumer:** Bearer pattern (`bearer-pattern-cluster-auth-protocol.md`) lands a substrate-prep PR that wires identity-api as the spine WITHOUT removing the vendor auth UI. Later, when ALL active consumers are running on the spine, the vendor can be excised cycle-by-cycle.

## Decision forks (the operator likely needs to resolve)

The map names what's clear and surfaces what's NOT clear:

1. **Which worlds beyond mibera + THJ?** Operator named cubquests-class repos exist with their own user-databases. Patrol C may surface the full list from grimoires. Until then: open question.
2. **How are world slugs governed?** Today: hardcoded in seeding script + migration comments. As more worlds come online, who's authoritative for the slug registry? (`freeside-worlds` registry is the candidate per PRD §1; not yet inventoried.)
3. **Multi-world claim-on-first-login UX.** Operator named: "we'll have users prompt for a username so they can enter that in if they haven't yet set that." Pattern not yet designed. Composes with Move 1 + Move 5.
4. **Server-side identity check migration.** Each consumer's server routes today check Dynamic JWT cookie. When Bearer pattern client-side adoption reaches saturation, do server routes migrate to verifying identity-api session token? This is its own cycle per consumer.
5. **cubquests-interface inclusion in the spine.** If cubquests is a real cluster member (not just historical), it needs (a) world seed in spine, (b) Move-1-class substrate-prep PR, (c) backfill of cubquests user DB into spine. Each step is operator-decision.
6. **What happens to "wagmi-starter" / honey-interface?** Dormant THJ-era surface; auth-proxy backend; revive or deprecate?

## What this atlas does NOT cover (out-of-scope acknowledgments)

- Smart-contract authority (on-chain roles per W2.5 F-S2 — separate substrate)
- Cell-to-cell auth (W2.5 svc-JWT; 0 of 8 cells have consumed it yet)
- Asset/storage auth (freeside-storage is sealed library; presigned-URL pattern handles its auth)
- Discord OAuth flow (linked_accounts pattern in spine; operational; not depicted)
- The world-registry-as-substrate question (`freeside-worlds` repo not inventoried)

## How to extend this atlas

When a new world is added or a new consumer goes live:
1. Add a row to the worlds×auth table
2. Update the user-database fragmentation diagram if topology changes
3. Bump version (v0.1 → v0.2 etc.)
4. Cite the PR/cycle that drove the update

Pattern-of-use: this atlas is the cluster's shared mental model for auth-territory. Cite it in runbooks. Reference it when scoping cutovers. Question it when reality differs — and update it loudly when the territory teaches us the map was wrong.

## v0.1 → v0.2 amendments expected after Patrol C

- Open PRs/issues touching auth across the org (number + ages)
- Grimoire artifacts referencing world-slugs we haven't named yet
- Coordinator state — which active coordinators own which cross-repo work
- Any orphan PRDs/proposals the cluster started and forgot

Patrol C is the dragnet that will populate these rows. Atlas update on its return.
