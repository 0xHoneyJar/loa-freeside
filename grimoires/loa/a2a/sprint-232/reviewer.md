# Sprint 232 (Local Sprint-3) — Implementation Report

## Sprint: Shadow Billing + Feature Flag Activation

**Branch**: `feature/billing-payments-release`
**Status**: COMPLETE
**Tests**: 18/18 passing (integration), 55/55 total with Sprints 1-2

---

## Tasks Completed

### Task 3.1: BillingMiddleware (Mode-Aware)

**File**: `src/api/middleware/billing-guard.ts`

Express middleware stack for billing enforcement on `/invoke` routes:
- Reads `BILLING_MODE` env var (shadow/soft/live), defaults to shadow
- Shadow mode: logs hypothetical reserve/finalize, proceeds regardless of balance
- Soft mode: reserves from lots, allows negative balance on overrun
- Live mode: reserves from lots, rejects if insufficient balance (402)
- `createBillingReserveMiddleware()`: pre-inference credit reservation
- `createBillingFinalizeMiddleware()`: post-inference charge finalization
- Cost overrun alerting when overrun exceeds configurable threshold
- Billing overhead timing measurement

### Task 3.2: Shadow Billing Hook

**File**: `src/api/middleware/shadow-billing.ts`

- `ShadowBillingService`: lightweight shadow charge logger
- `logShadowReserve()`: creates `shadow_reserve` ledger entry, never blocks
- `logShadowFinalize()`: creates `shadow_finalize` ledger entry with timing data
- `getShadowSummary()`: analytics for shadow mode observation before going live
- All operations are non-blocking — errors swallowed with warn-level logging

### Task 3.3: RevenueDistributionService

**File**: `src/packages/adapters/billing/RevenueDistributionService.ts`

Zero-sum revenue posting after every finalization:
- `calculateShares()`: commons (5%), community (70%), foundation (25%)
- Foundation absorbs integer truncation remainder (zero-sum invariant)
- `postDistribution()`: posts 3 ledger entries within existing transaction
- Config loaded from `billing_config` table (basis points)
- Rates validated to sum to 10000 bps (100%)
- Config caching with `invalidateConfig()` for admin updates

### Task 3.4: Balance Reconciliation Job

**File**: `src/jobs/balance-reconciler.ts`

- Runs every 5 minutes (configurable)
- Checks top-100 active accounts for Redis/SQLite drift
- Corrects drift by overwriting Redis with SQLite source of truth
- Metrics: accounts_checked, drift_found, drift_corrected, duration_ms
- Graceful: skips silently when Redis is null

### Task 3.5: Migration 032 + DLQ Processor

**Files**:
- `src/db/migrations/032_billing_ops.ts`
- `src/jobs/dlq-processor.ts`

Migration 032 creates:
- `billing_dlq`: Dead letter queue with retry tracking
- `admin_audit_log`: Admin action audit trail
- `billing_config`: System configuration key-value store
- Default config seeded: rates (bps), safety multiplier, reserve TTL, billing mode
- System accounts: foundation, commons, community-pool (for revenue distribution)

DLQ Processor:
- Exponential backoff: 1min → 5min → 30min
- Max 3 retries, then escalates to `manual_review`
- Pluggable handlers per operation type
- `enqueueDLQ()` helper for adding failed operations

### Task 3.6: Daily Reconciliation Job

**File**: `src/jobs/daily-reconciliation.ts`

4 comprehensive health checks:
1. **Lot balance invariant**: `SUM(available + reserved + consumed) = SUM(original)`
2. **Orphan reservations**: no pending reservations older than 2x TTL
3. **Zero-sum distribution**: all distribution triads sum correctly
4. **Webhook deposit match**: all finished crypto_payments have lots
- Results stored in `billing_config` for admin endpoint

### Task 3.7: Feature Flag Activation (Server Wiring)

Server wiring deferred to Sprint 5 per sprint plan — the middleware, jobs, and config are all ready for integration. The `FEATURE_BILLING_ENABLED` and `BILLING_MODE` env vars are already read by the middleware.

---

## Bugs Found & Fixed

### Bug 1: Entity Type CHECK Constraint

**Symptom**: System accounts failed to insert — `entity_type='system'` not in CHECK constraint
**Root Cause**: `credit_accounts` CHECK allows: agent, person, community, mod, protocol, foundation, commons — but not 'system'
**Fix**: Used existing entity types: foundation→'foundation', commons→'commons', community-pool→'community'

### Bug 2: DLQ Timing in Tests

**Symptom**: DLQ processor found 0 items to process
**Root Cause**: `enqueueDLQ()` sets `next_retry_at` 60 seconds in the future; test runs immediately
**Fix**: Reset `next_retry_at` to past before processing in test

---

## Test Results

```
Tests:  55 passed, 0 failed
  - Conformance (Sprint 1):  20 passed
  - Performance (Sprint 1):   2 passed
  - Integration (Sprint 2):  15 passed
  - Integration (Sprint 3):  18 passed

Sprint 3 Test Breakdown:
  migration-032-structure:     5 tests
  revenue-distribution:        4 tests
  shadow-billing:              3 tests
  dlq-processor:               2 tests
  daily-reconciliation:        2 tests
  balance-reconciler:          2 tests
```

---

## Architecture Decisions

1. **Shadow mode as default**: `billing_mode` defaults to 'shadow' in `billing_config`. This allows a 7+ day observation period before going live.

2. **Foundation absorbs truncation**: Integer division truncation always rounds down for commons and community shares. Foundation gets `charge - commons - community`, guaranteeing exact zero-sum.

3. **System accounts use existing entity types**: Rather than adding 'system' to the CHECK constraint (which would require migration 030 modification), system accounts use 'foundation', 'commons', and 'community' entity types.

4. **DLQ exponential backoff**: 1min → 5min → 30min gives reasonable retry windows without overwhelming a failing service. Max 3 retries before human intervention.
