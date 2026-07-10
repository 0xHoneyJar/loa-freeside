# OPERATOR: shadow-audit-api — Railway deploy runbook

Sprint 2 Task 2.5 · §12.3 compliant · 2026-07-09

This service is the Shadow Access Audit's deployable HTTP building. freeside-dashboard's dormant
`access-audit/client.ts` (`GET ${SHADOW_AUDIT_API_URL}/v1/audit`) consumes it once you point the env here.

---

## 1. Railway service creation (from this monolith)

The service is Dockerfile-based. Railway needs to build from the **repo root** (not the subdir) because the
Dockerfile stages `packages/core` → `packages/adapters` → `packages/services/shadow-audit`.

```bash
# In the Railway project for the target environment (staging / production):
railway service create shadow-audit-api
```

In the service settings (Railway UI → Settings → Build):

| Field | Value |
|-------|-------|
| **Root Directory** | `packages/services/shadow-audit` |
| **Build Context** | *(leave blank — Railway defaults to repo root, which is correct)* |
| **Dockerfile Path** | `packages/services/shadow-audit/Dockerfile` |
| **Start Command** | `pnpm start` |
| **Health Check Path** | `/healthz` |
| **Health Check Timeout** | `30` |
| **Restart Policy** | `ON_FAILURE` (max 3 retries) |

`railway.toml` already encodes the Dockerfile builder and healthcheck — no override needed if Railway reads it.

---

## 2. Environment checklist (copy-pasteable)

Set all of these in the Railway service's Variables panel before first deploy.

### Required (service refuses startup when any is absent)

```bash
# Communities this deploy audits (comma-separated; dogfood-full eligible)
OPERATED_COMMUNITIES=thj

# CTA door URLs surfaced in the audit output
CTA_PRODUCT=https://thehoneyjars.io
CTA_CONVERSATION=https://discord.gg/...

# Collection registry — JSON mapping (chain/contract) → (belt-gateway collection id + token standard)
# Each key is "<chainId>/<contract-address>", all lowercase.
# The eight auditable belt-gateway collection ids (live-grounded 2026-06-29):
#   HoneyJar1  HoneyJar2  HoneyJar3  HoneyJar4  HoneyJar5  HoneyJar6  Honeycomb  crayons_factory
# Contract addresses are operator-supplied — verify against the deployment records before setting.
COLLECTION_REGISTRY='{"80094/0x<bera-honeycomb>":{"collection":"Honeycomb","standard":"erc721"}}'

# JSON-RPC endpoint per registry chain (one var per chain, suffix = chainId).
# Boot fails if any registry chain lacks its RPC_URL_<chain> var.
RPC_URL_80094=https://rpc.berachain.com/
# RPC_URL_1=https://mainnet.infura.io/v3/<key>      # add per chain in COLLECTION_REGISTRY
# RPC_URL_42161=...                                   # etc.

# §12.3 — MANDATORY: shared secret the dashboard's X-API-Key header sends.
# Service REFUSES STARTUP when absent. Generate once:
SHADOW_AUDIT_API_KEY=$(openssl rand -hex 32)
# Set the identical value in freeside-dashboard's env as SHADOW_AUDIT_API_KEY.
```

### Optional (safe defaults)

```bash
# Belt-gateway sonar GraphQL endpoint (defaults to the production belt-gateway URL)
# BELT_GATEWAY_URL=https://belt-gateway....

# Path to the Discord role-export JSON (absent → audits refuse external-mode for all communities)
# ROLE_SNAPSHOT_PATH=/data/roles.json

# Reorg finality depth — one value for both sonar and the "current" block (default 12)
# CONFIRMATIONS=12

# k-anonymity threshold (default 5; must be a positive integer — 0 rejected, disables k-anon)
# AUDIT_K=5

# Port (Railway sets $PORT automatically; default 3040 for local dev)
# PORT=3040
```

---

## 3. API key generation

```bash
# Generate a cryptographically random 32-byte (256-bit) key:
openssl rand -hex 32
# → e.g. a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1

# Set in Railway (shadow-audit-api service):
SHADOW_AUDIT_API_KEY=<the generated value>

# Set the same value in freeside-dashboard's Railway service:
SHADOW_AUDIT_API_KEY=<the generated value>
SHADOW_AUDIT_API_URL=https://<shadow-audit-api-railway-domain>
SHADOW_AUDIT_ENABLED=true
```

Key rotation: generate a new key, update both services simultaneously (brief dual-key window not supported —
Railway's atomic redeploy is the safest approach: update dashboard key first, then the api key + redeploy api).

---

## 4. TLS

Railway terminates TLS. The service binds HTTP on `$PORT`; Railway's reverse proxy handles HTTPS. No TLS
config in the service itself. Verify the deployed URL starts with `https://` before pointing the dashboard.

---

## 5. Live-correctness spot-check (money/ops gate — run BEFORE going live)

The unit suite (175 tests) proves the algorithm with injected fakes — NOT the live values. A wrong
`COLLECTION_REGISTRY` mapping or RPC endpoint → wrong holder set → wrong audit.

```bash
# 1. Verify the RPC block-at-date (pick a known date + chain):
curl -s -X POST "$RPC_URL_80094" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["latest",false],"id":1}' \
  | jq '.result.timestamp'

# 2. Smoke the real GET audit (replace placeholders with real values):
curl -s \
  -H "X-API-Key: $SHADOW_AUDIT_API_KEY" \
  "https://<railway-domain>/v1/audit?chain=80094&contract=<honeycomb-contract>&snapshot_date=2026-06-01&community=thj&owner_wallet=<known-holder>&threshold=1" \
  | jq '{mode,run_id,inputs_hash,counts:.counts}'

# A 200 with run_id + mode=dogfood-full confirms the seam is live.
# A wrong collection id → empty transfer set → counts all zero (silently wrong audit).
# Verify counts against a known holder set before enabling dashboard consumption.

# 3. Healthcheck:
curl -s "https://<railway-domain>/healthz"
# → {"ok":true}
```

---

## 6. One-line rollback

```bash
# Option A: disable in the dashboard (no traffic to the api; api stays deployed)
railway variables set SHADOW_AUDIT_ENABLED=false --service freeside-dashboard

# Option B: delete the service entirely (irreversible — recreate from this runbook)
railway service delete shadow-audit-api
```

---

## 7. Local dev bypass

`SHADOW_AUDIT_API_KEY` is mandatory in production. For local development only:

```bash
# Never use this in production or staging — it disables all auth.
SHADOW_AUDIT_ALLOW_ANON=dev-only pnpm -C packages/services/shadow-audit start
```

The service logs a WARNING at boot when this escape is active.
