---
source_type: ai-autogen
use_label: usable
read_state: validated
as_of: 2026-07-17
generated_by: /ride Phase 2 — hub thinning (CODE IS TRUTH)
git_sha: b589f728
---

# API Surface — Agent + Billing + Audit

> CODE IS TRUTH. Distinguishes **defined** routes vs **mounted** in `themes/sietch/src/api/server.ts`.

## Mount matrix (server.ts)

| Mount | Router / factory | Status |
|-------|------------------|--------|
| `POST` raw `/api/billing/webhook` | body parser then `billingRouter` | **MOUNTED** `server.ts:249-293` |
| `/api/billing` | `billingRouter` (Paddle) | **MOUNTED** `:293` |
| `/api/settlement` | `settlementRouter` (Dixie x402) | **MOUNTED** `:296` |
| raw `/api/crypto/webhook` | body parser then crypto | **MOUNTED** `:259-300` |
| `/api/crypto` | `cryptoBillingRouter` (NOWPayments) | **MOUNTED** `:300` |
| `/admin` | `billingAdminRouter` | **MOUNTED** `:635` |
| `/admin/agents` | `adminAgentRouter` | **MOUNTED** `:638` |
| `/internal/agent` | `createInternalAgentRoutes` | **MOUNTED** when `LOA_FINN_BASE_URL` set `:707-732` |
| `/.well-known/jwks.json` | `createAgentRoutes({ getJwks })` only | **MOUNTED** `:747-755` |
| Full `/api/agents/{invoke,stream,…}` | same factory, needs `deps.gateway` | **DEFINED**, **NOT mounted** in server (early-return at `agents.routes.ts:168`) |
| BYOK admin `/api/admin/…/byok/keys` | `createBYOKRoutes` | **DEFINED**, **NOT mounted** (export only `routes/index.ts:167`) |
| BYOK proxy HTTP | `BYOKProxyHandler` | **DEFINED** class, **NO HTTP mount** anywhere under themes/apps |
| `creditBillingRouter` (`/topup`, `/balance`, …) | `billing-routes.ts` | **DEFINED**, **NOT mounted** |
| `creditPackRouter` (`/purchase`) | `credit-pack-routes.ts` | **DEFINED**, **NOT mounted** |
| `packages/routes` webhooks/x402 | `createWebhookRouter` / `createX402Router` | **DEFINED**, **NOT mounted** (tests only) |

---

## Agent routes — `themes/sietch/src/api/routes/agents.routes.ts`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/.well-known/jwks.json` | public | Live via server JWKS-only mount |
| GET | `/api/agents/health` | none | Only if `deps.gateway` provided `:196` |
| POST | `/api/agents/invoke` | agent auth stack | Gateway → Spice Gate → loa-finn `:214` |
| POST | `/api/agents/stream` | agent auth stack | SSE `:246` |
| GET | `/api/agents/models` | agent auth | `:340` |
| GET | `/api/agents/budget` | agent auth | `:350` |

### Internal agent — `createInternalAgentRoutes`

| Method | Path (under `/internal/agent`) | Auth |
|--------|--------------------------------|------|
| POST | `/usage-reports` | S2S JWT (`requireS2SAuth`) `:403` |

Gateway runtime for bots: `createAgentGateway` in `apps/worker/src/main-nats.ts:131`; Discord/Telegram inject `IAgentGateway` (`discord/.../agent.ts:16,79-80`, `telegram/.../agent.ts:14,46-48`).

### Admin BYOK — `themes/sietch/src/api/routes/admin/byok.routes.ts`

| Method | Path (relative; intended under admin) | Status |
|--------|---------------------------------------|--------|
| POST | `/communities/:id/byok/keys` | code only |
| GET | `/communities/:id/byok/keys` | code only |
| DELETE | `/communities/:id/byok/keys/:keyId` | code only |
| POST | `/communities/:id/byok/keys/:keyId/rotate` | code only |

Header documents intended `/api/admin/communities/:id/byok/keys` (`byok.routes.ts:6-9`).

---

## Billing — Paddle (mounted)

`themes/sietch/src/api/billing.routes.ts` → `/api/billing`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/checkout` | Paddle checkout |
| POST | `/portal` | Customer portal |
| GET | `/subscription` | Status |
| GET | `/entitlements` | Cached entitlements |
| POST | `/feature-check` | Gatekeeper |
| POST | `/webhook` | Paddle IPN (`:440`); raw body at `/api/billing/webhook` |

---

## Billing — NOWPayments / crypto (mounted)

`themes/sietch/src/api/crypto-billing.routes.ts` → `/api/crypto`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/payment` | Create crypto payment |
| GET | `/payment/:paymentId` | Status |
| GET | `/currencies` | Supported currencies |
| GET | `/estimate` | Price estimate |
| POST | `/webhook` | NOWPayments IPN → `CryptoWebhookService` `:384` |

