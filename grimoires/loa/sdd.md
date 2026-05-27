---
title: Software Design Document — Ponder Substrate Migration
cycle: sonar-ponder-migration-v1
date: 2026-05-27
status: draft (simstim phase 4 / 8 — Flatline-integrated v2)
operator: zksoju
simstim_id: simstim-20260527-01a189b5
prd: grimoires/loa/prd.md (Phase 2 Flatline-integrated, sha256:fd25da37)
flatline_review: grimoires/loa/a2a/flatline/sdd-review.json (3-model, 100% agreement, 8 HIGH_CONSENSUS + 13 BLOCKERS integrated)
predecessor: sdd.md.ride-snapshot-2026-05-18-bak (archived /ride loa-freeside platform SDD)
hivemind_labels:
  product_area: "Cluster Indexer Substrate"
  workstream: delivery
  source: team-internal
---

# Software Design Document — Ponder Substrate Migration (v2 · Flatline-integrated)

## 1. System Architecture

### 1.1 High-level component view

```
                          ┌──────────────────────────────────────┐
                          │           ON-CHAIN SOURCES           │
                          │  Ethereum · Optimism · Arbitrum ·    │
                          │  Zora · Base · Berachain             │
                          └──────────────┬───────────────────────┘
                                         │ JSON-RPC
                                         ▼
              ┌──────────────────────────────────────────────────┐
              │     eRPC SUBSTRATE (Railway: erpc.railway.       │
              │     internal:4000) — multi-upstream fallback +   │
              │     hedging + Postgres-cached evmJsonRpcCache.   │
              │     UNCHANGED from path-ε work.                  │
              └──────────────────────────────────────────────────┘
                                         │
              ┌──────────────────────────┴──────────────────────┐
              ▼                                                  ▼
   ┌─────────────────────────┐                      ┌─────────────────────────┐
   │  BLUE BELT (Mibera)     │                      │  GREEN BELT (Full)      │
   │  Ponder 0.16.6 + Node22 │                      │  Ponder 0.16.6 + Node22 │
   │  chains: 1, 8453, 80094 │                      │  chains: 1, 10, 42161,  │
   │                         │                      │          7777777, 8453, │
   │                         │                      │          80094          │
   └────────────┬────────────┘                      └────────────┬────────────┘
                │                                                │
                ▼                                                ▼
   ┌─────────────────────────┐                      ┌─────────────────────────┐
   │  POSTGRES (postgres-    │                      │  POSTGRES (postgres-    │
   │  3vic.railway.internal) │                      │  vrr1.railway.internal) │
   │  public.*  (envio)      │                      │  public.*  (envio)      │
   │  ponder.*  (NEW)        │                      │  ponder.*  (NEW)        │
   └────────────┬────────────┘                      └────────────┬────────────┘
                │                                                │
                ▼                                                ▼
   ┌─────────────────────────┐                      ┌─────────────────────────┐
   │  HASURA                 │                      │  HASURA                 │
   │  metadata: tracks       │                      │  metadata: tracks       │
   │  public.* pre-cutover   │                      │  public.* pre-cutover   │
   │  ponder.* post-cutover  │                      │  ponder.* post-cutover  │
   └────────────┬────────────┘                      └────────────┬────────────┘
                │                                                │
                └────────────────────┬───────────────────────────┘
                                     │ GraphQL (UNCHANGED API SHAPE, G-8)
                                     ▼
                          ┌──────────────────────────────────────┐
                          │       DOWNSTREAM CONSUMERS           │
                          │  mediums · sietch-discord ·          │
                          │  freeside-score                      │
                          └──────────────────────────────────────┘

                              ┌─── SIDE CHANNEL ───┐
                              ▼                    ▼
                   ┌──────────────────┐ ┌──────────────────┐
                   │  Reorg-safe NATS │ │  Reorg-safe NATS │
                   │  (NFR-7 outbox)  │ │  (NFR-7 outbox)  │
                   │  COLD-SYNC GATE  │ │  COLD-SYNC GATE  │
                   │  silences emit   │ │  silences emit   │
                   │  during backfill │ │  during backfill │
                   └────────┬─────────┘ └────────┬─────────┘
                            │                    │
                            └──────────┬─────────┘
                                       │
                                       ▼
                          ┌──────────────────────────────────────┐
                          │  NATS BROKER + freeside-characters   │
                          │  UNCHANGED                           │
                          └──────────────────────────────────────┘
```

### 1.2 What's preserved (do not modify)

- **eRPC**: substrate, config, upstream policies. UNCHANGED.
- **Postgres instances**: same DB hosts; `ponder.*` schema ADDED alongside `public.*` (envio); envio schemas stay during transition.
- **Hasura**: same service; metadata swap (atomic `replace_metadata`) at cutover.
- **NATS broker + JetStream**: UNCHANGED.
- **@0xhoneyjar/events publisher**: library + Dockerfile materialization. UNCHANGED.
- **Downstream consumers**: zero application changes (G-8 lock).
- **GraphQL API shape**: queries return identical responses (validated by AC-3 expanded).

### 1.3 What's replaced

| Surface | Before (envio) | After (Ponder) |
|---------|----------------|----------------|
| Indexer runtime | envio v3.0.0-alpha.17 | Ponder 0.16.6 (EXACT pin) |
| Config | `config.yaml` / `config.mibera.yaml` (YAML) | `ponder.config.ts` (TypeScript) |
| Schema | `schema.graphql` (envio codegen) | `ponder.schema.ts` (Drizzle ORM) |
| Handlers | `Contract.Event.handler(fn, opts)` | `ponder.on("Contract:Event", fn)` |
| Filter mechanism | `eventFilters: [...]` in handler opts | `filter:` in config (indexed) OR in-handler early-return (non-indexed) |
| Postgres schema | `public.*` | `ponder.*` |
| Codegen step | `pnpm envio codegen` | none |
| Generated dir | `generated/` | `ponder-env.d.ts` |

