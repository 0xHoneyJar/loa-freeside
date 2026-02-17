# Sprint Plan: The Weirding Way — Protocol Convergence & Economic Formalization

**Cycle:** cycle-033
**PRD:** v1.1.0 (GPT-approved)
**SDD:** v1.1.0 (GPT-approved)
**Sprints:** 5 (global IDs: 295-299)
**Team:** 1 AI agent (solo)
**Duration:** ~2-3 hours per sprint

---

## Overview

| Parameter | Value |
|-----------|-------|
| Total sprints | 5 |
| Sprint size | 1 agent session each |
| Global sprint IDs | 295-299 |
| Estimated total tasks | 23 |
| Predecessor | cycle-032 (sprints 292-294) |

### Sprint Summary

| Sprint | Title | Global ID | Key Deliverable |
|--------|-------|-----------|-----------------|
| 1 | Merge & EntryType Foundation | 295 | PR #67 merged + const-array EntryType + sqlite_master validation |
| 2 | State Machine Equivalence & Branded Types | 296 | 4 protocol machines verified + MicroUSD/BasisPoints branded + 10+ migrations |
| 3 | Conservation Properties Formalization | 297 | 14 invariants formalized + 28 tests (positive + counterexample) |
| 4 | Cross-System E2E Harness | 298 | JWT boundary module + 7+ E2E scenarios with conservation verification |
| 5 | Migration 060 FK Corruption Fix | 299 | Safe table-rebuild migration + FK integrity regression tests |

---

## Sprint 1: Merge & EntryType Foundation (Sprint 295)

**Goal:** Merge PR #67 to establish clean main, then consolidate EntryType taxonomy as the single-source-of-truth pattern for subsequent sprints.

**Dependencies:** None — executes first.

### Task 1.1: Merge PR #67 to main (FR-6)

**Description:** Run full test suite on current feature branch, merge PR #67 via `gh pr merge`, verify main CI is green.

**Acceptance Criteria:**
- [ ] Full test suite passes on feature branch pre-merge
- [ ] PR #67 merged to main (merge commit, not squash — preserve sprint history)
- [ ] Main branch CI verified green post-merge
- [ ] Feature branch can be safely deleted

**Estimated Effort:** Small (procedural)

### Task 1.2: EntryType const array source of truth (FR-5)

**Description:** Replace the manual `EntryType` union and `ProtocolEntryType` subset in `billing-types.ts` with a `const` array from which all types are derived.

**Files Modified:**
- `themes/sietch/src/packages/core/protocol/billing-types.ts`

**Acceptance Criteria:**
- [ ] `ENTRY_TYPES` const array is the single source (17 values)
- [ ] `EntryType = (typeof ENTRY_TYPES)[number]`
- [ ] `ProtocolEntryType = EntryType` (unified, no subset)
- [ ] Bidirectional compile-time assertion: `_AssertExact<EntryType, ProtocolEntryType> = true`
- [ ] `buildEntryTypeCheck(column)` generates SQL CHECK expression from array
- [ ] Apply same pattern to `SOURCE_TYPES` and `ENTITY_TYPES`
- [ ] TypeScript compiles clean across project

### Task 1.3: EntryType DB validation tests (FR-5)

**Description:** Create tests that verify EntryType TS/DB consistency using sqlite_master introspection (no migration changes needed). Comparison is **semantic** (set-based), not string-exact, to avoid brittleness across SQLite versions/formatting.

**Files Created:**
- Tests within existing test structure

**Acceptance Criteria:**
- [ ] Test: extract allowed literal set from sqlite_master CHECK expression (parse values, strip whitespace/quotes, normalize), compare sorted set against `[...ENTRY_TYPES].sort()` — must be identical sets
- [ ] Test: `buildEntryTypeCheck(column)` contains all 17 `ENTRY_TYPES` literals and references the provided column name
- [ ] Test: invalid entry type rejected by DB CHECK (insert test)
- [ ] Comparison is set-based (not exact string equality) to tolerate formatting/quoting differences across SQLite versions
- [ ] All tests pass against fresh-migrated DB

---

## Sprint 2: State Machine Equivalence & Branded Types (Sprint 296)

