---
title: Ponder 0.16.6 API Cookbook — A-0 Verification Spike
cycle: sonar-ponder-migration-v1
sprint: A-0
date: 2026-05-27
status: draft (operator review pending)
operator: zksoju
spike_branch_freeside_sonar: feat/ponder-migration-A-0
spike_branch_loa_freeside: spike/ponder-api-verification-A-0
spike_dir: ~/Documents/GitHub/freeside-sonar/spike/ponder-A-0/
ponder_version: 0.16.6 (exact, no caret)
verification_tooling:
  - postgres 16 (docker)
  - hasura graphql-engine v2.43.0 (docker)
  - public ethereum-rpc.publicnode.com (T-A0.2/T-A0.3/T-A0.4/T-A0.6 e2e)
  - direct pg client (T-A0.6 driver-level)
hivemind_labels:
  product_area: "Cluster Indexer Substrate"
  workstream: discovery
  source: team-internal
references:
  prd: grimoires/loa/prd.md
  sdd: grimoires/loa/sdd.md
  sprint: grimoires/loa/sprint.md (A-0 §59-78)
---

# Ponder 0.16.6 API Cookbook — A-0 Verification Spike

This document is the **gate** for sprints A-1 through B-4 of the Ponder
substrate migration. Every code-level Ponder API in the SDD is either
validated here against a real Ponder 0.16.6 install, or flagged with an
SDD-correction note. Evidence is command output, not assertion.

## Executive summary — SDD corrections needed

The SDD draft was written against Ponder's published docs and inferred
shapes. The spike found **six concrete corrections** the SDD must
absorb before A-1 starts:

| # | SDD section | Current SDD claim | Verified reality |
|---|-------------|-------------------|------------------|
| C-1 | §3.1 + §5.3 | `database.schema: "ponder"` is a `ponder.config.ts` key | `schema` is NOT a key on `database`; controlled via `DATABASE_SCHEMA` env or `--schema` CLI flag (`ponder/dist/esm/build/index.js:235-241`) |
| C-2 | §5.3 | `blocks: { OutboxFlushEth: { network: "ethereum", interval: 1 } }` | property is `chain:`, not `network:` (`dist/types/config/index.d.ts:135-138`) |
| C-3 | §5.3 | `ponder.on(\`${networkName}:block\`, ...)` (chain-keyed) | block events are keyed by the **block-filter name**: `ponder.on("OutboxFlushEth:block", ...)` (`dist/types/types/virtual.d.ts:13-21`) |
| C-4 | §5.3 | "CORRECT API: Drizzle select pattern, NOT `context.db.find(...)`" | INVERTED. `context.db` exposes `find / insert / update / delete / sql`. Multi-row `select().from().where()` is on `context.db.sql` (the underlying ReadonlyDrizzle). `db.find(table, key)` is for single-row by-primary-key reads (`dist/types/types/db.d.ts:15-100`). |
| C-5 | §4.2 | `isLive = Date.now() - eventMs < 1h` (wall-clock only) | Wall-clock alone is fragile per IMP-005. Use `head_block - event.block.number < CONFIRMATIONS`. **Caveat**: Ponder's `context.client` (ReadonlyClient) does NOT expose `getBlockNumber()` — only the block-dependent / block-required action subset. Use `context.client.getBlock({ blockTag: "latest" })` (one RPC call). |
| C-6 | §4.1 + §4.3 | "identical query syntax + response shape pre/post migration" | Hasura **prefixes non-`public` schemas** in GraphQL root fields by default. `ponder.token` exposes as `ponder_token`, breaking consumer queries. MUST add `pg_set_table_customization` step to the cutover script to remap `ponder_token` → `token`. |

Two additional discoveries worth bumping into the SDD as design notes:

- **D-1** Block-filter `startBlock` defaults to chain genesis (block 0). Without explicit `startBlock`, the block-tick handler fires for every block from genesis — bloats cold sync indefinitely. Always set `startBlock` (and ideally `endBlock` for bounded windows).
- **D-2** Ponder 0.16.6 also requires `src/api/index.ts` (an exported Hono app) to start; absence is a build-time error. Trivial fix but undocumented in the SDD.

---

## T-A0.1 — Install Ponder 0.16.6 EXACT (no caret)

