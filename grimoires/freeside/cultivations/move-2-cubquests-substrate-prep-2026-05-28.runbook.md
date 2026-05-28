---
cutover: cubquests-substrate-prep
date: 2026-05-28
persona: KRANZ
scope: single-repo (cubquests-interface)
status: drafted · forward-track · awaits Move 1 PR #105 verify-and-merge + optional cubquests-side branch-state stabilization
reversibility: revert-clean per PR; Bearer pattern is additive
acceptance_threshold: cold-login fresh wallet at deployed cubquests-interface → spine row inserted + in-memory session token + cross-consumer test (same wallet signed in at honey-road first → same user_id at cubquests)
related_pr: TBD (this runbook is forward-track)
related_doctrine: ../doctrines/bearer-pattern-cluster-auth-protocol.md (v0.1 — third application after Move 1 + Move 5)
related_memory: identity-api-cookies-host-only · verify-resp-body-shape
related_atlas: ../atlases/world-atlas-v0.2.md
---

# Cutover: cubquests-interface Substrate-Prep (Move 2)

> KRANZ Coordinate-act framing: cubquests is the SECOND hot world after mibera. Patrol D confirmed: branch `simstim/sovereign-migration` active, Dynamic SDK pinned 4.43.0, `dynamic_user_id` column present on `profiles` table, Railway tenant `cubquest` (`57a19fbc-e8d5-485c-bdb1-dc00b1842202`) already provisioned in `tenants.yaml`, open issues #38/#46/#23 confirm migration appetite. Move 2 unblocks cross-world identity coherence by giving cubquests + mibera users a shared `user_id` for the first time.

## Coordinate (Act 1) — telemetry

- **Target repo:** `~/Documents/GitHub/cubquests-interface` (GitHub: `0xHoneyJar/cubquests-interface`)
- **Branch state:** `simstim/sovereign-migration` ACTIVE (last commit 2026-05-26)
- **Auth shape today:** Full Dynamic SDK (`@dynamic-labs/{ethereum, solana, iconic, wagmi-connector}` @ `4.43.0`)
- **JWT verification today:** `lib/auth/jwt.ts` queries `https://app.dynamic.xyz/api/v0/sdk/{env}/.well-known/jwks` directly
- **Wallet resolution today:** `lib/auth/resolve-wallet.ts` two-tier `profiles.dynamic_user_id` → `profiles.address` against Supabase (not identity-api)
- **Tenant DB:** `profiles` table (unified eth+sol) — Railway PG (post sovereign-migration per `tenants.yaml`)
- **World:** Needs operator decision on slug — proposed `cubquest` (matches tenant slug) or `cubquests` (frontend-natural)
- **Spine entry:** `worlds.cubquest` row needs seeding before Move 2 launches
- **Open issues confirming appetite:** #23 epic Authentication & Identity, #38 Lightweight auth & user identity, #46 [Identity] Auth - /v1/auth

## Mirror (Act 2) — substrate move (per doctrine v0.1, Move 5 evolution)

**Pre-step (operator action OR identity-api PR):** Seed `worlds` row with slug `cubquest` (or `cubquests` per operator choice) into identity-api Postgres. One-line SQL:

```sql
INSERT INTO worlds (world_slug, display_name) VALUES ('cubquest', 'CubQuests')
ON CONFLICT (world_slug) DO NOTHING;
```

**Branch:** `feat/identity-siwe-write-flow` off cubquests-interface main (after `simstim/sovereign-migration` lands OR with operator confirmation that branch is stable enough to base on).

Apply Bearer pattern per `../doctrines/bearer-pattern-cluster-auth-protocol.md` §Per-repo adoption template. Path substitutions per Move 5 template plus:

