# Sprint 2 (335): Revenue Activation — Implementation Report

## Sprint Overview

| Field | Value |
|-------|-------|
| Sprint ID | sprint-2 (global: 335) |
| Cycle | 037 — Proof of Economic Life |
| Branch | feature/launch-readiness |
| Status | IMPLEMENTED — awaiting review |
| Date | 2026-02-24 |
| Depends On | Sprint 0A (332) + Sprint 0B (333) |

## Tasks Completed

### Task 2.1: NOWPayments Webhook Handler (F-16, F-17, F-18)

**Status:** COMPLETED

**What was done:**
- Created `packages/services/nowpayments-handler.ts` — Credit lot minting bridge
- Created `packages/routes/webhooks.routes.ts` — POST /webhooks/nowpayments endpoint
- HMAC-SHA512 signature verification via `x-nowpayments-sig` header using `timingSafeEqual`
- 401 on invalid/missing signature (NOT 200 per acceptance criteria)
- 200 for all valid signatures including duplicates
- webhook_events INSERT ON CONFLICT DO NOTHING for dedup
- credit_lots INSERT ON CONFLICT (payment_id) DO NOTHING RETURNING id
- Redis INCRBY conditional on INSERT returning id (not duplicate)
- Status monotonicity via ordinal comparison (waiting=0 → confirming=1 → finished=4)
- Timestamp age logged as metric only, NOT used for rejection
- Feature flag: FEATURE_BILLING_ENABLED gate
- Payment existence verification (Flatline IMP-009)
- Audit logging to billing_audit_log

**Files:**
- `packages/services/nowpayments-handler.ts` (NEW — ~195 lines)
- `packages/routes/webhooks.routes.ts` (NEW — ~285 lines)

**Acceptance Criteria Assessment:**
- [x] HMAC-SHA512 verification of `x-nowpayments-sig` header
- [x] 401 on invalid/missing signature (NOT 200)
- [x] 200 for all valid signatures (including duplicates)
- [x] INSERT INTO webhook_events ON CONFLICT DO NOTHING (dedup)
- [x] INSERT INTO credit_lots ON CONFLICT (payment_id) DO NOTHING RETURNING id
- [x] Redis INCRBY only if credit_lots INSERT returned id
- [x] Status monotonicity: waiting → confirming → finished
- [x] Timestamp-age: logged as metric only
- [x] Feature flag: FEATURE_BILLING_ENABLED
- [x] Payment creation flow verification (Flatline IMP-009)
- [ ] WAF rate limiting — infrastructure-level, deferred to deploy runbook

---

### Task 2.2: NOWPayments Reconciliation Job (F-19)

**Status:** COMPLETED

**What was done:**
- Created `packages/services/reconciliation-sweep.ts` — Polls NOWPayments API for stuck payments
- Added EventBridge rule + ECS task definition to `infrastructure/terraform/eventbridge.tf`
- Operates independently of Redis availability (PostgreSQL-first)
- Queries crypto_payments WHERE status IN (waiting, confirming, confirmed, sending) AND age > 10min
- Polls NOWPayments API for each, triggers idempotent mint via processPaymentForLedger()
- Updates status for failed/expired payments
- Metrics: recoveredCount, failedCount, pendingCount, errorCount

**Files:**
- `packages/services/reconciliation-sweep.ts` (NEW — ~235 lines)
- `infrastructure/terraform/eventbridge.tf` (MODIFIED — +65 lines)

**Acceptance Criteria Assessment:**
- [x] EventBridge rule: every 5 minutes → ECS Fargate task
- [x] Queries stuck payments older than 10 minutes
- [x] Polls NOWPayments API: GET /v1/payment/{payment_id}
- [x] If finished + no credit_lots row: trigger idempotent mint
- [x] If expired/failed: update crypto_payments status
- [x] Metrics: reconciliation_recovery_count, payment_failure_count
- [x] Operates independently of Redis availability

---

### Task 2.3: x402 Integration — Conservative-Quote-Settle (F-20)

**Status:** COMPLETED

