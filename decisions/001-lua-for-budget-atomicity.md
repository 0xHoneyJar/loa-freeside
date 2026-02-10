# ADR-001: Lua Scripts for Budget Atomicity

**Status**: Accepted
**Date**: 2026-02-09
**Context**: Spice Gate Phase 4 — Budget Manager

## Context

The budget system needs atomic reserve/commit/abort operations on Redis counters. Multiple concurrent requests for the same community must not produce race conditions (double-spend, negative budgets, or phantom reservations).

## Decision

Use Redis Lua scripts (`EVALSHA`) for all budget state mutations instead of Redis `MULTI/EXEC` transactions.

## Rationale

**Why not MULTI/EXEC?**
- `MULTI/EXEC` provides atomicity but not conditional logic. You can't read a value, check it, and conditionally write — all within a single atomic operation.
- Budget reservation requires: read current committed → check against limit → write reservation → increment committed. This is a read-modify-write pattern that `MULTI/EXEC` with `WATCH` handles via optimistic locking, but retries under contention degrade to O(n) latency.

**Why Lua?**
- Lua scripts execute atomically on a single Redis node — no other command can interleave.
- The entire reserve/commit flow runs in one round-trip (latency: ~0.1ms vs ~0.3ms for MULTI/EXEC).
- Conditional logic (budget exceeded? reservation expired?) lives in the script, not in application code.
- Redis guarantees script atomicity without explicit locking.

**Trade-offs accepted:**
- Lua scripts are harder to debug than application code (no breakpoints, limited logging).
- Script errors are opaque from the client side (Redis returns generic script errors).
- Scripts must be idempotent-safe since Redis may replay them during failover.

## Consequences

- All budget mutations go through `budget-reserve.lua`, `budget-finalize.lua`, `budget-abort.lua`.
- Application code parses Lua return values via `parseBudgetResult()`, `parseFinalizeResult()`.
- Budget reaper job also uses Lua for atomic TTL-based cleanup.
- Testing requires mocking `redis.evalsha()` or using a real Redis instance.

## Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| MULTI/EXEC + WATCH | Retry storms under contention; no conditional logic in transaction |
| Application-level locks (Redlock) | Additional complexity; distributed lock failures are their own failure mode |
| PostgreSQL-only (no Redis) | Too slow for hot path (~5ms PG round-trip vs ~0.1ms Redis); budget check is in every request |