| Doctrine path | cubquests-interface path |
|---|---|
| `src/vendor/identity-client/` | DOES NOT EXIST — vendor from `freeside-auth/packages/sdk/src/` at current pinned SHA (see Vendor Strategy decision below) |
| `lib/identity/client.ts` | NEW — server-side wrapper mirroring mibera-honeyroad pattern |
| `lib/identity/client-browser.ts` | NEW — browser-side with `jwt:` callback |
| `lib/auth/siwe-flow.ts` | NEW — SIWE adapter |
| `lib/stores/identity-session.ts` | NEW — zustand store, in-memory |
| `lib/auth/use-identity-session.ts` | NEW — React hook |
| `lib/hooks/use-login.ts` | EDIT — one additive useEffect; preserve all existing return values |
| `lib/auth/jwt.ts` | UNTOUCHED — Dynamic JWKS verify stays as server-side fallback |
| `lib/auth/resolve-wallet.ts` | UNTOUCHED — Supabase profile lookups stay; cubquests world content still in Supabase |

## Verify (Act 3)

**Layer 1 — Smoke:** dev environment cold wallet connect → SIWE flow → spine row creation for `cubquest` world.

**Layer 2 — Parity (CRITICAL — two-world test):** 
- Operator's wallet signed in at mibera-honeyroad (Move 1) → spine row exists with mibera world_identity
- Same wallet visits cubquests-interface (Move 2) → SIWE flow detects existing user_id, ADDS cubquest world_identity row
- Result: ONE user_id, TWO world_identity rows (mibera + cubquest), ONE primary_wallet
- This proves cross-world identity coherence. Headline acceptance for the unified-spine vision.

**Layer 3 — Operator gate.**

## Flip (Act 4) — no flip

Substrate-prep only. Dynamic stays as wallet UI driver. cubquests Supabase profiles continue as authoritative for cubquests world content.

## Distill (Act 5)

Drift expected to inform doctrine v0.1 → v0.2:
- Solana wallet handling (cubquests has both EVM + Solana; Move 1 only handled EVM via wagmi `signMessageAsync`)
- Two-tier resolution (`dynamic_user_id` → `address`) coexistence pattern with new spine-aware path
- The `worlds` seed prerequisite (cubquest row didn't exist; new pre-step)

## Vendor Strategy decision (Fork 3 from Patrol C — operator-required)

Before Move 2 ships, the operator must decide cluster-wide vendor strategy for identity-client:

**Option A — Per-repo independent vendor at advanced SHAs.** Each consumer vendors at the latest stable SHA at the time of their Move. Drift × N consumers, but per-consumer SHA flexibility.

**Option B — Cluster-canonical pin advanced via coord-sync ceremony.** All consumers vendor at the same SHA. Cluster operator (KRANZ-style coordinator) advances the pin; all consumers re-vendor in sync.

**Option C — Hybrid: per-consumer vendor with periodic catch-up.** Each consumer vendors at adoption time; a quarterly ceremony bumps everyone to the latest stable.

This decision is REQUIRED before vendoring at cubquests because it sets precedent for Moves 6, 7, ..., N. Surfaced for operator.

## Coordination notes

- **simstim/sovereign-migration branch state:** verify before dispatching whether this branch is stable for base. If still active, coordinate landing first OR base Move 2 off `main`.
- **Solana wallet path:** Move 1 was EVM-only. cubquests has Solana too. The SIWE-write flow may need a per-chain variant. Sub-agent dispatch must check this OR Move 2 scope explicitly excludes Solana (Phase 1 EVM-first, Solana follows).
- **Two-world test is the headline:** post-merge, demonstrate cross-consumer identity by signing the same wallet at honey-road then cubquests. Two world_identity rows, one user_id, primary_wallet matches. If this fails, the unified-spine vision is unproven.

## Out-of-scope

- Solana wallet signing (Phase 1 deferred unless operator wants it scoped in)
- cubquests Supabase profiles migration (separate Phase 3 work)
- Server-side `lib/auth/jwt.ts` swap (separate Phase 4)
- Open issues #38/#46/#23 resolution (substrate-prep ≠ epic close)
