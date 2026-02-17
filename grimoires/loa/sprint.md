# Sprint Plan: The Voice from the Outer World — Canonical Protocol Adoption (v7.0.0)

**Version:** 1.0.0
**Date:** 2026-02-18
**Cycle:** cycle-034
**PRD:** grimoires/loa/prd.md (v1.1.0)
**SDD:** grimoires/loa/sdd.md (v1.1.0)
**Sprints:** 4 (Global IDs: 300–303)

---

## Sprint 300 — Foundation: Dependency Upgrade & Extension Scaffolding

**Goal:** Upgrade to v7.0.0, audit canonical exports, create arrakis extension modules.
**PRD Refs:** FR-1, FR-2 (partial)
**SDD Refs:** 3.1, 3.3, 3.4

### Prerequisites
- loa-hounfour v7.0.0 tag exists on GitHub (confirmed in PRD Section 6)
- Pre-migration anchor tag created: `git tag pre-v7-migration-anchor` (SDD 8.1)

### Tasks

#### Task 300.1 — Create pre-migration anchor and feature branch
**Goal ID:** G-6 (zero regressions — rollback safety)
**Acceptance Criteria:**
- [ ] `git tag pre-v7-migration-anchor` on current HEAD
- [ ] `release/pre-v7-baseline` branch created from tag
- [ ] Feature branch `feature/canonical-protocol-v7` created from main
**Files:** git operations only
**Estimate:** XS

#### Task 300.2 — Upgrade @0xhoneyjar/loa-hounfour to v7.0.0
**Goal ID:** G-1
**Acceptance Criteria:**
- [ ] Both `package.json` (root + `packages/adapters/package.json`) updated to `github:0xHoneyJar/loa-hounfour#<v7.0.0-commit-sha>`
- [ ] `npm install` / `pnpm install` succeeds
- [ ] `import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour'` returns `'7.0.0'`
- [ ] No version mismatch warnings at import time
**Files:** `package.json`, `packages/adapters/package.json`, lockfile
**Estimate:** S
**Depends on:** 300.1

#### Task 300.3 — Audit v7.0.0 canonical exports against local protocol layer
**Goal ID:** G-1, G-2
**Acceptance Criteria:**
- [ ] Export comparison document created: for each of the 14 vendored files, list which exports have canonical equivalents in v7.0.0 and which are arrakis-specific
- [ ] Resolve the 6 open questions from SDD Section 11 (branded types, conservation evaluator, BillingEntry, economic events, trust_scopes, config schema)
- [ ] File disposition table (SDD 3.3) updated with audit results
- [ ] Comparison document committed to `grimoires/loa/context/v7-export-audit.md`
**Files:** `grimoires/loa/context/v7-export-audit.md` (new)
**Estimate:** M
**Depends on:** 300.2

#### Task 300.4 — Create arrakis-arithmetic.ts extension module
**Goal ID:** G-2
**Acceptance Criteria:**
- [ ] `themes/sietch/src/packages/core/protocol/arrakis-arithmetic.ts` created
- [ ] Imports canonical `MicroUSD`, `BasisPoints`, `AccountId` from `@0xhoneyjar/loa-hounfour` (if v7 exports them; if not, keeps local definitions)
- [ ] All arithmetic helper functions (`addMicroUSD`, `subtractMicroUSD`, `bpsShare`, `assertBpsSum`, `dollarsToMicro`, `microToDollarsDisplay`, etc.) implemented using canonical types
- [ ] `tsc --noEmit` passes
**Files:** `core/protocol/arrakis-arithmetic.ts` (new)
**Estimate:** S
**Depends on:** 300.3

