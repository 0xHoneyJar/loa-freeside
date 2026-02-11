# Sprint Plan: Hounfour Endgame — RFC #31 Final 20%

**Version**: 1.2.0
**Date**: February 11, 2026
**Cycle**: cycle-015
**Codename**: The Last Spice
**PRD**: `prd-hounfour-endgame.md` v1.2.0
**SDD**: `sdd-hounfour-endgame.md` v1.2.0

---

## Overview

| Attribute | Value |
|-----------|-------|
| **Total Sprints** | 4 |
| **Sprint Timebox** | 1 day per sprint (solo AI-assisted); hard stop + scope cut if exceeded |
| **Developer** | Solo (AI-assisted) |
| **Repos** | arrakis (primary), loa-finn (Sprint 1 only) |
| **Critical Path** | Sprint 1 → Sprint 4 (monitoring depends on metrics flowing) |
| **Parallel Work** | Sprints 2 & 3 are independent of each other |

### Definition of Done (per sprint)

1. All acceptance criteria marked as passing
2. Unit tests pass (`npm test` / `vitest`)
3. E2E tests pass (where applicable)
4. No new lint/type errors introduced
5. Code committed to feature branch with sprint prefix (e.g., `feat(sprint-1): ...`)
6. `/review-sprint` + `/audit-sprint` quality gates passed

---

## Sprint 1: Security Foundation — Pool Claims + E2E Infrastructure

**Goal**: Establish the security baseline (confused deputy prevention) and prove the cross-system request flow works.

**Why First**: Pool claim enforcement (FR-1) is the highest-priority security gap. E2E test infrastructure (FR-2) validates the entire system and is needed before feature work begins.

### Tasks

#### Task 1.1: Pool Claim Validator (loa-finn) — FR-1

**File**: `src/hounfour/pool-claim-validator.ts` (NEW)
**Modified**: `src/hounfour/jwt-auth.ts`, `src/hounfour/pool-registry.ts`

- Implement `PoolClaimValidator` class per SDD §3.1.1
- Extract `access_level` from JWT — missing → 401 reject (fail-closed)
- Re-derive `allowed_pools` from `access_level` via `PoolRegistry.getPoolsForAccessLevel()`
- Verify `pool_id` membership in derived set (canonicalized, sorted)
- Missing `pool_id` handling by tier:
  - Free tier: default to least-privileged pool from derived set
  - Pro/Enterprise: reject with 400 `POOL_ID_REQUIRED` (explicit pool_id mandatory)
  - Emit `pool_id_defaulted` metric when default is used (deprecation tracking)
- Enforcement mode via `POOL_CLAIM_MODE` env var (`warn` for Sprint 1, max 7 days before graduation)
- Emit `pool_claim_validation` structured event with claimed vs derived
- Add synthetic pool-claim traffic generator for staging validation (ensures mismatch=0 gate is reachable)
- Integrate into `jwt-auth.ts` middleware chain (after signature verification)
- Export `getPoolsForAccessLevel()` from `pool-registry.ts`

**Acceptance Criteria**:
- [ ] AC-1.1: JWT intake middleware extracts and validates pool claims
- [ ] AC-1.2: Missing `access_level` → 401 reject (both modes)
- [ ] AC-1.3: `allowed_pools` re-derived server-side from `access_level`
- [ ] AC-1.4: `pool_id` membership verified against re-derived set
- [ ] AC-1.5a: Missing `pool_id` (free tier) → least-privileged default + `pool_id_defaulted` metric emitted
- [ ] AC-1.5b: Missing `pool_id` (pro/enterprise) → 400 `POOL_ID_REQUIRED` reject
- [ ] AC-1.6a: `warn` mode — mismatch logs event + emits `pool_claim_mismatch` metric, request proceeds
- [ ] AC-1.6b: `reject` mode — mismatch returns 403 with `POOL_CLAIM_MISMATCH` error code
- [ ] AC-1.7: Unit tests for both modes: valid, forged, missing access_level, missing pool_id, unknown levels, warn passthrough, reject 403
- [ ] AC-1.8: `pool_claim_validation` event emitted (both modes)
- [ ] AC-1.9: Enforcement mode configurable via `POOL_CLAIM_MODE` env var

#### Task 1.2: Pool Mapping Version Claim — FR-1 + SDD §3.1.5

**Repos**: arrakis + loa-finn (cross-repo)

