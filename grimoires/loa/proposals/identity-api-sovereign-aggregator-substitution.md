---
title: identity-api as sovereign auth aggregator — substitution roadmap for Dynamic + Privy
status: proposed
date: 2026-05-26
author: soju (via mad-agent synthesis cluster-meta cycle 2026-05-25/26)
review_requested: operator (zerkereth)
related:
  - decisions/009-freeside-hexagonal-federation.md (ADR-009 — cluster topology)
  - grimoires/loa/cycles/cycle-w2.5-cluster-auth-custody-substrate/ (W2.5 — service-to-service substrate)
  - https://github.com/0xHoneyJar/identity-api/issues/11 (multi-method user-facing entry epic)
  - https://github.com/0xHoneyJar/mibera-honeyroad/issues/104 (mibera.0xhoneyjar.xyz consolidation)
  - grimoires/freeside-network/cluster-2026-05-25-operator-dash/ (the diagnostic that surfaced this)
domain: shared (cross-cluster substrate + cross-product presentation)
---

# identity-api as sovereign auth aggregator

## Reframing the question (MAY-LATITUDE-3)

Operator framing 2026-05-26: *"the compounding constraints we've faced around authentication"* + *"profiles across many worlds that we need to backfill"* + *"migrate our auth across the board"* + *"once Dynamic finally decides to kick us out and W2.5 is done executing then we can converge."*

The honest reframe of that ask isn't "convergence" — convergence implies things growing together. What we're actually doing is **sovereign substitution**: replacing two vendor auth aggregators (Dynamic SDK + Privy) with cluster-owned identity primitives. Dynamic + Privy are forcing functions (deprecation timing uncertain but inevitable); identity-api is the sovereign substitute we're standing up to absorb their role. The "convergence" is the moment substitution completes.

Calling it substitution-not-convergence matters because:
- **Convergence** suggests building something compatible with Dynamic that smoothly merges. We aren't.
- **Substitution** is honest about the asymmetry: we own identity-api; Dynamic owns Dynamic. Their kick-out timer is the constraint.

This proposal lays out the substitution roadmap.

## The compounding constraints (what we've actually been hitting)

| # | Constraint | Today's state |
|---|---|---|
| 1 | **Multiple consumer apps each with own Dynamic config** | 9 confirmed: mibera-honeyroad, mibera-interface, mibera-dimensions, apdao-auction-house, henlo-interface, hub-interface, honey-interface, internal-dashboard, fat-bera-interface |
| 2 | **Per-app user tables uncoordinated with spine** | midi_profiles (mibera) backfilled 3/192; other apps not surveyed; each likely has its own user table + Dynamic linkage |
| 3 | **Spine is empty for almost everyone** | 4 spine users total / ~thousands of Dynamic users across all apps |
| 4 | **Dynamic deprecation date uncertain but real** | "once Dynamic finally decides to kick us out" — forcing function not under our control |
| 5 | **Privy considered then rejected** | Operator decision 2026-05-26: own the substrate, don't substitute one vendor for another |
| 6 | **identity-api can't claim SoT until multi-method entry exists** | issue #11 — wallet-only + email + OAuth + phone + passkey still missing |
| 7 | **Service-to-service auth substrate not ratified** | W2.5 cycle authored but not yet executed (9 sprints, ~27 working days) |
| 8 | **Cross-world identity reconciliation is unbuilt** | Same human across mibera + henlo + apdao + ... has no canonical identity today |
| 9 | **DNS sprawl mirrors auth sprawl** | mibera.0xhoneyjar.xyz (legacy AWS ECS for Dynamic SSO cookie-domain) + honeyroad.xyz (Vercel current) — same product, two surfaces |
| 10 | **The diagnostic surface only exists for one product** | freeside-operator-dash + Soju-lens covers identity-api+honey-road; no cross-world equivalent |

The pattern: every consumer app reinvented auth + profile-table + name-resolution locally because no sovereign substrate existed. Each reinvention added a constraint. Substitution removes constraints by collapsing the sources of truth.

## Three sequenced phases

### Phase α — Presentation-layer migration (NOW; in parallel with W2.5)

**Goal**: each consumer app uses identity-api as the source of display name + identity, regardless of where authentication happens.

