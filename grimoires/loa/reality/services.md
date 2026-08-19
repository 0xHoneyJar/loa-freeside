---
source_type: ai-autogen
use_label: usable
read_state: validated
as_of: 2026-07-17
generated_by: /ride Phase 2 — hub thinning (CODE IS TRUTH)
git_sha: b589f728
scope: packages/adapters/agent + packages/services economic + shadow-audit + themes/sietch billing
---

# Services Inventory — Hub Thinning Scope

> Verdict column: **KEEP** (platform substrate) · **EXTRACT** (building → freeside-X) · **THIN** (keep port/adapter, peel product) · **DELETE-CANDIDATE** (orphan / unmounted / superseded).
> LOC = physical lines (`wc -l`), approximate.

## Spice Gate flow (packages/adapters/agent)

```
HTTP/bot → IAgentGateway.invoke|stream
  → rate limit → pool/BYOK resolve → BudgetManager.reserve (Redis Lua two-counter)
  → JwtService sign → LoaFinnClient.invoke|stream (AI runs in loa-finn)
  → usage finalize → BudgetManager.finalize
BYOK egress (separate): loa-finn → BYOKProxyHandler (SSRF-hardened) → provider API
```

Critical: no `generateText` under `packages/adapters/agent` (ck empty). Inference is delegated at `agent-gateway.ts:275` / `:524` via `this.loaFinn.invoke|stream`. Package self-labels Spice Gate at `index.ts:3-4`.

| Path | ~LOC | Verdict | Why |
|------|------|---------|-----|
| `packages/adapters/agent/agent-gateway.ts` | 832 | KEEP | Spice Gate facade; lifecycle RECEIVED→FINALIZED; calls LoaFinn only |
| `packages/adapters/agent/loa-finn-client.ts` | 579 | KEEP | HTTP/SSE client to loa-finn (model runtime lives elsewhere) |
| `packages/adapters/agent/byok-proxy-handler.ts` | 545 | KEEP | SSRF-hardened BYOK egress; **no Express/Hono mount found** |
| `packages/adapters/agent/byok-manager.ts` | 470 | KEEP | Envelope encrypt (KMS) + store/cache; custody in Spice Gate DB+KMS |
| `packages/adapters/agent/config.ts` | 422 | KEEP | Env/config loader for gateway |
| `packages/adapters/agent/budget-manager.ts` | 358 | KEEP | Redis two-counter wrapper (`committed`+`reserved`); Lua reserve/finalize |
| `packages/adapters/agent/lua/budget-reserve.lua` | 91 | KEEP | Atomic check-and-reserve (`KEYS[1]` committed, `KEYS[2]` reserved) |
| `packages/adapters/agent/lua/budget-finalize.lua` | 93 | KEEP | Idempotent reserved→committed |
| `packages/adapters/agent/lua/budget-reaper.lua` | 80 | KEEP | Expired reservation reclaim |
| `packages/adapters/agent/lua/rate-limit.lua` | 99 | KEEP | Multi-dimension rate limit script |
| `packages/adapters/agent/usage-receiver.ts` | 331 | KEEP | S2S usage ingestion from loa-finn |
| `packages/adapters/agent/redis-circuit-breaker.ts` | 317 | KEEP | Fleet Redis CB used by BYOK/KMS paths |
| `packages/adapters/agent/budget-drift-monitor.ts` | 316 | KEEP | Estimate vs actual drift |
| `packages/adapters/agent/agent-metrics.ts` | 301 | KEEP | EMF/metrics emission |
| `packages/adapters/agent/pool-mapping.ts` | 299 | KEEP | Alias→pool + provider hints |
| `packages/adapters/agent/reputation-event-router.ts` | 290 | THIN | Side-channel reputation; not core metering |
| `packages/adapters/agent/s2s-jwt-validator.ts` | 287 | KEEP | Inbound S2S JWT |
| `packages/adapters/agent/budget-config-provider.ts` | 279 | KEEP | Per-community pricing overrides |
| `packages/adapters/agent/ip-rate-limiter.ts` | 274 | KEEP | Pre-auth IP limiter |
| `packages/adapters/agent/capability-audit.ts` | 272 | KEEP | Structured capability audit events |
| `packages/adapters/agent/index.ts` | 268 | KEEP | Public exports |
| `packages/adapters/agent/agent-auth-middleware.ts` | 268 | KEEP | Agent request auth |
| `packages/adapters/agent/agent-rate-limiter.ts` | 239 | KEEP | Community/user/channel/burst limits |
| `packages/adapters/agent/ensemble-mapper.ts` | 229 | KEEP | Ensemble strategy validation |
| `packages/adapters/agent/observability.ts` | 226 | KEEP | Tracing helpers |
| `packages/adapters/agent/jwt-service.ts` | 214 | KEEP | Outbound JWT for loa-finn |
| `packages/adapters/agent/token-estimator.ts` | 196 | KEEP | Prompt token estimate for reserve |
| `packages/adapters/agent/tier-access-mapper.ts` | 191 | KEEP | Subscription tier → access/models |
| `packages/adapters/agent/request-lifecycle.ts` | 174 | KEEP | State machine helper |
| `packages/adapters/agent/sse-event-id.ts` | 155 | KEEP | SSE resume IDs |
| `packages/adapters/agent/factory.ts` | 151 | KEEP | `createAgentGateway()` wire-up (used by `apps/worker`) |
| `packages/adapters/agent/budget-reaper-job.ts` | 148 | KEEP | BullMQ reaper job |
| `packages/adapters/agent/idempotency-state.ts` | 139 | KEEP | Idempotency keys |
| `packages/adapters/agent/ensemble-accounting.ts` | 130 | KEEP | Per-model cost breakdown |
| `packages/adapters/agent/stream-reconciliation-worker.ts` | 117 | KEEP | Dropped-stream finalize |
| `packages/adapters/agent/byok-provider-endpoints.ts` | 111 | KEEP | Provider URL allowlist for proxy |
| `packages/adapters/agent/error-messages.ts` | 82 | KEEP | User-facing error format |
| `packages/adapters/agent/budget-unit-bridge.ts` | 68 | KEEP | Cents ↔ micro bridge |
| `packages/adapters/agent/s2s-auth-middleware.ts` | 64 | KEEP | Express S2S middleware |
| `packages/adapters/agent/types.ts` | 45 | KEEP | Shared types |
| `packages/adapters/agent/clock.ts` | 22 | KEEP | Clock port |
| **Total `packages/adapters/agent/*.ts` (+lua)** | **~9.8k** | KEEP | Platform Spice Gate — do not extract to a product building |

