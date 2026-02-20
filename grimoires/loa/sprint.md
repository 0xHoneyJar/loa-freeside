# Sprint Plan: Launch Readiness — Production Stack, Payments & Agent Surfaces

**Version:** 1.0.0
**Date:** 2026-02-20
**Cycle:** cycle-036
**PRD:** grimoires/loa/prd.md (v1.1.0)
**SDD:** grimoires/loa/sdd.md (v1.0.0)
**Global Sprint IDs:** 314–320
**Duration:** 14 working days across 7 sprints
**Team:** 1 engineer (AI-assisted)

---

## Sprint Overview

| Sprint | Global ID | SDD Phase | Days | Focus | Gate |
|--------|-----------|-----------|------|-------|------|
| Sprint 1 | 314 | Phase 1a | Days 1–2 | Foundation — IaC + Migrations | `terraform plan` clean, migrations applied, ECR repo exists |
| Sprint 2 | 315 | Phase 1b | Days 3–4 | Auth + First Inference Through Finn | S2S JWT validated in staging, streamed response end-to-end |
| Sprint 3 | 316 | Phase 2 | Days 5–6 | Revenue — Payments + Credit Mint | Webhook → credit mint → conservation guard in staging |
| Sprint 4 | 317 | Phase 3+4a | Days 7–9 | Personality Routing + Discord Agent Threads | Two NFTs routed differently, `/my-agent` thread working |
| Sprint 5 | 318 | Phase 4b | Days 10–11 | Admin Dashboard + Audit Trail | Admin API returns usage/billing, JSONL export works |
| Sprint 6 | 319 | Phase 5 | Days 12–13 | API Platform + Web Chat Widget | Developer creates key → inference → streamed response |
| Sprint 7 | 320 | Phase 6 | Day 14 | Hardening — Monitoring + Go/No-Go Gate | All 11 go/no-go gates pass, production deploy |

**Dependency chain:** Sprint 1 → Sprint 2 → Sprint 3 (sequential — infra must exist before auth, auth before payments)
**Partial parallel:** Sprint 4 and Sprint 5 share context but Sprint 5 depends on Sprint 4 admin API foundations.
**Sprint 6 parallel:** API platform can begin after Sprint 2 (S2S auth exists), but web chat depends on Sprint 4 personality routing.
**Sprint 7 depends on all.**

**P0 Critical Path (PRD §2):**
1. Deploy → Sprint 1 + 2
2. S2S Auth → Sprint 2
3. Basic Discord chat → Sprint 4
4. Payment + credit mint → Sprint 3
5. Minimal alerting → Sprint 7

**Schedule Risk & Buffer (Flatline SKP-001):**
The 14-day estimate assumes near-perfect execution with 1 engineer (AI-assisted). Risk mitigations:
- **Buffer:** Add 3–5 days slack (realistic target: 17–19 working days)
- **Scope triage if behind:** Sprint 6 (API platform + web widget) is P1 and CAN be deferred to a follow-up cycle without blocking P0 launch. Telegram `/buy-credits` (3.6) is also deferrable.
- **Minimum Viable Go/No-Go:** If Sprint 7 is unreachable by Day 14, a reduced gate set enables P0 launch:
  1. Health checks passing (Sprint 1)
  2. S2S JWT validated (Sprint 2)
  3. At least one inference pool responds (Sprint 2)
  4. Webhook → credit mint working (Sprint 3)
  5. `/my-agent` thread creation working (Sprint 4)
  6. Conservation guard passing (Sprint 3)
  7. Basic Slack alerting on health check failure (Sprint 7, task 7.2 only)
- **Sequential dependency risk:** If Sprint 1 slips >1 day, immediately parallelize Sprint 1 remaining + Sprint 2 tasks where possible (e.g., JWKS code can be written before Terraform fully applied).

