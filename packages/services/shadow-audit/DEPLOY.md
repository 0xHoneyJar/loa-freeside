# shadow-audit-api — deploy runbook

The Shadow Access Audit as its own deployable HTTP building. freeside-dashboard's
`access-audit/client.ts` consumes it (`GET ${SHADOW_AUDIT_API_URL}/v1/audit`) — the dashboard needs **zero
code change**, only its env pointed here.

## Environment

| Var | Required | What |
|-----|----------|------|
| `OPERATED_COMMUNITIES` | ✅ | comma-separated community names this deploy audits (dogfood-full eligible) |
| `CTA_PRODUCT`, `CTA_CONVERSATION` | ✅ | the product + conversation door URLs surfaced in the audit |
| `COLLECTION_REGISTRY` | ✅ | JSON: `{ "<chain>/<contract>": { "collection": "<belt-gateway id>", "standard": "erc721"\|"erc1155" } }`. Maps each `(chainId, contract-address)` a caller passes → the belt-gateway **collection id**. Zod-validated at boot. The 8 collection ids + their chains are live-grounded below; **the contract addresses are operator-supplied** (see the gate). |
| `RPC_URL_<chain>` | ✅ (per registry chain) | a JSON-RPC endpoint per chain in the registry (e.g. `RPC_URL_80094`) for block-at-date resolution. Boot fails if any registry chain lacks one. |
| `SHADOW_AUDIT_API_KEY` | ✅ **MANDATORY** (§12.3) | the `X-API-Key` the dashboard sends. Service **refuses startup** when absent. Generate: `openssl rand -hex 32`. Set the same value in the dashboard's `SHADOW_AUDIT_API_KEY`. For local dev only: set `SHADOW_AUDIT_ALLOW_ANON=dev-only` (never in production). |
| `BELT_GATEWAY_URL` | optional | sonar GraphQL endpoint (defaults to belt-gateway-production) |
| `ROLE_SNAPSHOT_PATH` | optional | path to the Discord role-export JSON (absent → audits refuse external-mode) |
| `CONFIRMATIONS` | optional | reorg finality depth (default 12; one source for both sonar + the "current" block) |
| `AUDIT_K` | optional | k-anonymity threshold (default 5; **must be a positive integer** — `AUDIT_K=0` is rejected, it would disable k-anon) |
| `PORT` | optional | bind port (Railway sets it; default 3040) |

The server **fails loud at boot** on any missing/invalid required value — it never serves a half-wired audit.

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

So a registry entry is `"<chainId>/<contract-address-on-that-chain>": { "collection": "HoneyJar5", "standard": "erc721" }`.
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
