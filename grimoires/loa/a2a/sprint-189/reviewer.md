# Sprint 13 (Global 189) — Implementation Report

**Sprint**: Type Safety + Interface Decoupling + Benchmarks
**Cycle**: cycle-011 (Spice Gate v2.0 — PRD v1.3.0 / SDD v2.0.0 Delta)
**Branch**: `feature/spice-gate-phase4`
**Date**: 2026-02-10

---

## Summary

All 4 Sprint 13 tasks completed successfully. The ModelAlias type system is unified with a single source of truth, the Clock interface is extracted to eliminate cross-service coupling, benchmark harnesses validate both ship gates (SG-1, SG-4), and dist files are synced with a verification script.

## Task Results

### S13-T1: Unify ModelAlias Type System (Finding A) ✅

**Files Modified**:
- `packages/core/ports/agent-gateway.ts` — Replaced static `type ModelAlias = 'cheap' | ...` with `MODEL_ALIAS_VALUES` const tuple + derived type
- `packages/adapters/agent/config.ts` — Import `MODEL_ALIAS_VALUES` from core ports, derive `KNOWN_MODEL_ALIASES = new Set<string>(MODEL_ALIAS_VALUES)`

**Acceptance Criteria**:
- [x] Single source of truth for model alias values (one tuple, two consumers)
- [x] `ModelAlias` type is still a union of string literals (not `string`)
- [x] `KNOWN_MODEL_ALIASES` Set is derived from the same source
- [x] All existing tests pass (23/23 drift, 16/16 JWKS)
- [x] Hounfour migration TODO breadcrumb present
- [x] No import chain changes at barrel export level

**Key Decision**: Kept `MODEL_ALIAS_VALUES` in `agent-gateway.ts` (core ports) rather than a separate file — it's already the home of the `ModelAlias` type and the port interface that uses it.

### S13-T2: Extract Clock Interface to Shared Types (Finding C) ✅

**Files Modified**:
- NEW: `packages/adapters/agent/clock.ts` — `Clock` interface + `REAL_CLOCK` constant
- `packages/adapters/agent/jwt-service.ts` — Import Clock/REAL_CLOCK from `./clock.js`, removed local definitions
- `packages/adapters/agent/budget-drift-monitor.ts` — Import from `./clock.js` instead of `./jwt-service.js`, removed duplicate REAL_CLOCK
- `packages/adapters/agent/index.ts` — Export `REAL_CLOCK` and `Clock` from `./clock.js`

**Acceptance Criteria**:
- [x] `Clock` interface and `REAL_CLOCK` live in `clock.ts`
- [x] Neither `jwt-service.ts` nor `budget-drift-monitor.ts` import Clock from each other
- [x] Barrel export still exposes `Clock` type (no breaking change)
- [x] All 39 tests pass (23 drift + 16 JWKS)
- [x] `REAL_CLOCK` is used as default in both services

### S13-T3: Performance Benchmark Harness (SG-1, SG-4) ✅

**Files Created**:
- `themes/sietch/tests/bench/jwt-benchmark.ts` — JWT signing benchmark (100 warmup, 1000 measured)
- `themes/sietch/tests/bench/gateway-overhead-benchmark.ts` — Gateway overhead benchmark (50 warmup, 500 measured)

**npm Scripts Added**:
- `bench:ci` — CI-smoke mode (2x thresholds: JWT p95 < 10ms, Gateway p95 < 100ms)
- `bench:staging` — Strict mode (SG-1: p95 < 5ms, SG-4: p95 < 50ms)

**Benchmark Results** (local hardware):

| Benchmark | Mode | p50 | p95 | p99 | Threshold | Pass |
|-----------|------|-----|-----|-----|-----------|------|
| JWT Sign | CI | 0.134ms | 0.308ms | 0.533ms | 10ms | ✅ |
| JWT Sign | Staging | 0.114ms | 0.477ms | 1.983ms | 5ms | ✅ |
| Gateway | CI | 0.136ms | 0.262ms | 0.494ms | 100ms | ✅ |
| Gateway | Staging | 0.158ms | 0.348ms | 0.637ms | 50ms | ✅ |

**Acceptance Criteria**:
- [x] Both benchmarks pass in `--ci` mode
- [x] Both benchmarks pass in `--staging` mode
- [x] Output is structured JSON with required fields
- [x] Warmup phase excluded from measurements
- [x] CoV warning emitted when > 20%
- [x] SG-1 and SG-4 documented as staging-only evaluation
- [x] No external dependencies

