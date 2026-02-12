# Sprint Plan: Bridgebuilder Round 7 — Protocol Refinement

**Version**: 1.0.0
**Date**: February 12, 2026
**Cycle**: cycle-020
**Codename**: The Refinement
**Source**: Bridgebuilder Round 7 findings ([PR #55](https://github.com/0xHoneyJar/arrakis/pull/55))
**PRD**: `prd-hounfour-endgame.md` v1.2.0 (extended)
**SDD**: `sdd-hounfour-endgame.md` v1.2.0 (extended)
**RFC**: [0xHoneyJar/loa-finn#31](https://github.com/0xHoneyJar/loa-finn/issues/31)

---

## Overview

| Attribute | Value |
|-----------|-------|
| **Total Sprints** | 1 |
| **Sprint Timebox** | 1 day (solo AI-assisted) |
| **Developer** | Solo (AI-assisted) |
| **Repos** | arrakis (primary) |
| **Global Sprint IDs** | 213 |

### Context

PR #55 delivered The Capability Mesh (cycle-019): per-model ensemble accounting, contract protocol promotion, fleet-wide Redis circuit breaker, API key isolation boundary, token estimator calibration, and incremental fallback reservation. Bridgebuilder Round 7 reviewed that work and identified 3 critical refinements plus 3 praise items. This cycle implements the 3 critical findings.

### Goals

| ID | Goal | BB7 Finding | Metric |
|----|------|-------------|--------|
| G-1 | Redis sorted set failure tracking | R7-1 (Scalability) | `LUA_FAILURE` uses `ZREMRANGEBYSCORE`/`ZADD`/`ZCARD` instead of CSV parsing |
| G-2 | Runtime schema enforcement for audit events | R7-3 (Reliability) | Required fields validated before `log.info()` emission |
| G-3 | Data-driven compatibility matrix | R7-4 (Maintainability) | Matrix loaded from `compatibility.json`, not hardcoded in TS |

### Findings Not Addressed (Praise / Future)

| Finding | Type | Reason |
|---------|------|--------|
| R7-2: Request lifecycle state machine | Praise | No changes needed — future distributed tracing direction noted |
| R7-5: Fallback 1x budget optimization | Praise | No changes needed — budget invariant confirmed correct |
| R7-3 evolution: Branded types for API keys | Future | Deferred to Hounfour ensemble orchestrator (loa-finn#31) |
| R7-3 evolution: undici zero-copy path | Future | Tracked as enhancement, awaiting undici dependency addition |

### Definition of Done

1. All acceptance criteria marked as passing
2. No new lint/type errors introduced (`npx tsc --noEmit`)
3. Code committed to feature branch with sprint prefix
4. `/review-sprint` + `/audit-sprint` quality gates passed

---

## Sprint 1: Protocol Refinement (G-1, G-2, G-3)

**Global ID**: 213
**Goal**: Address all 3 critical Bridgebuilder Round 7 findings — scalable failure tracking, audit event validation, and data-driven compatibility.

### Tasks

#### Task 1.1: Migrate Circuit Breaker Failure Tracking from CSV to Sorted Sets

**Modified**: `packages/adapters/agent/redis-circuit-breaker.ts`

The `LUA_FAILURE` script currently stores failure timestamps as a comma-separated string in a Redis hash field. Every `onFailure()` call parses the entire CSV, filters by time window, and rebuilds the string — O(n) per call where n = failures in window.

**Fix**: Replace CSV-in-hash with Redis sorted sets (`ZREMRANGEBYSCORE` + `ZADD` + `ZCARD`):
```lua
-- Remove expired failures (trim window)
redis.call('ZREMRANGEBYSCORE', key..':failures', '-inf', nowMs - windowMs)
-- Add new failure timestamp as both score and member
redis.call('ZADD', key..':failures', nowMs, nowMs)
-- Count remaining failures in window
local count = redis.call('ZCARD', key..':failures')
```

O(log n) insert + O(log n) range trim instead of O(n) string parsing.

**Mixed-Fleet Deployment Strategy (Two-Phase)**:

**Phase A — Compatibility mode (during rolling deploy)**:
New Lua scripts write to BOTH the sorted set AND the legacy CSV hash field, and read/count from the sorted set:
- `LUA_FAILURE`: On each call, first check for CSV hash field `failures`. If present, parse timestamps, `ZADD` them into sorted set, then `HDEL` the CSV field (one-time migration per call). Then perform normal sorted set ops (`ZREMRANGEBYSCORE` + `ZADD` + `ZCARD`). Finally, write back a CSV representation to the hash field for old containers still reading it.
- `LUA_SUCCESS`: Clear both sorted set (`DEL key:failures`) and CSV hash field (`HDEL key failures`).
- **Result**: Old containers see new failures via CSV. New containers see old failures via CSV→ZSET migration. Fleet-wide failure count is consistent across both code versions.

**Phase B — Cleanup (after full rollout + 1 window duration)**:
Remove CSV write-back from Lua scripts in a follow-up PR. The hash field `failures` will be stale/empty at this point. This is a non-urgent cleanup — the dual-write overhead is ~1 extra `HSET` per failure.

**Changes**:
- Rewrite `LUA_FAILURE` to use sorted set operations on `key:failures` sorted set key
- Rewrite `LUA_SUCCESS` to clear sorted set with `DEL key:failures`
- Add cleanup: `LUA_FAILURE` checks for old hash field `failures` and deletes it if present (one-time)
- Update `LUA_CHECK` if it reads failure count (currently does not — no change needed)
- Update process-local fallback to match (already uses `number[]` array — no change)

**Acceptance Criteria**:
- [ ] AC-1.1: `LUA_FAILURE` uses `ZREMRANGEBYSCORE` + `ZADD` + `ZCARD` instead of CSV string manipulation
- [ ] AC-1.2: `LUA_SUCCESS` clears sorted set with `DEL key:failures`
- [ ] AC-1.3: Phase A dual-write: new `LUA_FAILURE` migrates CSV→ZSET on each call and writes back CSV for old readers
- [ ] AC-1.4: O(log n) complexity for failure recording (no string parsing)
- [ ] AC-1.5: Process-local fallback behavior unchanged (already uses `number[]`)
- [ ] AC-1.6: All existing circuit breaker tests pass without modification
- [ ] AC-1.7: Sorted set entries auto-expire via `ZREMRANGEBYSCORE` on each call (no TTL needed)
- [ ] AC-1.20: Mixed-fleet safety: dual-write ensures old+new containers observe consistent fleet failure counts during rolling deployment
- [ ] AC-1.23: Unit test: simulate old-writer (CSV only) + new-writer (dual-write) — breaker opens at same threshold as single-version behavior

#### Task 1.2: Add Runtime Schema Enforcement for Audit Events

**Modified**: `packages/adapters/agent/capability-audit.ts`

The `CapabilityAuditEvent` type is well-structured at compile time, but CloudWatch Log Metric Filters will silently drop events that don't match expected field names. There's no runtime validation between the TypeScript interface and the emitted JSON.

**Fix**: Add a lightweight required-fields guard before `this.log.info()`. Not full JSON Schema — just assert that the 4 critical fields (`trace_id`, `community_id`, `event_type`, `pool_id`) are non-empty strings.

**Changes**:
- Add private `validateRequiredFields()` method to `CapabilityAuditLogger`
- Call it at the top of `emit()` before the `log.info()` call
- On validation failure: log a warning (don't throw — audit events should not crash requests) and skip emission
- Add `audit_event_validation_failure` structured log for observability of the guard itself

**Acceptance Criteria**:
- [ ] AC-1.8: `emit()` validates `trace_id`, `community_id`, `event_type`, and `pool_id` are non-empty strings before emission
- [ ] AC-1.9: Missing required field → warning logged with field name, event skipped (not thrown)
- [ ] AC-1.10: `audit_event_validation_failure` structured log emitted on guard trigger
- [ ] AC-1.11: All existing audit event emission paths still work (no false positives)
- [ ] AC-1.12: Convenience methods (`emitPoolAccess`, `emitByokUsage`, `emitEnsembleInvocation`) pass validation (they always supply required fields)
- [ ] AC-1.21: Unit test: event with empty `trace_id` → `log.warn` called with `audit_event_validation_failure`, `log.info` NOT called
- [ ] AC-1.22: Unit test: valid event → `log.info` called with all required fields present in `audit` object, `log.warn` NOT called

#### Task 1.3: Make Compatibility Matrix Data-Driven

**Modified**: `packages/contracts/src/compatibility.ts`
**New File**: `packages/contracts/schema/compatibility.json`

The hardcoded `COMPATIBILITY_MATRIX` array in TypeScript works for 2 entries but won't scale. The contract package was promoted to a standalone protocol artifact (BB6 #2) specifically so it could evolve independently. Data that changes at a different cadence than code should live in a different file.

**Fix**: Move compatibility data to `packages/contracts/schema/compatibility.json`. Import as a TypeScript JSON module (no `readFileSync`). Validate required fields at load time.

**Changes**:
- Create `packages/contracts/schema/compatibility.json` with the current 2 entries
- Modify `compatibility.ts` to import JSON using TypeScript JSON module import (`import matrixData from '../schema/compatibility.json'` with `resolveJsonModule: true` in tsconfig). This avoids `readFileSync` path-resolution issues across ESM/CJS/bundlers and ensures the data is resolved at compile time.
- Add lightweight load-time validation: each entry must have `arrakis_version`, `loa_finn_version`, `contract_version`, `status`
- Export `COMPATIBILITY_MATRIX` as readonly for consumers that need direct access
- Ensure `packages/contracts/tsconfig.json` has `"resolveJsonModule": true` and `"esModuleInterop": true`
- Update `packages/contracts/package.json` to include `schema/` in `files` array (for `npm pack`)

**Acceptance Criteria**:
- [ ] AC-1.13: Compatibility data lives in `packages/contracts/schema/compatibility.json`
- [ ] AC-1.14: `compatibility.ts` loads data from JSON file at module init
- [ ] AC-1.15: Load-time validation: missing required fields → throw at startup (fail-fast)
- [ ] AC-1.16: JSON file included in `npm pack` output (via `files` array)
- [ ] AC-1.17: `getCompatibility()` and `validateContractCompatibility()` work identically with loaded data
- [ ] AC-1.18: All existing compatibility tests pass without modification
- [ ] AC-1.19: Adding a new compatibility entry requires editing only `compatibility.json` (no TypeScript source code changes)

---

## Dependency Graph

```
Task 1.1 (Sorted Sets)  ──┐
Task 1.2 (Audit Guard)  ──┼──→ Single commit: feat(sprint-1): BB7 protocol refinement
Task 1.3 (Data-Driven)  ──┘
```

All 3 tasks are independent — they modify different files with no cross-dependencies.

---

## Risk Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Mixed-fleet sorted set rollout splits failure counts | Low | High | Phase A dual-write: new code writes both ZSET + CSV and migrates CSV→ZSET on read — fleet-wide count stays consistent |
| Audit validation false positives block real events | Low | Medium | Guard logs warning + skips, never throws; unit tests verify both valid and invalid paths |
| JSON import not resolved in compiled output | Low | Medium | TypeScript `resolveJsonModule` compiles JSON inline; no runtime file I/O needed |
| JSON file not included in npm pack | Low | Low | Verified via `npm pack --dry-run` in acceptance criteria |

---

## FAANG Precedent Map

| Task | Pattern | Precedent |
|------|---------|-----------|
| Task 1.1 | Sorted set for time-windowed counting | Uber rate limiter (2018): ZADD for sliding window counters at 100M+ RPM |
| Task 1.2 | Runtime validation of audit events | AWS CloudTrail: validates event structure before emission; Google Cloud Audit Logs use protobuf schemas |
| Task 1.3 | Data-driven configuration | gRPC service config loaded from JSON; Kubernetes API server loads storage media types from configuration |

---

**Document Owner**: Hounfour Integration Team
**Review Cadence**: Per sprint completion
**Bridgebuilder Review**: Round 8 after implementation