#### Task 300.5 — Create arrakis-compat.ts boundary compatibility module
**Goal ID:** G-3, G-6
**Acceptance Criteria:**
- [ ] `themes/sietch/src/packages/core/protocol/arrakis-compat.ts` created
- [ ] `negotiateVersion()` returns `{ preferred: '7.0.0', supported: ['4.6.0', '7.0.0'] }`
- [ ] `normalizeInboundClaims()` implements exactly-one-of enforcement (trust_level XOR trust_scopes), least-privilege mapping table, post-normalization re-validation
- [ ] `normalizeCoordinationMessage()` rejects missing version discriminator (never assumes legacy)
- [ ] `PROTOCOL_V7_NORMALIZATION` feature flag implemented (SDD 8.3)
- [ ] `tsc --noEmit` passes
**Files:** `core/protocol/arrakis-compat.ts` (new)
**Estimate:** M
**Depends on:** 300.3

#### Task 300.6 — Create arrakis-conservation.ts error taxonomy adapter
**Goal ID:** G-5
**Acceptance Criteria:**
- [ ] `themes/sietch/src/packages/core/protocol/arrakis-conservation.ts` created
- [ ] `ConservationErrorCode`, `ReconciliationFailureCode`, `ConservationViolationError` preserved
- [ ] If v7.0.0 exports conservation evaluator: adapter maps canonical results to arrakis error codes
- [ ] If v7.0.0 does NOT export evaluator: module wraps local conservation logic with clear TODO for future canonical migration
- [ ] `tsc --noEmit` passes
**Files:** `core/protocol/arrakis-conservation.ts` (new)
**Estimate:** S
**Depends on:** 300.3

---

## Sprint 301 — Consumer Migration: Import Path Overhaul

**Goal:** Migrate all 40+ consumers from vendored imports to canonical package imports. Delete vendored files.
**PRD Refs:** FR-2, FR-4
**SDD Refs:** 3.2, 3.3

### Prerequisites
- Sprint 300 complete (extension modules created, v7.0.0 installed)

### Tasks

#### Task 301.1 — Migrate billing adapter imports (23 files)
**Goal ID:** G-2
**Acceptance Criteria:**
- [ ] All 23 billing adapter files import canonical types from `@0xhoneyjar/loa-hounfour`
- [ ] Arrakis-specific helpers imported from `../../core/protocol/arrakis-arithmetic` (or equivalent)
- [ ] No imports from vendored `../../core/protocol/arithmetic.ts`, `billing-types.ts`, `state-machines.ts`, etc.
- [ ] `tsc --noEmit` passes after all 23 files updated
**Files:** `themes/sietch/src/packages/adapters/billing/*.ts` (23 files)
**Estimate:** L
**Depends on:** Sprint 300

#### Task 301.2 — Migrate API route imports (7 files)
**Goal ID:** G-2
**Acceptance Criteria:**
- [ ] All 7 API route files import canonical types from `@0xhoneyjar/loa-hounfour`
- [ ] Arrakis-specific helpers imported from local extension modules
- [ ] `tsc --noEmit` passes
**Files:** `themes/sietch/src/api/routes/*.ts` (7 files)
**Estimate:** M
**Depends on:** Sprint 300

#### Task 301.3 — Migrate test imports to canonical
**Goal ID:** G-2, G-6
**Acceptance Criteria:**
- [ ] Property tests (`tests/unit/billing/property-tests/`) import from canonical
- [ ] Conservation tests (`tests/unit/protocol/`) import from canonical
- [ ] Conformance tests updated to expect `CONTRACT_VERSION === '7.0.0'`
- [ ] `tsc --noEmit` passes
**Files:** `themes/sietch/tests/unit/**/*.test.ts`
**Estimate:** M
**Depends on:** Sprint 300

#### Task 301.4 — Update agent adapter layer (version bump verification)
**Goal ID:** G-1
**Acceptance Criteria:**
- [ ] `packages/adapters/agent/*.ts` — verify `CONTRACT_VERSION` now returns `'7.0.0'`
- [ ] `validateCompatibility()` still functions correctly with v7.0.0
- [ ] Agent tests pass
- [ ] No import path changes needed (already importing from canonical package)
**Files:** `packages/adapters/agent/*.ts` (4 files — verification only)
**Estimate:** S
**Depends on:** 300.2