**Subtask 1.2a (arrakis)**:
**Modified**: `packages/adapters/agent/jwt-service.ts`
- Add `pool_mapping_version` claim to outbound JWTs
- Value derived from contract artifact package version (see Task 1.4)
- Document JWKS key lifecycle: rotation period, overlap window (sign with new, verify with both), cache TTL for consumers
- E2E stub must handle JWKS cache refresh (TTL ≤ rotation overlap window)

**Subtask 1.2b (loa-finn)**:
**Modified**: `src/hounfour/pool-claim-validator.ts`
- Add known-compatible version set to `PoolClaimValidator`
- On unknown version: persist first-seen timestamp in Redis (shared across replicas, SETNX for atomic first-write), force `warn` mode, emit CRITICAL alert
- After 24h grace (computed from Redis timestamp, not local clock): reject unknown version (fail-closed)
- Redis unavailable during grace check → fail-closed (reject unknown version — security over availability)
- Expose `/healthcheck/pool-mapping` endpoint showing current version compatibility status

**Acceptance Criteria**:
- [ ] AC-1.10: `pool_mapping_version` present in all outbound JWTs from arrakis
- [ ] AC-1.11: loa-finn logs CRITICAL alert on first encounter of unknown version
- [ ] AC-1.12: Unknown version allowed during 24h grace window (warn mode forced)
- [ ] AC-1.13: Unknown version rejected after 24h grace expires
- [ ] AC-1.14: E2E test validates grace window behavior (simulated via clock injection)
- [ ] AC-1.15: Healthcheck endpoint reports version compatibility status
- [ ] AC-1.16: Unit test: concurrent first-seen writes from multiple instances → only one timestamp persisted (SETNX semantics)
- [ ] AC-1.17: Unit test: Redis unavailable during grace check → unknown version rejected (fail-closed)

#### Task 1.3: E2E Test Infrastructure — FR-2

**New Files**: `tests/e2e/agent-gateway-e2e.test.ts`, `tests/e2e/loa-finn-e2e-stub.ts`, `tests/e2e/docker-compose.e2e.yml`, `tests/e2e/contracts/`

- Create Docker Compose with Redis + PostgreSQL (health-checked)
- Implement loa-finn E2E stub per SDD §3.2.1:
  - Generates ES256 key pair at startup
  - Publishes JWKS endpoint
  - Validates inbound JWT against arrakis JWKS
  - Validates request body against contract schema
  - Returns canned response from test vectors
  - Signs usage reports at runtime with stub key pair
- Create contract artifact files (schema + test vectors) per SDD §3.2.3
- Implement test scenarios per SDD §3.2.4:
  - `invoke_free_tier` — basic round-trip
  - `invoke_pro_pool_routing` — pool claim in JWT
  - `invoke_stream_sse` — SSE event order
  - `invoke_rate_limited` — 429 response
  - `invoke_budget_exceeded` — 402 response
  - `stream_abort_reconciliation` — abort mid-stream

**Acceptance Criteria**:
- [ ] AC-2.1: Invoke round-trip completes with 200
- [ ] AC-2.2: JWT validated by stub (uses contract schema)
- [ ] AC-2.3: Usage report received on arrakis (stub signs at runtime)
- [ ] AC-2.4: Budget committed matches usage reported (zero drift)
- [ ] AC-2.5: Stream round-trip with correct SSE event order
- [ ] AC-2.6: Rate limiting enforced
- [ ] AC-2.7: Docker Compose runs in CI

#### Task 1.4: Contract Artifact Package — FR-2 + SDD §3.2.3

**New Files**: `tests/e2e/contracts/package.json`, `tests/e2e/contracts/schema/`, `tests/e2e/contracts/vectors/`

- Package contract artifacts (JSON Schema + test vectors) as a versioned npm workspace package (`@arrakis/loa-finn-contract`)
- Semantic versioning — version bumps via PR-driven process
- Both arrakis E2E stub and Task 1.2a (`pool_mapping_version`) derive version from this package
- Pin base images in `docker-compose.e2e.yml` by digest (Redis, PostgreSQL)
- Document version bump process in package README

**Acceptance Criteria**:
- [ ] AC-2.8: Contract artifact package exists with semantic version
- [ ] AC-2.9: E2E stub imports schema and test vectors from package
- [ ] AC-2.10: `pool_mapping_version` JWT claim derived from contract package version
- [ ] AC-2.11: Docker Compose base images pinned by digest

