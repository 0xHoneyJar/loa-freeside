---
source_type: ai-autogen
use_label: usable
read_state: validated
as_of: 2026-07-17
generated_by: /ride hub-thinning fresh 2026-07-17
scope: hub-thinning
---

# Structure — Hub Thinning View (depth ≤4)

> CODE IS TRUTH · 2026-07-17. LOC/file counts exclude `node_modules`, `dist`, `target`, `.git`.
> One-line roles are **hub-thinning relevance** (keep / extract / already-extracted).

## Totals (focus)

| Area | Files | LOC | Hub role |
|---|---:|---:|---|
| `themes/sietch/src` | 653 | 186242 | Thick hub — primary thinning target |
| `apps/*` (5) | 209 | 51458 | Substrate + network runtimes |
| `packages/adapters` | 157 | 57293 | Platform adapters (keep) |
| `packages/services` | 192 | 32505 | Mixed: billing helpers stuck + shadow-audit product |
| `packages/core` | 30 | 9433 | Ports/contracts (keep) |
| `infrastructure` | 73 | 15297 | Platform substrate (keep) |

---

## `apps/` (depth-4)

```
apps/
├── gateway/                          # PLATFORM — Rust Discord shard pool → NATS (keep)
│   ├── src/
│   │   ├── main.rs                   # Entry: ShardPool + axum health (2123 LOC / 13 files app-wide)
│   │   ├── nats/                     # JetStream publisher
│   │   ├── shard/                    # Twilight shard pool
│   │   ├── health/ · metrics/ · events/
│   └── tests/
├── worker/                           # PLATFORM — NATS consumers + Discord REST (42457 LOC / 157 files)
│   └── src/
│       ├── main-nats.ts              # 4 consumers: command/event/eligibility/usage
│       ├── consumers/                # JetStream durable consumers
│       ├── handlers/ · jobs/ · services/
│       └── embeds/ · repositories/ · infrastructure/
├── ingestor/                         # PLATFORM — Discord Gateway → RabbitMQ, zero biz logic (2143 / 12)
│   └── src/
│       ├── index.ts · handlers.ts · publisher.ts · health.ts
├── mcp-gateway/                      # NETWORK — MCP federation Hono proxy (2725 / 15)
│   ├── bin/http.ts                   # serve() entry
│   └── src/
│       ├── app.ts                    # /:slug/* proxy + federation.json
│       ├── beacon-cache.ts · beacon-resolver.ts · tenants.ts
└── freeside-operator-dash/           # NETWORK-adjacent — events/operator UI (2010 / 12)
    ├── bin/ · src/
```

---

## `packages/` (depth-4, key dirs)

```
packages/
├── core/                             # PLATFORM contract — ports only (9433 / 30)
│   ├── ports/                        # IChainProvider, IAgentGateway, … (7211 / 23) KEEP
│   └── domain/
├── adapters/                         # PLATFORM execution adapters (57293 / 157) KEEP
│   ├── agent/                        # Budget/BYOK/SSE/ensemble (9409 / 37) — keep; HTTP mount stuck elsewhere
│   ├── chain/ · sonar/ · score/ · storage/
│   ├── coexistence/ · security/ · synthesis/ · themes/ · wizard/ · telemetry/
├── services/                         # MIXED — flat billing libs + product services (32505 / 192)
│   ├── credit-lot-service.ts         # EXTRACT w/ billing (~252)
│   ├── nowpayments-handler.ts        # EXTRACT w/ billing (~239)
│   ├── x402-settlement.ts            # EXTRACT w/ billing/agent pay (~292)
│   ├── conservation-guard.ts         # Travels w/ agent budget plane (~458)
│   ├── shadow-audit/                 # BUILDING product — own HTTP bin (9431 / 55) already extractable
│   │   ├── bin/http.ts
│   │   └── src/{server,http/audit-router,audit-service}.ts
│   ├── ordering/                     # BUILDING — order intake/orchestrator (8700 / 65)
│   └── shadow-mode/                  # L2 member-graph spine (4609 / 39)
├── freeside-registry/                # NETWORK — registry.yaml + federation (922 / 8) KEEP
├── freeside-cli/                     # NETWORK — list/inspect/doctor/order/kitchen/fulfill (4080 / 18) KEEP
│   ├── bin/freeside-cli.ts
│   └── src/verbs/
├── beacon-schema/                    # NETWORK — Beacon V2/V3 Effect schema (2241 / 12) KEEP
├── routes/                           # x402 Express router (701 / 3) — extract w/ payment surface
├── events/                           # ACVP event substrate (4407 / 31)
├── protocol/{shadow-audit,shadow-mode,ordering,eligibility}/  # Contract schemas
├── sandbox/ · shared/nats-schemas/ · dune-meter/ · cli/ · …
```