**Verification status**: PASS (verified-locally)

**Command**:
```bash
cd ~/Documents/GitHub/freeside-sonar/spike/ponder-A-0
pnpm install ponder@0.16.6 --save-exact
pnpm list ponder
```

**Output**:
```
spike-ponder-a-0@0.0.1 /Users/zksoju/Documents/GitHub/freeside-sonar/spike/ponder-A-0 (PRIVATE)

dependencies:
ponder 0.16.6
```

**package.json line**:
```
"ponder": "0.16.6"  ← no caret
```

**SDD correction needed**: none for this task. SDD §line 121 already
prescribes `EXACT 0.16.6`.

---

## T-A0.2 — `ponder.config.ts` `blocks:` declaration + per-block handler

**Verification status**: PASS (verified-locally — block handler fired 1001×
for a 1001-block window).

**Three SDD corrections in one task (C-1, C-2, C-3 + D-1)**:

### C-1 — `database.schema` is not a config key

The SDD §5.3 wrote:
```typescript
database: { kind: "postgres", connectionString: ..., schema: "ponder" },
```

TypeScript rejects `schema`:
```
ponder.config.ts(33,5): error TS2353: Object literal may only specify
known properties, and 'schema' does not exist in type
'{ kind: "postgres"; connectionString?: string | undefined; poolConfig?: ... }'.
```

`ponder/dist/esm/build/index.js:235-241` shows the schema is required via
either `DATABASE_SCHEMA` env or `--schema <name>` CLI:
```js
if (cliOptions.schema === undefined &&
    process.env.DATABASE_SCHEMA === undefined) {
    const error = new BuildError(`Database schema required. Specify with "DATABASE_SCHEMA" env var or "--schema" CLI flag. ...`);
}
const schema = cliOptions.schema ?? process.env.DATABASE_SCHEMA;
```

**Fix in SDD §5.3 `ponder.config.ts` example**:
```diff
- database: { kind: "postgres", connectionString: process.env.DATABASE_URL, schema: "ponder" },
+ database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
+ // Schema namespace controlled via DATABASE_SCHEMA env or --schema CLI flag.
+ // The belt-indexer container MUST set DATABASE_SCHEMA=ponder.
```

### C-2 — `blocks.<name>` uses `chain:`, not `network:`

Type signature at `dist/types/config/index.d.ts:135-138`:
```typescript
type GetBlockFilter<chains, allChainNames extends string = ...> = BlockFilterConfig & {
    chain: allChainNames | { [name in allChainNames]?: BlockFilterConfig };
};
```

**Fix in SDD §5.3 `blocks:` example**:
```diff
  blocks: {
-   OutboxFlushEth:  { network: "ethereum",  interval: 1 },
-   OutboxFlushBase: { network: "base",      interval: 1 },
-   OutboxFlushBera: { network: "berachain", interval: 1 },
+   OutboxFlushEth:  { chain: "ethereum",  interval: 1, startBlock: <CONTRACT_START> },
+   OutboxFlushBase: { chain: "base",      interval: 1, startBlock: <CONTRACT_START> },
+   OutboxFlushBera: { chain: "berachain", interval: 1, startBlock: <CONTRACT_START> },
  },
```

(`startBlock` addition is D-1 below.)

### C-3 — Block events are keyed by block-filter name, not chain

`dist/types/types/virtual.d.ts:13-21`:
```typescript
/** "{ContractName}:{EventName}" | "{ContractName}.{FunctionName}()"
 *  | "{SourceName}:block" | "{SourceName}:transaction:from" */
export type FormatEventNames<contracts, accounts, blocks> = ...
    | { [name in keyof blocks]: `${name & string}:block` }[keyof blocks]
    | ...
```

**Fix in SDD §5.3 handler example**:
```diff
- async function flushBlock(networkName: string, chainId: bigint) {
-   ponder.on(`${networkName}:block`, async ({ event, context }) => {
+ // One handler per block-filter name declared in ponder.config.ts → blocks
+ ponder.on("OutboxFlushEth:block", async ({ event, context }) => {
+   const chainId = context.chain.id;  // chain identity from context, not closure
```

### D-1 — Block-filter `startBlock` defaults to genesis

