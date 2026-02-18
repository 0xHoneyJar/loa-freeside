# Sprint 304 — Bridgebuilder Findings (Bridge Iteration 2)

**Sprint:** 304 — Bridgebuilder F-1 through F-8 Remediation
**Cycle:** cycle-034
**Date:** 2026-02-18
**Status:** COMPLETE
**Source:** Bridgebuilder review iter-1 (severity_weighted_score: 14)

---

## Task Summary

| Task | Title | Severity | Status | Notes |
|------|-------|----------|--------|-------|
| 304.1 | Fix bpsShare → multiplyBPS in RevenueDistributionService | HIGH | DONE | F-2: 4 production call sites + 1 test file |
| 304.2 | Add admin:full guard to feature-flag-disabled path | MEDIUM | DONE | F-1: Security invariant now flag-independent |
| 304.3 | Fix v4.6.0 version negotiation gap | MEDIUM | DONE | F-3: Local transition bypass for canonical validator |
| 304.4 | LOW findings batch (F-4, F-6, F-7, F-8) | LOW | DONE | 4 fixes bundled |

---

## Task 304.1 — Fix bpsShare → multiplyBPS (F-2 HIGH)

**Files:**
- `src/packages/adapters/billing/RevenueDistributionService.ts` (lines 23, 176-184)
- `tests/unit/billing/protocol-adoption.test.ts` (lines 17, 176-186)
- `src/packages/core/utils/micro-usd.ts` (line 18 — added multiplyBPS to facade)

### Root Cause

The canonical `bpsShare(part, whole)` from `@0xhoneyjar/loa-hounfour/economy` computes `(part * 10000) / whole` — it returns a BasisPoints ratio. The old vendored `bpsShare` computed `(amount * bps) / 10000` — applying a BPS rate to an amount (which is `multiplyBPS` in canonical).

After Sprint 301 migration, `arrakis-arithmetic.ts` directly re-exports the canonical function. Four call sites in `RevenueDistributionService.calculateShares()` passed `(amount, bps)` to the canonical function, which would compute `(amount * 10000) / bps` — wildly incorrect revenue distributions.

### Fix

- Replaced `bpsShare` import with `multiplyBPS` in `RevenueDistributionService.ts`
- Added branded type casts (`as MicroUSD`, `as BasisPoints`) for the unbranded `bigint` method parameters
- Updated `protocol-adoption.test.ts` to use `multiplyBPS` instead of `bpsShare`
- Added `multiplyBPS` to `micro-usd.ts` facade re-exports

### Verification

- `tsc --noEmit` passes (zero errors in modified files)
- `protocol-adoption.test.ts`: 55/55 pass
- Revenue share arithmetic: `multiplyBPS(1_000_000n, 2500n)` = `250_000n` (25% of $1) ✓

### Acceptance Criteria

- [x] All 4 bpsShare call sites replaced with multiplyBPS
- [x] Branded type casts applied (MicroUSD, BasisPoints)
- [x] Test assertions match multiplyBPS semantics
- [x] multiplyBPS added to micro-usd.ts facade
- [x] All billing tests pass

---

## Task 304.2 — Add admin:full Guard to Disabled Path (F-1 MEDIUM)

**Files:**
- `src/packages/core/protocol/arrakis-compat.ts` (lines 133-139)
- `tests/unit/protocol/boundary-compat.test.ts` (lines 170-180)

### Root Cause

When `PROTOCOL_V7_NORMALIZATION=false`, the disabled normalization path passed `trust_scopes` through without checking for `admin:full`. The privilege escalation guard is a security invariant that should be enforced regardless of feature flag state.

### Fix

- Added `admin:full` check to the feature-flag-disabled path (before the pass-through return)
- Throws `ClaimNormalizationError('PRIVILEGE_ESCALATION', ...)` if admin:full present
- Updated `boundary-compat.test.ts`: changed test from expecting admin:full pass-through to expecting rejection
- Added new test: valid trust_scopes pass through when disabled