**Goal:** Verify arrakis's 4 protocol state machines against loa-hounfour canonical definitions, and introduce branded types for compile-time unit safety.

**Dependencies:** Sprint 1 (clean main + const-array pattern established)

### Task 2.1: VENDORED_FROM provenance constant (FR-1)

**Description:** Add the upstream provenance constant to `state-machines.ts` recording the loa-hounfour commit SHA, date, and PR reference.

**Files Modified:**
- `themes/sietch/src/packages/core/protocol/state-machines.ts`

**Acceptance Criteria:**
- [ ] `VENDORED_FROM` constant exported with `repo`, `commit`, `date`, `pr` fields
- [ ] Commit SHA matches loa-hounfour PR #2 merge commit

### Task 2.2: Hash fixture and canonical machines oracle (FR-1)

**Description:** Generate the upstream-anchored hash fixture from loa-hounfour at the pinned commit, and create the canonical machines JSON snapshot for structural equivalence testing. A reproducible generation script is committed alongside the fixtures.

**Files Created:**
- `tests/fixtures/protocol-hashes.json` — upstream-anchored SHA-256 hashes
- `tests/fixtures/canonical-machines.json` — normalized state machine oracle
- `scripts/gen-protocol-fixtures.ts` — reproducible fixture generation script

**Acceptance Criteria:**
- [ ] `protocol-hashes.json` schema v2 with `upstream.repo`, `upstream.commit`, per-artifact `upstream_sha256`
- [ ] Hashes computed from loa-hounfour at pinned commit (documented generation protocol)
- [ ] `canonical-machines.json` with normalized states/transitions/initial/terminals for all 4 protocol machines
- [ ] Normalization rules: alphabetical sorting, deduplication
- [ ] `scripts/gen-protocol-fixtures.ts` committed: clones/checks out the exact upstream commit, computes hashes, emits both JSON fixtures
- [ ] Running the script from a clean checkout reproduces identical fixture files
- [ ] Fallback documented: if network unavailable, a vendored upstream snapshot in `tests/fixtures/upstream-snapshot/` can be used instead
- [ ] Required access documented (GitHub public repo clone; no auth needed)

### Task 2.3: State machine equivalence test suite (FR-1)

**Description:** Create the full equivalence test suite: hash drift detection, structural oracle comparison, domain conformance checks.

**Files Created:**
- `tests/unit/protocol/state-machine-equivalence.test.ts`

**Acceptance Criteria:**
- [ ] Hash drift test: each vendored file hash matches `protocol-hashes.json` upstream_sha256
- [ ] VENDORED_FROM.commit matches fixture source commit
- [ ] Negative test: tampered content produces different hash
- [ ] Structural equivalence: for each of 4 machines, compare normalized actual vs canonical oracle (states, transitions, initial, terminals)
- [ ] Domain conformance: PayoutStateMachine, CampaignAdapter, FraudRulesService don't violate protocol terminal states
- [ ] All tests pass

### Task 2.4: Branded type definitions and overloads (FR-4)

**Description:** Define `MicroUSD`, `BasisPoints`, `AccountId` branded types with constructors and backward-compatible overloads for public API functions.

**Files Modified:**
- `themes/sietch/src/packages/core/protocol/arithmetic.ts`

**Acceptance Criteria:**
- [ ] `MicroUSD = bigint & { readonly __brand: 'micro_usd' }` exported
- [ ] `BasisPoints = bigint & { readonly __brand: 'basis_points' }` exported
- [ ] `AccountId = string & { readonly __brand: 'account_id' }` exported
- [ ] Constructor functions: `microUSD()`, `basisPoints()`, `accountId()` with range validation
- [ ] Branded overloads ABOVE unbranded for: `bpsShare`, `assertBpsSum`, `assertMicroUSD`, `addMicroUSD`, `subtractMicroUSD`
- [ ] TypeScript resolves branded overload when branded args passed
- [ ] Unbranded overload preserved for backward compatibility
- [ ] TypeScript compiles clean

### Task 2.5: Branded type compile-time tests (FR-4)

**Description:** Create tests verifying branded types prevent assignment and that constructors validate ranges.

**Files Created:**
- `tests/unit/protocol/branded-types.test.ts`

