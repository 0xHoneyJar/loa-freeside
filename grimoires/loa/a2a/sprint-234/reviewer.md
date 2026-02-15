# Sprint 234 (Local Sprint-5) — Implementation Report

## Sprint: S2S + Dashboard Endpoints

**Branch**: `feature/billing-payments-release`
**Status**: COMPLETE
**Tests**: 14/14 passing (integration), 80/80 total with Sprints 1-4

---

## Tasks Completed

### Task 5.1: S2S Finalize Endpoint

**File**: `src/api/routes/billing-routes.ts` (extended)

- `POST /api/internal/billing/finalize` — accepts `reservationId` + `actualCostMicro`
- Internal JWT auth: HS256 with `BILLING_INTERNAL_JWT_SECRET`
  - Issuer validation: `loa-finn`
  - Audience validation: `arrakis-internal`
  - Clock skew tolerance: 30s
- S2S rate limiter: 200/min per service ID
- Idempotent on reservation_id (via ledger finalize idempotency)
- Returns: finalizedMicro, releasedMicro, overrunMicro, billingMode, finalizedAt
- BigInt-as-string JSON responses via `serializeBigInt()`
- Error mapping: 404 (not found), 409 (conflict/invalid state), 500 (internal)

### Task 5.2: Billing Dashboard Data Endpoints

**File**: `src/api/routes/billing-routes.ts` (extended)

**GET /api/billing/balance**
- Returns caller's credit balance across pools
- Requires auth (`requireAuth` middleware)
- Optional `poolId` query parameter for pool filtering
- BigInt-as-string serialization

**GET /api/billing/history**
- Paginated ledger entries with filters
- Query parameters: `poolId`, `entryType`, `limit` (1-100, default 50), `offset`
- Zod validation on query parameters
- Returns entries array with pagination metadata

**GET /api/billing/pricing**
- Public endpoint (no auth required, feature flag only)
- Loads rate config from `billing_config` table
- Falls back to default pricing if DB unavailable
- Returns pools, rates, tiers, and current billing mode

**New service initialization**:
- `setCreditBillingLedgerService()` — injects ledger service and DB for dashboard + S2S
- `getLedgerService()` — accessor with null check

### Task 5.3: Operational Runbook

**File**: `grimoires/loa/deployment/billing-runbook.md`

- Migration procedure (backup, apply, verify, rollback)
- Feature flag progression (shadow → soft → live) with checklist
- Monitoring alerts (critical + warning thresholds)
- Incident response for billing failures, lot invariant violations, double-credits
- Redis cache reset procedure (full + per-account)
- NOWPayments webhook retry handling and manual replay
- S2S finalize troubleshooting guide
- Key environment variables reference

---

## Test Results

```
Tests:  80 passed, 0 failed
  - Conformance (Sprint 1):  20 passed
  - Performance (Sprint 1):   2 passed
  - Integration (Sprint 2):  15 passed
  - Integration (Sprint 3):  18 passed
  - Integration (Sprint 4):  11 passed
  - Integration (Sprint 5):  14 passed

Sprint 5 Test Breakdown:
  s2s-finalize:              3 tests
  internal-jwt-auth:         2 tests
  balance-endpoint:          3 tests
  history-endpoint:          3 tests
  pricing-endpoint:          2 tests
  bigint-serialization:      1 test
```

---

## Architecture Decisions

1. **Internal JWT separate from admin JWT**: S2S uses `BILLING_INTERNAL_JWT_SECRET` with `iss=loa-finn, aud=arrakis-internal`. Admin uses `BILLING_ADMIN_JWT_SECRET` with `aud=arrakis-billing-admin`. Prevents service tokens from accessing admin endpoints and vice versa.

2. **S2S rate limit 200/min**: Higher than admin (30/min) because loa-finn sends one finalize per inference call. 200/min supports ~3.3 QPS sustained.

3. **Pricing from billing_config**: Dynamic pricing loaded from the same config table used by billing operations. No separate config system needed. Falls back to hardcoded defaults if DB unavailable.

4. **History pagination via offset/limit**: Simple pagination suitable for dashboard use. No cursor-based pagination needed at current scale.

---

## Bugs Found & Fixed

1. **History ordering test**: Initial test assumed sub-second ordering between two `mintLot()` calls at the same `sqliteNow()` timestamp. Fixed test to verify entry presence rather than strict ordering when timestamps are identical.
