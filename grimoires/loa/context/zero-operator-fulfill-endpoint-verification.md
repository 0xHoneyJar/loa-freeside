# T-0.2 — Open Questions Verification: Zero-Operator Fulfillment

> **Sprint:** `zero-operator-fulfill`
> **Task:** T-0.2 pre-implementation grounding
> **Date:** 2026-07-05
> **Source:** Sprint.md §T-0.2; verified against live source (`packages/services/ordering/src/`, `packages/protocol/ordering/src/`)

---

## Q1 — score-api metadata-snapshot GET endpoint

**Disposition:** CONFIRMED as implementation contract; SDD-compliant probe written.

The probe implementation at `packages/services/ordering/src/http-building-probes.ts:151–173` hits:

```
GET /v1/communities/metadata-snapshot?chain_id=<chain>&contract_address=<contract>
Authorization: Bearer <SERVICE_TOKEN>
```

Status mapping (D11.2):
| HTTP | Body signal | `IngredientStatus` |
|------|-------------|-------------------|
| 200  | `{ status: 'complete' }` | `complete` |
| 200  | `{ status: 'in_progress' }` | `in_progress` |
| 200  | other / unknown body | `pending` |
| 404  | — | `pending` |
| network error / non-2xx other | — | `blocked` |

**NF-6 degradation:** When `METADATA_SNAPSHOT_ENABLED=false`, `KitchenTriagePorts` wires
`metadata.probe` to return `'optional'` without hitting the endpoint; `canFulfillCommunityOnboarding`
passes immediately. See `packages/services/ordering/src/kitchen-triage-ports.ts:57–60`.

---

## Q2 — score-api idempotent POST for snapshot dispatch

**Disposition:** CONFIRMED. Implementation at `packages/services/ordering/src/http-building-probes.ts:176–200`.

```
POST /v1/communities/metadata-snapshot
Authorization: Bearer <SERVICE_TOKEN>
Content-Type: application/json
Idempotency-Key: <orderId>:metadata_snapshot

Body: { chain_id, contract_address, order_id, source }
```

The `Idempotency-Key: <orderId>:metadata_snapshot` header is always sent regardless of whether
the score-api endpoint supports it natively (D12.2 / SDD Q2 fallback). A 200 or 202 is considered
`ok: true`; any other status or network error is `ok: false` (no re-throw — caller retries on next tick).

---

## Q3 — Discord observer channel-health GET endpoint

**Disposition:** CONFIRMED as implementation contract; NF-6 D13.3 fallback documented.

The implementation at `packages/services/ordering/src/http-building-probes.ts:209–231` hits:

```
GET /v1/channels/health?chain_id=<chain>&contract_address=<contract>
Authorization: Bearer <SERVICE_TOKEN>
```

Expected response shape: `{ healthy: boolean; reason?: string }`.

**NF-6 degradation (D13.3):** When `DISCORD_OBSERVER_API_URL` is absent, `KitchenTriagePorts`
does not wire `discordHealth` (port is `undefined`). The fulfillment orchestrator advance loop
checks `deps.discordHealth?.checkChannelHealth(...)` — when port is absent, defaults to
`{ healthy: true }` and advances with a `console.warn`. This is deterministic and documented
(not a silent stall). See `packages/services/ordering/src/fulfillment-orchestrator.ts`.

---

## Q4 — Shadow-audit GET endpoint existence

**Disposition:** CONFIRMED as implementation contract. Real probe at `packages/services/ordering/src/http-building-probes.ts:114–137`.

```
GET /v1/collections/:chainId/:contractAddress
(no auth required — open membership read)
```

Expected response shape when indexed: `{ collection: string; standard: string }`.

Status mapping:
| HTTP | Body | `IngredientStatus` |
|------|------|--------------------|
| 200  | `{ collection: string, standard: string }` | `complete` |
| 200  | malformed / missing fields | `blocked` (FAGAN S3 — never trust bare 200) |
| 404  | — | `pending` |
| other / network error | — | `blocked` |

**Liveness note:** At T-0.2 grounding time, no deployed shadow-audit service is visible in
`packages/freeside-registry/registry.yaml` (registry-absent, unprobeable). The probe is wired
but only activates when `SHADOW_AUDIT_API_URL` is set. Absent env var → shadow_preview falls to
`SHADOW_PREVIEW_UNAVAILABLE_POLICY` (default `'blocked'`).

The cross-repo pre-task (shadow-audit endpoint) from the sprint plan is NOT blocking this cycle:
`probeShadow` handles absence cleanly via the policy knob. Track endpoint availability on bead
`arrakis-r3kr` (shadow-audit producer-decision).

---

## Q5 — Live `SHADOW_AUDIT_API_URL` value

**Disposition:** ABSENT at T-0.2 grounding — fallback D9.3/policy path applies.

No `SHADOW_AUDIT_API_URL` value is confirmed set in the Railway ordering service environment at
sprint start. Until the shadow-audit service is deployed and the env var is set:

- `HttpBuildingProbes.hasShadowProbe === false`
- `KitchenTriagePorts.shadow.probe` returns the `SHADOW_PREVIEW_UNAVAILABLE_POLICY` result
- Default policy: `'blocked'` (operator must manually advance `shadow_preview` or set `SHADOW_PREVIEW_UNAVAILABLE_POLICY=optional`)

**Action for T-9:** Set `SHADOW_AUDIT_API_URL=<shadow-audit-base-url>` when the shadow-audit
service is deployed and its GET `/v1/collections/:chain/:contract` endpoint is live. Until then,
operate with the policy knob.

---

## Summary

| Q  | Status | Fallback active |
|----|--------|----------------|
| Q1 — score-api metadata-snapshot GET | Confirmed (implementation contract; 404→pending handles absence) | `METADATA_SNAPSHOT_ENABLED=false` → `optional` |
| Q2 — score-api idempotent POST | Confirmed (`Idempotency-Key` always sent) | N/A |
| Q3 — discord-observer channel-health GET | Confirmed (implementation contract) | Port absent → skip gate + `console.warn` |
| Q4 — shadow-audit GET endpoint | Confirmed implementation contract; not yet deployed | `SHADOW_AUDIT_API_URL` absent → policy governs |
| Q5 — Live `SHADOW_AUDIT_API_URL` | **ABSENT** — deferred until shadow-audit deploys | `SHADOW_PREVIEW_UNAVAILABLE_POLICY` (default `blocked`) |
