---
title: TEND audit — mint-announcement integration + API-surface convergence baseline
cycle_type: cluster-meta (per ADR-009 §D-7)
date: 2026-05-26
mode: TEND (gecko-shaped OBSERVATION — surfaces findings, names gaps, does not decide)
construct_frame: gecko (observation) + construct-freeside/KRANZ (potential execution downstream)
operator_intent: "strengthen our substrate · foundation for the API surfaces · continuity for future Loa awareness"
status: artifact — review before any /coord dispatch
anchors:
  - decisions/009-freeside-hexagonal-federation.md (ADR-009 — cluster topology + D-7 cluster-meta cycle type)
  - grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md (sibling roadmap)
  - https://github.com/0xHoneyJar/inventory-api/issues/1 (Stash bring-back coord stub)
  - https://github.com/0xHoneyJar/freeside-characters/issues/87 (cycle-008 S9 enriched digest)
  - ~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md (ACVP parent — events pillar)
  - ~/vault/wiki/concepts/substrate-mental-model-for-product-builders.md (NATS-vs-Kafka naming correction)
---

# TEND audit — mint announcement integration + cross-world API surfaces

> **Goal** (per operator framing 2026-05-26): strengthen substrate baseline + create Loa-continuity awareness across 5 cells so future sessions can ground in known state. **Foundational, not directive** — names what is, flags what's missing, surfaces operator decisions to make.

## Executive summary