**Pattern** (proven 2026-05-26 with mibera-honeyroad PRs #102 + #103):

```
app's navbar/profile hook
  → /api/identity/nym?wallet=…  (client-safe Next.js route)
  → server-side fetchWorldNym(wallet)
  → identity-api SDK client.profile.get({world, wallet})
  → identity.world_identities[world].nym
  → display name (with shortened-address fallback)
```

**Per-app deliverables** (9 apps):

| App | World slug | Profile source to backfill | Migration status |
|---|---|---|---|
| mibera-honeyroad | `mibera` | midi_profiles (backfilled 3/192; 189 wallet-only blocked on issue #11) | ✅ PRs #102, #103 merged |
| mibera-interface | TBD (likely `mibera` shared) | survey needed | not started |
| mibera-dimensions | TBD (likely `mibera` shared) | survey needed | not started |
| apdao-auction-house | new world `apdao` | survey needed | not started |
| henlo-interface | new world `henlo` | survey needed | not started |
| hub-interface | new world `hub` | survey needed | not started |
| honey-interface | new world `honey` (or `thj`) | survey needed | not started |
| internal-dashboard | new world `thj-internal` | THJ team only | not started |
| fat-bera-interface | new world `fat-bera` | survey needed | not started |

**Backfill substrate per world**:
1. Add a row in `identity-api/worlds` for the world slug
2. Map the app's local profile table → `world_identity.nym` claims (mirroring `backfill-world-identities.ts` from this cycle)
3. Wherever possible, also map wallet → spine via `linkVerifiedWallet` (limited to users with all three fields today; **issue #11 Phase 1 closes the wallet-only gap for the majority**)

**Presentation-layer change per app**: copy the navbar pattern from mibera-honeyroad PR #102 (3 files: `lib/identity/world-nym.ts` + `app/api/identity/nym/route.ts` + `lib/hooks/use-user-profile.ts`).

**Phase α does NOT touch auth.** Dynamic still authenticates. We're only re-sourcing the DISPLAY NAME from identity-api. This is the safest, fastest layer to move first — purely additive, no risk to login flows.

### Phase β — Multi-method entry (after Phase α + identity-api #11 Phase 1)

**Goal**: identity-api accepts every authentication method users would use, producing canonical spine rows.

**Per identity-api #11**:
- Phase 1 (wallet-only entry — closes the 189-user gap exposed by mibera-honeyroad's navbar regression)
- Phase 2 (Privy-shaped methods: email, OAuth Twitter/GitHub/Google, phone, passkey)
- Phase 3 (cross-method identity reconciliation — same human linking multiple methods)
- Phase 4 (JWT session model across all surfaces)

**During Phase β**: dual-stack auth across consumer apps. Dynamic + identity-api in parallel. Users authenticate via Dynamic (still); identity-api ALSO captures their identity via a side-channel link call. Verify cross-coverage via the operator-dash's cross-world Soju-lens (extended per Phase α).

### Phase γ — Substrate convergence (after W2.5 ships + Dynamic forcing function)

**Goal**: Dynamic deprecated across all 9 apps; identity-api is sole auth surface.

**Sequencing constraint**: Phase γ cannot start until:
- **W2.5 substrate cycle complete** (svc-JWT for service-to-service; ~27 working days from start)
- **identity-api #11 Phase 2+ shipped** (multi-method entry covers Dynamic's user surface)
- **Phase α complete for all 9 apps** (presentation layer pre-migrated; user names already source from identity-api)
- **Dynamic kick-out timer fired** (their deprecation announcement is the trigger)

**Per-app deliverables** (in deprecation order, hardest-to-easiest):
1. Replace Dynamic SDK with identity-api auth modal/widget
2. Migrate session storage from Dynamic JWT cookie to identity-api JWT (sharing parent `0xhoneyjar.xyz` cookie-domain — what Dynamic was already doing)
3. Replace Dynamic's wallet-prompt with identity-api SIWE flow
4. Remove `@dynamic-labs/ethereum` dep + cleanup
5. Verify via cross-world Soju-lens (no Dynamic resolution path appears in identity-api spine)

**Substrate side**:
- Service-to-service calls (between apps + cells) authenticate via W2.5 svc-JWT (not via shared API keys)
- Audit events for every spine write + denylist for emergency revocation
- mibera.0xhoneyjar.xyz subdomain consolidation (mibera-honeyroad #104) — once Dynamic's cookie-domain dependency is gone, the AWS ECS deployment can be torn down or repointed at Vercel

## The cross-world Soju-lens (the diagnostic that makes this safe)

The freeside-operator-dash currently shows one human's identity across {identity-api spine, identity-api compose, identity-api mibera-dims, honey-road consumer}. This pattern extends naturally to:

```
SOJU-LENS · cross-world identity reconciliation

surface              field          observed              source
─────────────────────────────────────────────────────────────────
identity-api spine   user_id        ae0558c7-…            /v1/resolve/wallet/0x…
mibera world         nym            "soju"                identity.world_identities[mibera]
henlo world          nym            "soju"                identity.world_identities[henlo]
apdao world          nym            (none)                identity.world_identities[apdao]
hub world            nym            "soju.dev"            identity.world_identities[hub]
thj-internal world   nym            "Soju"                identity.world_identities[thj-internal]
…
DISCREPANCY on `nym`: "soju" vs "soju.dev" vs "Soju" across worlds
MISSING on `nym` in apdao: wallet exists in spine but no world_identity claim
```

This becomes the durable verification surface for every migration step in Phases α/β/γ. Each cell's migration is "green" only when the dash shows the user resolving consistently across all worlds.

The current single-world Soju-lens (shipped 2026-05-26 in loa-freeside PR #223) IS the prototype for this. Extending to multi-world is a small loa-freeside follow-up sprint — the operator-dash's `apps/freeside-operator-dash/src/soju-lens.ts` already abstracts the surface array; adding more worlds is config, not new architecture.

## What I want to push back on (MAY-LATITUDE-5)

1. **The temptation to "fix Dynamic" instead of substituting it.** Every consumer app could just upgrade Dynamic, configure cookie-domain better, etc. That's the easy path. It's also a dead-end because Dynamic owns the timeline. Substitution is the right work even though it's harder.

2. **The temptation to delay until W2.5 ships.** W2.5 unblocks service-to-service substrate. Phase α (presentation layer) does NOT depend on W2.5 — it's a pure read against identity-api which already exists. Starting Phase α now (while W2.5 is being built) is the right parallelism. We did it for honey-road; we should do it for the other 8 apps in parallel with W2.5 execution.

3. **The 189-user regression as a forcing function for #11 Phase 1.** Right now the navbar shows shortened addresses for 189 users — they lost their `*.bera` ENS names without gaining their canonical nym. That's user-visible. The proper fix (issue #11 Phase 1 — `linkWalletOnly`) should land before any other app moves to Phase α, otherwise we propagate the regression. Or alternative: temporarily reintroduce ENS fallback while #11 Phase 1 is in flight.

4. **Don't over-architect the cross-world Soju-lens.** It's a config change to existing code, not a new system. Don't make it a separate cycle. Add the worlds to the dash's probe list as each world's data lands.

## Sequence + rough timing

```
NOW
├── Cluster-meta cycle 2026-05-25/26 (this work)  ✅ DONE
├── identity-api PR #11 Phase 1 (linkWalletOnly + 189-user backfill)  ~3 days
├── W2.5 sprint 1 (architecture decisions ratified)  ~2.5 days
└── Phase α survey: map each app's world + profile table  ~2 days [parallel]

WEEK 2
├── Phase α: 1-2 apps migrate navbar to identity-api (pattern proven)  ~3 days/app
├── W2.5 sprints 2-4 (S1 svc-JWT primitive)  ~7.5 days
└── identity-api #11 Phase 2 spec authoring  ~3 days

WEEK 4-6
├── Phase α: remaining 6-7 apps migrate  ~3 days/app (parallel-eligible if multiple operators)
├── W2.5 sprints 5-9 (S2 ACL template, S3 multisig, S4 HMAC, S5 saga)  ~15 days
└── identity-api #11 Phase 2-3 implementation  ~10 days

DYNAMIC KICK-OUT FIRES
├── Phase γ executes across all 9 apps (deprecate Dynamic SDK)
├── mibera-honeyroad #104 subdomain consolidation
└── Privy is never adopted; cluster owns auth substrate end-to-end
```

**Critical-path bottleneck**: identity-api #11 Phase 1 + 2. Without these, Phase γ can't start because users can't authenticate without Dynamic. W2.5 is parallel-eligible with #11; they don't block each other.

## What this enables (the future-state worth aiming at)

When this substitution completes:
- **Sovereign identity substrate**: every THJ user has one canonical identity across all worlds. No vendor in the dependency tree.
- **Cross-world product composition**: a user's mibera nym appears in henlo automatically; their apdao nym appears in hub. The cluster-meta layer can reason about humans, not addresses.
- **Cluster substrate primitives published** (per W2.5): future products inherit svc-JWT + ACL template + multisig runbook + HMAC + saga. No reinvention.
- **Diagnostic substrate generalized** (per cross-world Soju-lens): identity drift, schema drift, deployment drift all visible in one operator-facing surface. The freeside-operator-dash becomes the cluster's nervous system.
- **Vendor optionality**: if Privy or Dynamic ship something compelling later, we can re-evaluate. Not from a position of lock-in but from a position of substrate sovereignty.

## Mad-agent ai stuff the operator might not have language for yet

A few patterns this work seeds that go beyond auth:

1. **Sovereign aggregator substitution as a doctrine.** Every cluster of vendor-aggregated services (auth, RPC, indexing, file storage, mempool simulation, …) follows the same shape: vendor exists because cluster lacks substrate; build substrate; substitute; vendor becomes optional. This is the meta-pattern. Worth a separate ADR after this cycle proves it.

2. **The diagnostic surface as the migration substrate.** The Soju-lens didn't just diagnose the BERA→Soju bug; it BECAME the verification harness for every step of the substitution. Future substrate work (RPC substitution, indexer substitution) should start by extending the operator-dash with the new dimension. The dash isn't a tool; it's the cluster's empirical-truth surface.

3. **Worlds as identity scopes, not products.** ADR-009 treats worlds as data-bound entities (mibera world = mibera product data). But once identity-api has world_identity for {mibera, henlo, hub, apdao, thj-internal, …}, "world" becomes the identity-scope namespace — same human, different names per world. This is the substrate that lets you build a "social fabric across THJ products" without re-aggregating profiles per-product.

4. **The forcing-function shape**: Dynamic kicking us out isn't a problem; it's the substrate-shaping pressure. If Dynamic kept us forever, we'd never own the auth substrate. Every vendor deprecation is a substrate opportunity. Document this as cluster doctrine — *vendor sunset is substrate sovereignty's catalyst.*

## Open questions to operator

1. Should Phase α start for app N+1 before identity-api #11 Phase 1 ships? (i.e., propagate the 189-user-regression shape to the next app, or wait?)
2. Are all 9 apps actually moving to identity-api, or should some be deprecated entirely instead (e.g., honey-interface ↔ honeyroad.xyz redundancy)?
3. Cross-world nym uniqueness — within `henlo` world, nym uniqueness is enforced. ACROSS worlds, is "soju" allowed to be different people in different worlds? (The current schema permits this — `UNIQUE(world_slug, nym)`. Worth a deliberate decision before scaling.)
4. Timeline for cross-world Soju-lens (the dash extension) — fold into this cycle or separate small follow-up?
5. Phase α first-mover after honey-road: mibera-dimensions (closest world overlap with mibera) OR an unrelated app like apdao (proves the pattern generalizes)?

## Anchors

- Cluster-meta cycle 2026-05-25/26: `grimoires/freeside-network/cluster-2026-05-25-operator-dash/README.md`
- W2.5 cycle: `grimoires/loa/cycles/cycle-w2.5-cluster-auth-custody-substrate/`
- identity-api #11: https://github.com/0xHoneyJar/identity-api/issues/11
- mibera-honeyroad #104: https://github.com/0xHoneyJar/mibera-honeyroad/issues/104
- ADR-009 §D-2 (worlds) + §D-5 (federation): `decisions/009-freeside-hexagonal-federation.md`
- Diagnostic surface: `apps/freeside-operator-dash/` (loa-freeside main; PR #223 merged)
