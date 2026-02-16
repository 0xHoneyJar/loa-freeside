# Sprint Plan: Pre-Merge Excellence — Bug Fixes & Merge Readiness

**Version:** 1.0.0
**Date:** 2026-02-16
**Cycle:** cycle-032
**PRD:** `grimoires/loa/prd.md` v1.0.0 (GPT-5.2 APPROVED iteration 2)
**SDD:** `grimoires/loa/sdd.md` v1.0.0 (GPT-5.2 APPROVED iteration 2)

---

## Overview

| Parameter | Value |
|-----------|-------|
| Total sprints | 3 |
| Sprint size | 1 agent session each |
| Global sprint IDs | 292-294 |
| Estimated total tasks | ~15 |
| Predecessor | cycle-031 (sprints 284-291) |

### Sprint Summary

| Sprint | Title | Global ID | Key Deliverable |
|--------|-------|-----------|-----------------|
| 1 | Schema & Type Fixes | 292 | Migration amendments (056, 057) + EntryType extension + SqliteTimestamp branded type |
| 2 | Service Logic Fixes | 293 | ReconciliationService Check 5 + PeerTransferService entry type + balance audit |
| 3 | Integration Tests & Merge Prep | 294 | Full test suite green + merge conflict resolution |

---

## Sprint 1: Schema & Type Fixes (Sprint 292)

**Goal:** Fix the foundation — migration constraints and type system — before touching service logic
**PRD refs:** FR-2, FR-3 (schema), FR-4, G-2, G-3, G-4
**SDD refs:** §2.2, §2.3 (items 1-2), §2.4, §3.1

### Tasks

#### Task 1.1: Add `'transfer_in'` to EntryType union

**Description:** Add `'transfer_in'` to the `EntryType` union type in `billing-types.ts`. This is a compile-time type extension only.
**File(s):** `themes/sietch/src/packages/core/protocol/billing-types.ts` (~line 89)
**Acceptance Criteria:**
- [ ] `EntryType` union includes `'transfer_in'` alongside `'transfer_out'`
- [ ] TypeScript compiles without errors

#### Task 1.2: Amend migration 056 — add `'transfer_in'` to credit_ledger CHECK

**Description:** In the `CREDIT_LEDGER_REBUILD_SQL` within migration 056, add `'transfer_in'` to the entry_type CHECK constraint list (alongside `'transfer_out'` at line ~77). This migration is pre-merge and safe to amend.
**File(s):** `themes/sietch/src/db/migrations/056_peer_transfers.ts` (lines 56-100)
**Gating check:** Verify migration 056 exists only on the feature branch and has never been applied in any shared/production environment. Run `git log main -- themes/sietch/src/db/migrations/056_peer_transfers.ts` — must return empty. If 056 has shipped, create a new migration (058) with table rebuild instead.
**Acceptance Criteria:**
- [ ] Gating check confirms 056 is feature-branch-only (not on main)
- [ ] credit_ledger CHECK constraint includes `'transfer_in'`
- [ ] `INSERT INTO credit_ledger ... entry_type='transfer_in'` succeeds
- [ ] Existing entry types still accepted
- [ ] Fresh migrate-from-zero succeeds with updated migration

#### Task 1.3: Amend migration 057 — compound CHECK on tba_deposits amount_micro

**Description:** Replace `CHECK (amount_micro >= 0)` with a compound state-dependent CHECK that enforces `amount_micro > 0` only for the terminal `'bridged'` state. Non-terminal states (`'detected'`, `'confirmed'`, `'failed'`) allow `amount_micro = 0`.
**File(s):** `themes/sietch/src/db/migrations/057_tba_deposits.ts`
**Gating check:** Verify migration 057 exists only on the feature branch and has never been applied in any shared/production environment. Run `git log main -- themes/sietch/src/db/migrations/057_tba_deposits.ts` — must return empty. If 057 has shipped, create a new forward migration that handles existing data before adding the stricter CHECK.
**Acceptance Criteria:**
- [ ] Gating check confirms 057 is feature-branch-only (not on main)
- [ ] `INSERT INTO tba_deposits (status='detected', amount_micro=0)` succeeds
- [ ] `INSERT INTO tba_deposits (status='confirmed', amount_micro=0)` succeeds
- [ ] `INSERT INTO tba_deposits (status='failed', amount_micro=0)` succeeds
- [ ] `INSERT INTO tba_deposits (status='bridged', amount_micro=0)` fails (CHECK violation)
- [ ] `INSERT INTO tba_deposits (status='bridged', amount_micro=1000000)` succeeds
- [ ] Full bridge flow: `detected(0)` → `confirmed(0)` → `bridged(amount>0)` succeeds
- [ ] Fresh migrate-from-zero succeeds with updated migration

#### Task 1.4: Introduce SqliteTimestamp branded type