## 2. Tech Stack

### 2.1 Runtime dependencies

| Package | Version | Why |
|---------|---------|-----|
| `ponder` | **EXACT `0.16.6`** | Indexer runtime (IMP-006 HIGH_CONSENSUS — no caret) |
| `viem` | per Ponder peer-dep | RPC client |
| `drizzle-orm` | per Ponder peer-dep | Schema DSL |
| `node` | `>=22` | Ponder requirement; cluster already meets |
| `pnpm` | `10.x` | Existing cluster standard |
| `@0xhoneyjar/events` | `file:packages/events` (SHA-pinned) | NATS envelope publisher |

### 2.2 Existing services retained

Postgres 17 · Hasura · eRPC · Railway · NATS broker

### 2.3 Removed

`envio` + `rescript-schema` + `rescript-envsafe` + `@rescript/react` + `generated/` directory

## 3. Data Models

### 3.1 Schema namespace strategy (FR-X-6)

Ponder writes to dedicated `ponder` schema; envio's `public.*` stays intact. Enables:
- Snapshot-only rollback without data loss
- Zero schema collision risk
- Hasura source-database swap as atomic cutover mechanism

```typescript
// ponder.config.ts (excerpt)
import { createConfig } from "ponder";

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
    schema: "ponder",  // ← isolation namespace per FR-X-6
  },
  // ... chains, contracts, blocks (see §3.2)
});
```

### 3.2 Schema port pattern (envio → Ponder) — uint256-safe (BLOCKER SKP-003 HIGH)

**CRITICAL: token IDs must use `t.numeric(78, 0)` not `t.bigint()`**. Drizzle's `bigint` maps to Postgres int64 which overflows for uint256 token IDs above 2^63. NFTs commonly emit token IDs above this range.

**envio** (`schema.graphql`):
```graphql
type Token @entity {
  id: ID!
  collection: String!
  tokenId: BigInt!
  owner: String!
  blockNumber: BigInt!
  timestamp: BigInt!
}
```

**Ponder** (`ponder.schema.ts`):
```typescript
import { onchainTable, index } from "ponder";

export const token = onchainTable(
  "token",
  (t) => ({
    id: t.text().primaryKey(),
    collection: t.hex().notNull(),
    tokenId: t.numeric(78, 0).notNull(),  // ← uint256-safe per SKP-003
    owner: t.hex().notNull(),
    blockNumber: t.bigint().notNull(),    // block numbers safe in int64
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({
    collectionIdx: index().on(table.collection),
    ownerIdx: index().on(table.owner),
  }),
);
```

Apply the same rule to ALL token-ID columns across 89 entity ports.

### 3.3 NATS outbox table (NFR-7 + BLOCKER SKP-005 HIGH — IMP-002 HIGH_CONSENSUS)

Add a `pending_emits` table to handle reorg-safe + idempotent NATS publishing:

```typescript
export const pendingEmits = onchainTable(
  "pending_emits",
  (t) => ({
    id: t.text().primaryKey(),               // deterministic hash: chainId|txHash|logIndex|envelope_payload_hash
    chainId: t.integer().notNull(),
    eventBlock: t.bigint().notNull(),
    targetBlock: t.bigint().notNull(),       // eventBlock + reorg_depth
    envelopeJson: t.text().notNull(),
    publishedAt: t.bigint(),                 // null = pending; non-null = published timestamp
    attemptCount: t.integer().notNull().default(0),
    lastError: t.text(),
  }),
  (table) => ({
    chainTargetIdx: index().on(table.chainId, table.targetBlock),
    pendingIdx: index().on(table.publishedAt),  // sparse-style index on null
  }),
);
```

Outbox pattern semantics:
- Handler writes row with `publishedAt=null` + deterministic ID
- Block-tick handler reads ready rows (`targetBlock <= currentBlock AND publishedAt IS NULL`)
- For each: attempt JetStream publish → on ack, set `publishedAt = now()` + commit
- On publish failure: increment `attemptCount`, set `lastError`, leave `publishedAt` null (retry next tick)
- Deterministic ID = consumer-side dedup key (idempotent on duplicate)

### 3.4 Historical data continuity (PRD §Historical Data Continuity)

```
T=0    deploy Ponder · writes to ponder.* starts
       Hasura STILL tracks public.* (envio stale tables)
       Consumers see stale-but-present data — no breaking changes
T=24h  Ponder cold sync complete · all entities present in ponder.*
T=24h+ Operator-paired Hasura metadata atomic swap (§4.3)
       Consumers atomically see fresh Ponder data
T=7d   Stable Ponder operation; envio schemas may be archived (separate cycle)
```

Zero read-side gap from consumer perspective.

## 4. API Contracts

### 4.1 GraphQL surface (G-8 LOCKED, consumer-facing)

**Endpoint**: `https://belt-hasura.up.railway.app/v1/graphql` — UNCHANGED.

**Contract**: identical query syntax + response shape pre/post migration. AC-3 validates with EXPANDED test coverage (per BLOCKER SKP-003 HIGH):
- Top-5 production query shape responses (15 tests = 5 × 3 consumers)
- Hasura relationship traversal tests (`token.holder`, etc.)
- Permission/role tests for each consumer's intended role
- Aggregate query tests (`token_aggregate`)
- Ordering + nullability assertions
- Subscription smoke tests (live data flow from cutover moment forward)

