# SDD: Pre-Merge Excellence — Bug Fixes & Merge Readiness

**Version:** 1.0.0
**Date:** 2026-02-16
**Status:** Active
**Cycle:** cycle-032
**PRD:** grimoires/loa/prd.md (v1.0.0)

---

## 1. Executive Summary

Cycle-032 resolves 2 critical bugs, 1 moderate design issue, and 2 medium improvements identified during Bridgebuilder review of cycle-031. All changes are surgical fixes to existing code — no new subsystems, no new dependencies, no new APIs. The merge conflict resolution (FR-5) is a git operation, not a code change.

**Design principle:** Minimal blast radius. Every fix targets a specific file:line with a specific acceptance test. No refactoring beyond what is necessary to fix the identified issue.

---

## 2. Component Changes

### 2.1 ReconciliationService — Check 5 Table Reference (FR-1)

**File:** `themes/sietch/src/packages/adapters/billing/ReconciliationService.ts`
**Method:** `checkTransferConservation()` (lines 308-375)

**Current state:** Check 5a at line ~314 may reference `ledger_entries` (a table that doesn't exist). The try/catch swallows the error and marks the check as `{ skipped: true }`.

**Change:**
1. Verify the exact table name in Check 5a SQL query — if `ledger_entries`, change to `credit_ledger`
2. Replace the silent skip pattern with structured error reporting: if the query fails, record `{ status: 'failed', error: '<message>' }` in the check result rather than `{ skipped: true }`. Do NOT throw — `reconcile()` must always return a complete report with per-check results.
3. Check 5b already correctly queries `credit_ledger` for `transfer_out` entries (confirmed via code read)

**Error handling contract:** `reconcile()` returns a structured report containing all check results. Each check has `{ name, status: 'passed'|'failed', details }`. Errors within a check produce `status: 'failed'` with error details — they never throw or abort the reconciliation run. This ensures downstream systems always receive a complete report. Only programmer errors (null db, missing method) should throw.

**Validation:**
- `reconcile()` with completed transfers returns Check 5 `status: 'passed'` (not `'skipped'`)
- `reconcile()` with an intentionally invalid SQL returns Check 5 `status: 'failed'` with error message (does not throw)

### 2.2 Migration 057 — TBA Deposit CHECK Constraint (FR-2)

**File:** `themes/sietch/src/db/migrations/057_tba_deposits.ts`

**Current state:** Migration creates `tba_deposits` with `amount_micro INTEGER NOT NULL CHECK (amount_micro >= 0)` and status CHECK `IN ('detected', 'confirmed', 'bridged', 'failed')`.

**Change:** Replace the simple `CHECK (amount_micro >= 0)` with a compound state-dependent CHECK:

```sql
CHECK (
  (status IN ('detected', 'confirmed', 'failed') AND amount_micro >= 0)
  OR (status = 'bridged' AND amount_micro > 0)
)
```

> Note: The actual status values in migration 057 are `detected`, `confirmed`, `bridged`, `failed` (4 states). The PRD referenced a 6-state lifecycle which may reflect planned future expansion. The fix uses the actual statuses present in the migration.

**State machine clarification:** In `TbaDepositBridge.ts`, `'bridged'` is the terminal credited state — it is set AFTER the lot has been minted and `amount_micro` is already known/normalized (line ~441: `SET status = 'bridged', amount_micro = ?, lot_id = ?`). The transition sequence is: `detected(amount_micro=0)` → `confirmed(amount_micro=0 or known)` → `bridged(amount_micro>0, lot minted)`. The compound CHECK is therefore correct: only `'bridged'` requires `amount_micro > 0`.

**Migration strategy:** Since migration 057 exists only on the feature branch and has never been applied in any environment, amend it directly. No table rebuild required.

**Validation:**
- `INSERT INTO tba_deposits (status='detected', amount_micro=0)` succeeds
- `INSERT INTO tba_deposits (status='bridged', amount_micro=0)` fails (CHECK violation)
- `INSERT INTO tba_deposits (status='bridged', amount_micro=1000000)` succeeds
- Full bridge flow test: insert `detected(0)` → update to `confirmed(0)` → update to `bridged(amount>0)` succeeds

### 2.3 Type System — EntryType Extension (FR-3)

**Files:**
- `themes/sietch/src/packages/core/protocol/billing-types.ts` (line ~89)
- `themes/sietch/src/db/migrations/056_peer_transfers.ts` (lines 56-100 — credit_ledger rebuild)
- `themes/sietch/src/packages/adapters/billing/PeerTransferService.ts` (line ~343)

**Current state:**
- `EntryType` union includes `'transfer_out'` but NOT `'transfer_in'`
- `SourceType` union already includes `'transfer_in'`
- PeerTransferService creates recipient entries with `entry_type = 'deposit'`
- ReconciliationService Check 5 expects `entry_type = 'transfer_in'` entries
- The `credit_ledger` CHECK constraint is defined in migration 030 and rebuilt in migration 056 (which added `'transfer_out'` via the standard rename→create→copy→drop→reindex pattern)

**Changes:**

1. **billing-types.ts:** Add `'transfer_in'` to `EntryType` union:
   ```typescript
   export type EntryType =
     | 'deposit' | 'reserve' | 'finalize' | 'release' | 'refund'
     | 'grant' | 'shadow_charge' | 'shadow_reserve' | 'shadow_finalize'
     | 'commons_contribution' | 'revenue_share'
     | 'marketplace_sale' | 'marketplace_purchase'
     | 'escrow' | 'escrow_release'
     | 'transfer_out' | 'transfer_in';
   ```

2. **Migration 056 amendment:** Add `'transfer_in'` to the `credit_ledger` CHECK constraint in `CREDIT_LEDGER_REBUILD_SQL` (line 77 of `056_peer_transfers.ts`). This is the migration that already rebuilds credit_ledger to add `'transfer_out'` — amend it to include `'transfer_in'` in the same CHECK list. Safe because 056 is feature-branch-only (pre-merge).

3. **PeerTransferService.ts line ~343:** Change recipient entry from `'deposit'` to `'transfer_in'`:
   ```typescript
   // Before:
   ... entry_type, ... VALUES (... 'deposit', ...)
   // After:
   ... entry_type, ... VALUES (... 'transfer_in', ...)
   ```

4. **Balance computation audit:** Identify the balance query function and ensure it sums `'transfer_in'` as a credit-increasing entry. The balance computation likely aggregates by entry_type — `'transfer_in'` must be treated equivalently to `'deposit'` (positive amount, increases available balance).

**Semantic safety:** The `amount_micro` in recipient ledger entries is already positive (set to the transfer amount). Balance computation should sum all positive-amount entries regardless of type. Verify this assumption during implementation — if balance queries filter by specific entry_types, add `'transfer_in'` to the filter.

### 2.4 SqliteTimestamp Branded Type (FR-4)

**File:** `themes/sietch/src/packages/adapters/billing/protocol/timestamps.ts`

**Current state:**
- `sqliteTimestamp()` returns `string` (line 17)
- Format: `YYYY-MM-DD HH:MM:SS` (space-separated, no timezone)
- Warning comment about string comparison of 'T' vs space breaking chronological ordering (BB-67-001 / ADR-013)
- Related functions: `sqliteFutureTimestamp()`, `isoTimestamp()`, `isSqliteFormat()`, `isIsoFormat()`

**Changes:**

1. **Define branded type:**
   ```typescript
   export type SqliteTimestamp = string & { readonly __brand: 'sqlite_ts' };
   ```

2. **Update return types:**
   ```typescript
   export function sqliteTimestamp(date?: Date): SqliteTimestamp {
     return (date ?? new Date())
       .toISOString()
       .replace('T', ' ')
       .replace(/\.\d+Z$/, '') as SqliteTimestamp;
   }

   export function sqliteFutureTimestamp(
     offsetSeconds: number,
     from?: Date
   ): SqliteTimestamp { ... }
   ```

3. **Enforcement boundaries:**

   | Surface | Location | Change |
   |---------|----------|--------|
   | Insert/update params | All `*.ts` files with `INSERT/UPDATE ... *_at` | Parameter type → `SqliteTimestamp` |
   | Row model interfaces | `billing-types.ts`, service-local row types | `*_at` fields → `SqliteTimestamp` |
   | Comparison helpers | `timestamps.ts` (if any exist) | Parameter types → `SqliteTimestamp` |

4. **Compile-time verification test:**
   ```typescript
   // In test file:
   import { SqliteTimestamp, sqliteTimestamp } from './timestamps';

   function requiresTimestamp(ts: SqliteTimestamp): void {}

   // This should compile:
   requiresTimestamp(sqliteTimestamp());

   // @ts-expect-error — raw ISO string must not compile
   requiresTimestamp(new Date().toISOString());

   // @ts-expect-error — plain string must not compile
   requiresTimestamp('2026-02-16 14:30:00');
   ```

5. **DB boundary functions** (read path — prevents unbranded strings from DB rows):
   ```typescript
   /** Validate and brand a string read from SQLite *_at column */
   export function parseSqliteTimestamp(raw: string): SqliteTimestamp {
     if (!isSqliteFormat(raw)) {
       throw new Error(`Invalid SQLite timestamp format: ${raw}`);
     }
     return raw as SqliteTimestamp;
   }
   ```
   All DB row mappers for `*_at` fields in cycle-031 services must use `parseSqliteTimestamp()` to brand values read from the database. This prevents the bypass where raw `string` from SQLite rows gets used in comparisons without format validation.

6. **Runtime validation test:** Add a test that `parseSqliteTimestamp()` rejects ISO format strings (e.g., `'2026-02-16T14:30:00.000Z'`) at runtime, complementing the compile-time `@ts-expect-error` test.

**Scope boundary:** Only update typed surfaces that are touched by cycle-031 code (PeerTransferService, TbaDepositBridge, AgentGovernanceService, ReconciliationService). Do not retrofit the branded type into pre-existing cycle-030 code — that's a separate refactoring task.

### 2.5 Merge Conflict Resolution (FR-5)

**Strategy:** Merge `main` into the feature branch (not rebase). Rationale: The feature branch has 570 files changed with complex history — rebasing risks introducing subtle errors across the commit chain.

**Conflict resolution principles:**
1. Accept main's changes for any file not modified by cycle-031
2. For files modified by both: manually resolve, preferring cycle-031's additions while keeping main's independent changes
3. After resolution: run full test suite to verify no regressions
4. Verify no unintended deletions from main using `git diff main...HEAD --stat`

---

## 3. Data Architecture Changes

### 3.1 Schema Amendments (Pre-Merge)

| Table | Migration | Column | Before | After |
|-------|-----------|--------|--------|-------|
| `tba_deposits` | 057 | `amount_micro` CHECK | `>= 0` | Compound: `(non-terminal AND >= 0) OR (bridged AND > 0)` |
| `credit_ledger` | 056 | `entry_type` CHECK | Includes `'transfer_out'` | Add `'transfer_in'` to same CHECK list |

### 3.2 No New Tables

No new tables, columns, or indexes are introduced.

### 3.3 No Data Migration

All changes are constraint tightening (compound CHECK) or constraint extension (new allowed value). No existing rows need modification — `'transfer_in'` entries will only be created by new transfers going forward.

---

## 4. Testing Strategy

### 4.1 Unit Tests

| Test | Validates |
|------|-----------|
| ReconciliationService Check 5 with completed transfers | Check returns `passed` (not `skipped`) |
| ReconciliationService Check 5 with no transfers | Check returns `passed` with zero totals |
| TBA deposit INSERT with `status='detected', amount_micro=0` | Succeeds |
| TBA deposit INSERT with `status='bridged', amount_micro=0` | Fails (CHECK violation) |
| TBA deposit INSERT with `status='bridged', amount_micro=1000000` | Succeeds |
| PeerTransfer recipient entry uses `entry_type='transfer_in'` | Entry type correct in credit_ledger |
| Balance query includes `'transfer_in'` entries | Balance unchanged after type reclassification |
| `sqliteTimestamp()` returns `SqliteTimestamp` branded type | Compile-time type check |
| `@ts-expect-error` on ISO string where `SqliteTimestamp` expected | Compile-time enforcement |

### 4.2 Integration Tests

| Test | Validates |
|------|-----------|
| Full transfer flow → reconciliation passes | End-to-end transfer conservation with correct entry types |
| TBA deposit detection → bridge flow | Deposit lifecycle with compound CHECK constraint |
| Conservation stress test (existing) | Still passes with all fixes applied |
| All 20 existing integration tests | No regressions |

### 4.3 Compile-Time Tests

| Test | Validates |
|------|-----------|
| `SqliteTimestamp` branded type enforcement | ISO strings rejected at compile time |
| `EntryType` union includes `'transfer_in'` | Type system consistency |

---

## 5. File Manifest

### Modified Files

| File | Change |
|------|--------|
| `themes/sietch/src/packages/adapters/billing/ReconciliationService.ts` | Fix Check 5 table reference, remove silent skip |
| `themes/sietch/src/db/migrations/057_tba_deposits.ts` | Compound CHECK on amount_micro, add 'transfer_in' to credit_ledger CHECK |
| `themes/sietch/src/packages/core/protocol/billing-types.ts` | Add `'transfer_in'` to EntryType |
| `themes/sietch/src/packages/adapters/billing/PeerTransferService.ts` | Change recipient entry_type to `'transfer_in'` |
| `themes/sietch/src/packages/adapters/billing/protocol/timestamps.ts` | Add SqliteTimestamp branded type, update return types |
| Service files with `*_at` insert/update params | Update parameter types to `SqliteTimestamp` |

### New Files

| File | Purpose |
|------|---------|
| Test file for SqliteTimestamp compile-time checks | `@ts-expect-error` verification |

---

## 6. Dependency Graph

```
FR-3 (EntryType) ──→ FR-1 (Check 5 fix)
       │                    │
       │                    ▼
       │              Integration tests
       │
FR-2 (CHECK constraint) ──→ Integration tests
       │
FR-4 (SqliteTimestamp) ──→ All services (type updates)
       │
       ▼
FR-5 (Merge conflicts) ──→ Final test suite
```

**Sprint ordering:** FR-2 and FR-3 can be done in parallel. FR-1 depends on FR-3 (Check 5 expects `transfer_in` entries). FR-4 is independent. FR-5 is last (resolves conflicts after all code changes).

---

## 7. Technical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Balance computation filters by entry_type | Medium | Audit balance query during FR-3 implementation; add test proving balance equivalence |
| Merge conflicts introduce subtle bugs | Medium | Run full test suite after resolution; verify with `git diff` |
| SqliteTimestamp retrofit touches too many files | Low | Scope to cycle-031 files only; don't retrofit into cycle-030 code |
| Check 5 fix reveals additional reconciliation issues | Low | If new failures surface, log them for cycle-033 rather than expanding scope |
