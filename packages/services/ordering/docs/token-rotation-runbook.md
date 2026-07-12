# Ordering-Service Token Rotation Runbook (NFR-8c)

The ordering write token (`SERVICE_TOKEN`, alias `ORDERING_SERVICE_TOKEN`) is
**single-purpose** (NFR-8a): it gates ONLY the ordering-service write routes
(`POST /v1/orders/:id/advance-ingredient`, `POST /v1/orders/:id/reprobe`). It must
never be shared with any other service surface.

## Known consumers

| Consumer | Where the token lives | Env var |
|----------|----------------------|---------|
| **freeside-dashboard** (Vercel) | Vercel project env (server-only) | `ORDERING_SERVICE_TOKEN` |
| **freeside-cli** (agents + operator) | Shell/session env | `ORDERING_SERVICE_TOKEN` |

The service reads it on Railway (`ordering-service` project, production env) as `SERVICE_TOKEN`.

## Rotation procedure (issue → update consumers → revoke)

1. **Issue** — generate a new token: `openssl rand -hex 32`.
2. **Add on the service** — set the NEW value as `SERVICE_TOKEN` in Railway
   (ordering-service → production → Variables) and redeploy. There is a single-token
   window: old-token consumers get 401 from this moment until step 3 — coordinate
   or accept the brief write-path gap (reads are unaffected).
3. **Update consumers** — set the new value in Vercel (freeside-dashboard →
   `ORDERING_SERVICE_TOKEN`) and redeploy; distribute to agent/operator shells.
4. **Revoke** — the old value is dead once step 2 lands (single-slot token). Purge it
   from any shell profiles or notes.
5. **Verify** — `curl -X POST .../v1/orders/<any>/reprobe -H "Authorization: Bearer $OLD"`
   → 401; with `$NEW` → 200/404. Dashboard smoke: place a shadow-audit order (NFR-7).

## Audit identity

Every advance records `token_label` (env `SERVICE_TOKEN_LABEL`, default
`ordering-service-token`) in `operator_audit` (NFR-8b). When rotating, optionally bump
the label (e.g. `ordering-token-2026-07`) so audit entries date the credential era.

## Fail-closed reminder (FR-10a)

In deployed environments (RAILWAY_ENVIRONMENT / NODE_ENV=production) the service
REFUSES to mount write routes when `SERVICE_TOKEN` is unset — a botched rotation
degrades to read-only, never to an open write path. `/healthz` shows
`write_routes: disabled_no_token` in that state.
