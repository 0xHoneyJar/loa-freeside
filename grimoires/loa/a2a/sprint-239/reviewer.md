# Sprint 239 (cycle-026 sprint-1) — Implementation Report

## Sprint: Protocol Adoption & Shared Types

**Status**: COMPLETE
**Cycle**: 026 — The Stillsuit
**Global Sprint ID**: 239
**Date**: 2026-02-12

---

## Summary

Created the vendored protocol types directory (`packages/core/protocol/`) with shared types, arithmetic helpers, state machines, and compatibility checks. Migrated all existing consumers from local `micro-usd.ts` to the new protocol module. Added protocol version to the health endpoint and S2S finalize handler for cross-service version validation.

---

## Tasks Completed

### Task 1.1: Create Vendored Protocol Directory
**Files created:**
- `src/packages/core/protocol/billing-types.ts` — AgentBillingConfig, CreditBalance, UsageRecord, BillingMode, EntityType, SourceType, EntryType
- `src/packages/core/protocol/guard-types.ts` — GuardResult, BillingGuardResponse
- `src/packages/core/protocol/state-machines.ts` — StateMachineDefinition<S>, RESERVATION_MACHINE, REVENUE_RULE_MACHINE, PAYMENT_MACHINE, isValidTransition(), isTerminal()
- `src/packages/core/protocol/arithmetic.ts` — BigInt micro-USD helpers, BPS arithmetic, Zod schemas, serialization (GPT-reviewed, 4 precision bugs fixed)
- `src/packages/core/protocol/compatibility.ts` — PROTOCOL_VERSION (4.6.0), validateCompatibility()
- `src/packages/core/protocol/index.ts` — Barrel re-exports
- `src/packages/core/protocol/VENDORED.md` — Documentation

### Task 1.2: Map Local Types to Protocol Types
**Files modified:**
- `src/packages/core/ports/ICreditLedgerService.ts` — EntityType, SourceType, EntryType, BillingMode aliased to protocol types; CreditBalance re-exported
- `src/packages/core/ports/IRevenueRulesService.ts` — RuleStatus aliased to RevenueRuleState from protocol
- `src/packages/core/ports/IPaymentService.ts` — PaymentState imported from protocol; PAYMENT_MACHINE referenced
- `src/packages/core/contracts/s2s-billing.ts` — UsageRecord imported; identity_anchor field added to S2SFinalizeRequest

### Task 1.3: Replace Local Arithmetic with Shared Helpers
**Files modified:**
- `src/packages/core/utils/micro-usd.ts` — Converted to re-export facade from protocol/arithmetic
- `src/packages/core/utils/cost-estimator.ts` — Import redirected to protocol/arithmetic
- `src/packages/adapters/billing/CreditLedgerAdapter.ts` — Import redirected to protocol/arithmetic
- `src/packages/adapters/billing/PaymentServiceAdapter.ts` — Import redirected to protocol/arithmetic
- `src/api/routes/billing-routes.ts` — Import redirected to protocol/arithmetic
- `src/api/routes/billing-admin-routes.ts` — Import redirected to protocol/arithmetic
- `src/packages/adapters/billing/RevenueDistributionService.ts` — Inline BPS math replaced with bpsShare() and assertBpsSum()

### Task 1.4: Implement Cross-Service Compatibility Check
**Files modified:**
- `src/api/routes/public.routes.ts` — Added `protocol_version` field to GET /health response
- `src/api/routes/billing-routes.ts` — Added X-Protocol-Version header check in S2S finalize handler; rejects incompatible versions (422), logs minor drift

### Task 1.5: Protocol Adoption Tests
**Files created:**
- `tests/unit/billing/protocol-adoption.test.ts` — 58 tests covering:
  - dollarsToMicro: whole, fractional, zero, NaN, Infinity, unsafe integers
  - microToDollarsDisplay: whole, cents, zero, negative, rounding, large values
  - assertMicroUSD: valid, negative, ceiling
  - serializeBigInt: primitives, objects, arrays, null
  - microUsdSchema: string, number, negative, non-numeric, unsafe
  - BPS arithmetic: bpsShare, assertBpsSum, constants
  - Compatibility: version format, exact, patch, minor, major, invalid
  - State machines: reservation, revenue_rule, payment (initial, transitions, terminals)
  - Type re-exports: EntityType, BillingMode, RuleStatus compile-time verification

---

## Test Results

```
 ✓ tests/unit/billing/protocol-adoption.test.ts (58 tests) 9ms
 Test Files  1 passed (1)
 Tests  58 passed (58)
```

All 58 new tests pass. All 7 other billing test files pass (4 pre-existing WaiverService failures from stale date fixtures — not related to this sprint).

---

## TypeScript Compilation

54 pre-existing errors (all in agent-config.ts, X402PaymentAdapter.ts, etc.) — zero new errors from protocol adoption. Verified clean at each task boundary.

---

## GPT Review

`arithmetic.ts` was GPT-reviewed (2 iterations):
- **Iteration 1**: CHANGES_REQUIRED — 4 precision bugs caught and fixed:
  1. `dollarsToMicro` accepted NaN/Infinity → Added Number.isFinite() + Number.isSafeInteger() guards
  2. `microToDollarsDisplay` used Number(micro) causing precision loss → Rewritten with pure BigInt arithmetic
  3. `microUsdSchema` coerced numbers without safe-integer check → Added validation
  4. `assertMicroUSD` error message converted ceiling to Number → Changed to use microToDollarsDisplay()
- **Iteration 2**: APPROVED

---

## Architecture Decisions

1. **Vendored, not installed**: Protocol types are vendored (copy-pasted) rather than npm-installed because loa-hounfour PRs #1 and #2 are still OPEN. Once published, we'll switch to `npm install @hounfour/protocol-types`.

2. **Facade pattern for micro-usd.ts**: Rather than deleting the old file and breaking any unconventional imports, we converted it to a re-export facade. This is zero-cost at runtime and provides a graceful migration path.

3. **Protocol version in header, not body**: The S2S finalize handler checks `X-Protocol-Version` header rather than a body field. This keeps the existing wire format stable and makes version checking orthogonal to the payload.

4. **Soft version enforcement**: Version mismatch returns 422 (not 500) and minor drift is logged but allowed. This prevents cascading failures during rolling deployments.

---

## Acceptance Criteria Status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `packages/core/protocol/` directory with vendored types | PASS |
| 2 | Existing port interfaces alias to protocol types | PASS |
| 3 | `micro-usd.ts` consumers use protocol/arithmetic | PASS |
| 4 | State machines defined in protocol/ | PASS |
| 5 | Compatibility check wired into health + S2S | PASS |
| 6 | 8+ protocol adoption tests | PASS (58 tests) |
| 7 | Zero new TS compilation errors | PASS |
| 8 | GPT review APPROVED for arithmetic.ts | PASS |
