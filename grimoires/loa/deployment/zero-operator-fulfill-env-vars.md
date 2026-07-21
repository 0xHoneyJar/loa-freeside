# T-9 — Railway Env Vars Runbook: Zero-Operator Fulfillment

> **Sprint:** `zero-operator-fulfill`
> **Task:** T-9 Railway Environment Ops
> **Date:** 2026-07-05
> **Service:** `ordering-service` on Railway (https://ordering-service-production.up.railway.app)

---

## Env Var Inventory

| Var | Required | Value | Purpose |
|-----|----------|-------|---------|
| `KITCHEN_PROBE_HTTP_ENABLED` | **YES** (precondition) | `true` | Activates all real HTTP probes. If unset, `httpBuildingProbesFromEnv()` returns `null` and ALL probes fall back to stub. Must be confirmed set BEFORE deploying new vars. |
| `SHADOW_AUDIT_API_URL` | Conditional | `<shadow-audit-base-url>` | Wires the real `probeShadow` call. Absent → shadow_preview governed by `SHADOW_PREVIEW_UNAVAILABLE_POLICY`. |
| `SHADOW_PREVIEW_UNAVAILABLE_POLICY` | Optional | `blocked` (default) or `optional` | When `SHADOW_AUDIT_API_URL` is absent, controls shadow_preview fallback. `optional` lets fulfillment proceed without a preview; `blocked` (default) requires manual operator advance. |
| `METADATA_SNAPSHOT_ENABLED` | Optional | `true` (default) or `false` | When `false`, `metadata_snapshot` initializes to `optional` and the gate passes without a real probe (D11.4 fast-follow path). Default `true`. |
| `DISCORD_OBSERVER_API_URL` | Optional | `<discord-observer-base-url>` | Wires the real `checkDiscordChannelHealth` call. Absent → `discordHealth` port is `undefined`; advance loop skips health gate and warns. |
| `SCORE_API_URL` | Required | Already set | Used by metadata-snapshot probe and dispatch endpoints. |
| `SONAR_API_URL` | Required | Already set | Used by sonar probe and ingest. |
| `WORLDS_API_URL` | Required | Already set | Used by worlds probe and manifest dispatch. |
| `SERVICE_TOKEN` | Required | Already set | Bearer token for all upstream HTTP calls. |

---

## Deployment Checklist

### Pre-Deploy

- [ ] Confirm `KITCHEN_PROBE_HTTP_ENABLED=true` is already set in Railway ordering service. **This is the precondition** — if unset, no probe change takes effect.
- [ ] Confirm `SERVICE_TOKEN`, `SCORE_API_URL`, `SONAR_API_URL`, `WORLDS_API_URL` are set.
- [ ] Verify `/healthz` returns healthy before proceeding.

### FR-1 — shadow_preview Real Probe (AC-2, AC-3)

1. Deploy shadow-audit service and verify `GET /v1/collections/:chainId/:contractAddress` responds (200 or 404) for a test collection.
2. Set `SHADOW_AUDIT_API_URL=<shadow-audit-base-url>` in Railway ordering service.
3. Remove or leave `SHADOW_PREVIEW_UNAVAILABLE_POLICY` at default (`blocked`).
4. Smoke test: POST a community-onboarding test order; on the next orchestrator tick, observe `shadow_preview` probe result in logs — should be `pending` (not indexed) or `complete` (indexed), not the stub `blocked`.

**Rollback:** Remove `SHADOW_AUDIT_API_URL`. Shadow falls back to policy (default `blocked`). Zero downtime.

### FR-2 — metadata_snapshot Probe + Dispatch (AC-6, AC-7)

Default: `METADATA_SNAPSHOT_ENABLED` is unset (treated as `true`). No action needed unless the score-api metadata-snapshot endpoint is not yet deployed.

If the score-api endpoint is absent:
1. Set `METADATA_SNAPSHOT_ENABLED=false` in Railway ordering service.
2. `metadata_snapshot` initializes to `optional` for new orders; `canFulfillCommunityOnboarding` passes without a probe.
3. Track on bead for fast-follow once score-api ships the endpoint.

**Rollback:** Remove `METADATA_SNAPSHOT_ENABLED` (or set to `true`). Probe re-activates on next tick.

### FR-3 — discord_observer Channel-Health Gate (AC-9, AC-10)

If a discord-observer service with `/v1/channels/health` is deployed:
1. Set `DISCORD_OBSERVER_API_URL=<discord-observer-base-url>`.
2. Channel-health gate activates for all orders with `discord_observer` advancing to `complete`.

If the endpoint is absent:
- Leave `DISCORD_OBSERVER_API_URL` unset. The `discordHealth` port is absent; orchestrator skips the health gate and advances with `console.warn` (documented D13.3 fallback — deterministic, not a silent stall).

**Rollback:** Remove `DISCORD_OBSERVER_API_URL`. Gate reverts to skip-with-warn. Zero downtime.

---

## Post-Deploy Verification

- [ ] `GET /healthz` on ordering service returns 200 after env var update.
- [ ] Manual smoke: POST a community-onboarding order; observe `probe_meta.source` for `shadow_preview` shows `source: 'interval'` after first orchestrator tick (not the initial `'placed'` state).
- [ ] `shadow_preview` probes as `pending` (collection not indexed in shadow-audit) or `complete` (indexed), NOT the stub `blocked` — confirmed by checking `probe_meta` in the order state response.
- [ ] No new NATS streams, DB migrations, or Railway services were introduced (AC-12). ✓ Verified at implementation time.

---

## Fallback Behavior Reference

| Condition | `shadow_preview` | `metadata_snapshot` | `discord_observer` health gate |
|-----------|-----------------|--------------------|---------------------------------|
| `KITCHEN_PROBE_HTTP_ENABLED` unset | stub `blocked` | stays `pending` (no dispatch) | skipped (no port) |
| `SHADOW_AUDIT_API_URL` absent | policy (`blocked` or `optional`) | (independent) | (independent) |
| `METADATA_SNAPSHOT_ENABLED=false` | (independent) | initializes `optional`; gate passes | (independent) |
| `DISCORD_OBSERVER_API_URL` absent | (independent) | (independent) | skip gate + `console.warn` (AC-10) |

All fallbacks are deterministic and documented. No silent stalls.