### 4.2 NATS+ACVP envelope side channel

**Subject + envelope shape**: UNCHANGED from path-ε. AC-A-7 enforces byte-parity.

**HISTORICAL SYNC GATE (BLOCKER SKP-001 CRITICAL 950)**: handlers MUST NOT emit envelopes during cold sync. Implementation: handler checks `event.block.timestamp` against `Date.now() - LIVE_THRESHOLD_MS` (default 1 hour). Older events get processed (write to DB) but emit is silenced.

```typescript
// src/lib/sync-status.ts
const LIVE_THRESHOLD_MS = 60 * 60 * 1000;  // 1 hour

export function isLiveEvent(event: { block: { timestamp: bigint } }): boolean {
  const eventMs = Number(event.block.timestamp) * 1000;
  return Date.now() - eventMs < LIVE_THRESHOLD_MS;
}
```

Used in every NATS-emitting handler:
```typescript
ponder.on("MiberaShadows:Transfer", async ({ event, context }) => {
  await context.db.insert(token).values({ /* ... */ });
  if (isLiveEvent(event)) {
    await reorgSafeEmit(context, mintEnvelope(event), event.block.number, event.chainId);
  }
  // historical events: written to DB but NOT emitted to NATS — no DDOS during backfill
});
```

### 4.3 Hasura metadata cutover — atomic `replace_metadata` (BLOCKER SKP-001/002 CRITICAL — IMP-001 HIGH_CONSENSUS)

**DO NOT use sequential untrack/track API calls** — they're non-transactional + drop relationships + permissions. Use atomic `replace_metadata`:

```bash
#!/bin/bash
# scripts/cutover-hasura-tracking.sh — atomic Hasura metadata swap
set -euo pipefail

HASURA_URL="${HASURA_URL:?Set HASURA_URL}"
HASURA_ADMIN_SECRET="${HASURA_ADMIN_SECRET:?Set HASURA_ADMIN_SECRET}"
DIRECTION="${1:?cutover or rollback}"

# 1. Export current metadata as snapshot (rollback artifact)
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
SNAPSHOT_PATH="/tmp/hasura-metadata-${TIMESTAMP}.json"

curl -fSs -X POST "${HASURA_URL}/v1/metadata" \
  -H "x-hasura-admin-secret: ${HASURA_ADMIN_SECRET}" \
  -d '{"type": "export_metadata", "args": {}}' \
  > "${SNAPSHOT_PATH}"

echo "[cutover] metadata snapshot: ${SNAPSHOT_PATH}"

# 2. Transform: replace schema "public" → "ponder" (or reverse)
if [[ "${DIRECTION}" == "cutover" ]]; then
  jq '(.. | objects | select(.schema == "public")) |= .schema = "ponder"' \
    "${SNAPSHOT_PATH}" > "/tmp/hasura-metadata-${TIMESTAMP}-transformed.json"
elif [[ "${DIRECTION}" == "rollback" ]]; then
  jq '(.. | objects | select(.schema == "ponder")) |= .schema = "public"' \
    "${SNAPSHOT_PATH}" > "/tmp/hasura-metadata-${TIMESTAMP}-transformed.json"
else
  echo "[cutover] unknown DIRECTION=${DIRECTION}" >&2
  exit 1
fi

# 3. Atomic apply via replace_metadata (single Hasura transaction)
curl -fSs -X POST "${HASURA_URL}/v1/metadata" \
  -H "x-hasura-admin-secret: ${HASURA_ADMIN_SECRET}" \
  -d "$(jq -c '{"type": "replace_metadata", "args": .}' \
    "/tmp/hasura-metadata-${TIMESTAMP}-transformed.json")"

# 4. Post-swap validation — verify all 89 tables resolve to expected schema
EXPECTED_SCHEMA="ponder"
[[ "${DIRECTION}" == "rollback" ]] && EXPECTED_SCHEMA="public"
INTROSPECTION=$(curl -fSs -X POST "${HASURA_URL}/v1/graphql" \
  -H "x-hasura-admin-secret: ${HASURA_ADMIN_SECRET}" \
  -d '{"query": "{ __schema { types { name } } }"}')
# Diff against expected table list — fail loudly if mismatch
# (full assertion script in scripts/verify-hasura-tracking.sh)

echo "[cutover] DONE — direction=${DIRECTION} schema=${EXPECTED_SCHEMA}"
```

Rollback: invoke with `DIRECTION=rollback` + Postgres snapshot restore (see §6).

## 5. Handler Architecture

### 5.1 API translation pattern

**envio**:
```typescript
HoneyJar.Transfer.handler(async ({ event, context }) => {
  const tokenId = event.params.tokenId.toString();
  // ...
});
```

**Ponder**:
```typescript
import { ponder } from "ponder:registry";
import { token } from "../ponder.schema";

ponder.on("HoneyJar:Transfer", async ({ event, context }) => {
  await context.db
    .insert(token)
    .values({
      id: `${event.log.address}-${event.args.tokenId}`,
      collection: event.log.address,
      tokenId: event.args.tokenId,
      owner: event.args.to,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoUpdate({ owner: event.args.to });

  if (isLiveEvent(event)) {
    await reorgSafeEmit(context, mintEnvelope(event), event.block.number, event.chainId);
  }
});
```

### 5.2 Filter port (fatbera handlers) — corrected for Ponder 0.16.x