---

## Sprint 2: Ensemble Strategy Exposure — FR-3

**Goal**: Expose multi-model orchestration to arrakis API consumers.

**Why Second**: Independent feature work that builds on the validated E2E infrastructure from Sprint 1.

### Tasks

#### Task 2.1: Ensemble Mapper — FR-3

**File**: `packages/adapters/agent/ensemble-mapper.ts` (NEW)

- Implement `EnsembleMapper` class per SDD §3.3.1
- Tier gating: free → 400, pro → allowed (maxN=3), enterprise → allowed (maxN=5)
- Clamp `n`/`quorum` to tier maximums
- Budget multiplier: `best_of_n`=N, `consensus`=N, `fallback`=N (worst-case)
- Return validated ensemble request + JWT claims
- Implement partial failure reconciliation logic (SDD §3.3.2 IMP-008):
  - On partial failure: committed = sum of successful model costs
  - Excess reservation released on finalize (committed ≤ reserved invariant holds)
  - Stream abort during ensemble: committed = tokens consumed so far across all models

**Acceptance Criteria**:
- [ ] AC-3.4: Free tier → 400 error
- [ ] AC-3.6: `n`/`quorum` clamped to tier maximums
- [ ] AC-3.7: Unit tests for each strategy + tier gating + clamping
- [ ] AC-3.8: Unit test asserts reservation multiplier = N for each strategy (including fallback)
- [ ] AC-3.9: Unit test asserts `committed ≤ reserved` under partial failure (1 of N models fails)
- [ ] AC-3.10: Unit test asserts `committed ≤ reserved` under stream abort mid-ensemble

#### Task 2.2: AgentGateway Ensemble Integration — FR-3

**Modified**: `packages/adapters/agent/agent-gateway.ts`, `packages/core/ports/agent-gateway.ts`

- Add `ensemble` field to `AgentInvokeRequest` port type
- Insert ensemble validation step between pool resolution and budget reservation
- Apply budget multiplier to `estimateCost()` result
- Pass ensemble claims to JWT signing

**Acceptance Criteria**:
- [ ] AC-3.1: `ensemble` field accepted in invoke/stream
- [ ] AC-3.3: Budget reservation = N * max single-model cost

#### Task 2.3: API Route + JWT Extension — FR-3

**Modified**: `themes/sietch/src/api/routes/agents.routes.ts`, `packages/adapters/agent/jwt-service.ts`

- Add Zod schema for `ensemble` field (strategy enum, n/quorum bounds, models array)
- Add ensemble JWT claims: `ensemble_strategy`, `ensemble_n`, `ensemble_quorum`, `ensemble_models`
- Feature flag: `ENSEMBLE_ENABLED` (default: false)

**Acceptance Criteria**:
- [ ] AC-3.2: Ensemble request forwarded in JWT claims
- [ ] AC-3.5: Fallback strategy works with circuit breaker

#### Task 2.4: Ensemble E2E Test Scenario — FR-2 + FR-3

- Add `invoke_ensemble_best_of_n` test scenario to E2E suite
- Verify ensemble claims in JWT, budget multiplier in reservation
- Add `invoke_ensemble_partial_failure` scenario: stub returns error for 1 of N models
- Verify committed/reported delta = 0 after partial failure reconciliation

**Acceptance Criteria**:
- [ ] AC-3.11: E2E test validates ensemble round-trip (best_of_n)
- [ ] AC-3.12: E2E test validates partial failure — committed ≤ reserved, drift = 0

---

## Sprint 3: BYOK Key Management — FR-4

**Goal**: Enable communities to store and use their own provider API keys.

**Why Third**: Independent from ensemble. Requires more security hardening (SSRF, encryption, proxy).

### Tasks

#### Task 3.1: BYOK Database Schema — FR-4

**File**: `themes/sietch/drizzle/migrations/0007_community_byok_keys.sql` (NEW)

- Create `community_byok_keys` table per SDD §3.4.1
- Columns: id, community_id, provider, key_ciphertext, key_nonce, dek_ciphertext, key_last4, timestamps, created_by
- Partial unique index on (community_id, provider) WHERE revoked_at IS NULL
- Run migration, update drizzle schema

**Acceptance Criteria**:
- [ ] Migration runs clean, rollback works

#### Task 3.2: BYOK Manager — FR-4

**File**: `packages/adapters/agent/byok-manager.ts` (NEW)

