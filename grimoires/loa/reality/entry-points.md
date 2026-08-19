---
source_type: ai-autogen
use_label: usable
read_state: validated
as_of: 2026-07-17
generated_by: /ride hub-thinning fresh 2026-07-17
scope: hub-thinning
---

# Entry Points — Hub Thinning (file:line evidence)

> CODE IS TRUTH · 2026-07-17.
> Classification: **PLATFORM** (substrate) · **NETWORK** (discovery/deploy) · **BUILDING-STUCK** (building logic still in hub/monolith).

| Surface | Classification | Evidence | Notes |
|---|---|---|---|
| Agent REST invoke/stream | **BUILDING-STUCK** | `themes/sietch/src/api/routes/agents.routes.ts:214` `POST /api/agents/invoke`; `:246` `POST /api/agents/stream`; factory `createAgentRoutes` `:135` | Adapters live in PLATFORM (`packages/adapters/agent/factory.ts:45` `createAgentGateway`) but HTTP mount is on sietch Express |
| Discord `/agent` | **BUILDING-STUCK** | `themes/sietch/src/discord/commands/agent.ts:47` `agentCommand` SlashCommandBuilder; `:90` `handleAgentCommand` | Mediums/worlds not extracted (`themes/sietch`) |
| Telegram `/agent` | **BUILDING-STUCK** | `themes/sietch/src/telegram/commands/agent.ts:61` `handleAgentCommand`; `:200` `bot.command('agent', …)` | Same building debt |
| NOWPayments webhook | **BUILDING-STUCK** | `themes/sietch/src/api/crypto-billing.routes.ts:384` `POST /webhook` (`/crypto/webhook`); `:396` `x-nowpayments-sig`; `:423` `cryptoWebhookService.processEvent` | Service: `themes/sietch/src/services/billing/CryptoWebhookService.ts:139` verify / `:170` processEvent; ledger hook `packages/services/nowpayments-handler.ts:93` `createCreditLedgerHook` |
| NOWPayments payout webhook | **BUILDING-STUCK** | `themes/sietch/src/api/routes/webhook.routes.ts:150` `webhookRouter.post('/payout')`; provider tag `'nowpayments'` at `:178` | HMAC payout path |
| x402 topup / settle | **BUILDING-STUCK** | `themes/sietch/src/api/routes/billing-routes.ts:153` `POST /topup` (file header `:4` `/api/billing/topup`); `settlement.routes.ts:208` `POST /quote`, `:267` `POST /settle`; `packages/routes/x402.routes.ts:92` `GET /quote`, `:140` `POST /agents/:agentId/chat` | Settlement core: `packages/services/x402-settlement.ts:188` `settle()`; lots: `packages/services/credit-lot-service.ts:77` `debitLots` / `:175` `mintCreditLot` |
| shadow-audit HTTP | **PLATFORM*** | `packages/services/shadow-audit/bin/http.ts:174` `serve({ fetch: app.fetch, port })`; router `src/http/audit-router.ts:346` `GET /v1/audit`, `:396` `POST /v1/audit`; app wire `src/server.ts:239` `/healthz`, `:240` `app.route('/', createAuditRouter)` | *Building product with own bin (not stuck in sietch). Lives under platform package path; deployable independently. |
| mcp-gateway | **NETWORK** | `apps/mcp-gateway/bin/http.ts:14` `serve(…)`; `src/app.ts:207` `/healthz`; `:212` `/.well-known/federation.json`; `:352` `app.all("/:slug/*")` proxy | Federation gateway — stay in hub |
| worker NATS | **PLATFORM** | `apps/worker/src/main-nats.ts:178-199` create+start command/event/eligibility/usage consumers; base `consumers/BaseNatsConsumer.ts:120` `start(js)` | Substrate — keep |
| gateway (Rust) | **PLATFORM** | `apps/gateway/src/main.rs:32` `async fn main`; `:82` `ShardPool::new`; `:111` `axum::serve` | Discord→NATS only — keep |
| ingestor | **PLATFORM** | `apps/ingestor/src/index.ts` (Discord Gateway → RabbitMQ) | Zero business logic — keep |
| sietch jobs worker | **BUILDING-STUCK** | `themes/sietch/src/jobs/worker.ts:1-28` coexistence IncumbentHealthJob entry; job modules under `themes/sietch/src/jobs/*.ts` | Coexistence/billing sweeps still hub-hosted |
| freeside-cli | **NETWORK** | `packages/freeside-cli/bin/freeside-cli.ts:56-112` verb switch `list\|inspect\|doctor\|order\|kitchen\|fulfill` | Discovery/fulfillment CLI — keep |

## Supporting PLATFORM adapters (not HTTP entry, but invoked by stuck mounts)

| Module | Evidence | Relation |
|---|---|---|
| Agent gateway factory | `packages/adapters/agent/factory.ts:45` | Used by stuck REST/Discord/Telegram |
| Conservation guard | `packages/services/conservation-guard.ts:232` `checkConservation` | Agent budget plane |
| Credit lots | `packages/services/credit-lot-service.ts:175` | Minted from NOWPayments / x402 |

## Boot surfaces (context)

| Runtime | Entry | Classification |
|---|---|---|
| sietch monolith | `themes/sietch/src/index.ts` | **BUILDING-STUCK** host |
| shadow-audit-api | `packages/services/shadow-audit/bin/http.ts` | PLATFORM* (extracted building) |
| mcp-gateway | `apps/mcp-gateway/bin/http.ts` | NETWORK |
| worker | `apps/worker/src/main-nats.ts` | PLATFORM |
| gateway | `apps/gateway/src/main.rs` | PLATFORM |
| freeside-cli | `packages/freeside-cli/bin/freeside-cli.ts` | NETWORK |

## Hub-thinning implication

Every **BUILDING-STUCK** row above is a cut line: move the route/command + its building service out of `themes/sietch`, leave PLATFORM adapters and NETWORK tools in the hub. shadow-audit already has the cut shape (own `bin/http.ts`) — billing and mediums do not.