**Indexed-arg filter** (in config, RPC-level efficient):
```typescript
// ponder.config.ts (excerpt)
contracts: {
  BlockRewardController: {
    network: "berachain",
    address: "0xBAE...",
    abi: BlockRewardControllerAbi,
    startBlock: 8221,
    filter: {
      event: "BlockRewardProcessed",
      args: { validatorPubkey: TRACKED_VALIDATORS.map(v => v.pubkey) },
    },
  },
},
```

**Non-indexed-arg filter** (in handler early-return, RPC-level not possible):
```typescript
ponder.on("BeaconDeposit:Deposit", async ({ event, context }) => {
  if (!TRACKED_VALIDATORS_BY_PUBKEY.has(event.args.pubkey)) {
    return;  // early-return on non-indexed filter
  }
  // ...
});
```

### 5.3 Reorg-safe NATS emission via outbox + network-block handler (FIXED per BLOCKER SKP-003 CRITICAL)

**ponder.config.ts** MUST declare `blocks:` for the block-tick handler to fire (IMP-005 HIGH_CONSENSUS):

```typescript
// ponder.config.ts
import { createConfig } from "ponder";

export default createConfig({
  chains: {
    ethereum: { id: 1, rpc: process.env.PONDER_RPC_URL_1 },
    base: { id: 8453, rpc: process.env.PONDER_RPC_URL_8453 },
    berachain: { id: 80094, rpc: process.env.PONDER_RPC_URL_80094 },
  },
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL, schema: "ponder" },
  contracts: { /* ... */ },
  blocks: {
    OutboxFlushEth:  { network: "ethereum",  interval: 1 },
    OutboxFlushBase: { network: "base",      interval: 1 },
    OutboxFlushBera: { network: "berachain", interval: 1 },
  },
});
```

**Handler with correct Ponder 0.16.x API** (FIXED per BLOCKER SKP-004 HIGH — was `context.db.find` with where-clause, must be Drizzle `select().from().where()`):

```typescript
// src/handlers/outbox-flush.ts
import { ponder } from "ponder:registry";
import { pendingEmits } from "../ponder.schema";
import { and, eq, lte, isNull } from "ponder";

const REORG_DEPTH_BY_CHAIN: Record<number, bigint> = {
  1n:  12n,   // Ethereum
  10n: 0n,    // Optimism (L2 instant)
  8453n: 0n,  // Base
  42161n: 0n, // Arbitrum
  7777777n: 0n, // Zora
  80094n: 200n, // Berachain
};

async function flushBlock(networkName: string, chainId: bigint) {
  ponder.on(`${networkName}:block`, async ({ event, context }) => {
    // CORRECT API: Drizzle select pattern, NOT context.db.find(...)
    const ready = await context.db
      .select()
      .from(pendingEmits)
      .where(
        and(
          eq(pendingEmits.chainId, Number(chainId)),
          isNull(pendingEmits.publishedAt),
          lte(pendingEmits.targetBlock, event.block.number),
        ),
      );

    for (const entry of ready) {
      try {
        await publishEnvelope(JSON.parse(entry.envelopeJson));
        await context.db
          .update(pendingEmits)
          .set({ publishedAt: BigInt(Date.now()) })
          .where(eq(pendingEmits.id, entry.id));
      } catch (err) {
        await context.db
          .update(pendingEmits)
          .set({
            attemptCount: entry.attemptCount + 1,
            lastError: String(err).slice(0, 1000),
          })
          .where(eq(pendingEmits.id, entry.id));
        // do NOT throw — let next tick retry
      }
    }
  });
}

flushBlock("ethereum",  1n);
flushBlock("base",      8453n);
flushBlock("berachain", 80094n);
```

**reorgSafeEmit** (handler-side):
```typescript
// src/lib/reorg-safe-emit.ts
import { pendingEmits } from "../ponder.schema";
import { keccak256, toBytes } from "viem";

export async function reorgSafeEmit(
  context: any,
  envelope: any,
  eventBlock: bigint,
  chainId: number,
) {
  const depth = REORG_DEPTH_BY_CHAIN[BigInt(chainId)] ?? 12n;
  if (depth === 0n) {
    return publishEnvelope(envelope);
  }
  const deterministicId = keccak256(toBytes(JSON.stringify({ chainId, envelope })));
  await context.db
    .insert(pendingEmits)
    .values({
      id: deterministicId,
      chainId,
      eventBlock,
      targetBlock: eventBlock + depth,
      envelopeJson: JSON.stringify(envelope),
      publishedAt: null,
      attemptCount: 0,
    })
    .onConflictDoNothing();  // idempotent — duplicate handler invocations safe
}
```

### 5.4 Loader / preload removal

envio's `handlerWithLoader` + `isPreload` pattern is REPLACED by Ponder's automatic profiling-based prefetch. REMOVES ~500 LOC.

## 6. Snapshot-Only Rollback (operator-locked 2026-05-27)

### 6.1 Framing — snapshot-only, NOT service recovery

**Rollback's value**: data hygiene — restore clean Postgres state for the next migration attempt. **NOT service recovery** — the cluster is already broken on envio (gate error); rollback restores that same broken state. The ONLY path to working service is forward (Ponder migration succeeds).

ADR-010 explicit acknowledgment required: "rollback is data hygiene only; service recovery requires the next forward attempt."

### 6.2 Pre-cutover snapshot procedure (FR-X-5)