---

## packages/services — economic substrate

| Path | ~LOC | Verdict | Why |
|------|------|---------|-----|
| `packages/services/conservation-guard.ts` | 458 | KEEP | Fence tokens + I-1/I-2/I-3 invariants (`checkConservation` `:232`) |
| `packages/services/velocity-service.ts` | 403 | KEEP | Temporal spend snapshots; consumed by `velocity-routes.ts` |
| `packages/services/reconciliation-sweep.ts` | 347 | KEEP | Missed NOWPayments webhook recovery → `mintCreditLot` |
| `packages/services/x402-settlement.ts` | 292 | KEEP/THIN | Quote-settle + PG lot mint/debit; paired with unmounted `packages/routes/x402.routes.ts` |
| `packages/services/velocity-alert-service.ts` | 269 | KEEP | Exhaustion alerts on velocity snapshots |
| `packages/services/credit-lot-service.ts` | 252 | KEEP | PG append-only lots (`mintCreditLot` `:175`, `debitLots` `:77`); ledger-api cutover target |
| `packages/services/nowpayments-handler.ts` | 239 | KEEP | Mints PG lots + Redis budget INCR (`processPaymentForLedger` `:133`); hook for CryptoWebhookService |
| `packages/services/lot-expiry-sweep.ts` | 213 | KEEP | Expire expired lots |
| `packages/services/debit-rollup-job.ts` | 205 | KEEP | Debit rollup job |
| `packages/services/velocity-batch-processor.ts` | 198 | KEEP | Batch velocity compute |
| `packages/services/budget-finalize-pg.ts` | 193 | KEEP | PG-first finalize wrapping BudgetManager + `debitLots` |
| **Economic cluster total** | **~3.1k** | KEEP | Platform money physics — stay in hub until ledger-api cutover |

Related (not in named list, same belt): `purpose-service.ts`, `governance-*.ts` (conservation outbox), `feature-flags.ts`.

---

## packages/services/shadow-audit — building shape

Already a **deployable HTTP building** living under platform paths (`packages/services/`).

| Path / artifact | ~LOC | Verdict | Why |
|-----------------|------|---------|-----|
| `packages/services/shadow-audit/bin/http.ts` | 178 | EXTRACT | Deploy entry; `@hono/node-server`; fails closed on API key |
| `packages/services/shadow-audit/src/http/audit-router.ts` | 734 | EXTRACT | `/v1/audit*` surface |
| `packages/services/shadow-audit/src/audit-service.ts` | 450 | EXTRACT | Core audit assembly |
| `packages/services/shadow-audit/src/server.ts` | 289 | EXTRACT | App builder / env config |
| `packages/services/shadow-audit/src/*.ts` (non-test) | ~4.5k excl tests | EXTRACT | Ownership/role/differential stack |
| `Dockerfile` + `railway.toml` + `DEPLOY.md` | — | EXTRACT | Railway-ready (`healthcheckPath=/healthz`, `pnpm start` → `tsx bin/http.ts`) |
| `package.json` name | `@freeside/shadow-audit-service` | EXTRACT | Own package identity |

**Verdict:** EXTRACT to own repo/cell when sequenced; until then treat as in-hub building, not platform substrate.

---

## themes/sietch/src/services/billing/*