**Acceptance Criteria:**
- [ ] `@ts-expect-error`: plain bigint not assignable to MicroUSD
- [ ] `@ts-expect-error`: plain bigint not assignable to BasisPoints
- [ ] `@ts-expect-error`: plain string not assignable to AccountId
- [ ] Runtime test: `microUSD(-1n)` throws RangeError
- [ ] Runtime test: `basisPoints(10001n)` throws RangeError
- [ ] Runtime test: `accountId('')` throws RangeError
- [ ] Runtime test: `bpsShare(microUSD(1000000n), basisPoints(5000n))` returns MicroUSD

### Task 2.6: Branded type call-site migration (FR-4)

**Description:** Migrate minimum 10 high-value call sites to use branded types.

**Files Modified:**
- `CreditLedgerAdapter.ts` (3 sites: computeBalanceFromLots, snapshotBalance, reserve)
- `RevenueDistributionService.ts` (2 sites: distribute bps + amount)
- `ReconciliationService.ts` (2 sites: Check 1 + Check 4)
- `ConstitutionalGovernanceService.ts` (1 site: resolveParam)
- `PeerTransferService.ts` (1 site: transfer amount)
- `SettlementService.ts` (1 site: settle amount)

**Acceptance Criteria:**
- [ ] Minimum 10 call sites migrated
- [ ] TypeScript compiles clean
- [ ] All existing behavioral tests pass unchanged
- [ ] No runtime behavior changes (brands are compile-time only)

---

## Sprint 3: Conservation Properties Formalization (Sprint 297)

**Goal:** Formalize all 14 conservation invariants as testable temporal properties with positive and counterexample tests.

**Dependencies:** Sprint 2 (branded types for property metadata typing)

### Task 3.1: Conservation properties module with error taxonomy (FR-2)

**Description:** Create the `ConservationProperties` module defining all 14 invariants with metadata including universe/scope, enforcement mechanism, fairness models, and **expected error codes per invariant**. Also introduce `ConservationViolationError` and `ReconciliationFailureCode` to standardize what counterexample tests assert against.

**Files Created:**
- `themes/sietch/src/packages/core/protocol/conservation-properties.ts`

**Acceptance Criteria:**
- [ ] `ConservationProperty` interface: id, name, description, ltl, universe, kind, fairnessModel?, enforcedBy[], expectedErrorCode?
- [ ] `CONSERVATION_PROPERTIES` array with all 14 properties (I-1 through I-14)
- [ ] Each property has explicit enforcement mechanism classification (DB CHECK, Application, Reconciliation-only)
- [ ] Each application-enforced property has `expectedErrorCode` mapping (e.g., I-3 -> `RECEIVABLE_BOUND_EXCEEDED`, I-5 -> `BUDGET_OVERSPEND`)
- [ ] Each reconciliation-only property has `reconciliationFailureCode` (e.g., I-4 -> `PLATFORM_CONSERVATION_DRIFT`, I-13 -> `TREASURY_INADEQUATE`)
- [ ] `ConservationViolationError` class exported (extends Error, typed code field) for application-enforced violations
- [ ] Liveness properties (I-11, I-12) have explicit fairness models
- [ ] TypeScript compiles clean

### Task 3.2: BigInt-safe DB access helper (FR-2)

**Description:** Create the `parseLotBigInts()` helper and BigInt precision guard test.

**Files Created:**
- `tests/helpers/bigint-db.ts`

**Acceptance Criteria:**
- [ ] `parseLotBigInts(row)` parses all monetary columns to BigInt
- [ ] Guard test: insert value > 2^53, round-trip without precision loss
- [ ] Helper used consistently in all conservation tests

### Task 3.3: Conservation property positive tests (FR-2)

**Description:** Create positive property-based tests for all 14 invariants using fast-check. All monetary values must use BigInt end-to-end — from generation through arithmetic to assertion.

**Files Created:**
- `tests/unit/protocol/conservation-properties.test.ts`

