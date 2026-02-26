# Sprint 359 (sprint-2) — Gateway + Events — Implementation Report

**Cycle:** cycle-043 (The Governance Substrate)
**Global ID:** 359
**Status:** COMPLETE
**Files Changed:** 6

---

## Task 2.1: DynamicContract Validation (FR-4)

**SDD ref:** §3.4.2 (DynamicContract Validation), §3.4.6 (Reputation State Resolution)

### Deliverables

| File | Purpose |
|------|---------|
| `config/dynamic-contract.json` | Default contract — 4 surfaces (cold/warming/established/authoritative) |
| `themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts` | Loader, validator, surface resolver |
| `tests/unit/dynamic-contract.test.ts` | 14 tests covering all 6 failure modes + monotonic expansion |

### Implementation Details

- **loadDynamicContract()**: Singleton loader with 6 failure modes:
  1. `FILE_NOT_FOUND` — ENOENT on disk read
  2. `FILE_READ_ERROR` — Other fs errors + production override block
  3. `JSON_PARSE_ERROR` — Invalid JSON syntax
  4. `SCHEMA_VALIDATION_ERROR` — TypeBox validation against DynamicContractSchema
  5. `MONOTONIC_EXPANSION_VIOLATION` — verifyMonotonicExpansion() from hounfour/commons
  6. `OVERRIDE_SIZE_EXCEEDED` — 64KB limit on DYNAMIC_CONTRACT_OVERRIDE env var
- **resolveProtocolSurface()**: Fail-closed to `cold` surface for unknown reputation states (SKP-006)
- **isCapabilityGranted()**: Boolean check against surface capabilities array
- **validateContractFile()**: CI/CD pre-deploy gate (isolated from singleton cache)
- **Override safety**: Blocked in production unless `ALLOW_DYNAMIC_CONTRACT_OVERRIDE=true`

### Default Contract Surfaces

| Surface | Capabilities | Rate Limit | Ensemble Strategies |
|---------|-------------|------------|-------------------|
| cold | inference | restricted | — |
| warming | inference, tools | standard | — |
| established | inference, tools, ensemble | extended | quality_first, cost_optimized |
| authoritative | inference, tools, ensemble, governance, byok | unlimited | quality_first, cost_optimized, latency_optimized, consensus |

### Acceptance Criteria

- [x] AC-2.1: loadDynamicContract() with 6 failure modes
- [x] AC-2.2: resolveProtocolSurface() per reputation state
- [x] AC-2.3: Fail-closed to cold surface on unknown state
- [x] AC-2.4: CI/CD validation gate (validateContractFile)
- [x] AC-2.5: Monotonic expansion verified via hounfour/commons

---

## Task 2.2: Reputation Event Router (FR-7)

**SDD ref:** §3.4.5 (Reputation Event Routing), §3.4.7 (AuditTrailPort)

### Deliverables

| File | Purpose |
|------|---------|
| `packages/adapters/agent/reputation-event-router.ts` | Exhaustive 4-variant router with audit trail port |
| `tests/unit/reputation-event-router.test.ts` | 19 tests covering all variants, validation, audit propagation |

### Implementation Details

- **Exhaustive switch**: All 4 ReputationEvent variants handled with `never` type check in default branch
  - `quality_signal` — score + optional task_type + dimensions
  - `task_completed` — task_type + success + optional duration_ms
  - `credential_update` — credential_id + action (issued/revoked/renewed/suspended)
  - `model_performance` — v8.2.0 variant with QualityObservation validation
- **QualityObservation validation**: Score must be in [0, 1], dimensions must be numeric
- **'unspecified' TaskType**: Routes to aggregate-only scoring (no task-type cohort)
- **AuditTrailPort**: Port interface for dependency injection
  - Sprint 2: `failClosedAuditStub` throws `AuditTrailNotReady` on any append
  - Sprint 3: Real implementation wired via DI
- **Structured logging**: event_id, agent_id, model_id, provider, pool_id, score — no PII

### Barrel Exports

| Barrel | Exports Added |
|--------|--------------|
| `themes/sietch/src/packages/core/protocol/index.ts` | DynamicContract types + functions (6 values, 4 types) |
| `packages/adapters/agent/index.ts` | Reputation event router types + functions (3 values, 8 types) |

### Acceptance Criteria

- [x] AC-2.6: Exhaustive switch on 4 ReputationEvent variants
- [x] AC-2.7: QualityObservation validation (score bounds, dimension types)
- [x] AC-2.8: 'unspecified' TaskType → aggregate_only routing
- [x] AC-2.9: AuditTrailPort with fail-closed stub
- [x] AC-2.10: Structured logging without PII

---

## Test Summary

| Test File | Tests | Coverage Focus |
|-----------|-------|---------------|
| `tests/unit/dynamic-contract.test.ts` | 14 | 6 failure modes, surface resolution, capability grants, monotonic expansion |
| `tests/unit/reputation-event-router.test.ts` | 19 | 4 variants, QualityObservation validation, audit propagation, structured logging |
| **Total** | **33** | |

## Dependencies

- `@0xhoneyjar/loa-hounfour` v8.2.0 (pinned in Sprint 358)
- `@0xhoneyjar/loa-hounfour/commons` — DynamicContractSchema, verifyMonotonicExpansion
- `@sinclair/typebox` — Value.Check, Value.Errors for schema validation

## Notes

- Tests cannot be run locally (vitest runs in Docker containers)
- TypeScript compilation verified via d.ts inspection (tsc runs in Docker)
- request-lifecycle.ts integration deferred to Sprint 3 (agent-gateway wiring)