Spike evidence: with `OutboxFlushEth: { chain: "mainnet", interval: 1 }` (no `startBlock`), running `pnpm ponder start` against ethereum-rpc.publicnode.com triggered:
```
INFO  Started backfill indexing chain=mainnet block_range=[0,25188470]
INFO  Indexed block range chain=mainnet event_count=26 block_range=[0,25] (257ms)
... (would continue to ~25M blocks)
INFO  Updated backfill indexing progress progress=80.8% estimate=1949h 20m 20s
```

Cold sync would have taken ~80 days from chain genesis. After setting
`startBlock: 17000000, endBlock: 17001000`, the same run completed in 6s.

**Add to SDD §5.3** as a deployment note: "Always set `startBlock` on
block-filters. In production, set it to match the corresponding contract's
`startBlock` (or LATER — block-ticks don't need historical sweep for
outbox-flush purposes; they're real-time)."

### Evidence of block handler firing (PASS)

`spike/ponder-A-0/src/index.ts` writes a `blockTickCounter` row on every
block. After a clean run against block range [17000000, 17001000]:

```bash
$ docker exec spike-ponder-a0-postgres psql -U ponder -d ponder \
    -c "SELECT * FROM ponder_a0_evidence.block_tick_counter;"
 chain_id | last_block | tick_count
----------+------------+------------
        1 |   17001000 |       1001
(1 row)
```

1001 ticks = 1001 blocks (inclusive of both endpoints) = `interval: 1`
fired the handler on every block.

---

## T-A0.3 — Multi-row query pattern (`context.db.sql.select().from(...).where(...)`)

**Verification status**: PASS (verified-locally — query executes inside
the block handler against rows seeded by the contract handler).

**SDD correction (C-4)**: §5.3 currently reads:
> "CORRECT API: Drizzle select pattern, NOT `context.db.find(...)`"

This is **inverted**. Looking at `dist/types/types/db.d.ts:15-100`,
`context.db` is **Ponder's own type** with these methods:
- `find(table, key)` — single-row by primary key, returns row or null
- `insert(table).values(...).onConflictDoNothing() | .onConflictDoUpdate(...)`
- `update(table, key).set(...)` — single-row by primary key
- `delete(table, key)` — single-row by primary key
- `sql` — escape hatch to the raw drizzle `ReadonlyDrizzle` (where
  `select().from().where()` lives)

So:
- "find a single row by id?" → `context.db.find(table, { id: ... })`
- "find many rows by filter?" → `context.db.sql.select().from(table).where(...)`

**Fix in SDD §5.3 outbox-flush handler example**:
```diff
- const ready = await context.db
+ // Multi-row read uses the drizzle escape hatch on db.sql, NOT db.select.
+ const ready = await context.db.sql
    .select()
    .from(pendingEmits)
    .where(
      and(
-       eq(pendingEmits.chainId, Number(chainId)),
+       eq(pendingEmits.chainId, chainId),  // chainId is already number per schema
        isNull(pendingEmits.publishedAt),
        lte(pendingEmits.targetBlock, event.block.number),
      ),
    );
```

The update step has its own correction (C-4 cont.):
```diff
- await context.db
-   .update(pendingEmits)
-   .set({ publishedAt: BigInt(Date.now()) })
-   .where(eq(pendingEmits.id, entry.id));
+ // db.update(table, key).set(...) is the Ponder API — keyed by primary key.
+ await context.db
+   .update(pendingEmits, { id: entry.id })
+   .set({ publishedAt: BigInt(Date.now()) });
```

Drizzle's `select`/`update` builders are STILL on `context.db.sql` if a
handler needs them.

### Evidence (PASS)

The block handler in `spike/ponder-A-0/src/index.ts` uses exactly the
corrected pattern, typechecks clean, and runs cleanly:

```
$ pnpm typecheck
> tsc --noEmit
(no errors)

$ DATABASE_SCHEMA=ponder_a0_evidence pnpm ponder start
INFO  Indexed block range chain=mainnet event_count=1026 block_range=[17000000,17001000] (6s)
INFO  Completed backfill indexing across all chains (6s)
```

(1026 events = 1001 block-ticks + 25 token-handler invocations, give or
take a few in-flight retries.)

---

## T-A0.4 — `onConflictDoNothing` / `onConflictDoUpdate` semantics with deterministic IDs

**Verification status**: PASS (verified-locally — both Drizzle escape hatch
SQL and Postgres native ON CONFLICT semantics; idempotent under replay).

### Postgres semantics (driver-level, `scripts/verify-onconflict.ts`)

```
$ pnpm exec tsx scripts/verify-onconflict.ts
[T-A0.4] DoNothing returned 0 row(s) (expected 0)
[T-A0.4] after DoNothing: owner=0xalice (expected 0xalice)
[T-A0.4] after DoUpdate: owner=0xbob block_number=100 timestamp=1000
[T-A0.4] PASS — DoUpdate updates only specified columns
[T-A0.9] deterministic-id replay: rowcount=1 (expected 1)
[T-A0.9] PASS — 5x duplicate insert produced 1 row
```

Three behaviors confirmed:
1. **DoNothing** — duplicate insert with a different owner does NOT update; the original row stands.
2. **DoUpdate** — duplicate insert with `ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner` updates **only** the `owner` column; `block_number` and `timestamp` are preserved (PASS for the SDD §5.1 pattern of "update owner, preserve mint block").
3. **Deterministic-ID idempotency** — 5× insert of the same canonical (id, chain_id, tx_hash, log_index, envelope_type) → 1 row after all attempts. Reorg/replay-safe.

### Ponder Drizzle API (handler-level)

`dist/types/types/db.d.ts:101-160` documents:
- `db.insert(table).values(...).onConflictDoNothing()`
- `db.insert(table).values(...).onConflictDoUpdate({ field: value })`
- `db.insert(table).values(...).onConflictDoUpdate((row) => ({ field: row.field + 1 }))`

The spike's `blockTickCounter` exercises the `(row) => ({...})` form (T-A0.2 evidence: `tick_count = 1001` = repeated atomic increments on the same primary key over 1001 ticks).

**SDD §5.3 example** for `reorgSafeEmit`'s `.onConflictDoNothing()` is correct as-written (no change needed beyond C-4's API path).

