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
| `SONAR_API_URL` | optional | capability resolver hint (stub triage ignores live calls in MVP) |
| `SCORE_API_URL` | optional | capability resolver hint |
| `WORLDS_API_URL` | optional | capability resolver hint |
| `CTA_PRODUCT`, `CTA_CONVERSATION` | optional | CTA URLs in lifecycle metadata (defaults freeside.app) |

**Store:** in-memory for internal demo. Restarts drop orders. Postgres `OrderStore` is Sprint 4.

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
