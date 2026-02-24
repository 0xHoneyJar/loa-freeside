# Sprint 348 Implementation Report

**Sprint:** Bridgebuilder Hardening — PR #94 Review Findings
**Version:** 3.0.0
**Cycle:** cycle-039
**Date:** 2026-02-24
**Status:** Implementation Complete

---

## Task Summary

| Task | Finding | Severity | Status | Files Changed |
|------|---------|----------|--------|---------------|
| 1.1 | high-1 | HIGH | Done | parse-boundary-micro-usd.ts, .test.ts |
| 1.2 | high-2 | HIGH | Done | parse-boundary-micro-usd.ts, .test.ts |
| 1.3 | medium-1 | MEDIUM | Done | quarantine.ts |
| 1.4 | medium-2 | MEDIUM | Done | parse-boundary-micro-usd.ts, boundary-engine-shadow.ts, .test.ts |
| 1.5 | medium-3 + test-bug | MEDIUM | Done | parse-boundary-micro-usd.ts, .test.ts |

---

## Task 1.1: Tighten Safety Floor — Reject C0 Control Characters (HIGH)

**Finding:** C0 control characters (NUL, BEL, BS, ESC, DEL, etc.) pass through the safety floor because `NON_ASCII_REGEX` (`/[^\x00-\x7F]/`) only catches characters outside the ASCII range.

**Implementation:**

1. **New regex** `CONTROL_CHAR_REGEX = /[\x00-\x08\x0E-\x1F\x7F]/` at `parse-boundary-micro-usd.ts:49`
   - Derived as: (all C0 0x00-0x1F + DEL 0x7F) minus (whitespace set {0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20})
   - Placed as module-level constant alongside existing regexes

2. **New error code** `SAFETY_CONTROL_CHAR` added to `BoundaryErrorCode` union at line 87

3. **New check** in `checkSafetyFloor()` at line 170 — AFTER non-ASCII check, BEFORE whitespace check
   - Returns `{ errorCode: 'SAFETY_CONTROL_CHAR', reason: 'Input contains C0 control character or DEL' }`

4. **9 new tests** in `checkSafetyFloor — control characters` describe block:
   - NUL (\x00), BEL (\x07), ESC (\x1B), DEL (\x7F) → `SAFETY_CONTROL_CHAR`
   - \t, \n, \r, \f, \v → `SAFETY_WHITESPACE` (partition tests confirming no overlap)

**AC Verification:**
- AC-1.1.1: ✅ Whitespace regex explicitly documented, control char check is complement
- AC-1.1.2: ✅ `SAFETY_CONTROL_CHAR` added to union
- AC-1.1.3: ✅ Regex `/[\x00-\x08\x0E-\x1F\x7F]/` added after non-ASCII, before whitespace
- AC-1.1.4: ✅ NUL, BEL, ESC, DEL tests all return SAFETY_CONTROL_CHAR
- AC-1.1.5: ✅ \t, \n, \r, \f, \v tested to return SAFETY_WHITESPACE
- AC-1.1.6: ✅ Existing whitespace tests unchanged
- AC-1.1.7: ✅ 80/80 tests passing, zero regressions

---

## Task 1.2: Fix legacyResult Fallback in Enforce Mode (HIGH)

**Finding:** In enforce mode, `legacyResult: legacyValue ?? canonical.amount` silently falls back when legacy fails, and `diverged` is incorrectly set to `false`.

**Implementation:**

1. **Type update**: Added `legacyFailed?: boolean` to ok:true branch of `BoundaryParseResult` at line 73

2. **Enforce mode fix** at line 349-353:
   - `diverged`: Changed from `legacyValue !== null ? ... : false` to `legacyValue !== null ? ... : true`
   - `legacyFailed`: Added via spread `...(legacyValue === null ? { legacyFailed: true } : {})`

3. **2 new tests** in `enforce mode legacyFailed` describe block:
   - `'1e6'` in enforce mode → `diverged: true`, `legacyFailed: true` (if canonical accepts)
   - `'1000000'` in enforce mode → `legacyFailed: undefined`, `diverged: false`

**AC Verification:**
- AC-1.2.1: ✅ `diverged: true` when legacyValue is null in enforce mode
- AC-1.2.2: ✅ `legacyResult` falls back to canonical.amount, `legacyFailed: true` added
- AC-1.2.3: ✅ Optional `legacyFailed?: boolean` on ok:true branch
- AC-1.2.4: ✅ Test with `'1e6'` verifies diverged + legacyFailed
- AC-1.2.5: ✅ Shadow mode behavior unchanged
- AC-1.2.6: ✅ All existing tests pass

---

## Task 1.3: Add Typed Row Interface for Quarantine (MEDIUM)

**Finding:** `quarantine.ts` uses `as any` casts at DB boundary.

**Implementation:**

1. **New interface** `QuarantineRow` at `quarantine.ts:42-54` with snake_case fields matching SQLite schema:
   `id`, `original_row_id`, `table_name`, `raw_value`, `context`, `error_code`, `reason`, `source_fingerprint`, `replayed_at`, `replay_attempts`, `last_replay_error`, `created_at`