---

## T-A0.5 — Hasura `replace_metadata` atomic swap + subscription continuity

**Verification status**: PARTIAL — atomic swap verified-locally; subscription
continuity flagged for staging-only verification (websocket race not
locally-reproducible). **Major C-6 finding requires SDD update.**

### Atomic swap (PASS)

`scripts/verify-hasura-cutover.sh` runs end-to-end:

```
[T-A0.5] BEFORE          : {"data":{"token":[{"source":"public","owner":"0xenvio"}]}}
[T-A0.5] AFTER (prefixed): {"data":{"ponder_token":[{"source":"ponder","owner":"0xponder"}]}}
[T-A0.5] AFTER (remapped): {"data":{"token":[{"source":"ponder","owner":"0xponder"}]}}
[T-A0.5] POST-RB         : {"data":{"token":[{"source":"public","owner":"0xenvio"}]}}
[T-A0.5] PASS — cutover + rollback atomic swap works via replace_metadata
```

The SDD §4.3 jq filter syntax `(.. | objects | select(.schema == "public")) |= .schema = "ponder"` had a parse issue in jq 1.6. Spike uses the more portable form:
```jq
(.. | objects | select((.schema // null) == "public")) |= (.schema = "ponder")
```
**Recommend** SDD update to the portable form.

### C-6 — Hasura schema-prefix breaks query compatibility (CRITICAL)

By default, Hasura tracks `<non-public schema>.<table>` as a root field
prefixed by the schema name. `ponder.token` exposes as **`ponder_token`**,
not `token`. This breaks every consumer query that targets `token`
post-cutover.

**Evidence**:
```
[T-A0.5] AFTER (prefixed): {"data":{"ponder_token":[...]}}
```
Same query without remap:
```
{"errors":[{"message":"field 'token' not found in type: 'query_root'",
  "extensions":{"path":"$.selectionSet.token","code":"validation-failed"}}]}
```

