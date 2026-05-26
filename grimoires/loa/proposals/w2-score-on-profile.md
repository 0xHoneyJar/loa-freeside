# W2 Wedge — Score on the Profile Page

**Status**: Proposed v0.2 (cluster-level proposal — flatline-amended 2026-05-25 PM)
**Date**: 2026-05-25 PM (v0.2 amendments)
**Author**: ai-derived (operator-directed)
**Compose with**: identity-api Phase 2 (in flight); score-api (L4 production); cubquests-interface (L4 production)

> **v0.2 amendments** (operator decision 2026-05-25 PM per flatline-batch findings):
> 1. **AUTH REQUIRED on /v1/profile** (closes flatline SKP-001 CRIT 850/840/750): /v1/profile MUST require a JWT for reads. Either Privy JWT (cubquests already issues) with wallet extracted server-side, OR identity-api-issued JWT. NO unauthenticated public reads; threat-model decision explicit.
> 2. **W2-G1 REFRAMED HONESTLY** (closes flatline SKP-002 HIGH 740): identity spine is empty until Phase 4 T4.4 backfill → 100% of W2 traffic returns identity=null. Original W2-G1 ("Prove cross-cell composition works in production") was not empirically achievable. Reframed: "Prove score-api can be composed via identity-api HTTP layer; spine-composition proof deferred to Phase 4."
> 3. **DEGRADED-SHAPE FORMALIZED** (closes flatline SKP-003 HIGH 720): sealed `degraded[]` reason codes + sources + retryability + UI-rendering rules + logging behavior per failure class (NOT_FOUND_IDENTITY, NOT_FOUND_SCORE, TIMEOUT_*, UPSTREAM_ERROR_*).
> 4. **HIGH-CONSENSUS AUTO-INTEGRATE** (flatline IMP-001 through IMP-008): production push gate explicit; canonical payload + layer boundary for degraded path; rollback plan; SDK method signature spec; timeout + open-circuit-breaker UI states; public-route auth resolved (per #1).
>
> Full v0.1-to-v0.2 diff captured in this section + the §Auth model + §Goals + §Architecture amendments below. See `loa-freeside/grimoires/freeside-network/flatline-batch-2026-05-25/findings.md` for the source flatline review.

> The first cross-building wedge after identity-api Phase 1. Smallest surface that proves real cross-cell composition in the HEXAGONAL FEDERATION (ADR-009). Piggybacks on identity-api Phase 2 work already happening (T2.1 federation client ports landed; T2.2 compose orchestrator landed; T2.3 GET /v1/profile route is the natural next).

## Problem

The freeside cluster has 8 registered cells (per `loa-freeside/packages/freeside-registry/registry.yaml`) but ZERO cross-cell composition has been proven end-to-end in production. identity-api Phase 1 deployed 2026-05-25 (`identity-api-production-317b.up.railway.app/health = 200`) but the spine is empty; score-api ships an L4 production HTTP service with 50+ endpoints but nothing consumes it as a typed-SDK call composed with identity. The risk: the doctrine ratifies a cluster pattern (per-cell harness, federation registry, BeaconV3) that no production code actually exercises. Until a real consumer threads the needle, the cluster's composition story is theoretical.

## The wedge

A logged-in cubquests.com user views their profile page. The page surfaces their **score** (from score-api) alongside their **identity** (from identity-api). Single composition; visible to 10K+ existing cubquests users; no new infra needed.

```
cubquests-interface (L4 Vercel)
        │
        ├── @0xhoneyjar/identity (SDK, source-distributed) ──→ identity-api (Railway)
        │                                                            │
        │                                                            └─→ ScorePort.getScore(walletAddress)
        │                                                                       │
        └────────────────────────────────────────────────────────────────────────┴─→ score-api (existing prod)
```

Operationally: cubquests vendors the `@0xhoneyjar/identity` SDK, makes ONE typed-API call (`client.profile.get({ walletAddress })`) that returns a composed `ProfileResp` with identity + score (degraded-shape if score-api 404s); renders the score on the existing profile surface. No new backend; no new contracts.

## Goals (v0.2 — reframed)

| ID | Goal | Metric |
|----|------|--------|
| W2-G1 | **(REFRAMED)** Prove score-api can be composed via identity-api HTTP layer | Live cubquests profile page renders score from score-api via identity-api compose orchestrator, AUTHENTICATED via Privy JWT or identity-api JWT. *Spine-composition proof (identity-api returning real `user_id` from spine, not null) is explicitly DEFERRED to Phase 4 T4.4 backfill milestone — W2 does not assert this.* |
| W2-G2 | Prove source-distributed SDK pattern works for a real consumer | cubquests-interface successfully vendors + uses `@0xhoneyjar/identity` SDK (Pattern B per identity-api Phase 1 doctrine) |
| W2-G3 | Prove the degraded-shape contract works under real failure modes | Score-api 404 (user has no score yet) → profile renders with score=null cleanly; degraded[] populated with sealed reason codes (NOT_FOUND_IDENTITY, NOT_FOUND_SCORE, TIMEOUT_*, UPSTREAM_ERROR_*); no crash |
| W2-G4 | Establish the SDK-vendor-cubquests recipe as cluster pattern | Recipe documented; reusable for future cells consuming identity-api |
| W2-G5 | **(NEW)** Validate auth model in production | All /v1/profile reads carry Privy JWT or identity-api JWT; zero unauthenticated reads observed in production logs; rate-limit + abuse monitoring active |

## Auth model (v0.2 — NEW SECTION per flatline SKP-001 CRIT)

`/v1/profile?wallet=<addr>` MUST NOT accept unauthenticated reads in production. Three options, listed in preference order:

### Option A — Privy JWT (RECOMMENDED for V1)

Cubquests already issues Privy JWTs to authenticated users; `linkedAccounts.find(a => a.type === 'wallet').address` extracts the wallet. The flow:

```
[cubquests user logged in]
  → cubquests server-action attaches Privy JWT to outbound request
  → identity-api /v1/profile verifies Privy JWT via Privy's JWKS endpoint
  → server-side extracts walletAddress from verified JWT claims
  → composeProfile() runs (no walletAddress in URL query)
```

Pros: cubquests doesn't need a new credential flow; identity-api adds Privy JWT verifier (1 small port-adapter); wallet enumeration impossible (JWT pins to one wallet).

Cons: identity-api takes a soft dependency on Privy (verifier port; not authority). If Privy ever shifts, identity-api needs a new verifier.

### Option B — Identity-api JWT (RECOMMENDED for V2)

Identity-api issues its own JWT (Phase 1 already supports this via ES256 + JWKS). Cubquests becomes an identity-api client: completes wallet challenge → receives identity-api JWT → uses for /v1/profile reads.

Pros: cluster authority consolidates; cubquests becomes a normal client.

Cons: cubquests UX change (additional sign-in step OR background JWT exchange); more work for V1 ship.

### Option C — Rate-limit only (FALLBACK if A + B both blocked)

`/v1/profile` stays unauthenticated but enforces per-IP rate limiting (e.g., 60/min) + abuse monitoring + cache. Threat model documented explicitly: profile + score data is *intentionally public* (scores are on-chain-derived anyway; wallet addresses are public).

Pros: zero auth dependency; ships fastest.

Cons: still exposes bulk enumeration to a determined attacker (just slower); no per-user audit trail; no way to differentiate legitimate vs scraping traffic.

### Decision: Option A for V1; queue Option B for V2

W2 v0.2 commits to **Option A (Privy JWT)** as the V1 auth path. Option B (identity-api JWT) becomes a Phase 2.5 task. Option C is rejected unless A + B both fail.

**Pre-W2 prerequisite**: identity-api adds Privy JWT verifier port + adapter. This is **T2.5** in identity-api Phase 2 (auth-adjacent; operator review gate). Delegated agent's queue.

### Privy JWT verification spec (v0.3 NEW — per flatline SKP-003 HIGH 735)

T2.5 deliverable: `packages/adapters/auth/privy-jwt-verifier.ts`. Spec:

| Field | Requirement | Why |
|-------|-------------|-----|
| **Issuer (`iss`)** | MUST equal `privy.io` (exact match) | Prevents tokens from non-Privy issuers being accepted |
| **Audience (`aud`)** | MUST equal cubquests's Privy app ID (configured via `PRIVY_APP_ID` env var) | Prevents tokens issued for other Privy apps being replayed |
| **Authorized Party (`azp`)** | MUST equal cubquests's Privy app ID (same as aud) | Defense-in-depth against token-swap attacks |
| **Subject (`sub`)** | MUST be present (Privy user ID) | Required for caller identification |
| **Expiration (`exp`)** | MUST be in the future + within max 24h skew | Standard JWT TTL check + reject expired |
| **Issued-at (`iat`)** | MUST be in the past (with 5min clock skew) | Reject tokens issued in the future (clock-skew attack) |
| **JWKS cache** | Cache Privy JWKS keys for 24h; refresh on key-not-found | Avoid hammering Privy's JWKS endpoint; Privy rotates keys per their docs |
| **Key rotation** | When `kid` not in cache, refetch JWKS once + retry; if still not found, 401 + log | Handle Privy's planned key rotation gracefully |
| **Replay protection (`jti` denylist)** | OPTIONAL for V1 (Privy tokens are short-lived; replay window is small); REQUIRED for V2 if longer-lived tokens introduced | Trade-off: jti-denylist adds Redis dependency; Privy 24h TTL is already a soft replay-window |
| **Audit log** | Every verification event logged: success / failure-reason / wallet / iat / exp / source-IP | Forensics + abuse detection |

Implementation references: existing identity-api JWKS validator at `packages/adapters/jwks-validator/` (good pattern to fork); jose library for JWT parsing + verification.

### S2S auth — identity-api → score-api (v0.3 NEW — per flatline SKP-004 HIGH 750)

identity-api's compose orchestrator calls score-api over HTTP. Currently no S2S auth is specified — score-api accepts anonymous reads on its production API. This is acceptable today because score-api's V1 API is intentionally public read; if score-api ever tightens to API-key-gated, identity-api needs an auth path.

**v0.3 doctrine**: even though score-api accepts anonymous V1, identity-api MUST attach a service-identifier header (`X-Service-Identity: identity-api@<version>`) + correlation-ID (`X-Request-ID: <uuid>`) on all outbound calls. Score-api logs these for forensics. If score-api ever introduces API-key auth, the migration is: identity-api gets a `SCORE_API_KEY` secret + attaches `Authorization: Bearer <key>` on outbound calls.

Tracking item for V2: identity-api ↔ score-api mutual TLS OR shared-secret S2S auth model (composes with cluster-wide service-mesh decision; not blocking W2 V1).

## Non-goals (kept out of W2)

- ❌ Badge issuance / mint-api integration — that's W3 (CM-awards-badge); requires mint-api runtime + activities-api HTTP shim
- ❌ Inventory display (holdings) — separate composition; W3+ territory
- ❌ Activity timeline — needs activities-api HTTP; that's pending
- ❌ Auth on cubquests — cubquests already uses Privy; identity-api here is read-only (`/v1/profile` accepts walletAddress query, not requires JWT in v1)
- ❌ Backfill of midi_profiles → identity-api spine — Phase 4 T4.4 territory; W2 reads from empty spine cleanly (returns identity NOT FOUND → degraded shape)
- ❌ Custom-domain swap to `identity.0xhoneyjar.xyz` — still queued behind DNS; W2 uses the Railway URL directly
- ❌ Honey-road mibera-dimensions — Phase 3 territory; W2 is generic-score-only

## Architecture

### Compose path (read-side only) — v0.3 RECONCILED (per flatline SKP-001 CRIT 880)

**v0.3 RECONCILIATION**: v0.2 had a contradiction — Auth model said "extract walletAddress from JWT server-side" but Architecture still showed `?wallet=<addr>` URL query param. v0.3 resolves: the URL has NO walletAddress query param; the wallet is exclusively extracted from the verified Privy JWT claims server-side. For CM-admin viewing OTHER users (W3+ territory), a separate `/v1/profile/{wallet}` route with explicit auth gate will be added.

1. cubquests profile page (`/profile/[address]` route in cubquests-interface) renders for an authenticated user
2. Server-action attaches the user's Privy JWT to the outbound request via Authorization: Bearer header. Calls SDK: `client.profile.getMine()` (NO walletAddress argument — wallet derived from JWT server-side)
3. SDK hits `GET https://identity-api-production-317b.up.railway.app/v1/profile` (no query params)
   - identity-api middleware verifies Privy JWT via Privy's JWKS endpoint (cached)
   - Server-side extracts `walletAddress` from `linkedAccounts[type=wallet]` in the JWT claims
   - 401 returned if JWT invalid / expired / missing
4. identity-api's `composeProfile()` orchestrator (T2.2-landed):
   - Phase 1 (parallel via Promise.all): fetch inventory + score
   - Phase 2 (sequential): codex if Mibera tokens present (skipped if not)
   - Per-source timeouts: score = 300ms (NFR-1 800ms p95 target met)
   - Circuit-breaker per source (5 failures / 60s window / 30s cooldown)
5. Returns `ProfileResp` (sealed Zod schema in `packages/protocol/src/api/profile.ts`) with `identity` + `score` + `inventory` + `codex` + `degraded[]`
6. cubquests renders the score; identity is the spine pointer; inventory + codex hidden in v1 (W3+ surfaces)

### No-wallet-linked state (v0.3 NEW — per flatline SKP-005 HIGH 720)

Some cubquests users may have a Privy session but NO linked wallet (e.g., email-only sign-in). For these users, `linkedAccounts[type=wallet]` is empty → server-side wallet extraction fails → /v1/profile returns 422 with `{ error: "no_wallet_linked" }`.

UI behavior in cubquests:
- Profile page detects 422 + renders a "Link a wallet to see your score" prompt with a CTA to Privy's wallet-link flow
- After wallet link, page refetches + renders score normally
- This is **expected behavior** — not a degraded state. The user is in a known intermediate state; the UX guides them through.

Tracking item for V2: when identity-api spine backfill lands (Phase 4 T4.4), the spine becomes populated; this no-wallet state will become rarer but won't disappear (email-only signups still happen).

### Four integration tasks (v0.3 — T2.5 INTEGRATED per flatline SKP-002 HIGH 760)

| Task | Where | Estimate | Notes |
|------|-------|----------|-------|
| **T2.5** Privy JWT verifier port + adapter | identity-api building (`packages/adapters/auth/privy-jwt-verifier.ts` + port spec in `packages/ports/auth.ts`) | medium (~2-3h) | NEW prerequisite — must land BEFORE T2.3. Spec in §Privy JWT verification above. Auth-adjacent: operator review gate. Tests against Privy's well-known JWKS endpoint. |
| **T2.3** GET /v1/profile route (Hyper) | identity-api building (`packages/api/src/routes/profile.ts`) | small (depends on T2.5) | Wires T2.2's composeProfile orchestrator to an HTTP route. JWT auth via T2.5 verifier middleware. No URL query params; wallet from JWT. Operator review gate. |
| **T2.4** SDK profile method | identity-api building (`packages/sdk/src/client.ts`) | small | Add `client.profile.getMine()` method to the source-distributed SDK (accepts no walletAddress arg — wallet comes from JWT). Tests against the live endpoint. Autonomous. |
| **W2-1** cubquests profile integration | cubquests-interface | small | Vendor the SDK; add a server-action that attaches Privy JWT to outbound call + invokes `client.profile.getMine()`; render `data.score` on the existing profile component; handle no-wallet-linked state (see Architecture step 5). |

**Sequencing**: T2.5 → T2.3 (T2.3 depends on Privy verifier existing) → T2.4 (parallel with T2.3 OK; tests light up after both land) → W2-1 (after all three identity-api tasks land).

T2.3-T2.5 are identity-api Phase 2 tasks (delegated agent's queue). W2-1 is cubquests-interface work — separate coordinator cycle would dispatch it.

## Sequence

```
Phase 2.A (identity-api, delegated agent)
   T2.3 GET /v1/profile route        ── operator review gate (auth-adjacent)
   T2.4 SDK profile method            ── autonomous

W2 cutover (cubquests-interface, separate coordinator cycle)
   W2-1.1 Vendor @0xhoneyjar/identity SDK into cubquests-interface
   W2-1.2 Add server-action src/lib/identity-api/client.ts
   W2-1.3 Wire client.profile.get() into /profile/[address] page
   W2-1.4 Render score on profile (additive — no UI regression)
   W2-1.5 Smoke-test against staging URL
   W2-1.6 Deploy

Validation
   Real cubquests user loads their profile → sees their score
   identity-api Railway logs show /v1/profile traffic from cubquests
   score-api logs show score lookups from identity-api compose
```

## Dependencies

- **Hard**: identity-api Phase 2 T2.3 + T2.4 land (operator-gate for T2.3; autonomous for T2.4)
- **Hard**: identity-api production deploy stays live (currently green at `identity-api-production-317b.up.railway.app`)
- **Hard**: score-api production stays live (it has for months; high confidence)
- **Soft**: custom domain swap (`identity.0xhoneyjar.xyz`) — nice for cubquests config, not required (Railway URL works)
- **Soft**: cubquests-interface coordinator (`~/bonfire/cubquests-w2-coordinator/`) — could spin up via `/coord` skill from construct-freeside when ready

## Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| identity-api spine is empty until Phase 4 T4.4 backfill | HIGH (it's the current state) | Compose orchestrator returns degraded shape: identity=null, score=score-api-result, render accordingly ("Score available; profile sync pending"). Triggers the backfill cycle naturally. |
| Score-api API surface drift between SDK author + cubquests integration | MEDIUM | Score-api has a 1255-line typed client already (per Explore A 2026-05-25); the surface is stable. Identity-api's federation client (T2.1) consumes it via typed ports. |
| cubquests-interface auth assumes Privy JWT, not wallet address | MEDIUM | W2 v1 uses walletAddress (already exposed in cubquests user object via Privy `linkedAccounts.find(a => a.type === 'wallet')`). JWT-based read is v2. |
| SDK vendor recipe is operationally heavy for cubquests-interface | LOW | 6-step recipe in `identity-api/packages/sdk/README.md`; Agent-validated 2026-05-25. ~15 min mechanical. |
| Network latency from cubquests Vercel → identity-api Railway → score-api adds >800ms | LOW | NFR-1 target = 800ms p95 from compose orchestrator; cubquests adds Vercel edge cache layer; net likely <1s. Profile pages are not user-blocking surfaces. |
| Pattern B (vendored SDK with schema copies) breaks if SDK schema evolves | LOW | The vendor recipe pins source SHA; cubquests re-vendors on intentional update. Same model as identity-api v1 source-distribution lock-in. |

## Success metrics

- **Functional**: cubquests user loads `/profile/<their-address>` → sees score (or "score syncing" if identity spine is empty)
- **Latency**: profile page p95 < 1.5s (compose 800ms p95 + cubquests Vercel render 500-700ms)
- **Reliability**: degraded shape never crashes the page; score-api 404 = render "—"; compose timeout = render "—" + log
- **SDK validation**: cubquests-interface ships with `@0xhoneyjar/identity` vendored; no codegen; no npm publish; pinned source SHA documented

## Composition with cluster doctrine

- Validates **HEXAGONAL FEDERATION D-3 (wax walls)** — cubquests consumes identity-api via sealed Zod schemas + typed SDK, not raw HTTP
- Validates **D-5 (federation discovery)** — identity-api is the central station's first non-internal consumer
- Validates **D-6 (belt direction)** — score → identity-api (compose) → cubquests (presented); one-way arrow
- Validates **D-8 (dashboard composition / marketplace UI)** — cubquests-interface IS a presented-layer world consuming federation cells
- Dogfoods **W2 as the smallest reliable wedge** — proves the cluster composes BEFORE attempting W3 (full CM-awards-badge cycle)

## What W2 unlocks (downstream)

- **W3 (badge wedge)** has half its scaffolding already: identity-api → compose; cubquests → consume. Adds mint-api runtime adapter + activities-api HTTP shim + badge issuance UI.
- **CM Dashboard evolution** (score-dashboard → Freeside Dashboard) has the SDK-vendor pattern proven. Future cells (activities-api, mint-api, inventory-api when they ship runtime) slot into the same `buildCohort()` fan-out idiom score-dashboard already uses.
- **Identity-api as cluster authority** validated in production — every future cell wanting to identify a user routes through this same surface.

## Open questions for operator

1. **Cubquests coordinator timing** — spin up `~/bonfire/cubquests-w2-coordinator/` after T2.3 + T2.4 land, OR have the cubquests maintainer pick up W2-1 directly via their existing flow?
2. **W2-1 push gate** — autonomous if mechanical (vendor SDK + add component), OR operator review gate (cubquests is L4 production, 10K+ users — even cosmetic changes deserve review)?
3. **Domain swap timing** — wait for `identity.0xhoneyjar.xyz` DNS resolution before W2 ships, OR ship with Railway URL + swap later (one-line config change)?
4. **Anonymous probe** — should cubquests anonymous visitors (no wallet connected) see a different surface, or just hide the score panel? UX detail; not blocking the architecture.

## Status

**Proposed.** Ready for operator GO. T2.3 + T2.4 (the identity-api Phase 2 prerequisites) are queued for the delegated agent; W2-1 (cubquests integration) needs its own coordinator cycle once Phase 2 lands.

## References

- [ADR-009 · Freeside Hexagonal Federation](../../decisions/009-freeside-hexagonal-federation.md) — composition + harness doctrine
- [identity-api Phase 1 memory](https://github.com/0xHoneyJar) (`project_identity-api-phase1-complete`)
- identity-api PRD v3.0 at `loa-freeside/grimoires/loa/prd.md` — the spine + compose doctrine
- identity-api building at `~/Documents/GitHub/freeside-auth` (registry slug: identity-api)
- score-api at `~/Documents/GitHub/score-api` (L4 production)
- cubquests-interface at the cubquests repo (L4 Vercel; 10K+ users)
- W3 (deferred): "CM awards OG Verifier badge" — the badge wedge; bigger; 3-4 cycles work
