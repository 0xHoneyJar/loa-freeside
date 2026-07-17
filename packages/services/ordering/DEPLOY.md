# ordering-service — deploy runbook (internal demo)

HTTP order intake for **Preset #2 `community-onboarding`**. The freeside-dashboard onboarding
adapter consumes it when `ORDERING_SERVICE_URL` is set.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/v1/collection-resolutions` | `Bearer $SERVICE_TOKEN` (when set) | CR-006 create resolution session via Sonar resolve-probe |
| POST | `/v1/collection-resolutions/:id/confirm` | `Bearer $SERVICE_TOKEN` (when set) | Confirm selection (CAS + idempotency) |
| POST | `/v1/collection-resolutions/:id/refresh` | `Bearer $SERVICE_TOKEN` (when set) | Refresh probe; preserve selection or `selection_stale` |
| GET | `/healthz` | none | Railway healthcheck; reports `write_routes: open_dev\|token\|disabled_no_token` |
| POST | `/v1/orders` | none (MVP) | Place order → `{ order_id }`; unknown product → 400 + `available_presets` |
| GET | `/v1/orders/:id` | none (MVP) | Poll state + ingredients + `probe_meta` (public projection) |
| POST | `/v1/orders/:id/advance-ingredient` | `Bearer $SERVICE_TOKEN` | Operator/agent advance. Optional body field `caller_note` (≤120 chars, untrusted display metadata). Audit entry records server-derived `token_label` + `evidence` (probe_meta snapshot, `null` if never probed) |
| POST | `/v1/orders/:id/reprobe` | `Bearer $SERVICE_TOKEN` | On-demand fresh probe. Body `{ "ingredient"?: "sonar"\|… }` (absent = all pending/in_progress). 10s per-order cooldown → `429` + `retry_after_unix`. Probe failure/timeout reported IN the body as per-ingredient `freshness: "ambiguous"`, never a 5xx. `409` if order terminal |

**Fail-closed (FR-10a)**: in deployed environments (`RAILWAY_ENVIRONMENT` set or `NODE_ENV=production`)
with no `SERVICE_TOKEN`, the two POST write routes are **not mounted** — reads and `/healthz` stay up,
and `/healthz` shows `write_routes: "disabled_no_token"`. If advance/reprobe 404 in prod, check the
token env first. Rotation: `docs/token-rotation-runbook.md`.

## Environment

| Var | Required | What |
|-----|----------|------|
| `PORT` | Railway sets | bind port (default 8090 local) |
| `SERVICE_TOKEN` or `ORDERING_SERVICE_TOKEN` | recommended (required for writes in deployed envs — fail-closed) | Bearer for `advance-ingredient` + `reprobe`; dashboard sends same value as `ORDERING_SERVICE_TOKEN` on POST/GET |
| `SERVICE_TOKEN_LABEL` | optional | Names the credential in `operator_audit.token_label` (default `ordering-service-token`); bump on rotation to date the credential era |
| `SONAR_API_URL` | optional | kitchen-api base URL when K3 HTTP probes enabled (e.g. `https://kitchen-api-production-1937.up.railway.app`) |
| `SCORE_API_URL` | optional | score-api base URL for community lookup/register (default `https://score.0xhoneyjar.xyz`) |
| `WORLDS_API_URL` | optional | worlds-api base URL for manifest lookup/create |
| `CTA_PRODUCT`, `CTA_CONVERSATION` | optional | CTA URLs in lifecycle metadata (defaults freeside.app) |
| `ORDER_OPS_WEBHOOK_URL` | optional | Fire-and-forget POST when a `community-onboarding` order is placed. Second POST when triage issues are filed (`community_onboarding.ingredients_enqueued`). |
| `DATABASE_URL` | recommended (kitchen K0) | Postgres store — orders survive restart |
| `RUN_MIGRATIONS` | optional | Set `true` on deploy to apply `migrations/*.sql` (001 orders, 002 probe_meta) |
| `GITHUB_TOKEN` | required for kitchen K1 | PAT with `issues:write` on kitchen repos |
| `KITCHEN_ISSUE_REPO_SONAR` | optional | Default `0xHoneyJar/sonar-api` |
| `KITCHEN_ISSUE_REPO_SCORE` | optional | Default `0xHoneyJar/score-api` |
| `KITCHEN_ISSUE_REPO_WORLDS` | optional | Default `0xHoneyJar/worlds-api` |
| `KITCHEN_ENQUEUE_ENABLED` | optional | Default `true`; set `false` to disable issue fan-out |
| `KITCHEN_PROBE_HTTP_ENABLED` | optional | Set `true` to probe sonar/score/worlds via HTTP instead of stub pending |
| `KITCHEN_HTTP_ENQUEUE_ENABLED` | optional | Default enabled when `KITCHEN_PROBE_HTTP_ENABLED=true`; set `false` to probe-only (no HTTP register/manifest/ingest) |
| `ENABLE_REPROBE` | optional | Set `true` on http service to run reprobe loop in-process |
| `KITCHEN_REPROBE_INTERVAL_SEC` | optional | Default `900` (15 min) |

**Store:** Postgres when `DATABASE_URL` set; otherwise in-memory (local dev only).

### Operator webhook payload (example)

```json
{
  "event": "community_onboarding.placed",
  "order_id": "541da59c-0a31-4830-9dd3-aa9a16f30317",
  "placed_by": "dashboard_onboarding",
  "contact_email": "cm@team.example",
  "contract_address": "0xcccccccccccccccccccccccccccccccccccccccc",
  "chain_id": "1",
  "community_name": "Internal Demo",
  "placed_at": "2026-07-01T00:20:23.000Z",
  "text": "New community-onboarding order 541da59c-...: cm@team.example (Internal Demo) · 0xcccc... on chain 1"
}
```

Set `ORDER_OPS_WEBHOOK_URL` on Railway to a Slack incoming webhook URL or any JSON POST endpoint.

## Railway

1. New service in loa-freeside project
2. Root Directory: `packages/services/ordering`
3. Build Context: repo root (or rely on `railway.toml` dockerfilePath)
4. Set `SERVICE_TOKEN` to a long random secret
5. Deploy → note public URL `https://<service>.up.railway.app`

## freeside-dashboard (Vercel)

Set server-only env vars and redeploy:

```
ORDERING_SERVICE_URL=https://<service>.up.railway.app
ORDERING_SERVICE_TOKEN=<same as SERVICE_TOKEN>
APP_URL=https://<dashboard-host>
```

Smoke:

```bash
curl -sS https://<service>.up.railway.app/healthz
curl -sS -X POST https://<dashboard>/api/onboarding/orders/shadow-audit \
  -H 'Content-Type: application/json' \
  -d '{"contactEmail":"you@team.example","contractAddress":"0xcccccccccccccccccccccccccccccccccccccccc","chainId":"1"}'
```

Expect `"liveQueue": true` in the response.

## Operator triage (advance ingredients)

```bash
curl -sS -X POST "$ORDERING_SERVICE_URL/v1/orders/$ORDER_ID/advance-ingredient" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ingredient":"sonar","status":"complete"}'
```

Repeat for `score`, `worlds_manifest`, then `shadow_preview` with `world_slug` on the last advance when fulfilling.