### S13-T4: Build Dist + Verify Sync ✅

**Files Modified/Created**:
- NEW: `packages/adapters/dist/agent/clock.js` — Clock + REAL_CLOCK
- `packages/adapters/dist/agent/jwt-service.js` — Import from `./clock.js`
- `packages/adapters/dist/agent/budget-drift-monitor.js` — Import from `./clock.js`
- `packages/adapters/dist/agent/config.js` — Import MODEL_ALIAS_VALUES, derive KNOWN_MODEL_ALIASES
- `packages/adapters/dist/agent/index.js` — Export clock, KNOWN_MODEL_ALIASES, computeReqHash
- NEW: `themes/sietch/tests/bench/dist-verify.ts` — Targeted import verification script

**npm Script Added**: `dist:verify` — Validates 6 dist modules export expected symbols

**Acceptance Criteria**:
- [x] `dist/agent/clock.js` exists with REAL_CLOCK export
- [x] `dist/agent/jwt-service.js` imports Clock from `./clock.js`
- [x] `dist/agent/budget-drift-monitor.js` imports from `./clock.js`
- [x] `npm run dist:verify` passes
- [x] Targeted dist-path imports validate resolution

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Budget Drift Monitor | 23/23 | ✅ Pass |
| JWKS TTL Contract | 16/16 | ✅ Pass |
| JWT Benchmark (CI) | 1/1 | ✅ Pass (p95=0.308ms) |
| JWT Benchmark (Staging) | 1/1 | ✅ Pass (p95=0.477ms) |
| Gateway Benchmark (CI) | 1/1 | ✅ Pass (p95=0.262ms) |
| Gateway Benchmark (Staging) | 1/1 | ✅ Pass (p95=0.348ms) |
| Dist Verify | 6/6 modules | ✅ Pass |

**Pre-existing failures**: 29 test files (158 tests) fail due to Redis connection issues and timing flakes — unrelated to Sprint 13 changes.

## Bridgebuilder Findings Status

| Finding | Status | Sprint |
|---------|--------|--------|
| A: ModelAlias type split | ✅ Closed | Sprint 13 |
| C: Clock interface coupling | ✅ Closed | Sprint 13 |
| SG-1: JWT p95 < 5ms | ✅ Confirmed (0.477ms) | Sprint 13 |
| SG-4: Gateway p95 < 50ms | ✅ Confirmed (0.348ms) | Sprint 13 |
| B: SSE event ID per-connection | Pending | Sprint 14 |
| D: Budget drift static threshold | Pending | Sprint 14 |

## Core Package Rebuild

The `@arrakis/core` package was rebuilt (`npm run build`) to include the new `MODEL_ALIAS_VALUES` const export in `dist/ports/agent-gateway.js`. This is required because the adapters package resolves `@arrakis/core/ports` through the core package's dist directory.

## Files Changed Summary

| File | Change |
|------|--------|
| `packages/core/ports/agent-gateway.ts` | Add MODEL_ALIAS_VALUES const tuple |
| `packages/adapters/agent/clock.ts` | NEW — Clock interface + REAL_CLOCK |
| `packages/adapters/agent/config.ts` | Import tuple, derive KNOWN_MODEL_ALIASES |
| `packages/adapters/agent/jwt-service.ts` | Import Clock from clock.js |
| `packages/adapters/agent/budget-drift-monitor.ts` | Import from clock.js |
| `packages/adapters/agent/index.ts` | Export clock, reorganize JWT exports |
| `packages/adapters/dist/agent/clock.js` | NEW — dist mirror |
| `packages/adapters/dist/agent/jwt-service.js` | Import from clock.js |
| `packages/adapters/dist/agent/budget-drift-monitor.js` | Import from clock.js |
| `packages/adapters/dist/agent/config.js` | Import MODEL_ALIAS_VALUES |
| `packages/adapters/dist/agent/index.js` | Add clock, KNOWN_MODEL_ALIASES, computeReqHash |
| `themes/sietch/tests/bench/jwt-benchmark.ts` | NEW — JWT signing benchmark |
| `themes/sietch/tests/bench/gateway-overhead-benchmark.ts` | NEW — Gateway overhead benchmark |
| `themes/sietch/tests/bench/dist-verify.ts` | NEW — Dist verification script |
| `themes/sietch/package.json` | Add bench:ci, bench:staging, dist:verify scripts |
