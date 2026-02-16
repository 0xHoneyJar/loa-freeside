# ADR-015: SQLite Locking Hierarchy

**Status:** Accepted
**Date:** 2026-02-16
**Decision Makers:** Engineering Team

## Context

SQLite uses file-level locking. In WAL mode, readers never block writers and vice versa, but concurrent writers are serialized. Understanding which operations need which transaction type prevents SQLITE_BUSY errors and ensures money operations are atomic.

## Decision

### Transaction Types by Operation Class

| Class | Transaction Type | Max Duration | Operations |
|-------|-----------------|-------------|------------|
| **Money-moving** | `BEGIN IMMEDIATE` | <50ms | Revenue distribution, settlement, payout escrow hold/release, credit mint, clawback |
| **Governance** | `BEGIN IMMEDIATE` | <50ms | Rule proposal, approval, activation, supersession |
| **Batch processing** | `BEGIN IMMEDIATE` | <200ms | Settlement batch (max 50 rows), score distribution |
| **Read queries** | `BEGIN DEFERRED` (default) | <100ms | Balance queries, leaderboard, earnings history, rule listing |
| **Reconciliation** | `BEGIN DEFERRED` | <500ms | Daily reconciliation reads (write phase uses IMMEDIATE) |

### Why IMMEDIATE for Money Operations

`BEGIN IMMEDIATE` acquires a reserved lock immediately, preventing other transactions from writing. This:
1. Prevents SQLITE_BUSY errors during the transaction body
2. Ensures atomic updates to balances, earnings, and state
3. Fails fast if another writer holds the lock (rather than discovering mid-transaction)

### Retry/Backoff Policy

For `SQLITE_BUSY` errors:
1. Exponential backoff: 50ms, 100ms, 200ms
2. Add jitter: +/- 25% randomization
3. Max 3 retries
4. After 3 failures: log error, return failure to caller

### Baseline Configuration

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;  -- 5 seconds max wait
PRAGMA synchronous = NORMAL; -- Safe with WAL mode
```

`busy_timeout = 5000` means SQLite will wait up to 5 seconds for a lock before returning SQLITE_BUSY. This is the baseline; the retry policy above handles residual failures.

## Consequences

- All money-moving operations use `db.transaction()` which defaults to IMMEDIATE in better-sqlite3
- Read-only operations should use `db.prepare().all()` without explicit transactions (implicit DEFERRED)
- Batch operations process at most 50 rows per transaction to stay under 200ms target
- `busy_timeout` provides first-line defense; application retry is second-line

## References

- SQLite WAL mode documentation: https://sqlite.org/wal.html
- better-sqlite3 transaction behavior: `db.transaction()` uses IMMEDIATE by default
- Settlement batch size constant: `BATCH_SIZE = 50` in `SettlementService.ts`