---

## Billing — credit / x402 product routes (defined, mostly unmounted)

### `billing-routes.ts` — `creditBillingRouter`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/topup` | x402 USDC top-up |
| POST | `/internal/finalize` | S2S finalize for loa-finn |
| POST | `/internal/verify-anchor` | S2S anchor verify |
| GET | `/balance` | Credit balance |
| GET | `/history` | Ledger history |
| GET | `/pricing` | Public pricing |

**Not** `expressApp.use`'d in `server.ts`.

### `credit-pack-routes.ts` — `creditPackRouter`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/purchase` | Credit pack buy → SQLite lots |

**Not mounted.**

### `settlement.routes.ts` — **mounted** at `/api/settlement`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/quote` | Dixie x402 quote |
| POST | `/settle` | Finalize |
| GET | `/quote/:id` | Quote state |

### `webhook.routes.ts` (payout, not NOWPayments)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/payout` (intended `/api/webhooks/payout`) | Payout provider HMAC |

---

## Dual payment path mounts

### NOWPayments — TWO code trees, ONE live mount

| Tree | Entry | Mounted? |
|------|-------|----------|
| **A (live)** | `cryptoBillingRouter` + `NOWPaymentsAdapter` + `CryptoWebhookService` | YES `/api/crypto` |
| **B (orphan)** | `packages/routes/webhooks.routes.ts` → `POST /nowpayments` → `processPaymentForLedger` | NO — factory never called from themes/apps |

### x402 — MULTIPLE trees

| Tree | Entry | Mounted? |
|------|-------|----------|
| **A** | `settlementRouter` Dixie quote/settle | YES `/api/settlement` |
| **B** | `X402PaymentAdapter` + `billing-routes` `/topup` | Router unmounted |
| **C (orphan)** | `packages/routes/x402.routes.ts` `GET /quote`, `POST /agents/:agentId/chat` | NO |

---

## packages/routes

| File | ~LOC | Routes | Consumers |
|------|------|--------|-----------|
| `packages/routes/webhooks.routes.ts` | 323 | `POST /nowpayments` | Self + unit test only |
| `packages/routes/x402.routes.ts` | 285 | `GET /quote`, `POST /agents/:agentId/chat` | Self only |
| `packages/routes/webhooks.routes.test.ts` | 93 | — | Tests |

No `packages/routes` import from `themes/sietch/src` or `apps/` (excluding worktrees).

---

## shadow-audit — `/v1/audit*`

`packages/services/shadow-audit` — Hono app (`bin/http.ts` → `buildAuditApp`).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/healthz` | Railway healthcheck |
| GET | `/v1/collections/:chain/:contract` | Open capability read |
| GET | `/v1/access-risk` | Public teaser |
| GET | `/v1/audit` | Anonymous aggregate (k-anon) |
| POST | `/v1/audit` | Named/authed audit |
| POST | `/v1/audit/reaction` | Reaction capture |
| POST | `/v1/audit/contact` | Consented contact |
| GET | `/v1/audit/view` | Thin HTML dashboard |
| POST | `/v1/role-snapshot` | Optional ingest (if configured) |

Documented in `audit-router.ts` header and `DEPLOY.md`. Independent of sietch Express.

---

## Related sietch routers (billing-adjacent)

| Module | Role |
|--------|------|
| `billing-admin-routes.ts` | Admin billing ops |
| `velocity-routes.ts` | Imports `packages/services/velocity-service` |
| `reconciliation-admin.routes.ts` | Admin reconciliation |
| `agent-tba.routes.ts` / `agent-governance.routes.ts` | Mounted under `/agent/*` via `routes/index.ts` |
| `transfer.routes.ts` / `payout.routes.ts` / `referral.routes.ts` | Product money UX |

---

## Delta vs prior `api-surface.md` (2026-07-06)

- Confirmed **dual NOWPayments/x402** trees; platform `packages/routes` **unmounted**.
- Confirmed agent HTTP invoke/stream **not** live on sietch server without gateway deps; JWKS + `/internal/agent` are.
- Confirmed BYOK admin + proxy **code without mount**.
- Confirmed `creditBillingRouter` / `creditPackRouter` defined but unmounted; settlement x402 **is** mounted.
