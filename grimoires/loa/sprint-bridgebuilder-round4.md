# Sprint Plan: Bridgebuilder Round 4 — PR #53 Review Findings

**Version**: 1.0.0
**Date**: February 12, 2026
**Cycle**: cycle-018
**PRD**: `grimoires/loa/prd-hounfour-finish-line.md`
**SDD**: `grimoires/loa/sdd-hounfour-finish-line.md`
**Source**: [PR #53 Bridgebuilder Review](https://github.com/0xHoneyJar/arrakis/pull/53)
**Branch**: `feature/hounfour-endgame`

---

## Overview

This sprint plan addresses all 6 findings from the Bridgebuilder Round 4 review of PR #53, split across 2 sprints. The findings range from high-priority structural refactors (invoke/stream duplication, contract ownership) to medium-priority hardening (key exposure, test coverage, ensemble budgeting, script extraction).

### Findings Summary

| # | Severity | Finding | Sprint |
|---|----------|---------|--------|
| BB4-1 | HIGH | invoke/stream pre-flight duplication (~80% shared code) | 1 |
| BB4-2 | HIGH | Contract schema ownership without compatibility strategy | 2 |
| BB4-3 | MEDIUM | V8 heap string exposure for BYOK API keys | 2 |
| BB4-4 | MEDIUM | Pre-existing `invoke_ensemble_partial_failure` test failure | 1 |
| BB4-5 | MEDIUM | Ensemble budget multiplier = N for all strategies (over-reserves fallback) | 1 |
| BB4-6 | MEDIUM | Bash-embedded Node.js for JWT signing in validate-deployment.sh | 1 |

---

## Sprint 1: Gateway Refactor & Test Fix (Global ID: 207)

**Goal**: Extract shared invoke/stream pre-flight into `prepareInvocation()`, fix pre-existing test failure, make ensemble budget strategy-aware, and extract inline Node.js from deployment script.

### Task 1.1: Extract `prepareInvocation()` from AgentGateway (BB4-1)

**ID**: arrakis-bb4-1
**File**: `packages/adapters/agent/agent-gateway.ts`
**Priority**: HIGH

**Problem**: `invoke()` (lines 97-234) and `stream()` (lines 276-440) share ~80% identical pre-flight logic: model alias validation, rate limiting, pool resolution, pool fallback logging, ensemble validation, BYOK check + quota, budget estimation + reservation, idempotent hit logging, budget warning, and max-cost ceiling metadata construction.

**Solution**: Extract a private `prepareInvocation()` method that encapsulates all shared pre-flight steps and returns a prepared request object plus budget context needed for finalization.

**Implementation**:

1. Define a `PreparedInvocation` interface:
   ```typescript
   interface PreparedInvocation {
     request: AgentInvokeRequest; // enriched with poolId, allowedPools, metadata
     estimatedCostCents: number;
     isByok: boolean;
     ensembleResult?: EnsembleValidationResult;
     log: Logger;
   }
   ```

2. Extract `private async prepareInvocation(request, options?)` returning `PreparedInvocation`. The only difference between invoke/stream pre-flight is `estimatedOutputTokens` (1000 for invoke, 2000 for stream) — pass this as a parameter or infer from a `mode: 'invoke' | 'stream'` parameter.

3. Refactor `invoke()` to call `prepareInvocation()` then execute + finalize.

4. Refactor `stream()` to call `prepareInvocation()` then stream + finalize.

5. Verify the `checkBudgetDrift()` call site is identical in both paths.

**Acceptance Criteria**:
- AC-1.1.1: `prepareInvocation()` contains all shared pre-flight logic (no duplication between invoke/stream)
- AC-1.1.2: `invoke()` and `stream()` are reduced to execution + finalization only
- AC-1.1.3: All 12 existing passing E2E tests still pass (no behavioral change)
- AC-1.1.4: Both invoke and stream paths emit the same log events at the same levels with the same semantic fields (`traceId`, `communityId`, `poolId`, `accessLevel`, strategy fields). Ordering and timing fields (timestamps, durations) may differ due to call boundary changes.
- AC-1.1.5: The only parametric difference is `estimatedOutputTokens` (1000 vs 2000)

---

### Task 1.2: Fix `invoke_ensemble_partial_failure` Test (BB4-4)

**ID**: arrakis-bb4-4
**Files**: `tests/e2e/loa-finn-e2e-stub.ts`, `tests/e2e/contracts/vectors/loa-finn-test-vectors.json`
**Priority**: MEDIUM

**Problem**: The `invoke_ensemble_partial_failure` test has been failing since cycle-015 because the stub's `matchVector()` method (line 462-487) matches ensemble requests to `invoke_ensemble_best_of_n` vector — it never routes to the partial_failure vector. The test expects `body.ensemble_partial_failure`, `body.ensemble_succeeded`, and `body.ensemble_failed` fields that the best_of_n response body doesn't include.

**Solution**:

1. **Add a test-only discriminator via request body field** (NOT JWT claims — avoids polluting the auth surface). The `invoke_ensemble_partial_failure` test vector's request body already differs from `invoke_ensemble_best_of_n` in that it uses `strategy: 'fallback'` with `n: 3`. Update `matchVector()` in the stub to route based on `ensemble.strategy` from the parsed request body:
   - `strategy === 'best_of_n'` → route to `invoke_ensemble_best_of_n` vector
   - `strategy === 'fallback'` → route to `invoke_ensemble_partial_failure` vector
   - This requires passing the parsed request body into `matchVector()` (currently only receives JWT claims)

2. Add the partial failure response body fields to the `invoke_ensemble_partial_failure` test vector in `loa-finn-test-vectors.json`:
   ```json
   {
     "ensemble_partial_failure": true,
     "ensemble_succeeded": 2,
     "ensemble_failed": 1,
     "content": "Partial ensemble response",
     "usage": { "prompt_tokens": 30, "completion_tokens": 40, "cost_usd": 0.015 }
   }
   ```

3. Update the `invoke_ensemble_partial_failure` test vector's request to use `strategy: 'fallback'` (distinct from best_of_n) so the stub can route deterministically.

4. Update `matchVector()` signature to `matchVector(claims, body?)` and add body-based routing for ensemble strategy differentiation.

**Acceptance Criteria**:
- AC-1.2.1: `invoke_ensemble_partial_failure` test passes (13/13 E2E tests)
- AC-1.2.2: No regression in the other 12 tests
- AC-1.2.3: Test vector correctly defines partial failure response shape with ensemble metadata

---

### Task 1.3: Strategy-Aware Ensemble Budget Multiplier (BB4-5)

**ID**: arrakis-bb4-5
**File**: `packages/adapters/agent/ensemble-mapper.ts`
**Priority**: MEDIUM

**Problem**: Line 112 sets `budgetMultiplier = n` for ALL strategies with a comment saying "worst-case all N models tried sequentially" for fallback. The Bridgebuilder review noted this over-reserves for fallback (typical case is 1 successful call). However, arrakis cannot safely under-reserve because it does not control fallback execution — loa-finn orchestrates fallback steps internally and reports final cost back. Without incremental reservation (a loa-finn callback per-step), reducing the multiplier would violate the critical **committed ≤ reserved** budget invariant.

**Solution**: Keep N× reservation for all strategies (preserving the invariant) but **improve the code documentation** to explain the architectural constraint and mark it as a future optimization:

```typescript
// Budget multiplier: reserve N × base cost for all strategies
//
// best_of_n: N parallel calls (all execute)
// consensus: N parallel calls (all execute)
// fallback:  N× worst-case (sequential, stops at first success)
//
// NOTE (BB4-5): Fallback typically uses 1 call, making N× an over-reservation.
// However, arrakis cannot safely reduce the multiplier because:
// 1. loa-finn orchestrates fallback steps internally (arrakis has no per-step visibility)
// 2. Without incremental reservation per fallback attempt, reducing the multiplier
//    would allow committed > reserved, violating budget accounting integrity
// 3. Over-reservation is temporary (reservation released on finalization) and
//    preferable to invariant violation
//
// Future optimization: If loa-finn adds per-step callbacks or step-level budget
// reporting, arrakis can implement incremental reservation for fallback.
// See: loa-finn RFC #31, Implementation Gate 12
const budgetMultiplier = n;
```

Also update the `computePartialCost()` method JSDoc to note the over-reservation tradeoff for fallback.

**Acceptance Criteria**:
- AC-1.3.1: `budgetMultiplier = n` for ALL strategies (no behavioral change)
- AC-1.3.2: Code comment explains why fallback uses N× despite over-reservation (architectural constraint documented)
- AC-1.3.3: Comment references the future optimization path (incremental reservation via loa-finn callbacks)
- AC-1.3.4: `computePartialCost()` JSDoc updated to note fallback over-reservation tradeoff
- AC-1.3.5: Existing ensemble E2E tests still pass (no functional change)

---

### Task 1.4: Extract JWT Signing from Deployment Script (BB4-6)

**ID**: arrakis-bb4-6
**Files**: `scripts/validate-deployment.sh`, `scripts/sign-test-jwt.js` (new)
**Priority**: MEDIUM

**Problem**: `validate-deployment.sh` lines 198-222 embed a Node.js program inline within a bash heredoc for JWT signing. This is fragile (quoting issues, no syntax highlighting, hard to test independently) and mixes concerns.

**Solution**:

1. Create `scripts/sign-test-jwt.js` — a standalone Node.js script that:
   - Takes `--key <path>` (PEM file path) as CLI argument
   - Outputs a signed JWT to stdout
   - Uses jose (already a devDependency) for ES256 signing
   - Includes test tenant claims matching what the deployment script currently hardcodes
   - Exits non-zero with error message on failure

2. Update `validate-deployment.sh` to call `node scripts/sign-test-jwt.js --key "$TEST_KEY"` instead of the inline Node.js block.

**Acceptance Criteria**:
- AC-1.4.1: `scripts/sign-test-jwt.js` produces valid ES256-signed JWT when given a valid PEM key
- AC-1.4.2: `validate-deployment.sh` no longer contains inline Node.js
- AC-1.4.3: `scripts/sign-test-jwt.js --help` documents usage
- AC-1.4.4: `node scripts/sign-test-jwt.js --key <invalid>` exits non-zero with actionable error
- AC-1.4.5: Deployment script behavior is unchanged from the user's perspective

---

### Task 1.5: Sprint 1 Goal Check

**ID**: arrakis-bb4-gc1
**Priority**: HIGH

- Run full E2E test suite: verify 13/13 pass (including the newly-fixed partial failure test)
- Verify `prepareInvocation()` refactor didn't change any observable behavior
- Verify `scripts/sign-test-jwt.js --help` works
- Verify ensemble budget multiplier is strategy-aware in unit-level assertion

---

## Sprint 2: Contract Strategy & Security Hardening (Global ID: 208)

**Goal**: Establish contract compatibility story between arrakis and loa-finn, minimize BYOK API key exposure window, and run final validation.

### Task 2.1: Contract Compatibility Matrix (BB4-2)

**ID**: arrakis-bb4-2
**Files**: `tests/e2e/contracts/README.md` (new), `tests/e2e/contracts/compatibility.json` (new), `tests/e2e/contracts/src/index.ts`
**Priority**: HIGH

**Problem**: `tests/e2e/contracts/` lives in arrakis but defines the interface between arrakis and loa-finn. There's no versioning story — if loa-finn's response shape changes, arrakis E2E tests break silently. The `CONTRACT_VERSION` (from package.json) exists but there's no compatibility matrix documenting which arrakis versions work with which loa-finn versions.

**Solution**:

1. Create `tests/e2e/contracts/compatibility.json`:
   ```json
   {
     "contract_version": "1.0.0",
     "compatibility": [
       {
         "arrakis": ">=PR#52",
         "loa_finn": ">=PR#53 (pending)",
         "contract": "1.0.0",
         "notes": "Initial contract — pool claims, ensemble, BYOK"
       }
     ],
     "breaking_changes": [],
     "deprecations": []
   }
   ```

2. Create `tests/e2e/contracts/README.md` documenting:
   - What the contract package is and why it exists
   - How to update schemas when the interface changes
   - The versioning policy (semver: breaking = major, additive = minor, fix = patch)
   - How to add a new test vector
   - The compatibility matrix format

3. Add a `getCompatibility()` export to `contracts/src/index.ts` that returns the parsed compatibility matrix for programmatic use.

4. Add a **local-only** contract version validation in E2E tests: compare `CONTRACT_VERSION` against `compatibility.json` entries and warn (structured log, not failure) if the current contract version has no compatibility entry. This is purely local validation — it does NOT attempt to fetch loa-finn's version at runtime (that would require a loa-finn API change, deferred to a future cycle).

**Acceptance Criteria**:
- AC-2.1.1: `compatibility.json` exists with at least one entry documenting current compatibility
- AC-2.1.2: `README.md` documents how to update contracts when interface changes
- AC-2.1.3: Versioning policy (semver) is documented
- AC-2.1.4: E2E test warns (structured log) when `CONTRACT_VERSION` has no matching entry in `compatibility.json` — this is a local-only check validating the contract package itself, not cross-service version negotiation (deferred)

---

### Task 2.2: BYOK API Key Exposure Minimization (BB4-3)

**ID**: arrakis-bb4-3
**File**: `packages/adapters/agent/byok-proxy-handler.ts`
**Priority**: MEDIUM

**Problem**: At lines 296-299, `apiKey.toString('utf8')` creates an immutable V8 heap string that's placed into `outHeaders`. Line 312 zeroes the Buffer, but the string copy in `outHeaders` (and any V8 internal copies) persists until garbage collected. This is inherent to V8's string immutability — there's no way to zero a JS string.

**Solution**: Minimize the exposure window rather than eliminate it (elimination is impossible in V8):

1. **Move `apiKey.fill(0)` into a `finally` block** after the fetch call completes (not before it). Currently the Buffer is zeroed at line 312 but the string is still referenced in `outHeaders`. The optimization is to also null out the header reference as soon as the fetch response is received:
   ```typescript
   try {
     const response = await this.httpFetch(url, {
       method: endpoint.method,
       headers: outHeaders,
       body: req.body,
       redirect: 'error',
       signal: AbortSignal.timeout(30_000),
     });
     // Immediately minimize key exposure window
     delete outHeaders['authorization'];
     delete outHeaders['x-api-key'];
     // ... process response
   } finally {
     // Zero buffer regardless of success/failure
     apiKey.fill(0);
     // Remove any remaining header references
     delete outHeaders['authorization'];
     delete outHeaders['x-api-key'];
   }
   ```

2. **Add a `@security` JSDoc comment** documenting the V8 string immutability limitation and the mitigation strategy (minimized exposure window, not elimination).

3. **Log a structured metric** for key exposure duration (time from `getDecryptedKey` to header deletion) for operational monitoring.

**Acceptance Criteria**:
- AC-2.2.1: API key header references deleted immediately after fetch completes
- AC-2.2.2: Buffer zeroing in `finally` block (covers error paths)
- AC-2.2.3: `@security` JSDoc documents the V8 limitation and mitigation
- AC-2.2.4: Existing BYOK E2E test (`invoke_byok`) still passes
- AC-2.2.5: Key exposure duration logged as structured metric

---

### Task 2.3: Sprint 2 Goal Check

**ID**: arrakis-bb4-gc2
**Priority**: HIGH

- Run full E2E test suite: verify 13/13 pass
- Verify contract compatibility.json is valid JSON
- Verify BYOK key exposure minimization (review code, check finally block)
- Verify no regressions from sprint 1 changes
- Run TypeScript type check (`npx tsc --noEmit`)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `prepareInvocation()` refactor breaks subtle timing or logging | Low | Medium | Behavioral test suite (12 existing tests) as safety net |
| Fallback N× over-reservation temporarily blocks community budget | Low | Low | Reservation released on finalization; over-reserve is temporary; future optimization via loa-finn per-step callbacks (deferred) |
| Contract compatibility matrix becomes stale | Medium | Low | It's documentation — value is in establishing the pattern now |

---

## Dependencies

- Sprint 2 tasks 2.1 and 2.2 are independent of Sprint 1 tasks
- Task 1.2 (test fix) should complete before Task 1.5 (goal check) since goal check validates 13/13
- Task 1.1 (refactor) should complete before 1.5 for the same reason
