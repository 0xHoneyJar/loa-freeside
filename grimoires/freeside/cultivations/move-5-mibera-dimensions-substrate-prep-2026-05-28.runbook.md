---
cutover: mibera-dimensions-substrate-prep
date: 2026-05-28
persona: KRANZ
scope: single-repo (mibera-dimensions)
status: drafted · awaits Move 1 PR #105 merge + mibera-dimensions `chore/migrate-stickers-to-0xhoneyjar` branch landing as preconditions
reversibility: revert-clean per PR; all changes additive (Bearer pattern; no Dynamic removal)
acceptance_threshold: cold-login a fresh wallet at deployed mibera-dimensions → spine row inserted via LBR-1 atomic resolve-or-mint + in-memory session token populated + client.me() round-trip OK
related_pr: TBD (this runbook is forward-track)
related_doctrine: ../doctrines/bearer-pattern-cluster-auth-protocol.md (v0.1 — first application beyond Move 1)
related_memory: mibera-dimensions-substrate-shape · identity-api-cookies-host-only · verify-resp-body-shape
---

# Cutover: mibera-dimensions Substrate-Prep (Move 5)

> KRANZ Coordinate-act framing: this is the SECOND consumer to adopt the Bearer pattern. Move 1 (mibera-honeyroad) instantiated the pattern; the doctrine codified it; Move 5 is the first proof that the doctrine composes. v0.1 → v0.2 of the doctrine happens after Move 5 ships and reports drift.

## Coordinate (Act 1) — telemetry

- **Target repo:** `~/Documents/GitHub/mibera-dimensions` (GitHub: `0xHoneyJar/mibera-dimensions`)
- **Pre-Move state:** Same Dynamic+wagmi auth shape as mibera-honeyroad pre-PRs-#101/#102/#103. 3 Dynamic packages (`@dynamic-labs/{ethereum, sdk-react-core, wagmi-connector}`), `lib/hooks/use-login.ts`, `components/web3-provider.tsx`, `lib/auth/identity.ts` server-side Dynamic JWT cookie check.
- **NO identity-api wiring yet** — `grep -r @0xhoneyjar/identity` returns nothing.
- **Wagmi already a direct dep** (not just transitive).
- **Database backing today:** `midi_profiles` (SAME PG table as mibera-honeyroad — two frontends, one DB). Per Patrol D, mibera tenant Railway DB `44721dce-1ea0-42e7-8b56-bdd01f22e375`.
- **World:** `mibera` (same world slug as mibera-honeyroad — Move 5 does NOT add a new world; it adds a SECOND consumer to the existing mibera world).
- **Branch context:** mibera-dimensions is currently on `chore/migrate-stickers-to-0xhoneyjar` branch (active stickers migration). Move 5 should coordinate with stickers landing on main first to avoid double-merge.

## Mirror (Act 2) — substrate move (per doctrine v0.1)

**Branch:** `feat/identity-siwe-write-flow` off mibera-dimensions main (after stickers merges).

Apply the Bearer pattern per `../doctrines/bearer-pattern-cluster-auth-protocol.md` §Per-repo adoption template. Path substitutions:

| Doctrine path | mibera-dimensions path |
|---|---|
| `src/vendor/identity-client/` | DOES NOT EXIST YET — vendor from `freeside-auth/packages/sdk/src/` at current pinned SHA (same as Move 1's `b312f78b...` OR advance per cluster vendor-strategy decision — see Fork 3 from Patrol C synthesis) |
| `lib/identity/client-browser.ts` | NEW — paired to (also new) `lib/identity/client.ts` server wrapper (mirror Move 1's pattern) |
| `lib/auth/siwe-flow.ts` | NEW — challenge → wagmi → verify |
| `lib/stores/identity-session.ts` | NEW — zustand store, in-memory only |
| `lib/auth/use-identity-session.ts` | NEW — React hook |
| `lib/hooks/use-login.ts` | EDIT — one additive useEffect, idempotent guard |

**Note**: mibera-dimensions does NOT yet have `lib/identity/client.ts` (server wrapper); Move 5 adds both server + browser variants in one motion. This is a slight expansion vs Move 1 (where server wrapper was already shipped via #101/#102/#103).

## Verify (Act 3) — three-layer

**Layer 1 — Smoke:** `pnpm dev` (note: dimensions runs on port 3001 per package.json) → cold wallet connect → confirm SIWE flow + spine row creation.

**Layer 2 — Parity:** known wallets resolve cleanly via `client.resolve.byWallet`. CRUCIAL TEST: a wallet that signed in at mibera-honeyroad first, THEN visits mibera-dimensions, should resolve to the SAME user_id (proving the spine is single-source-of-truth for the mibera world).

**Layer 3 — Operator gate.**

## Flip (Act 4) — no flip

Substrate-prep only. Dynamic continues as auth UI. Server-side `lib/auth/identity.ts` Dynamic JWT cookie check unchanged.

## Distill (Act 5)

This is the first test of the Bearer doctrine v0.1 composing on a second consumer. Drift surfaced here → doctrine v0.1 → v0.2 amendment.

Expected drift to capture (predictions):
- Wagmi config path may differ (mibera-honeyroad used `getWagmiConfig()` function; dimensions may use a different shape)
- Test framework may differ (vitest config; test file colocation conventions)
- Existing server-side wrapper may not exist (Move 5 expansion)

## Coordination notes

- **mibera tenant DB writes:** Move 5 does NOT migrate writes to spine; it ADDS spine-aware client. midi_profiles continues as authoritative user record for mibera-world content (PFP, email, discord). Spine becomes identity identifier ONLY.
- **Stickers branch first:** Verify `chore/migrate-stickers-to-0xhoneyjar` lands on main before dispatching Move 5 to avoid merge conflict.
- **Two-consumer test:** post-merge, validate that signing in at honey-road + then visiting dimensions resolves to the same `user_id` in the spine. This is the headline acceptance — proves the unified-spine vision in motion.

## Out-of-scope

- Dynamic provider removal
- All other Dynamic-consumer files in dimensions
- Server-side migration (server's `lib/auth/identity.ts` Dynamic JWT check stays)
- Cubquests-interface Move (separate Move 6 per Patrol D)
- Multi-world UX (nym claim, world picker) — separate cycle
- Vendor pin advancement (governed per Fork 3 decision)
