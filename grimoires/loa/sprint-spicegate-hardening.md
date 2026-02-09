# Sprint Plan: Spice Gate Hardening — Bridgebuilder Review Fixes

**Version**: 1.0.0
**Date**: February 9, 2026
**Cycle**: cycle-010 (Spice Gate)
**Source**: [PR #40 Bridgebuilder Review](https://github.com/0xHoneyJar/arrakis/pull/40)
**PRD**: `grimoires/loa/prd-hounfour-phase4.md` v1.2.0
**SDD**: `grimoires/loa/sdd-hounfour-phase4.md` v1.4.0
**Branch**: `feature/spice-gate-phase4` (continues existing PR #40)

---

## Overview

| Property | Value |
|----------|-------|
| Total Sprints | 2 |
| Sprint Duration | ~2-3 days each |
| Team Size | 1 developer (AI-assisted) |
| Source | 11 findings from Bridgebuilder adversarial review of PR #40 |
| High Severity | 2 (must fix before merge) |
| Medium Severity | 5 (production hardening) |
| Low Severity | 1 (engineering excellence) |
| Scope | Hardening only — no new features, no architectural changes |

## Finding Severity Map

| # | Severity | Category | Finding | Sprint |
|---|----------|----------|---------|--------|
| 1 | **High** | Security | IP rate limiter trusts client-provided IP | Sprint 0 |
| 2 | **High** | Testing | Integration tests 70% placeholder | Sprint 0 |
| 3 | Medium | Correctness | No Redis operation timeouts | Sprint 1 |
| 4 | Medium | Correctness | Reaper-finalize accounting drift logging | Sprint 1 |
| 5 | Medium | Architecture | No budget overspend CloudWatch alarms | Sprint 1 |
| 6 | Medium | Architecture | JWT key rotation is manual | Sprint 1 |
| 7 | Medium | Architecture | Hardcoded pricing table | Sprint 1 |
| 8 | Medium | Correctness | Worker jobs lack circuit breakers | Sprint 1 |
| 9 | Low | Documentation | Missing decision trails (~10 constants) | Sprint 1 |

## Sprint Dependency Graph

```
Sprint 0 (Critical Security + Test Coverage)
    ↓
Sprint 1 (Production Hardening + Observability)
```

Sprint 1 depends on Sprint 0 because:
- Redis timeout configuration (S1-T1) must not break newly-implemented tests
- Budget alarms (S1-T3) reference accounting drift logging (S1-T2) for metric names
- Pricing externalization (S1-T5) changes budget calculation, so tests must exist first

---

## Sprint 0: Critical Security + Test Coverage (Global ID: 184)

**Goal**: Fix the two high-severity findings that block PR merge: IP spoofing vulnerability and test coverage gap.
**Bridgebuilder findings addressed**: #1 (IP rate limiter), #2 (test placeholders)

### Tasks

#### S0-T1: Fix IP Rate Limiter Trust Proxy Configuration

**Files**: `packages/adapters/agent/ip-rate-limiter.ts`, Express app configuration
**Description**: The IP rate limiter extracts client IP via `req.ip || req.socket.remoteAddress || 'unknown'`. Behind an ALB, `req.ip` comes from `X-Forwarded-For` which is client-spoofable. Fix by:
1. Configure Express `trust proxy` setting to trust exactly 1 hop (ALB)
2. Replace raw IP extraction with validated extraction that distinguishes loopback/health-check traffic
3. Remove the shared `'unknown'` fallback bucket (use a per-source-type bucket instead)

**Acceptance Criteria**:
- [ ] Express app sets `app.set('trust proxy', 1)` or equivalent for ECS/ALB
- [ ] `extractIp()` method validates IP format and handles IPv6 normalization
- [ ] Health check requests (loopback IPs) get a dedicated bucket, not shared with client traffic
- [ ] Unit test: spoofed `X-Forwarded-For` header does not bypass rate limit
- [ ] Unit test: requests without IP info are rate-limited (not given infinite budget)

**Effort**: Small
**Dependencies**: None
**Risk**: Low — isolated change to one file + Express config

---

#### S0-T2: Implement Budget Interleaving Property-Based Test

**Files**: `tests/integration/agent-gateway.test.ts`
**Description**: Replace the placeholder budget interleaving test with a property-based test using fast-check. Generate random sequences of reserve/finalize/reap operations across concurrent users and assert the core invariant: `committed + reserved <= limit` at all times.

**Acceptance Criteria**:
- [ ] Uses `fast-check` library for property-based generation
- [ ] Generates: random user count (2-10), random operation sequences (reserve, finalize, reap)
- [ ] Runs 100+ iterations with shrinking on failure
- [ ] Asserts invariant after every operation: `committed + reserved <= limit`
- [ ] Asserts: no community overspends beyond estimated cost margin
- [ ] Tests concurrent operations via `Promise.all` with randomized delays
- [ ] Uses real Redis (not mocked)

**Effort**: Medium
**Dependencies**: `fast-check` npm package
**Risk**: Medium — property-based tests can be flaky if not seeded deterministically

---

#### S0-T3: Implement Finalization Idempotency Test

**Files**: `tests/integration/agent-gateway.test.ts`
**Description**: Replace the placeholder finalization idempotency test. Call `budgetManager.finalize()` twice with the same idempotency key and assert budget is only debited once.

**Acceptance Criteria**:
- [ ] Reserve budget for a request
- [ ] Call `finalize()` with actual cost
- [ ] Call `finalize()` again with the same idempotency key (different actual cost)
- [ ] Assert: committed counter incremented only once (first call's cost)
- [ ] Assert: second call returns `ALREADY_FINALIZED` status
- [ ] Assert: reservation hash is cleaned up after first finalization
- [ ] Uses real Redis

**Effort**: Small
**Dependencies**: None

---

#### S0-T4: Implement JWT Key Rotation Test

**Files**: `tests/integration/agent-gateway.test.ts`
**Description**: Replace the placeholder JWT key rotation test. Generate a token with key A, rotate to key B, verify the original token still validates during the overlap window.

**Acceptance Criteria**:
- [ ] Generate ES256 key pair A, initialize JwtService
- [ ] Sign a token with key A
- [ ] Generate key pair B, rotate JwtService to key B (preserving A as previous)
- [ ] Assert: JWKS endpoint serves both keys (current + previous)
- [ ] Assert: token signed with key A still verifies (using JWKS)
- [ ] Assert: new token signed with key B also verifies
- [ ] Assert: after overlap window expiry, key A is removed from JWKS
- [ ] Zero 401 errors during rotation

**Effort**: Medium
**Dependencies**: `jose` library for verification

---

#### S0-T5: Implement Multi-Dimensional Rate Limiting Test

**Files**: `tests/integration/agent-gateway.test.ts`
**Description**: Replace the placeholder rate limiting test. Verify all 4 dimensions (community, user, channel, burst) independently enforce their limits.

**Acceptance Criteria**:
- [ ] Per-user limit: exceed free tier limit (60/min), assert 429 with correct dimension
- [ ] Per-community limit: exceed community limit, assert 429
- [ ] Per-channel limit: exceed channel limit, assert 429
- [ ] Burst limit: send burst > token bucket capacity, assert 429
- [ ] Cross-dimension: user under limit but community over limit → 429
- [ ] After window reset: previously limited user can make requests again
- [ ] Uses real Redis with Lua script

**Effort**: Medium
**Dependencies**: None

---

#### S0-T6: Implement Remaining Placeholder Tests

**Files**: `tests/integration/agent-gateway.test.ts`
**Description**: Replace the remaining 3 placeholder tests: Redis failure isolation, tier→access contract, and contract version gating.

**Acceptance Criteria**:
- [ ] **Redis failure isolation**: Disconnect Redis, assert agent endpoints return 503 while non-agent endpoints remain functional
- [ ] **Tier→access contract**: For each tier (1-9), assert correct access level and model aliases match SDD §2.3 table
- [ ] **Contract version gating**: Configure stub with old contract version, assert health check reports incompatible version
- [ ] All tests use `test.todo()` → real `test()` conversion (no more `expect(true).toBe(true)`)

**Effort**: Medium
**Dependencies**: S0-T4 (JWT test infrastructure), S0-T5 (rate limit test infrastructure)

---

## Sprint 1: Production Hardening + Observability (Global ID: 185)

**Goal**: Address all medium and low severity findings — Redis timeouts, accounting drift observability, budget alarms, key rotation automation, pricing externalization, and decision documentation.
**Bridgebuilder findings addressed**: #3-#9

### Tasks

#### S1-T1: Add Redis Operation Timeouts

**Files**: `packages/adapters/agent/agent-rate-limiter.ts`, `packages/adapters/agent/budget-manager.ts`, Redis client configuration
**Description**: Add `commandTimeout` to ioredis client configuration for all Redis operations in the request path. Currently, slow Redis operations block the event loop indefinitely.

**Acceptance Criteria**:
- [ ] Redis client configured with `commandTimeout: 500` (500ms per operation)
- [ ] `connectTimeout: 5000` for initial connection
- [ ] `maxRetriesPerRequest: 1` to fail fast
- [ ] Rate limiter: Redis timeout triggers fail-closed (deny request)
- [ ] Budget manager: Reserve timeout triggers fail-closed; finalize timeout logs and continues
- [ ] Test: simulate slow Redis, assert request completes within timeout + fails appropriately
- [ ] Comment: `// 500ms: p99 Redis latency is ~2ms; 500ms allows for GC pauses`

**Effort**: Small
**Dependencies**: None

---

#### S1-T2: Add ACCOUNTING_DRIFT Logging to Lua Scripts

**Files**: `packages/adapters/agent/lua/budget-finalize.lua`, `packages/adapters/agent/lua/budget-reaper.lua`
**Description**: When the `reserved` counter is clamped to 0 (negative prevention), log the drift magnitude. This enables detection of double-decrement races and budget accounting inconsistencies.

**Acceptance Criteria**:
- [ ] `budget-finalize.lua`: When `newReserved < 0`, emit `redis.log(redis.LOG_WARNING, 'ACCOUNTING_DRIFT finalize community=...')` with drift magnitude
- [ ] `budget-reaper.lua`: When `newReserved < 0`, emit equivalent log
- [ ] `budget-manager.ts`: Parse `ACCOUNTING_DRIFT` indicator from Lua response if extended return value added
- [ ] Log includes: community ID, drift amount (cents), operation type (finalize/reap)
- [ ] Observability: `logMetricEmitter` emits `agent_accounting_drift_cents` metric when drift detected
- [ ] Test: trigger a race scenario where reserved goes negative, assert drift is logged

**Effort**: Small
**Dependencies**: None

---

#### S1-T3: Add Budget + Reconciliation CloudWatch Alarms

**Files**: `infrastructure/terraform/monitoring.tf`
**Description**: Add business-logic alarms for budget overspend, reconciliation failures, and JWT validation failures. Currently only infrastructure-level alarms exist (Redis CPU/connections/evictions).

**Acceptance Criteria**:
- [ ] Alarm: `agent_budget_overspend` — fires when any community's `committed + reserved > limit`
- [ ] Alarm: `agent_reconciliation_failures` — fires when stream reconciliation error count > 5 in 5 minutes
- [ ] Alarm: `agent_accounting_drift` — fires when ACCOUNTING_DRIFT metric > 0 in any 5-minute window
- [ ] Alarm: `agent_reaper_failures` — fires when budget reaper errors > 3 in 5 minutes
- [ ] All alarms route to existing SNS topic
- [ ] Terraform plan validates cleanly

**Effort**: Small
**Dependencies**: S1-T2 (drift metric name must match alarm filter)

---

#### S1-T4: Automate JWT Key Rotation

**Files**: `scripts/agent-key-rotation.sh`, `.github/workflows/key-rotation.yml` (new)
**Description**: Parameterize the key rotation script (remove hardcoded AWS region), add a GitHub Actions cron job for quarterly rotation, and add a CloudWatch alarm for key staleness.

**Acceptance Criteria**:
- [ ] Script uses `AWS_REGION=${AWS_REGION:-us-east-1}` instead of hardcoded region
- [ ] Script accepts `--secret-name` parameter (currently hardcoded)
- [ ] GitHub Actions workflow runs quarterly (1st of month, every 3 months, 3am UTC)
- [ ] Workflow uses `aws-actions/configure-aws-credentials` with OIDC (no static keys)
- [ ] Workflow runs in dry-run mode first, then executes if dry-run passes
- [ ] CloudWatch alarm: key secret not modified in > 100 days
- [ ] Add concurrent rotation prevention (check if rotation already in progress via Secrets Manager tag)

**Effort**: Medium
**Dependencies**: GitHub Actions secrets for AWS OIDC role

---

#### S1-T5: Externalize Pricing Table to Runtime Config

**Files**: `packages/adapters/agent/budget-manager.ts`, `packages/adapters/agent/budget-config-provider.ts`
**Description**: Move the hardcoded `MODEL_PRICING` table to the database/Redis configuration layer. Falls back to hardcoded defaults if runtime config unavailable.

**Acceptance Criteria**:
- [ ] `BudgetConfigProvider` gains a `getModelPricing(modelAlias)` method
- [ ] Pricing stored in `community_agent_config.pricingDefaults` (global) or `pricingOverrides` (per-community)
- [ ] `BudgetManager.estimateCost()` queries config provider first, falls back to `DEFAULT_MODEL_PRICING`
- [ ] Admin API (`agent-config.ts`) supports updating global pricing defaults
- [ ] Pricing cached in Redis with 5-minute TTL (same pattern as tier overrides)
- [ ] Test: update pricing via admin API, verify next cost estimate uses new pricing
- [ ] Hardcoded table remains as `DEFAULT_MODEL_PRICING` constant for fallback

**Effort**: Medium
**Dependencies**: None

---

#### S1-T6: Add Worker Circuit Breakers

**Files**: `packages/adapters/agent/budget-reaper-job.ts`, `packages/adapters/agent/stream-reconciliation-worker.ts`
**Description**: Add timeout protection and circuit breaker behavior to worker jobs. Currently, a hung Redis/loa-finn call blocks the entire worker cycle.

**Acceptance Criteria**:
- [ ] Budget reaper: per-community `reap()` call has 10s timeout via `AbortSignal.timeout(10_000)`
- [ ] Budget reaper: if > 50% of communities fail, skip remaining and emit error metric
- [ ] Reconciliation worker: loa-finn query has 30s timeout
- [ ] Reconciliation worker: emit `agent_reconciliation_attempts` and `agent_reconciliation_success` metrics
- [ ] Both workers: add structured logging with duration_ms for each operation
- [ ] Test: mock slow Redis, assert worker completes within timeout

**Effort**: Small
**Dependencies**: None

---

#### S1-T7: Add Decision Trail Comments

**Files**: Multiple (see list below)
**Description**: Add one-line reasoning comments to ~10 key constants and design decisions identified in the Bridgebuilder review. No code changes — documentation only.

**Constants requiring comments**:
1. `jwt-service.ts`: ES256 algorithm choice (vs RS256)
2. `loa-finn-client.ts:107`: 120s circuit breaker reset timeout
3. `agent-auth-middleware.ts`: 5-minute tier cache TTL
4. `agent-gateway.ts:109,200`: 1000 vs 2000 output token estimates (sync vs stream)
5. `agent-gateway.ts:343`: 30-second reconciliation delay
6. `ip-rate-limiter.ts`: In-memory vs Redis-backed rate limiter choice
7. `budget-manager.ts:48-54`: Pricing table values and their sources
8. `config.ts`: RESERVATION_TTL_MS = 300_000 (5 min)
9. `config.ts`: BUDGET_WARNING_THRESHOLD = 0.80 (80%)
10. `loa-finn-client.ts:71`: Retry delays [1s, 2s, 4s] and max 3 retries

**Acceptance Criteria**:
- [ ] Each constant has a `// Reason: ...` comment explaining the value and tradeoff
- [ ] Comments reference SDD sections, benchmarks, or industry standards where applicable
- [ ] No code behavior changes (documentation-only PR)
- [ ] Comments follow pattern: `// {value}: {reasoning}. See {reference}.`

**Effort**: Small
**Dependencies**: None

---

## Success Criteria

| Metric | Target |
|--------|--------|
| High-severity findings resolved | 2/2 |
| Medium-severity findings resolved | 5/5 |
| Low-severity findings resolved | 1/1 |
| Integration test coverage | 100% scenarios implemented (0 placeholders) |
| Property-based budget invariant | `committed + reserved <= limit` holds for 100+ random sequences |
| IP rate limiter | Cannot be bypassed via header spoofing |
| Redis timeout protection | All request-path Redis calls timeout in < 500ms |
| Budget observability | Alarms fire within 5 minutes of overspend/drift |
| Key rotation | Automated quarterly with staleness alarm |

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Property-based tests are flaky | Medium | Low | Use deterministic seed, increase shrink iterations |
| Redis timeout breaks existing behavior | Low | Medium | Test with integration suite before/after timeout config |
| Pricing externalization changes budget calculations | Medium | Medium | Run existing budget tests against new pricing path |
| GitHub Actions OIDC setup requires AWS admin | Medium | Low | Defer to manual rotation if blocked; document as known gap |

## Estimated Timeline

| Sprint | Duration | Dependencies |
|--------|----------|-------------|
| Sprint 0 | 2-3 days | `fast-check` npm package |
| Sprint 1 | 2-3 days | Sprint 0 (tests must exist first) |
| **Total** | **4-6 days** | |