#### Task 301.5 — Freeze conservation snapshot then delete vendored files
**Goal ID:** G-2, G-5
**CRITICAL ORDERING:** Freeze conservation snapshot BEFORE deleting vendored files.
**Acceptance Criteria:**
- [ ] `tests/fixtures/frozen-conservation-evaluator.ts` generated from git tag (NOT working tree): `git show pre-v7-migration-anchor:themes/sietch/src/packages/core/protocol/conservation-properties.ts > tests/fixtures/frozen-conservation-evaluator.ts`
- [ ] Frozen file header includes: "FROZEN SNAPSHOT from pre-v7-migration-anchor (SHA: <commit>). DO NOT MODIFY."
- [ ] Vendored files deleted one-by-one with `tsc --noEmit` after each:
  - `VENDORED.md`, `state-machines.ts`, `arithmetic.ts`, `compatibility.ts`
  - `billing-types.ts`, `guard-types.ts`, `billing-entry.ts`
- [ ] Files marked REVIEW in SDD 3.3 handled per audit results (Task 300.3)
- [ ] `core/protocol/index.ts` rewritten as barrel for arrakis extensions only (single-owner — 303.5 only verifies/adjusts)
- [ ] Full `tsc --noEmit` passes with zero vendored imports remaining
- [ ] `npm test` passes
**Files:** `core/protocol/*.ts` (delete 7+, rewrite index.ts), `tests/fixtures/frozen-conservation-evaluator.ts` (new)
**Estimate:** L
**Depends on:** 301.1, 301.2, 301.3, 301.4

---

## Sprint 302 — Breaking Changes & Conservation Safety

**Goal:** Handle both breaking changes with boundary safety. Dual-run conservation validation.
**PRD Refs:** FR-3, FR-5, FR-6
**SDD Refs:** 3.5, 3.6, 3.7

### Prerequisites
- Sprint 301 complete (all consumers migrated, vendored files deleted, conservation snapshot frozen)

### Tasks

#### Task 302.1 — Create conservation dual-run test harness
**Goal ID:** G-5
**Acceptance Criteria:**
- [ ] `tests/unit/protocol/conservation-dual-run.test.ts` created
- [ ] Uses `fast-check` (or equivalent) for property-based trace generation
- [ ] Edge case generators: overflow (MAX_MICRO_USD), zero, negative, terminal transitions, concurrent reservations
- [ ] Runs same traces through frozen local AND canonical evaluator
- [ ] All 14 local invariants (I-1 through I-14) produce identical pass/fail
- [ ] v7.0.0 invariants beyond local 14 are run and logged (not gated)
- [ ] `KNOWN_DIFFS` bounded allowlist with expiry dates (max 30 days) — permitted during Sprint 302 for development velocity
- [ ] Coverage counter verifies every canonical invariant ID exercised at least once
- [ ] Dual-run passes (allowlist entries permitted here; must be empty by Task 303.6 final gate)
**Files:** `tests/unit/protocol/conservation-dual-run.test.ts` (new)
**Estimate:** L
**Depends on:** 301.5 (frozen snapshot must exist)

#### Task 302.2 — Create evaluator-independent conservation test
**Goal ID:** G-5
**Acceptance Criteria:**
- [ ] `tests/unit/protocol/conservation-independent.test.ts` created
- [ ] Property: `SUM(credits) == SUM(debits)` over generated traces (no evaluator dependency)
- [ ] Property: `reserved_micro <= available_micro` per account
- [ ] Property: no negative balances after finalization
- [ ] All properties pass with `fast-check` (100+ runs)
**Files:** `tests/unit/protocol/conservation-independent.test.ts` (new)
**Estimate:** M
**Depends on:** Sprint 301

