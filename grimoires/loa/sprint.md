# Sprint Plan: Bridgebuilder Hardening — PR #94 Review Findings

**Version:** 3.0.0
**Date:** 2026-02-24
**Cycle:** cycle-039
**Source:** Bridgebuilder Review of PR #94 (2 HIGH, 3 MEDIUM findings)
**PRD:** grimoires/loa/prd.md v1.2.0
**SDD:** grimoires/loa/sdd.md v1.2.0
**Duration:** 1 sprint
**Team:** 1 engineer (AI-assisted)
**Global Sprint IDs:** 348
**Prerequisite:** Sprints 343–347 complete (v2.0.0 plan JACKED_OUT)
**PR:** https://github.com/0xHoneyJar/loa-freeside/pull/94

---

## Context

The Bridgebuilder review of PR #94 identified 2 HIGH and 3 MEDIUM findings across the Sprint 4 (parseBoundaryMicroUsd) and Sprint 4 (quarantine) deliverables. Additionally, 1 pre-existing test expectation bug was documented in the Sprint 346 reviewer.md. All findings are targeted, surgical fixes with no architectural changes required.

### Finding Summary

| ID | Severity | Title | File |
|----|----------|-------|------|
| high-1 | HIGH | Control characters pass through safety floor | parse-boundary-micro-usd.ts:43 |
| high-2 | HIGH | legacyResult fallback in enforce mode masks legacy failures | parse-boundary-micro-usd.ts:340-342 |
| medium-1 | MEDIUM | Untyped row mapping in quarantine.ts | quarantine.ts:110,193 |
| medium-2 | MEDIUM | process.env read on every parse call | parse-boundary-micro-usd.ts:128-134 |
| medium-3 | MEDIUM | Shadow mode comment inaccuracy | parse-boundary-micro-usd.ts:320-331 |
| test-bug | PRE-EXISTING | checkSafetyFloor test expectation bug | parse-boundary-micro-usd.test.ts |

---

## Sprint 1: Bridgebuilder Findings Fix + Merge Prep

**Goal:** Address all Bridgebuilder review findings from PR #94 and prepare branch for merge.

**Global Sprint ID:** 348

### Tasks

#### Task 1.1: Tighten Safety Floor — Reject C0 Control Characters (HIGH)
**Description:** The safety floor's `NON_ASCII_REGEX` (`/[^\x00-\x7F]/`) allows C0 control characters (NUL, BEL, BS, ESC, DEL, etc.) to pass through. While these are ultimately caught by `BigInt()` downstream, the safety floor should be the complete first line of defense with informative error codes. Add a dedicated control character check.
**File:** `themes/sietch/src/packages/core/protocol/parse-boundary-micro-usd.ts`
**Acceptance Criteria:**
- AC-1.1.1: The existing `ASCII_WHITESPACE_REGEX` (`/[\t\n\r\f\v ]/`) catches exactly these 6 characters: `\t`(0x09), `\n`(0x0A), `\v`(0x0B), `\f`(0x0C), `\r`(0x0D), space(0x20). The new control character check targets the **complement set**: all C0/DEL characters NOT in the whitespace regex — specifically `\x00-\x08`, `\x0E-\x1F`, and `\x7F`
- AC-1.1.2: New error code `SAFETY_CONTROL_CHAR` added to `BoundaryErrorCode` union
- AC-1.1.3: New `CONTROL_CHAR_REGEX`: `/[\x00-\x08\x0E-\x1F\x7F]/` — derived as: (all C0 0x00-0x1F + DEL 0x7F) minus (whitespace set {0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20}). Add AFTER the non-ASCII check and BEFORE the whitespace check in `checkSafetyFloor()`
- AC-1.1.4: Unit tests added: NUL byte (`\x00`), BEL (`\x07`), ESC (`\x1B`), DEL (`\x7F`) all return `{ ok: false, errorCode: 'SAFETY_CONTROL_CHAR' }`
- AC-1.1.5: Boundary test: `\t`, `\n`, `\r`, `\f`, `\v` still return `SAFETY_WHITESPACE` (not `SAFETY_CONTROL_CHAR`) — confirms the two regexes partition the non-printable ASCII space correctly
- AC-1.1.6: Existing whitespace rejection tests unchanged — no regressions
- AC-1.1.7: All existing tests pass — no regressions
**Estimated Effort:** Small
**Dependencies:** None