**Description:** Define `SqliteTimestamp` branded type, update `sqliteTimestamp()` and `sqliteFutureTimestamp()` return types, add `parseSqliteTimestamp()` boundary function for DB reads.
**File(s):** `themes/sietch/src/packages/adapters/billing/protocol/timestamps.ts`
**Acceptance Criteria:**
- [ ] `SqliteTimestamp` type exported: `string & { readonly __brand: 'sqlite_ts' }`
- [ ] `sqliteTimestamp()` returns `SqliteTimestamp`
- [ ] `sqliteFutureTimestamp()` returns `SqliteTimestamp`
- [ ] `parseSqliteTimestamp(raw)` validates format via `isSqliteFormat()` and brands
- [ ] `parseSqliteTimestamp('2026-02-16T14:30:00.000Z')` throws (ISO rejected)
- [ ] `parseSqliteTimestamp('2026-02-16 14:30:00')` succeeds

#### Task 1.5: Update typed surfaces for SqliteTimestamp

**Description:** Update insert/update parameter types and row model interfaces in cycle-031 services to use `SqliteTimestamp`. Row mappers must use `parseSqliteTimestamp()` for `*_at` fields.
**File(s):** PeerTransferService.ts, TbaDepositBridge.ts, AgentGovernanceService.ts, ReconciliationService.ts
**Acceptance Criteria:**
- [ ] Insert/update `*_at` parameters typed as `SqliteTimestamp`
- [ ] Row model `*_at` fields typed as `SqliteTimestamp`
- [ ] Row mappers use `parseSqliteTimestamp()` for DB reads
- [ ] Compile-time test: `// @ts-expect-error` on `new Date().toISOString()` where `SqliteTimestamp` expected
- [ ] TypeScript compiles without errors

---

## Sprint 2: Service Logic Fixes (Sprint 293)

**Goal:** Fix the service-level bugs — wrong table reference, wrong entry type, balance verification
**PRD refs:** FR-1, FR-3 (service logic), G-1, G-3
**SDD refs:** §2.1, §2.3 (items 3-4)
**Dependencies:** Sprint 1 (schema and types must be in place)

### Tasks

#### Task 2.1: Fix ReconciliationService Check 5 table reference

**Description:** In `checkTransferConservation()`, verify Check 5a SQL query references `credit_ledger` (not `ledger_entries`). Fix if wrong. Replace silent skip pattern (`{ skipped: true }`) with structured error reporting (`{ status: 'failed', error: '...' }`). The `reconcile()` method must never throw for check-level errors — always return a complete report. Also update the reconciliation report type/interface and any downstream callers/tests that expect the `{ skipped: true }` shape.
**File(s):** `themes/sietch/src/packages/adapters/billing/ReconciliationService.ts` (lines 308-375), report type definitions, existing reconciliation tests
**Acceptance Criteria:**
- [ ] Check 5a queries `credit_ledger` table
- [ ] No `{ skipped: true }` pattern for SQL errors — replaced with `{ status: 'failed', error }`
- [ ] Reconciliation report type/interface updated to reflect new `{ status: 'failed', error }` shape
- [ ] Downstream callers/tests updated — no references to `{ skipped: true }` remain
- [ ] `reconcile()` returns complete report even when a check's SQL is invalid (does not throw)
- [ ] Check 5 returns `status: 'passed'` with completed transfers present
- [ ] TypeScript compiles without errors after type changes

#### Task 2.2: Change recipient entry type to `'transfer_in'`

**Description:** In `PeerTransferService.ts`, change the recipient ledger entry from `entry_type = 'deposit'` to `entry_type = 'transfer_in'`. The sender side already uses `'transfer_out'`. Ensure the test harness uses a clean DB with the updated migration 056 CHECK constraint (which now includes `'transfer_in'`).
**File(s):** `themes/sietch/src/packages/adapters/billing/PeerTransferService.ts` (~line 343)
**Acceptance Criteria:**
- [ ] Recipient ledger entries use `entry_type = 'transfer_in'`
- [ ] Sender ledger entries still use `entry_type = 'transfer_out'`
- [ ] Test harness migrates from a clean DB (no cached schema from prior migrations)
- [ ] Transfer integration test passes with the updated CHECK constraint accepting `'transfer_in'`

#### Task 2.3: Audit and update balance computation for `'transfer_in'`

**Description:** Identify the balance query function(s) that aggregate credit_ledger entries. Verify `'transfer_in'` entries are treated as credit-increasing (equivalent to `'deposit'`). If queries filter by specific entry_types, add `'transfer_in'` to the filter.
**File(s):** CreditLedgerService or equivalent balance computation code
**Acceptance Criteria:**
- [ ] Balance computation includes `'transfer_in'` entries as credits
- [ ] Test: recipient account balance is correct after receiving a transfer with `entry_type = 'transfer_in'`
- [ ] No balance regression compared to previous `'deposit'` behavior

#### Task 2.4: Verify ReconciliationService Check 5 end-to-end