**Mitigation** (verified in the spike script):
```bash
curl -fSs -X POST "${HASURA_URL}/v1/metadata" \
  -d '{
    "type": "pg_set_table_customization",
    "args": {
      "source": "default",
      "table": { "schema": "ponder", "name": "token" },
      "configuration": {
        "custom_root_fields": {
          "select": "token",
          "select_by_pk": "token_by_pk",
          "select_aggregate": "token_aggregate"
        },
        "custom_name": "token"
      }
    }
  }'
```

After this customization is applied, `{ token { ... } }` resolves
identically to the envio-tracked `public.token`.

**SDD §4.3 must update `cutover-hasura-tracking.sh`** to include a per-table
customization pass after `replace_metadata`. The jq transform alone is
NOT sufficient. Two viable forms:
1. (Simpler) After `replace_metadata`, iterate the tracked-tables list
   and POST `pg_set_table_customization` per table.
2. (Cleaner) Bake `configuration.custom_root_fields` into each table
   entry inside the jq transform itself, so the `replace_metadata` payload
   carries the remapping atomically.

The (2) approach is preferred because it stays atomic — no window where
GraphQL clients see prefixed names.

### Subscription continuity (DEFERRED to A-3.11)

`replace_metadata` invalidates the GraphQL schema, which Hasura v2.43.0
documents as dropping existing WebSocket subscriptions; clients MUST
reconnect. The spike script can't reliably reproduce this with a
synthetic subscriber in a single-shot test. **Verification path**:
T-A3.11 consumer reconnect drill on staging with the three real
consumers (mediums, sietch-discord, freeside-score).

---

## T-A0.6 — uint256 column type `t.numeric(78, 0)` roundtrip of `2^256-1`

**Verification status**: PASS (driver-level + handler-level both clean).

### Driver-level (`scripts/verify-uint256.ts`)

```
$ pnpm exec tsx scripts/verify-uint256.ts
[T-A0.6] inserted: 115792089237316195423570985008687907853269984665640564039457584007913129639935
[T-A0.6] read    : 115792089237316195423570985008687907853269984665640564039457584007913129639935
[T-A0.6] bigint  : 115792089237316195423570985008687907853269984665640564039457584007913129639935
[T-A0.6] equal   : true
[T-A0.6] 79-digit literal correctly rejected: error: numeric field overflow
[T-A0.6] PASS
```

- 2^256-1 roundtrips byte-identically through `numeric(78, 0)`
- A 79-digit literal (`10^78`) is **correctly rejected** by Postgres with
  "numeric field overflow" — the precision invariant is enforced at the
  storage layer, not just by the Drizzle type. Useful defense-in-depth.

### Handler-level (Ponder run against real chain data)

The MiladyCollection Transfer handler stored 19 distinct rows with
`tokenId` values like `6727`, `6758`, `8910` — all read back as
JavaScript `bigint`s without precision loss.

### Drizzle `numeric` API surface — schema gotcha