#### Task 302.3 — JWT claim schema migration (trust_scopes)
**Goal ID:** G-3
**Acceptance Criteria:**
- [ ] `jwt-boundary.ts` updated with v7.0.0 claim schemas (if still local) or deleted (if canonical)
- [ ] `identity-trust.ts` aligned with canonical trust model (per audit Task 300.3)
- [ ] JWT encode/decode round-trip test with v7.0.0 schema passes
- [ ] Inbound v4.6.0 token with valid trust_level: accepted, mapped via least-privilege table
- [ ] Inbound v7.0.0 token with trust_scopes: accepted
- [ ] Token with BOTH trust_level AND trust_scopes: REJECTED
- [ ] Token with NEITHER: REJECTED
- [ ] trust_level=9 NEVER maps to admin:true (privilege escalation guard)
- [ ] trust_level out of range (negative, >9): REJECTED
- [ ] Post-normalization output passes v7.0.0 schema validation
**Files:** `jwt-boundary.ts`, `identity-trust.ts`, `arrakis-compat.ts`, `tests/unit/protocol/jwt-boundary-v7.test.ts` (new)
**Estimate:** L
**Depends on:** Sprint 301

#### Task 302.4 — Coordination schema migration + version negotiation
**Goal ID:** G-3
**Acceptance Criteria:**
- [ ] All coordination message construction uses v7.0.0 schema outbound
- [ ] `validateCompatibility()` imported from canonical everywhere (no local copy)
- [ ] `/api/v1/compat` returns `{ preferred: '7.0.0', supported: ['4.6.0', '7.0.0'] }`
- [ ] Inbound v7.0.0 coordination messages: accepted
- [ ] Inbound v4.6.0 coordination messages: normalized via `arrakis-compat.ts`
- [ ] Missing version discriminator: REJECTED (never assume legacy)
- [ ] Unknown version: REJECTED
- [ ] `GET /api/health` reports `protocol_version: '7.0.0'`
**Files:** API routes, `arrakis-compat.ts`, `tests/unit/protocol/version-negotiation.test.ts` (new)
**Estimate:** M
**Depends on:** Sprint 301

#### Task 302.5 — Backward compatibility integration tests
**Goal ID:** G-3, G-6
**Acceptance Criteria:**
- [ ] `tests/unit/protocol/boundary-compat.test.ts` created covering:
  - v4.6.0 inbound JWT accepted (trust_level mapped)
  - v7.0.0 inbound JWT accepted (trust_scopes used directly)
  - v4.6.0 coordination message accepted (normalized)
  - v7.0.0 coordination message accepted (direct)
  - Malformed messages rejected with correct error codes
- [ ] Feature flag test: `PROTOCOL_V7_NORMALIZATION=false` reverts to v4.6 behavior
- [ ] All boundary tests pass
**Files:** `tests/unit/protocol/boundary-compat.test.ts` (new)
**Estimate:** M
**Depends on:** 302.3, 302.4

---

## Sprint 303 — CI Hardening, Cleanup & Conformance Gate

**Goal:** Wire CI drift detection, run full conformance suite, audit arrakis-specific modules, final regression gate.
**PRD Refs:** FR-7, FR-8
**SDD Refs:** 3.8, 3.9

### Prerequisites
- Sprint 302 complete (all breaking changes handled, conservation validated)

### Tasks

#### Task 303.1 — Create three-layer drift detection tests
**Goal ID:** G-4
**Acceptance Criteria:**
- [ ] `tests/unit/protocol/drift-detection.test.ts` created
- [ ] Layer 1: `CONTRACT_VERSION === '7.0.0'`
- [ ] Layer 2: Installed package version matches expected (`require.resolve` + `package.json`). If `gitHead` field is present, also assert it matches expected SHA. If `gitHead` is absent (common for GitHub tarball installs), fall back to asserting lockfile resolved reference contains expected SHA (via `npm ls --json` or lockfile parse)
- [ ] Layer 3: No vendored protocol files remain (allowlist for arrakis extensions)
- [ ] Upgrade procedure documented in test file comments
- [ ] All 3 layers pass
**Files:** `tests/unit/protocol/drift-detection.test.ts` (new)
**Estimate:** M
**Depends on:** Sprint 302

