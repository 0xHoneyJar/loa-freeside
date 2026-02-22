# Sprint Plan: Launch Readiness — Production Stack, Payments & Agent Surfaces

**Version:** 2.0.0
**Date:** 2026-02-21
**Cycle:** cycle-036
**Source:** Issues [#77](https://github.com/0xHoneyJar/loa-freeside/issues/77)–[#85](https://github.com/0xHoneyJar/loa-freeside/issues/85), [loa-finn#66](https://github.com/0xHoneyJar/loa-finn/issues/66)
**PRD:** grimoires/loa/prd.md v1.1.0
**SDD:** grimoires/loa/sdd.md v1.0.0
**Duration:** 6 sprints
**Team:** 1 engineer (AI-assisted)
**Protocol:** loa-hounfour v7.0.0 (`CONTRACT_VERSION = '7.0.0'`)

---

## Context

The Hounfour v7.0.0 Protocol Alignment (sprints 322–325) is complete. Freeside now speaks canonical v7.0.0 — de-vendored, fully typed, with dual-accept active for the transition window. This sprint plan implements the launch readiness work: deploying the full stack on **existing AWS ECS/Terraform infrastructure**, activating crypto payments, wiring the personality routing bridge, and building user surfaces.

### What Already Exists (Strict Reuse)

| Infrastructure | File | Status |
|---------------|------|--------|
| ECS Fargate cluster | `infrastructure/terraform/ecs.tf` | Production-ready |
| loa-finn ECS service | `infrastructure/terraform/ecs-finn.tf` | Defined (512 CPU, 1GB, internal-only) |
| loa-finn ECR repo | `infrastructure/terraform/ecs-finn.tf` | `arrakis-{env}-loa-finn` |
| loa-finn PgBouncer pool | `infrastructure/terraform/pgbouncer-finn.tf` | Isolated read-only role |
| Service discovery (finn) | `infrastructure/terraform/ecs-finn.tf` | `finn.arrakis-{env}.local:3000` |
| Service discovery (freeside) | `infrastructure/terraform/ecs.tf` | `freeside.arrakis-{env}.local:3000` (Cloud Map) |
| Wallet verification | `themes/sietch/src/api/routes/siwe.routes.ts` | SIWE + existing Discord `/verify` command |
| Chain event listener | `packages/adapters/chain/` | Existing NFT transfer detection (chain provider) |
| NOWPayments adapter | `themes/sietch/src/packages/adapters/billing/NOWPaymentsAdapter.ts` | Full API client + HMAC-SHA512 |
| Crypto billing routes | `themes/sietch/src/api/crypto-billing.routes.ts` | 5 endpoints + WAF protection |
| Payment DB schema | `themes/sietch/src/db/migrations/031_crypto_payments_v2.ts` | Tables + idempotency |
| Redis (ElastiCache) | `infrastructure/terraform/elasticache.tf` | Redis 7.0, encryption, 7-day snapshots |
| PostgreSQL (RDS) | `infrastructure/terraform/rds.tf` | PostgreSQL 15.10, auto-scaling 20-100GB |
| ALB + WAF | `infrastructure/terraform/alb.tf`, `waf.tf` | HTTPS, WebSocket support, rate limiting |
| Secrets Manager | `infrastructure/terraform/kms.tf` | KMS-encrypted, per-service scoping |
| Amazon Managed Prometheus | `infrastructure/terraform/amp.tf` | Metrics workspace |
| CloudWatch alarms | `infrastructure/terraform/monitoring.tf` | CPU/memory/5xx alerts |
| Agent monitoring | `infrastructure/terraform/agent-monitoring.tf` | Request latency, per-model breakdown |
| SNS alerting | `infrastructure/terraform/alerting.tf` | Alert topic (→ Slack) |
| Observability stack | `infrastructure/observability/` | Grafana, Prometheus, Tempo configs |
| Docker Compose (dev) | `docker-compose.dev.yml` | PostgreSQL + Redis + sietch |

### Stakeholder Directives

1. **NO Fly.io** — deploy exclusively on existing Terraform/ECS infrastructure (#77 comment)
2. **NOWPayments API key** available as env var (NOWPAYMENTS_API_KEY)
3. **Web chat is PRIMARY UI** — Discord threads are satellite/secondary (#81, #85 comments)
4. **IaC-first** — think about everything from the Terraform perspective for the wider dNFT system at scale
5. **Protocol v7.0.0** — all references use canonical loa-hounfour v7.0.0

---

## Sprint Overview

| Sprint | Focus | Issues | Gate |
|--------|-------|--------|------|
| Sprint 1 | Production Deployment — ECS + S2S Auth | #77 | `docker compose up` starts full stack; both ECS services healthy; S2S JWT validated |
| Sprint 2 | Revenue Activation — NOWPayments + Credit Mint | #79 | `/buy-credits 10` → checkout → webhook → credits arrive |
| Sprint 3 | Personality Routing Bridge — NFT → Model Pool | #80 | Two different NFTs get different model pool selections |
| Sprint 4 | Web Chat (Primary) + Discord Threads (Satellite) | #85, #81 | `/chat/:tokenId` streams responses; `/my-agent` creates Discord thread |
| Sprint 5 | Admin Dashboard + Audit Trail | #82, #83 | Admin views spend breakdown; downloads JSONL audit trail |
| Sprint 6 | Monitoring, API Platform + Go/No-Go | #78, #84 | Conservation guard failure alerts within 60s; developer creates API key |

---

## Sprint 1: Production Deployment — ECS + S2S Auth (Issue #77)

**Goal:** Both loa-freeside and loa-finn running on existing ECS infrastructure with authenticated S2S JWT communication.

### Task 1.0: Verify and enable loa-freeside ECS/Terraform resources (GPT F-1)

**Files:**
- `infrastructure/terraform/ecs.tf` (existing — verify)
- `infrastructure/terraform/alb.tf` (existing — verify)
- `infrastructure/terraform/variables.tf` (existing — verify)

**Description:** GPT finding F-1: The plan must explicitly verify loa-freeside ECS deployment, not just loa-finn. Confirm desired_count, ALB routing, env vars, Secrets Manager bindings, Cloud Map registration, and health check path alignment.

**Implementation:**
1. Verify freeside ECS task definition: desired_count > 0, CPU/memory, env vars from Secrets Manager
2. Verify ALB listener rules route `/api/*`, `/health`, `/.well-known/*` to freeside target group
3. Verify target group health check path matches `/health` route
4. Verify Cloud Map registration: `freeside.arrakis-{env}.local:3000` (GPT F-3: required for finn to reach JWKS endpoint)
5. Verify security group: ingress from ALB on port 3000, egress to finn SG, Redis, RDS, NATS
6. `terraform plan` should show no unexpected changes

**Acceptance Criteria:**
- [ ] `terraform plan` clean for freeside ECS resources
- [ ] ALB returns 200 on `GET /health` via public HTTPS
- [ ] Cloud Map DNS resolves `freeside.arrakis-{env}.local` from within VPC
- [ ] From finn task: `curl http://freeside.arrakis-{env}.local:3000/.well-known/jwks.json` returns JWKS (GPT F-3)

---

### Task 1.1: Verify and enable loa-finn Terraform resources

**Files:**
- `infrastructure/terraform/ecs-finn.tf` (existing — verify)
- `infrastructure/terraform/pgbouncer-finn.tf` (existing — verify)
- `infrastructure/terraform/variables.tf` (existing — update)

**Description:** The ECS service definition, ECR repo, security group, and service discovery for loa-finn already exist in Terraform. Verify all resource configurations match SDD §1.7, enable the service by setting `desired_count > 0`, and add any missing env vars (model API keys, Redis endpoint, S2S auth config).

**Implementation:**
1. Verify `ecs-finn.tf` task definition: CPU 512, Memory 1024, port 3000, internal-only SG
2. Verify `pgbouncer-finn.tf`: read-only role (`loa_finn_ro`), pool_size=20
3. Verify Cloud Map registration: `finn.arrakis-{env}.local:3000`
4. Add environment variables to finn task definition: `REDIS_URL`, `OPENAI_API_KEY` (from Secrets Manager), `ANTHROPIC_API_KEY`, `FREESIDE_JWKS_URL=http://freeside.arrakis-{env}.local:3000/.well-known/jwks.json` (uses Cloud Map DNS — see Task 1.0 AC)
5. Set `desired_count = 1` for staging (currently may be 0)
6. Verify IAM role has access to required secrets only

**Acceptance Criteria:**
- [ ] `terraform plan` shows no unexpected changes for finn resources
- [ ] Finn ECS service has all required env vars from Secrets Manager
- [ ] Security group allows ingress on port 3000 from API SG only
- [ ] Cloud Map DNS resolves `finn.arrakis-{env}.local`

---

### Task 1.2: Docker Compose full-stack local development

**Files:**
- `docker-compose.dev.yml` (existing — extend)

**Description:** Add loa-finn as a service to the existing Docker Compose for local development. Ensure both services can communicate via S2S JWT.

**Implementation:**
1. Add `loa-finn` service definition: build from `../loa-finn` (relative path) or pull from ECR
2. Configure shared Redis network between services
3. Add `FREESIDE_JWKS_URL=http://sietch-dev:3000/.well-known/jwks.json` to finn env
4. Add `LOA_FINN_URL=http://loa-finn:3000` to freeside env
5. Add health check configuration for both services
6. Document local setup in docker-compose comments

**Acceptance Criteria:**
- [ ] `docker compose -f docker-compose.dev.yml up` starts freeside, finn, PostgreSQL, Redis
- [ ] Both services report healthy via health endpoints
- [ ] Services can communicate on internal Docker network

---

### Task 1.3: ES256 JWT keypair and JWKS endpoint

**Files:**
- `themes/sietch/src/api/routes/jwks.routes.ts` (NEW)
- `themes/sietch/src/services/auth/JwksService.ts` (NEW)
- `themes/sietch/src/services/auth/S2SJwtSigner.ts` (NEW)
- `infrastructure/terraform/variables.tf` (add secret reference)

**Description:** Implement ES256 JWT signing for S2S communication (SDD §1.9). Freeside signs JWTs with `iss: loa-freeside`, `aud: loa-finn`, TTL 60s. JWKS endpoint publishes public key for finn verification.

**Implementation:**
1. Create `JwksService`: loads ES256 keypair from Secrets Manager (or env var for local dev), exposes public key as JWKS
2. Create `S2SJwtSigner`: signs JWTs with ES256, includes `{iss, aud, iat, exp, nft_id, tier, community_id, budget_reservation_id}`
3. Create `/.well-known/jwks.json` route serving the public key
4. Add Secrets Manager reference for `arrakis-{env}/agent-jwt-signing-key`
5. For local dev: generate ephemeral keypair on startup if no secret configured
6. Cache active signing key in memory (refresh every 60s from Secrets Manager)

**Acceptance Criteria:**
- [ ] `GET /.well-known/jwks.json` returns valid JWKS with ES256 public key
- [ ] `S2SJwtSigner.sign(payload)` produces a valid JWT verifiable against JWKS
- [ ] JWT contains required claims: `iss`, `aud`, `iat`, `exp`
- [ ] TTL enforced at 60s
- [ ] Works with both Secrets Manager and local ephemeral key

---

### Task 1.4: Database migrations (061-067)

**Files:**
- `themes/sietch/src/db/migrations/061_payment_state_machine.ts` (NEW)
- `themes/sietch/src/db/migrations/062_jwks_key_store.ts` (NEW)
- `themes/sietch/src/db/migrations/063_agent_threads.ts` (NEW)
- `themes/sietch/src/db/migrations/064_budget_reservations.ts` (NEW)
- `themes/sietch/src/db/migrations/065_api_keys.ts` (NEW)
- `themes/sietch/src/db/migrations/066_agent_messages.ts` (NEW — GPT F-5)
- `themes/sietch/src/db/migrations/067_usage_events.ts` (NEW — GPT F-9)

**Description:** Create all database schemas needed across sprints 1-6. Front-loading migrations avoids mid-sprint DDL.

**Implementation:**
1. `061`: Extend `crypto_payments` with full IPN state machine columns (`status` enum, `partially_paid_amount`, `reconciled_at`)
2. `062`: `jwks_keys` table for ES256 key metadata (`kid`, `created_at`, `active`, `public_key_jwk`)
3. `063`: `agent_threads` table (`thread_id`, `nft_id`, `community_id`, `owner_wallet`, `created_at`, `archived_at`)
4. `064`: `budget_reservations` table (`reservation_id`, `community_id`, `nft_id`, `amount_micro BIGINT`, `status` enum, `finalized_at`, `finalization_id UNIQUE`)
5. `065`: `api_keys` table (`key_prefix` indexed, `key_salt`, `key_hash`, `developer_id`, `rate_limit_rpm`, `rate_limit_tpd`, `allowed_pools`, `environment` enum)
6. `066`: `agent_messages` table (GPT F-5: separate from `agent_threads` metadata) — `message_id UUID PK`, `thread_id FK`, `nft_id`, `community_id`, `source ENUM('web','discord','telegram','api')`, `author_wallet VARCHAR`, `discord_user_id VARCHAR`, `content TEXT`, `role ENUM('user','assistant','system')`, `token_usage_input INT`, `token_usage_output INT`, `pool_id VARCHAR`, `created_at TIMESTAMPTZ` — indexed on `(thread_id, created_at)`
7. `067`: `usage_events` table (GPT F-9: immutable accounting ledger) — `event_id UUID PK`, `community_id`, `nft_id`, `pool_id`, `tokens_input INT`, `tokens_output INT`, `amount_micro BIGINT`, `reservation_id FK`, `finalization_id VARCHAR UNIQUE`, `conservation_guard_result BOOLEAN`, `conservation_guard_violations JSONB`, `created_at TIMESTAMPTZ` — indexed on `(community_id, created_at)`, immutable (no UPDATE/DELETE)

**Acceptance Criteria:**
- [ ] All migrations run without errors on fresh and existing databases
- [ ] No `DROP` statements (additive only)
- [ ] All BigInt columns for monetary values
- [ ] Unique constraints on `finalization_id`, `key_prefix`, `thread_id+nft_id`
- [ ] `agent_messages` indexed on `(thread_id, created_at)` for efficient history queries (GPT F-5)
- [ ] `usage_events` indexed on `(community_id, created_at)` for admin dashboard queries (GPT F-9)
- [ ] `usage_events` has no UPDATE/DELETE grants — append-only audit table

---

### Task 1.5: Health check endpoint verification

**Files:**
- `themes/sietch/src/api/routes/health.routes.ts` (existing — verify/extend)

**Description:** Ensure both services expose health endpoints compatible with ECS health checks and ALB target group configuration.

**Implementation:**
1. Verify freeside `GET /health` returns 200 with `{status: "ok", version, uptime}`
2. Add dependency checks: DB reachable, Redis reachable
3. Verify loa-finn health endpoint format matches ECS health check config
4. Ensure ALB health check path matches route

**Acceptance Criteria:**
- [ ] `GET /health` returns 200 when dependencies are healthy
- [ ] Returns 503 when DB or Redis unreachable
- [ ] Response includes `contract_version: '7.0.0'` header (for peer verification — Task 4.9 from sprint 325)

---

### Task 1.6: [CROSS-REPO] loa-finn ES256 JWT verification against JWKS (GPT F-2)

**Repo:** loa-finn (not loa-freeside)

**Description:** GPT finding F-2: Only the signing/JWKS publishing side is planned in freeside. loa-finn must implement the verification side — JWKS fetch, caching, `aud`/`iss`/`exp` enforcement, `kid` selection, clock skew handling.

**Implementation (loa-finn):**
1. Add JWKS client: fetch from `$FREESIDE_JWKS_URL`, cache keys for 5 min, refresh on `kid` miss
2. JWT verification middleware: validate `iss = 'loa-freeside'`, `aud = 'loa-finn'`, `exp` with 5s clock skew tolerance
3. Extract claims: `{nft_id, tier, community_id, budget_reservation_id}` from verified JWT
4. Reject requests with missing/expired/invalid JWT (401 with structured error)
5. Integration test: freeside signs JWT → finn verifies via JWKS → request succeeds

**Acceptance Criteria:**
- [ ] loa-finn fetches and caches JWKS from freeside Cloud Map endpoint
- [ ] JWT with valid claims passes verification
- [ ] Expired JWT rejected (401)
- [ ] Wrong `iss` or `aud` rejected (401)
- [ ] Integration test: sign-then-verify round-trip succeeds in staging

**Mitigation if loa-finn changes can't land:**
- Ship JWKS verifier as a standalone PR to loa-finn (small surface area)
- Temporary fallback: pre-shared symmetric key NOT acceptable per security requirements (ES256 required)
- Escalation: block Sprint 3 start until finn verification lands

---

## Sprint 2: Revenue Activation — NOWPayments + Credit Mint (Issue #79)

**Goal:** Users can buy credits with crypto. First real payment collected.

### Task 2.1: Enable NOWPayments feature flag and configure secrets

**Files:**
- `infrastructure/terraform/variables.tf` (update default)
- `themes/sietch/src/config.ts` (verify env var loading)

**Description:** The NOWPayments adapter is built and tested (95 passing tests from cycle-005). The `FEATURE_CRYPTO_PAYMENTS_ENABLED` flag is currently `false`. Enable it in staging first, then production.

**Implementation:**
1. Set `FEATURE_CRYPTO_PAYMENTS_ENABLED=true` in Terraform staging variables
2. Verify `NOWPAYMENTS_API_KEY` loads from Secrets Manager (`arrakis-{env}/nowpayments`)
3. Verify `NOWPAYMENTS_IPN_SECRET` loads for webhook verification
4. Configure webhook callback URL to `https://api.{domain}/api/crypto/webhook`
5. Verify WAF rule on `/api/crypto/webhook` (already exists: 100 req/min per IP)

**Acceptance Criteria:**
- [ ] Feature flag enabled in staging
- [ ] NOWPayments API key and IPN secret loaded from Secrets Manager
- [ ] Webhook URL configured in NOWPayments dashboard
- [ ] WAF rate limiting active on webhook endpoint

---

### Task 2.2: Credit pack product definition

**Files:**
- `themes/sietch/src/config.ts` (add credit pack config)
- `themes/sietch/src/services/billing/credit-packs.ts` (NEW)

**Description:** Define credit pack tiers as per SDD §Phase 2. Single source of truth for pricing, USD-to-microcredit conversion, and bonus percentages.

**Implementation:**
1. Define `CREDIT_PACKS` constant with 3 tiers (SDD pricing table):
   - Starter: $5 → 5,000,000 micro-credits (0% bonus)
   - Standard: $10 → 10,500,000 micro-credits (5% bonus)
   - Premium: $25 → 27,500,000 micro-credits (10% bonus)
2. All arithmetic via BigInt — no floating-point
3. Minimum payment: $5 (enforced at command level)
4. Export `getCreditPackByAmount(usdAmount: number)` helper

**Acceptance Criteria:**
- [ ] 3 credit pack tiers defined with BigInt micro-credit amounts
- [ ] No floating-point in monetary calculations
- [ ] Minimum $5 enforced
- [ ] Helper function resolves USD amount to pack definition

---

### Task 2.3: Discord `/buy-credits` slash command

**Files:**
- `themes/sietch/src/discord/commands/buy-credits.ts` (NEW)
- `apps/worker/src/handlers/commands/index.ts` (register command)

**Description:** Discord slash command that creates a NOWPayments checkout URL and returns it to the user.

**Implementation:**
1. Register `/buy-credits` command with `amount` parameter (number, choices: 5/10/25)
2. On invocation: look up credit pack tier → call NOWPayments `create_payment` API → return checkout URL as ephemeral message
3. Store payment record in DB (status: `waiting`, `payment_id`, `community_id`, `user_wallet`)
4. Handle errors: amount too low, NOWPayments API failure, user not verified

**Acceptance Criteria:**
- [ ] `/buy-credits 10` returns a NOWPayments checkout link
- [ ] Payment record created in DB with status `waiting`
- [ ] Ephemeral response (only visible to invoker)
- [ ] Amounts below $5 rejected

---

### Task 2.4: Webhook → credit mint pipeline with conservation guard

**Files:**
- `themes/sietch/src/services/billing/CryptoWebhookService.ts` (existing — extend)
- `themes/sietch/src/api/crypto-billing.routes.ts` (existing — verify)

**Description:** Wire the existing NOWPayments webhook handler to the credit mint pipeline. On successful payment (`finished` status), mint credit lot with conservation guard verification.

**Implementation:**
1. Extend `CryptoWebhookService` to handle full IPN state machine: `waiting` → `confirming` → `confirmed` → `sending` → `partially_paid` | `finished` | `failed` | `expired`
2. On `finished`: mint credit lot using existing budget engine (`BigInt` micro-credits)
3. Fire conservation guard on credit creation (verify I-1 through I-14 invariants)
4. Handle `partially_paid`: no credits minted, log for admin reconciliation
5. Idempotency: `SELECT ... FOR UPDATE` on `payment_id` prevents double-mint
6. Send Discord confirmation message to user on success

**Acceptance Criteria:**
- [ ] Webhook receives payment confirmation and creates credit balance
- [ ] Conservation guard fires on credit creation
- [ ] Double-payment handled idempotently (replay returns 200, no double-mint)
- [ ] `partially_paid` logged but no credits minted
- [ ] User receives Discord confirmation message

---

### Task 2.5: Payment reconciliation job

**Files:**
- `themes/sietch/src/jobs/payment-reconciliation.ts` (NEW)

**Description:** Background job that polls NOWPayments for payments stuck in intermediate states (SDD §1.4 failure modes).

**Implementation:**
1. Run every 5 minutes
2. Query DB for payments with status `waiting` or `confirming` older than 20 minutes
3. Poll NOWPayments `GET /payment/:id` for current status
4. Update DB status accordingly
5. If `finished` but no credit lot: trigger mint (same path as webhook)
6. If `expired` or `failed`: update status, no action needed

**Acceptance Criteria:**
- [ ] Job runs every 5 minutes
- [ ] Stuck payments detected and reconciled
- [ ] Missed webhooks recovered via polling
- [ ] No duplicate minting (idempotency guards)

---

### Task 2.6: E2E webhook replay test harness (GPT F-7)

**Files:**
- `themes/sietch/src/tests/integration/webhook-replay.test.ts` (NEW)
- `themes/sietch/src/tests/fixtures/nowpayments-ipn-sample.json` (NEW)

**Description:** GPT finding F-7: Webhook signature mismatches, header naming differences, or body canonicalization issues are a top cause of launch failure. Capture a real/sandbox IPN request and build an automated replay test.

**Implementation:**
1. Capture a real NOWPayments sandbox IPN request (raw body bytes + all headers)
2. Store as test fixture: `{headers: {...}, body: "raw string", expected_signature: "..."}`
3. Replay test: POST fixture to staging `/api/crypto/webhook` endpoint
4. Assert: HMAC-SHA512 signature validates, state transition correct (→ `finished`), credits minted exactly once
5. Replay again (idempotency): assert 200 returned, no double-mint, credit balance unchanged
6. Test `partially_paid` fixture: assert no credits minted, status updated

**Acceptance Criteria:**
- [ ] Captured real/sandbox IPN payload stored as test fixture
- [ ] Replay test validates HMAC-SHA512 signature end-to-end
- [ ] State machine transition correct on replay
- [ ] Idempotent replay: no double-mint
- [ ] `partially_paid` scenario tested

---

## Sprint 3: Personality Routing Bridge (Issue #80)

**Goal:** Different NFTs get different model routing based on personality derivation.

### Task 3.1: Personality lookup client

**Files:**
- `packages/adapters/agent/personality-client.ts` (NEW)

**Description:** loa-freeside calls loa-finn's personality endpoint to get NFT personality data for routing decisions. Uses S2S JWT from Task 1.3 for authentication.

**Implementation:**
1. Create `PersonalityClient` that calls `GET /api/v1/nft/:tokenId/personality` on loa-finn
2. Authenticate with S2S JWT signed by freeside
3. Parse response: `{personality_summary, emphasis_weights, tier, pool_preferences, element}`
4. Note: `element` field now carries per-card differentiation for Major Arcana NFTs (loa-finn PR #92 — air/water/earth/fire per Drug-Tarot Codec)
5. Cache result in Redis (`personality:{nft_id}`, TTL 5 min)
6. Cache invalidation: TTL-based only for this sprint (GPT F-8: event-driven invalidation via on-chain transfer listener deferred to post-launch — requires event ingestion pipeline not yet scoped)

**Acceptance Criteria:**
- [ ] Client fetches personality from loa-finn via S2S JWT
- [ ] Response cached in Redis (5 min TTL)
- [ ] TTL expiry forces re-fetch (verified by test)
- [ ] Graceful degradation if loa-finn unreachable (use default personality)
- [ ] NOTE: Event-driven cache invalidation on NFT transfer deferred to post-launch (GPT F-8)

---

### Task 3.2: Pool selection logic

**Files:**
- `packages/adapters/agent/pool-selector.ts` (NEW)

**Description:** Map personality tier and emphasis weights to model pool selection (SDD §Phase 3). Uses loa-hounfour v7.0.0 canonical `RoutingPolicy` and `TaskType` types.

**Implementation:**
1. Import `RoutingPolicy`, `TaskType` from `@0xhoneyjar/loa-hounfour`
2. Map personality tier (Basic → `cheap` pool only, Standard → `cheap` + `fast-code`, Premium → all 5 pools)
3. Map emphasis weights to preferred pool per task type
4. Factor in `element` field for personality-aware routing (fire → reasoning, water → creative, earth → structured, air → fast-code)
5. Return selected pool + fallback pool

**Acceptance Criteria:**
- [ ] Basic tier restricted to `cheap` pool
- [ ] Premium tier has access to all 5 pools (cheap, fast-code, reviewer, reasoning, architect)
- [ ] Element-based routing varies selection for Major Arcana NFTs
- [ ] Two different NFTs get different pool selections (integration test)

---

### Task 3.3: Request enrichment and budget reservation

**Files:**
- `packages/adapters/agent/loa-finn-client.ts` (existing — extend)
- `packages/adapters/agent/budget-manager.ts` (existing — extend)

**Description:** Enrich inference requests with personality context and manage budget reservation lifecycle (reserve → finalize → cleanup).

**Implementation:**
1. Before inference: create pessimistic budget reservation (`INSERT INTO budget_reservations`)
2. Sign S2S JWT with `{nft_id, tier, budget_reservation_id, community_id}` claims
3. Call loa-finn inference endpoint with personality context in system prompt
4. Anti-narration enforcement: no forbidden identity terms in system prompt (per SDD §Phase 3)
5. On response: parse `X-Pool-Used`, `X-Personality-Id`, `X-Tokens-Used` headers
6. Finalize budget with actual token count (single DB transaction, SDD §1.5 atomicity)
7. Orphan cleanup: job releases reservations older than 5 min with status `reserved`

**Acceptance Criteria:**
- [ ] Budget reserved before inference request
- [ ] S2S JWT contains all required claims
- [ ] Budget finalized with actual token count after response
- [ ] Orphaned reservations cleaned up within 5 minutes
- [ ] Anti-narration terms excluded from system prompt

---

### Task 3.4: Orphan reservation cleanup job

**Files:**
- `themes/sietch/src/jobs/orphan-reservation-cleanup.ts` (NEW)

**Description:** Background job that releases orphaned budget reservations (SDD §1.5 failure modes).

**Implementation:**
1. Run every 5 minutes
2. Query `budget_reservations WHERE status = 'reserved' AND created_at < NOW() - INTERVAL '5 minutes'`
3. Release each: set `status = 'expired'`, restore credit balance
4. Log released reservations for audit

**Acceptance Criteria:**
- [ ] Orphaned reservations released within 5 minutes
- [ ] Credit balance restored on release
- [ ] Audit log entry for each released reservation

---

### Task 3.5: Persist per-finalization accounting events to `usage_events` (GPT F-9)

**Files:**
- `packages/adapters/agent/usage-event-writer.ts` (NEW)
- `packages/adapters/agent/budget-manager.ts` (existing — extend finalization path)

**Description:** GPT finding F-9: Admin spend breakdown (G-6) and JSONL audit trail (G-7) require durable per-request accounting records. The budget finalization path must write an immutable `usage_events` row (migration 067) on every finalization.

**Implementation:**
1. Create `UsageEventWriter` service: writes one row to `usage_events` per budget finalization
2. Fields: `community_id`, `nft_id`, `pool_id` (from `X-Pool-Used` header), `tokens_input`, `tokens_output`, `amount_micro` (BigInt), `reservation_id`, `finalization_id`, `conservation_guard_result`, `conservation_guard_violations` (JSONB, nullable)
3. Write happens inside the same DB transaction as budget finalization (atomic — either both commit or neither)
4. No UPDATE/DELETE on `usage_events` — append-only by design
5. Sprint 5 admin endpoints (Tasks 5.1, 5.2) will query this table for breakdowns and JSONL export

**Acceptance Criteria:**
- [ ] Every budget finalization writes one row to `usage_events`
- [ ] Write is atomic with finalization transaction (same DB transaction)
- [ ] All monetary values stored as BigInt micro-credits
- [ ] `conservation_guard_result` captured per event
- [ ] Table is append-only (no UPDATE/DELETE)
- [ ] Query by `(community_id, created_at)` is efficient (indexed)

---

## Sprint 4: Web Chat (Primary) + Discord Threads (Satellite) (Issues #85, #81)

**Goal:** Primary web chat interface at `/chat/:tokenId` streams responses. Discord threads provide satellite access.

### Task 4.0: ALB/WAF WebSocket compatibility verification (GPT F-4)

**Files:**
- `infrastructure/terraform/alb.tf` (existing — verify/update)
- `infrastructure/terraform/waf.tf` (existing — verify/update)

**Description:** GPT finding F-4: Production WebSocket commonly fails without ALB idle timeout tuning, correct listener rule path patterns, and ensuring WAF doesn't block HTTP Upgrade requests. Verify and fix before building app-level WebSocket code.

**Implementation:**
1. Verify ALB idle timeout in `alb.tf` — must be ≥120s for WebSocket (already 300s per existing config, confirm)
2. Verify/add ALB listener rules for `/chat/*` and `/chat/*/ws` paths → route to freeside target group
3. Verify WAF rules in `waf.tf` do not block `Upgrade: websocket` header (check existing rule sets)
4. If WAF blocks WebSocket upgrade: add exception rule for `/chat/*` path pattern
5. Verify target group stickiness configuration (WebSocket needs sticky sessions or stateless design)
6. Deploy to staging and test: `wscat -c wss://staging.api.{domain}/chat/test/ws` connects and stays alive for 5 minutes

**Acceptance Criteria:**
- [ ] ALB idle timeout ≥120s confirmed in Terraform
- [ ] Listener rules route `/chat/*` paths to correct target group
- [ ] WAF allows `Upgrade: websocket` on `/chat/*` paths
- [ ] `wscat` connects via staging ALB and streams for 5+ minutes without disconnect
- [ ] CloudWatch shows successful 101 Switching Protocols responses

---

### Task 4.1: Standalone chat page and WebSocket endpoint

**Files:**
- `themes/sietch/src/api/routes/chat.routes.ts` (NEW)

**Description:** The web chat is the **primary** interface for dNFT interaction (#85 comment). Build a standalone chat page at `/chat/:tokenId` with WebSocket streaming.

**Implementation:**
1. `GET /chat/:tokenId` — serves chat page HTML (lightweight, mobile-responsive)
2. `WS /chat/:tokenId/ws` — WebSocket endpoint for streaming inference
3. On WebSocket connect: authenticate via JWT (NFT holders) or session token
4. On message: route through personality bridge (Task 3.1-3.3) → stream response tokens back via WebSocket
5. Read-only mode: no auth required for viewing (public chat history)
6. Personality-aware visual styling (use `element` field for color theme)

**Acceptance Criteria:**
- [ ] `GET /chat/:tokenId` serves responsive chat page
- [ ] WebSocket streams inference responses in real-time
- [ ] Authenticated users can send messages
- [ ] Read-only mode available without auth
- [ ] Mobile-responsive design

---

### Task 4.2: SIWE authentication for web chat

**Files:**
- `themes/sietch/src/api/routes/siwe.routes.ts` (existing — extend for chat context)

**Description:** Extend existing SIWE (Sign-In with Ethereum) auth for the web chat widget. Verify wallet ownership matches NFT holder.

**Implementation:**
1. Reuse existing SIWE verification flow (routes already exist)
2. After SIWE auth: verify user's wallet owns the NFT for the requested `tokenId`
3. Issue session token scoped to `tokenId` (JWT with `nft_id`, `wallet`, `tier`)
4. Session token used for WebSocket authentication
5. Note: wildcard CORS already blocked in production (Sprint 325, Task 4.4)

**Acceptance Criteria:**
- [ ] SIWE auth flow works for web chat context
- [ ] Session token scoped to specific NFT
- [ ] Non-owner wallet cannot authenticate for another's NFT

---

### Task 4.3: Embeddable web chat widget

**Files:**
- `themes/sietch/public/widget.js` (NEW)
- `themes/sietch/src/api/routes/chat.routes.ts` (extend)

**Description:** Lightweight embeddable `<script>` tag for third-party websites (#85).

**Implementation:**
1. Build static JS bundle (`widget.js`) that creates chat iframe or inline component
2. Configuration via `data-*` attributes: `data-token-id`, `data-theme` (light/dark), `data-position` (bottom-right/left/fullscreen)
3. `GET /widget.js` serves the bundle (Cache-Control: public, max-age=3600)
4. Widget connects to same WebSocket endpoint as standalone page
5. Personality-aware theming (element → color palette)

**Acceptance Criteria:**
- [ ] Widget embeddable via single `<script>` tag
- [ ] Configurable via data attributes
- [ ] Connects to WebSocket and streams responses
- [ ] Personality-aware styling

---

### Task 4.4: Discord `/my-agent` command — thread creation (GPT F-6: wallet linking)

**Files:**
- `themes/sietch/src/discord/commands/my-agent.ts` (NEW)
- `apps/worker/src/handlers/commands/index.ts` (register)
- `themes/siecht/src/api/routes/siwe.routes.ts` (existing — Discord `/verify` wallet linking)

**Description:** Discord satellite UI for per-NFT conversational spaces (#81). Thread per NFT with bot-enforced gating. GPT finding F-6: Discord↔wallet linking is required for ownership verification inside Discord. The existing `/verify` command (listed in "What Already Exists") provides this binding via SIWE + DM/web callback flow.

**Implementation:**
1. Register `/my-agent` slash command
2. **Prerequisite: wallet linked** — check existing Discord↔wallet mapping in DB (from `/verify` command, GPT F-6)
3. If wallet not linked: respond with ephemeral message instructing user to run `/verify` first (links to SIWE web callback)
4. If wallet linked: verify wallet owns the NFT for requested `tokenId` → look up NFT personality → create/find dedicated thread
5. Thread name from NameKDF or `Agent #[tokenId]`
6. Store thread mapping in `agent_threads` table (migration 063)
7. If thread exists: navigate user to existing thread
8. Bot-enforced gating: only NFT owner can write in thread (re-check wallet↔Discord binding per message, cached 60s)

**Acceptance Criteria:**
- [ ] `/my-agent` creates dedicated thread for NFT holder
- [ ] Thread named based on personality
- [ ] Existing thread reused on repeat invocation
- [ ] Non-owner cannot write in gated thread
- [ ] Unlinked Discord user blocked with clear `/verify` instruction (GPT F-6)
- [ ] Wallet↔Discord binding verified before thread creation

---

### Task 4.5: Thread message routing through personality bridge

**Files:**
- `apps/worker/src/handlers/events/thread-message-handler.ts` (existing — extend)

**Description:** Messages in agent threads route through the personality bridge (Sprint 3) for personality-driven responses.

**Implementation:**
1. Detect messages in agent threads (check `agent_threads` table)
2. Route through personality bridge: lookup → pool selection → budget reserve → inference → finalize
3. Stream response back to Discord thread
4. Maintain conversational context (last N messages as context window)
5. Per-message ownership re-verification (cached 60s in Redis)

**Acceptance Criteria:**
- [ ] Messages in agent threads get personality-routed responses
- [ ] Different NFT holders get different personality responses
- [ ] Conversational context maintained across messages
- [ ] Ownership re-verified per message (cached)

---

### Task 4.6: Channel synchronization design (web ↔ Discord)

**Files:**
- `themes/sietch/src/services/chat/channel-sync.ts` (NEW)

**Description:** Web chat is primary; Discord is satellite. Conversations should be visible across both surfaces (#85 comment: "figure out synchronisation").

**Implementation:**
1. Store all messages in `agent_messages` table (migration 066, GPT F-5) with `source` field (`web` | `discord` | `telegram` | `api`)
2. Web chat reads from `agent_messages` joined on `thread_id` (unified conversation history)
3. Discord thread messages also written to `agent_messages` via thread-message-handler
4. For P0: one-way sync (Discord → DB). Full bidirectional sync deferred to P1.
5. API endpoint: `GET /api/v1/chat/:tokenId/history` returns paginated conversation from `agent_messages`
6. Note: `agent_threads` (migration 063) stores thread metadata only; `agent_messages` stores message content

**Acceptance Criteria:**
- [ ] Messages from both surfaces stored in `agent_messages` table (GPT F-5)
- [ ] Web chat displays full conversation history including Discord messages
- [ ] History API returns paginated results (cursor-based on `created_at`)
- [ ] Source field tracks message origin (`web`, `discord`, `telegram`, `api`)

---

## Sprint 5: Admin Dashboard + Audit Trail (Issues #82, #83)

**Goal:** Community admins have visibility into spend, usage, and model allocation. Billing is auditable.

### Task 5.1: Admin API endpoints

**Files:**
- `themes/sietch/src/api/routes/admin-dashboard.routes.ts` (NEW)

**Description:** REST API for community admin dashboards (SDD §Phase 4).

**Implementation:**
1. `GET /api/v1/admin/community/:id/usage` — total spend, per-pool breakdown, per-user breakdown (queries `usage_events` table from migration 067, GPT F-9)
2. `GET /api/v1/admin/community/:id/billing` — credit balance, projected depletion date, transaction history
3. `GET /api/v1/admin/community/:id/agents` — active agents, thread counts, personality summaries
4. `GET /api/v1/admin/community/:id/conservation` — current invariant status, last check, violations (queries `conservation_guard_result` from `usage_events`)
5. Auth: require admin role (existing role system) or community owner wallet

**Acceptance Criteria:**
- [ ] All 4 admin endpoints return correct data
- [ ] Usage broken down by model pool (from `usage_events.pool_id`, GPT F-9)
- [ ] Credit balance includes projected depletion date
- [ ] Admin role required (non-admin gets 403)

---

### Task 5.2: Billing audit trail JSONL export

**Files:**
- `themes/sietch/src/api/routes/admin-dashboard.routes.ts` (extend)

**Description:** Downloadable JSONL of all credit operations per community (#83). Reads from `usage_events` table (migration 067, GPT F-9).

**Implementation:**
1. `GET /api/v1/admin/community/:id/audit?format=jsonl` — streaming JSONL download from `usage_events` table
2. Each line: `{timestamp, operation_type, amount_micro, model_pool, nft_id, tokens_input, tokens_output, conservation_guard_result, finalization_id}` (sourced from `usage_events`)
3. Configurable retention (default 90 days, via query param `days=N`)
4. Also support `format=csv` for non-technical admins
5. No PII leaks — wallet addresses are pseudonymous

**Acceptance Criteria:**
- [ ] JSONL download contains all credit operations
- [ ] Each entry includes conservation guard result
- [ ] CSV format also available
- [ ] Retention filter works (default 90 days)

---

### Task 5.3: Pool enforcement transparency

**Files:**
- `themes/sietch/src/api/routes/admin-dashboard.routes.ts` (extend)

**Description:** Admins see which model pools their agents access and why (#83).

**Implementation:**
1. `GET /api/v1/admin/community/:id/pool-access` — list accessible pools per tier
2. Each pool entry: `{pool_id, access_reason, tier_required, conviction_score_required}`
3. Include confused deputy rejection count (attempts to access pools above tier)
4. Historical pool usage distribution (last 30 days)

**Acceptance Criteria:**
- [ ] Pool access list visible per community
- [ ] Clear explanation of why each pool is accessible
- [ ] Confused deputy rejections visible

---

## Sprint 6: Monitoring, API Platform + Go/No-Go (Issues #78, #84)

**Goal:** Production monitoring with human alerting. Developer self-service API keys. Go/no-go gate for production deploy.

### Task 6.0: Conservation guard metrics instrumentation (GPT F-10)

**Files:**
- `packages/core/services/conservation-guard.ts` (existing — extend)
- `themes/sietch/src/services/metrics/prometheus-metrics.ts` (NEW or extend existing)

**Description:** GPT finding F-10: G-3 requires conservation guard failure alerts within 60s. Terraform alarms alone won't work unless the application emits a signal. Add Prometheus counter + structured log on every conservation guard violation.

**Implementation:**
1. Add Prometheus counter: `conservation_guard_failures_total{invariant="I-1",...,"I-14"}` — incremented on any invariant violation
2. Add Prometheus counter: `conservation_guard_checks_total{result="pass|fail"}` — incremented on every check (for rate calculation)
3. On violation: emit structured JSON log line `{"level":"error","event":"conservation_guard_violation","invariant":"I-N","details":{...},"timestamp":"..."}`
4. CloudWatch metric filter (in Terraform Task 6.2): parse structured log for `conservation_guard_violation` events → CloudWatch metric
5. AMP/Prometheus: ADOT sidecar (Task 6.1) scrapes counter → AMP workspace
6. Test: force a known invariant failure in staging, verify counter increments and alert fires within 60s

**Acceptance Criteria:**
- [ ] Prometheus counter `conservation_guard_failures_total` incremented on violation
- [ ] Structured JSON log emitted on every violation with invariant ID
- [ ] Counter labels include invariant identifier (I-1 through I-14)
- [ ] Staging test: forced violation → alert fires within 60s
- [ ] Both Prometheus counter and CloudWatch metric filter paths functional

---

### Task 6.1: ADOT sidecar for Prometheus metrics

**Files:**
- `infrastructure/terraform/ecs-finn.tf` (extend task definition)
- `infrastructure/terraform/ecs.tf` (extend API task definition)

**Description:** Add AWS Distro for OpenTelemetry (ADOT) sidecar to both ECS task definitions for Prometheus metrics scraping (SDD §1.7).

**Implementation:**
1. Add ADOT sidecar container to loa-finn task definition
2. Add ADOT sidecar container to API task definition (if not already present)
3. Configure Prometheus scrape endpoints for both services
4. Route metrics to existing AMP workspace (`infrastructure/terraform/amp.tf`)
5. Key metrics: request rate, latency p50/p99, error rate, billing operations, auth failures

**Acceptance Criteria:**
- [ ] ADOT sidecar running on both ECS services
- [ ] Metrics flowing to AMP workspace
- [ ] Prometheus scrape targets reachable

---

### Task 6.2: CloudWatch alerting → SNS → Slack

**Files:**
- `infrastructure/terraform/monitoring.tf` (extend)
- `infrastructure/terraform/alerting.tf` (extend)

**Description:** Add alerting rules for launch-critical conditions (SDD §Phase 6).

**Implementation:**
1. Conservation guard failure → alarm on `conservation_guard_failures_total` Prometheus counter (from Task 6.0, GPT F-10) OR CloudWatch metric filter on structured log → SNS → Slack (within 60s evaluation period)
2. Service downtime (health check failures > 3 consecutive) → critical alert
3. 5xx error rate > 5% → warning alert
4. Billing webhook failure rate > 10% → critical alert
5. Budget drift (reservations vs finalizations mismatch) → warning alert
6. Configure SNS topic subscription to Slack webhook
7. Add CloudWatch metric filter: parse structured JSON logs for `"event":"conservation_guard_violation"` → CloudWatch metric (backup path if AMP/Prometheus unavailable)

**Acceptance Criteria:**
- [ ] Conservation guard failure alerts within 60s (depends on Task 6.0 instrumentation)
- [ ] Service downtime triggers critical alert
- [ ] Alerts delivered to Slack channel
- [ ] All alert rules defined in Terraform (IaC)
- [ ] Dual alert path: Prometheus counter via AMP + CloudWatch metric filter via logs

---

### Task 6.3: API key generation and authentication (Product B)

**Files:**
- `themes/sietch/src/api/routes/api-keys.routes.ts` (NEW)
- `themes/sietch/src/services/auth/ApiKeyService.ts` (NEW)

**Description:** Self-service API key management for the developer product (#84). Two-part key design for hot-path performance (SDD §1.9).

**Implementation:**
1. Key format: `lf_live_{prefix}_{secret}` / `lf_test_{prefix}_{secret}`
2. `prefix` = 12 chars base32 (public identifier, indexed for lookup)
3. `secret` = 32 chars base62 (≥190 bits entropy)
4. Storage: `key_prefix` (plaintext, indexed) + `key_salt` (16 bytes random) + `key_hash` = `HMAC-SHA256(PEPPER, salt || secret)`
5. Auth flow: extract prefix → lookup → HMAC verify with `crypto.timingSafeEqual`
6. Endpoints: `POST /api/v1/keys` (create), `GET /api/v1/keys` (list), `DELETE /api/v1/keys/:prefix` (revoke)
7. Per-key rate limiting: RPM + tokens/day stored in key metadata
8. Redis negative cache for failed lookups (1 min TTL)

**Acceptance Criteria:**
- [ ] Developer can create API key via POST endpoint
- [ ] Key authenticates inference requests via `Authorization: Bearer lf_live_...`
- [ ] Per-key rate limiting enforced
- [ ] Keys revocable immediately
- [ ] `timingSafeEqual` used for comparison (no timing attacks)

---

### Task 6.4: Sandbox mode for developers

**Files:**
- `themes/sietch/src/services/auth/ApiKeyService.ts` (extend)

**Description:** Free-tier sandbox for developer testing (#84).

**Implementation:**
1. `lf_test_` keys restricted to `cheap` pool only
2. Rate limit: 10 RPM, 1000 tokens/day
3. No billing charged (sandbox credit pool)
4. Upgrade path: swap `lf_test_` for `lf_live_` with billing configured

**Acceptance Criteria:**
- [ ] Test keys restricted to cheap pool
- [ ] Rate limits enforced (10 RPM, 1000 TPD)
- [ ] No charges incurred
- [ ] Clear upgrade path documented

---

### Task 6.5: Go/no-go gate checklist

**Files:**
- `scripts/go-no-go-checklist.sh` (NEW)

**Description:** Automated verification script for production deploy readiness.

**Implementation:**
1. Check health endpoints on both services
2. Verify S2S JWT exchange (sign → verify round-trip)
3. Verify NOWPayments webhook connectivity (dry-run)
4. Verify peer protocol version (`scripts/verify-peer-version.sh` from Sprint 325)
5. Verify CloudWatch alarms configured
6. Verify conservation guard status
7. Load baseline test: 10 concurrent inference requests
8. Output: PASS/FAIL with detailed report

**Acceptance Criteria:**
- [ ] Script validates all pre-deploy conditions
- [ ] S2S JWT round-trip verified
- [ ] Protocol v7.0.0 peer compatibility confirmed
- [ ] Load baseline test passes
- [ ] Clear PASS/FAIL output

---

## Dependencies & Cross-Repo Blockers

| Dependency | Source | Impact | Mitigation |
|-----------|--------|--------|------------|
| loa-finn ES256 JWT verification (GPT F-2) | loa-finn (Task 1.6) | **Blocks Sprint 3** — S2S auth can't be proven working | Ship JWKS verifier as standalone PR to loa-finn; small surface area, no HS256 fallback |
| loa-finn Dockerfile | loa-finn#84 | Blocks Sprint 1 local dev | Can create Dockerfile from freeside patterns; escalate after 3 days |
| loa-finn personality endpoint | loa-finn#88 or #86 | Blocks Sprint 3 | Stub with static personality config |
| loa-finn inference endpoint contract | loa-finn team | Blocks Sprint 3 | Assume `/api/v1/inference` per RFC #31 |
| NOWPayments account setup | Ops | Blocks Sprint 2 (production only) | Sandbox mode available for development |
| Element derivation (loa-finn PR #92) | loa-finn | Enriches Sprint 3 | Default to `fire` if element not available |

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| loa-finn JWT verifier not landed (GPT F-2) | Medium | Blocks Sprint 3 | Ship as standalone PR, small surface area |
| loa-finn Dockerfile not ready | Medium | Blocks Sprint 1 | Create Dockerfile from freeside patterns |
| Redis memory pressure | Low | Latency | maxmemory-policy allkeys-lru, TTLs enforced |
| NOWPayments IPN delivery failure | Low | Missed payments | Reconciliation job (Task 2.5) |
| NOWPayments webhook signature mismatch (GPT F-7) | Medium | Blocks G-2 | E2E replay test harness (Task 2.6) |
| ES256 key rotation | Low | Auth outage | 24h overlap window, staging test first |
| ALB/WAF blocks WebSocket upgrade (GPT F-4) | Low | Blocks G-9 | Pre-verify in Task 4.0 before app code |
| Discord thread permission issues | Medium | Degraded UX | Bot checks permissions, posts warning |
| NFT transfer cache staleness (GPT F-8) | Low | Stale personality (5 min max) | TTL-only for launch; event pipeline post-launch |
| Conservation guard alert > 60s (GPT F-10) | Low | Fails G-3 | Dual path: Prometheus counter + CloudWatch metric filter |