**Prerequisites:**
- NOWPayments API key available as env var (`NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`)
- AWS credentials with ECS/ECR/Secrets Manager access
- loa-finn repository accessible for Dockerfile creation (loa-finn#84)
- Existing Terraform state for `infrastructure/terraform/`

---

## Sprint 1: Foundation — IaC + Migrations

**Global ID:** 314
**SDD Phase:** Phase 1a
**Days:** 1–2
**Goals:** G-1 (Deploy full stack to production on existing AWS ECS)
**FRs:** FR-0.1 (Deploy loa-finn ECS), FR-0.2 (Docker Compose), FR-0.5 (Metrics collection)

### Tasks

#### 1.1 loa-finn ECS Task Definition + Service
**Description:** Add loa-finn as a new ECS Fargate service in the existing cluster. Create ECR repository `arrakis-{env}-loa-finn`, task definition with ADOT sidecar, service with desired count, and ALB target group.
**Acceptance Criteria:**
- `infrastructure/terraform/ecs-finn.tf` created with task definition, service, ECR repo
- Security group allows inbound only from loa-freeside's security group (no public listener)
- Service discovery registered at `finn.arrakis-{env}.local` via Cloud Map
- `terraform plan` shows clean additions (no destructive changes)
- ADOT sidecar container included in task definition for Prometheus metrics

**Effort:** L
**Dependencies:** None (existing Terraform state)

#### 1.2 Cloud Map Service Discovery + Internal Routing
**Description:** Configure AWS Cloud Map private DNS namespace and register both services for internal discovery. loa-freeside reaches finn (and vice versa for JWKS) via Cloud Map, not ALB path routing (per SDD §1.3 trust model).
**Acceptance Criteria:**
- Cloud Map private DNS namespace `arrakis-{env}.local` exists (create if not present)
- loa-finn ECS service has `service_registries` configured → resolves as `finn.arrakis-{env}.local`
- loa-freeside ECS service has `service_registries` configured → resolves as `freeside.arrakis-{env}.local`
- Verification: exec into freeside task → `nslookup finn.arrakis-{env}.local` resolves to finn task IP
- Verification: exec into finn task → `nslookup freeside.arrakis-{env}.local` resolves to freeside task IP
- Internal-only ALB target group for loa-finn on port 3000, health check at `/health`
- No public ALB listener rule for finn (network enforcement)
- `infrastructure/terraform/service-discovery.tf` with Cloud Map namespace + service definitions
- Remove Route53 private hosted zone if Cloud Map namespace handles resolution
- **Day 1 validation spike (Flatline SKP-002):**
  - First task on Day 1: deploy Cloud Map namespace to staging, register a dummy ECS service, confirm `nslookup` resolves from inside a task container
  - Validate VPC DNS settings: `enableDnsHostnames = true`, `enableDnsSupport = true` (required for Cloud Map)
  - Confirm no conflicting private hosted zone for `arrakis-{env}.local` in Route53
  - **Fallback path:** If Cloud Map fails in existing VPC/ECS setup, document ALB internal listener fallback — each service reaches the other via internal ALB DNS name (`internal-arrakis-{env}-alb-*.elb.amazonaws.com`) with path-based routing. This is less ideal (extra hop, ALB cost) but functional
  - Time-box: 2 hours max for spike. If Cloud Map works → proceed. If not → switch to ALB internal immediately (do not debug Cloud Map during sprint)

**Effort:** M
**Dependencies:** 1.1

#### 1.3 Database Migrations 061–065
**Description:** Create database migrations for new tables required by cycle-036: `s2s_jwks_public_keys`, `api_keys`, `agent_threads`, `admin_audit_log`, `crypto_payments` extensions (if not already migrated).
**Acceptance Criteria:**
- Migration 061: `s2s_jwks_public_keys` table (kid, kty, crv, x, y, created_at, expires_at)
- Migration 062: `api_keys` table (id, user_id, community_id, key_prefix, key_hash, key_salt, pepper_version, name, scopes, rate_limit_rpm, rate_limit_tpd, is_active, last_used_at, created_at, revoked_at)
- Migration 063: `agent_threads` table (id, nft_id, channel_id, thread_id, owner_wallet, community_id, created_at, last_active_at, ownership_verified_at)
- Migration 064: `budget_reservations` table with `finalization_id UNIQUE`, `status CHECK`, `spend_events` table
- Migration 065: `crypto_payments` extensions (`credits_minted_at`, `credits_mint_event_id UNIQUE`, `status_rank`)
- All migrations run forward/backward cleanly
- Existing 95 payment tests still pass
- **Zero-downtime migration rules (Flatline IMP-004):**
  - All migrations MUST be additive-only (new tables, new nullable columns, new indexes)
  - No column renames, type changes, or NOT NULL additions without default in same migration
  - Expand/contract pattern: add new column → deploy code that writes both → backfill → drop old (separate migrations)
  - Deploy-order independence: migrations must be safe to run before OR after new code deploys
  - Verification checklist: `pg_dump --schema-only` diff shows only ADDs, no ALTERs of existing columns

**Effort:** L
**Dependencies:** None

#### 1.4 Docker Compose Full-Stack Local Dev
**Description:** Create `docker-compose.yml` for local development with loa-freeside + loa-finn + Redis + PostgreSQL.
**Acceptance Criteria:**
- `docker compose up` starts all 4 services
- loa-freeside reachable at `localhost:3000`
- loa-finn reachable at `localhost:3001` (internal only)
- Health checks pass on both services
- Environment variables loaded from `.env.example`
- PostgreSQL migrations auto-run on startup

**Effort:** M
**Dependencies:** 1.3

#### 1.5 Secrets Manager Configuration
**Description:** Add Secrets Manager entries for ES256 keypair, NOWPayments credentials, and model API keys. Reference existing `infrastructure/terraform/secrets.tf`.
**Acceptance Criteria:**
- ES256 private key secret created (`arrakis-{env}-s2s-es256-private-key`)
- NOWPayments API key and IPN secret stored (`arrakis-{env}-nowpayments-api-key`, `arrakis-{env}-nowpayments-ipn-secret`)
- Terraform references from ECS task definition environment
- Rotation policy documented (quarterly for ES256, on-compromise for API keys)

**Effort:** M
**Dependencies:** 1.1

#### 1.6 AMP Workspace + ADOT Configuration
**Description:** Create Amazon Managed Prometheus workspace and configure ADOT sidecar for both services.
**Acceptance Criteria:**
- `infrastructure/terraform/amp.tf` with AMP workspace
- ADOT sidecar config discovers ECS task metadata endpoint for targets
- Both freeside and finn emit Prometheus metrics to AMP
- CloudWatch Container Insights remain for ECS-level metrics

**Effort:** M
**Dependencies:** 1.1

### Sprint 1 Gate
- [ ] `terraform plan` clean — no destructive changes
- [ ] Migrations 061–065 applied to dev database
- [ ] Docker Compose starts all services
- [ ] ECR repository exists with placeholder image
- [ ] Secrets Manager entries provisioned

---

## Sprint 2: Auth + First Inference Through Finn

**Global ID:** 315
**SDD Phase:** Phase 1b
**Days:** 3–4
**Goals:** G-1 (Deploy), G-4 (Per-NFT routing — foundation)
**FRs:** FR-0.3 (S2S JWT), FR-0.4 (Model pool responds to inference)

### Tasks

#### 2.1 ES256 Key Material Bootstrap + JWKS Endpoint
**Description:** Generate initial ES256 keypair, store private key + `activeKid` in Secrets Manager, insert public JWK into `s2s_jwks_public_keys` table. Then implement `/.well-known/jwks.json` route on loa-freeside that serves public keys from DB. Dual-path: internal Cloud Map for finn, public ALB for third-party verifiers.
**Acceptance Criteria:**
- **Bootstrap script** (`scripts/bootstrap-s2s-keys.sh`): generates ES256 keypair, stores private key PEM in Secrets Manager (`arrakis-{env}-s2s-es256-private-key`), stores `activeKid` string in Secrets Manager, inserts public JWK row into `s2s_jwks_public_keys` with `kid`, `kty=EC`, `crv=P-256`, `x`, `y`, `created_at`, `expires_at` (90 days)
- **Admin ops script** (`scripts/rotate-s2s-key.sh`): generates new keypair, inserts new public JWK, updates `activeKid` (but does NOT remove old key — that's manual after 24h overlap)
- `GET /.well-known/jwks.json` returns JWK Set with all non-expired keys (not just active)
- Keys served from `s2s_jwks_public_keys` table (DB is source of truth for public keys)
- Private keys ONLY in Secrets Manager (never in DB)
- Selection rule: serve all rows where `expires_at > NOW()`; signing uses key matching `activeKid` from Secrets Manager
- Cache-Control: max-age=300 on public endpoint
- Health check does NOT depend on JWKS availability
- **Key management operational invariants (Flatline SKP-003):**
  - Bootstrap and rotation scripts MUST NOT log or stdout key material (redirect to /dev/null, use `set +x` around key ops)
  - Secrets Manager access policy: only ECS task role + rotation Lambda can read private key; no human IAM access without break-glass procedure
  - Rotation procedure is atomic: publish new public key → verify JWKS serves it → canary test (freeside signs → finn validates with new kid) → ONLY THEN switch `activeKid`
  - Audit logging: every Secrets Manager `GetSecretValue` and `PutSecretValue` logged to CloudTrail
  - Automated canary: CI job runs `sign-with-new-key → validate-on-finn` before `activeKid` switch (fail = abort rotation)
  - Recovery runbook: if `activeKid` and private key drift, revert `activeKid` to previous value (JWTs signed in last 60s will expire naturally)

**Effort:** L
**Dependencies:** Sprint 1 (1.3 migrations, 1.5 secrets)

#### 2.2 S2S JWT Signing Service
**Description:** Create ES256 JWT signing service that produces S2S tokens for loa-finn requests. Signs with private key from Secrets Manager. Claims: `iss: loa-freeside`, `aud: loa-finn`, TTL: 60s.
**Acceptance Criteria:**
- `S2STokenService.sign(claims)` returns signed ES256 JWT
- Claims include: `iss`, `aud`, `exp`, `iat`, `jti`, `nft_id`, `tier`, `budget_reservation_id`
- Private key loaded from Secrets Manager on startup, cached in memory
- Key rotation: reads `activeKid` from Secrets Manager, signs with matching key
- JWT TTL: 60s (short-lived)

**Effort:** M
**Dependencies:** 2.1

#### 2.3 S2S JWT Validation on loa-finn
**Description:** Implement JWT validation middleware on loa-finn that verifies ES256 tokens from loa-freeside using JWKS endpoint via internal Cloud Map URL.
**Acceptance Criteria:**
- loa-finn fetches JWKS from `http://freeside.arrakis-{env}.local:3000/.well-known/jwks.json` (internal, via Cloud Map — freeside is the issuer)
- Validates `iss: loa-freeside`, `aud: loa-finn`, `exp` not past
- JWKS cached 5 minutes, refreshed on kid-not-found (grace fetch)
- All inference endpoints require valid S2S JWT (reject 401 without it)
- Rejects expired tokens, wrong audience, invalid signature
- Verify resolution from finn task: `nslookup freeside.arrakis-{env}.local` succeeds

**Effort:** M
**Dependencies:** 2.1, 2.2

#### 2.4 First End-to-End Inference Request
**Description:** Wire loa-freeside → S2S JWT → loa-finn → streamed inference response. Verify at least one model pool responds with token usage data.
**Acceptance Criteria:**
- Discord `/agent` command → loa-freeside signs S2S JWT → loa-finn inference endpoint → streamed response
- Response includes `X-Pool-Used` header
- **Response includes `X-Token-Count` header or SSE `done` event with `usage.total_tokens`** (required for budget finalization in Sprint 4)
- loa-freeside records token usage from response (logged, even if not yet finalized)
- Round-trip works in Docker Compose local dev
- Integration test: sign JWT → POST to finn → verify streamed response → verify token count present
- Error case: finn returns 401 if JWT missing or invalid
- Error case: finn returns partial token count on client disconnect (in error response or trailer)
- **S2S resilience (Flatline IMP-001):**
  - Connection timeout: 5s to establish, 60s total for streaming response
  - Retry: max 2 retries with exponential backoff (1s, 2s), only on 5xx/timeout (not 4xx)
  - Circuit breaker: half-open after 30s, 3 consecutive failures → open; probe every 30s
  - Fallback on circuit open: return 503 "Inference temporarily unavailable" (do NOT queue)
  - Budget reservation released on timeout/circuit-open (no credit leakage)

**Effort:** L
**Dependencies:** 2.2, 2.3

#### 2.5 PgBouncer Validation + Read-Only Role for loa-finn
**Description:** First validate that PgBouncer exists and is configurable in the current AWS stack. Then create `loa_finn_ro` PostgreSQL role and configure PgBouncer pool mapping. If PgBouncer is not deployed, fall back to RDS Proxy or direct connection with DB-level read-only role.
**Acceptance Criteria:**
- **Prerequisite check:** Confirm PgBouncer is deployed (check Terraform state for `pgbouncer.tf`, confirm ECS task or EC2 instance running PgBouncer, identify where config lives)
- **If PgBouncer exists:**
  - `loa_finn_ro` role with `SELECT` on required tables only
  - `default_transaction_read_only = on` set on role
  - PgBouncer `[databases]` section includes `arrakis_finn` entry mapping to `loa_finn_ro`
  - Separate pool (pool_size=20, max_client_conn=100)
  - Connection queue timeout: 5s → 503
- **If PgBouncer does NOT exist:**
  - Create `loa_finn_ro` role with `SELECT`-only + `default_transaction_read_only = on` directly on RDS
  - loa-finn connects to RDS directly using `loa_finn_ro` credentials (stored in Secrets Manager)
  - Document PgBouncer provisioning as follow-up task if connection pooling needed at scale
- Verification: loa-finn can query DB via read-only connection; `INSERT` attempt returns error

**Effort:** M
**Dependencies:** Sprint 1 (1.3 migrations)

### Sprint 2 Gate
- [ ] S2S JWT signed by freeside, validated by finn in staging
- [ ] At least one model pool responds to inference via S2S
- [ ] JWKS endpoint serving public keys
- [ ] PgBouncer read-only pool operational
- [ ] Integration test: Discord → freeside → finn → streamed response

---

## Sprint 3: Revenue — Payments + Credit Mint

**Global ID:** 316
**SDD Phase:** Phase 2
**Days:** 5–6
**Goals:** G-2 (Enable crypto payment revenue collection)
**FRs:** FR-1.1 (Enable feature flag), FR-1.2 (Wire webhook), FR-1.3 (Credit tiers), FR-1.4 (Discord /buy-credits), FR-1.5 (Telegram /buy-credits), FR-1.6 (Idempotent double-payment)

### Tasks

#### 3.1 Enable NOWPayments Feature Flag + Webhook Route
**Description:** Set `FEATURE_CRYPTO_PAYMENTS_ENABLED=true` in staging. Wire ALB to route `POST /api/crypto/webhook` to loa-freeside.
**Acceptance Criteria:**
- Feature flag enabled in staging environment config
- ALB routes `/api/crypto/webhook` to loa-freeside
- Express raw body capture via `verify` callback for HMAC verification:
  ```typescript
  app.use('/api/crypto/webhook', express.json({
    verify: (req, _res, buf) => { (req as any).rawBody = buf; }
  }));
  ```
- HMAC-SHA512 verified against `NOWPAYMENTS_IPN_SECRET` using `crypto.timingSafeEqual()`
- **IPN authenticity hardening (Flatline SKP-006):**
  - Canonical HMAC computation: sort IPN body keys alphabetically, `JSON.stringify()` the sorted object, then HMAC-SHA512 — document the exact NOWPayments HMAC algorithm (verify against their docs, do not assume)
  - Reject IPNs with `payment_id` not matching any `crypto_payments` row (prevents orphan processing)
  - Log raw IPN body (redacting sensitive fields) to audit trail for forensic replay
- Existing 95 tests still pass

**Effort:** M
**Dependencies:** Sprint 1 (1.5 secrets), Sprint 2 (2.4 E2E working)

#### 3.2 IPN State Machine + Mint Guard
**Description:** Extend CryptoWebhookService for full IPN state machine with DB-atomic credit mint guard using `credits_minted_at` + `credits_mint_event_id`.
**Acceptance Criteria:**
- Payment status enum: `waiting`, `confirming`, `confirmed`, `sending`, `finished`, `partially_paid`, `failed`, `expired`, `refunded`
- Monotonic `status_rank` prevents backward transitions
- `SELECT ... FOR UPDATE` row locking on `crypto_payments` for concurrent webhook/poll/admin paths
- `credits_minted_at IS NULL` guard prevents double-mint
- `credits_mint_event_id UNIQUE` belt-and-suspenders
- Refunds modeled as compensating negative `credit_lot_adjustments` (never reverse original mint)
- All 3 mint paths (IPN webhook, reconciliation poll, admin reconcile) use identical single-transaction pattern

**Effort:** L
**Dependencies:** Sprint 1 (1.3 migrations)

#### 3.3 Credit Pack Tier Configuration
**Description:** Configure credit pack pricing tiers as defined in SDD.
**Acceptance Criteria:**
- Starter: $5 → 5,000,000 micro-credits (0% bonus)
- Standard: $10 → 10,500,000 micro-credits (5% bonus)
- Premium: $25 → 27,500,000 micro-credits (10% bonus)
- All arithmetic uses `BigInt` (no floating-point)
- Per-token cost: `Math.ceil(cost_micro_per_token * tokens_used)` (round UP against user)
- Minimum charge: 1 micro-credit per inference request
- Minimum payment: $5 enforced at command level

**Effort:** S
**Dependencies:** None (existing credit pack system)

#### 3.4 Reconciliation Job
**Description:** Scheduled task polls NOWPayments API every 5 minutes for invoices with `waiting`/`confirming` status older than 15 minutes.
**Acceptance Criteria:**
- Polls NOWPayments API by `payment_id` for stuck invoices
- Processes missed IPN transitions through same state machine as 3.2
- Uses same `SELECT ... FOR UPDATE` + mint guard pattern
- Logs all reconciliation actions to audit trail
- Does not duplicate credits (idempotent)
- **NOWPayments operational edge cases (Flatline SKP-006):**
  - **Replay protection:** Store IPN `updated_at` timestamp; reject IPNs with `updated_at ≤ last_seen_updated_at` for that `payment_id`
  - **Rate-limit aware backoff:** NOWPayments API polling respects `429 Too Many Requests` — exponential backoff starting at 30s, max 5 min, with jitter
  - **Test vectors:** Integration tests include IPN payloads for every status transition (`waiting→confirming→confirmed→sending→finished`, `waiting→expired`, `confirmed→failed`, `finished→refunded`) — use recorded real IPN payloads from NOWPayments sandbox
  - **Network failure handling:** If NOWPayments API returns 5xx during reconciliation poll, log warning and retry next cycle (do not mark payment as failed based on API unavailability)
  - **Partial payment edge case:** `partially_paid` status triggers alert to admin (do not auto-mint) — admin resolves via manual reconcile endpoint

**Effort:** M
**Dependencies:** 3.2

#### 3.5 Discord `/buy-credits` Command
**Description:** Add `/buy-credits [amount]` Discord command. Returns NOWPayments checkout URL, confirms on completion.
**Acceptance Criteria:**
- `/buy-credits 5` → creates NOWPayments invoice for $5 Starter pack
- `/buy-credits 10` → $10 Standard, `/buy-credits 25` → $25 Premium
- Returns checkout URL as ephemeral reply
- On `finished` IPN → bot sends confirmation in DM or channel
- Rate limit: 100 req/min per IP at ALB, 10 per payment_id/hour WAF throttle

**Effort:** M
**Dependencies:** 3.1, 3.2, 3.3

#### 3.6 Telegram `/buy-credits` Command
**Description:** Same flow as Discord but for Telegram surface.
**Acceptance Criteria:**
- `/buy-credits [amount]` returns checkout URL in Telegram reply
- Same tier mapping as Discord
- Confirmation message on completion

**Effort:** S
**Dependencies:** 3.5 (shared logic)

#### 3.7 Webhook Rate Limiting + DoS Protection
**Description:** Implement layered rate limiting for webhook endpoints per SDD Flatline IMP-002.
**Acceptance Criteria:**
- **Layer 1 — WAF IP-based:** 100 requests/min per source IP on `/api/crypto/webhook` (WAF rate-based rule, keys on IP)
- **Layer 2 — Application-level per-payment:** Redis-backed throttle — max 10 IPN deliveries/hour per `payment_id` (extracted from JSON body in Express middleware, NOT WAF — WAF cannot inspect JSON body fields)
- **Layer 3 — DB idempotency:** Already handled by 3.2 (`SELECT ... FOR UPDATE` + mint guard)
- Retry-aware: 429 response includes `Retry-After` header; legitimate NOWPayments retries on 5xx not blocked (5xx = no rate-limit counter increment)
- WAF rule in `infrastructure/terraform/waf.tf`
- Application middleware in webhook route handler (before HMAC verification to save CPU on floods)

**Effort:** M
**Dependencies:** 3.1

### Sprint 3 Gate
- [ ] Webhook → credit mint → conservation guard verified in staging
- [ ] Double-payment replay returns 200, no duplicate credits
- [ ] Reconciliation job resolves stuck payments
- [ ] `/buy-credits` works in both Discord and Telegram
- [ ] Rate limiting active on webhook endpoint
- [ ] **E2E billing integration test (Flatline IMP-010):** Payment($10) → webhook(finished) → credit mint(10,500,000 micro) → conservation guard(balance matches) → inference request → budget reserve → finalize(actual tokens) → balance decremented correctly; assert BigInt precision throughout (no floating-point); assert idempotent replay of each step produces identical state

---

## Sprint 4: Personality Routing + Discord Agent Threads

**Global ID:** 317
**SDD Phase:** Phase 3 + 4a
**Days:** 7–9
**Goals:** G-4 (Per-NFT personality routing), G-5 (Per-NFT Discord threads)
**FRs:** FR-2.1–2.4 (Personality routing), FR-3.1–3.3 (Discord threads)

### Tasks

#### 4.1 Inference Request Enrichment with NFT Context
**Description:** Extend S2S JWT claims to include `nft_id`, `tier`, and `budget_reservation_id`. loa-finn resolves personality and selects pool.
**Acceptance Criteria:**
- S2S JWT claims include: `nft_id` (string), `tier` (string), `budget_reservation_id` (string)
- loa-freeside resolves NFT ownership before signing JWT
- Budget reservation created before inference request (pessimistic reserve based on `max_tokens`)
- loa-finn returns `X-Pool-Used` + `X-Personality-Id` response headers

**Effort:** L
**Dependencies:** Sprint 2 (2.2, 2.4)

#### 4.2 Budget Reservation Lifecycle
**Description:** Implement reserve → stream → finalize lifecycle for streaming inference budget.
**Acceptance Criteria:**
- **Reserve:** Create `budget_reservation_id`, deduct estimated max cost from balance
- **Finalize:** `finalization_id UNIQUE` + `finalized_at IS NULL` guard
- **Partial completion:** Charge for tokens actually delivered (from `X-Token-Count`)
- **Orphan cleanup:** Scheduled job releases reservations >5 min without finalization
- `spend_events` table with `UNIQUE(budget_reservation_id)` prevents double-finalization
- Status transitions: `reserved` → `streaming` → `finalized` / `released` / `orphan_released`
- **Server-side metering authority (Flatline SKP-004):**
  - loa-finn is the authoritative source of token counts (server-side metering, not client-observed)
  - Primary path: NATS JetStream `usage_finalized` event with `tokens_used` from finn's internal counter
  - Secondary path: `X-Token-Count` response header (set by finn before stream ends)
  - SSE `done` event includes `usage.total_tokens` as belt-and-suspenders
  - **Disconnect fallback:** If stream terminates early (client disconnect, proxy timeout), finn STILL emits NATS usage event with actual tokens sent; if NATS also down, freeside bills `max_tokens` from reservation and reconciliation job corrects within 5 min
  - **Per-pool contract tests:** Each model pool (cheap, standard, reasoning, architect, flagship) must return token count in at least one of the 3 paths; CI test per pool verifies this

**Effort:** L
**Dependencies:** Sprint 1 (1.3 migration 064), Sprint 2 (2.4)

#### 4.3 NATS JetStream Infrastructure Provisioning
**Description:** Deploy NATS server with JetStream enabled as an ECS service. Configure networking, secrets, and persistence for durable usage reporting.
**Acceptance Criteria:**
- `infrastructure/terraform/nats.tf` with ECS task definition for NATS with JetStream enabled
- Security group: allows inbound from freeside + finn security groups only (port 4222)
- Cloud Map service discovery: `nats.arrakis-{env}.local`
- EFS volume for JetStream persistence (or accept ephemeral with 72h retention for launch)
- NATS auth: nkey or user/pass stored in Secrets Manager (`arrakis-{env}-nats-auth`)
- Connection URLs injected into freeside + finn task definitions as env vars
- Health check: NATS monitoring endpoint on port 8222 (`/healthz`)
- Verification: exec into freeside task → `nats pub test "hello"` succeeds
- **Operational risk mitigations (Flatline SKP-005):**
  - **Sizing:** NATS container resource limits documented — start with 512 MiB memory / 0.25 vCPU; JetStream max memory store 256 MiB, max file store 1 GiB
  - **EFS performance mode:** Use `generalPurpose` (not `maxIO`); throughput mode `elastic` for burst tolerance. If write latency >50ms in testing, fall back to ephemeral persistence with documented tradeoff
  - **Monitoring:** CloudWatch metric filter on NATS logs for `slow_consumer`, `no_responders`, `stale_connection`; alarm if consumer pending count >1000 for >5 min
  - **Consumer lag alert:** loa-freeside exposes `/metrics/nats` endpoint with pending message count; CloudWatch alarm on sustained lag
  - **Disaster recovery runbook:** If NATS is down >30 min, manually trigger reconciliation job (Task 3.4 pattern) against finn's `X-Token-Count` headers as fallback data source
  - **Rollback path:** If NATS proves operationally infeasible before launch, revert to `X-Token-Count` header-only mode (already the fallback path in Task 4.4) — NATS is an enhancement, not a hard dependency

**Effort:** L
**Dependencies:** Sprint 1 (1.1 ECS cluster, 1.2 Cloud Map)

#### 4.4 Durable Usage Reporting via NATS JetStream
**Description:** loa-finn emits `inference.usage.finalized` to NATS JetStream after each inference completes. loa-freeside subscribes for budget finalization, independent of HTTP stream completion.
**Acceptance Criteria:**
- NATS JetStream subject: `inference.usage.finalized`
- Payload: `{ budget_reservation_id, tokens_used, model, pool_used, personality_id, latency_ms }`
- Retention: `WorkQueue` policy, 72h max age
- loa-freeside consumer: finalize budget on receipt, ack after DB commit
- Fallback: if NATS unavailable, `X-Token-Count` header used; reconciliation job catches mismatches
- At-least-once delivery; finalization is idempotent (UNIQUE constraint)

**Effort:** L
**Dependencies:** 4.3 (NATS provisioned), Sprint 2 (2.4)

#### 4.5 Two-NFT Differential Routing Test
**Description:** Integration test verifying two different NFTs get different model pool routing.
**Acceptance Criteria:**
- Test with NFT-A (high tier) → routes to `architect` or `reasoning` pool
- Test with NFT-B (standard tier) → routes to `cheap` pool
- `X-Pool-Used` and `X-Personality-Id` differ between the two
- Anti-narration enforcement verified (no forbidden identity terms)
- Test runs in CI via Docker Compose

**Effort:** M
**Dependencies:** 4.1

#### 4.6 Discord `/my-agent` Command — Thread Creation
**Description:** Create dedicated Discord thread per NFT when holder invokes `/my-agent`. Bot-enforced access control with ownership verification.
**Acceptance Criteria:**
- `/my-agent` creates thread named `Agent #[tokenId]` (or agent name if available)
- Private thread if server boost level 2+, otherwise public with bot-level gating
- Bot responds only to verified holder in that thread (ownership check on every message, cached 60s via Redis)
- Thread recorded in `agent_threads` table
- Bot permissions required: `MANAGE_THREADS`, `SEND_MESSAGES_IN_THREADS`, `READ_MESSAGE_HISTORY`
- Graceful degradation: "Missing permissions" message if bot lacks required permissions

**Effort:** L
**Dependencies:** 4.1 (personality routing working)

#### 4.7 Thread Message Routing Through Personality Bridge
**Description:** Messages in agent threads are routed through the personality bridge (S2S JWT → loa-finn inference with NFT context).
**Acceptance Criteria:**
- Message in thread → budget reservation → S2S JWT with nft_id → loa-finn → streamed response in thread
- Personality tier and emphasis applied to every message
- Token usage tracked and budget finalized per message
- Rate limiting per user per channel

**Effort:** M
**Dependencies:** 4.1, 4.2, 4.6

#### 4.8 Token Transfer Handling
**Description:** On NFT ownership change, bot re-verifies and creates new thread for new holder.
**Acceptance Criteria:**
- Per-message ownership re-verification (Redis cache 60s TTL)
- On ownership change: bot posts "Ownership transferred" notice in old thread
- Old thread: bot stops responding to previous holder
- New holder invokes `/my-agent` → new thread created
- Background wallet re-verification job (every 24h)
- Event-driven invalidation: cache cleared on transfer event

**Effort:** M
**Dependencies:** 4.6, 4.7

#### 4.9 Discord `/agent-info` Command
**Description:** Show personality summary for an NFT agent, anti-narration safe.
**Acceptance Criteria:**
- `/agent-info [tokenId]` displays personality summary (pool tier, emphasis keywords, agent name)
- No forbidden identity terms (anti-narration enforcement)
- Available to any server member (not gated to holder)

**Effort:** S
**Dependencies:** 4.1

### Sprint 4 Gate
- [ ] Two different NFTs get different model pool routing (verified in test)
- [ ] `/my-agent` creates thread, messages route through personality bridge
- [ ] Token transfer handling works (ownership change → new thread)
- [ ] Budget reservation → finalization lifecycle tested
- [ ] NATS JetStream usage reporting operational
- [ ] **NATS chaos test (Flatline IMP-002):** Kill NATS container mid-inference → verify `X-Token-Count` header fallback activates → budget finalization completes via header path → no credit leakage; reconciliation job catches any mismatches within 5 min SLA; NATS recovery → consumer resumes without message loss

---

## Sprint 5: Admin Dashboard + Audit Trail

**Global ID:** 318
**SDD Phase:** Phase 4b
**Days:** 10–11
**Goals:** G-6 (Community admin budget visibility), G-7 (Auditable billing)
**FRs:** FR-3.4–3.5 (Admin dashboard), FR-4.1–4.4 (Audit trail)

### Tasks

#### 5.1 Admin API — Usage Endpoints
**Description:** Implement admin API endpoints for community usage data.
**Acceptance Criteria:**
- `GET /api/v1/admin/community/:id/usage` — total spend, per-pool breakdown, per-user breakdown, projected depletion
- `GET /api/v1/admin/community/:id/billing` — billing history, credit lots, payment records
- `GET /api/v1/admin/community/:id/agents` — active agents, thread counts, last active
- All endpoints require admin authentication
- Response data freshness: <60s (near-real-time)

**Effort:** L
**Dependencies:** Sprint 4 (4.2 budget finalization populating data)

#### 5.2 JSONL Audit Trail Export
**Description:** Implement billing audit trail export as JSONL for community admins.
**Acceptance Criteria:**
- `GET /api/v1/admin/community/:id/audit?format=jsonl` returns downloadable JSONL
- Each line includes: timestamp, operation_type, amount_micro, pool, user_wallet (pseudonymous), conservation_result
- No PII in exports (wallet addresses only)
- Append-only: audit records cannot be modified after creation
- Conservation guard results included for every credit operation
- Supports date range filters

**Effort:** M
**Dependencies:** 5.1

#### 5.3 Conservation Guard Status Endpoint
**Description:** Admin endpoint showing conservation guard health and history.
**Acceptance Criteria:**
- `GET /api/v1/admin/community/:id/conservation` returns current guard status + violation history
- Shows: total credits created, total credits consumed, drift amount, last check timestamp
- Historical violations with resolution notes
- Budget drift monitor: alerts if drift >1% of total balance

**Effort:** M
**Dependencies:** 5.1

#### 5.4 Pool Enforcement Transparency
**Description:** Admins can see which pools agents access and the routing decisions.
**Acceptance Criteria:**
- `GET /api/v1/admin/community/:id/pool-enforcement` returns recent routing decisions
- Each record: timestamp, nft_id, requested_pool, actual_pool, reason, cost_micro
- Filterable by time range and pool
- Shows pool utilization percentages

**Effort:** M
**Dependencies:** 5.1

#### 5.5 Admin Payment Dashboard + Repair Endpoint
**Description:** Admin endpoints for payment monitoring and manual reconciliation.
**Acceptance Criteria:**
- `GET /api/v1/admin/payments?status=stuck` — lists payments in limbo (>30 min without terminal state)
- `POST /api/v1/admin/payments/:paymentId/reconcile` — manually triggers status check against NOWPayments API
- Uses same mint guard pattern as webhook (no double-mint risk)
- All manual reconciliations logged to audit trail with admin identity
- Requires admin auth

**Effort:** M
**Dependencies:** Sprint 3 (3.2 IPN state machine)

### Sprint 5 Gate
- [ ] Admin API returns usage data with <60s freshness
- [ ] JSONL audit export contains all required fields, no PII
- [ ] Conservation guard status endpoint operational
- [ ] Pool enforcement decisions visible to admins
- [ ] Stuck payment dashboard shows limbo invoices

---

## Sprint 6: API Platform + Web Chat Widget

**Global ID:** 319
**SDD Phase:** Phase 5
**Days:** 12–13
**Goals:** G-8 (Self-service developer API keys), G-9 (Web chat surface)
**FRs:** FR-5.1–5.5 (API platform), FR-3.6–3.7 (Web chat)

### Tasks

#### 6.1 API Key Generation + Storage
**Description:** Implement two-part API key system (prefix + HMAC-SHA256 hashed secret with per-key salt).
**Acceptance Criteria:**
- Key format: `lf_live_` + 12-char base32 prefix + `_` + 32-char base62 secret (≥190 bits entropy)
- Stored: prefix in `key_prefix`, `HMAC-SHA256(PEPPER, salt || secret)` in `key_hash`, random salt in `key_salt`
- Sandbox keys: `lf_test_` prefix
- Cleartext shown exactly once at creation (never stored or logged)
- `pepper_version` column for rotation tracking
- Negative cache for failed lookups (rate-limit invalid key attempts)

**Effort:** L
**Dependencies:** Sprint 1 (1.3 migration 062)

#### 6.2 API Key Auth Middleware
**Description:** Authentication middleware that validates API keys on inference routes.
**Acceptance Criteria:**
- `Authorization: Bearer lf_live_...` → extract prefix → DB lookup → HMAC verify with `timingSafeEqual`
- Rate limiting per key: configurable RPM (requests/min) and TPD (tokens/day)
- `last_used_at` updated on valid authentication
- Revoked keys return 401
- Response headers: `X-RateLimit-Remaining`, `X-RateLimit-Reset`

**Effort:** M
**Dependencies:** 6.1

#### 6.3 Key Management Endpoints
**Description:** Self-service CRUD endpoints for API key management.
**Acceptance Criteria:**
- `POST /api/v1/keys` — create key (returns cleartext once)
- `GET /api/v1/keys` — list keys (prefix + name + created_at only, no secrets)
- `DELETE /api/v1/keys/:id` — revoke key (soft delete)
- `POST /api/v1/keys/:id/rotate` — revoke old, create new
- Scoped by user/community
- Max 10 active keys per user

**Effort:** M
**Dependencies:** 6.1, 6.2

#### 6.4 Developer Onboarding Flow
**Description:** Self-service developer signup → sandbox key → free inference → production upgrade.
**Acceptance Criteria:**
- Sign up → sandbox key (`lf_test_...`) with free-tier limits (10 RPM, 10k TPD)
- Sandbox routes to `cheap` pool only
- Upgrade path to production key (`lf_live_...`) with higher limits
- Onboarding page at `/developers` with getting-started guide
- First inference within 5 minutes of signup (zero manual intervention)

**Effort:** L
**Dependencies:** 6.2, 6.3

#### 6.5 ALB/ECS WebSocket Infrastructure Configuration
**Description:** Configure ALB and ECS deployment settings for WebSocket support. Without these infra changes, WebSockets work locally but fail in production.
**Acceptance Criteria:**
- ALB idle timeout set to ≥300s (`idle_timeout.timeout_seconds = 300` in `alb.tf`)
- Target group for WebSocket endpoint with health check path `/health` (not the WS path)
- ECS deployment configuration: `minimum_healthy_percent = 50`, `maximum_percent = 200` for graceful drain
- ECS deregistration delay aligned with 120s drain (`deregistration_delay = 130`)
- Staging verification: open WebSocket → trigger ECS deploy → confirm 120s drain (connection stays open during rolling update)
- ALB access logs enabled for WebSocket endpoint (for debugging connection drops)

**Effort:** M
**Dependencies:** Sprint 1 (1.1 ECS, 1.2 ALB)

#### 6.6 Web Chat Widget — Static JS Bundle + WebSocket
**Description:** Embeddable web chat widget with single `<script>` tag and WebSocket streaming.
**Acceptance Criteria:**
- Single `<script src="https://api.arrakis.community/widget.js">` tag for embedding
- WebSocket endpoint for streaming inference responses
- WebSocket lifecycle: 300s idle timeout, 30s heartbeat, max 3 conns/user, 120s graceful drain on deploy
- Personality-aware styling (agent name, colors from NFT metadata)
- Unauthenticated users see read-only agent profile
- Auth via SIWE wallet login → server-issued short-lived session token (no API keys in browser)
- **Supply-chain security (Flatline SKP-007):**
  - `widget.js` served from versioned immutable path (`/widget/v1/widget.js`) with `Cache-Control: immutable, max-age=31536000`
  - Subresource Integrity (SRI) hash published in docs; embed snippet includes `integrity` attribute
  - Content Security Policy on hosting page: `script-src 'self' https://api.arrakis.community; connect-src wss://api.arrakis.community`
  - No inline scripts — all logic in the external bundle
- **CSRF / session fixation (Flatline SKP-007):**
  - SIWE nonce (from 6.7) acts as CSRF token for the auth flow
  - Session token bound to `origin` claim — requests from mismatched origins rejected
  - `SameSite=Strict` cookie prevents cross-site attachment
- **WebSocket auth/origin enforcement (Flatline SKP-007):**
  - WS upgrade request MUST include valid session cookie — reject with 401 if missing/expired
  - Server validates `Origin` header on WS upgrade against allowlist (`api.arrakis.community`, localhost for dev)
  - Per-IP connection limit (10 WS connections/IP) enforced at application level to prevent resource exhaustion
  - WS messages authenticated on every frame via session token in initial upgrade (no re-auth per message needed, but session expiry checked on heartbeat)

**Effort:** L
**Dependencies:** 6.5 (ALB/WS infra), Sprint 4 (4.1 personality routing)

#### 6.7 SIWE Auth Flow (EIP-4361)
**Description:** Implement Sign-In with Ethereum for web widget authentication.
**Acceptance Criteria:**
- Nonce: 16 bytes hex, stored in Redis with 5-min TTL, single-use (deleted after verification)
- SIWE message fields: domain, address, uri, version (1), chainId, nonce, issuedAt, expirationTime (5 min)
- Server validates: nonce exists in Redis + not expired, domain matches `api.arrakis.community`, chainId in allowlist, signature valid via `ethers.verifyMessage()`
- On success: issue HS256 JWT session token (1h TTL), set `HttpOnly; Secure; SameSite=Strict` cookie
- Origin binding: session token includes `origin` claim, validated on every request
- **Signing secret:** HS256 secret stored in Secrets Manager (`arrakis-{env}-siwe-session-hs256-secret`), provisioned via Terraform, injected as env var into all freeside ECS tasks (consistent across tasks for rolling deploys)
- **Rotation:** Dual-secret validation during rotation — freeside accepts tokens signed with current OR previous secret for 24h overlap; session JWT includes `kid` header (version identifier) to route to correct secret
- **Verification:** Rolling deploy test in staging — sessions created before deploy remain valid after new tasks come up
- **Terraform:** `infrastructure/terraform/secrets.tf` updated with session secret entry

**Effort:** L
**Dependencies:** 6.6

#### 6.8 Standalone Chat Page
**Description:** Standalone chat page at `/chat/:tokenId` for shareable agent conversations.
**Acceptance Criteria:**
- Shareable URL: `https://api.arrakis.community/chat/[tokenId]`
- Mobile-responsive layout
- Read-only mode without auth (personality display, past public interactions)
- SIWE login required to send messages
- Rate-limited per session

**Effort:** M
**Dependencies:** 6.6, 6.7

### Sprint 6 Gate
- [ ] Developer creates API key → makes inference request → gets streamed response
- [ ] Web chat widget embeddable with single script tag
- [ ] SIWE auth flow working (nonce → sign → verify → session)
- [ ] Standalone chat page renders and authenticates
- [ ] WebSocket lifecycle constraints enforced (idle timeout, heartbeat, max conns)

---

## Sprint 7: Hardening — Monitoring + Go/No-Go Gate Execution

**Global ID:** 320
**SDD Phase:** Phase 6
**Days:** Day 14
**Goals:** G-3 (Production observability), all goals validated
**FRs:** FR-0.6 (CloudWatch dashboards), FR-0.7 (Alerting)

### Tasks

#### 7.0 Security Review Gate (Flatline Beads IMP-006)
**Description:** Lightweight threat model review covering the 4 trust boundaries: S2S auth (JWT ES256), API keys, SIWE sessions, and NOWPayments webhooks. Produces a documented threat model and sign-off before production deploy.
**Acceptance Criteria:**
- Threat model document covering: S2S JWT (ES256 signing/validation, JWKS cache poisoning), API key auth (timing attacks, prefix leakage), SIWE (replay, session fixation, origin binding), NOWPayments IPN (replay, spoofing, race conditions), Admin endpoints (privilege escalation, repair abuse)
- Each threat has: likelihood, impact, existing mitigation (cite sprint task), residual risk
- Admin endpoint RBAC requirements documented: MFA for admin routes, IP allowlisting, dual-control for credit repairs (Task 5.5), immutable append-only audit logs (Task 5.2)
- PII handling: JSONL export (Task 5.2) must redact wallet addresses and session tokens; define redaction rules
- Sign-off: threat model reviewed, no HIGH residual risks without explicit acceptance
- Time-boxed: 4 hours max — this is a review, not a penetration test

**Effort:** M
**Dependencies:** Sprint 5 (admin endpoints exist), Sprint 6 (auth flows exist)

#### 7.1 CloudWatch Dashboards
**Description:** Create unified service health dashboards sourced from AMP.
**Acceptance Criteria:**
- Inference latency panel (p50, p95, p99 by pool)
- Error rate panel (4xx, 5xx by service)
- Billing flow panel (payments created/finished/failed, credits minted)
- Auth failures panel (JWT validation failures, API key failures)
- Conservation guard panel (guard checks, violations, drift)
- Dashboard refreshes <60s

**Effort:** M
**Dependencies:** Sprint 1 (1.6 AMP workspace)

#### 7.2 Alerting Rules — Conservation Guard + Health
**Description:** AMP alerting rules → SNS → Slack webhook. Fires within 60s.
**Acceptance Criteria:**
- Conservation guard failure → Slack alert within 60s
- Service health check failure → Slack alert within 60s
- Budget drift >1% → Slack warning
- 5xx error rate >5% for 5 minutes → Slack alert
- Payment webhook 5xx → Slack alert
- All alerts include service name, environment, metric value, dashboard link

**Effort:** M
**Dependencies:** 7.1, Sprint 1 (1.6 AMP)

#### 7.3 Feature Flag Kill Switch Verification
**Description:** Verify all feature flags can be toggled off in production without deployment.
**Acceptance Criteria:**
- `FEATURE_CRYPTO_PAYMENTS_ENABLED=false` → payments disabled, existing credits still work
- `FEATURE_API_KEYS_ENABLED=false` → API key creation disabled, existing keys still work
- `FEATURE_WEB_CHAT_ENABLED=false` → widget returns 503
- Toggles take effect within 60s (env var refresh)
- Kill switch test: toggle off → verify → toggle on in staging

**Effort:** S
**Dependencies:** Sprints 3, 6

#### 7.4 JWKS Rotation Playbook Verification
**Description:** Verify JWKS key rotation works per SDD SKP-004 strict ordering.
**Acceptance Criteria:**
- Rotation test in staging:
  1. Publish new public key to DB → verify JWKS serves both keys
  2. Wait ≥6.5 min (cache TTL 5 min + JWT TTL 60s + safety 30s)
  3. Switch `activeKid` in Secrets Manager → new JWTs signed with new key
  4. Verify finn accepts both old and new JWTs during overlap
  5. After 24h overlap: remove old key from DB
- Automated integration test runs full rotation cycle
- Rotation runbook documented

**Effort:** M
**Dependencies:** Sprint 2 (2.1, 2.2, 2.3)

#### 7.5 Load Baseline Test
**Description:** Baseline load test with 10 concurrent simulated users.
**Acceptance Criteria:**
- 10 concurrent inference requests → all complete within p95 <30s
- No 5xx errors under load
- Conservation guard passes on all concurrent transactions
- PgBouncer connection pool not exhausted
- Redis memory stable

**Effort:** M
**Dependencies:** All previous sprints

#### 7.6 Deployment Rollback Runbook
**Description:** Document rollback procedures per SDD Flatline IMP-001.
**Acceptance Criteria:**
- Per-phase rollback documented:
  | Phase | Rollback Method | RTO | RPO |
  |-------|----------------|-----|-----|
  | ECS deploy | Previous task definition revision | <5 min | Zero (stateless) |
  | DB migration | Reverse migration script | <10 min | Zero (backward-compatible) |
  | Secrets rotation | Revert activeKid + re-deploy | <5 min | 60s JWT TTL window |
  | Feature flag | Env var toggle | <60s | Zero |
  | Payment webhook | Disable ALB rule | <2 min | Queued in NOWPayments retry |

**Effort:** S
**Dependencies:** None (documentation)

#### 7.7 Go/No-Go Gate Checklist
**Description:** Execute all 11 go/no-go gates for production deployment.
**Acceptance Criteria:**
- [ ] Health checks passing on both services (ECS)
- [ ] S2S JWT validated end-to-end (auth)
- [ ] At least one model pool responds to inference (inference)
- [ ] Conservation guard passing on test transactions (billing)
- [ ] NOWPayments webhook → credit mint working (payments)
- [ ] `/my-agent` thread creation working (discord)
- [ ] Admin API returning data (dashboard)
- [ ] JSONL audit export works (audit)
- [ ] API key → inference working (platform)
- [ ] CloudWatch alerts firing on test violation (monitoring)
- [ ] Rollback tested — previous task def revert succeeds (rollback)
- All gates pass → production deploy
- Any gate fails → document blocker, fix, re-gate

**Effort:** L
**Dependencies:** All previous sprints

#### 7.8 Production Deploy
**Description:** Deploy to production environment if all go/no-go gates pass.
**Acceptance Criteria:**
- `terraform apply` on production environment
- ECS services running with health checks passing
- DNS resolving correctly
- Smoke test: end-to-end inference request in production
- Monitoring dashboards showing production traffic
- On-call rotation confirmed

**Effort:** L
**Dependencies:** 7.7 (all gates pass)

### Sprint 7 Gate
- [ ] All 11 go/no-go gates pass
- [ ] Production deploy successful with health checks
- [ ] Alerting verified (test conservation violation → Slack within 60s)
- [ ] Rollback tested and documented
- [ ] Load baseline acceptable (<30s p95)

---

## Appendix A: FR → Sprint Mapping

| FR | Description | Sprint | Task |
|----|-------------|--------|------|
| FR-0.1 | Deploy loa-finn ECS | Sprint 1 | 1.1, 1.2 |
| FR-0.2 | Docker Compose local dev | Sprint 1 | 1.4 |
| FR-0.3 | S2S JWT exchange | Sprint 2 | 2.1, 2.2, 2.3 |
| FR-0.4 | Model pool responds | Sprint 2 | 2.4 |
| FR-0.5 | Metrics collection | Sprint 1 | 1.6 |
| FR-0.6 | CloudWatch dashboards | Sprint 7 | 7.1 |
| FR-0.7 | Alerting | Sprint 7 | 7.2 |
| FR-1.1 | Enable feature flag | Sprint 3 | 3.1 |
| FR-1.2 | Wire webhook | Sprint 3 | 3.1, 3.2 |
| FR-1.3 | Credit tiers | Sprint 3 | 3.3 |
| FR-1.4 | Discord /buy-credits | Sprint 3 | 3.5 |
| FR-1.5 | Telegram /buy-credits | Sprint 3 | 3.6 |
| FR-1.6 | Idempotent double-payment | Sprint 3 | 3.2 |
| FR-2.1 | NFT context enrichment | Sprint 4 | 4.1 |
| FR-2.2 | Pool/personality metadata | Sprint 4 | 4.1 |
| FR-2.3 | Anti-narration enforcement | Sprint 4 | 4.4 |
| FR-2.4 | Two-NFT differential routing | Sprint 4 | 4.4 |
| FR-3.1 | /my-agent Discord thread | Sprint 4 | 4.5 |
| FR-3.2 | Thread personality routing | Sprint 4 | 4.6 |
| FR-3.3 | /agent-info command | Sprint 4 | 4.8 |
| FR-3.4 | Admin usage dashboard | Sprint 5 | 5.1 |
| FR-3.5 | Admin API endpoints | Sprint 5 | 5.1–5.4 |
| FR-3.6 | Web chat widget | Sprint 6 | 6.5 |
| FR-3.7 | Standalone chat page | Sprint 6 | 6.7 |
| FR-4.1 | JSONL audit export | Sprint 5 | 5.2 |
| FR-4.2 | Pool enforcement transparency | Sprint 5 | 5.4 |
| FR-4.3 | Conservation guard endpoint | Sprint 5 | 5.3 |
| FR-4.4 | No PII in exports | Sprint 5 | 5.2 |
| FR-5.1 | API key generation | Sprint 6 | 6.1 |
| FR-5.2 | API key auth | Sprint 6 | 6.2 |
| FR-5.3 | Per-key rate limiting | Sprint 6 | 6.2 |
| FR-5.4 | Self-service portal | Sprint 6 | 6.3 |
| FR-5.5 | Developer onboarding | Sprint 6 | 6.4 |

## Appendix B: SDD Component → Sprint Mapping

| SDD Component | Sprint |
|---------------|--------|
| ECS Task Definitions (§1.3) | Sprint 1 |
| Service Discovery / Cloud Map (§1.3) | Sprint 1 |
| ADOT Sidecar / AMP (§1.3) | Sprint 1 |
| Database Migrations 061–065 (§3) | Sprint 1 |
| JWKS Endpoint (§1.6) | Sprint 2 |
| S2S JWT Signing (§1.6) | Sprint 2 |
| S2S JWT Validation (§1.6) | Sprint 2 |
| PgBouncer Read-Only (§1.4) | Sprint 2 |
| NOWPayments Webhook (§5.4) | Sprint 3 |
| IPN State Machine (§3.2) | Sprint 3 |
| Credit Mint Guard (§3.2) | Sprint 3 |
| Reconciliation Job (§3.2) | Sprint 3 |
| Inference Enrichment (§4.1) | Sprint 4 |
| Budget Reservation Lifecycle (§3.2, §1.5) | Sprint 4 |
| NATS JetStream Usage (SKP-002) | Sprint 4 |
| Discord Thread Management (§4.2) | Sprint 4 |
| Admin API Endpoints (§5) | Sprint 5 |
| JSONL Audit Export (§5) | Sprint 5 |
| API Key System (§1.9, §5) | Sprint 6 |
| SIWE Auth (§1.9, IMP-003) | Sprint 6 |
| WebSocket Chat (§4.2, IMP-004) | Sprint 6 |
| CloudWatch Dashboards (§8 Phase 6) | Sprint 7 |
| AMP Alerting Rules (§8 Phase 6) | Sprint 7 |
| JWKS Rotation Playbook (SKP-004) | Sprint 7 |
| Go/No-Go Gates (§8 Phase 6) | Sprint 7 |

## Appendix C: Goal → Sprint Traceability

| Goal | Description | Sprints | Verified By |
|------|-------------|---------|-------------|
| G-1 | Deploy full stack to production | Sprint 1, 2, 7 | 7.7 gate: health checks passing |
| G-2 | Enable crypto payment revenue | Sprint 3 | 7.7 gate: webhook → credit mint |
| G-3 | Production observability + alerting | Sprint 1, 7 | 7.7 gate: Slack alert within 60s |
| G-4 | Per-NFT personality routing | Sprint 4 | 7.7 gate: two NFTs routed differently |
| G-5 | Per-NFT Discord threads | Sprint 4 | 7.7 gate: /my-agent thread creation |
| G-6 | Admin budget visibility | Sprint 5 | 7.7 gate: admin API returns data |
| G-7 | Auditable billing + pool enforcement | Sprint 5 | 7.7 gate: JSONL export works |
| G-8 | Self-service developer API keys | Sprint 6 | 7.7 gate: API key → inference |
| G-9 | Web chat surface | Sprint 6 | 7.7 gate: widget streams response |

## Appendix D: S2S Contract (Frozen v1.0.0)

Per SDD Flatline SKP-001, the loa-freeside ↔ loa-finn contract is frozen at v1.0.0 for this cycle:

| Aspect | Specification |
|--------|---------------|
| **Endpoint** | `POST /api/v1/inference` |
| **Auth** | `Authorization: Bearer <ES256 JWT>`, `iss: loa-freeside`, `aud: loa-finn`, TTL 60s |
| **Request body** | `{ "prompt": string, "max_tokens"?: number, "stream": true }` |
| **JWT claims** | `nft_id`, `tier`, `budget_reservation_id`, `community_id` |
| **SSE events** | `data: {"type":"token","content":"..."}`, `data: {"type":"done","usage":{...}}` |
| **Response headers** | `X-Pool-Used`, `X-Personality-Id`, `X-Token-Count`, `X-Request-Id` |
| **Health** | `GET /health` → 200 `{"status":"ok","version":"..."}` |
| **Compatibility gate** | Both services log `contract_version: "1.0.0"` header; mismatch → warn (not block) |