```bash
#!/bin/bash
# scripts/snapshot-pre-cutover.sh
set -euo pipefail

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BELT="${1:?Usage: $0 blue|green}"

case "${BELT}" in
  blue)  PG_HOST="postgres-3vic.railway.internal" ;;
  green) PG_HOST="postgres-vrr1.railway.internal" ;;
  *)     echo "Unknown belt: ${BELT}" >&2; exit 1 ;;
esac

OUTPUT="/tmp/sonar-${BELT}-${TIMESTAMP}.pgdump"

# Run pg_dump from within Railway's network context
# (eRPC container has psql installed — use as proxy)
railway run --service belt-indexer-${BELT/blue/} -- \
  pg_dump --host="${PG_HOST}" --username=postgres \
    --schema=public --schema=ponder \
    --format=custom --no-owner --no-acl \
    --file="${OUTPUT}"

echo "[snapshot] WRITTEN ${OUTPUT}"

# Copy to durable storage
S3_PATH="s3://sonar-snapshots/sonar-${BELT}-${TIMESTAMP}.pgdump"
# (operator's S3 credential mechanism here)
# OR use Railway volume for in-network durability

# Also snapshot Hasura metadata (paired artifact)
HASURA_URL_VAR="HASURA_URL_${BELT^^}"
curl -fSs -X POST "${!HASURA_URL_VAR}/v1/metadata" \
  -H "x-hasura-admin-secret: ${HASURA_ADMIN_SECRET}" \
  -d '{"type": "export_metadata", "args": {}}' \
  > "/tmp/hasura-metadata-${BELT}-${TIMESTAMP}.json"

echo "[snapshot] Hasura metadata: /tmp/hasura-metadata-${BELT}-${TIMESTAMP}.json"
```

### 6.3 Rollback procedure (snapshot-restore)

```bash
#!/bin/bash
# scripts/rollback-belt.sh — snapshot-only rollback
# Restores pre-cutover Postgres + Hasura state.
# Does NOT restore service (envio still crashes on gate).
set -euo pipefail

BELT="${1:?Usage: $0 <belt:blue|green> <pg_snapshot> <hasura_snapshot>}"
PG_SNAPSHOT="${2:?Missing pg_dump path}"
HASURA_SNAPSHOT="${3:?Missing hasura metadata json path}"

# 1. Stop current Ponder deploy
railway service stop --service "belt-indexer${BELT:+-${BELT/blue/}}"

# 2. Restore Postgres state
railway run --service "belt-indexer${BELT:+-${BELT/blue/}}" -- \
  pg_restore --host="${PG_HOST}" --username=postgres \
    --clean --if-exists --no-owner \
    "${PG_SNAPSHOT}"

# 3. Restore Hasura metadata (atomic replace_metadata)
curl -fSs -X POST "${HASURA_URL}/v1/metadata" \
  -H "x-hasura-admin-secret: ${HASURA_ADMIN_SECRET}" \
  -d "$(jq -c '{"type": "replace_metadata", "args": .}' "${HASURA_SNAPSHOT}")"

# 4. Redeploy prior envio image (operator-supplied SHA)
railway redeploy --service "belt-indexer${BELT:+-${BELT/blue/}}" \
  --image "${PRIOR_ENVIO_IMAGE:?Set PRIOR_ENVIO_IMAGE to envio image SHA}"

# 5. Verify rollback state (envio expected to crash — that's the same as pre-rollback)
sleep 30
LOGS=$(railway logs --service "belt-indexer${BELT:+-${BELT/blue/}}" 2>&1 | tail -10)
if echo "${LOGS}" | grep -q "single wildcard event"; then
  echo "[rollback] OK — envio re-crashed with expected gate error"
  echo "[rollback] Cluster state restored to PRE-CUTOVER (still degraded; expected per snapshot-only contract)"
else
  echo "[rollback] WARNING — envio did NOT crash as expected; verify state manually" >&2
fi
```

### 6.4 Rollback drill (AC-6)

Pre-Phase-B exercise that PROVES the rollback procedure works:

```
1. Take green snapshot (pg_dump + hasura metadata) → sonar-green-DRILL-*.pgdump
2. Deploy Ponder to green
3. Wait ~10 min for partial cold sync progress
4. Execute scripts/rollback-belt.sh green sonar-green-DRILL-*.pgdump
5. Verify:
   • envio image redeployed
   • Postgres state matches pre-cutover snapshot (entity counts unchanged)
   • Hasura metadata identical to snapshot (export + diff)
   • envio crashes with gate error (the expected degraded state per §6.1)
6. AC-6 PASSES if all 5 verifications succeed
```

## 7. Deployment Architecture

### 7.1 Per-belt Dockerfile

```dockerfile
# Dockerfile.belt-ponder
FROM node:22-bookworm-slim

ARG CACHE_BUST=ponder-migration-2026-05-27
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@10.11.0 --activate

WORKDIR /app
COPY . .

ARG BELT_CONFIG=ponder.config.mibera.ts
ENV BELT_CONFIG=${BELT_CONFIG}

RUN pnpm install --frozen-lockfile && bash scripts/rebuild-events-dist.sh

ENV PONDER_TUI=false
CMD ["sh", "-c", "exec pnpm ponder start --config \"$BELT_CONFIG\""]
```

### 7.2 Railway env var matrix