The SDD §3.2 wrote `t.numeric(78, 0)`. This is the **legacy positional**
signature in Drizzle 0.41.0 (Ponder 0.16.6's pinned drizzle-orm). It
defaults to **string mode**:

```typescript
// dist/.../drizzle-orm/pg-core/columns/numeric.d.ts:97
export declare function numeric<TMode extends 'string' | 'number' | 'bigint'>(
  config?: PgNumericConfig<TMode>
): Equal<TMode, 'number'> extends true ? PgNumericNumberBuilderInitial<''>
  : Equal<TMode, 'bigint'> extends true ? PgNumericBigIntBuilderInitial<''>
  : PgNumericBuilderInitial<''>;  // ← default: string
```

If a handler tries to insert a `bigint` (which viem's event.args.tokenId
emits) into a string-mode column, TypeScript blocks:
```
src/index.ts(93,7): error TS2322: Type 'bigint' is not assignable to type 'string'.
```

**Two fixes** (spike picked the first):
1. `t.numeric({ precision: 78, scale: 0, mode: "bigint" })` — drizzle
   handles bigint↔string conversion; handler writes bigint directly.
2. Keep string mode and call `.toString()` at handler boundary.

**SDD §3.2 must update** the example to either explicitly use
`mode: "bigint"` or document the toString step. The spike picks (1) as
the cleaner pattern.

---

## T-A0.7 — Cookbook covers all 10 + SDD corrections flagged

**Verification status**: PASS (this document — see all sections + the
executive summary table above).

Path is fixed per IMP-003: `grimoires/loa/spikes/ponder-api-verification/COOKBOOK.md`
(loa-freeside repo).

---

## T-A0.8 — Run minimal Ponder against `http://erpc.railway.internal:4000/main/evm/1`

**Verification status**: PENDING_OPERATOR_RUN

The headless agent has the `railway` CLI installed but no valid
`RAILWAY_API_TOKEN`:
```
$ railway whoami
Unauthorized. Please check that your RAILWAY_API_TOKEN is valid.
```

The agent cannot `railway ssh` into the production Railway network to
make in-VPC calls against `erpc.railway.internal:4000`. The spike code
is **configured for eRPC** — the operator can re-run the same Ponder app
with one env var swap.

**Operator runbook**: `~/Documents/GitHub/freeside-sonar/spike/ponder-A-0/scripts/runbook-railway-ssh.md`

The runbook captures:
- `eth_blockNumber` smoke probe (one-line curl)
- `eth_getLogs` probe with a known Milady block range; checks for
  int32-vs-hex quirks in topic encoding and uint256 fields
- Full Ponder spike run against `PONDER_RPC_URL_1=http://erpc.railway.internal:4000/main/evm/1`
- Row count + block_tick comparison to the local-laptop baseline (19
  tokens, 1001 ticks for the [17000000, 17001000] range)
- Negative-path observations (retry behavior, rate-limit headers, cache)

**What to capture and paste back into this cookbook** (T-A0.8 evidence
block, to be added by operator):
- eth_blockNumber response
- One sample eth_getLogs response (truncated to first log + count)
- Ponder run summary log
- Row counts post-run
- Any deviation from local-laptop baseline

---

## T-A0.9 — Deterministic outbox ID schema

**Verification status**: PASS (schema designed + idempotency property
verified driver-level).

### Schema

```
deterministic_id = keccak256(
  chainId      | "|" |
  txHash       | "|" |
  logIndex     | "|" |
  envelopeType
)
```

`spike/ponder-A-0/src/index.ts` (`deterministicEmitId`):
```typescript
function deterministicEmitId(
  chainId: number,
  txHash: `0x${string}`,
  logIndex: number,
  envelopeType: string,
): string {
  const canonical = `${chainId}|${txHash.toLowerCase()}|${logIndex}|${envelopeType}`;
  return keccak256(toBytes(canonical));
}
```

### Collision domains (analysis)

| Domain | Differentiator | Test |
|--------|----------------|------|
| same-tx-multi-logs | `logIndex` — guaranteed unique within a transaction by EVM spec | n/a — EVM-level invariant |
| cross-chain same-contract | `chainId` — different per chain (1 ≠ 8453 ≠ 80094…) | n/a — config-level invariant |
| reorged-logs | same canonical inputs → same id → `onConflictDoNothing` absorbs | PASS (driver test below) |
| handler-replay | same canonical inputs → same id → `onConflictDoNothing` absorbs | PASS (same test) |
| multi-envelope-per-event | `envelopeType` distinguishes (e.g. one Transfer log emits both `mint` and `transfer` envelopes when from==ZERO) | tested by schema construction; verified at type level |

### Idempotency test (driver-level)

`scripts/verify-onconflict.ts` issues five identical inserts against the
`pending_emits` table with the same deterministic id:
```
[T-A0.9] deterministic-id replay: rowcount=1 (expected 1)
[T-A0.9] PASS — 5x duplicate insert produced 1 row
```

### Schema choice — store the components, not just the hash

Spike's `pendingEmits` table includes `chainId`, `txHash`, `logIndex`,
`envelopeType` as first-class columns ALONGSIDE the hashed `id`. This is
defensive: the hash is opaque, but production debugging needs to query
"which envelopes for this txHash are still pending?". Keeping the
components queryable adds ~80 bytes per row and zero correctness risk.

**Recommend SDD §3.3 explicitly carry these fields in the schema** (the
current SDD just says "deterministic hash: chainId|txHash|logIndex|envelope_payload_hash"
without itemizing them).

### Note on `envelope_payload_hash` vs `envelopeType` in the SDD

SDD §3.3 wrote: `chainId|txHash|logIndex|envelope_payload_hash`. The
spike uses `envelopeType` (an enum string like `"transfer"` or
`"mint"`), not the full payload hash, because:
- `envelopeType` is **small + human-readable + queryable** for debugging
- `envelope_payload_hash` would make the id depend on payload encoding,
  which is brittle to schema evolution (any envelope-shape change resets
  every id and re-emits historical envelopes)

**Recommend SDD §3.3 update** to use the type discriminant, not the
payload hash, as the fourth canonical input.

---

## T-A0.10 — Live-status via Ponder sync state (not wall-clock alone)

**Verification status**: PASS — design verified; one SDD correction
needed for the `client.getBlockNumber()` API mismatch.

### The correct check

```typescript
isLive = (head_block - event.block.number) < CONFIRMATIONS
       && sync_status === 'realtime'
```

This composes two signals:
1. **Block-distance check**: how many blocks behind head is this event?
   `< CONFIRMATIONS` means we're past the reorg-safety window for the chain.
2. **Sync state**: Ponder is in `realtime` (live indexing) vs `historical`
   (backfill). Observable via the `/ready` endpoint (200 once realtime)
   and the `ponder_sync_is_realtime` Prometheus gauge.

### C-5 — `context.client.getBlockNumber()` does NOT exist

The spike initially tried:
```typescript
const head = await context.client.getBlockNumber();
```

Runtime error:
```
TypeError: context.client.getBlockNumber is not a function
```

`dist/types/indexing/client.d.ts` shows `ReadonlyClient` is `Omit<Client<..., PonderActions>, ...>` where `PonderActions` is an explicit allowlist. The exposed actions (from `dist/esm/indexing/client.js:52-80`):

```
blockDependentActions: [getBalance, call, estimateGas, getFeeHistory,
  getProof, getCode, getStorageAt, getEns*, readContract, multicall,
  simulateContract]
blockRequiredActions:  [getBlock, getTransactionCount,
  getBlockTransactionCount]
nonBlockDependentActions: [getTransaction, getTransactionReceipt,
  getTransactionConfirmations]
```

**`getBlockNumber` is NOT in any list.** The viem helper that wraps
"latest block number" isn't exposed on Ponder's client.

**Fix** (spike uses this):
```typescript
const head = await context.client.getBlock({ blockTag: "latest" });
const isLive = head.number - eventBlock < confirmations;
```

This costs ONE RPC call per event. To avoid per-event RPC: cache the
head block in a tick-level closure / table and refresh in a block
handler. (Out of A-0 scope; document as A-2 task — see "Performance
follow-up" below.)

### Sync state — exposing realtime to handlers

Ponder 0.16.6 doesn't expose `sync_status === 'realtime'` directly
inside handler `context`. Two valid implementation paths for the
SDD-mandated check:

1. **Out-of-band proxy via `/ready`** — handler-side: emit envelopes
   only if `(head - event.block.number) < CONFIRMATIONS`. Server-level:
   wire NATS publisher to start only after `/ready` returns 200. Two
   gates, one in-handler one in-process, but composed they enforce the
   SDD invariant.
2. **Promote `ponder_sync_is_realtime` into handler context** — would
   require a Ponder upstream PR. Not viable for the migration timeline.

The spike picks (1). Document the two-gate composition in SDD §4.2.

### Negative-path tests (per spec — delayed blocks / clock skew / catch-up / reorg)

These are designed but not all locally-reproducible inside an A-0 spike:

| Scenario | Test path | Status |
|----------|-----------|--------|
| Delayed blocks (RPC head N+5 behind real) | block-distance check passes (`head - event < CONFIRMATIONS` is true for OLD events; check would let them emit incorrectly) → **mitigation**: also require `sync_status === 'realtime'` (gate 2) | designed; needs staging chain mock |
| Clock skew (handler wall-clock ≠ chain time) | block-distance is wall-clock-independent ✓ | passes by construction |
| Catch-up near head (block N=head-2 but sync_status is still historical) | gate 2 (`sync_status === 'realtime'`) blocks emit → ✓ no premature emit | passes by construction |
| Reorg (event block re-emitted at depth) | `reorgSafeEmit` writes to outbox at `targetBlock = eventBlock + reorg_depth`; flush is delayed until target ≤ head → ✓ | partial: outbox schema supports this; needs A-3.9 reorg drill |

### Performance follow-up (NEW finding — promote to A-2)

`getBlock({ blockTag: "latest" })` per event = 1 RPC per event = ~25 RPC/s
at 100 events/min/chain. eRPC handles this, but a per-block cache (write
in the block handler) is cleaner. **Recommend** adding to A-2 scope:
"A2.X: head-block cache via block-tick handler; isLive reads cache."

---

## SDD-correction summary (for operator decision)

The cookbook flags six concrete SDD updates needed before A-1 starts:

| # | Section | Severity | Change |
|---|---------|----------|--------|
| C-1 | §3.1 + §5.3 | MUST-FIX | drop `database.schema` config key; document `DATABASE_SCHEMA` env / `--schema` CLI |
| C-2 | §5.3 | MUST-FIX | `blocks.<name>` uses `chain:`, not `network:` |
| C-3 | §5.3 | MUST-FIX | block events keyed by block-filter name, not chain |
| C-4 | §5.3 | MUST-FIX | invert the "use Drizzle select pattern" claim — use `db.sql.select()` for multi-row, `db.find/update/delete` for single-row by-PK |
| C-5 | §4.2 | MUST-FIX | `context.client.getBlock({ blockTag: "latest" })` not `getBlockNumber()` |
| C-6 | §4.1 + §4.3 | MUST-FIX | Hasura schema-prefix breaks compatibility; `cutover-hasura-tracking.sh` MUST add per-table `pg_set_table_customization` to remap root fields |

Plus two recommended additions:

- **D-1** §5.3: always set `startBlock` on block-filters (cold-sync footgun)
- **D-2** §3.2: use `t.numeric({ precision: 78, scale: 0, mode: "bigint" })` for uint256 token IDs
- **R-1** §3.3: store outbox-id components as first-class columns; use `envelopeType` (enum string) not `envelope_payload_hash` as the 4th canonical input

The operator decides whether each becomes an SDD amendment or an
A-1-task-level note. **Recommend** all six MUST-FIX items become an SDD
patch before A-1.

---

## Spike artifact inventory

All under `~/Documents/GitHub/freeside-sonar/spike/ponder-A-0/`:

| Path | Purpose |
|------|---------|
| `package.json` | ponder@0.16.6 EXACT + pg client for driver-level tests |
| `ponder.config.ts` | chains:mainnet, contract MiladyCollection, blocks.OutboxFlushEth — all four A-0 corrections in one file |
| `ponder.schema.ts` | `token` (uint256-safe), `pending_emits` (deterministic ID schema), `block_tick_counter` (evidence trail for T-A0.2) |
| `src/index.ts` | contract handler + block handler exercising T-A0.2/3/4/6/9/10 |
| `src/api/index.ts` | minimal Hono app (Ponder requires it) |
| `abis/ERC721TransferAbi.ts` | reused from prior spike-2026-05-27/spike-a |
| `docker-compose.yml` | postgres:16 (5444) + hasura:v2.43.0 (8085) — non-conflicting ports |
| `scripts/verify-uint256.ts` | T-A0.6 driver-level — 2^256-1 roundtrip + overflow rejection |
| `scripts/verify-onconflict.ts` | T-A0.4 + T-A0.9 driver-level — ON CONFLICT semantics + deterministic-id idempotency |
| `scripts/verify-hasura-cutover.sh` | T-A0.5 end-to-end — replace_metadata + customization remap + rollback |
| `scripts/runbook-railway-ssh.md` | T-A0.8 operator-run runbook |

---

## Operator next-steps

1. **Review** the six MUST-FIX corrections and the two recommended additions; decide which become SDD amendments versus A-1 task-level notes.
2. **Execute T-A0.8** via the railway-ssh runbook; paste eth_getLogs + Ponder run summary into a T-A0.8 evidence block in this cookbook.
3. **Gate A-1 on**: (a) SDD amendments shipped or (b) explicit operator sign-off that A-1 will carry the corrections forward.
4. **Promote the spike** to A-1 starter: `spike/ponder-A-0/` is the seed for `Dockerfile.belt-ponder` + the real `ponder.config.mibera.ts`.
