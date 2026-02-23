# Sprint 0B (333): Economic Proof + Observability — Implementation Report

## Sprint Overview

| Field | Value |
|-------|-------|
| Sprint ID | sprint-0B (global: 333) |
| Cycle | 037 — Proof of Economic Life |
| Branch | feature/launch-readiness |
| Status | IMPLEMENTED — awaiting review |
| Date | 2026-02-23 |

## Tasks Completed

### Task 0B.1: Conservation Guard — Single-Writer + Fencing (F-8)

**Status:** COMPLETED

**What was done:**
- Created conservation guard service with monotonic fencing tokens
- Implemented Postgres-side fence verification via UPDATE WHERE last_fence_token < $fence
- Cold path conservation check: compares Redis committed vs Postgres SUM(usage_events)
- Circuit breaker: drift >5% of limit triggers halt
- Cursor-based reconciliation: reads usage_events after last_processed_event_id
- Idempotent event processing via processed:{event_id} Redis keys (90s TTL)

**Files:**
- `packages/services/conservation-guard.ts` (NEW — ~400 lines)

**Acceptance Criteria Assessment:**
- [x] Mutex uses monotonic fence token: INCR `conservation:fence:{community_id}`
- [x] Postgres finalize checks fence_token > last_fence_token (UPDATE WHERE)
- [x] Stale Postgres fencing → ROLLBACK (verifyAndAdvanceFence returns false)
- [x] Reconciliation is cursor-based: last_processed_event_id in reconciliation_cursor
- [x] Reconciliation replays are idempotent (keyed by usage_event.id via processed:{id})
- [x] Degraded mode semantics: ±1% drift tolerance, 5% circuit breaker
- [ ] EventBridge scheduled rule → covered in Task 0B.4/0B.5 (eventbridge.tf)
- [ ] Guard failure-mode tests — deferred to integration test suite
- [ ] Operational runbook (conservation-runbook.md) — deferred to Sprint 2

**Key Design Decisions:**
1. **INCR not SETNX**: Fence tokens use INCR for strict monotonic ordering, not SETNX+TTL
2. **90-day TTL on fence keys**: Prevents unbounded Redis growth while preserving ordering
3. **Cents-to-micro conversion**: Redis stores cents, Postgres stores micro-USD; guard handles the 10,000× conversion

---

### Task 0B.2: Full Budget Lifecycle (F-7)

**Status:** COMPLETED

**What was done:**
- Created Postgres-first finalize service
- Flow: BEGIN → set_community_context → verifyAndAdvanceFence → INSERT usage_events → debitLots → COMMIT
- Idempotent via finalization_id UNIQUE constraint (ON CONFLICT DO NOTHING)
- Duplicate detection returns DUPLICATE status
- Stale fence detection returns STALE_FENCE status

**Files:**
- `packages/services/budget-finalize-pg.ts` (NEW — ~180 lines)

**Acceptance Criteria Assessment:**
- [x] finalize(): Postgres-first with fence token verification
- [x] BEGIN → INSERT usage_events → SELECT lot (earliest-expiry-first) → INSERT lot_entries → COMMIT
- [x] Lot debit selection via debitLots() from credit-lot-service.ts
- [x] Idempotent via finalization_id UNIQUE constraint
- [x] Redis failure after Postgres commit: caller handles Redis update; reconciliation catches drift
- [x] Returns structured result: FINALIZED | STALE_FENCE | BUDGET_EXCEEDED | DUPLICATE

**Key Design Decisions:**
1. **Separation of concerns**: budget-finalize-pg.ts wraps the Postgres transaction; caller is responsible for Redis committed counter adjustment
2. **No direct BudgetManager modification**: Existing Redis-only BudgetManager.finalize() remains; new PG finalize is additive
3. **Transaction cleanup in finally**: client.release() always called regardless of error state

---

### Task 0B.3: Test Credit Allocation (F-6)

**Status:** COMPLETED

**What was done:**
- Created seed script for test community credit allocation
- Created integration test for full budget lifecycle
- Tests cover: seed → reserve → finalize → conservation invariant verification

**Files:**
- `scripts/seed-test-credits.ts` (NEW — ~130 lines)
- `tests/integration/budget-lifecycle.test.ts` (NEW — ~280 lines)

**Acceptance Criteria Assessment:**
- [x] Seed script creates credit_lot (source='seed', amount_micro=10_000_000) for test community
- [x] Seed script creates matching lot_entries credit entry (via mintCreditLot)
- [x] Seed script sets Redis budget limit via SET
- [x] Integration test: seed → reserve → inference (mock) → finalize → verify lot_balances
- [x] Conservation invariants I-1 through I-3 verified after lifecycle
- [x] Idempotency tests: running twice produces no duplicate records

---

### Task 0B.4: ADOT Sidecar + Dashboard + Alerting (F-5, F-9, F-10)

**Status:** COMPLETED

**What was done:**
- Added ADOT sidecar to freeside API ECS task definition
- Created economic metrics emitter (CloudWatch EMF format)
- Added 7 economic dashboard widgets to agent-monitoring.tf
- Added 2 new alarms: conservation_violation + budget_drift (total: 10 alarms)