**Acceptance Criteria:**
- [ ] 14 positive tests (one per invariant)
- [ ] Property-based tests use `fc.asyncProperty` with operation sequence arbitraries
- [ ] All monetary arbitraries use `fc.bigInt()` or custom bigint generators (no `fc.integer()` for monetary values)
- [ ] All monetary assertions use `parseLotBigInts()` for BigInt safety
- [ ] No `Number()`, `parseFloat()`, or `parseInt()` in any monetary code path — BigInt end-to-end
- [ ] Liveness tests (I-11, I-12) encode fairness assumptions in harness
- [ ] I-12: time advanced beyond TTL, ExpirationJob invoked at least once
- [ ] All tests pass with 100 runs per property

### Task 3.4: Conservation property counterexample tests (FR-2)

**Description:** Create counterexample tests for all 14 invariants, tailored to each property's enforcement mechanism.

**Acceptance Criteria:**
- [ ] 14 counterexample tests (one per invariant)
- [ ] DB CHECK-enforced (I-1, I-2, I-10): raw SQL UPDATE on seeded row -> constraint fires
- [ ] Application-enforced (I-3, I-5, I-7, I-8, I-11, I-14): call public API with violating request -> typed error
- [ ] Reconciliation-only (I-4, I-13): corrupt state, run reconcile() -> specific failure code
- [ ] DB UNIQUE-enforced (I-6, I-9): insert violating row -> constraint fires
- [ ] Each counterexample asserts on specific error type/code, not generic "throws"

---

## Sprint 4: Cross-System E2E Harness (Sprint 298)

**Goal:** Build the cross-system E2E test harness that proves conservation holds across the JWT boundary between arrakis and loa-finn.

**Dependencies:** Sprint 3 (conservation properties for post-scenario verification)

### Task 4.1: JWT boundary module (FR-3)

**Description:** Create `jwt-boundary.ts` with typed error taxonomy, zod claim schemas, and the `verifyUsageJWT` function using KeyObject + jose.

**Files Created:**
- `themes/sietch/src/packages/core/protocol/jwt-boundary.ts`

**Acceptance Criteria:**
- [ ] `JwtBoundaryError` class with `code: JwtErrorCode` and `permanent: boolean`
- [ ] Error codes: SIGNATURE_INVALID, ALGORITHM_REJECTED, CLAIMS_SCHEMA, RESERVATION_UNKNOWN, OVERSPEND, REPLAY, KEY_FETCH_FAILED
- [ ] `inboundClaimsSchema` (zod): validates jti UUID, finalized literal true, microUSD strings, bounded arrays/strings
- [ ] `OutboundClaims` and `InboundClaims` types
- [ ] `verifyUsageJWT(token, publicKey: KeyObject, idempotencyStore, activeReservations)` with 6-step verification
- [ ] Replay protection keyed by `jti` (not reservation_id)
- [ ] Algorithm restricted to EdDSA only
- [ ] TypeScript compiles clean

### Task 4.2: JWT test helper factory (FR-3)

**Description:** Create the test keypair generation and JWT signing helpers.

**Files Created:**
- `tests/helpers/jwt-factory.ts`

**Acceptance Criteria:**
- [ ] `createTestKeypairs()` returns `{ arrakis: KeyObject pair, loaFinn: KeyObject pair }`
- [ ] `signOutbound(claims, privateKey: KeyObject)` creates signed JWT
- [ ] `signInbound(claims, privateKey: KeyObject)` creates signed JWT
- [ ] CI guard test: KeyObject type + asymmetricKeyType === 'ed25519'
- [ ] CI guard test: jose accepts generated KeyObject for signing

### Task 4.3: Conservation assertion helper (FR-3)

**Description:** Create the `assertConservation()` helper that runs ReconciliationService post-scenario.

**Files Created:**
- `tests/helpers/conservation-check.ts`

**Acceptance Criteria:**
- [ ] `assertConservation(db)` runs full ReconciliationService.reconcile()
- [ ] Verifies all checks pass (I-1, I-2, I-4 minimum)
- [ ] Uses BigInt-safe row parsing throughout

### Task 4.4: Cross-system E2E positive scenarios (FR-3)

**Description:** Implement the 4 positive E2E scenarios with conservation verification.

**Files Created:**
- `tests/integration/cross-system-conservation.test.ts`

