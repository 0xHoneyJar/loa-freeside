# Sprint 1 (Global 203): Critical Correctness Fixes — Implementation Report

## Summary

Sprint 1 fixes two correctness bugs identified in the Bridgebuilder Round 3 review of PR #52: BYOK provider inference (BB3-1) and BYOK quota race condition (BB3-2).

## Tasks Completed

| Task | Title | Bead | Status |
|------|-------|------|--------|
| 1.1 | Fix BYOK provider inference | arrakis-2ni | CLOSED |
| 1.2 | Fix BYOK quota atomicity | arrakis-32f | CLOSED |
| 1.3 | Update BYOK test vectors | arrakis-2gi | CLOSED |

## Key Changes

### BB3-1: BYOK Provider Inference Fix

**Root Cause**: `poolId.startsWith('anthropic')` at `agent-gateway.ts:164,341` always evaluated to false because pool IDs are `cheap`, `fast-code`, `reviewer`, `reasoning`, `architect` — none start with "anthropic".

**Fix**:
- Added `POOL_PROVIDER_HINT` mapping to `pool-mapping.ts` — centralized pool→provider association
- Added `resolveByokProvider()` method to `AgentGateway` — checks hint first, then falls back to scanning all providers
- Both `invoke()` and `stream()` now use the new resolution

### BB3-2: BYOK Quota Atomicity Fix

**Root Cause**: `checkByokQuota()` used GET-then-compare with a separate INCR, allowing concurrent requests to all read the same count and bypass the quota.

**Fix**:
- Replaced GET+compare+separate-INCR with atomic `INCR` → compare returned value
- Added `EXPIRE 86400` on first increment (TTL for daily counter)
- Removed separate `redis.incr()` calls from `invoke()` and `stream()` — increment now happens inside `checkByokQuota()`

## Files Modified

| File | Changes |
|------|---------|
| `packages/adapters/agent/pool-mapping.ts` | Added `POOL_PROVIDER_HINT` mapping |
| `packages/adapters/agent/agent-gateway.ts` | New `resolveByokProvider()`, atomic `checkByokQuota()`, updated both `invoke()` and `stream()` |

## Files Created

| File | Purpose |
|------|---------|
| `tests/unit/agent-gateway-byok-fixes.test.ts` | 11 tests for provider hint mapping and atomic quota pattern |

## Test Results

- 11 new BYOK fixes tests: ALL PASS
- 15 agent metrics tests: ALL PASS (regression)
- 28 BYOK proxy handler tests: ALL PASS (regression)
- 23 BYOK manager tests: ALL PASS (regression)
- 7 BYOK routes tests: ALL PASS (regression)
- **Total: 84 tests, 0 failures**