**Description:** With `'transfer_in'` entries now created by PeerTransferService and Check 5 querying the correct table, verify the full transfer conservation check passes without false divergences.
**File(s):** ReconciliationService.ts, integration test
**Acceptance Criteria:**
- [ ] Check 5 passes with completed transfers (no false divergences)
- [ ] Check 5 correctly detects actual conservation violations (negative test)
- [ ] Conservation stress test passes

---

## Sprint 3: Integration Tests & Merge Prep (Sprint 294)

**Goal:** Verify all fixes work together, ensure existing tests pass, resolve merge conflicts
**PRD refs:** FR-5, G-5, G-6
**SDD refs:** §2.5, §4
**Dependencies:** Sprints 1 and 2 complete

### Tasks

#### Task 3.1: Run full existing test suite

**Description:** Execute all 20+ existing integration tests to verify no regressions from the bug fixes.
**Acceptance Criteria:**
- [ ] All existing integration tests pass
- [ ] Conservation stress test passes
- [ ] No TypeScript compilation errors

#### Task 3.2: Add TBA deposit lifecycle test

**Description:** Integration test covering the full deposit bridge flow with the compound CHECK constraint: `detected(0)` → `confirmed(0)` → `bridged(amount>0)`. Also test that `bridged` with `amount_micro=0` is rejected.
**Acceptance Criteria:**
- [ ] Happy path: full bridge lifecycle succeeds
- [ ] Negative: `status='bridged', amount_micro=0` rejected by DB
- [ ] ReconciliationService deposit conservation check passes

#### Task 3.3: Add transfer conservation end-to-end test

**Description:** Integration test covering: create transfer → verify recipient entry has `entry_type='transfer_in'` → run reconciliation → Check 5 passes.
**Acceptance Criteria:**
- [ ] Transfer creates correct entry types (sender: `transfer_out`, recipient: `transfer_in`)
- [ ] Reconciliation Check 5 passes with no false divergences
- [ ] Balance is correct for both sender and recipient

#### Task 3.4: SqliteTimestamp compile-time verification

**Description:** Add compile-time test file with `@ts-expect-error` directives proving that ISO strings and raw strings cannot be passed where `SqliteTimestamp` is required.
**Acceptance Criteria:**
- [ ] `@ts-expect-error` test: `new Date().toISOString()` rejected at compile time
- [ ] `@ts-expect-error` test: raw string literal rejected at compile time
- [ ] `sqliteTimestamp()` accepted at compile time
- [ ] `parseSqliteTimestamp(validString)` accepted at compile time

#### Task 3.5: Resolve merge conflicts with main

**Description:** Merge `main` into the feature branch, resolving all conflicts. Prefer main's changes for files not modified by cycle-031. For shared files, manually resolve keeping both sets of changes.
**Acceptance Criteria:**
- [ ] `git merge main` completes (conflicts resolved and committed if any existed)
- [ ] Working tree is clean (`git status` shows no uncommitted changes)
- [ ] All tests pass after merge resolution
- [ ] `git diff --name-status main...HEAD` reviewed — no unintended deletions from main
- [ ] (Optional/manual) Push to remote and verify PR #67 merge state updates to MERGEABLE

#### Task 3.6: Final validation

**Description:** Run the complete test suite one final time after merge conflict resolution to ensure everything is green.
**Acceptance Criteria:**
- [ ] All integration tests pass
- [ ] TypeScript compiles without errors
- [ ] Conservation stress test passes
- [ ] PR #67 is ready for review

---

## Dependency Graph

```
Sprint 1 (Schema & Types)
  ├── Task 1.1 (EntryType) ─┐
  ├── Task 1.2 (Migration 056) ──→ Sprint 2
  ├── Task 1.3 (Migration 057) ──→ Sprint 3 (Task 3.2)
  ├── Task 1.4 (SqliteTimestamp) ─┐
  └── Task 1.5 (Typed surfaces) ──→ Sprint 3 (Task 3.4)

Sprint 2 (Service Logic) — depends on Sprint 1
  ├── Task 2.1 (Check 5 fix) ─┐
  ├── Task 2.2 (Entry type) ──┤
  ├── Task 2.3 (Balance audit) ──→ Sprint 3 (Task 3.3)
  └── Task 2.4 (E2E verify) ──→ Sprint 3

Sprint 3 (Integration & Merge) — depends on Sprints 1+2
  ├── Tasks 3.1-3.4 (Tests) ─┐
  ├── Task 3.5 (Merge) ──────┤
  └── Task 3.6 (Final) ──────→ PR #67 MERGEABLE
```

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Balance computation filters by entry_type | Medium | High | Task 2.3 explicitly audits this |
| Merge conflicts in files touched by both cycles | High | Medium | Merge (not rebase) + full test suite after |
| SqliteTimestamp touches too many files | Low | Low | Scoped to cycle-031 services only |
| New reconciliation failures surface after Check 5 fix | Low | Medium | Log for cycle-033, don't expand scope |