**Acceptance Criteria:**
- [ ] Happy path: reserve -> execute -> finalize (exact match) -> conservation check
- [ ] Partial use: reserve $1.00 -> use $0.60 -> finalize -> release $0.40 -> conservation check
- [ ] Timeout: reserve -> advance time -> expire -> conservation check
- [ ] Ensemble: reserve -> 3 model calls -> aggregate finalize -> conservation check
- [ ] All scenarios use real Ed25519 keypairs (not mocked)
- [ ] All scenarios end with `assertConservation(db)` passing

### Task 4.5: Cross-system E2E negative scenarios (FR-3)

**Description:** Implement negative scenarios covering **every `JwtErrorCode`** in the taxonomy, asserting on specific error codes. Includes BigInt precision guard for JWT claim round-trip.

**Acceptance Criteria:**
- [ ] Tampered JWT -> `JwtBoundaryError { code: 'SIGNATURE_INVALID', permanent: true }`
- [ ] Wrong algorithm (RS256) -> `JwtBoundaryError { code: 'ALGORITHM_REJECTED', permanent: true }`
- [ ] Missing required claim -> `JwtBoundaryError { code: 'CLAIMS_SCHEMA', permanent: true }`
- [ ] `finalized: false` -> `JwtBoundaryError { code: 'CLAIMS_SCHEMA', permanent: true }`
- [ ] Negative cost_micro -> `JwtBoundaryError { code: 'CLAIMS_SCHEMA', permanent: true }`
- [ ] Unknown reservation_id (valid JWT, non-existent reservation) -> `JwtBoundaryError { code: 'RESERVATION_UNKNOWN', permanent: true }`
- [ ] Replay (same jti twice) -> `JwtBoundaryError { code: 'REPLAY', permanent: true }`
- [ ] Different jti, same reservation -> allowed (not replay)
- [ ] Over-spend -> `JwtBoundaryError { code: 'OVERSPEND', permanent: true }`
- [ ] KEY_FETCH_FAILED: clarified as higher-layer error (key provisioning, not boundary verification) — documented in jwt-boundary.ts JSDoc; unit test verifies the error class can be constructed with this code
- [ ] **Every `JwtErrorCode` has at least one test** (full taxonomy coverage)
- [ ] BigInt precision guard: JWT with `actual_cost_micro` > 2^53 round-trips through sign->verify->parse without precision loss
- [ ] Conservation remains intact after each rejected scenario (no partial state mutation from failed verification)

---

## Dependency Graph

```
Sprint 1 (Merge & EntryType)
  ├── Task 1.1 (Merge PR #67) ─────→ Clean main established
  ├── Task 1.2 (Const array) ──────→ Pattern for Sprint 2
  └── Task 1.3 (DB validation) ────→ sqlite_master introspection

Sprint 2 (State Machines & Branded Types) — depends on Sprint 1
  ├── Task 2.1 (VENDORED_FROM) ──┐
  ├── Task 2.2 (Hash + Oracle) ──┤→ Task 2.3 (Equivalence tests)
  ├── Task 2.4 (Branded types) ──┤→ Task 2.5 (Compile tests)
  └── Task 2.6 (Migration) ─────→ Sprint 3 (typed properties)

Sprint 3 (Conservation Properties) — depends on Sprint 2
  ├── Task 3.1 (Properties module) ─→ Task 3.3, 3.4
  ├── Task 3.2 (BigInt helper) ─────→ Task 3.3, 3.4
  ├── Task 3.3 (Positive tests) ────→ Sprint 4
  └── Task 3.4 (Counterexamples) ──→ Sprint 4

Sprint 4 (Cross-System E2E) — depends on Sprint 3
  ├── Task 4.1 (JWT module) ──────┐
  ├── Task 4.2 (JWT factory) ─────┤→ Task 4.4, 4.5
  ├── Task 4.3 (Conservation helper)┤
  ├── Task 4.4 (Positive E2E) ────→ Conservation verified
  └── Task 4.5 (Negative E2E) ────→ Error taxonomy verified
```

---

## Risk Mitigation