- Implement `BYOKManager` class per SDD §3.4.2
- Envelope encryption: generate DEK → AES-256-GCM encrypt → KMS wrap DEK
- In-process LRU cache (NOT Redis) for decrypted keys (60s TTL, 100 max, Buffer.fill(0) wipe)
- Key material handling hardening (Flatline SKP-007):
  - Keys stored as Node.js Buffers end-to-end — never converted to strings
  - Disable heap snapshots / core dumps in production (--no-heap-snapshot-on-oom, ulimit -c 0)
  - KMS QPS load test for multi-replica behavior (ensure cache miss rate stays within KMS quotas)
- KMS decrypt circuit breaker (3 failures/30s → open 60s → fail-closed)
- CRUD methods: storeKey, listKeys, revokeKey, rotateKey
- Redis `agent:byok:exists:*` for fast routing check

**Acceptance Criteria** (class-level, tested with mock KMS):
- [ ] AC-4.2: Encrypt/decrypt round-trip succeeds (envelope encryption)
- [ ] AC-4.3: listKeys returns only last 4 chars of key
- [ ] AC-4.9: rotateKey is atomic (new DEK, old key invalidated in single transaction)
- [ ] AC-4.14: LRU cache hit returns decrypted key without KMS call
- [ ] AC-4.15: LRU cache entries wiped with Buffer.fill(0) on eviction/TTL expiry
- [ ] AC-4.16: Circuit breaker opens after 3 KMS failures in 30s → fail-closed (storeKey/rotateKey reject)
- [ ] AC-4.17: Circuit breaker half-open after 60s → allows probe, closes on success

#### Task 3.3: BYOK Admin Routes + Integration — FR-4

**File**: `themes/sietch/src/api/routes/admin/byok.routes.ts` (NEW)
**Modified**: `themes/sietch/src/api/routes/admin/index.ts`

- POST/GET/DELETE/POST-rotate endpoints per SDD §6.2
- Admin role enforcement
- Zod validation: provider enum, api_key bounds, keyId UUID
- Mount on admin router
- Wire routes → BYOKManager → DB → KMS adapter

**Acceptance Criteria**:
- [ ] AC-4.1: Full CRUD lifecycle works end-to-end (routes → manager → DB → mock KMS)
- [ ] AC-4.10: Admin-only access enforced (non-admin → 403)
- [ ] AC-4.18: Integration test: store → list → rotate → revoke → verify revoked key absent from list

#### Task 3.4: BYOK Proxy Handler + Provider Allowlist — FR-4

**Files**:
- `packages/adapters/agent/byok-proxy-handler.ts` (NEW)
- `packages/adapters/agent/byok-provider-endpoints.ts` (NEW)

- Implement `PROVIDER_ENDPOINTS` static map per SDD §3.4.5:
  - Per-provider: exact hostnames, allowed operations, URL path templates, HTTP methods
  - Initial providers: `openai` (api.openai.com), `anthropic` (api.anthropic.com)
  - Unknown provider/operation → 400 reject
- Implement `BYOKProxyHandler` per SDD §3.4.5
- Capability-based URL resolution: provider + operation from JWT claims only, URL constructed from `PROVIDER_ENDPOINTS` map
- S2S JWT validation on inbound callback
- Replay protection: req_hash (SHA-256 of RFC 8785 canonical JSON) per SDD §5.3
- JTI uniqueness via Redis SETNX with 30s TTL
- SSRF defense: DNS resolution check, private IP blocking, redirect disabled, port 443
- Resolve-once-connect-by-IP with SNI (TOCTOU prevention)
- Rate limiting per community+provider (Flatline IMP-001)
- Response size limit 10MB, no body logging
- Redis unavailability policies (Flatline IMP-010):
  - JTI replay protection → **fail-closed** (reject request if Redis unavailable — security critical)
  - Rate limiting → **fail-open** (allow request, log degraded state — availability over rate control)
  - BYOK exists check → **fail-closed** (reject BYOK routing if Redis unavailable — prevents key exposure without validation)