#### Task 303.2 — Delete hash-pinning artifacts
**Goal ID:** G-4
**Acceptance Criteria:**
- [ ] `themes/sietch/scripts/gen-protocol-fixtures.ts` deleted
- [ ] `themes/sietch/tests/fixtures/protocol-hashes.json` deleted
- [ ] Any references to hash-pinning in test files updated/removed
- [ ] `npm test` still passes
**Files:** 2 files deleted + reference cleanup
**Estimate:** S
**Depends on:** 303.1

#### Task 303.3 — Full conformance suite execution
**Goal ID:** G-5, G-6
**Acceptance Criteria:**
- [ ] All 14 conformance assertions pass against canonical source
- [ ] All 32 property tests pass against canonical types
- [ ] Conservation dual-run passes (from 302.1)
- [ ] Conservation independent tests pass (from 302.2)
- [ ] Zero skipped or `.todo` tests
- [ ] Full `npm test` green
**Files:** verification only (no new files)
**Estimate:** S
**Depends on:** Sprint 302

#### Task 303.4 — Audit arrakis-specific modules against v7.0.0
**Goal ID:** G-2
**Acceptance Criteria:**
- [ ] `config-schema.ts`: checked against v7.0.0 — align if canonical equivalent exists, document as arrakis extension if not
- [ ] `economic-events.ts`: checked against v7.0.0 — align event taxonomy if canonical exists
- [ ] `identity-trust.ts`: already handled in 302.3, verify final state
- [ ] `atomic-counter.ts`: confirmed arrakis-specific (Redis), no canonical equivalent
- [ ] Audit results documented in `grimoires/loa/context/v7-export-audit.md` (update from 300.3)
**Files:** Up to 3 files modified + audit document updated
**Estimate:** M
**Depends on:** Sprint 302

#### Task 303.5 — Verify and adjust core/protocol/index.ts barrel
**Goal ID:** G-2
**Note:** The barrel was rewritten in 301.5 (single-owner). This task verifies the barrel is correct after audit results (303.4) and adjusts if module alignment changed any exports.
**Acceptance Criteria:**
- [ ] `core/protocol/index.ts` only re-exports from arrakis extension modules (verified)
- [ ] No re-exports from `@0xhoneyjar/loa-hounfour` (consumers import canonical directly)
- [ ] If audit (303.4) aligned any local modules with canonical, update barrel to remove those re-exports
- [ ] All arrakis-specific modules accessible via barrel import
- [ ] `tsc --noEmit` passes
**Files:** `core/protocol/index.ts` (verify, adjust if needed)
**Estimate:** XS
**Depends on:** 303.4

#### Task 303.6 — Final regression gate + PR preparation
**Goal ID:** G-6
**Acceptance Criteria:**
- [ ] Full `npm test` green with zero skipped tests
- [ ] `tsc --noEmit` passes with zero errors
- [ ] No `@ts-ignore` or `@ts-expect-error` introduced by migration (except pre-existing)
- [ ] Test count: net positive per Appendix D (minimum 25 new, 3 deleted = net +22)
- [ ] `KNOWN_DIFFS` allowlist from Task 302.1 contains zero unexpired entries
- [ ] Statement/branch coverage for protocol modules: no decrease
- [ ] Squash merge PR created with comprehensive description
- [ ] PR description includes: migration summary, breaking change handling, rollback procedure
**Files:** verification + PR creation
**Estimate:** M
**Depends on:** 303.1, 303.2, 303.3, 303.4, 303.5

---

## Appendix A: Sprint Summary

| Sprint | Global ID | Tasks | Key Deliverables |
|--------|-----------|-------|-----------------|
| Foundation | 300 | 6 | v7.0.0 installed, export audit, extension modules |
| Consumer Migration | 301 | 5 | 40+ files migrated, vendored files deleted |
| Breaking Changes | 302 | 5 | trust_scopes, coordination schema, conservation dual-run |
| CI & Conformance | 303 | 6 | Drift detection, conformance gate, final regression |

