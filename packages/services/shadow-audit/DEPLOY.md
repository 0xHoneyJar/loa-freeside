# shadow-audit-api — deploy runbook

The Shadow Access Audit as its own deployable HTTP building. freeside-dashboard's
`access-audit/client.ts` consumes it (`GET ${SHADOW_AUDIT_API_URL}/v1/audit`) — the dashboard needs **zero
code change**, only its env pointed here.

## Environment

| Var | Required | What |
|-----|----------|------|
| `OPERATED_COMMUNITIES` | ✅ | comma-separated community names this deploy audits (dogfood-full eligible) |
| `CTA_PRODUCT`, `CTA_CONVERSATION` | ✅ | the product + conversation door URLs surfaced in the audit |
| `COLLECTION_REGISTRY` | ✅ | JSON: `{ "<chain>/<contract>": { "collection": "<belt-gateway id>", "standard": "erc721"\|"erc1155" } }` — **the 8 THJ collections** (HoneyJar1/3/4/6 + Honeycomb + crayons_factory @ 80094, HoneyJar2 @ 42161, HoneyJar5 @ 8453). Zod-validated at boot. |
| `RPC_URL_<chain>` | ✅ (per registry chain) | a JSON-RPC endpoint per chain in the registry (e.g. `RPC_URL_80094`) for block-at-date resolution. Boot fails if any registry chain lacks one. |
| `SHADOW_AUDIT_API_KEY` | optional | the `X-API-Key` the dashboard sends (when unset the k-anon aggregate is open). Set it + the dashboard's `SHADOW_AUDIT_API_KEY`. |
| `BELT_GATEWAY_URL` | optional | sonar GraphQL endpoint (defaults to belt-gateway-production) |
| `ROLE_SNAPSHOT_PATH` | optional | path to the Discord role-export JSON (absent → audits refuse external-mode) |
| `CONFIRMATIONS` | optional | reorg finality depth (default 12; one source for both sonar + the "current" block) |
| `AUDIT_K` | optional | k-anonymity threshold (default 5; **must be a positive integer** — `AUDIT_K=0` is rejected, it would disable k-anon) |
| `PORT` | optional | bind port (Railway sets it; default 3040) |

The server **fails loud at boot** on any missing/invalid required value — it never serves a half-wired audit.

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