**Acceptance Criteria**:
- [ ] AC-4.5: BYOK proxy authenticates via S2S JWT, community derived server-side
- [ ] AC-4.6: JTI + 30s TTL + req_hash replay protection
- [ ] AC-4.11: Egress restricted to allowlisted provider domains
- [ ] AC-4.12: Private IPs blocked (IPv4 + IPv6 RFC 1918/4193/link-local), redirects disabled, TLS 1.2+
- [ ] AC-4.13: Internal headers stripped, response size limited
- [ ] AC-4.19: Unknown provider in JWT → 400 (unit test)
- [ ] AC-4.20: Unknown operation for valid provider → 400 (unit test)
- [ ] AC-4.21: Host mismatch (provider URL doesn't match PROVIDER_ENDPOINTS) → rejected (unit test)
- [ ] AC-4.22: DNS resolving to private IP → rejected (unit test with mocked DNS, covers IPv4 + IPv6 private ranges)
- [ ] AC-4.23: Redirect attempt → rejected (unit test with mocked HTTP client, covers 301/302/307/308)
- [ ] AC-4.32: Runtime telemetry: log resolved IP addresses for every BYOK egress request (for post-incident analysis)
- [ ] AC-4.33: TLS peer certificate SAN validated against expected provider hostname
- [ ] AC-4.34: SSRF security review checklist documented (DNS rebinding, IPv6, certificate mis-issuance, proxy env vars disabled)

#### Task 3.5: AgentGateway BYOK Integration — FR-4

**Modified**: `packages/adapters/agent/agent-gateway.ts`, `packages/adapters/agent/jwt-service.ts`, `packages/adapters/agent/config.ts`

- Add BYOK check between ensemble validation and JWT signing
- BYOK_NO_BUDGET accounting: reserve $0, finalize $0
- Add JWT claims: `byok`, `byok_provider`, `byok_operation`
- UsageReceiver: validate BYOK reports have cost_micro_usd=0
- Platform-side BYOK metering (Flatline SKP-006):
  - Track per-community BYOK request count, egress bytes, and token count (non-billing, observability only)
  - Enforce community BYOK quota: max requests/day per community (configurable, default 10,000)
  - BYOK eligibility derived server-side from community record — never from client JWT claims alone
  - Anomaly detection: alert if BYOK request count exceeds 2x rolling 7-day average
- Feature flag: `BYOK_ENABLED` (default: false)

**Acceptance Criteria**:
- [ ] AC-4.4: JWT includes `byok: true` + `byok_provider` when BYOK key exists
- [ ] AC-4.7: BYOK_NO_BUDGET accounting ($0 reserve/$0 finalize)
- [ ] AC-4.8: Usage logged with cost_micro_usd=0
- [ ] AC-4.29: BYOK request count tracked per community (Redis counter)
- [ ] AC-4.30: Community BYOK quota enforced (429 when exceeded)
- [ ] AC-4.31: BYOK eligibility derived server-side (unit test: forged `byok: true` JWT without server-side key → rejected)

#### Task 3.6: BYOK E2E Test Scenario — FR-2 + FR-4

- Add `invoke_byok` test scenario to E2E suite
- Verify BYOK claims in JWT, BYOK_NO_BUDGET accounting

**Acceptance Criteria**:
- [ ] AC-2.9: E2E includes BYOK scenario

#### Task 3.7: BYOK Network-Layer SSRF Defense — FR-4 + SDD §3.4.5

**File**: `infrastructure/terraform/byok-security.tf` (NEW)

**Runtime**: ECS Fargate task in VPC (BYOK proxy runs as a dedicated task definition)

- Dedicated subnet for BYOK proxy ECS tasks with restricted route table
- Route BYOK egress through AWS Network Firewall with domain allowlist:
  - `api.openai.com`, `api.anthropic.com` (matching PROVIDER_ENDPOINTS from Task 3.4)
  - All other domains → deny + log
- Security group: allow outbound 443 only, deny all other ports
- VPC Flow Log filter for BYOK subnet — alert on denied egress
- CloudWatch alarm on Network Firewall deny count > 0

**Acceptance Criteria**:
- [ ] AC-4.24: Network Firewall domain allowlist permits only provider FQDNs
- [ ] AC-4.25: All non-allowlisted egress denied and logged by Network Firewall
- [ ] AC-4.26: Security group restricts outbound to port 443 only
- [ ] AC-4.27: VPC Flow Log + CloudWatch alarm configured for denied BYOK egress
- [ ] AC-4.28: Terraform plan validates cleanly in staging (`terraform plan` exits 0)

---

## Sprint 4: Production Monitoring & Hardening — FR-5

**Goal**: Establish production observability and graduate security enforcement.

**Why Last**: Monitoring depends on metrics flowing through the agent path. Feature flags can be enabled after monitoring is in place.

### Tasks

#### Task 4.1: CloudWatch EMF Integration — FR-5

**Modified**: `packages/adapters/agent/agent-gateway.ts`, `packages/adapters/agent/ensemble-mapper.ts`, `packages/adapters/agent/byok-proxy-handler.ts`, and pool claim validator (loa-finn)

- Add `aws-embedded-metrics` dependency
- Emit EMF metrics per SDD §3.5.1:
  - `RequestLatency` (distribution) in invoke/stream, with dimension `feature` = `baseline|ensemble|byok`
  - `CircuitBreakerState` (gauge)
  - `RedisLatency` (distribution)
  - `ReservationAge` (distribution, from reaper)
  - `CommittedReportedDelta` (gauge, from reconciliation), with dimension `accounting_mode` = `standard|byok`
- Add structured log events for Log Metric Filters:
  - `agent_request_complete` (with status for 5xx count, with `feature` dimension)
  - `rate_limit_hit` (with dimension)
  - `finalize_failure`
  - `budget_finalize` (with committed amount)
- Add pool claim enforcement metrics (loa-finn):
  - `pool_claim_mismatch` counter (warn mode — request proceeds but mismatched)
  - `pool_claim_reject` counter (reject mode — 403 returned)
  - Dimension: `pool_id`

**Acceptance Criteria**:
- [ ] AC-5.4: Metrics emit from agent gateway code
- [ ] AC-5.6: EMF metrics visible in CloudWatch namespace
- [ ] AC-5.7: Metrics include `feature` dimension distinguishing baseline/ensemble/byok traffic
- [ ] AC-5.8: `pool_claim_mismatch` and `pool_claim_reject` counters emitted from loa-finn
- [ ] AC-5.9: `CommittedReportedDelta` excludes BYOK via `accounting_mode` dimension

#### Task 4.2: CloudWatch Dashboard + Alarms — FR-5

**File**: `infrastructure/terraform/agent-monitoring.tf` (NEW)

- Dashboard layout per SDD §3.5.3 (10+ widgets)
- Include feature-specific breakdowns (ensemble, BYOK, baseline) using `feature` dimension
- Include pool claim mismatch rate widget (for warn→reject graduation)
- 6 alarms per SDD §3.5.2:
  - Error rate > 5% for 5 min
  - Latency p99 > 5s for 5 min
  - Circuit breaker open > 2 min
  - Budget threshold > 80%
  - Stale reservations > 300s
  - Finalize failures > 0 for 10 min
- Metric math expression for error rate (`5xx / total * 100`)
- SNS topic for alarm notifications

**Acceptance Criteria**:
- [ ] AC-5.1: CloudWatch dashboard with 10+ metrics including feature breakdowns
- [ ] AC-5.2: 6 alarms with SNS notification
- [ ] AC-5.5: Budget threshold alarm fires on test data
- [ ] AC-5.10: Dashboard includes pool_claim_mismatch rate widget

#### Task 4.3: Runbooks — FR-5

**New Files**:
- `grimoires/loa/deployment/agent-circuit-breaker-open.md`
- `grimoires/loa/deployment/agent-budget-drift-high.md`
- `grimoires/loa/deployment/agent-redis-degraded.md`

- Step-by-step investigation and recovery procedures
- Links to dashboard, alarm details, and escalation contacts

**Acceptance Criteria**:
- [ ] AC-5.3: 3 runbooks with step-by-step procedures

#### Task 4.4: Graduate Pool Claims to Reject Mode — FR-1

**Prerequisite**: `pool_claim_mismatch` metric rate = 0 in staging for 24h
**Hard deadline**: Warn mode must not exceed 7 days from Sprint 1 deployment

- Verify `pool_claim_mismatch` counter = 0 via CloudWatch dashboard (Task 4.2)
- Run synthetic pool-claim traffic against staging to validate mismatch=0 gate
- Verify pre-reject healthcheck endpoint (Task 1.2b) shows no mapping version mismatches
- Staged rollout: enable `reject` for internal/service accounts first, then all traffic
- Change `POOL_CLAIM_MODE` from `warn` to `reject` in loa-finn config
- Confirm E2E tests pass with `reject` mode
- Monitor `pool_claim_reject` counter for unexpected 403s
- **Escalation**: If mismatch ≠ 0 after 5 days, escalate to engineering lead; at 7 days, force targeted reject (allowlist known-good clients, reject unknown)

**Acceptance Criteria**:
- [ ] SC-1: Pool claim enforcement in `reject` mode
- [ ] SC-2: Pre-graduation preflight confirms `pool_claim_mismatch` = 0 for 24h
- [ ] SC-3: No unexpected 403 errors in staging validation (monitored for 1h post-switch)
- [ ] SC-4: Staged rollout (internal accounts first) verified before full rollout

#### Task 4.5: Feature Flag Enablement — FR-3 + FR-4

**Prerequisite**: Tasks 4.1 + 4.2 deployed (monitoring must be in place before enablement)

- Enable `ENSEMBLE_ENABLED=true` in staging
- Enable `BYOK_ENABLED=true` for beta communities in staging
- Run full E2E suite (including ensemble and BYOK scenarios)
- Verify monitoring captures feature-specific metrics:
  - Dashboard shows ensemble traffic separated from baseline via `feature` dimension
  - Dashboard shows BYOK traffic separated from baseline via `feature` dimension
  - `CommittedReportedDelta` shows drift = 0 for both ensemble and BYOK

**Acceptance Criteria**:
- [ ] AC-5.11: Ensemble and BYOK features active in staging
- [ ] AC-5.12: Dashboard shows feature-specific metrics with `feature` dimension breakdowns
- [ ] AC-5.13: Drift = 0 for both ensemble and BYOK traffic in staging

---

## Dependency Graph

```
Sprint 1 (Security + E2E)
  ├─→ Sprint 2 (Ensemble) ──────────┐
  └─→ Sprint 3 (BYOK) ─────────────┤
                                     ▼
                              Sprint 4 (Monitoring + Hardening)
```

Sprints 2 and 3 are **independent** and can be developed in either order.
Sprint 4 **depends** on Sprints 1-3 (needs all features before monitoring/enablement).

---

## Rollback Criteria & Procedures

### Sprint 1: Pool Claim Enforcement

**Rollback trigger**: Widespread 401s or degraded request latency after middleware integration
**Rollback steps**:
1. Set `POOL_CLAIM_MODE=warn` (no restart required if hot-reloadable, otherwise redeploy loa-finn)
2. Verify `pool_claim_reject` counter drops to 0
3. Investigate root cause (mapping drift, unknown access_levels, JWT signing issues)
**Data safety**: No data mutation — pool claims are read-only validation

### Sprint 3: BYOK Database Migration

**Rollback trigger**: Migration failure, schema incompatibility, or performance regression
**Rollback steps**:
1. Run `drizzle-kit down` (reverse migration 0007)
2. Verify `community_byok_keys` table dropped cleanly
3. Confirm no FK references from other tables
**Data safety**: Rollback destroys stored BYOK keys — acceptable only before production enablement. After enablement, require key re-entry by admins.
**Backward compatibility**: New columns/table only — no existing schema changes

### Sprint 4: Warn → Reject Graduation

**Rollback trigger**: Unexpected 403s after switching to `reject` mode
**Rollback steps**:
1. Set `POOL_CLAIM_MODE=warn` immediately
2. Monitor `pool_claim_mismatch` to identify offending clients
3. Investigate mapping version drift via healthcheck endpoint
4. Fix client JWTs or mapping, then re-attempt graduation
**Escalation**: If mismatch rate does not reach 0 within 7 days of warn mode, escalate to engineering lead for targeted reject (allowlist known-good clients, reject unknown)

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| loa-finn PR review bottleneck | Sprint 1 Task 1.1 is self-contained; can be submitted as standalone PR early |
| E2E test Docker Compose flaky | Health checks + retry logic + deterministic stub responses |
| KMS access from local dev | Mock KMS in tests; real KMS only in staging/production |
| Contract artifact publication | Start with vendored JSON files; npm package is a polish step |

---

## Sprint Metrics Targets

| Sprint | Estimated Tasks | New Files | Modified Files |
|--------|----------------|-----------|----------------|
| Sprint 1 | 4 | 8 | 3 |
| Sprint 2 | 4 | 1 | 4 |
| Sprint 3 | 7 | 6 | 4 |
| Sprint 4 | 5 | 4 | 4 |
| **Total** | **20** | **19** | **15** |

---

**Document Owner**: Hounfour Integration Team
**Review Cadence**: Per sprint completion