| Path | ~LOC | Verdict | Why |
|------|------|---------|-----|
| `WebhookService.ts` | 877 | EXTRACT | Paddle webhook LVVER / subscription lifecycle |
| `CryptoWebhookService.ts` | 523 | EXTRACT | NOWPayments IPN; optional PG lot hook `:111` / `:300` |
| `GatekeeperService.ts` | 506 | EXTRACT | Feature entitlement gate |
| `BillingAuditService.ts` | 505 | EXTRACT | Billing audit log |
| `WaiverService.ts` | 423 | EXTRACT | Fee waivers |
| `featureMatrix.ts` | 182 | EXTRACT | Tier→feature matrix |
| `index.ts` | 18 | EXTRACT | Re-exports |
| **Total** | **~3.0k** | EXTRACT | Product billing building (`freeside-billing`) |

---

## themes/sietch/src/packages/{adapters,core}/billing

Nested product billing tree — **not** under root `packages/adapters` (root has `agent|chain|sonar|…`, no `billing/`).

### adapters/billing (key files; ~14.1k LOC total, ~40 files)

| Path | ~LOC | Verdict | Why |
|------|------|---------|-----|
| `CreditLedgerAdapter.ts` | 1111 | EXTRACT | **SQLite** sole SoT ledger (`better-sqlite3`, header `:4-6`) |
| `PeerTransferService.ts` | 799 | EXTRACT | Peer credit transfers |
| `TbaDepositBridge.ts` | 777 | EXTRACT | TBA deposit bridge |
| `PaddleBillingAdapter.ts` | 690 | EXTRACT | Paddle provider |
| `SettlementService.ts` | 605 | EXTRACT | Settlement orchestration |
| `AgentGovernanceService.ts` | 577 | EXTRACT | Agent spend governance (product) |
| `NOWPaymentsAdapter.ts` | 556 | EXTRACT | Crypto provider (sietch path) |
| `FraudRulesService.ts` | 536 | EXTRACT | Fraud rules |
| `RevenueRulesAdapter.ts` | 499 | EXTRACT | Revenue rules |
| `ReferralService.ts` | 499 | EXTRACT | Referrals |
| `ConstitutionalGovernanceService.ts` | 499 | EXTRACT | Policy governance UX |
| `RevenueDistributionService.ts` | 471 | EXTRACT | Revenue split |
| `ReconciliationService.ts` | 429 | EXTRACT | Product reconciliation |
| `PaymentServiceAdapter.ts` | 411 | EXTRACT | Payment orchestration |
| `X402PaymentAdapter.ts` | 257 | EXTRACT | x402 verify (sietch path; dual with `packages/services/x402-settlement.ts`) |
| `AgentBudgetService.ts` | 387 | THIN | Product budget UX over ledger — peel with billing |
| `index.ts` | 145 | EXTRACT | Barrel |

### core/billing + contracts

| Path | ~LOC | Verdict | Why |
|------|------|---------|-----|
| `themes/sietch/src/packages/core/billing/credit-packs.ts` | 136 | EXTRACT | Credit pack tiers |
| `themes/sietch/src/packages/core/billing/x402-config.ts` | 140 | EXTRACT | x402 config |
| `themes/sietch/src/packages/core/billing/pricing.ts` | 82 | EXTRACT | Pricing tables |
| `themes/sietch/src/packages/core/contracts/admin-billing.ts` | 99 | EXTRACT | Admin billing contracts |
| `themes/sietch/src/packages/core/contracts/s2s-billing.ts` | 74 | EXTRACT | S2S billing contracts |
| `themes/sietch/src/packages/core/ports/ICreditLedgerService.ts` | (port) | EXTRACT | Ledger port (with adapter) |
| `themes/sietch/src/packages/core/ports/ICryptoPaymentProvider.ts` | (port) | EXTRACT | Crypto port |

---

## Dual-home map (economic)

| Concern | Platform (KEEP) | Product / sietch (EXTRACT) |
|---------|-----------------|----------------------------|
| Agent spend meter | Redis BudgetManager + Lua | — |
| Conservation | `conservation-guard.ts` | — |
| Velocity | `velocity-service*.ts` | `velocity-routes.ts` mount |
| PG credit lots | `credit-lot-service.ts` + handlers | Hook intended via CryptoWebhookService (wiring incomplete — see verdicts) |
| SQLite credit ledger | — | `CreditLedgerAdapter.ts` |
| NOWPayments | `nowpayments-handler.ts` + `packages/routes/webhooks.routes.ts` (**unmounted**) | `NOWPaymentsAdapter` + `/api/crypto/*` (**mounted**) |
| x402 | `x402-settlement.ts` + `packages/routes/x402.routes.ts` (**unmounted**) | `X402PaymentAdapter` + billing/settlement routes |

---

## Hub-thinning summary

- **KEEP in hub:** entire `packages/adapters/agent` (Spice Gate), conservation/velocity/PG lot services, Redis budget.
- **EXTRACT:** `themes/sietch` billing services + nested `packages/{adapters,core}/billing`, shadow-audit building.
- **DELETE-CANDIDATE / resolve:** unmounted `packages/routes/{webhooks,x402}.routes.ts` duplicate surface (merge into one mounted path or delete after cutover); unwired `setCreditLedgerHook` dead path until explicitly enabled.