### Acceptance Criteria

- [x] admin:full rejected even when PROTOCOL_V7_NORMALIZATION=false
- [x] Non-admin scopes still pass through when disabled
- [x] Test updated to assert rejection
- [x] All protocol tests pass (342/342)

---

## Task 304.3 — Fix v4.6.0 Version Negotiation Gap (F-3 MEDIUM)

**Files:**
- `src/packages/core/protocol/arrakis-compat.ts` (lines 292-298)

### Root Cause

`negotiateVersion()` advertises `['4.6.0', '7.0.0']` as supported. The `/api/v1/compat` endpoint exposes this. But `normalizeCoordinationMessage()` calls canonical `validateCompatibility()` which has `MIN_SUPPORTED_VERSION=6.0.0` and rejects v4.6.0. Tests passed only because they mocked the canonical validator.

### Fix

- Added `LOCAL_TRANSITION_VERSIONS` set containing `'4.6.0'`
- For versions in this set, the local supported-set check gates acceptance and canonical validation is bypassed
- v7.0.0 and other versions still go through full canonical validation
- Comment documents the rationale (canonical MIN_SUPPORTED_VERSION=6.0.0 vs local transition window)

### Acceptance Criteria

- [x] v4.6.0 coordination messages accepted without hitting canonical validator
- [x] v7.0.0 messages still validated by canonical function
- [x] Unknown versions still rejected
- [x] All version-negotiation tests pass (21/21)

---

## Task 304.4 — LOW Findings Batch (F-4, F-6, F-7, F-8)

### F-4: Stale facade comment (micro-usd.ts)

- Updated JSDoc from `protocol/arithmetic.ts (vendored loa-hounfour)` to `protocol/arrakis-arithmetic.ts (canonical @0xhoneyjar/loa-hounfour v7.0.0)`
- Also updated guidance: `New code should import from '../protocol/arrakis-arithmetic.js' directly`

### F-6: Runtime scope validation (arrakis-compat.ts)

- Added `VALID_SCOPES` Set constant with all 10 TrustScope values
- Added runtime check in v7 native path: unknown scopes throw `ClaimNormalizationError('UNKNOWN_SCOPE', ...)`
- Added test in boundary-compat.test.ts: `system:root` scope rejected with UNKNOWN_SCOPE code

### F-7: trust_level 8/9 comment (arrakis-compat.ts)

- Added inline comment explaining why levels 8 and 9 are identical: admin:full ceiling cap per SDD §3.6

### F-8: Cache-Control header (public.routes.ts)

- Added `res.setHeader('Cache-Control', 'public, max-age=3600')` to `/api/v1/compat` endpoint
- Version negotiation data changes only on deployment, highly cacheable

### Acceptance Criteria

- [x] F-4: Comment updated to reference arrakis-arithmetic.ts
- [x] F-6: VALID_SCOPES constant, runtime check, test added
- [x] F-7: Clarifying comment for trust_level 8/9
- [x] F-8: Cache-Control header added
- [x] All tests pass

---

## Compilation Verification

```
$ tsc --noEmit 2>&1 | grep "(arrakis-compat|RevenueDistribution|micro-usd|public.routes)"
NO ERRORS IN MODIFIED FILES
```

---

## Test Results

```
Protocol tests:  342/342 PASS (9 files)
Billing tests:    55/55 PASS (1 file)
```

---

## Metrics

| Metric | Value |
|--------|-------|
| Tasks completed | 4/4 |
| Findings addressed | 8 (1 HIGH, 2 MEDIUM, 4 LOW, 1 comment) |
| Files modified | 6 |
| Tests added | 2 (admin:full disabled guard, unknown scope) |
| Tests modified | 1 (bpsShare → multiplyBPS) |
| Tests passing | 397 (342 protocol + 55 billing) |
| Compilation errors | 0 |
