# shadow-audit-api — deploy runbook

The Shadow Access Audit as its own deployable HTTP building. freeside-dashboard's
`access-audit/client.ts` consumes it (`GET ${SHADOW_AUDIT_API_URL}/v1/audit`) — the dashboard needs **zero
code change**, only its env pointed here.

## Environment

| Var | Required | What |
|-----|----------|------|
| `OPERATED_COMMUNITIES` | ✅ | comma-separated community names this deploy audits (dogfood-full eligible). A deployment with role-snapshot ingestion currently requires exactly one entry, so each community cannot accidentally read another community's store. |
| `CTA_PRODUCT`, `CTA_CONVERSATION` | ✅ | the product + conversation door URLs surfaced in the audit |
| `COLLECTION_REGISTRY` | ✅ | Deprecated break-glass JSON: `{ "<chain>/<contract>": { "collection": "<belt-gateway id>", "standard": "erc721"\|"erc1155", "union": "<logical collection key>" } }`. Maps each deployment to its query id and explicitly asserts which deployments form one logical collection. Zod-validated at boot; `union` is required because the query id is not globally unique. The 8 collection ids + their chains are live-grounded below; **the contract addresses are operator-supplied** (see the gate). |
| `ROLE_SNAPSHOT_INGEST_TOKENS` | when ingestion is enabled | JSON array containing the current token and, during rotation, the previous token. Configure the new token first, rotate exporters, then remove the old token. `ROLE_SNAPSHOT_INGEST_TOKEN` remains a single-token compatibility path. Never log either value. |
| `RPC_URL_<chain>` | ✅ (per registry chain) | JSON-RPC endpoint(s) per chain in the registry (e.g. `RPC_URL_80094`) for block-at-date resolution. **One url, or a comma-separated FAILOVER POOL** tried in order with retry+backoff — the free keyless endpoints each fail in their own way and there is no paid key (S5-T2). Boot fails if any registry chain lacks one, or if any entry is not a well-formed http(s) URL. |