---

## `themes/sietch/src/` (key dirs only)

```
themes/sietch/src/                    # BUILDING-STUCK monolith host (186242 / 653)
├── index.ts                          # Express + Discord + Telegram boot
├── api/                              # HTTP product surface (32081 / 86) — thin first
│   ├── routes/                       # 54 route modules (~20008 LOC) — agent/billing/webhooks
│   │   ├── agents.routes.ts          # POST /api/agents/invoke|stream
│   │   ├── billing-routes.ts         # x402 topup + credit balance
│   │   ├── webhook.routes.ts         # NOWPayments payout IPN
│   │   ├── settlement.routes.ts      # Dixie x402 quote/settle
│   │   └── admin/ · dashboard/
│   ├── crypto-billing.routes.ts      # POST /crypto/webhook (NOWPayments)
│   └── middleware/                   # x402-middleware, webhook throttle
├── discord/                          # Mediums stuck (10076 / 36)
│   └── commands/agent.ts             # /agent slash
├── telegram/                         # Mediums stuck (2798 / 14)
│   └── commands/agent.ts             # /agent bot cmd
├── services/                         # Feature services (35583 / 109)
│   └── billing/                      # CryptoWebhookService etc (3034 / 7) EXTRACT → billing-api
├── packages/                         # Pre-extraction duplicate mass (71438 / 217) DELETE after cutover
│   ├── adapters/{billing,payment,chain,…}/
│   ├── core/{ports,billing,protocol}/
│   └── jobs/coexistence/
├── jobs/                             # Bull/coexistence workers (2852 / 19)
├── db/                               # SQLite + Drizzle schemas (16844 / 92)
├── trigger/                          # Trigger.dev schedules (814 / 10)
└── ui/                               # Dashboard builder (4327 / 48) — defer unless product extraction
```

---

## `infrastructure/` (depth-4)

```
infrastructure/                       # PLATFORM substrate (15297 / 73) KEEP
├── terraform/                        # AWS ECS/RDS/ElastiCache/ALB (14885 / 71)
│   ├── environments/{staging,production}/
│   ├── modules/world/
│   ├── freeside-storage/
│   ├── dns/ · ci-templates/ · docs/ · scripts/
├── observability/{grafana,prometheus,tempo}/
├── k8s/ · rabbitmq/ · scylladb/
├── alerts/ · dashboards/ · migrations/ · tests/
```

---

## Hub-thinning map (one glance)

| Keep in hub | Extract / already leaving | Debt to delete |
|---|---|---|
| `apps/{gateway,worker,ingestor}` | `themes/sietch/.../billing` → billing building | `themes/sietch/src/packages/**` duplicate |
| `packages/{core,adapters}` | discord/telegram mediums → worlds/mediums | Agent HTTP still on sietch Express |
| `apps/mcp-gateway` + `freeside-{cli,registry}` + `beacon-schema` | `packages/services/shadow-audit` (has bin) | Flat `packages/services/*` billing helpers once billing-api exists |
| `infrastructure/terraform` | `packages/services/ordering` (has bins) | — |
