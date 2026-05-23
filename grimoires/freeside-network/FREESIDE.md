# The Freeside Building Network

> Auto-generated awareness surface — **do not hand-edit**. Regenerate: `loa freeside catalog --format md`.
>
> Each **building** is one repo: a sealed substrate/contract core + an API · MCP · CLI surface to read it from outside. Point a Loa agent at this map (or the machine twin `/.well-known/buildings.json`) to discover what exists and wire it in as a first-class tool — like the constructs network, for buildings.

**7 buildings** · 6 broadcasting a valid beacon · generated 2026-05-23

## Factory floor — the composition DAG

```
  belts run ONE way — raw → presented (ADR-008 §D-3)

  RAW (events · bytes)      sonar-api, storage-api
  DERIVED (state)           inventory-api, mint-api, activities-api
  INTEGRATED (meaning)      score-api
  PRESENTED (UX boundary)   mediums-api
```

_A building consumes only buildings upstream of it (closer to raw). Bottleneck debugging = walk upstream on the belts._

## Buildings

### `sonar-api`  ·  active  ·  public · rename:done

> Onchain event indexer across 6 chains (Berachain primary) — source of truth for THJ holdings + events

**Refuses** · run a chain or validate blocks — it indexes external chain events · host NFT metadata or media — that is storage-api · compute scores or rankings — that is score-api
**Capabilities** · `query_holdings` · `query_events` · `query_governance`
**Reach** · MCP — (not yet deployed) · beacon `sonar.0xhoneyjar.xyz` · repo `github.com/0xHoneyJar/sonar-api`

### `storage-api`  ·  candidate  ·  public · rename:pending

> Sovereign asset surface — storage layout + static-asset CDN + NFT metadata serving + retrieval API

**Refuses** · own per-collection content — it owns the storage abstraction, not the bytes' meaning · be a cloud provider — it wraps S3/IPFS/Arweave behind one interface · model a filesystem hierarchy — it is object + CDN storage
**Reach** · MCP — (not yet deployed) · beacon `storage.0xhoneyjar.xyz` · repo `github.com/0xHoneyJar/freeside-storage`

### `mint-api`  ·  candidate  ·  public · rename:pending

> Medium- and chain-agnostic substrate for issuing identity-bound tokens (sealed protocol + typed ports)

**Refuses** · run a chain · be a marketplace or a wallet flow · host metadata — that is storage-api · be opinionated about who can mint, what tokens represent, or where fees go
**Capabilities** · `createEdition` · `getMintHistory` · `getFeeSplit` · `getEditionState`
**Reach** · MCP — (not yet deployed) · beacon `mint.0xhoneyjar.xyz` · repo `github.com/0xHoneyJar/freeside-mint`

### `activities-api`  ·  active  ·  public · rename:done

> Unified Activity supertype substrate — quests, missions, badges, raffles, completion tracking

**Refuses** · run a Discord bot or Next.js app — the CubQuests dashboard stays the operator surface · be a Postgres schema or an indexer — it consumes indexed reads · own dashboard chrome — only the headless engine + contracts
**Capabilities** · `getQuestCompletion` · `getBadges` · `getRaffleEntries`
**Reach** · MCP — (not yet deployed) · beacon `activities.0xhoneyjar.xyz` · repo `github.com/0xHoneyJar/activities-api`

### `mediums-api`  ·  active  ·  public · rename:pending

> Sealed registry of chat-medium presentation capabilities — what can THIS chat medium render?

**Refuses** · implement any chat medium — it declares capabilities, not renderers · be a Discord bot or a chat client · transform output — that is the L3 cmp-boundary
**Reach** · MCP — (not yet deployed) · beacon `mediums.0xhoneyjar.xyz` · repo `github.com/0xHoneyJar/freeside-mediums`

### `score-api`  ·  active  ·  public · rename:done

> Scoring + data-pipeline service for Mibera Dimensions — wallet scores, leaderboards, breakdowns

**Refuses** · index onchain events — it consumes sonar-api for raw activity · host NFT metadata or media — that is storage-api · issue tokens or define identity — that is mint-api
**Capabilities** · `getWalletScore` · `getLeaderboard` · `getFactorBreakdown`
**Reach** · MCP — (not yet deployed) · beacon `score.0xhoneyjar.xyz` · repo `github.com/0xHoneyJar/score-api`

### `inventory-api`  ·  —  ·  public · rename:done

> ⏳ registered, beacon not broadcasting yet — `inventory.0xhoneyjar.xyz`
**Reach** · repo `github.com/0xHoneyJar/inventory-api`

---

**Wiring it in (agents):** read this catalog (or `curl <gateway>/.well-known/buildings.json`), pick the building whose `Refuses`/`Capabilities` match your need, and reach it via its MCP tenant (when `MCP ✓`) or its repo. `loa freeside inspect <slug>` returns the full beacon; `loa freeside doctor` audits health.