**What was done:**
- Created `packages/services/x402-settlement.ts` — Settlement service with conservative-quote-settle pattern
- Created `packages/routes/x402.routes.ts` — GET /x402/quote, POST /x402/agents/:agentId/chat
- Quote returns max pool cost as price_micro with nonce for replay prevention
- Settlement: mint lot (source='x402') → debit actual cost → credit-back remainder
- Nonce replay prevention via webhook_events(provider='x402', event_id=nonce) UNIQUE constraint
- Redis limit adjustment: full quoted amount added to budget
- Response headers: x-402-settled, x-402-credited
- Feature flag: FEATURE_X402_ENABLED gate
- Fallback: returns fixed-price tier options on settlement failure

**Files:**
- `packages/services/x402-settlement.ts` (NEW — ~260 lines)
- `packages/routes/x402.routes.ts` (NEW — ~240 lines)

**Acceptance Criteria Assessment:**
- [x] GET /x402/quote returns price_micro, pool, valid_for_s
- [x] POST /x402/agents/:agentId/chat accepts X-402-Payment header
- [x] Settlement creates credit_lots (source='x402', amount_micro=quoted)
- [x] Debit lot_entries for actual cost
- [x] Credit-back lot_entries for remainder (quoted - actual)
- [x] Redis limit adjustment (conditional on INSERT)
- [x] Response headers: x-402-settled, x-402-credited
- [x] Feature flag: FEATURE_X402_ENABLED
- [x] Fallback: fixed-price tier options on failure
- [x] Nonce replay prevention via webhook_events UNIQUE constraint
- [ ] x402 proof on-chain verification — uses existing stub verifier, full implementation when @x402/hono is available

---

### Task 2.4: E2E Replay Test Harness (F-21)

**Status:** COMPLETED

**What was done:**
- Created `tests/e2e/economic-loop-replay.test.ts` — Full deterministic replay test suite
- Mock infrastructure: MockPgPool with UNIQUE constraint enforcement, MockRedis with INCRBY/DECRBY
- 3 replay scenarios: seed lifecycle, NOWPayments webhook lifecycle, x402 conservative-quote-settle lifecycle
- All conservation invariants I-1 through I-3 verified after each replay
- Idempotency tests: duplicate payment_id, duplicate webhook, duplicate nonce
- Invariant guards: BigInt arithmetic, split debit preservation, cents-to-micro conversion
- Deterministic: same inputs produce same outputs
- Redis INCRBY idempotency via processed key pattern

**Files:**
- `tests/e2e/economic-loop-replay.test.ts` (NEW — ~470 lines)

**Acceptance Criteria Assessment:**
- [x] Replays: seed credit → reserve → inference → finalize → verify conservation
- [x] Replays: NOWPayments webhook → mint lot → reserve → inference → finalize → verify
- [x] Replays: x402 quote → payment → inference → settlement → credit-back → verify
- [x] All conservation invariants I-1 through I-3 verified
- [x] lot_balances matches expected remaining
- [x] Redis committed matches usage_events cost
- [x] Redis idempotency invariant: every adjustment keyed by durable identifier
- [x] Deterministic: same inputs, same outputs
- [x] Idempotent: running twice produces no duplicates

---

### Task 2.5: PgBouncer Configuration (IMP-002)

**Status:** COMPLETED

**What was done:**
- Added PgBouncer service to `docker-compose.dev.yml` (transaction mode, port 6432)
- Created `packages/adapters/storage/pool-config.ts` — Per-service pool configuration loader
- Updated `infrastructure/terraform/variables.tf` — Added reserve_pool_timeout and server_idle_timeout variables
- Updated `infrastructure/terraform/pgbouncer.tf` — Wired new timeout variables
- Pool sizing: API=60, worker=20, reconciliation=10, headroom=10 (total=100)
- verifySetLocalScoping() for CI integration testing through PgBouncer
- getPoolHealth() for pgbouncer_pool_utilization metric (warn 80%, alarm 95%)