#### Task 1.2: Fix legacyResult Fallback in Enforce Mode (HIGH)
**Description:** In enforce mode (line 340), `legacyResult: legacyValue ?? canonical.amount` silently falls back to the canonical amount when legacy `BigInt()` fails. This masks the fact that legacy couldn't parse the input, making monitoring data show false agreement. Additionally, `diverged` is set to `false` when `legacyValue` is null (line 342), hiding the disagreement.
**File:** `themes/sietch/src/packages/core/protocol/parse-boundary-micro-usd.ts`
**Acceptance Criteria:**
- AC-1.2.1: When `legacyValue` is null in enforce mode, set `diverged: true` (not false) — a legacy parse failure IS a divergence from canonical success
- AC-1.2.2: When `legacyValue` is null in enforce mode, set `legacyResult` to the canonical amount but add `legacyFailed: true` to the ok:true branch of `BoundaryParseResult`
- AC-1.2.3: Add optional `legacyFailed?: boolean` field to the ok:true branch of `BoundaryParseResult` type
- AC-1.2.4: Unit test: input `'1e6'` (valid for parseMicroUsd, invalid for BigInt) in enforce mode → `diverged: true`, `legacyFailed: true`
- AC-1.2.5: Existing shadow-mode behavior unchanged (shadow mode already sets `diverged: true` when canonical rejects)
- AC-1.2.6: All existing tests pass — no regressions
**Estimated Effort:** Small
**Dependencies:** None

#### Task 1.3: Add Typed Row Interface for Quarantine (MEDIUM)
**Description:** `quarantine.ts` uses `as any` casts at the DB boundary (`getUnreplayedQuarantineEntries` line 110, `rowToEntry` line 193, `countQuarantineEntries` line 180). Add a typed raw row interface matching the SQLite column names to replace the casts.
**File:** `themes/sietch/src/packages/core/protocol/quarantine.ts`
**Acceptance Criteria:**
- AC-1.3.1: New interface `QuarantineRow` added with snake_case field names matching the `micro_usd_parse_failures` table schema: `id: number`, `original_row_id: string`, `table_name: string`, `raw_value: string`, `context: string`, `error_code: string`, `reason: string | null`, `source_fingerprint: string`, `replayed_at: string | null`, `replay_attempts: number`, `last_replay_error: string | null`, `created_at: string`
- AC-1.3.2: `getUnreplayedQuarantineEntries` query result typed as `QuarantineRow[]` (replace `as any[]`)
- AC-1.3.3: `rowToEntry` parameter typed as `QuarantineRow` (replace `any`)
- AC-1.3.4: `countQuarantineEntries` query result typed with inline type (replace `as any`)
- AC-1.3.5: All existing quarantine tests pass — no regressions
**Estimated Effort:** Small
**Dependencies:** None

