---
title: Build Doc — Events Pillar v1 (sonar NFT mints → NATS → characters)
cycle: cluster-events-pillar-v1
cycle_type: cluster-meta (per ADR-009 §D-7)
date: 2026-05-26
mode: ARCH + craft (Ostrom structural + ACVP events-pillar)
status: ready-to-coord (operator decisions baked in 2026-05-26)
author: GECKO (observation) + KRANZ (execution) embodied
prerequisite_audit: grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md
sibling_roadmap: grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md
review_requested: operator (before any /coord dispatch)
---

# Build Doc — Events Pillar v1 · sonar NFT mints → NATS → characters

> The cluster's FIRST cross-cell events trace. Operator-named "the substrate that lets us announce when MST / Vending Machine / Mibera Shadows mints land." Architecturally it's much more — the events-pillar instantiation of ACVP that all future cell-to-cell integrations inherit.

## Context

Sibling to the auth-substitution roadmap (loa-freeside PR #225 merged). Where that closes the **user-plane** (Dynamic / Privy → identity-api), this closes the **service-plane events seam** (per-cell HTTP polling → NATS JetStream + ACVP envelope). Same shape, same doctrine: vendor-pattern → substrate → adoption.

The TEND audit (`cluster-2026-05-26-mint-announcement-tend/audit.md`) ground-truthed: every cell exists, every cell is healthy in isolation, NATS infrastructure is deployed — but the substrate that joins them across cells isn't wired. Adding the events pillar lights up the whole cluster.

**Operator framing of v1 (2026-05-26)**: prove NATS works fluidly across **a focused subset (Mibera handlers + PuruPuru only)** before scaling substrate-universal. *"What we're trying to do is prove that the NATS system is something that we can get comfortable with and works fluidly for our systems. It helps me as an operator be able to see events across them and operate these clusters with good uptime + debuggability."*

This reframes the primary deliverable: **the operator-dash event-trace panel (Sprint 3) IS the success criterion**, not the Discord announcements. Discord announcements (MST-only) are the visible canary that proves the substrate flows correctly to a real consumer; the dash is the operator's daily awareness surface.

## Run via — `coordinating-cross-repo` (REQUIRED · KRANZ act 1)

@~/bonfire/construct-freeside/skills/coordinating-cross-repo/SKILL.md

→ master coordinator at `~/bonfire/cluster-events-pillar-coordinator/` · cockpit + per-cell beads + headless agent dispatch on the next READY task · GitHub-as-bus per ADR-009 §D-5 · one-loa-per-repo. The build loops through Coordinate → Mirror → Verify → Flip → Distill (KRANZ 5-act per ADR-009 §D-12).

## Load order (read in this sequence)

1. **`~/bonfire/construct-freeside/skills/coordinating-cross-repo/SKILL.md`** — the driving composition + KRANZ rails
2. **`grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md`** — the substrate baseline (per-surface state + 5 findings)
3. **`grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md`** — sibling roadmap (user-plane substitution; this is service-plane analog)
4. **`~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md`** — ACVP doctrine (the 7-component substrate; events pillar is what we're wiring)
5. **`~/vault/wiki/concepts/substrate-mental-model-for-product-builders.md`** — NATS vs Kafka naming correction + Hounfour 3-segment topic convention
6. **Memory entries** (read in order):
   - `project_acvp-events-pillar-positioning.md` — the architectural framing
   - `project_sonar-is-pure-index.md` — the load-bearing gap
   - `project_nats-deployed-but-unconsumed.md` — infrastructure state
   - `project_mst-naming-chain.md` — naming disambiguation
   - `project_token-entity-gap.md` — the Stash-blocking gap (NOT a blocker for this cycle — see Operator Clarifications)
7. **`decisions/009-freeside-hexagonal-federation.md`** §D-5 (federation discovery), §D-7 (cluster-meta cycle), §D-12 (KRANZ execution + gecko observation frames)
8. **`apps/worker/src/main-nats.ts`** + **`infrastructure/terraform/nats.tf`** — concrete NATS-client reference + deployed broker config

## Operator decisions baked in (2026-05-26)

| Decision | Resolution | Implication |
|---|---|---|
| **NATS bus state** | Target NATS JetStream (verified `ecs-finn.tf`/`ecs-dixie.tf` NATS_URL); no RabbitMQ legacy buildout | Publisher + subscriber both write JetStream-native |
| **ACVP envelope shape** | Full cycle-098 L1-L7 envelope from v1 — `prev_hash` + Ed25519 sig + JCS canonicalization | Substrate-clean from day one; future cells inherit verifiability free |
| **Publishing scope (SUBSTRATE)** | **Mibera handlers + PuruPuru only for v1** — prove NATS works fluidly for "our systems" before scaling breadth. Operator framing 2026-05-26: *"keep its scope to simply the Mibera handlers within that Sonar API. I think you can include Mibera as well as PuruPuru, and the other ones we can keep for later."* | Focused proof-of-concept; v2 extends substrate to other handlers when a consumer demands it |
| **Display/announcement scope (CONSUMPTION)** | **MST-only for v1 enriched announcement** in characters | Even narrower than publish scope — Mibera/PuruPuru events flow on NATS, but only MST surfaces in Discord v1 |
| **Operator's v1 success criterion** (operator framing) | *"prove that the NATS system is something that we can get comfortable with and works fluidly for our systems. Helps me as an operator see events across them and operate clusters with good uptime + debuggability."* | The DASH (Sprint 3) is the primary deliverable, not Discord announcements — observability earns the right to scale substrate later |
| **Mad-agent extension** | **Operator-dash event panel — IN SCOPE** for this cycle (sibling to Soju-lens shape) | Observability is foundational; dash extension lands with the substrate |
| **Stash sequencing** | Events pillar FIRST, Stash AFTER | inventory-api stays npm-only this cycle; subscribes to NATS later for cache invalidation |
| **Token-entity gap (NEW finding)** | Does NOT block this cycle — `getNftMetadata(contract, tokenId)` is per-token lookup, not wallet enumeration; sonar mint event provides both args | Mint announcement enrichment works today |
| **Doc granularity** | Single build doc this kickoff; **coord-init authors PRD/SDD/sprint** if a 9-sprint cluster-cycle pattern is needed once dispatched | Don't pre-author the master plan; let coord init via /sprint-plan when fresh-session opens |
| **Dispatch timing** | **NOT in this session — fresh session for /coord** | Clipboard pointer prepared for handoff |

## Operator clarifications captured

- The Token-entity gap (per `project_token-entity-gap.md`) blocks `getNftsForOwner` (wallet→tokens enumeration). It does NOT block `getNftMetadata(contract, tokenId)` because mint events provide both args directly from the sonar handler payload. **This cycle is unblocked.** The gap remains a blocker for Stash bring-back (which IS wallet enumeration), to be addressed in a follow-up cycle.

## Persona

- **Primary**: KRANZ (construct-freeside) — cross-repo execution + KRANZ 5-act methodology (Coordinate · Mirror · Verify · Flip · Distill). Load `~/bonfire/construct-freeside/identity/KRANZ.md` if present.
- **Ongoing lens**: gecko (BEAUVOIR) — observe drift across cells during execution; surface findings without overriding KRANZ decisions.
- **Hivemind Laboratory operating posture** (per ADR-009 §D-10): constructs emit canonical `hivemind:` labels; surface user truth + confidence; **never recommend or decide**.

## What to build (in order)

### 1. NEW: `@0xhoneyjar/events` npm package (lives in loa-freeside `packages/events/`)

The shared library every cell publishes/subscribes through. **One built, N inherited.** This is the substrate seed.

**Shape**:
```typescript
// packages/events/src/envelope.ts
export const EventEnvelopeSchema = z.object({
  // Identity
  event_id:       z.string().uuid(),
  event_type:     z.string(),                    // 3-segment: "mibera.shadow.minted.v1"
  schema_version: z.literal("acvp-l1-v1"),
  emitted_by:     z.string(),                    // cell slug: "sonar-api"
  emitted_at:     z.string().datetime(),

  // ACVP cycle-098 L1 envelope
  prev_hash:      z.string().length(64),         // sha256 of prior envelope (per-publisher chain)
  payload_hash:   z.string().length(64),         // sha256 of canonical-JSON payload
  signing_key_id: z.string(),                    // kid for verifier lookup
  signature:      z.string(),                    // Ed25519 sig over (prev_hash + payload_hash)

  // The actual event data (typed per event_type)
  payload:        z.unknown(),                   // validated against per-event schema by subscriber
}).strict();
```

**Plus**:
- `publishEnvelope({nats, subject, payload, signer, prevHashStore})` — async; canonicalizes payload via JCS (RFC 8785); computes hashes; signs; publishes; updates per-publisher prev_hash store.
- `subscribeEnvelope({nats, subject, schema, jwksUrl, handler})` — async; subscribes; verifies sig + prev_hash continuity + schema; calls handler with typed payload.
- `EventTopic` helpers for the Hounfour 3-segment naming: `nft.mint.detected.v1`, `nft.mint.detected.{collection-slug}.v1`, etc.
- Per-event Zod schemas (start with `NftMintDetectedSchema`).
- `Ed25519` signer abstraction (matches cycle-098 L1 `LocalEs256Signer` pattern; JWKS hosted from `loa-freeside/apps/gateway` per ADR-009 §D-5).

**Pattern to follow**: `loa-freeside/packages/beacon-schema/src/` — same Effect.Schema-then-Zod shape, same workspace publish convention. ALSO the cycle-098 L1 audit envelope in the Loa framework (`.claude/scripts/audit-envelope.sh` + canonical JCS) is the prior-art shape — adopt verbatim where possible.

### 2. UPDATE: freeside-sonar — add NATS publish layer

Each NFT mint handler (currently `handlers/mints.ts:handleGeneralMintTransfer` + `handlers/vm-minted.ts:handleVmMinted` + adjacent handlers covering all `TrackedErc721` NFT collections) gets ONE new line:

```typescript
// after context.MintEvent.set(...)
await publishEnvelope({
  nats: ctx.nats,
  subject: `nft.mint.detected.${collectionSlug}.v1`,
  payload: {
    chain_id, contract, token_id, minter,
    block_number, transaction_hash, timestamp,
    encoded_traits: vmEnrichment?.encodedTraits,  // when available (MST handler)
  },
  signer: ctx.signer,
  prevHashStore: ctx.prevHashStore,
});
```

**File-by-file** (Sprint 2 v1 scope — **Mibera family + PuruPuru only**):
- `src/handlers/vm-minted.ts` — MST handler publish (subject: `mibera.shadow.minted.v1`)
- `src/handlers/mints.ts` — `handleGeneralMintTransfer` publish for Mibera-family contracts only (gate by collection slug allowlist)
- `src/handlers/mibera-sets.ts` (if exists) — Mibera Sets publish
- `src/handlers/mibera-zora.ts` (if exists) — Mibera Zora 1155 publish
- `src/handlers/mibera-liquid-backing.ts` (if exists) — Mibera Liquid Backing publish
- `src/handlers/mibera-collection.ts` (if exists) — main Mibera collection publish
- `src/handlers/purupuru-apiculture-1155.ts` (or similar — PuruApiculture1155 per config.yaml) — PuruPuru publish

Per-handler change is the SAME line ⤵
```typescript
// after context.<Entity>.set(...)
await publishEnvelope({
  nats: ctx.nats,
  subject: <derive-from-collection>,    // e.g. "mibera.shadow.minted.v1"
  payload: { /* event-shaped */ },
  signer: ctx.signer,
  prevHashStore: ctx.prevHashStore,
});
```

**Universal substrate wiring (per-handler-context, applies to all handlers)**:
- `src/EventHandlers.ts` — wire NATS connection + per-publisher signer at handler-context construction (universal; not per-handler)
- `package.json` — add `@0xhoneyjar/events` workspace dep
- `config.yaml` — add `NATS_URL` + `NATS_TLS_CA` env wiring (matches `ecs-finn.tf` pattern)
- Tests: golden-replay fixture per handler asserting publish was called with envelope-shaped payload (DON'T assert on real NATS — mock)

**Operator scope correction (2026-05-26 update)**: this cycle ships **Mibera handlers + PuruPuru only** to **prove NATS works fluidly for "our systems"**. Other handlers (vault, staking, marketplace, DeFi, HoneyJar, crayons, badges, fat-bera, etc.) **wait for v2** when an actual consumer demands them. Operator's success criterion is "operator-dash event panel shows Mibera/Puru events flowing, gives me debuggable cluster awareness" — not "every cell publishes everything."

**Explicit out-of-scope handlers for v1** (do NOT add publish to these):
- HoneyJar (HJ1-5Eth, Honeycomb, MoneycombVault) — community-NFT but not Mibera/Puru
- Vaults (Aquabera, SF-vaults) — DeFi class
- Staking (MiberaStaking is borderline — operator can include or exclude; default: include since name-prefixed Mibera)
- Marketplace (Crayons, Seaport, MiladyCollection, FriendtechShares, CandiesMarket1155) — non-Mibera-family
- DeFi (FatBera, PaddleFi, validator/BGT)
- Badges (CubBadges1155) — non-Mibera-family
- TrackedErc721 — leave as-is

**Operator decision needed at coord-init**: MiberaStaking publish — in (Mibera-family prefix) or out (different event class)? Default include.

### 3. NEW: freeside-characters NATS subscriber (`packages/persona-engine/src/events/`)

```typescript
// subscribes to nft.mint.detected.*.v1 + verifies envelope + routes through kansei
export async function startMintEventSubscriber(opts: { nats, jwksUrl, kanseiRouter, discordClient }) {
  await subscribeEnvelope({
    nats: opts.nats,
    subject: "nft.mint.detected.>",       // wildcard catch-all NFT mints
    schema: NftMintDetectedSchema,
    jwksUrl: opts.jwksUrl,
    handler: async (payload) => {
      const decision = await opts.kanseiRouter.route({
        eventType: "nft.mint",
        payload,
        thresholds: await loadKanseiThresholds(),
      });
      if (decision.announce) {
        await announceMint({
          discordClient: opts.discordClient,
          channelId: decision.channelId,
          payload,
          // enrichment fetched inside announceMint
        });
      }
    },
  });
}
```

**Composes with** the scheduler's reserved event-driven slot (`scheduler.ts:114-120` — the "cycle-008 slice 2a" comment). This is the substrate that slot was reserved for.

### 4. UPDATE: freeside-characters scheduler — wire event-driven branch

In `packages/persona-engine/src/cron/scheduler.ts`, replace the reserved-not-built `pop-in random` slot with `startMintEventSubscriber` invocation at bot boot. The cron paths (Sunday weekly digest + weaver mid-week) remain unchanged. Event-driven micros are the NEW addition.

### 5. UPDATE: freeside-characters announcement template + enrichment

```typescript
// announceMint internals
async function announceMint({ payload, discordClient, channelId }) {
  // enrichment — parallel-fetch, fail-soft
  const [metadata, identity] = await Promise.allSettled([
    inventoryApi.getNftMetadata(payload.contract, payload.token_id),
    identityApi.profile.get({ world: "mibera", wallet: payload.minter }),
  ]);

  const displayName = identity.status === "fulfilled"
    ? identity.value.identity?.world_identities?.find(w => w.world_slug === "mibera")?.nym
      ?? shortenAddress(payload.minter)
    : shortenAddress(payload.minter);

  const metadataPayload = metadata.status === "fulfilled" ? metadata.value : null;

  const message = buildEnrichedMintAnnouncement({
    displayName,
    collection: deriveCollectionDisplay(payload.contract),
    tokenId: payload.token_id,
    imageUrl: metadataPayload?.image,
    traits: metadataPayload?.attributes,
    txHash: payload.transaction_hash,
  });

  await discordClient.channels.fetch(channelId).then(ch => ch.send(message));
}
```

**Components V2** rendering style matches the enriched digest renderer from cycle-008 (#87) — `buildEnrichedDigestComponentsV2` is the prior-art; this new path mirrors its shape for mint events.

### 6. **IN SCOPE** (operator-confirmed 2026-05-26): extend operator-dash with NATS event-trace panel

This is the **loop closure** — the observability counterpart to the substrate. Operator: *"Yes I do want to see an event panel very similar to how we have it here in the Soju-lens Operator dashboard. That one has been pretty helpful. Observability is something that we want to include here."*

The freeside-operator-dash (loa-freeside PR #223 merged) already shows per-cell health + Soju-lens cross-surface identity reconciliation. Add a NEW panel:

**Panel: Cluster Events Trace**

- Subscribes to NATS via a debug-fanout subject (`>` catch-all OR per-class wildcards: `nft.mint.detected.>`, `vault.deposit.>`, etc.)
- Renders the live event stream — last N envelopes per class, with verification status (sig valid? prev_hash chain unbroken? schema valid?)
- Per-publisher prev_hash chain visualization (broken chain = tamper or outage — same shape as the Soju-lens discrepancy detection)
- Per-cell publish-rate sparkline + last-event timestamp
- Click an envelope → expand to see raw payload + envelope metadata (for operator debug)
- Filter by event class + cell-of-origin

**Implementation pattern** (per the existing operator-dash architecture):
- New file: `apps/freeside-operator-dash/src/events-trace.ts` — server-side NATS subscriber + in-memory ring buffer (last 200 envelopes)
- New route: `GET /api/events` returns the buffer as JSON
- New panel in `apps/freeside-operator-dash/src/render.ts` — table + per-class filter + verification badges
- Reuses existing operator-dash Hono shape; same `apps/freeside-operator-dash/` workspace; same Vercel/Railway deploy slot

**Mad-agent positioning** (the bigger frame): every future cluster-meta cycle reaches for the operator-dash first to ground. Extending it with the events trace means **the dash becomes the cluster's empirical-truth-substrate** — a primitive for substrate sovereignty itself. Same architectural significance as the cross-world Soju-lens extension proposed in the sovereign-aggregator-substitution roadmap.

**Sprint placement**: Sprint 4 (after substrate publish + characters subscriber + canary land in Sprints 1-3). The dash extension consumes the same NATS infrastructure but doesn't gate the substrate work.

## Design rules (Alexander craft lens)

- **Topic naming**: Hounfour 3-segment minimum, 4-segment for collection-bound: `nft.mint.detected.v1` (catch-all) + `nft.mint.detected.{slug}.v1` (per-collection). Versioned suffix is non-negotiable — future schema evolution requires a v2 subject alongside v1.
- **ACVP envelope**: prev_hash chain is **per-publisher** (sonar-api has its own chain; characters maintains a separate ack chain if it republishes). JCS canonicalization for payload hash; Ed25519 sig over `prev_hash || payload_hash`. JWKS at `apps/gateway` JWKS endpoint (per cycle-098 + ADR-009 §D-5).
- **Fail-soft**: NATS down → sonar handlers still write to Envio Postgres (existing path unchanged); publish failure is logged but doesn't crash the handler. Characters subscriber resilient to broken prev_hash chain — surfaces drift via operator-dash, doesn't crash bot.
- **TLS**: All NATS connections client-cert authenticated (per `nats.tf` SEC-4.4 TLS CA in secrets manager). NEVER plaintext.
- **Identity fallback chain**: identity-api nym → shortened address (NEVER ENS — per the auth substitution roadmap, ENS is excised from THJ surfaces).
- **Schema migrations**: every change to a payload schema requires a NEW versioned subject (`v2`); subscribers must coexist v1 + v2 during a rollover window of ≥ 30 days; sonar publishes both during overlap.

## What NOT to build

- ❌ NOT a RabbitMQ migration layer (operator: no legacy buildout for freeside)
- ❌ NOT the Stash bring-back (sequenced AFTER this cycle per operator decision)
- ❌ NOT a multi-method auth wiring (separate cycle — identity-api #11)
- ❌ NOT cross-world nym uniqueness enforcement (separate, per the sovereign-aggregator roadmap Q3)
- ❌ NOT subscribers in honey-road / score-dashboard / other worlds — characters is the FIRST subscriber; world subscribers come per-world later
- ❌ NOT NON-NFT event publishing (vault deposits, staking, score updates) — NFT mints prove the pattern; other event classes adopt later
- ❌ NOT a re-author of the cycle-005/006 Effect substrate work — that's its own pending cycle

## Verify

```bash
# 1. Library publishes correct envelope
cd packages/events && pnpm test
# Expect: golden-replay fixture matches; envelope verifies; broken-sig caught

# 2. Sonar publishes on mint
# Trigger a real Mibera Shadow mint on Berachain → observe sonar log → NATS subject receives envelope
# OR run integration test with NATS test container

# 3. Characters subscribes + renders
# Bot boots → subscribeMintEvents starts → trigger via NATS publish → Discord channel sees announcement

# 4. ACVP envelope verifies end-to-end
# Capture envelope on subject; pipe through @0xhoneyjar/events verifier; assert prev_hash chain valid + sig valid + payload matches schema

# 5. (If mad-agent extension shipped) operator-dash shows live event stream
curl http://localhost:3030/api/events/recent  # JSON stream of last N envelopes
```

## /coord dispatch shape — proposed

### Master coordinator
- Path: `~/bonfire/cluster-events-pillar-coordinator/`
- Master plan: this build doc + `prd.md` + `sdd.md` + `sprint.md` (operator can author from this build doc, or skip and use this directly as the spec)
- Beads tagged `cycle:events-pillar-v1` with `[repo:loa-freeside]` / `[repo:freeside-sonar]` / `[repo:freeside-characters]` per task

### Child cycle stubs (one per cell-repo)
- `0xHoneyJar/loa-freeside` — `[coord] events-pillar-v1` — owns `@0xhoneyjar/events` library + operator-dash extension (if scoped in)
- `0xHoneyJar/sonar-api` (or `freeside-sonar` legacy name) — `[coord] events-pillar-v1 — sonar publish` — owns NFT mint publish step
- `0xHoneyJar/freeside-characters` — `[coord] events-pillar-v1 — characters subscribe` — owns subscriber + kansei router + announcement template

### Dispatch order (operator-confirmed scope 2026-05-26 v2)

1. **Sprint 1 — `@0xhoneyjar/events` library** published. ACVP envelope + Hounfour topics + signer/verifier + Zod schemas. Both consumers blocked behind this.
2. **Sprint 2 — sonar Mibera + PuruPuru handler publish** + **characters MST-only subscriber + announcement** in parallel (different repos, no cross-cell shared code).
3. **Sprint 3 — operator-dash event-trace panel** (the operator's primary success criterion). Subscribes to all Mibera + PuruPuru subjects; renders live envelope stream + verification status + prev_hash chain visualization. Becomes the canonical operator-awareness surface for the cluster.
4. **Sprint 4 (canary + close)** — small Discord test channel; operator validates announcement quality + dash trace correctness; flip MST announcements to production channel. Cycle close + distill.

**v2 (separate cycle, after operator gets comfortable with NATS through v1)**:
- Extend sonar publish to other handler families (vault, staking, marketplace, DeFi, HoneyJar, etc.) — substrate-universal earned with consumer-demand
- Extend characters display to more collections (non-MST Mibera + Puru announcements)
- Other worlds (honey-road, score-dashboard) subscribe via the established pattern

### Cross-repo audit gate
- Each cell repo passes its own `/audit-sprint` before coord merges its PR
- Master coordinator runs cross-cell integration test before final canary flip
- Operator approves the canary→prod flip (KRANZ act 4 / Flip)

## Key references (table)

| Topic | Source |
|---|---|
| Audit substrate | `grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md` |
| Sibling roadmap (user-plane) | `grimoires/loa/proposals/identity-api-sovereign-aggregator-substitution.md` |
| ACVP doctrine | `~/vault/wiki/concepts/agentic-cryptographically-verifiable-protocol.md` |
| NATS / Hounfour 3-segment naming | `~/vault/wiki/concepts/substrate-mental-model-for-product-builders.md` |
| Cluster topology | `decisions/009-freeside-hexagonal-federation.md` §D-5 §D-7 §D-12 |
| MST naming chain memory | `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/memory/project_mst-naming-chain.md` |
| Sonar pure-index memory | `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/memory/project_sonar-is-pure-index.md` |
| NATS state memory | `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/memory/project_nats-deployed-but-unconsumed.md` |
| ACVP events pillar positioning memory | `~/.claude/projects/-Users-zksoju-Documents-GitHub-loa-freeside/memory/project_acvp-events-pillar-positioning.md` |
| KRANZ coordination skill | `~/bonfire/construct-freeside/skills/coordinating-cross-repo/SKILL.md` |
| Existing NATS client pattern | `loa-freeside/apps/worker/src/main-nats.ts` |
| Existing audit-envelope L1 reference | `loa-freeside/.claude/scripts/audit-envelope.sh` (cycle-098 prior art) |
| Existing beacon-schema package layout (pattern to follow) | `loa-freeside/packages/beacon-schema/` |
| Enriched Discord rendering prior art | `freeside-characters/packages/persona-engine/src/preview/adapters/discord/rich-render.ts` |
| Scheduler event-driven reservation slot | `freeside-characters/packages/persona-engine/src/cron/scheduler.ts:114-120` |
| Mibera Shadows / MST contract | `0x048327A187b944ddac61c6e202BfccD20d17c008` Berachain |

## Mad-agent observations the operator might not have language for yet

1. **The events pillar is the cluster's nervous system.** Auth substitution gave it sovereign identity; events pillar gives it cross-cell awareness. Together they make the cluster legible to itself for the first time. The operator-dash with cross-world Soju-lens + NATS event trace becomes the cluster's *empirical-truth substrate* — the surface where reality lives.

2. **One pattern, N future cells.** Every future cell-to-cell integration after this becomes "subscribe to subject + decode envelope + handle payload." That's it. The shape future Loa learns once and inherits forever. Same RHS as the auth substrate (`compose_with: freeside-auth`).

3. **ACVP envelope from v1 is the right discipline-cost.** YAGNI says "skip envelope, ship payload." But every cell that adopts payload-only events later requires retrofit + a coordinated re-version. Doing envelope from v1 trades one cycle of upfront work for N future cycles of retrofit. Substrate-clean compounds.

4. **The reserved slot in characters' scheduler (line 114-120) was a prophecy.** The cycle-008 operator left a comment "event-driven micros — slice 2a" without building the substrate. Six months later, this cycle ships the substrate that comment was reserving for. That's substrate-pattern leadership — naming the slot before having the substrate to fill it.

5. **The TEND audit IS the artifact the operator asked for as "Loa awareness substrate."** Future Loa sessions ground in `cluster-2026-05-26-mint-announcement-tend/audit.md` + the 5 memories. Continuity is now a substrate primitive in this cluster — not metadata, but a real artifact that survives sessions. Straylight-shaped.

## Operator decisions resolved 2026-05-26 (was reviewer ask)

1. ✅ **Doc granularity**: single build doc this kickoff; **coord-init will author PRD/SDD/sprint** when fresh-session opens (per /coord skill init pattern)
2. ✅ **NATS publishing**: universal substrate (all sonar handlers); **characters announcement display: MST-only for v1**, other classes subscribe-but-no-display until v2
3. ✅ **Mad-agent extension**: operator-dash event-trace panel IN SCOPE (Sprint 4)
4. ✅ **Library home**: `loa-freeside/packages/events/` (workspace npm, mirrors `packages/beacon-schema/` pattern)
5. ✅ **Dispatch timing**: NOT this session — fresh session via `/coord` per clipboard pointer prepared at session close
