# Sprint 200 (Sprint 2): Ensemble Strategy Exposure — FR-3

**Cycle**: cycle-015 — The Last Spice (Hounfour Endgame)
**Global Sprint ID**: 200
**Local Sprint ID**: sprint-2
**Status**: COMPLETED
**Date**: 2026-02-11

## Summary

Sprint 2 exposes multi-model ensemble orchestration (best_of_n, consensus, fallback) to arrakis API consumers. All 4 tasks completed: ensemble mapper with partial failure reconciliation, gateway integration with budget multiplier, API route/JWT extension with feature flag, and E2E test scenarios including partial failure.

## Tasks Completed

### Task 2.1: Ensemble Mapper
**Bead**: `arrakis-1an` | **Status**: Closed

**New File**: `packages/adapters/agent/ensemble-mapper.ts`
- `EnsembleMapper.validate()` — tier gating, n/quorum clamping, budget multiplier calculation
- `EnsembleMapper.computePartialCost()` — partial failure reconciliation (SDD §3.3.2 IMP-008)
- Tier limits: free→blocked (400), pro→maxN=3/maxQuorum=3, enterprise→maxN=5/maxQuorum=5
- Budget multiplier = N for all strategies (worst-case reservation)
- Returns validated request + JWT claims object

**New File**: `tests/unit/ensemble-mapper.test.ts`
- 20 unit tests covering all acceptance criteria
- Tests for each strategy (best_of_n, consensus, fallback)
- Tier gating tests (free→400, pro→allowed, enterprise→allowed)
- n/quorum clamping tests (min=2, max per tier, default derivation)
- Budget multiplier tests (N for each strategy)
- Partial failure reconciliation tests (committed ≤ reserved invariant)
- Stream abort reconciliation tests

**AC Coverage**: AC-3.4 ✅, AC-3.6 ✅, AC-3.7 ✅, AC-3.8 ✅, AC-3.9 ✅, AC-3.10 ✅

### Task 2.2: AgentGateway Ensemble Integration
**Bead**: `arrakis-1zu` | **Status**: Closed

**Modified**: `packages/core/ports/agent-gateway.ts`
- Added `EnsembleStrategy` type, `EnsembleParams` interface
- Added `ensemble?: EnsembleParams` to `AgentInvokeRequest`

**Modified**: `packages/adapters/agent/agent-gateway.ts`
- Added `EnsembleMapper` import and instance
- Added `ensembleEnabled` flag (from deps, default: false)
- Added ensemble validation step (3b) between pool resolution and budget reservation in both `invoke()` and `stream()`
- Budget multiplier applied: `estimatedCostCents = baseCostCents * budgetMultiplier`
- Ensemble JWT claims passed through metadata
- `ENSEMBLE_DISABLED` error when feature flag is off

**AC Coverage**: AC-3.1 ✅, AC-3.3 ✅

### Task 2.3: API Route + JWT Extension
**Bead**: `arrakis-2gk` | **Status**: Closed

**Modified**: `packages/adapters/agent/config.ts`
- Added `ensembleRequestSchema` Zod schema (strategy enum, models array max=5, n/quorum int bounds)
- Added `ensemble` optional field to `agentInvokeRequestSchema`
- Added `ENSEMBLE_ENABLED` env var
- Added `ensembleEnabled: boolean` to `AgentGatewayConfig`
- Config loader reads `ENSEMBLE_ENABLED` (default: false)

**Modified**: `packages/adapters/agent/jwt-service.ts`
- Added `ensembleClaims` optional parameter to `sign()`
- Ensemble claims (ensemble_strategy, ensemble_n, ensemble_quorum, ensemble_models) spread into JWT payload
- Updated JSDoc to document new claims

**Modified**: `themes/sietch/src/api/routes/agents.routes.ts`
- Added `ENSEMBLE_DISABLED` and `ENSEMBLE_NOT_AVAILABLE` to safe messages map

**AC Coverage**: AC-3.2 ✅, AC-3.5 ✅ (circuit breaker handled by gateway error propagation)

### Task 2.4: Ensemble E2E Test Scenario
**Bead**: `arrakis-3r8` | **Status**: Closed

**Modified**: `tests/e2e/contracts/vectors/loa-finn-test-vectors.json`
- Added `invoke_ensemble_partial_failure` test vector
- Vector includes `ensemble_model_results` array with per-model succeeded/cost_micro

**Modified**: `tests/e2e/agent-gateway-e2e.test.ts`
- Added `invoke_ensemble_partial_failure` test scenario
- Validates: response has partial failure metadata, committed cost = sum of successful models, committed ≤ reserved
- Updated `getTestVectors()` to include new vector

**AC Coverage**: AC-3.11 ✅ (existing best_of_n E2E from Sprint 1), AC-3.12 ✅

## Files Changed

### New Files (2)
| File | Type |
|------|------|
| `packages/adapters/agent/ensemble-mapper.ts` | Ensemble validation |
| `tests/unit/ensemble-mapper.test.ts` | Unit tests (20 tests) |

### Modified Files (6)
| File | Change |
|------|--------|
| `packages/core/ports/agent-gateway.ts` | Added EnsembleStrategy, EnsembleParams, ensemble field |
| `packages/adapters/agent/agent-gateway.ts` | Ensemble validation step in invoke/stream, budget multiplier |
| `packages/adapters/agent/config.ts` | Ensemble Zod schema, ENSEMBLE_ENABLED config |
| `packages/adapters/agent/jwt-service.ts` | Ensemble JWT claims parameter |
| `themes/sietch/src/api/routes/agents.routes.ts` | Ensemble error safe messages |
| `tests/e2e/agent-gateway-e2e.test.ts` | Partial failure E2E scenario |
| `tests/e2e/contracts/vectors/loa-finn-test-vectors.json` | Partial failure test vector |

## GPT Review Results

| Target | Verdict | Iteration |
|--------|---------|-----------|
| Sprint 2 combined diff | SKIPPED (API network error, curl exit 56) | — |

## Design Decisions

1. **EnsembleMapper as separate class**: Keeps ensemble validation logic isolated from the gateway facade. The mapper is stateless and can be unit tested independently.

2. **Feature flag gating at gateway level**: `ENSEMBLE_ENABLED` is checked in the gateway (not at the route level) to ensure both invoke and stream paths are gated consistently. Default is false for safe rollout.

3. **Budget multiplier = N for all strategies**: Even fallback uses N as the multiplier (worst-case: all N models tried sequentially). This is conservative but prevents budget overruns. The excess is released on finalize.

4. **Partial failure reconciliation via `computePartialCost()`**: Domain method on the mapper rather than in the gateway. Keeps the committed ≤ reserved invariant explicit and testable.

5. **Ensemble claims as optional JWT parameter**: The `sign()` method accepts ensemble claims as an optional third parameter. This avoids polluting `AgentRequestContext` with ensemble data that's only relevant when ensemble is active.

## Risks & Notes

- GPT review skipped due to API network error (same as Sprint 1). Manual review verified correctness.
- Ensemble JWT claims are passed through metadata in the gateway but should be moved to direct JWT signing once loa-finn integration is complete.
- The `ensembleEnabled` flag defaults to false — requires explicit opt-in via `ENSEMBLE_ENABLED=true`.
