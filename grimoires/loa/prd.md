# PRD: Pre-Merge Excellence — Bug Fixes & Merge Readiness

**Version:** 1.0.0
**Date:** 2026-02-16
**Status:** Active
**Cycle:** cycle-032
**Predecessor:** cycle-031 "The Spacing Guild" (archived)
**PR:** [arrakis PR #67](https://github.com/0xHoneyJar/arrakis/pull/67)

---

## 1. Problem Statement

Cycle-031 delivered agent economic sovereignty (peer transfers, governance, TBA deposit bridge, event consolidation) across 8 sprints and 47 files. The Bridgebuilder review and coherence analysis identified **2 critical bugs, 1 moderate design issue, and 2 medium-severity improvements** that must be resolved before PR #67 can be merged to main.

Additionally, the PR has **merge conflicts with main** that need resolution.

> Sources: coherence-review-031.md, Bridgebuilder PR #67 review (severity 5.0), sprint-plan-state.json

---

## 2. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Fix ReconciliationService Check 5 wrong table reference | Check 5a queries `credit_ledger` (not `ledger_entries`), transfer conservation actually verified |
| G-2 | Fix TBA deposit CHECK constraint conflict | `amount_micro` allows 0 for `detected`/`failed` status, deposit detection succeeds |
| G-3 | Fix recipient ledger entry type mismatch | `transfer_in` added to EntryType union and CHECK constraint, recipient entries use correct type |
| G-4 | Introduce SqliteTimestamp branded type | Compile-time prevention of timestamp format mismatches |
| G-5 | Resolve merge conflicts with main | PR #67 merge state changes from CONFLICTING to MERGEABLE |
| G-6 | All existing tests pass after fixes | 20 integration tests + existing suite green |

---

## 3. Functional Requirements

### FR-1: ReconciliationService Check 5 — Wrong Table (Critical)

**Current state:** `ReconciliationService.ts:311` queries `ledger_entries` table. This table doesn't exist — the actual table is `credit_ledger`. The try/catch silently swallows the "no such table" error and marks the check as `{ skipped: true }`, meaning transfer conservation is never actually verified.

**Fix:** Change `ledger_entries` to `credit_ledger`. Verify the query returns meaningful results. Remove the silent swallow pattern — if the table doesn't exist, that's a real error.

**Acceptance criteria:**
- Check 5a queries `credit_ledger` table
- Transfer conservation is verified (not skipped)
- ReconciliationService.reconcile() passes with completed transfers present
- Conservation stress test still passes

### FR-2: TBA Deposit CHECK Constraint (Critical)

**Current state:** Migration 057 creates `tba_deposits` with `CHECK (amount_micro > 0)`. But `TbaDepositBridge.ts` inserts `amount_micro = 0` for initial `detected` (line 124) and `failed` (line 518) status records. Every deposit detection will fail with a SQLite CHECK constraint violation.

**Fix:** Since migration 057 is not yet merged to main (only exists on the feature branch), amend migration 057 directly to use a state-dependent CHECK constraint. This is safe because the migration has never been applied in any production environment.

**Migration strategy:** Amend migration 057 (pre-merge, never applied to production) with a compound CHECK:
```sql
CHECK (
  (status IN ('detected', 'confirming', 'confirmed', 'bridging', 'failed') AND amount_micro >= 0)
  OR (status = 'completed' AND amount_micro > 0)
)
```
This enforces at the DB level that completed deposits must have a positive amount, while allowing zero for in-progress states.

**Acceptance criteria:**
- Migration 057 uses compound CHECK constraint (state-dependent amount validation)
- TBA deposit detection succeeds for `detected` status with `amount_micro = 0`
- SQLite rejects `INSERT INTO tba_deposits (status='completed', amount_micro=0)` at DB level
- ReconciliationService can add a check: no `completed` deposits with `amount_micro <= 0`
- TBA integration test passes

### FR-3: Recipient Ledger Entry Type (Moderate)

**Current state:** `PeerTransferService.ts:343` creates recipient ledger entries with `entry_type = 'deposit'`. But lots are created with `source_type = 'transfer_in'`. ReconciliationService Check 5 expects `entry_type = 'transfer_in'` entries that never exist, causing false divergences.

**Fix:**
1. Add `'transfer_in'` to `EntryType` union in `billing-types.ts`
2. Update `credit_ledger` CHECK constraint via migration to include `'transfer_in'`
3. Change PeerTransferService recipient entries to use `entry_type = 'transfer_in'`

**Semantic impact analysis:** The `entry_type` field is used for accounting classification. Changing recipient entries from `'deposit'` to `'transfer_in'` affects any query that aggregates by `entry_type`. The balance computation function and any reporting queries must treat `'transfer_in'` as a credit-increasing entry equivalent to `'deposit'`.

**Fix:**
1. Add `'transfer_in'` to `EntryType` union in `billing-types.ts`
2. Amend migration 057's `credit_ledger` CHECK constraint to include `'transfer_in'` (pre-merge, safe to amend)
3. Change PeerTransferService recipient entries to use `entry_type = 'transfer_in'`
4. Audit and update balance computation to include `'transfer_in'` in credit-summing queries
5. Verify no reporting or fee logic breaks from the reclassification

**Acceptance criteria:**
- `EntryType` includes `'transfer_in'`
- `credit_ledger` CHECK constraint allows `'transfer_in'`
- Recipient ledger entries use `entry_type = 'transfer_in'`
- Balance computation query sums `'transfer_in'` entries as credits (equivalent to `'deposit'`)
- Test: recipient account balance is identical before and after the type change
- ReconciliationService Check 5 no longer reports false divergences
- All transfer tests pass

### FR-4: SqliteTimestamp Branded Type (Medium)

**Current state:** `sqliteTimestamp()` returns `string`. Four timestamp format bugs were already fixed in AgentGovernanceService where `.toISOString()` was used instead of `sqliteTimestamp()`. The root cause: `string` accepts any format.

**Fix:** Introduce `SqliteTimestamp` branded type: `type SqliteTimestamp = string & { __brand: 'sqlite_ts' }`. Update `sqliteTimestamp()` return type. Update all typed surfaces that interact with timestamp columns.

**Enforcement boundaries** (typed surfaces that must use `SqliteTimestamp`):
1. **Insert/update parameter types**: All `*_at` column parameters in prepared statements must accept `SqliteTimestamp`, not `string`
2. **Row model types**: All row interfaces returned from SQLite for `*_at` columns must type those fields as `SqliteTimestamp`
3. **Comparison helpers**: Any function comparing or sorting by timestamp must require `SqliteTimestamp` parameters

**Acceptance criteria:**
- `SqliteTimestamp` type exported from `protocol/timestamps.ts`
- `sqliteTimestamp()` returns `SqliteTimestamp`
- Insert/update parameter types for `*_at` columns require `SqliteTimestamp`
- Row model `*_at` fields typed as `SqliteTimestamp`
- Comparison/sorting helpers require `SqliteTimestamp` parameters
- Compile-time test: passing `new Date().toISOString()` to a function expecting `SqliteTimestamp` fails compilation (verified via `// @ts-expect-error` test)
- No `.toISOString()` used where `sqliteTimestamp()` is expected

### FR-5: Merge Conflict Resolution

**Current state:** PR #67 merge state is CONFLICTING.

**Fix:** Rebase or merge main into feature branch, resolving all conflicts.

**Acceptance criteria:**
- PR #67 merge state is MERGEABLE
- All tests pass after conflict resolution
- No unintended deletions from main

---

## 4. Non-Functional Requirements

- All 20 existing integration tests continue passing
- No new dependencies introduced
- Changes are backward-compatible with existing data
- Migration strategy: Migration 057 exists only on the feature branch (never merged to main, never applied in any environment). It is safe to amend 057 directly with the corrected CHECK constraints. This is additive from main's perspective — no destructive DDL against any existing table. If 057 were already deployed, a new migration with table rebuild (CREATE → copy → DROP → rename) would be required instead.

---

## 5. Out of Scope

- Cross-pool transfer routing (cycle-033)
- Graduated governance autonomy (cycle-033)
- Event system full unification (cycle-033)
- On-chain settlement reverse bridge (future)
- New feature development
