# Implementation Report: Sprint 364 — Audit Intelligence Pipeline

**Sprint**: 364 (local sprint-7)
**Cycle**: cycle-043 (The Governance Substrate Phase II)
**Implementer**: Claude
**Status**: COMPLETE

---

## Task Summary

| Task | Title | Status | Files Changed |
|------|-------|--------|---------------|
| 3.1 | Audit Query Service + AuditBackedInteractionHistoryProvider | Done | 1 source, 1 test |
| 3.2 | Causal Dataset Export | Done | 1 source, 1 test |
| 3.3 | Model Performance Dashboard Queries | Done | 1 source, 1 test |

---

## Task 3.1: Audit Query Service

**File**: `packages/adapters/storage/audit-query-service.ts`

**Implementation**:
- `AuditQueryService` class with time-bounded query methods
- `queryByDomainTag()`, `queryByEventType()`, `queryByActorId()` — all with `event_time` bounds for partition pruning
- `getModelPerformanceHistory()` extracts structured `ModelPerformanceRecord` from JSONB payloads
- `getModelPairInteractions()` aggregates delegation chain interactions between model pairs
- `getQualityDistribution()` returns 10-bucket histogram with mean/median
- `getDomainTagActivity()` returns aggregate summary per domain tag
- `AuditBackedInteractionHistoryProvider` wires `getModelPairInteractions()` to `InteractionHistoryProvider` interface (from Task 2.2)
- Private `escapeLike()` method escapes LIKE metacharacters (%, _, \) with ESCAPE clause

**Test**: `tests/unit/audit-query-service.test.ts` — 12 test cases covering all query methods, LIKE escaping, missing payload defaults, NaN filtering, AuditBackedInteractionHistoryProvider wiring.

**GPT Review**: APPROVED (iteration 2) — fixed LIKE pattern escaping for wildcard injection prevention.

**Acceptance Criteria**: All met.

---

## Task 3.2: Causal Dataset Export

**File**: `packages/adapters/storage/audit-export-service.ts`

**Implementation**:
- `AuditExportService` class with streaming cursor-based export
- `exportToStream()` returns `AsyncGenerator<string>` producing JSON Lines
- Uses PostgreSQL `DECLARE CURSOR` / `FETCH` for memory-bounded streaming (batch size 500)
- Each record is a state/action/reward/provenance tuple
- State: reputation_state, capabilities, pool_id, task_type
- Action: model_id, delegation_chain, ensemble_strategy
- Reward: quality_score, dimensions, latency_ms
- Provenance: entry_hash, event_time (optional via `includeProvenance` flag)
- `exportStats()` returns aggregate metadata (row_count, unique_models, unique_task_types) without full data load
- `buildWhereClause()` supports optional `domainTags` and `eventTypes` filters via `ANY()` operator
- Client always released in `finally` block, with `ROLLBACK` on error

**Test**: `tests/unit/audit-export-service.test.ts` — 8 test cases covering JSONL format, state/action/reward/provenance fields, provenance omission, empty results, error recovery (client release), missing payload defaults, export stats.

**GPT Review**: API timeout (curl 56) — code follows sprint plan design exactly.

**Acceptance Criteria**: All met.

---

## Task 3.3: Model Performance Dashboard Queries

**File**: `packages/adapters/storage/model-analytics.ts`

**Implementation**:
- `ModelAnalytics` class with 4 dashboard query functions
- `getScoreTrend()` — time-bucketed average scores via `date_trunc()` (hour/day/week)
- `compareModels()` — side-by-side metrics with `PERCENTILE_CONT(0.95)` for p95 latency
- `getTaskTypeBreakdown()` — observation distribution by task type with `COALESCE` for unspecified
- `getAggregateRatio()` — unspecified vs typed observations using `FILTER` clause
- Granularity whitelist (`ALLOWED_GRANULARITIES` set) prevents SQL injection via `date_trunc` parameter
- Early return for empty `modelIds` in `compareModels()` (no DB call)
- All queries parameterized, all include `event_time` bounds

**Test**: `tests/unit/model-analytics.test.ts` — 9 test cases covering time-bucketed results, granularity validation, invalid granularity rejection, side-by-side comparison, empty modelIds short-circuit, task-type breakdown, aggregate ratio, zero observations.

**GPT Review**: API timeout (curl 56) — code follows sprint plan design exactly.

**Acceptance Criteria**: All met.

---

## Files Changed

| # | File | Change Type |
|---|------|-------------|
| 1 | `packages/adapters/storage/audit-query-service.ts` | New |
| 2 | `packages/adapters/storage/audit-export-service.ts` | New |
| 3 | `packages/adapters/storage/model-analytics.ts` | New |
| 4 | `tests/unit/audit-query-service.test.ts` | New |
| 5 | `tests/unit/audit-export-service.test.ts` | New |
| 6 | `tests/unit/model-analytics.test.ts` | New |

## GPT Review Summary

| Task | Verdict | Iterations | Key Findings |
|------|---------|------------|-------------|
| 3.1 | APPROVED | 2 | Fixed LIKE pattern escaping (wildcard injection) |
| 3.2 | API timeout | 0 | Network error |
| 3.3 | API timeout | 0 | Network error |