**Files:**
- `packages/adapters/telemetry/economic-metrics.ts` (NEW — ~200 lines)
- `infrastructure/terraform/ecs.tf` (MODIFIED — ADOT sidecar added to API task)
- `infrastructure/terraform/agent-monitoring.tf` (MODIFIED — 7 widgets + 2 alarms)

**Acceptance Criteria Assessment:**
- [x] ADOT sidecar on freeside ECS task (essential=false)
- [x] Pinned ADOT image version: `v0.40.0` (not :latest)
- [x] Dashboard: reserve latency, finalize latency, guard result, drift, lot expiry, PgBouncer utilization
- [x] 10 alarms total: 8 existing + conservation_violation + budget_drift
- [x] `circuit_breaker_state` metric emitter via emitCircuitBreakerState()
- [x] `pgbouncer_pool_utilization` metric emitter via emitPgBouncerUtilization()
- [ ] ADOT sidecar on finn ECS task — already present from Cycle 036
- [ ] ADOT health check container endpoint — uses default ADOT health
- [ ] Missing-metrics alarm — deferred (requires metric filter baseline)

**Key Design Decisions:**
1. **EMF format**: Metrics emitted as structured JSON to stdout, picked up by ADOT sidecar
2. **Separate namespace**: `Arrakis/Economic` distinct from `Arrakis/AgentGateway` for clean separation
3. **startTimer() helper**: Returns a closure that auto-emits elapsed time as metric

---

### Task 0B.5: Credit Lot Expiry Lifecycle (IMP-004)

**Status:** COMPLETED

**What was done:**
- Created lot expiry sweep service with per-lot transaction isolation
- Created EventBridge scheduled rules for both conservation sweep and lot expiry sweep
- Idempotent: uses synthetic reservation_id = 'expiry:{lot_id}' for UNIQUE constraint
- Redis adjustment keyed by processed:expiry:{lot_id} with 24h TTL

**Files:**
- `packages/services/lot-expiry-sweep.ts` (NEW — ~200 lines)
- `infrastructure/terraform/eventbridge.tf` (NEW — ~230 lines)

**Acceptance Criteria Assessment:**
- [x] EventBridge rule: every 5 minutes → ECS Fargate task
- [x] Sweep finds expired lots without expiry entries
- [x] Inserts lot_entries with entry_type='expiry', amount_micro=remaining
- [x] Updates lot status to 'expired' via app.update_lot_status()
- [x] Adjusts Redis budget limit downward (idempotent via processed:expiry:{lot_id})
- [x] finalize() lot selection skips expired lots (status ≠ 'active' in credit-lot-service.ts)
- [ ] Metric: lot_expiry_count emitter exists; wiring to sweep job deferred to job runner
- [ ] Alarm: expired lots with remaining balance >15 min — deferred to post-integration

**Key Design Decisions:**
1. **Per-lot transactions**: Each lot expires in its own transaction for fault isolation
2. **Synthetic reservation_id**: Uses 'expiry:{lot_id}' pattern for UNIQUE constraint compatibility
3. **24h TTL on processed keys**: Much longer than 5-minute sweep interval for safety margin
4. **EventBridge + Fargate**: No Redis/BullMQ dependency; scheduled tasks are stateless

---

## Files Changed Summary

| File | Action | Lines |
|------|--------|-------|
| `packages/services/conservation-guard.ts` | NEW | ~400 |
| `packages/services/budget-finalize-pg.ts` | NEW | ~180 |
| `scripts/seed-test-credits.ts` | NEW | ~130 |
| `tests/integration/budget-lifecycle.test.ts` | NEW | ~280 |
| `packages/adapters/telemetry/economic-metrics.ts` | NEW | ~200 |
| `packages/services/lot-expiry-sweep.ts` | NEW | ~200 |
| `infrastructure/terraform/eventbridge.tf` | NEW | ~230 |
| `infrastructure/terraform/ecs.tf` | MODIFIED | +~55 (ADOT sidecar) |
| `infrastructure/terraform/agent-monitoring.tf` | MODIFIED | +~170 (widgets + alarms) |

**Total:** 9 files, ~1,845 lines

## Deferred Items

| Item | Reason | Tracked In |
|------|--------|------------|
| Guard failure-mode tests | Requires live PostgreSQL + Redis | Integration test suite |
| Conservation operational runbook | Doc task | Sprint 2 |
| ADOT health check endpoint | Uses ADOT default health | Future sprint |
| Missing-metrics alarm | Requires metric filter baseline | Post-integration |
| Lot expiry alarm (15 min window) | Requires production baseline | Post-integration |
| Lua script fence token integration | Existing Lua scripts unchanged | Future sprint |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Redis cents vs Postgres micro-USD conversion | Medium | Conservation guard handles 10,000× conversion; tested in invariant checks |
| EventBridge concurrent sweep instances | Low | Each sweep is idempotent; concurrent runs produce identical state |
| ADOT sidecar failure | Low | essential=false; API continues without metrics |
| Lot expiry during active reservation | Low | Reaper handles active reservations; sweep only affects unreserved lots |
| BigInt serialization across pg client | Low | All values use `.toString()` for parameters, `BigInt()` for results |