| Risk | Sprint | Mitigation |
|------|--------|------------|
| PR #67 merge conflict | 1 | Conflicts already resolved in cycle-032; re-run merge only |
| Canonical machine oracle drift | 2 | Oracle generated from pinned commit; deliberate update required |
| Branded overloads confuse IDE | 2 | Branded listed first (TypeScript resolves top-down); JSDoc |
| Property tests slow | 3 | 100 runs per property (configurable via NUM_PROPERTY_RUNS env) |
| BigInt precision in SQLite | 3 | Guard test + parseLotBigInts() enforced in all tests |
| Ed25519 not available in test env | 4 | jose handles cross-platform; CI guard test validates key type |

---

## Sprint 5: Migration 060 FK Corruption Fix (Sprint 299)

**Goal:** Fix the production-risk SQLite table-rebuild bug in migration 060 where `ALTER TABLE RENAME` corrupts foreign key references in `credit_ledger`, and add FK integrity regression tests to prevent recurrence.

**Dependencies:** Soft dependency on Sprints 1-4 (Task 5.2 conditionally modifies test files created in those sprints). Sprint 5 CAN run before Sprints 1-4 — Task 5.1 and 5.3 are fully independent, and Task 5.2 is conditional (only modifies files that exist). Recommended order: run Sprint 5 first (fixes the migration before building more tests on top of it).

**Context:** Migration 060 (`060_credit_lots_tba_source.ts`) rebuilds `credit_lots` to add `'tba_deposit'` to the `source_type` CHECK constraint. It uses `ALTER TABLE credit_lots RENAME TO _credit_lots_058_backup`, which causes SQLite (with `legacy_alter_table = OFF`, the default since 3.26.0) to **automatically update FK references in other tables** to point to the backup name. When the backup is dropped, `credit_ledger.lot_id REFERENCES credit_lots(id)` becomes a dangling reference to `_credit_lots_058_backup`. The `up()` function's `foreign_key_check` pragma doesn't catch schema-level FK target corruption — it only validates row-level referential integrity.

**Evidence:** Three separate test files already work around this bug:
- `billing-agent-sovereignty.test.ts` — uses inline DROP+CREATE instead of importing CREDIT_LOTS_REBUILD_SQL
- `cross-system-conservation.test.ts` — omits migration 060 entirely with explanatory comment
- `entry-types-consistency.test.ts` — uses `foreign_keys = OFF` workaround

### Task 5.1: Rewrite CREDIT_LOTS_REBUILD_SQL with safe pattern

**Description:** Replace the `ALTER TABLE RENAME` approach with the safe **CREATE-new → COPY → RENAME-old → RENAME-new → DROP-old** pattern. The old table is kept alive until the new table is fully populated and renamed into place. This ensures no intermediate state where `credit_lots` doesn't exist — if anything fails between steps, the original table is still available under its original name or as `_credit_lots_old`.

**Files Modified:**
- `themes/sietch/src/db/migrations/060_credit_lots_tba_source.ts`

**Safe SQL Sequence:**
```sql
-- Guard: clean up any partial previous run
DROP TABLE IF EXISTS _credit_lots_new;
DROP TABLE IF EXISTS _credit_lots_old;

-- Step 1: Create new table with updated CHECK constraint
CREATE TABLE _credit_lots_new (...tba_deposit included...);

-- Step 2: Copy all data
INSERT INTO _credit_lots_new SELECT * FROM credit_lots;

-- Step 3: Swap (old table preserved until step 5)
ALTER TABLE credit_lots RENAME TO _credit_lots_old;
ALTER TABLE _credit_lots_new RENAME TO credit_lots;

-- Step 4: Recreate indexes on new credit_lots
CREATE INDEX IF NOT EXISTS ...;

-- Step 5: Drop old table only after everything succeeds
DROP TABLE _credit_lots_old;
```

