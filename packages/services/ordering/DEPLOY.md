# ordering-service — deploy runbook (internal demo)

HTTP order intake for **Preset #2 `community-onboarding`**. The freeside-dashboard onboarding
adapter consumes it when `ORDERING_SERVICE_URL` is set.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/healthz` | none | Railway healthcheck |
| POST | `/v1/orders` | none (MVP) | Place order → `{ order_id }` |
| GET | `/v1/orders/:id` | none (MVP) | Poll state + ingredients |
| POST | `/v1/orders/:id/advance-ingredient` | `Bearer $SERVICE_TOKEN` when set | Operator triage |

## Environment

| Var | Required | What |
|-----|----------|------|
| `PORT` | Railway sets | bind port (default 8090 local) |
| `SERVICE_TOKEN` or `ORDERING_SERVICE_TOKEN` | recommended | Bearer for `advance-ingredient`; dashboard sends same value as `ORDERING_SERVICE_TOKEN` on POST/GET |
| `SONAR_API_URL` | optional | kitchen-api base URL when K3 HTTP probes enabled (e.g. `https://kitchen-api-production.up.railway.app` or belt-gateway with `/v1/collections` route) |
| `SCORE_API_URL` | optional | capability resolver hint |
| `WORLDS_API_URL` | optional | capability resolver hint |
| `CTA_PRODUCT`, `CTA_CONVERSATION` | optional | CTA URLs in lifecycle metadata (defaults freeside.app) |
| `ORDER_OPS_WEBHOOK_URL` | optional | Fire-and-forget POST when a `community-onboarding` order is placed. Second POST when triage issues are filed (`community_onboarding.ingredients_enqueued`). |
| `DATABASE_URL` | recommended (kitchen K0) | Postgres store — orders survive restart |
| `RUN_MIGRATIONS` | optional | Set `true` on deploy to apply `migrations/001_orders.sql` |
| `GITHUB_TOKEN` | required for kitchen K1 | PAT with `issues:write` on kitchen repos |
| `KITCHEN_ISSUE_REPO_SONAR` | optional | Default `0xHoneyJar/sonar-api` |
| `KITCHEN_ISSUE_REPO_SCORE` | optional | Default `0xHoneyJar/score-api` |
| `KITCHEN_ISSUE_REPO_WORLDS` | optional | Default `0xHoneyJar/worlds-api` |
| `KITCHEN_ENQUEUE_ENABLED` | optional | Default `true`; set `false` to disable issue fan-out |
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