**Verified free/keyless endpoints** (probed under the resolver's real load — genesis + 30-call burst). Pool at least two per chain:

| chain | endpoint | notes |
|---|---|---|
| 1 (ethereum) | `https://ethereum-rpc.publicnode.com` | ✅ `cloudflare-eth.com` passes from a laptop but is **REJECTED from Railway egress**; `rpc.ankr.com/eth` now needs a key; `eth.drpc.org` 408s on the genesis block only |
| 8453 (base) | `https://mainnet.base.org` | ✅ `base.drpc.org` was 0/20 |
| 10 (optimism) | `https://mainnet.optimism.io` | ✅ `optimism-rpc.publicnode.com` returns `null` for older (pruned) blocks — the pool fails over on a null block |
| 42161 (arbitrum) | `https://arbitrum.drpc.org` | ✅ |
| 80094 (berachain) | `https://berachain.drpc.org` | ✅ |

Example: `RPC_URL_1="https://ethereum-rpc.publicnode.com,https://eth.drpc.org"`
| `SHADOW_AUDIT_API_KEY` | ✅ **MANDATORY** (§12.3) | the `X-API-Key` the dashboard sends. Service **refuses startup** when absent. Generate: `openssl rand -hex 32`. Set the same value in the dashboard's `SHADOW_AUDIT_API_KEY`. For local dev only: set `SHADOW_AUDIT_ALLOW_ANON=dev-only` (never in production). |
| `BELT_GATEWAY_URL` | optional | sonar GraphQL endpoint (defaults to belt-gateway-production) |
| `ROLE_SNAPSHOT_PATH` | optional | path to the Discord role-export JSON (absent → audits refuse external-mode) |
| `ROLE_SNAPSHOT_STORE` | required for durable ingestion | `postgres` in Railway; `file` is the local-development fallback |
| `DATABASE_URL` | required when snapshot store is `postgres` | private Postgres connection URL; injected from the Railway database resource |
| `ROLE_SNAPSHOT_DIR` | optional for `file` only | local snapshot directory (default `./data/role-snapshots`); container-local files do not survive a Railway deploy replacement |
| `CONFIRMATIONS` | optional | reorg finality depth (default 12; one source for both sonar + the "current" block) |
| `AUDIT_K` | optional | k-anonymity threshold (default 5; **must be a positive integer** — `AUDIT_K=0` is rejected, it would disable k-anon) |
| `PORT` | optional | bind port (Railway sets it; default 3040) |

The server **fails loud at boot** on any missing/invalid required value — it never serves a half-wired audit.
When ingestion uses Postgres, startup creates the latest-snapshot table before binding HTTP. The table keeps
one validated snapshot per `(community, canonical collection)` and replaces it only with a strictly newer
capture. Snapshot rows contain member identifiers, wallets, and role IDs; keep the database private, do not
expose `DATABASE_URL`, and treat database exports/backups as sensitive operator data.
The ingest route admits at most two concurrent bodies per process (about 40 MiB worst-case aggregate
buffering); exporters must retry `429 ingest-busy` responses using `Retry-After`.
The public teaser reconstruction budget is shared across replicas but partitioned by canonical collection,
whose key space is bounded by the boot-validated registry. A flood against one collection cannot exhaust
the budget for unrelated collections; the bounded cache is LRU and sweeps expired entries before eviction.

### Contract deploy order

This release adds `drift` to coverage-refusal responses and permits an explicit
`whale_concentration: null`. The strict dashboard consumer must land first.

1. Merge and deploy `0xHoneyJar/freeside-dashboard#213` (nullable concentration and
   refusal drift, merged as `e679fe1723b036ba81478885d7621b7dd9048a5a`) and
   `0xHoneyJar/freeside-dashboard#214` (protocol-version lock, merged as
   `f8cd69ff90b6e1f7aa92c348fdfc53efa20cf8fe`), and
   `0xHoneyJar/freeside-dashboard#215` (suppressed turnover privacy, merged as
   `636a7c827cb1b39401784bdddd69d87854072fa5`).
2. Verify protocol CI passes the machine-readable strict-consumer pin in
   `fixtures/dashboard-consumer-lock.json` (commit, source hash, version, success and refusal shapes).
3. Deploy this shadow-audit service revision.
4. Before routing traffic, require `/healthz` to return
   `{"ok":true,"shadow_audit_protocol_version":"2"}`. A missing or different
   version is a failed deployment, not a request-time hash mismatch.

Do not reverse the order: an older dashboard rejects additive fields because it
uses excess-property errors. Rolling back the service is safe after the dashboard
consumer lands; rolling back the dashboard first is not.

### Live-grounded auditable set (belt-gateway `CollectionStat`, queried 2026-06-29)

The belt-gateway reconstructs ownership keyed on `(collection id, chainId)` — it stores **no contract
address**, so the registry's contract addresses are the operator's to supply (from the deployment records).
These are the exact `(collection, chain)` pairs that have indexed supply and are therefore auditable:

| collection id | chains (chainId) | standard |
|---|---|---|
| `HoneyJar1` | eth (1), bera (80094) | erc721 |
| `HoneyJar2` | **arb (42161)**, bera (80094), eth (1) | erc721 |
| `HoneyJar3` | **zora (7777777)**, bera (80094) | erc721 |
| `HoneyJar4` | **op (10)**, bera (80094), eth (1) | erc721 |
| `HoneyJar5` | **base (8453)**, bera (80094), eth (1) | erc721 |
| `HoneyJar6` | eth (1), bera (80094) | erc721 |
| `Honeycomb` | eth (1), bera (80094) | erc721 |
| `crayons_factory` | (in Transfer; absent from CollectionStat — confirm chain + standard) | ? |

So a registry entry is `"<chainId>/<contract-address-on-that-chain>": { "collection": "HoneyJar5", "standard": "erc721", "union": "thj:HoneyJar5" }`. Deployments are reconstructed together only when they share the explicit `union` key; matching belt-gateway `collection` strings alone never establish identity.
Each generation has a canonical chain (bolded) **plus** a Berachain bridge; include only the `(chain, contract)`
pairs the audited communities actually gate on. `crayons_factory` and per-collection token standards still need
operator confirmation (it indexes Transfers but has no CollectionStat row).

## Railway

`railway.toml` is set (Dockerfile builder, healthcheck `/healthz`). Set in the service settings: Root Directory
`packages/services/shadow-audit`, Build Context = repo root. The Dockerfile builds `@freeside/adapters`
(the service resolves `@freeside/adapters/sonar` from its dist) then runs via `tsx bin/http.ts`.

## 🚨 LIVE-CORRECTNESS GATE (money/ops — do this BEFORE pointing the dashboard at it)

The unit suite (105 tests) proves the algorithm + assembly with injected fakes — **NOT** the live values. A
wrong `COLLECTION_REGISTRY` mapping or RPC ⇒ a wrong holder set ⇒ a wrong audit (wrong access decisions).

1. **Collection mapping** — verify each `collection` id against the live belt-gateway (a Transfer query that
   matches nothing = a typo'd id = an empty, silently-wrong audit). `pnpm -C packages/adapters test:live`
   exercises the real reconstruction.
2. **RPC block-at-date** — spot-check one chain: pick a known date, confirm the resolved snapshot block's
   timestamp is ≤ that date's UTC end and the next block's is >.
3. **Smoke the real GET** — `curl "$URL/v1/audit?chain=80094&contract=<honeycomb>&snapshot_date=<known>&community=<thj>&owner_wallet=<addr>&threshold=1"`
   and sanity-check the aggregate against a known holder count.
4. **Then** set the dashboard's `SHADOW_AUDIT_API_URL` (+ `_KEY`) and the seam goes live. The dashboard
   strict-decodes the response against the protocol `AuditOutputSchema`; the contract-parity test in
   `src/__tests__/server.test.ts` pins that the GET output matches it.

V2 (the authed `POST /v1/audit` named-output, SIWE) is fail-closed (always 401) until wired.