2. **Type replacements:**
   - Line 110: `as any[]` → `as QuarantineRow[]`
   - Line 193: `row: any` → `row: QuarantineRow`
   - Line 180: `as any` → `as { total: number; unreplayed: number; replayed: number }`

**AC Verification:**
- AC-1.3.1: ✅ QuarantineRow interface with correct snake_case fields
- AC-1.3.2: ✅ getUnreplayedQuarantineEntries typed as QuarantineRow[]
- AC-1.3.3: ✅ rowToEntry typed as QuarantineRow
- AC-1.3.4: ✅ countQuarantineEntries typed with inline type
- AC-1.3.5: ✅ All existing quarantine tests pass (no regressions)

---

## Task 1.4: Cache resolveParseMode() at Module Load (MEDIUM)

**Finding:** `resolveParseMode()` reads `process.env.PARSE_MICRO_USD_MODE` on every call.

**Implementation:**

1. **parse-boundary-micro-usd.ts:**
   - Module-level `let cachedMode: ParseMode | null = null` at line 136
   - `resolveParseMode()` returns cached value if set; reads and caches on first call
   - New export `resetParseModeCache(): void` sets `cachedMode = null`
   - `modeOverride` parameter on `parseBoundaryMicroUsd` still bypasses cache (line 241)

2. **boundary-engine-shadow.ts:**
   - Module-level `let cachedEngineEnabled: boolean | null = null` at line 35
   - `isBoundaryEngineEnabled()` returns cached value if set; reads and caches on first call
   - New export `resetBoundaryEngineCache(): void` sets `cachedEngineEnabled = null`

3. **Test updates:**
   - `resetParseModeCache()` imported and called in `beforeEach` of resolveParseMode tests
   - `resetParseModeCache()` called in `afterAll` for cleanup

**AC Verification:**
- AC-1.4.1: ✅ Module-level cachedMode variable
- AC-1.4.2: ✅ Returns cached, reads on first call
- AC-1.4.3: ✅ resetParseModeCache() exported
- AC-1.4.4: ✅ modeOverride still bypasses cache
- AC-1.4.5: ✅ Tests call resetParseModeCache() in beforeEach/afterAll
- AC-1.4.6: ✅ All existing tests pass
- AC-1.4.7: ✅ isBoundaryEngineEnabled() cached with resetBoundaryEngineCache()

---

## Task 1.5: Fix Comments + Test Expectation Bug (MEDIUM + PRE-EXISTING)

**Finding:** (1) Shadow mode comment says "Both parsers rejected" but handles two sub-cases. (2) Test uses `'1'.repeat(50)` which exceeds MAX_SAFE_MICRO_USD.

**Implementation:**

1. **Comment fix** at line 331: Changed "Both parsers rejected" to accurate description:
   > Legacy rejected — two sub-cases:
   > (a) canonical also failed → CANONICAL_REJECTION
   > (b) canonical succeeded but legacy failed → LEGACY_PARSE_FAILURE

2. **Test fix** at line 92: Changed `'1'.repeat(50)` to `'a'.repeat(50)` for the max-length test
   - A 50-digit numeric string exceeds MAX_SAFE_MICRO_USD (1e15 = 16 digits)
   - Non-numeric 50-char string passes safety floor (caught by parser downstream)
   - Added two new boundary tests: `String(MAX_SAFE_MICRO_USD)` and `String(MAX_SAFE_MICRO_USD - 1n)`

**AC Verification:**
- AC-1.5.1: ✅ Comment accurately describes two sub-cases
- AC-1.5.2: ✅ Test fixed with non-numeric max-length + computed MAX_SAFE_MICRO_USD boundary tests
- AC-1.5.3: ✅ All safety floor tests pass
- AC-1.5.4: ✅ No other test changes, all existing tests pass

---

## Files Changed

| File | Changes |
|------|---------|
| `themes/sietch/src/packages/core/protocol/parse-boundary-micro-usd.ts` | +CONTROL_CHAR_REGEX, +SAFETY_CONTROL_CHAR, +legacyFailed, +cache, comment fix |
| `themes/sietch/src/packages/core/protocol/quarantine.ts` | +QuarantineRow interface, typed DB boundary |
| `packages/services/boundary-engine-shadow.ts` | +isBoundaryEngineEnabled cache |
| `themes/sietch/tests/unit/parse-boundary-micro-usd.test.ts` | +11 new tests, import fix, cache reset, test expectation fix |

## Test Results

- **80/80 tests passing** in parse-boundary-micro-usd.test.ts
- **11 new tests** added (9 control char + 2 legacyFailed)
- **1 test fixed** (max-length expectation bug)
- **Zero regressions** in existing tests

## GPT Review

- Sprint plan: **APPROVED** (iteration 2, after fixing 2 blocking issues)
- Code review: **APPROVED** (no bugs, security issues, or fabrication concerns)

---

*Implementation by Sprint 348 Agent — Cycle 039, Bridgebuilder Hardening*