| Surface | Deployed? | Active? | Gap for mint-announcement | Gap for cross-world substrate |
|---|---|---|---|---|
| freeside-sonar | ✅ live (Envio 3.0, 4-chain indexer) | ✅ weekly commits | ❌ NO outbound event bridge — handlers write Envio DB only, no NATS publish | ⚠ Token entity unimplemented (per-token ownership list) — blocks inventory-api live mode |
| freeside-characters | ✅ live (ruggy primary) | ✅ #87 enriched digest shipped in code | ❌ NO event subscriber (cron-only — weekly digest, weaver, micros) | ⚠ Identity-api consumed but only in compose path; ZERO direct Discord-trigger from on-chain events |
| inventory-api | 🟡 npm-package only — NOT Hyper HTTP, NOT MCP-tenant | 🟡 cycle-005/006 dormant (last touch 2026-05-26 rename commit) | n/a (enrichment cell, downstream) | ⚠ Blocked on sonar Token entity (live mode returns empty `tokenIds`); fail-soft works but no live data |
| identity-api | ✅ live (Phases 1-4 deployed) | ⚠ ZERO worlds issue Freeside tenant JWTs (per README) | n/a (enrichment cell, downstream) | ⚠ 4 spine users; 189 wallet-only midi users blocked behind discord_id (identity-api #11 Phase 1) |
| NATS (cluster) | ✅ infrastructure deployed (JetStream + EFS + TLS) | ⚠ dual-bus (RabbitMQ legacy + NATS new) — cutover state UNCLEAR (loa-freeside #200 open) | ❌ NOT wired for sonar→characters | ✅ ready to carry ACVP events pillar once cells are taught to publish/subscribe |

**The one-sentence**: every cell exists; every cell is gecko-healthy in isolation; **the substrate that joins them — NATS-as-events-pillar — is deployed but not consumed**. Mint-announcement requires teaching sonar to publish + characters to subscribe + both to do so under an ACVP-conformant envelope.

## Per-surface audit (the grounded state)

### freeside-sonar — EVM event indexer

- **Repo**: `~/Documents/GitHub/freeside-sonar`
- **Framework**: Envio 3.0.0-alpha.14
- **Chains**: Berachain (primary), Ethereum mainnet, Optimism, Base
- **Recent activity**: 10 commits in May 2026; last commit 2026-05-19 `perf(berachain): explicit hypersync_config`
- **Handlers registered**: 27 modules (HoneyJar 1-5, Honeycomb, MoneycombVault, AquaberaVault, CrayonsFactory, CrayonsCollection, TrackedErc721, GeneralMints, MiberaStaking, PaddleFi, CandiesMarket1155, CubBadges1155, MiberaPremint, MiberaSets, PuruApiculture1155, MiberaZora1155, MirrorObservability, FriendtechShares, MiladyCollection, MiberaLiquidBacking, MiberaCollection, Seaport, FatBeraDeposits, FatBeraAccounting, BeaconDeposit, BlockRewardController, AutomatedStake, ValidatorWithdrawalModule, ValidatorDepositRouter, BgtToken, SFVaultERC4626, SFMultiRewards, SFVaultStrategyWrapper, HenloVault, TrackedErc20)

**MST naming chain (operator correction 2026-05-26):**
- `mibera_vm` = `Mibera Shadows` = `Mibera VM (Virtual Mibera)` = "the Vending Machine"
- Contract: `0x048327A187b944ddac61c6e202BfccD20d17c008` (Berachain)
- Already indexed at `config.yaml:750` + `src/handlers/mints.ts` (`handleGeneralMintTransfer` — mint detection via from=0x0) + `src/handlers/vm-minted.ts` (`handleVmMinted` — custom event enriching MintEvent with encoded traits)
- MintEvent shape: `{id, collectionKey, tokenId, minter, timestamp, blockNumber, transactionHash, chainId, encodedTraits}`

**The data-flow gap (load-bearing finding):**

```
Berachain block → Envio handler → context.MintEvent.set(...) → Envio Postgres
                                                                      ↓
                                                                  STOPS HERE
```

Zero outbound: no NATS publish, no webhook POST, no EventEmitter. The handlers are PURE WRITES to Envio's managed DB. `grep -r "webhook\|emit\|publish"` on src/ returns only Envio-routing files. This means **no downstream cell can react in real-time to a sonar-detected mint**. Today's consumption is GraphQL-pull only.

**Secondary gap**: the `Token` entity (per-token ownership index — "wallet 0x123 owns tokens [5, 42, 99]") is NOT published. Documented at `inventory-api/docs/sonar-ownership-gap.md`. Sonar publishes aggregate counts (`MiberaStaker.currentStakedCount`, `TrackedHolder.tokenCount`) but not the ordered token list a UI needs. ADR-008 declares this is sonar's responsibility but blocks inventory-api live mode.

### freeside-characters — Discord bot + 9 character apps

- **Repo**: `~/Documents/GitHub/freeside-characters`
- **Characters**: ruggy (primary live), satoshi, akane, kaori, mongolian, nemu, ren, ruan + bot
- **Recent activity**: 2026-05-24 last commit (`test(persona-engine): align preview-adapter mirror test`)
- **Cycles**: 003, 005 (ruggy-leaderboard), 006 (substrate-presentation), 007 (agent-debuggability), 008 (persona-substrate)
- **Open issues**: 8 (most-flagged: #87 cycle-008 S9 enriched-digest-in-prod, #95 daily-digest blocked, #85 schema retire local types.ts, #20 codex MCP gated on construct-mibera-codex#69)

**Announcement pipeline shape — cron-pull, NOT event-push**:
- Entry: `apps/bot/src/discord-interactions/server.ts:47-91` Bun HTTP listener on `INTERACTIONS_PORT=3001`
  - `GET /health`
  - `POST /webhooks/discord` (slash commands, Ed25519-verified)
- Scheduler: `packages/persona-engine/src/cron/scheduler.ts:83-110`
  - Weekly digest (Sunday UTC 00:00)
  - Weaver weekly mid-week (Wednesday UTC noon)
  - Pop-in random — REMOVED 2026-05-23 per operator prune; replaced with planned event-driven micro (scheduler.ts:114-120 reservation comment)
- Per-zone lock prevents concurrent fires (zoneLocks map, `withZoneLock`)

**Consumption today:**
- Sonar: ❌ NO direct consumption — no sonar import in characters
- Inventory-api: ✅ YES — `packages/persona-engine/src/orchestrator/inventory/resolve-nft-pfp.ts` does lazy dynamic import of `@0xhoneyjar/inventory` (npm path in dev, gateway-routed in prod), 3s timeout, fail-soft fallback to identity-api db pfp/handle
- Identity-api: ✅ YES — consumed in compose path (per-world nyms surfaced through `composeForCharacter`)

**Enriched digest state (cycle-008 #87):**
- Renderer DONE: `buildEnrichedDigestComponentsV2(zoneDigest)` at `packages/persona-engine/src/preview/adapters/discord/rich-render.ts`
- Production wire NOT done: needs `DIGEST_SURFACE` config flag + canary + Pattern-B/discord.js Components V2 plumbing across 3 `deliverZoneDigest` branches
- Composer interception point identified — has ZoneDigest, can call new renderer

### inventory-api — sovereign inventory cell

- **Repo**: `~/Documents/GitHub/inventory-api` (renamed from freeside-inventory 2026-05-26 commit `6733467`)
- **Maturity**: Cycle-1 skeleton, `cycle_state: candidate`
- **Deployment**: ❌ NOT Hyper HTTP, NOT MCP-tenant — npm package only (`@freeside/inventory`)
- **Open**: #1 `[coord] cycle-006 Bring back the Stash — sovereign inventory wiring` (coord stub pointing at mibera-honeyroad master)

**API surface (npm package only)**:
- `getHoldings(address, options?)` → `{holdings: ContractHolding[], completeness: envelope}` (ACVP envelope shape — `{as_of_block, holder_count, source, complete, degraded}`)
- `getNftsForOwner(address, contract, options?)` → paginated NFTs + metadata
- `getNftMetadata(contract, tokenId)` → single metadata doc
- Built with viem + zod + ethereum-cryptography; no HTTP runtime

**Modes**:
- Live mode (`SONAR_GRAPHQL_ENDPOINT` env set): queries sonar GraphQL — but returns `{tokenIds: []}` because of the Token-entity gap
- Hermetic mode (default): bundled test fixtures

**Master plan**: per `mibera-honeyroad/grimoires/loa/sprint.md` — this is **cycle-005 Effect Substrate Foundation** (NOT cycle-006). S1 (substrate scaffolding) shipped; S2-S4 (live impls, canary flip, Alchemy decommission) DEFERRED to cycle-006 — gated on operator-side Envio NftOwnership entity + chain_meta singleton (per S0 PoC decision tree). Last touch 2026-05-25 16:33 UTC.

### identity-api (freeside-auth) — sovereign identity SoR

- **Repo**: `~/Documents/GitHub/freeside-auth` (local dir name unchanged; remote = identity-api)
- **Status**: Phases 1-4 deployed (per `project_identity-api-substrate-deployed.md` memory + operator confirmation 2026-05-26)
- **Production URL**: `https://identity.0xhoneyjar.xyz` (Railway + custom domain CNAME applied 2026-05-25/26)
- **Endpoint surface**: `/health`, `/v1/auth/challenge`, `/v1/auth/verify`, `/v1/me`, `/v1/resolve/wallet/{address}`, `/v1/resolve/account/{provider}/{externalId}`, `/v1/resolve/nym/{worldSlug}/{nym}`, `/v1/identity/{userId}`, `/v1/profile?world=mibera`, `/v1/mibera/dimensions`, `/v1/link/verified-wallet` (POST)
- **Spine users**: 4 (operator, zerker, jani + 1 other)
- **World identities**: 3 (mibera world: soju, zerker, jani)
- **Open**: #11 multi-method auth epic, #8 BB review follow-ups, #3 keychain subpath export, #2 zone:auth boundary

**Key consumed-by-zero-worlds finding** (Explore agent surfaced from README): Freeside JWKS infrastructure exists in `loa-freeside/apps/gateway` (Rust runtime) but ZERO worlds issue Freeside tenant JWTs. Each app (ruggy, honeyroad, etc.) authenticates independently. Identity-api is a **foundation awaiting adoption** — adoption opt-in is `compose_with: freeside-auth` in a world's manifest.

### NATS cluster state — events-pillar substrate

- **Infrastructure**: `loa-freeside/infrastructure/terraform/nats.tf`
- **Shape**: NATS JetStream (stateful broker) on ECS Fargate + EFS persistence (30-day → IA transition) + TLS (self-signed CA, secrets-manager-rotated)
- **Network**: Private VPC, SG ports 4222 (client) / 6222 (cluster) / 8222 (monitoring)
- **Monitoring**: CloudWatch + Grafana dashboard (`nats-dashboard.json`)
- **Service discovery**: DNS-based (Service Connect rejected per `nats.tf:525` Envoy TCP issue)

**Consumption today**:
- Worker app has dual-mode entries: `apps/worker/src/main.ts` (amqplib/RabbitMQ legacy) + `apps/worker/src/main-nats.ts` (nats.js)
- Gateway-shard inbound → NATS (per `apps/worker/tests/integration/nats-flow.test.ts`)
- BullMQ for synthesis + reaper queues
- **Production cutover state**: UNCLEAR per drift-report.md + trajectory-audit.md — both buses are live, the operator-facing "which is canonical" answer isn't documented
- **Open tracker**: `loa-freeside #200` — "Complete NATS cutover and decommission RabbitMQ" (~$41/mo savings)

**Vault naming correction** (`~/vault/wiki/concepts/substrate-mental-model-for-product-builders.md:73`): the operator + Gemini conversation 2026-05-03 called the messaging mesh "NATS" but the Hounfour schema layer (`loa-hounfour/src/schemas/domain-event.ts:36`) uses Kafka three-segment topic naming (`{aggregate}.{noun}.{verb}`). Production broker IS NATS JetStream; the schema convention borrows Kafka's topic-shape language. Both names refer to the same SUBSTRATE concept (async typed pub/sub).

## Integration map — current vs intended for mint-announcement

### CURRENT

```
Berachain mint (Transfer from=0x0 on 0x048327...c008)
     │
     ↓
freeside-sonar/handlers/mints.ts:handleGeneralMintTransfer
freeside-sonar/handlers/vm-minted.ts:handleVmMinted
     │
     ↓
Envio Postgres (MintEvent entity written)
     │
     ↓
[STOPS — no outbound bridge]


[PARALLEL · weekly cron pull]
freeside-characters/scheduler.ts (Sunday UTC 00:00)
     │
     ↓ composeForCharacter
     ↓ (lazy import inventory-api for pfp)
     ↓ (compose-path identity-api lookup for nym)
     │
     ↓ deliverZoneDigest (Pattern B webhook OR bot OR legacy)
     │
     ↓
Discord zone channels (stonehenge, mecca, tower, grove)
```

### INTENDED (mint-announcement event-driven flow)

```
Berachain mint
     ↓
freeside-sonar handler
     ↓ (NEW: outbound publish step)
     ↓
NATS JetStream subject: mibera.shadow.minted.v1 (or similar 3-segment)
     │  └── ACVP envelope: {prev_hash, sig, payload, …}
     ↓
freeside-characters NATS subscriber (NEW)
     ↓ kansei router decides: announce or skip
     ↓ enrich:
        ├─ identity-api /v1/profile?world=mibera&wallet=<minter>  → nym or shortened address
        └─ inventory-api /v1/inventory/wallet/<minter>            → token #, traits, image
     ↓ render via existing Pattern-B/discord.js webhook path
     ↓
Discord announcement: "🌸 soju just minted Mibera Shadow #234 [trait: …]"
```

**4 net-new builds**:
1. sonar outbound publish layer (handler → NATS JetStream)
2. ACVP-envelope schema for sonar events (per [[agentic-cryptographically-verifiable-protocol]] 7-component substrate)
3. characters NATS subscriber + kansei threshold router
4. discord announcement template + per-zone routing decision

## NATS as the ACVP events pillar (FAANG-level positioning)

Per `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md` the ACVP substrate has 7 components:

> Agents reason · Substrate verifies · **Hashes prove** · **Events trace** · Tests bind.

| ACVP component | What it does | Cluster instantiation today |
|---|---|---|
| Reality | Canonical state at any tick | Envio Postgres (sonar) + Railway Postgres (identity-api spine + midi_profiles) |
| Contracts | Typed interfaces declaring what's allowed | Effect.Schema (loa-freeside) + Zod (cells) + Hyper route types |
| Schemas | Content-shape validators (cross-runtime) | Hounfour schemas (cross-cell wire) + per-cell Drizzle/Zod |
| State machines | Transition tables | Per-cell domain code (sonar mint handlers, characters scheduler, identity-api spine) |
| **Events ⚡** | **Observable trace of every state mutation** | **MISSING for cross-cell — sonar writes are local; characters fires from cron not events** |
| Hashes 🔒 | Content addressing + tamper detection | Partial — cycle-098 audit envelope in Loa framework, NOT yet applied to sonar→characters events |
| Tests | Invariants asserted, golden replays | Per-cell test suites; cross-cell integration tests sparse |

**The architectural insight**: NATS infrastructure is deployed. ACVP doctrine names "Events" as the trace-the-mutations pillar. **Wiring sonar to publish ACVP-enveloped events on JetStream + cells to subscribe = giving the cluster its FIRST cross-cell events pillar.** Without this, the cluster's substrate is structurally sound per-cell but invisibly coupled (cron pulls, GraphQL pulls, lazy imports) — no audit trail across the seams.

FAANG-level reasoning per the vault doc's mental-model framing:
- **You already know smart contracts emit events → blockchain indexers index them.** That's the EVM events-pillar pattern.
- **The substrate equivalent**: cluster cells emit typed DomainEvents → NATS subjects carry them → other cells subscribe + react. Three-segment topic naming (`{aggregate}.{noun}.{verb}`) per `loa-hounfour/src/schemas/domain-event.ts:36`.
- **The cryptographic-verifiability layer**: each event carries an ACVP envelope (prev_hash + sig + JCS-canonicalized payload). cycle-098 L1-L7 audit envelope work in the Loa framework is the prior-art shape; sonar's outbound publish should adopt it.

**Why this matters for steering**: every future cell-to-cell integration (sonar→characters, inventory→characters, identity-api → score → characters, …) becomes a one-step "subscribe to this subject + decode the envelope" operation. The substrate is *built once, inherited forever* — which is exactly what W2.5 service-to-service auth substrate + identity-api #11 multi-method entry are doing for AUTH. NATS-as-events-pillar is the third leg of that table.

## 5 sharp findings worth carrying forward as Loa-continuity substrate

### F1 — Sonar's pure-index model is the load-bearing gap

- **Surfaced from**: Explore agent survey of `freeside-sonar/src/handlers/*.ts` + `EventHandlers.ts`
- **Statement**: every sonar handler is a pure write (`context.<Entity>.set()`) into Envio's managed Postgres. NO outbound bridge (NATS publish, webhook, HTTP POST). The cluster's first event pillar requires adding this layer.
- **NOT a sonar bug**: this is ADR-008 sonar's declared responsibility (index events, serve via GraphQL). Adding an outbound publisher is a NEW responsibility being introduced.
- **Continuity note**: any future Loa session reasoning about real-time cross-cell reactions must know sonar today is read-only-via-GraphQL.

### F2 — The Token-entity gap blocks inventory-api live mode universally

- **Surfaced from**: `inventory-api/docs/sonar-ownership-gap.md` + Explore agent inventory survey
- **Statement**: sonar doesn't publish a per-token ownership index. Inventory-api's `getNftsForOwner` returns `{tokenIds: []}` in live mode for everyone. The fail-soft is loud (`degraded: true` flagged) but UI gets no list. This blocks ANY UI showing "all NFTs owned by wallet X" — including the Stash bring-back.
- **Continuity note**: this is the canonical gate item for cycle-006 stash work. ETA depends on operator-side Envio entity authoring.

### F3 — identity-api is foundation-with-zero-adoption

- **Surfaced from**: Explore agent reading `freeside-auth/README.md:L30-32`
- **Statement**: Freeside JWKS infrastructure runs in `loa-freeside/apps/gateway` (Rust). ZERO worlds issue Freeside tenant JWTs today. Each consumer app authenticates independently. Identity-api is architecturally mature but consumed only as a read-API for nym lookups (compose-path).
- **Continuity note**: the multi-method auth epic (identity-api #11) is the substrate that makes adoption desirable. Until #11 ships, world manifests opting into `compose_with: freeside-auth` get a thin surface.

### F4 — Enriched digest renderer ready but cron-only; event-driven micros are reserved-not-built

- **Surfaced from**: `freeside-characters/packages/persona-engine/src/cron/scheduler.ts:114-120` + #87 issue body
- **Statement**: cycle-008's `buildEnrichedDigestComponentsV2` works and is operator-validated 5/5 ("this one is so good"). Production wire (canary + Components V2 flag + Pattern-B delivery) NOT done. The scheduler explicitly reserves `event-driven pop-in` (line 115) as the future hook for real-time NATS subscriber + kansei router — not yet built.
- **Continuity note**: mint-announcement integration plugs into THIS slot. Cycle-008 #87 + new NATS subscriber + kansei router converge in scheduler's event-driven branch.

### F5 — NATS infrastructure deployed but worker cutover state undocumented

- **Surfaced from**: `infrastructure/terraform/nats.tf` + `apps/worker/src/{main,main-nats}.ts` + drift-report.md
- **Statement**: NATS JetStream is live; worker has dual-bus (RabbitMQ + NATS) entry points. Per drift-report.md the cutover state isn't documented. Before any sonar→NATS event bridge work, the production-bus answer needs to be confirmed (env vars? Helm values? operator decision?). Loa-freeside #200 tracks RabbitMQ decommission.
- **Continuity note**: NATS work CAN proceed against the deployed JetStream broker, but operator should validate the dual-bus state before designing the publish pattern (else risk publishing into a deprecated bus).

## Cross-world substrate convergence (the bigger frame)

This audit composes with the [sovereign aggregator substitution roadmap](../../loa/proposals/identity-api-sovereign-aggregator-substitution.md). NATS-as-events-pillar is the **service-plane** analog of the identity-api substitution (user-plane). Both are sovereign-substrate substitutions for vendor patterns:

| Plane | What it replaces | Cluster substrate | Adoption pattern |
|---|---|---|---|
| User-facing auth | Dynamic SDK, Privy | identity-api (#11 multi-method) | `compose_with: freeside-auth` in world manifest |
| Cell-to-cell auth | Per-cell HMAC | svc-JWT primitive (W2.5 cycle) | `@0xhoneyjar/auth` import + cell API key |
| **Cross-cell events** | **Per-cell GraphQL/HTTP polling** | **NATS JetStream + ACVP envelope (this audit's named gap)** | **Subscribe to subject + decode envelope** |
| On-chain RPC | Alchemy, Infura | (future — RPC aggregation cell?) | (future) |
| Indexer | Goldsky, The Graph | freeside-sonar (own indexer) | direct GraphQL or NATS subscription |

The "sovereign aggregator substitution" doctrine extends here: vendor-pattern (REST polling) → substrate (NATS events) → adoption (cell subscribers). Same shape as auth.

## Recommended /coord dispatch shapes (operator decides ordering)

### Shape A — Single cluster-meta cycle: "cluster events pillar"

One coordinator at `~/bonfire/cluster-events-coordinator/`. Master plan in `loa-freeside/grimoires/freeside-network/cluster-events-pillar/{prd,sdd,sprint}.md`. Per-cell beads dispatched into:
- freeside-sonar — author outbound publish layer + ACVP envelope adapter
- freeside-characters — author NATS subscriber + kansei threshold router
- loa-freeside — author shared `@0xhoneyjar/events` library (envelope schema + publisher + subscriber helpers)
- mibera-honeyroad / world worlds — opt-in subscribers (later)

**Pros**: substrate-clean, named pattern future cells inherit. **Cons**: bigger upfront cycle (~3-4 sprints).

### Shape B — Two coords running in parallel

- **Coord 1**: Stash resume (inventory-api DEP-2/DEP-3 from mibera-honeyroad cycle-005/006 deferred) — gated on operator-side Envio Token entity. Existing master plan, just needs sonar gap closed first.
- **Coord 2**: Sonar outbound publisher MVP — direct NATS publish on mint events, no envelope, no kansei router. Characters subscribes, posts to one Discord channel. Crude but visible.

**Pros**: ships visible value fast (mint announcements within a sprint). **Cons**: substrate skipped — when we later want envelope/replay/audit, retrofit.

### Shape C — TEND-then-decide (current default)

Don't dispatch yet. Surface this audit + the 7 operator questions below. Iterate to clarity. Then choose A or B.

## 7 operator questions (the rigor before /coord)

1. **NATS bus state** — production-canonical: RabbitMQ or NATS today? (loa-freeside #200 still open; cutover state per worker dual-mode is undocumented)
2. **ACVP envelope adoption** — should sonar→characters events ship with the full cycle-098 envelope shape (prev_hash + sig + JCS), or start with raw typed payloads and add envelope later? (substrate-clean vs YAGNI tradeoff)
3. **Token-entity gate** — is the operator-side Envio NftOwnership work in flight, scheduled, or unstarted? This is the gate for inventory-api live mode + the Stash bring-back. Cycle-005 S2-S4 wait on it.
4. **Mint announcement scope** — only Mibera Shadows (`0x048327...c008`) for v1, OR every TrackedErc721 that sonar already indexes? Per F1, sonar adding publish is per-handler work — narrow scope = quick win; broad scope = substrate pattern earned faster.
5. **Kansei router placement** — should the "which mints get announced, with what voice" decision live in characters (cron-pull pattern preserved + extended) or in a dedicated "kansei-router" cell that sits between sonar publisher and characters subscriber? (locus-of-decision question)
6. **Stash resume timing** — kick the inventory-api DEP-2/DEP-3 work now (parallel with events-pillar work) OR sequence after events pillar lands (inventory-api itself can subscribe to NATS events for invalidation)?
7. **First-world subscriber** — once sonar publishes + cluster events pillar ships, which world gets the FIRST consumer wire? freeside-characters (operator's stated focus), mibera-honeyroad (closest data dependency), or score-dashboard (broadest cluster-meta visibility)?

## Loa-continuity memory promotions to consider

Per operator framing ("continuity is important here, Straylight"), these are the memory entries this audit suggests promoting from ai-derived to operator-validated (operator decides):

- **mst-naming-chain** — MST = Mibera Shadows = Mibera VM = "Vending Machine" = `0x048327A187b944ddac61c6e202BfccD20d17c008`. Same thing, 4 names. Future Loa sessions should not be confused again.
- **sonar-is-pure-index** — sonar has no outbound bridge today; any real-time cluster reaction is the WORK, not the assumption.
- **token-entity-gap** — the inventory ownership-gap blocks Stash + any "all NFTs owned by wallet" UI universally; ETA controlled by operator-side Envio work.
- **nats-deployed-but-unconsumed** — JetStream is live, dual-bus state unclear, ready to carry ACVP events once cells learn to publish/subscribe.
- **acvp-events-pillar-positioning** — NATS in this cluster IS the ACVP events pillar; sonar adding publish = giving cluster its first events trace.

## Anchors (for next Loa session)

- This audit: `grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md`
- Sibling roadmap (auth-substitution): `grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md`
- Cycle-005/006 master plan: `~/Documents/GitHub/mibera-honeyroad/grimoires/loa/sprint.md`
- ACVP doctrine: `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md`
- NATS naming correction: `~/vault/wiki/concepts/substrate-mental-model-for-product-builders.md`
- 9 Dynamic consumer apps from prior cycle: see sovereign-aggregator-substitution.md
- Cluster-meta cycle prior art: `grimoires/freeside-network/cluster-2026-05-25-operator-dash/` (the diagnostic surface that surfaced the BERA→Soju gap)

---

*Audit completed via gecko-shape OBSERVATION on 2026-05-26. No decisions made. Operator surfaces direction via the 7 questions; KRANZ (construct-freeside) executes the chosen shape downstream. Future Loa sessions should ground in this artifact before any cross-cell cycle work.*
