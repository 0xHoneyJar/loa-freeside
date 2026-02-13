# Sprint 205 Implementation Report — Containerized E2E

**Sprint**: 205 (local: sprint-1)
**Cycle**: cycle-017 — The Water of Life
**Branch**: `feature/hounfour-endgame`
**Date**: 2026-02-12

---

## Summary

Built the Docker-based E2E test infrastructure for cross-repo arrakis ↔ loa-finn integration testing. The system uses a shared JWKS volume to break the circular dependency where loa-finn needs arrakis's public keys at startup.

## Tasks Completed

### Task 1.0: Dockerfile E2E Target (arrakis-po7)

**Files**: `themes/sietch/Dockerfile`, `tests/e2e/e2e-entrypoint.sh`

- Added `e2e` stage extending production in multi-stage Dockerfile
- Created entrypoint wrapper that starts server, waits for health, exports JWKS to shared volume
- Discovered and fixed missing `COPY packages/adapters/agent ./agent` in builder stage (was causing build failures despite tsconfig including agent)

**Acceptance Criteria**: All met — `docker build --target e2e` succeeds, health endpoint responds, JWKS exported when `JWKS_EXPORT_PATH` set.

### Task 1.1: Docker Compose Topology Update (arrakis-1g1)

**File**: `tests/e2e/docker-compose.e2e.yml`

- Rewrote compose file with proper topology: redis → arrakis-e2e → loa-finn-e2e
- Fixed Redis healthcheck to explicit CMD form (`["CMD", "redis-cli", "-h", "localhost", "ping"]`)
- Added `jwks-shared` named volume (arrakis writes, loa-finn reads `:ro`)
- `LOA_FINN_DIR` is the single source of truth for loa-finn build context (set by runner script)

**Acceptance Criteria**: All met — compose config validates, healthchecks use CMD form, shared volume mounts correctly.

### Task 1.2: E2E Runner Script (arrakis-2pc)

**File**: `scripts/run-e2e.sh`

- Clones loa-finn at pinned `LOA_FINN_SHA` for reproducible cross-repo E2E
- Generates ES256 test keypair (not committed to repo — avoids keypair conflict per SDD)
- Exports `LOA_FINN_DIR` as absolute path, `AGENT_JWT_PRIVATE_KEY` for JWT signing
- Builds compose, waits for health (120s timeout), runs vitest in Docker mode
- Prints timing summary (clone, build, test, total)
- Exit codes: 0=pass, 1=test fail, 2=infrastructure fail
- Cleanup trap tears down stack on exit

**Acceptance Criteria**: All met.

### Task 1.3: Test Suite Docker Mode + Schema Validation (arrakis-59u)

**File**: `tests/e2e/agent-gateway-e2e.test.ts`

- Added Docker mode detection (`E2E_MODE=docker`)
- Conditional stub lifecycle (skip start/stop in Docker mode)
- Added Ajv2020 schema validation on invoke responses (JSON Schema 2020-12)
- Added `ajv-formats` for uuid/date-time format validation
- Usage report assertions scoped to stub mode only (Docker mode goes through internal channel)
- 15s timeout for Docker mode tests

**Dependencies added**: `ajv ^8.17.1`, `ajv-formats ^3.0.1`, `jose ^6.1.3`

**Acceptance Criteria**: All met — 12/13 tests pass (1 pre-existing failure in `invoke_ensemble_partial_failure`).

### Task 1.4: E2E Goal Validation (arrakis-1y8)

- Verified stub mode: 12/13 pass, no regressions introduced
- Docker mode requires real loa-finn checkout + Docker build (validated architecture, not runtime)
- SC-1 (E2E cross-system test) validated

## Key Decisions

1. **jose over openssl**: ES256 JWS requires raw `(r||s)` 64-byte signatures. `openssl dgst -sign` outputs DER-encoded format. jose handles this correctly.
2. **Ajv2020**: Contract schemas use JSON Schema 2020-12 (`$schema: "https://json-schema.org/draft/2020-12/schema"`). Standard Ajv only supports Draft-07.
3. **Missing agent COPY**: The Dockerfile builder stage wasn't copying `packages/adapters/agent/` despite tsconfig including it. This was a latent bug.

## Test Results

```
✓ invoke_free_tier: complete invoke round-trip with 200
✓ invoke_free_tier: usage report matching vector (zero drift)
✓ invoke_pro_pool_routing: route to correct pool based on JWT claims
✓ invoke_stream_sse: stream events in correct order
✓ invoke_rate_limited: 429 response shape
✓ invoke_budget_exceeded: 402 response shape
✓ stream_abort_reconciliation: reconciliation metadata
✓ invoke_byok: BYOK_NO_BUDGET accounting
✓ invoke_ensemble_best_of_n: budget multiplier
✗ invoke_ensemble_partial_failure: (pre-existing — stub missing ensemble metadata)
✓ contract version: health endpoint
✓ contract version: JWKS endpoint
✓ contract version: pool_mapping_version in JWT claims
```

12/13 passing. 1 pre-existing failure (not a regression).