| Variable | Blue | Green |
|----------|------|-------|
| `BELT_CONFIG` | `ponder.config.mibera.ts` | `ponder.config.ts` |
| `DATABASE_URL` | composed: `postgres://postgres:...@postgres-3vic.railway.internal:5432/railway` | composed: postgres-vrr1 |
| `PONDER_RPC_URL_1` | `http://erpc.railway.internal:4000/main/evm/1` | same |
| `PONDER_RPC_URL_8453` | `http://erpc.railway.internal:4000/main/evm/8453` | same |
| `PONDER_RPC_URL_80094` | `http://erpc.railway.internal:4000/main/evm/80094` | same |
| `PONDER_RPC_URL_10` | (unset; blue doesn't use) | erpc 10 |
| `PONDER_RPC_URL_42161` | (unset) | erpc 42161 |
| `PONDER_RPC_URL_7777777` | (unset) | erpc 7777777 |
| `NATS_URL` | `tls://nats.0xhoneyjar.xyz:48352` | same |
| `NATS_AUTH_TOKEN` | per-belt mTLS cert | per-belt mTLS cert |
| `LIVE_THRESHOLD_MS` | `3600000` (1h) | `3600000` |

### 7.3 Liveness vs readiness probes (BLOCKER SKP-002 CRITICAL — Railway 24h cold sync restart trap)

**Problem**: a single `/health` endpoint that returns 503 during cold sync triggers Railway's restart policy — Ponder is killed + restarted, resetting cold sync indefinitely.

**Fix**: separate probes:

```typescript
// src/lib/health-endpoints.ts
import { Hono } from "hono";

export function makeHealthApp() {
  const app = new Hono();

  // Liveness: Ponder process is running + making progress
  // Used by Railway for restart decisions. Returns 200 unless truly stuck.
  app.get("/live", async (c) => {
    const lastTickMs = await getLastBlockTickTimestamp();
    const stuck = Date.now() - lastTickMs > 5 * 60 * 1000;  // 5 min no progress = stuck
    return c.json({ live: !stuck, lastTickMs }, stuck ? 503 : 200);
  });

  // Readiness: Ponder is caught up to head + serving fresh data
  // Used by Railway for TRAFFIC ROUTING decisions (not restart).
  app.get("/ready", async (c) => {
    const lag = await getMaxChainLagBlocks();
    const ready = lag < 100;  // within 100 blocks of head per chain
    return c.json({ ready, maxLagBlocks: lag }, ready ? 200 : 503);
  });

  return app;
}
```

**Railway config**:
- Health check path: `/live` (NOT `/ready`)
- Restart timeout: 10 min (not the default 60s — accommodate cold sync)
- During the 24h Phase A cold sync, `/ready` returns 503 but `/live` stays 200 — no restart

### 7.4 Cache-bust pattern (existing)

`ARG CACHE_BUST` in Dockerfile.belt-ponder forces Railway BuildKit rebuild on content change (memory `arrakis-75ro`).

## 8. Testing Strategy

### 8.1 Unit tests (handler logic)

Per-handler test via Ponder's test framework (verify exact API in Sprint A-0). One test per handler covering:
- Happy path (event → entity write)
- NATS emit gating (`isLiveEvent` enforcement)
- Filter early-return (non-indexed filter handlers like BeaconDeposit)

### 8.2 Schema parity tests

After Ponder cold sync of a defined block range, compare entity tables to envio's tables (from pre-strip snapshot):
```bash
# Sample: HoneyJar Transfer events on chain 1, blocks 17000000-17001000
psql -c "SELECT * FROM public.token WHERE collection = '0xa20cf9b0...' AND block_number BETWEEN 17000000 AND 17001000 ORDER BY id" > /tmp/envio.csv
psql -c "SELECT * FROM ponder.token WHERE collection = '0xa20cf9b0...' AND block_number BETWEEN 17000000 AND 17001000 ORDER BY id" > /tmp/ponder.csv
diff /tmp/envio.csv /tmp/ponder.csv
```

### 8.3 NATS envelope byte-parity test (AC-A-7)

Per §4.2 / PRD AC-A-7. 10+ canonical event types from spike snapshot. Run in CI gate before any production deploy.

### 8.4 Hasura GraphQL contract tests (AC-3 EXPANDED per BLOCKER SKP-003)

15 baseline tests (5 query shapes × 3 consumers) PLUS expanded coverage:
- Hasura metadata diff (export pre/post; expect zero diff after `replace_metadata`)
- Permission/role tests for each consumer role (mediums-role, sietch-discord-role, score-role)
- Relationship traversal tests (e.g., `token { collection_obj { ... } }`)
- Aggregate query tests (`token_aggregate { count }`)
- Ordering + nullability assertions
- Subscription smoke tests (1 query × 3 consumers = 3 subscription tests)

Total: 15 baseline + ~20 expanded = ~35 tests.

### 8.5 Reorg drill (NFR-7) with executable reset

```bash
# scripts/reorg-drill.sh
set -euo pipefail

# 1. Note current chain head
HEAD_BLOCK=$(curl -fSs -X POST "${PONDER_RPC_URL_1}" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}' | jq -r '.result')

# 2. Stop Ponder
railway service stop --service belt-indexer

# 3. Manually rewind Ponder's tracking checkpoint (deep enough to exceed reorg depth)
REWIND_BLOCK=$(($HEAD_BLOCK - 100))
psql -c "UPDATE ponder._meta SET checkpoint = '${REWIND_BLOCK}' WHERE chain_id = 1;"

# 4. Note pending_emits state (should have N entries with targetBlock near head)
PRE_PENDING=$(psql -t -c "SELECT count(*) FROM ponder.pending_emits WHERE published_at IS NULL AND chain_id = 1;")

# 5. Restart Ponder; it re-syncs blocks REWIND_BLOCK to HEAD
railway redeploy --service belt-indexer

# 6. Wait for cold-resync to complete (poll /ready endpoint)
while ! curl -fSs https://belt-indexer.up.railway.app/ready > /dev/null; do sleep 10; done

# 7. Verify pending_emits — no duplicate envelopes published
POST_PUBLISHED=$(psql -t -c "SELECT count(*) FROM ponder.pending_emits WHERE published_at IS NOT NULL AND chain_id = 1;")
echo "[reorg drill] pre-pending: ${PRE_PENDING}; post-published: ${POST_PUBLISHED}"
# Manual check: pending_emits.id is deterministic, so re-emitted rows have same id; onConflictDoNothing means no duplicates
```

### 8.6 Rollback drill (AC-6)

Per §6.4. Run BEFORE Phase B production deploy.

### 8.7 Dual-publication overlap mitigation (IMP-004 HIGH_CONSENSUS)

During cutover window there's risk of envio (crashed) AND Ponder both running briefly. Mitigation: cutover sequencing ensures envio service is stopped BEFORE Ponder starts producing live envelopes. Plus the outbox's deterministic IDs + `onConflictDoNothing` prevent duplicate envelopes even if overlap occurs.

## 9. Security Design

No new secrets. DATABASE_URL composed from existing env vars. eRPC endpoint internal-only. NATS_AUTH_TOKEN existing per-belt mTLS cert. Hasura admin secret existing.

`ponder.*` schema permissions: postgres role full DDL+DML; hasura_user role SELECT (granted via migration).

## 10. Observability

### 10.1 Metrics (Prometheus)

Ponder exposes `/metrics`. Wire to existing Grafana.

Key metrics:
- `ponder_indexer_handler_latency_seconds` (NFR-2)
- `ponder_database_writes_per_second` (NFR-3)
- `ponder_indexer_blocks_processed_total`
- `ponder_indexer_cold_sync_progress_ratio`
- `ponder_outbox_pending_count{chain_id}` — pending_emits gauge
- `ponder_outbox_published_total{chain_id}` — published counter

### 10.2 Logs

Ponder logs to stdout. `PONDER_LOG_LEVEL=info` default; `debug` during cold-sync diagnostics.

### 10.3 Health probes

See §7.3. `/live` for restart decisions, `/ready` for traffic.

## 11. Migration Implementation Sequencing

### 11.1 Sprint A-0: Ponder API Verification Spike (NEW — per BLOCKER SKP-004 + IMP-005 + IMP-008)

**Goal**: produce a verified Ponder 0.16.6 cookbook before locking Phase A handler estimates. The SDD examples are illustrative; the spike verifies actual API behavior.

**Outputs**:
- `grimoires/loa/spikes/ponder-api-verification/COOKBOOK.md` covering:
  - Exact `ponder.config.ts` `blocks:` declaration syntax + block-handler firing behavior
  - `context.db.select().from().where()` pattern (vs `context.db.find`)
  - `onConflictDoNothing` + `onConflictDoUpdate` semantics
  - `ponder.on("network:block", fn)` exact event name format
  - Hasura subscription continuity through `replace_metadata` reload (per OQ-3 promoted)
  - Schema namespace tracking by Hasura (Postgres → Hasura plumbing)

**Cost estimate**: 1 day (Sprint A-0). GATE for Phase A — sprint A-1 cannot start until A-0's cookbook validates the SDD's API assumptions.

### 11.2 Phase A sprint breakdown

| Sprint | Days | Output | Gate |
|--------|------|--------|------|
| A-0 | 1 | Ponder API cookbook (§11.1) | All A-* sprints gated on this |
| A-1 | 2-3 | `ponder.config.mibera.ts` + `ponder.schema.ts` (Mibera entities, uint256-safe per §3.2) + Dockerfile + Hasura `replace_metadata` cutover script | Schema parity local test passes |
| A-2 | 4-5 | Handler port (Mibera-scope) + NATS outbox + sync-status gate + reorg-safe emit (correct Ponder API per A-0) | Unit tests pass; envelope byte-parity (AC-A-7) |
| A-3 | 6 | Hasura contract test suite (~35 tests per §8.4) + dry-run on STAGING Postgres | All 35 tests pass |
| A-4 | 7-8 | Production deploy blue + cutover + AC-1/2/4/5 validation + rollback DRILL on green (AC-6) | All AC pass; rollback drill verified |

### 11.3 Phase B sprint breakdown

| Sprint | Days | Output | Gate |
|--------|------|--------|------|
| B-1 | 9-10 | Extend `ponder.config.ts` to 6 chains + port HoneyJar/Crayons/Apiculture/Aquabera handlers | Local cold sync test on green's chains |
| B-2 | 11 | fatbera handlers (3 indexed + 1 non-indexed) + sietch-discord maintainer ack | Filter behavior verified against Berachain |
| B-3 | 12-13 | Hasura contract tests with full green data + reorg drill (NFR-7) | AC-3 expanded passes + reorg drill verified |
| B-4 | 14-15 | Production deploy green + cluster-wide validation + ADR-010 signed + AC-7 | All AC pass |

## 12. Architectural Decisions

### 12.1 Ponder schema namespace (DECIDED)
Separate `ponder` schema per Postgres instance (one per belt). Rollback isolation via schema preservation.

### 12.2 Reorg-finality strategy (DECIDED)
Block-count delay (per-chain `maxReorgDepth`) via outbox table. Outbox = idempotent + crash-safe + transparent to consumers.

### 12.3 Hasura tracking source-swap (DECIDED — UPDATED)
Atomic `replace_metadata` via metadata export + transform + apply. NOT sequential untrack/track (preserves relationships + permissions).

### 12.4 Cold-sync execution mode (DECIDED)
Backfill-only-then-cutover. Sync-status gate silences NATS emit during backfill (no historical DDOS).

### 12.5 Rollback semantics (DECIDED — operator 2026-05-27)
**Snapshot-only**. Data hygiene; NOT service recovery. ADR-010 explicit ack required.

### 12.6 Liveness vs readiness (DECIDED — Flatline-integrated)
Separate `/live` (restart probe) from `/ready` (traffic probe). Cold sync window: `/live=200`, `/ready=503` for 24h.

## 13. Open Questions (PROMOTED TO Sprint A-0 spike)

- **OQ-1 (deferred)**: Should `pending_emits` table be in `ponder` schema or separate `ops`? Implication for backup vs rollback. → resolved in Sprint A-1.
- **OQ-2 (promoted to A-0)**: Ponder's `network:block` handler exact event-name format + firing reliability for outbox flush. → CRITICAL gate for §5.3.
- **OQ-3 (promoted to A-0)**: Hasura subscription continuity through `replace_metadata` reload — consumer subscriptions stay alive? → CRITICAL gate for cutover (IMP-008).
- **OQ-4 (deferred)**: Cold-sync end-to-end time on chain 1 via eRPC — actual measurement. → resolved in Sprint A-4 production deploy.

## 14. Flatline Integration Log

Per `grimoires/loa/a2a/flatline/sdd-review.json` (3-model, 2026-05-27T17:39Z, 100% agreement):

### HIGH_CONSENSUS (all 8 auto-integrated)

| ID | Avg Score | Integration |
|----|-----------|-------------|
| IMP-001 | 930 | §4.3 Hasura cutover REWRITTEN: atomic `replace_metadata` |
| IMP-002 | 907 | §3.3 `pending_emits` schema ADDED with deterministic IDs |
| IMP-003 | 887 | §6.2/6.3 Rollback scripts use `set -euo pipefail` + `${VAR:?}` defaults |
| IMP-004 | 867 | §8.7 Dual-publication overlap mitigation documented |
| IMP-005 | 875 | §5.3 `ponder.config.ts` `blocks:` declaration added explicitly |
| IMP-006 | 822 | §8.4 AC-3 expanded test list (relationships, permissions, subscriptions, aggregates, ordering, nullability) |
| IMP-007 | 772 | §8.5 Reorg drill with executable reset mechanics |
| IMP-008 | 782 | §13 OQ-3 promoted to Sprint A-0 spike (Hasura subscription continuity) |

### BLOCKERS (all 13 auto-integrated, 1 operator-decided)

| ID | Severity | Disposition |
|----|----------|-------------|
| SKP-001 (NATS DDOS) | CRITICAL (950) | §4.2 Historical sync gate via `isLiveEvent()` |
| SKP-002 (Hasura cutover dropping relationships) | CRITICAL (900) | §4.3 atomic `replace_metadata` |
| SKP-001 (Hasura non-transactional) | CRITICAL (880) | Same as above — single integration |
| SKP-001 (Rollback degraded) | CRITICAL (900) | OPERATOR-DECIDED 2026-05-27: snapshot-only rollback (§6.1, §12.5) |
| SKP-002 (Railway 24h cold-sync restart) | CRITICAL (860) | §7.3 separate `/live` and `/ready` |
| SKP-003 (BlockTick:block invalid syntax) | CRITICAL (830) | §5.3 corrected to `ponder.on("ethereum:block", fn)` + `blocks:` config |
| SKP-002 (Hasura cutover atomicity) | HIGH (760) | Same as #2 — single integration |
| SKP-004 (context.db.find invalid API) | HIGH (760) | §5.3 corrected to `context.db.select().from().where()` |
| SKP-003 (uint256 bigint overflow) | HIGH (750) | §3.2 `t.numeric(78, 0)` for token IDs |
| SKP-005 (Outbox publish/delete not transactional) | HIGH (745) | §5.3 outbox pattern with deterministic IDs + retry semantics |
| SKP-005 (Rollback false confidence) | HIGH (730) | §6.1 explicit ack; ADR-010 commitment |
| SKP-003 (GraphQL parity narrow) | HIGH (730) | §8.4 expanded test list |
| SKP-004 (Ponder API assumptions) | HIGH (705) | §11.1 Sprint A-0 verification spike — GATE for Phase A |

## 15. References

| Topic | Path |
|-------|------|
| PRD | `grimoires/loa/prd.md` |
| Flatline PRD review | `grimoires/loa/a2a/flatline/prd-review.json` |
| Flatline SDD review | `grimoires/loa/a2a/flatline/sdd-review.json` |
| Ponder spike (PERSISTED) | `grimoires/loa/spikes/ponder-2026-05-27/{spike-a,spike-b}` |
| Session-6 derisk synthesis | `grimoires/loa/specs/cluster-events-pillar-v1/session-6-empirical-derisk.md` |
| Ponder docs | https://ponder.sh |
| Ponder API reference | https://ponder.sh/docs/api-reference/ponder/config |
| envio gate (the limit we're escaping) | `freeside-sonar/node_modules/envio/src/sources/RpcSource.res:326-376` |
| Path-ε runbook | `grimoires/loa/specs/cluster-events-pillar-v1/go-live-path-epsilon-railway-nats.md` |
| Memory: cluster-substrate vision | `project_erpc-postgres-becomes-hypersync` |
| Memory: sovereign-aggregator pattern | `project_sovereign-aggregator-substitution` |

## Status

Phase 4 (FLATLINE SDD REVIEW) — DRAFT COMPLETE with full Flatline v2 integration (8 HIGH_CONSENSUS + 13 BLOCKERS resolved). Ready for Phase 4.5 (RED TEAM SDD, config-gated off) or Phase 5 (PLANNING).
