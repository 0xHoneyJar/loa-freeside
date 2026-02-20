# PRD: Launch Readiness — Production Stack, Payments & Agent Surfaces

**Version:** 1.1.0
**Date:** 2026-02-20
**Status:** Active
**Cycle:** cycle-036
**Predecessor:** cycle-035 "The Neuromancer Codex" (archived — documentation complete)
**Source:** [loa-finn#66](https://github.com/0xHoneyJar/loa-finn/issues/66) (Launch Readiness RFC), Issues [#77](https://github.com/0xHoneyJar/loa-freeside/issues/77)–[#85](https://github.com/0xHoneyJar/loa-freeside/issues/85)

---

## 0. The Question Behind the Question

The request is "deploy and launch." The real problem is **the last mile between infrastructure and revenue**.

52 global sprints across 20 cycles produced a complete multi-model inference platform: 5-pool model routing, budget-atomic accounting, token-gated access, 9-tier conviction scoring, ensemble strategies, BYOK encryption, and a full NOWPayments crypto billing adapter with 95 passing tests. The documentation is now production-grade (cycle-035).

But none of it is deployed. The NOWPayments adapter is feature-flagged off. The loa-finn inference engine has no production container. Users can't buy credits, can't talk to their NFT agents, and community admins can't see what's happening.

This is the "last mile" problem that kills platforms. Stripe had the best payment API in 2011 — but it didn't matter until developers could `curl` it from production. We have the agent economy infrastructure. This cycle makes it real.

> The gap between "infrastructure ready" and "users can use it" — loa-finn#66 §6

---

## 1. Problem Statement

| ID | Problem | Evidence |
|----|---------|----------|
| P-1 | Neither loa-finn nor loa-freeside is deployed to production | Issue #77 — "Neither loa-finn nor loa-freeside is deployed to production" |
| P-2 | No way to collect money despite fully-built billing adapter | Issue #79 — "We have no way to collect money" (loa-freeside#62) |
| P-3 | No production monitoring — failures detected in code but no human alerting | Issue #78 — "The code detects failures; nothing alerts humans about them" |
| P-4 | NFT personality routing bridge doesn't exist between loa-freeside and loa-finn | Issue #80 — "The bridge between them doesn't exist yet" |
| P-5 | No per-NFT conversational spaces in Discord | Issue #81 — each NFT agent needs its own thread |
| P-6 | Community admins have zero visibility into spend, usage, or model allocation | Issue #82 — "Without a dashboard, communities can't manage their agent budgets" |
| P-7 | No audit trail or pool enforcement transparency | Issue #83 — "Communities won't adopt infrastructure they can't audit" |
| P-8 | No self-service developer onboarding for the API platform (Product B) | Issue #84 — developers need API keys without manual intervention |
| P-9 | No web surface for non-Discord users | Issue #85 — "Not all users are on Discord" |

---

## 2. Goals & Success Metrics

| ID | Goal | Metric | Source |
|----|------|--------|--------|
| G-1 | Deploy full stack to production on existing AWS ECS infrastructure | Both services responding on HTTPS with health checks | #77 |
| G-2 | Enable crypto payment revenue collection | First real credit pack purchase via NOWPayments | #79 |
| G-3 | Production observability with human alerting | Conservation guard failure triggers alert within 60s | #78 |
| G-4 | Per-NFT personality-driven inference routing | Two different NFTs get different model pool selections | #80 |
| G-5 | Per-NFT Discord conversational spaces | NFT holder invokes `/my-agent` and gets dedicated thread | #81 |
| G-6 | Community admin budget visibility | Admin views spend breakdown by model pool | #82 |
| G-7 | Auditable billing and pool enforcement | Community downloads JSONL audit trail of all credit operations | #83 |
| G-8 | Self-service developer API keys | Developer creates key, makes inference request, zero manual intervention | #84 |
| G-9 | Web chat surface for agents | Embeddable widget streams responses via WebSocket | #85 |

### Timeline

**Target: 1-2 weeks to Product A launch (NFT agents live in Discord with billing).**
Product B (API platform) and web chat widget are in-scope but can trail by days.

### Critical Path (P0 Minimum Viable Launch)

The 1-2 week target is achievable ONLY if P0 is scoped to the true critical path. If any item below slips, the entire launch slips:

1. **Deploy** — loa-freeside + loa-finn on ECS with health checks (FR-0.1, FR-0.3)
2. **S2S Auth** — JWT exchange validated in staging (FR-0.3, go/no-go gate)
3. **Basic Discord chat** — `/my-agent` → streamed inference via personality bridge (FR-3.1, FR-2.1)
4. **Payment + credit mint** — NOWPayments checkout → webhook → credits arrive (FR-1.2, FR-1.4)
5. **Minimal alerting** — Conservation guard failure → Slack within 60s (FR-0.7)

Everything else (dashboards, audit exports, web widget, API portal, Telegram) follows in P1/P2 and MUST NOT block the P0 launch date. If cross-repo blockers (loa-finn Dockerfile, personality derivation) slip >3 days, escalate to loa-finn team immediately.

---

## 3. User & Stakeholder Context

### Primary Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| **NFT Holder** | Owns a finnNFT, wants to interact with their agent | Chat with their NFT personality, see it respond uniquely, buy credits |
| **Community Admin** | Manages a Discord community using Loa platform | Budget visibility, usage dashboards, audit trails, tier configuration |
| **Developer** | Building on the Loa API (Product B) | Self-service API keys, sandbox testing, clear documentation |
| **Platform Operator** | THJ team deploying and maintaining infrastructure | Production monitoring, alerting, deployment automation |

### User Journeys

**NFT Holder Journey:**
1. Verify wallet in Discord → tier assigned based on conviction score
2. `/my-agent` → dedicated Discord thread created with NFT personality
3. Chat with agent → personality-routed inference through correct model pool
4. Credits run low → `/buy-credits 10` → NOWPayments checkout → credits arrive
5. Continue chatting

**Developer Journey (Product B):**
1. Sign up via web form → get sandbox API key (`lf_test_...`)
2. Make first inference request against `cheap` pool (free tier)
3. Verify it works → upgrade to production key (`lf_live_...`)
4. View usage dashboard → manage rate limits and budget

**Community Admin Journey:**
1. View budget dashboard → see spend by model pool
2. Download audit trail as JSONL → verify conservation invariants
3. See pool enforcement decisions → understand why a request was routed where
4. Set budget caps → control community spending

---

## 4. Functional Requirements

### Track 0: Make It Run (Issues #77, #78)

| ID | Requirement | Acceptance Criteria | Source |
|----|-------------|---------------------|--------|
| FR-0.1 | Deploy loa-finn as ECS service in existing AWS cluster | ECS task definition, service, ALB target group, health check passing | #77 |
| FR-0.2 | Docker Compose for local full-stack development | `docker compose up` starts loa-freeside + loa-finn + Redis + PostgreSQL | #77 |
| FR-0.3 | S2S JWT exchange working in production | loa-freeside signs ES256 JWT (`iss: loa-freeside`, `aud: loa-finn`) → loa-finn validates via JWKS; loa-finn rejects all requests without valid S2S JWT | #77 |
| FR-0.4 | At least one model pool responds to inference in production | Discord `/agent` → streamed response via loa-finn | #77 |
| FR-0.5 | Metrics collection from both services | Amazon Managed Prometheus (AMP) workspace with ADOT collector sidecar containers on each ECS task; ADOT discovers targets via ECS task metadata endpoint; existing CloudWatch Container Insights remain for ECS-level metrics | #78 |
| FR-0.6 | CloudWatch dashboards for unified service health | Inference latency, error rate, billing flow, auth failures, conservation guard panels; sourced from AMP via CloudWatch data source or Grafana on AMP | #78 |
| FR-0.7 | Alerting on conservation guard failure and service downtime | AMP alerting rules → SNS topic → Slack webhook; fires within 60s of conservation guard failure or service health check failure | #78 |

**CRITICAL CONSTRAINT:** Use existing Terraform/AWS ECS infrastructure. No Fly.io. loa-finn deploys as a new ECS service in the existing cluster, behind the existing ALB, using existing RDS/ElastiCache/VPC/Route53. Reference: `infrastructure/terraform/ecs.tf`, `alb.tf`, `variables.tf`.

**S2S TRUST MODEL:** loa-finn is internal-only — not directly reachable from the internet. loa-freeside is the sole public-facing gateway. Network enforcement: loa-finn's security group allows inbound only from loa-freeside's security group (no public ALB listener rule for finn). loa-freeside calls loa-finn via internal service discovery (`finn.arrakis-{env}.local`) or private ALB target group. JWKS endpoint hosted by loa-freeside (the issuer), not loa-finn (the verifier). JWT claims: `iss: loa-freeside`, `aud: loa-finn`, TTL: 60s. Key rotation: ES256 keypair in Secrets Manager, rotated via scheduled Lambda (quarterly). loa-finn MUST reject all requests without valid S2S JWT bearing correct `aud`.

### Track 1A: Make It Pay (Issue #79)

| ID | Requirement | Acceptance Criteria | Source |
|----|-------------|---------------------|--------|
| FR-1.1 | Enable NOWPayments feature flag in production | `FEATURE_CRYPTO_PAYMENTS_ENABLED=true`, API key + IPN secret configured | #79 |
| FR-1.2 | Wire NOWPayments webhook to credit mint | `POST https://api.{domain}/api/crypto/webhook` (loa-freeside, public via ALB) receives IPN; HMAC-SHA512 verified against `NOWPAYMENTS_IPN_SECRET`; idempotency key = `payment_id` (UNIQUE constraint in `crypto_payments` table); replay of identical payload = HTTP 200, no additional credit lots; payment `finished` → credit lot created, conservation guard verifies | #79 |
| FR-1.3 | Credit pack tiers defined in config | $5 Starter, $10 Basic, $25 Pro (configurable, not hardcoded) | #79 |
| FR-1.4 | Discord `/buy-credits [amount]` command | Returns NOWPayments checkout URL, confirms on completion | #79 |
| FR-1.5 | Telegram `/buy-credits` equivalent | Same flow as Discord | #79 |
| FR-1.6 | Idempotent double-payment handling | Same payment ID = no duplicate credits | #79 |

**PAYMENT STATE MACHINE:** NOWPayments IPN delivers status transitions. The platform must handle all edge states:

| IPN Status | Action | Credit Outcome | User-Facing |
|------------|--------|---------------|-------------|
| `waiting` | Record payment, show pending | None | "Payment pending — waiting for confirmation" |
| `confirming` | Update status | None | "Payment detected — confirming on-chain" |
| `confirmed` | Update status | None | "Payment confirmed — processing" |
| `finished` | Mint credits, conservation guard | Credits created | "Credits added to your account!" |
| `partially_paid` | Record underpayment, notify | None (require full payment) | "Underpaid — send remaining or contact support" |
| `failed` | Record failure, allow retry | None | "Payment failed — please try again" |
| `expired` | Mark expired, allow new checkout | None | "Invoice expired — use /buy-credits for a new one" |
| `refunded` | Reverse credits if minted | Credits reversed | "Refund processed" |

**Edge cases:**
- **Double IPN delivery:** Idempotency on `payment_id` (UNIQUE constraint) — replay returns 200, no duplicate credits.
- **Out-of-order delivery:** Accept any valid status transition; ignore stale/backward transitions (e.g., `finished` then `confirming`).
- **Timeout without IPN:** Reconciliation job polls NOWPayments API by `payment_id` every 5 minutes for invoices >15 min old, resolves stuck payments.
- **Currency conversion:** Credit lot denomination is always in USD equivalent; NOWPayments handles crypto→USD conversion; platform records both crypto amount and USD equivalent.
- **Retry after failure:** User can invoke `/buy-credits` again; new `payment_id` generated; old failed record retained for audit.

**Reconciliation & admin tools:**
- **Reconciliation job:** Scheduled task (every 5 min) polls NOWPayments API for invoices with `waiting`/`confirming` status older than 15 minutes. Resolves stuck payments by fetching current status and processing any missed IPN transitions.
- **Supported currencies:** All currencies supported by NOWPayments (BTC, ETH, USDT, USDC, etc.); credit lot always denominated in USD equivalent using NOWPayments' conversion rate at `finished` time.
- **Rounding rules:** Credit lots rounded DOWN to nearest micro-USD (floor). Platform never over-credits.
- **Admin repair endpoint:** `POST /api/v1/admin/payments/:paymentId/reconcile` — manually triggers status check against NOWPayments API and processes any missed transitions. Requires admin auth. Logs all manual reconciliations to audit trail.
- **Admin payment dashboard:** `GET /api/v1/admin/payments?status=stuck` — lists payments in limbo (>30 min without `finished`/`failed`/`expired`).

**EXISTING ASSETS:** NOWPayments adapter fully built (557 LOC, 23 tests). CryptoWebhookService with LVVER pattern (486 LOC, 26 tests). Database migration `021_crypto_payments.ts` ready. Routes at `/api/crypto/*` implemented (440 LOC, 7 tests). Total: 95 tests passing. NOWPayments account exists, API key available as env var.

### Track 2: Make It Personal (Issue #80)

| ID | Requirement | Acceptance Criteria | Source |
|----|-------------|---------------------|--------|
| FR-2.1 | Inference request enrichment with NFT context | loa-freeside includes `nft_id` + `tier` + `budget_reservation_id` in S2S JWT claims sent to loa-finn; loa-finn resolves personality and selects pool | #80 |
| FR-2.2 | Pool/personality metadata in inference response | loa-finn returns `X-Pool-Used` + `X-Personality-Id` headers; loa-freeside uses these for budget finalization and audit logging | #80 |
| FR-2.3 | Anti-narration enforcement | No forbidden identity terms appear in streamed responses; loa-finn's reviewer-adapter anti-narration rules respected | #80 |
| FR-2.4 | Two different NFTs get different model pool routing | Verified in integration test — different `nft_id` values produce different `X-Pool-Used` and `X-Personality-Id` | #80 |

**PERSONALITY OWNERSHIP:** loa-finn owns personality derivation (it has the NFT metadata, BEAUVOIR.md loader, and NameKDF). loa-freeside passes `nft_id` from JWT claims in the inference request; loa-finn's inference endpoint selects the personality, chooses the pool, and returns pool/personality metadata in the response for auditability. loa-freeside does NOT independently look up personality — it trusts loa-finn's routing decision. This avoids circular dependencies (freeside needs finn for personality; finn needs freeside for auth/budget).

**Call flow:** User → loa-freeside (auth, budget reservation, tier check) → S2S JWT with `nft_id` + `tier` + `budget_reservation_id` → loa-finn (personality lookup, pool selection, inference) → streamed response with `X-Pool-Used` + `X-Personality-Id` headers → loa-freeside (budget finalization, audit).

**STREAMING BUDGET LIFECYCLE:** Inference requests use streaming, which requires explicit reservation→finalization semantics to prevent credit leakage or double-spend:

| Phase | Trigger | Action |
|-------|---------|--------|
| **Reserve** | loa-freeside receives inference request | Create `budget_reservation_id`, deduct estimated max cost from available balance (pessimistic reserve based on `max_tokens` or pool default) |
| **Stream** | loa-finn begins streaming tokens | Token count tracked in real-time via `X-Token-Count` trailer or post-stream summary |
| **Finalize** | Stream completes (200 OK + final chunk) | Calculate actual cost from real token usage; release unused reservation back to balance; write audit record |
| **Partial completion** | Client disconnect or upstream error mid-stream | Charge for tokens actually delivered (loa-finn returns partial token count in error response or trailer); release remainder |
| **Retry** | Client retries same request | New `budget_reservation_id` — original reservation finalized (partial or zero); no double-spend because each reservation is independent |
| **Timeout** | No response from loa-finn within 60s | Release full reservation; log timeout; return error to user |
| **Orphan cleanup** | Reservation >5 min without finalization | Scheduled job releases orphaned reservations back to balance; logs anomaly |

**Idempotency:** Each inference request carries a unique `budget_reservation_id` in the S2S JWT. loa-finn includes this ID in response headers. loa-freeside uses it for finalization — duplicate finalization requests are no-ops.

**DEPENDENCY:** loa-finn#88 (static personality config) or loa-finn#86 (dynamic derivation) must provide personality selection within the inference endpoint. No separate personality lookup endpoint needed.

### Track 3: Make It Visible (Issues #81, #82, #85)

| ID | Requirement | Acceptance Criteria | Source |
|----|-------------|---------------------|--------|
| FR-3.1 | `/my-agent` creates dedicated Discord thread per NFT | Public thread in designated agent channel; bot-enforced access control (bot responds only to verified holder in that thread); thread name = agent name or `Agent #[tokenId]`; if server supports private threads (boost level 2+), use private thread; otherwise public with bot-level gating; **token transfer handling:** bot re-verifies ownership on every message (cached 60s); if ownership changed, bot posts "ownership transferred" notice, stops responding to old holder, and creates new thread for new holder on their next `/my-agent`; **re-verification cadence:** wallet verification refreshed every 24h via background job — stale verifications (>48h) revoke thread access; **bot permissions required:** `MANAGE_THREADS`, `SEND_MESSAGES_IN_THREADS`, `READ_MESSAGE_HISTORY`; bot degrades gracefully if permissions missing (responds with "missing permissions" instead of silent failure) | #81 |
| FR-3.2 | Thread messages routed through personality bridge | Personality tier + emphasis applied to every message | #81 |
| FR-3.3 | `/agent-info` shows personality summary | Anti-narration-safe display, no identity labels | #81 |
| FR-3.4 | Community admin usage dashboard | Total spend, per-pool breakdown, per-user breakdown, projected depletion | #82 |
| FR-3.5 | Admin API endpoints for usage/billing/agents | `GET /api/v1/admin/community/:id/{usage,billing,agents}` | #82 |
| FR-3.6 | Embeddable web chat widget | Single `<script>` tag, WebSocket streaming, personality-aware styling; auth via SIWE wallet login → server-issued short-lived session token (no API keys in browser); community-embedded widgets use server-side API key (not client-exposed); unauthenticated users see read-only agent profile | #85 |
| FR-3.7 | Standalone chat page at `/chat/:tokenId` | Shareable URL, mobile-responsive; read-only mode (personality display, past public interactions) without auth; SIWE login required to send messages; rate-limited per session | #85 |

### Track 4: Make It Trustworthy (Issue #83)

| ID | Requirement | Acceptance Criteria | Source |
|----|-------------|---------------------|--------|
| FR-4.1 | Billing audit trail export as JSONL | Includes timestamp, operation type, amount, pool, user, conservation result | #83 |
| FR-4.2 | Pool enforcement transparency | Admins see which pools agents access and why | #83 |
| FR-4.3 | Conservation guard status endpoint | `GET /api/v1/admin/community/:id/conservation` with current status + history | #83 |
| FR-4.4 | No PII in audit exports | Wallet addresses only (pseudonymous) | #83 |

### Product B: API Platform (Issue #84)

| ID | Requirement | Acceptance Criteria | Source |
|----|-------------|---------------------|--------|
| FR-5.1 | API key generation | Scoped keys: `lf_live_...` (prod), `lf_test_...` (sandbox), shown once | #84 |
| FR-5.2 | API key authentication on inference requests | `Authorization: Bearer lf_live_...` → pool access + rate limits | #84 |
| FR-5.3 | Rate limiting per API key | Requests/minute and tokens/day configurable per key | #84 |
| FR-5.4 | Self-service portal | Key creation, rotation, revocation, usage dashboard | #84 |
| FR-5.5 | Developer onboarding flow | Sign up → sandbox key → free inference → upgrade to production | #84 |

---

## 5. Technical & Non-Functional Requirements

### Infrastructure (MANDATORY: Existing AWS Stack)

| Requirement | Implementation | Reference |
|-------------|----------------|-----------|
| loa-finn runs as ECS Fargate service | New task definition in `ecs.tf`, same cluster | `infrastructure/terraform/ecs.tf` |
| ALB routes to loa-finn | Path-based (`/finn/*`) or subdomain (`finn.{domain}`) routing | `infrastructure/terraform/alb.tf` |
| Shared Redis (ElastiCache) | loa-finn connects to existing cache.t3.micro Redis 7.0; **capacity plan:** maxmemory-policy `allkeys-lru`; key TTLs enforced (rate-limit: 60s, session: 1h, cache: 5m); expected QPS: <100 at launch; upgrade to cache.t3.small if memory >80% sustained; **circuit breaker:** Redis unavailability degrades rate limiting to in-memory fallback, does NOT block inference | `infrastructure/terraform/elasticache.tf` |
| Shared PostgreSQL (RDS) | loa-finn connects via existing PgBouncer (port 6432); **capacity plan:** PgBouncer pool_size=20 (per service), max_client_conn=100; expected concurrent connections: <30 at launch; **isolation:** loa-finn uses read-only connection for queries, separate connection pool from loa-freeside writes; **backpressure:** connection queue timeout 5s, return 503 instead of blocking indefinitely | `infrastructure/terraform/rds.tf`, `pgbouncer.tf` |
| ECR repository for loa-finn | `arrakis-{env}-loa-finn` container registry | `infrastructure/terraform/ecr.tf` |
| Secrets via AWS Secrets Manager | Model API keys, ES256 keypair, NOWPayments creds | `infrastructure/terraform/secrets.tf` |
| CloudWatch logging | `/ecs/arrakis-{env}/loa-finn` log group | `infrastructure/terraform/monitoring.tf` |
| Route53 DNS | Subdomain for loa-finn endpoint | `infrastructure/terraform/route53.tf` |

### Performance

| Metric | Target | Rationale |
|--------|--------|-----------|
| Inference latency (p95) | <30s (model-dependent) | Streaming mitigates perceived latency |
| Health check response | <200ms | ALB health check interval |
| Credit creation latency | <2s from webhook receipt | Conservation guard + DB write |
| Dashboard data freshness | <60s | Near-real-time spend visibility |

### Security

| Requirement | Implementation |
|-------------|----------------|
| S2S JWT (ES256) | loa-freeside signs, loa-finn validates via JWKS |
| NOWPayments webhook HMAC-SHA512 | Existing LVVER pattern in CryptoWebhookService |
| API keys hashed at rest | Cleartext shown once at creation only |
| Rate limiting | 4-dimension (community/user/channel/burst) + per-API-key |
| BYOK key isolation | Envelope encryption (AES-256-GCM + KMS) — already built |
| Audit trail immutability | Append-only JSONL with conservation guard results |

### Existing Assets (DO NOT REBUILD)

| Asset | Status | Tests | Location |
|-------|--------|-------|----------|
| NOWPayments adapter | Production-ready, feature-flagged off | 23 | `themes/sietch/src/packages/adapters/billing/NOWPaymentsAdapter.ts` |
| Crypto webhook service (LVVER) | Production-ready | 26 | `themes/sietch/src/services/billing/CryptoWebhookService.ts` |
| Crypto billing routes | Production-ready | 7 | `themes/sietch/src/api/crypto-billing.routes.ts` |
| Credit pack system | Production-ready | 39 | `themes/sietch/src/packages/core/billing/credit-packs.ts` |
| Budget manager (BigInt) | Production-ready | Covered | `packages/adapters/agent/budget-manager.ts` |
| Pool mapping (5 pools) | Production-ready | Covered | `packages/adapters/agent/pool-mapping.ts` |
| Ensemble accounting | Production-ready | Covered | `packages/adapters/agent/ensemble-accounting.ts` |
| BYOK encryption | Production-ready | Covered | `packages/adapters/agent/byok-manager.ts` |
| Discord 22+ commands | Production-ready | Covered | `themes/sietch/src/discord/commands/` |
| Telegram 10+ commands | Production-ready | Covered | `themes/sietch/src/telegram/commands/` |
| Terraform (20 modules, 81 .tf files) | Staging-ready | N/A | `infrastructure/terraform/` |
| Conservation guard | Production-ready | Covered | Multiple locations |

---

## 6. Scope & Prioritization

### In Scope (P0 — Must Ship)

| Track | Issues | What | Why |
|-------|--------|------|-----|
| Track 0 | #77, #78 | Production deployment + monitoring | Nothing works without this |
| Track 1A | #79 | NOWPayments credit purchase flow | Revenue — "we have no way to collect money" |
| Track 2 | #80 | Per-NFT personality routing bridge | Core differentiator — "talk to your NFT" |
| Track 3 | #81, #82 | Discord threads + budget dashboard | User surface + admin visibility |
| Track 4 | #83 | Audit trail + pool transparency | Trust — communities won't adopt without it |

### In Scope (P1 — Ship Within Days of P0)

| Track | Issues | What | Why |
|-------|--------|------|-----|
| Product B | #84 | API key management + developer onboarding | Second revenue stream |
| Track 3 | #85 | Embeddable web chat widget | Non-Discord user acquisition |

### Out of Scope (This Cycle)

| Feature | Why Deferred | Reference |
|---------|-------------|-----------|
| Soul memory (persistent knowledge) | Post-launch flagship | loa-finn#27 Phase 1 |
| Inbox privacy (encrypted owner-scoped conversations) | Post-launch | loa-finn#27 Phase 2 |
| Personality evolution (compound learning) | Post-launch | loa-finn#27 Phase 3 |
| On-chain autonomous actions (ERC-6551 TBA) | Post-launch | loa-finn#27 Phase 4 |
| Voice transcription (Whisper) | P2 feature | loa-finn#66 §6 |
| Natural language scheduling | P2 feature | loa-finn#66 §6 |
| Agent social network | P2+ feature | loa-finn#66 §6 |
| WhatsApp/Slack adapters | P2 channel expansion | loa-finn#66 §4 |

---

## 7. Risks & Dependencies

### Cross-Repo Dependencies

| Dependency | Owner | Status | Blocks |
|------------|-------|--------|--------|
| loa-finn Dockerfile | loa-finn#84 | Needed | FR-0.1 (ECS deployment) |
| loa-finn Prometheus metrics endpoint | loa-finn#90 | Needed | FR-0.5 (monitoring) |
| loa-finn personality derivation within inference endpoint (returns `X-Pool-Used`/`X-Personality-Id` headers) | loa-finn#88 or #86 | Needed | FR-2.1 (inference enrichment) |
| loa-finn OpenAPI spec | loa-finn#91 | Needed | FR-5.1 (developer onboarding) |
| loa-finn x402 permissionless auth | loa-finn#85 | Nice-to-have | FR-3.6 (widget permissionless mode) |

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| loa-finn Dockerfile not ready | Medium | Blocks all of Track 0 | Can create Dockerfile from freeside side if needed |
| ES256 key rotation in production | Low | Auth failures | Test key rotation in staging first |
| NOWPayments webhook delivery reliability | Low | Missed payments | LVVER pattern + dead-letter + reconciliation already built |
| Redis memory pressure (shared instance) | Low | Latency | Monitor via CloudWatch, upgrade cache class if needed |
| ALB path routing conflicts | Low | 502 errors | Test routing rules in staging before production |

### Environment Variables (New for This Cycle)

```bash
# NOWPayments (account exists, keys available)
FEATURE_CRYPTO_PAYMENTS_ENABLED=true
NOWPAYMENTS_API_KEY=<from env>
NOWPAYMENTS_IPN_SECRET=<from env>
NOWPAYMENTS_ENVIRONMENT=production

# loa-finn service (internal only — not public-facing)
LOA_FINN_URL=http://finn.arrakis-{env}.local:3000  # ECS service discovery, NOT public ALB
# JWKS hosted by freeside (the JWT issuer), consumed by finn (the verifier)
FREESIDE_JWKS_URL=https://api.{domain}/.well-known/jwks.json  # finn reads this to validate S2S JWTs

# Model API keys (in Secrets Manager)
OPENAI_API_KEY=<secrets manager>
ANTHROPIC_API_KEY=<secrets manager>
```

---

## 8. Launch Readiness Requirements

### Rollback & Disaster Recovery (IMP-001)

First production deploy requires explicit rollback procedures:

| Component | Rollback Strategy |
|-----------|------------------|
| ECS task definition | Revert to previous task def revision (`aws ecs update-service --task-definition <prev>`) |
| Database migrations | Forward-only migrations with expand/contract pattern — no `DROP` in initial migration; old columns retained for 1 cycle |
| Feature flags | Kill switch for NOWPayments (`FEATURE_CRYPTO_PAYMENTS_ENABLED=false`), personality routing, Discord thread creation |
| DNS/ALB | Route53 weighted routing for blue/green; ALB target group swap |
| Secrets rotation | Previous ES256 keypair retained in Secrets Manager for JWT validation overlap window (24h) |
| Full rollback | Revert ECS services to previous task def, disable feature flags, no schema rollback needed (forward-only) |

**RTO target:** <15 minutes for ECS rollback, <5 minutes for feature flag kill switch.

### Database Migration Strategy (IMP-006)

ECS rolling deploys with shared database require:

| Rule | Implementation |
|------|---------------|
| Forward-only migrations | No `DROP COLUMN`, `DROP TABLE`, or destructive DDL in initial deploy |
| Expand/contract pattern | Phase 1: add new columns/tables (backward-compatible). Phase 2 (next cycle): remove deprecated columns |
| Pre-deploy migration step | Migrations run as ECS task (one-shot) before service update, not during app startup |
| Zero-downtime constraint | Old code must work with new schema; new code must work with old schema during rolling update |
| Migration ownership | loa-freeside owns all schema migrations; loa-finn reads only via views or explicit grants |
| Rollback testing | Every migration tested in staging with rollback to previous task def to verify backward compatibility |

### Go/No-Go Launch Gate (IMP-002)

Before production deploy, an explicit checklist must pass:

| Gate | Verification | Pass Criteria |
|------|-------------|---------------|
| E2E payment | NOWPayments sandbox → webhook → credit mint | Credits appear in account, conservation guard passes |
| S2S JWT exchange | loa-freeside → loa-finn authenticated inference via real ALB/service discovery in staging | Streamed response received, JWT claims (`iss`, `aud`, `exp`) validated; finn rejects expired/wrong-aud tokens |
| JWT rotation | Rotate ES256 keypair in Secrets Manager, verify both old and new keys work during overlap window | Old key valid for 24h after rotation; new key used for signing; finn fetches updated JWKS within 60s |
| Personality routing | Two different NFTs → different pool/personality | `X-Pool-Used` and `X-Personality-Id` differ |
| Webhook delivery | NOWPayments IPN → ALB → credit mint | Idempotent replay returns 200, no duplicates |
| Monitoring | Conservation guard failure → alert | Slack notification within 60s |
| Health checks | Both services pass ALB health checks | 200 on `/health` for 5 consecutive checks |
| Rollback | Feature flag kill switch tested | Payments disabled within 5 minutes |
| Load baseline | Staging load test (10 concurrent users) | No 5xx errors, p95 latency within targets |

**Decision:** All gates must pass in staging before production deploy. Any failure = no-go.

---

## 9. Dependency Graph

```
Track 0: Deploy (#77)
    ├── FR-0.1: ECS task def + service (loa-finn)
    ├── FR-0.2: Docker Compose (local dev)
    ├── FR-0.3: S2S JWT exchange
    └── FR-0.4: First inference in production
         │
         ├──► Track 0: Monitor (#78)
         │    ├── FR-0.5: Prometheus
         │    ├── FR-0.6: CloudWatch dashboards
         │    └── FR-0.7: Alerting
         │
         ├──► Track 1A: Pay (#79)
         │    ├── FR-1.1: Enable NOWPayments flag
         │    ├── FR-1.2: Wire webhook → credit mint
         │    ├── FR-1.3: Credit pack tiers
         │    ├── FR-1.4: Discord /buy-credits
         │    └── FR-1.5: Telegram /buy-credits
         │
         ├──► Track 2: Personalize (#80)
         │    ├── FR-2.1: Inference request enrichment (nft_id in JWT)
         │    ├── FR-2.2: Pool/personality metadata headers in response
         │    └── FR-2.3: Anti-narration enforcement
         │         │
         │         └──► Track 3: Discord Threads (#81)
         │              ├── FR-3.1: /my-agent thread creation
         │              ├── FR-3.2: Thread routing
         │              └── FR-3.3: /agent-info
         │
         ├──► Track 3: Dashboard (#82)
         │    ├── FR-3.4: Usage dashboard
         │    └── FR-3.5: Admin API endpoints
         │
         ├──► Track 4: Audit (#83)
         │    ├── FR-4.1: JSONL audit trail
         │    ├── FR-4.2: Pool transparency
         │    └── FR-4.3: Conservation endpoint
         │
         ├──► Product B: API Keys (#84)
         │    ├── FR-5.1: Key generation
         │    ├── FR-5.2: Key auth on inference
         │    ├── FR-5.3: Per-key rate limits
         │    └── FR-5.4: Self-service portal
         │
         └──► Track 3: Web Chat (#85)
              ├── FR-3.6: Embeddable widget
              └── FR-3.7: Standalone chat page
```

**Critical path:** Deploy (#77) → Pay (#79) + Personalize (#80) → Discord Threads (#81)

---

## 10. The Competitive Positioning

From loa-finn#66 §9:

```
Our moat is the intersection of:
  1. On-chain identity      → Token-gated model access (conviction scoring)
  2. Multi-model orchestration → 5 pools, ensemble strategies, per-model cost attribution
  3. Cost governance         → BigInt micro-USD, conservation invariants, budget atomicity

No competitor offers all three.
```

**vs. Nanobot:** They have 9 channels, we have 2 (Discord, Telegram) + API. But they have no cost governance, no token-gating, no NFT identity. We win on infrastructure depth.

**vs. Hive:** They have goal-driven agent generation and self-improvement. But they have no NFT identity, no on-chain gating, no formal economic verification. We win on the capability market model.

**This cycle closes the gap between "infrastructure advantage" and "users can experience it."**

---

## Appendix A: Issue Index

| Issue | Track | Title | Blocked By |
|-------|-------|-------|------------|
| [#77](https://github.com/0xHoneyJar/loa-freeside/issues/77) | Track 0 | Production Deployment | loa-finn#84 (Dockerfile) |
| [#78](https://github.com/0xHoneyJar/loa-freeside/issues/78) | Track 0 | Production Monitoring | #77 |
| [#79](https://github.com/0xHoneyJar/loa-freeside/issues/79) | Track 1A | NOWPayments Credit Purchase | Nothing (adapter built) |
| [#80](https://github.com/0xHoneyJar/loa-freeside/issues/80) | Track 2 | Per-NFT Personality Routing | loa-finn#88 or #86 (personality derivation in inference endpoint) |
| [#81](https://github.com/0xHoneyJar/loa-freeside/issues/81) | Track 3 | Per-NFT Discord Threads | #80, #77 |
| [#82](https://github.com/0xHoneyJar/loa-freeside/issues/82) | Track 3 | Community Budget Dashboard | #77 |
| [#83](https://github.com/0xHoneyJar/loa-freeside/issues/83) | Track 4 | Billing Audit Trail | #77 |
| [#84](https://github.com/0xHoneyJar/loa-freeside/issues/84) | Product B | API Key Management | #77, loa-finn#91 |
| [#85](https://github.com/0xHoneyJar/loa-freeside/issues/85) | Track 3 | Web Chat Widget | #77, #80 |