#### Task 1.4: Cache resolveParseMode() at Module Load (MEDIUM)
**Description:** `resolveParseMode()` reads `process.env.PARSE_MICRO_USD_MODE` on every call. In shadow mode this runs on every HTTP/JWT boundary parse. Cache the resolved mode at module load with an explicit reset for testing.
**File:** `themes/sietch/src/packages/core/protocol/parse-boundary-micro-usd.ts`
**Acceptance Criteria:**
- AC-1.4.1: Module-level `let cachedMode: ParseMode | null = null` variable
- AC-1.4.2: `resolveParseMode()` returns cached value if set; reads and caches `process.env` on first call
- AC-1.4.3: New exported function `resetParseModeCache(): void` that sets `cachedMode = null` — for use in tests that need to change mode between test cases
- AC-1.4.4: `modeOverride` parameter on `parseBoundaryMicroUsd` still bypasses the cache (for per-call testing)
- AC-1.4.5: Existing tests updated: call `resetParseModeCache()` in `beforeEach` or `afterEach` blocks to ensure test isolation
- AC-1.4.6: All existing tests pass — no regressions
- AC-1.4.7: Similarly cache `isBoundaryEngineEnabled()` in `boundary-engine-shadow.ts` with `resetBoundaryEngineCache()`
**Estimated Effort:** Small
**Dependencies:** None

#### Task 1.5: Fix Comments + Test Expectation Bug (MEDIUM + PRE-EXISTING)
**Description:** Two documentation/test fixes: (1) Shadow mode comment at lines 320-331 says "Both parsers rejected" but the block handles cases where only legacy rejected. (2) Test at line ~92 uses `'1'.repeat(50)` which creates a 50-digit number exceeding MAX_SAFE_MICRO_USD — test expects pass but value exceeds the max value safety check.
**Files:** `parse-boundary-micro-usd.ts`, `parse-boundary-micro-usd.test.ts`
**Acceptance Criteria:**
- AC-1.5.1: Comment block at lines 320-331 updated to accurately describe the two sub-cases: (a) canonical also failed → CANONICAL_REJECTION, (b) canonical succeeded but legacy failed → LEGACY_PARSE_FAILURE
- AC-1.5.2: Test expectation bug fixed: replace `'1'.repeat(50)` with `String(MAX_SAFE_MICRO_USD)` (which is `'1000000000000000'`, 16 digits, exactly at the boundary). Import `MAX_SAFE_MICRO_USD` in the test file. Additionally add a boundary-length test using `String(MAX_SAFE_MICRO_USD - 1n)` (`'999999999999999'`, 15 digits) to confirm values just below the max pass the safety floor
- AC-1.5.3: All safety floor tests pass with corrected expectations
- AC-1.5.4: No other test changes — all existing tests pass
**Estimated Effort:** Small
**Dependencies:** Tasks 1.1, 1.2 (comment updates depend on the code changes above)

### Sprint 1 Exit Gate (CI-Verifiable)
- All 5 Bridgebuilder findings addressed (2 HIGH, 3 MEDIUM)
- Pre-existing test expectation bug fixed
- `npx tsc --noEmit` passes
- All existing tests pass (5561+ passing)
- New tests for control character rejection pass
- New tests for legacyFailed flag pass
- Zero regressions against golden baseline, conformance suite, semantic invariants

### Sprint 1 Success Criteria
- Safety floor complete: rejects ALL non-printable-ASCII input (control chars + non-ASCII)
- Enforce mode accurately reports legacy parse failures via `legacyFailed` flag and `diverged: true`
- Quarantine DB boundary is type-safe (no `as any` casts)
- Parse mode resolution is cached (no process.env hit per request)
- Comments accurately describe control flow
- Test suite corrected and fully passing
- Branch ready for review + merge

---

## Appendix: Finding-to-Task Traceability

| Finding ID | Task | AC Range |
|------------|------|----------|
| high-1 | 1.1 | AC-1.1.1 – AC-1.1.7 |
| high-2 | 1.2 | AC-1.2.1 – AC-1.2.6 |
| medium-1 | 1.3 | AC-1.3.1 – AC-1.3.5 |
| medium-2 | 1.4 | AC-1.4.1 – AC-1.4.7 |
| medium-3 | 1.5 | AC-1.5.1 – AC-1.5.4 |
| test-bug | 1.5 | AC-1.5.2 – AC-1.5.3 |

---

*Generated by Sprint Planning Agent — Cycle 039, Bridgebuilder Hardening (Sprint 348)*