**Total tasks:** 22
**Total estimated new tests:** 25+
**Total estimated deleted tests:** 3
**Net test change:** +22

## Appendix B: Critical Path

```
300.1 → 300.2 → 300.3 ─┬→ 300.4
                        ├→ 300.5
                        └→ 300.6
                             │
         ┌───────────────────┘
         ▼
301.1 ─┐
301.2 ─┤→ 301.5 (freeze snapshot + delete vendored)
301.3 ─┘     │
301.4 ───────┘
                │
         ┌──────┘
         ▼
302.1 (dual-run) ─┐
302.2 (independent)┤
302.3 (JWT) ───────┤→ 302.5 (boundary compat)
302.4 (coord) ─────┘
                │
         ┌──────┘
         ▼
303.1 → 303.2
303.3
303.4 → 303.5
              └→ 303.6 (final gate)
```

## Appendix C: Goal Traceability Matrix

| Goal | Sprint Tasks | Verification |
|------|-------------|-------------|
| G-1 (v7.0.0 upgrade) | 300.2, 300.3, 301.4 | CONTRACT_VERSION === '7.0.0' + lockfile SHA |
| G-2 (delete vendored) | 300.3, 300.4, 300.6, 301.1-301.5, 303.4, 303.5 | Zero vendored files remain |
| G-3 (breaking changes) | 300.5, 302.3, 302.4, 302.5 | trust_scopes tests + coordination compat tests |
| G-4 (CI drift detection) | 303.1, 303.2 | Three-layer drift test green |
| G-5 (conservation) | 300.6, 302.1, 302.2, 303.3 | Dual-run + independent + conformance |
| G-6 (zero regressions) | 300.1, 301.5, 302.5, 303.6 | Full npm test green, zero skipped |

## Appendix D: Test Count Enumeration

### New Test Files (minimum 25 tests)

| Task | Test File | Min Tests | Description |
|------|-----------|-----------|-------------|
| 302.1 | `tests/unit/protocol/conservation-dual-run.test.ts` | 6 | Dual-run: 14 invariants match (1), overflow edge (1), zero edge (1), terminal transition (1), concurrent reservations (1), coverage counter (1) |
| 302.2 | `tests/unit/protocol/conservation-independent.test.ts` | 4 | Independent: credits==debits (1), reserved<=available (1), no negative post-finalization (1), fast-check 100+ runs (1) |
| 302.3 | `tests/unit/protocol/jwt-boundary-v7.test.ts` | 8 | JWT: v7 round-trip (1), v4.6 trust_level accepted (1), v7 trust_scopes accepted (1), both rejected (1), neither rejected (1), level=9 no admin (1), out-of-range rejected (1), post-norm validation (1) |
| 302.4 | `tests/unit/protocol/version-negotiation.test.ts` | 3 | Negotiation: v7 accepted (1), v4.6 normalized (1), missing version rejected (1) |
| 302.5 | `tests/unit/protocol/boundary-compat.test.ts` | 2 | Compat: feature flag toggle (1), malformed rejected (1) |
| 303.1 | `tests/unit/protocol/drift-detection.test.ts` | 3 | Drift: Layer 1 CONTRACT_VERSION (1), Layer 2 package identity (1), Layer 3 no vendored files (1) |
| **Total** | **6 new test files** | **26** | |

### Deleted Test Files (3 tests)

| Task | Deleted File/Tests | Count | Reason |
|------|-------------------|-------|--------|
| 303.2 | `themes/sietch/scripts/gen-protocol-fixtures.ts` | 0 | Script, not a test file |
| 303.2 | `themes/sietch/tests/fixtures/protocol-hashes.json` | 0 | Fixture, not a test file |
| 301.3 | 3 hash-pinning assertions in existing conformance tests | 3 | Hash-pinning replaced by drift-detection Layer 2 |

### Net Count

- **New:** 26 minimum (≥25 requirement met)
- **Deleted:** 3 assertions removed from existing conformance tests (Task 301.3)
- **Net:** +23 (≥+22 requirement met)
