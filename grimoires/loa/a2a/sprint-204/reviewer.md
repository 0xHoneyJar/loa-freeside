# Sprint 2 (Global 204): Infrastructure, Contract & Observability Hardening — Implementation Report

## Summary

Sprint 2 addresses 5 findings from the Bridgebuilder Round 3 review of PR #52: Network Firewall alarm coverage (BB3-3), contract schema cleanup (BB3-4), BYOK feature gate (BB3-5), ensemble budget assertion (BB3-6), and V8 heap threat model documentation (BB3-7).

## Tasks Completed

| Task | Title | Bead | Status |
|------|-------|------|--------|
| 2.1 | Fix Network Firewall alarm to cover all AZs | arrakis-1ie | CLOSED |
| 2.2 | Remove unsupported providers from contract schema | arrakis-1q4 | CLOSED |
| 2.3 | Add BYOK feature gate to admin routes | arrakis-2ak | CLOSED |
| 2.4 | Add ensemble budget runtime assertion | arrakis-1mh | CLOSED |
| 2.5 | Document V8 heap string limitation in threat model | arrakis-1ad | CLOSED |

## Key Changes

### BB3-3: Network Firewall Per-AZ Alarm Fix

**Root Cause**: AWS Network Firewall emits `DroppedPackets` metrics per-AZ, unlike ALB which aggregates. The original alarm only monitored a single AZ, meaning SSRF attempts from other AZs would go undetected.

**Fix**:
- Replaced single-AZ metric with dynamic `metric_query` blocks iterating over `var.availability_zones`
- Added metric math expression: `SUM(az_us_east_1a + az_us_east_1b + ...)` across all AZs
- `return_data = true` on the total expression so the alarm triggers on aggregate drops

### BB3-4: Contract Schema Cleanup

**Root Cause**: `loa-finn-contract.json` listed `"google"` in `byok_provider` enum and `"generate"` in `byok_operation` enum, but neither is supported in the codebase.

**Fix**:
- Removed `"google"` from `byok_provider` enum → `["openai", "anthropic"]`
- Removed `"generate"` from `byok_operation` enum → `["chat_completions", "messages"]`

### BB3-5: BYOK Feature Gate

**Root Cause**: BYOK admin routes had no kill switch. If BYOK needed to be disabled (security incident, billing issue), the only option was a deployment.

**Fix**:
- Added `byokEnabled?: boolean` to `BYOKRoutesDeps` interface
- When `byokEnabled === false`, a middleware returns `404 BYOK_DISABLED` for all routes
- Early return prevents any route handler execution when disabled
- 2 new tests: gate blocks all 4 endpoints, default (undefined) allows requests

### BB3-6: Ensemble Budget Runtime Assertion

**Root Cause**: `checkBudgetDrift()` logged warnings for general drift but had no ensemble-specific assertion. The invariant `committed ≤ reserved (= N × base estimate)` was enforced by loa-finn's `max_cost_micro_cents` ceiling but never asserted at the arrakis finalization layer.

**Fix**:
- Added optional `opts.ensembleN` parameter to `checkBudgetDrift()`
- When ensemble is active and `actualCost > estimatedCostCents`, emits `ENSEMBLE_BUDGET_OVERRUN` error alarm
- Updated both `invoke()` and `stream()` call sites to pass `ensembleResult?.jwtClaims?.ensemble_n`
- 4 new invariant tests: reserved = N × base, actual ≤ reserved on full success, actual ≤ reserved on partial failure, overrun detection

### BB3-7: V8 Heap Threat Model Documentation

**Root Cause**: `Buffer.from(apiKey)` in route handlers doesn't prevent V8 from interning the original JSON string in heap memory. This is an accepted risk but was undocumented.

**Fix**: Created `grimoires/loa/deployment/byok-threat-model.md` covering:
- V8 heap string interning limitation (accepted risk with rationale)
- SSRF defense-in-depth (application + network layers)
- Quota bypass mitigation (atomic INCR pattern)
- Current mitigations table (9 layers)
- Future hardening options (Rust sidecar, direct-to-KMS, Nitro Enclaves)

## Files Modified

| File | Changes |
|------|---------|
| `infrastructure/terraform/byok-security.tf` | Dynamic metric_query + SUM expression for per-AZ alarm |
| `tests/e2e/contracts/schema/loa-finn-contract.json` | Removed google/generate from enums |
| `themes/sietch/src/api/routes/admin/byok.routes.ts` | Added byokEnabled gate middleware |
| `packages/adapters/agent/agent-gateway.ts` | Added ENSEMBLE_BUDGET_OVERRUN assertion to checkBudgetDrift |

## Files Created

| File | Purpose |
|------|---------|
| `grimoires/loa/deployment/byok-threat-model.md` | BYOK threat model documenting accepted risks |

## Test Results

- 15 BYOK fixes tests (11 existing + 4 new ensemble): ALL PASS
- 15 agent metrics tests: ALL PASS (regression)
- 28 BYOK proxy handler tests: ALL PASS (regression)
- 23 BYOK manager tests: ALL PASS (regression)
- 9 BYOK routes tests (7 existing + 2 new feature gate): ALL PASS (regression)
- **Total: 90 tests, 0 failures**
