---
doctrine: bearer-pattern-cluster-auth-protocol
date: 2026-05-28
persona: KRANZ (authored) · GECKO (composes with)
status: DRAFT v0.1 · distilled from Move 1 (mibera-honeyroad PR #105, 2026-05-27)
scope: cluster-wide — every honey-road-class consumer adopting identity-api as the spine without taking on cookie-domain coupling
related_doctrines: [[sovereign-aggregator-substitution]] · [[saas-exit-vectors]] · [[push-deps-to-edge]] · [[sovereign-code-distribution]]
related_runbooks: [[move-1-honey-road-substrate-prep-2026-05-27]] · [[move-3b-inventory-api-flip-2026-05-27]]
memory_anchors: [[identity-api-cookies-host-only]] · [[verify-resp-body-shape]] · [[mibera-dimensions-substrate-shape]]
---

# The Bearer Pattern — Cluster Auth Protocol

> KRANZ Distill act, authored mid-cycle 2026-05-28 while GECKO patrols the auth territory. The pattern Move 1 instantiated isn't bespoke; it's the *cluster's protocol* for unified auth adoption. Naming it makes it reusable. The next consumer doesn't reinvent; it inherits.

## The thesis (one sentence)

A honey-road-class consumer adopts identity-api as identity source-of-truth by **vendoring the typed client, adding a SIWE-write adapter, storing the body-borne session token in memory, and firing the adapter after the existing auth UI (Dynamic / Privy / whatever) yields a wallet address** — additive only, zero upstream identity-api change, zero existing-consumer breakage, prepared for future excision of the vendor auth UI.

## Why this protocol (the forces it resolves)

Five constraints converge:

1. **Cookies are subdomain-locked.** identity-api at `identity.0xhoneyjar.xyz`; consumers at `<world>.0xhoneyjar.xyz`. identity-api `SessionConfig` does not emit `Domain=` → cookies cannot cross. See [[identity-api-cookies-host-only]].
2. **VerifyResp returns the session JWT in body.** `{user_id, primary_wallet, session: {token, expires_at}}`. The token is the cookie's twin — same authority, different transport. See [[verify-resp-body-shape]].
3. **Vendor auth UI is paid for and can't be ripped out today.** Operator-stated 2026-05-27: "we're still on Dynamic's service." Migration is gradual. The cluster MUST coexist with vendor auth indefinitely.
4. **Cluster-wide identity must work BEFORE any single consumer excises its vendor.** Otherwise users lose access to their old accounts when their consumer flips. The spine has to be ready first, populated, observable.
5. **Source-distribution doctrine is non-negotiable.** No npm publishes; code travels by vendor + pinned SHA. See [[sovereign-code-distribution]].

The Bearer Pattern is the smallest substrate move that resolves all five.

## The pattern shape (5 layers + 1 wire)

```
┌──────────────────────────────────────────────────────────────────┐
│ Vendor: lib/identity-client/ (or src/vendor/identity-client/)    │ ← source-distributed
│   ↳ pinned SHA recorded in VENDOR.md                             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Browser client: lib/identity/client-browser.ts                   │ ← paired to existing server client.ts
│   ↳ jwt: () => store.token                                       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Session store: lib/stores/identity-session.ts                    │ ← zustand, IN-MEMORY ONLY
│   ↳ { user_id, primary_wallet, token, expires_at }               │   no persist middleware
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ SIWE flow: lib/auth/siwe-flow.ts                                 │
│   challenge → wagmi signMessageAsync → verify → setSession       │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Hook: lib/auth/use-identity-session.ts                           │
│   { session, signIn(addr), signOut, refresh }                    │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Wire: lib/hooks/use-login.ts (existing vendor-auth hook)         │ ← ADDITIVE: one useEffect
│   useEffect: after vendor primaryWallet present + no session     │   for this wallet → signIn(addr)
│   Return shape: { ...existing, identitySession, identitySignOut }│
└──────────────────────────────────────────────────────────────────┘
```

Five new files + one additive edit. No removals. No vendor uninstall. No upstream identity-api changes.

## Invariants (NEVER violate)

| # | Invariant | Why |
|---|---|---|
| BP-1 | Token lives in memory only. No `persist` middleware. No localStorage. No sessionStorage. | Cross-tab token leakage + XSS exfil surface. Session re-issues on page reload via SIWE; the challenge+verify cost is ~500ms, paid once per page-load. |
| BP-2 | The wire is ADDITIVE. Existing vendor-auth hook's return shape EXTENDED, never altered. | Every downstream consumer keeps working unchanged. Move 1's revert is one revert; the pattern preserves that property. |
| BP-3 | Vendor identity-client at pinned SHA. `VENDOR.md` records source, SHA, peer deps, re-vendor command. | Source-distribution sovereignty; supply-chain shrinkage; explicit upgrade decisions. |
| BP-4 | The signIn is idempotent. Hash-compare wallet address (lowercased) against session.primary_wallet before firing. | useEffect re-runs are common; prevent redundant challenge+verify round-trips. |
| BP-5 | The signOut composes. Vendor logout AND identitySignOut fire together. | Prevents zombie sessions where the vendor session ended but identity-api session still authorizes reads. |
| BP-6 | The signIn never throws to UI. console.warn on failure; do not block the vendor auth flow. | Identity-api could be down; vendor auth still works for whatever it gates locally. Graceful degradation. |
| BP-7 | The browser-client's `jwt:` is a getter, NOT a snapshot. `() => store.getState().token` not `store.getState().token`. | Token rotation: when session expires + refreshes, every subsequent client call sees the new token. Snapshot would freeze stale. |
| BP-8 | Server-side identity check (`lib/auth/identity.ts` Dynamic JWT cookie path) is UNTOUCHED in substrate-prep. | Server auth migration is its own cycle. Substrate-prep is client-side; server-side stays vendor-driven until intentional cycle. |

## Per-repo adoption template

When operator wants `repo-X` to adopt identity-api as spine:

1. **GECKO observe:** read repo's current vendor-auth surface. Confirm Dynamic (or Privy, or whatever) is the existing UI driver. Confirm wagmi or compatible signer is available.
2. **KRANZ coordinate:** open a runbook at `grimoires/freeside/cultivations/move-N-<repo>-substrate-prep-<date>.runbook.md`. Cite this doctrine. Identify per-repo path substitutions (where does the existing use-login.ts live? what's the session-store convention?).
3. **Vendor check:** if `src/vendor/identity-client/` doesn't exist in target repo, vendor from `freeside-auth/packages/sdk/src/` at current pinned SHA (compose with [[sovereign-code-distribution]]).
4. **Mirror:** dispatch the 5-file + 1-wire write per the pattern shape diagram. Use the worktree pattern if local is significantly behind origin/main.
5. **Verify:** 3-layer per KRANZ — smoke (fresh-wallet cold-login creates spine row + token), parity (3 known wallets resolve cleanly), operator gate.
6. **Distill:** retro names the per-repo drift from the doctrine (wagmi import path? test convention? store library?). The doctrine learns from each adoption.

Repos currently candidate for this pattern (alphabetical):
- `cubquests-interface` (per jwt.ts memory-cross-reference — confirm)
- `freeside-characters` (server-side; user-auth surface unclear — patrol determines)
- `freeside-mediums` (Discord bot — different auth shape; this pattern likely DOESN'T apply)
- `honey-interface` (status unknown — patrol determines)
- `mibera-dimensions` (confirmed honey-road-class per [[mibera-dimensions-substrate-shape]])
- `mibera-honeyroad` (legacy dir vs active repo — patrol determines)
- `midi-interface` (legacy midi UI — likely dormant; patrol confirms)
- `score-mibera` (bonfire dir — purpose unclear)

GECKO Patrol A + B + C in flight 2026-05-28; per-repo classification will populate this list.

## Composition with W2.5 (cell-auth substrate)

This pattern is for **user-auth** (end-user → identity-api). W2.5 svc-JWT primitive is for **cell-auth** (cell → identity-api OR cell → cell). They coexist; they don't compete.

| Concern | This pattern (Bearer) | W2.5 svc-JWT |
|---|---|---|
| Who authenticates | end-user | cell process |
| Token issuance | `/v1/auth/verify` (SIWE) | `/v1/auth/service-jwt` (API key exchange) |
| Token transport | `Authorization: Bearer` from in-memory store | `Authorization: Bearer` from cell config |
| Lifetime | ~24h (session.expires_at) or until tab close | minutes (per-request issuance) |
| Audience | `aud=user` (or omitted) | `aud=<target-cell-name>` |
| Validation | identity-api server-side via signed-cookie or JWKS | cell-local `@freeside-auth/auth-sdk verifySvcJwt` |

A consumer can use BOTH simultaneously: Bearer pattern for user-auth UI flows, svc-JWT for the consumer's own backend calls to other cells.

## What this protocol REPLACES (and what it doesn't)

**Replaces:**
- Bespoke per-consumer identity-api integration runbooks
- The cookie-domain question (sidestepped via body-borne token)
- The "do we excise the vendor first or land identity-api first" debate (this is identity-api-first; excise later if at all)

**Does NOT replace:**
- The eventual vendor-auth excision (this is *preparation*; excision is its own cycle per consumer)
- Server-side identity-api integration (cookie/JWT check on API routes — that's a different cycle per repo; needs care because session token might come via Bearer body OR cookie depending on how the consumer wires it)
- Multi-world claim-on-first-login UX (the pattern creates the spine entry; the UX of "prompt user for a nym in world W" is a SEPARATE consumer concern)

## Open questions (will surface to operator after GECKO patrols return)

1. **Multi-world UX shape** — when a user signs in for the first time at `mibera.0xhoneyjar.xyz`, the spine row is created. Are they auto-claimed into the `mibera` world with nym = their wallet-first-6 (or similar default)? Or do they get prompted? The pattern creates the spine row but stops there.
2. **Cross-consumer SSO** — if user signs in at honey-road, then visits mibera-dimensions, does the in-memory token transfer? (No — separate browsing contexts have separate stores. Bearer pattern intentionally avoids cross-subdomain cookies. SSO is a future enhancement, not v1.)
3. **Expiration handling** — what happens when `expires_at` passes during an active session? Pattern says "refresh on next page-load via SIWE." Operator may want a softer story (silent refresh if vendor wallet still connected).
4. **Server-side variant** — server routes that need to verify the Bearer token should use `verifyToken` from `@freeside-auth/auth-sdk` (or the runtime equivalent), NOT the Dynamic JWKS path. That's a per-route migration the substrate-prep doesn't enable yet.
5. **Vendor-uninstall threshold** — what triggers excision? Operator decision; pattern doesn't prescribe. Likely: when ALL active consumers have migrated their server-side auth check off Dynamic too.

## Doctrine versioning

This is v0.1. Each Move N adoption surfaces drift → drift is captured → drift becomes amendments → doctrine version bumps.

When v0.1 → v0.2, expect:
- Per-repo path substitution patterns codified
- Edge cases (Privy not Dynamic; native mobile; embedded webviews; etc.)
- Server-side migration playbook (Bearer token verification on API routes)
- Multi-world claim-on-first-login UX shape

Until then, this doctrine is **describable but not yet load-bearing**. Move 1 is the first instantiation. Move 5 (mibera-dimensions) will be the second; the v0.1 → v0.2 amendment happens after Move 5 ships and the pattern proves it composes.