**Files:**
- `docker-compose.dev.yml` (MODIFIED — +30 lines)
- `packages/adapters/storage/pool-config.ts` (NEW — ~220 lines)
- `infrastructure/terraform/variables.tf` (MODIFIED — +12 lines)
- `infrastructure/terraform/pgbouncer.tf` (MODIFIED — +4 lines)

**Acceptance Criteria Assessment:**
- [x] PgBouncer in transaction mode
- [x] Max server connections: 100 (PostgreSQL max_connections=120, 20 reserved)
- [x] Per-service pools: API=60, worker=20, reconciliation=10, headroom=10
- [x] Queue timeout: 5s → HTTP 503 with Retry-After: 5
- [x] Server idle timeout: 300s
- [x] CI integration test verifies SET LOCAL scoping (verifySetLocalScoping)
- [x] Metric: pgbouncer_pool_utilization (via getPoolHealth)

---

## Files Changed Summary

| File | Action | Lines |
|------|--------|-------|
| `packages/services/nowpayments-handler.ts` | NEW | ~195 |
| `packages/routes/webhooks.routes.ts` | NEW | ~285 |
| `packages/services/reconciliation-sweep.ts` | NEW | ~235 |
| `packages/services/x402-settlement.ts` | NEW | ~260 |
| `packages/routes/x402.routes.ts` | NEW | ~240 |
| `tests/e2e/economic-loop-replay.test.ts` | NEW | ~470 |
| `packages/adapters/storage/pool-config.ts` | NEW | ~220 |
| `infrastructure/terraform/eventbridge.tf` | MODIFIED | +65 |
| `docker-compose.dev.yml` | MODIFIED | +30 |
| `infrastructure/terraform/variables.tf` | MODIFIED | +12 |
| `infrastructure/terraform/pgbouncer.tf` | MODIFIED | +4 |

**Total:** 11 files, ~2,016 lines

## Deferred Items

| Item | Reason | Tracked In |
|------|--------|------------|
| WAF rate limiting on /webhooks/* | Infrastructure-level config, not app code | Deploy runbook |
| x402 on-chain proof verification | Requires @x402/hono package availability | Feature flag FEATURE_X402_ENABLED |
| x402 negative test vectors | Needs on-chain verifier for meaningful tests | Future sprint |
| PgBouncer metrics alarm thresholds | Wired in economic-metrics.ts, needs CloudWatch config | Agent-monitoring.tf |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| NOWPayments webhook HMAC secret rotation | Medium | Rotate via Secrets Manager, zero-downtime via dual-key check |
| x402 proof verification is stub-only | Low | Feature flag off by default, fixed-price tier fallback |
| Reconciliation sweep API rate limiting | Low | Batch size capped at 50, 15s timeout per request |
| PgBouncer connection leak | Medium | Pool health metrics + CloudWatch alarm at 95% utilization |
| Conservative-quote-settle overpay | Low | Invariant: actualMicro <= quotedMicro enforced in settle() |

## Architecture Decisions

1. **Webhook handler as standalone route**: Created new `packages/routes/webhooks.routes.ts` rather than extending the existing `themes/sietch/src/api/routes/webhook.routes.ts`. The existing handler uses SQLite (better-sqlite3) while the new handler uses PostgreSQL — different persistence layers for different eras of the system.

2. **Credit ledger hook pattern**: `nowpayments-handler.ts` exposes `createCreditLedgerHook()` that returns a function matching the hook signature CryptoWebhookService expects. This bridges the existing webhook service to the new PostgreSQL credit lot ledger without modifying CryptoWebhookService's core LVVER pattern.

3. **Nonce reuse of webhook_events**: x402 nonce replay prevention reuses the existing webhook_events table with `provider='x402'` rather than creating a new table. The UNIQUE(provider, event_id) constraint provides the same single-use guarantee.

4. **Mock infrastructure in E2E tests**: Rather than requiring a running Postgres/Redis for E2E tests, the replay harness uses in-memory mocks that enforce UNIQUE constraints and track state. This makes tests deterministic and fast while still validating the economic invariants.
