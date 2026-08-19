---
cutover: honey-road-substrate-prep-auth-adapter
date: 2026-05-27
persona: KRANZ
scope: single-repo (mibera-honeyroad, branch off origin/main 4cc78f3d)
status: drafted v2 (Bearer pattern; supersedes v1 cookie design) · dispatched 2026-05-27 · PR #105 OPEN awaiting review
reversibility: revert-clean per PR; all changes additive (no Dynamic removal, no provider swap, no existing-file rewrites except one useEffect addition)
acceptance_threshold: cold-login a fresh wallet (never seen by spine) → confirm spine row inserted in identity-api Postgres (via client.me() returning the new user_id) + in-memory session token populated + subsequent client.resolve.byWallet(addr) returns the same user_id
related_pr: https://github.com/0xHoneyJar/mibera-honeyroad/pull/105
related_doctrine: ../doctrines/bearer-pattern-cluster-auth-protocol.md
related_memory: identity-api-cookies-host-only · verify-resp-body-shape
---

# Cutover: Honey-Road Substrate-Prep Auth Adapter (v2 — Bearer)

> **v1 → v2 amendment (2026-05-27):** v1 designed cookie-based session; sub-agent pre-flight discovered identity-api cookies are host-only on `identity.0xhoneyjar.xyz` (no `Domain=` attr). v2 uses the **Bearer pattern** instead, since `VerifyResp` returns the session JWT in body. Cookie blocker evaporates. Lower blast radius — no upstream identity-api change needed.

> **Discovered shipped state (PRs #101/#102/#103, merged to mibera-honeyroad main at HEAD `4cc78f3d`):** `src/vendor/identity-client/` and `src/vendor/identity-protocol/` already vendored (pinned upstream `b312f78b...`, 2026-05-25). `lib/identity/client.ts` is the SERVER-SIDE wrapper using the public-read pattern (no JWT) for mibera-dimensions self-view. Move 1 adds the BROWSER-SIDE client + the SIWE-write flow on top of this foundation.

## Scope (v2 — minimal)

| Layer | Change |
|---|---|
| Browser client | `lib/identity/client-browser.ts` — paired to existing server `client.ts`, accepts `jwt:` callback from session store |
| SIWE flow | `lib/auth/siwe-flow.ts` — challenge → wagmi `signMessageAsync` → verify → return `VerifyResp` |
| Session store | `lib/stores/identity-session.ts` — zustand store, in-memory only, holds `{user_id, primary_wallet, token, expires_at}` |
| Hook | `lib/auth/use-identity-session.ts` — `{ session, isLoading, signIn(addr), signOut, refresh }` |
| Wire | `lib/hooks/use-login.ts` — ONE useEffect: after `primaryWallet?.address` available + no existing session for this wallet → call `signIn(primaryWallet)` (idempotent) |
| Env | `.env.local.example`: `NEXT_PUBLIC_IDENTITY_API_URL=https://identity.0xhoneyjar.xyz` |

**Explicitly NOT touched:**
- `src/vendor/identity-client/` (already vendored at pinned SHA — no re-vendor)
- `lib/identity/client.ts` (server-side wrapper stays as-is)
- `components/web3-provider.tsx` (Dynamic provider root)
- `components/{thread,forum,presale,presale-admin}-page.tsx` (Dynamic consumers)
- `package.json` (no @dynamic-labs/* removal; no new deps)
- `lib/auth/identity.ts` (server-side Dynamic JWT cookie check — kept; future cycle replaces)

## Coordinate (Act 1) — telemetry-grounded

- **Vendor present:** `src/vendor/identity-client/` + `src/vendor/identity-protocol/` with `VerifyRespSchema`
- **Server pattern shipped:** `lib/identity/client.ts` lazy-constructs identity-client with `defaultHeaders: { "x-app-id": "mibera-honeyroad" }` + public-read posture
- **Verify response shape:** `{ user_id, primary_wallet, session: { token, expires_at } }` — body-borne JWT
- **LBR-1 guarantee** (from `freeside-auth/src/api/routes/auth.ts:14-19`): `/v1/auth/verify` wraps `resolveOrMintByWallet` in transaction; concurrent verifies for a fresh wallet serialize at wallet_links uniqueness; loser retries; net: ONE user row + ONE wallet_link. Cold-login = spine entry created atomically.
- **No client-side SIWE flow exists yet** on origin/main pre-PR-#105

## Mirror (Act 2) — substrate move

**Branch:** `feat/identity-siwe-write-flow` off origin/main (`4cc78f3d`).

See PR #105 for landed implementation. Five new files + one additive edit to `lib/hooks/use-login.ts`. Pinned freeside-auth source SHA: `05c533cd` (verified via `git -C ~/Documents/GitHub/freeside-auth rev-parse w2.5-sprint-3-auth-sdk-source-distributed`).

Test coverage: `lib/stores/identity-session.test.ts` (5/5), `lib/auth/siwe-flow.test.ts` (4/4). Typecheck clean. 109/109 baseline tests unchanged.

## Verify (Act 3) — three-layer gate (operator action)

**Layer 1 — Smoke canary (dev):**
- `pnpm dev` → cold-browser → connect a fresh wallet (one never used in spine)
- Open DevTools Console + Network — expect: `POST /v1/auth/challenge` 200, `signMessage` browser-prompt, `POST /v1/auth/verify` 200 returning `VerifyResp`
- `useIdentitySessionStore.getState().session` returns non-null with valid `user_id`
- Manually call `getBrowserIdentityClient().me()` from console → returns same user_id

**Layer 2 — Parity sample:**
- Cold-login operator's known wallets (soju, jani, zerker)
- Confirm `client.resolve.byWallet(addr)` returns existing user_id (no duplicate inserts)

**Layer 3 — Operator gate:**
- Review PR
- Confirm in-memory-token threat model is acceptable
- GO or HALT

## Flip (Act 4) — no flip in this cutover

Substrate-prep only. New session/hook is AVAILABLE to consumers but no existing code is REROUTED. Dynamic continues as auth UI driver. Server-side `lib/auth/identity.ts` still checks Dynamic JWT cookie unchanged.

## Distill (Act 5)

- Cycle retro after 24h stable
- Pattern lifted to `../doctrines/bearer-pattern-cluster-auth-protocol.md` (v0.1) — Move 5 mibera-dimensions adopts via the doctrine, not by re-deriving

## Out-of-scope (acknowledged)

- Dynamic provider removal (kept)
- 5 other Dynamic-consumer files (untouched)
- `@dynamic-labs/*` npm deps removal (kept)
- Server-side `lib/auth/identity.ts` Dynamic JWT cookie check (kept — future cycle)
- Navbar nym display swap (already done in #102 — independent)
- Survey identity read swap (already done in #101 — independent)
- Nym claim UI prompt (separate cycle)
- Midi backfill discord-relax (DROPPED — lazy claim-on-first-login via this Move 1 handles it)
- Upstream identity-api cookie-domain fix (DEFERRED — Bearer pattern sidesteps the need)
