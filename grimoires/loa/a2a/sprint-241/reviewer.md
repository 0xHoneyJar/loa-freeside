# Sprint 241 (cycle-026 sprint-3) — Implementation Report

## Sprint: Atomic Daily Spending Counter

**Status**: COMPLETE
**Cycle**: 026 — The Stillsuit
**Global Sprint ID**: 241
**Date**: 2026-02-15

---

## Summary

Implemented multi-layer daily spending persistence for agent wallets: SQLite as persistent source of truth, Redis INCRBY as fast cache with Lua atomic scripts, in-memory Map as sync fallback. Added cap enforcement at finalize time and comprehensive tests.

---

## Tasks Completed

### Task 3.1: Daily Agent Spending Migration
**Files created:**
- `src/db/migrations/036_daily_agent_spending.ts` — `daily_agent_spending` table with PK (agent_account_id, spending_date), FK to credit_accounts, index on spending_date

### Task 3.2: SQLite UPSERT for Daily Spending
**Files modified:**
- `src/packages/adapters/billing/AgentWalletPrototype.ts` — Added `upsertDailySpending()` private method with ON CONFLICT atomic increment, `getDailySpentFromSqlite()` read method

### Task 3.3: Redis INCRBY with Lua Script
**Files modified:**
- `src/packages/adapters/billing/AgentWalletPrototype.ts` — Extended `AgentRedisClient` interface with `incrby`, `eval`, `expire`, `setex`. Added Lua script `REDIS_INCRBY_EXPIREAT_LUA` for atomic INCRBY + EXPIREAT on first write. New `incrbyRedisSpending()` with 3-tier fallback: Lua eval → INCRBY + EXPIRE → setex/set.

### Task 3.4: 3-Layer Read Path & Cap Enforcement
**Files modified:**
- `src/packages/adapters/billing/AgentWalletPrototype.ts` — Rewrote `getDailySpent()` with Redis → SQLite → in-memory fallback chain. Updated `finalizeInference()` with cap enforcement at finalize time (caps actual cost to remaining daily budget). Added `getRemainingDailyBudgetSync()` for in-memory-only mode. Added `midnightUtcEpoch()` helper.

### Task 3.5: Daily Spending Tests
**Files created:**
- `tests/unit/billing/daily-spending.test.ts` — 13 tests covering:
  - SQLite persistence after finalize
  - UPSERT accumulation across multiple finalizations
  - Redis Lua eval atomic INCRBY + EXPIREAT
  - Broken Redis fallback to SQLite
  - In-memory only mode (no Redis, no SQLite)
  - Cap enforcement: actual cost capped at finalize
  - Cap enforcement: reservation rejected when cap reached
  - 3-layer read: Redis first when available
  - 3-layer read: SQLite fallback when Redis returns null
  - Sync budget returns full cap before any finalize
  - Sync and async budget agreement after finalize
  - Identity anchor in TBA address derivation
  - Identity binding verification

---

## Test Results

```
 ✓ tests/unit/billing/daily-spending.test.ts (13 tests) 60ms
 Test Files  1 passed (1)
 Tests  13 passed (13)
```

All 13 new tests pass. All 10 billing test files: 290 pass, 4 pre-existing WaiverService failures from stale date fixtures — not related to this sprint.

---

## GPT Review

- `daily-spending.test.ts`: CHANGES_REQUIRED (iteration 1) — fixed broken Redis mock (missing methods) and BigInt-safe arithmetic in mock Redis incrby/eval. APPROVED (iteration 2).

---

## Architecture Decisions

1. **SQLite as source of truth, Redis as cache**: SQLite UPSERT guarantees durability. Redis INCRBY provides fast reads. Failure of either layer does not break spending enforcement — the 3-layer fallback ensures consistency.

2. **Lua script for atomic INCRBY + EXPIREAT**: First write to a key sets both the counter and the TTL atomically, preventing orphaned keys without expiry. Fallback chain handles Redis clients without `eval` support.

3. **Cap enforcement at finalize, not just reserve**: Reserve-time check prevents obvious over-spending, but finalize-time check handles the case where actual cost differs from estimate. Cost is capped to remaining daily budget rather than rejected entirely.

4. **Constructor accepts optional db parameter**: Keeps backward compatibility — tests and prototypes can run without SQLite. Production passes the SQLite handle for persistent spending.

---

## Acceptance Criteria Status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Migration 036 creates daily_agent_spending table with correct PK and FK | PASS |
| 2 | SQLite UPSERT atomically increments daily spending on conflict | PASS |
| 3 | Redis INCRBY with Lua sets TTL on first write | PASS |
| 4 | Broken Redis falls through to SQLite gracefully | PASS |
| 5 | In-memory only mode works for test/prototype | PASS |
| 6 | Daily cap enforced at finalize (cost capped to remaining budget) | PASS |
| 7 | Reservation rejected when daily cap already reached | PASS |
| 8 | 3-layer read: Redis → SQLite → in-memory | PASS |
| 9 | Sync and async budget queries agree | PASS |
| 10 | 10+ new tests pass | PASS (13 tests) |