**Acceptance Criteria:**
- [ ] `CREDIT_LOTS_REBUILD_SQL` starts with `DROP TABLE IF EXISTS _credit_lots_new; DROP TABLE IF EXISTS _credit_lots_old;` (idempotency guards for partial-failure recovery)
- [ ] Creates `_credit_lots_new` with the updated CHECK constraint
- [ ] Data copied: `INSERT INTO _credit_lots_new SELECT * FROM credit_lots`
- [ ] Old table renamed (not dropped): `ALTER TABLE credit_lots RENAME TO _credit_lots_old`
- [ ] New table renamed into place: `ALTER TABLE _credit_lots_new RENAME TO credit_lots`
- [ ] Old table dropped last: `DROP TABLE _credit_lots_old` (only after swap succeeds)
- [ ] Indexes recreated on the final `credit_lots` table after rename
- [ ] `up()` function wraps in FK OFF + BEGIN/COMMIT + FK ON
- [ ] `up()` adds **schema-level FK target verification** after the rebuild: query `PRAGMA foreign_key_list(credit_ledger)`, `PRAGMA foreign_key_list(reservation_lots)`, `PRAGMA foreign_key_list(credit_debts)` and assert referenced table is `credit_lots` (not `_credit_lots_old` or `_credit_lots_058_backup`)
- [ ] `up()` runs `PRAGMA foreign_key_check` for row-level integrity (existing behavior)
- [ ] Idempotency: early-return if `tba_deposit` is already present in `credit_lots` CHECK constraint (introspect `sqlite_master` for the table's SQL, check if `'tba_deposit'` literal exists)
- [ ] `CREDIT_LOTS_REBUILD_ROLLBACK_SQL` unchanged (no-op is fine)

### Task 5.2: Remove test workarounds

**Description:** Now that `CREDIT_LOTS_REBUILD_SQL` is FK-safe, remove inline DROP+CREATE workarounds from test helpers and use the migration SQL directly. This task is **conditional** — it applies to whichever test files exist in the current codebase at execution time. If Sprint 5 runs before Sprints 1-4, some files may not exist yet; the task only modifies files that already contain the workaround pattern.

**Files Modified (conditional — only if they exist and contain workarounds):**
- `themes/sietch/tests/integration/billing-agent-sovereignty.test.ts` — replace inline DROP+CREATE with `testDb.exec(CREDIT_LOTS_REBUILD_SQL)` import
- `themes/sietch/tests/integration/cross-system-conservation.test.ts` — add `testDb.exec(CREDIT_LOTS_REBUILD_SQL)` where it was omitted
- `themes/sietch/tests/conformance/entry-types-consistency.test.ts` — verify it works with FK ON after migration

**Acceptance Criteria:**
- [ ] All test files that contain inline `credit_lots` DROP+CREATE workarounds are updated to import and use `CREDIT_LOTS_REBUILD_SQL` instead
- [ ] All test files that omit migration 060 with a comment about FK corruption now include it
- [ ] All modified test files pass with `foreign_keys = ON` enabled after running migrations
- [ ] No inline credit_lots schema duplication remains in existing test files (single source of truth is migration 060)
- [ ] If a referenced test file does not yet exist (Sprint 5 run before Sprint 4), skip that file — it will be created correctly in the later sprint

### Task 5.3: FK integrity regression test

**Description:** Create a dedicated test that runs the **exact production migration sequence** on a fresh in-memory DB, then verifies all FK references are valid at both schema level (FK targets exist) and row level (FK values reference existing rows). This uses the same migration runner/ordering used in production to ensure the test reproduces the exact state where the bug occurs.

**Files Created:**
- `themes/sietch/tests/conformance/migration-fk-integrity.test.ts`

**Acceptance Criteria:**
- [ ] Test creates fresh in-memory DB
- [ ] Uses the **production migration runner** (same function/module that applies migrations in the real app) to run all migrations from first to latest — NOT a hand-picked subset
- [ ] If no programmatic migration runner exists, imports and executes every migration's `up()` function in the exact order used in production (determined by filename sort or migration registry)
- [ ] `PRAGMA foreign_keys = ON` after all migrations complete
- [ ] **Row-level check**: `PRAGMA foreign_key_check` returns empty array (no FK violations)
- [ ] **Schema-level check**: For every table in `sqlite_master` that has FK references, query `PRAGMA foreign_key_list(<table>)` and verify the `table` column (referenced table) exists in `sqlite_master`
- [ ] Specifically verifies: `credit_ledger.lot_id` references `credit_lots` (not `_credit_lots_058_backup` or `_credit_lots_old`)
- [ ] Specifically verifies: `reservation_lots.lot_id` references `credit_lots`
- [ ] Specifically verifies: `credit_debts.source_lot_id` references `credit_lots`
- [ ] Test fails if any migration is skipped or run out of order
- [ ] Test passes with no workarounds (no FK=OFF, no inline schema overrides)

### Task 5.4: Full regression suite

**Description:** Run the complete test suite to verify no regressions from the migration rewrite.

**Acceptance Criteria:**
- [ ] All 17 cross-system-conservation tests pass
- [ ] All billing-agent-sovereignty tests pass
- [ ] All entry-types-consistency tests pass
- [ ] All conservation-properties tests pass
- [ ] Full regression suite: no new failures introduced
- [ ] Migration FK integrity test passes

---

## Dependency Graph (Updated)

```
Sprint 1 (Merge & EntryType)
  ├── Task 1.1 (Merge PR #67) ─────→ Clean main established
  ├── Task 1.2 (Const array) ──────→ Pattern for Sprint 2
  └── Task 1.3 (DB validation) ────→ sqlite_master introspection

Sprint 2 (State Machines & Branded Types) — depends on Sprint 1
  ├── Task 2.1 (VENDORED_FROM) ──┐
  ├── Task 2.2 (Hash + Oracle) ──┤→ Task 2.3 (Equivalence tests)
  ├── Task 2.4 (Branded types) ──┤→ Task 2.5 (Compile tests)
  └── Task 2.6 (Migration) ─────→ Sprint 3 (typed properties)

Sprint 3 (Conservation Properties) — depends on Sprint 2
  ├── Task 3.1 (Properties module) ─→ Task 3.3, 3.4
  ├── Task 3.2 (BigInt helper) ─────→ Task 3.3, 3.4
  ├── Task 3.3 (Positive tests) ────→ Sprint 4
  └── Task 3.4 (Counterexamples) ──→ Sprint 4

Sprint 4 (Cross-System E2E) — depends on Sprint 3
  ├── Task 4.1 (JWT module) ──────┐
  ├── Task 4.2 (JWT factory) ─────┤→ Task 4.4, 4.5
  ├── Task 4.3 (Conservation helper)┤
  ├── Task 4.4 (Positive E2E) ────→ Conservation verified
  └── Task 4.5 (Negative E2E) ────→ Error taxonomy verified

Sprint 5 (Migration Fix) — SOFT dependency on Sprints 1-4 (Task 5.2 conditional)
  ├── Task 5.1 (Rewrite migration) ─→ Task 5.2, Task 5.3
  ├── Task 5.2 (Remove workarounds) ─→ Task 5.4 (conditional on existing files)
  ├── Task 5.3 (FK regression test) ─→ Task 5.4
  └── Task 5.4 (Full regression) ───→ Verified
```

---

## Risk Mitigation (Updated)

| Risk | Sprint | Mitigation |
|------|--------|------------|
| PR #67 merge conflict | 1 | Conflicts already resolved in cycle-032; re-run merge only |
| Canonical machine oracle drift | 2 | Oracle generated from pinned commit; deliberate update required |
| Branded overloads confuse IDE | 2 | Branded listed first (TypeScript resolves top-down); JSDoc |
| Property tests slow | 3 | 100 runs per property (configurable via NUM_PROPERTY_RUNS env) |
| BigInt precision in SQLite | 3 | Guard test + parseLotBigInts() enforced in all tests |
| Ed25519 not available in test env | 4 | jose handles cross-platform; CI guard test validates key type |
| Migration rewrite breaks production DB | 5 | New migration is semantically identical; same CHECK constraint, same data; foreign_key_check verifies post-migration |
| Test helpers depend on workaround behavior | 5 | Task 5.2 explicitly removes all workarounds and verifies FK ON works |

---

## Success Metrics (Updated)

| Metric | Target |
|--------|--------|
| Protocol machines verified | 4/4 |
| Conservation invariants formalized | 14/14 |
| Positive + counterexample tests | 28 minimum |
| Cross-system E2E scenarios | 7+ (4 positive, 3+ negative) |
| Branded type call sites migrated | 10+ |
| EntryType TS/DB consistency | Verified via sqlite_master |
| PR #67 merged | Yes |
| Migration 060 FK corruption | Fixed — no dangling FK references |
| FK integrity regression test | Passes for all tables |
| Test workaround count | 0 (all inline schema duplication removed) |
