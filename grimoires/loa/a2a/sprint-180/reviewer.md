# Sprint 180 (Sprint 2) — Implementation Report

**Sprint**: Sprint 2: Rate Limiter + loa-finn Client
**Global ID**: 180
**Cycle**: cycle-010 (Spice Gate)
**Status**: COMPLETE

---

## Tasks Completed

### S2-T1: Rate Limit Lua Script

**File**: `packages/adapters/agent/lua/rate-limit.lua`
**GPT Review**: API unavailable (curl error 56, 3 attempts)

Deliverables:
- Multi-dimensional rate limit script matching SDD §8.1
- 4 dimensions checked atomically: community, user, channel (sliding window ZSET) + burst (token bucket)
- Millisecond precision with `nowMs:requestId` members for uniqueness at high QPS
- PEXPIRE on all keys to prevent memory leaks
- Returns: `[dimension, remaining, limit, retryAfterMs, resetAtMs]`
- `'ok'` when all dimensions pass, dimension name when failed

### S2-T2: Agent Rate Limiter

**File**: `packages/adapters/agent/agent-rate-limiter.ts`
**GPT Review**: APPROVED (2 iterations, 3 fixes)

Deliverables:
- `AgentRateLimiter` class with `check()` method
- `TIER_LIMITS` config: free (60/10/20), pro (300/30/60), enterprise (1000/100/200)
- Lua script loaded via `readFileSync` + `SCRIPT LOAD` for EVALSHA
- `parseRateLimitResult()` with safe integer parsing and dimension validation
- Fail-closed on Redis error (returns `allowed: false`)
- **GPT Fix 1**: Explicit `randomUUID` import from `node:crypto`
- **GPT Fix 2**: NOSCRIPT retry — reload script and retry once on Redis script eviction
- **GPT Fix 3**: `safeInt()` helper with `Number.isFinite` + `Math.trunc` + dimension validation for fail-closed on malformed responses

### S2-T3: Pre-Auth IP Rate Limiter

**File**: `packages/adapters/agent/ip-rate-limiter.ts`
**GPT Review**: APPROVED (2 iterations, 3 fixes)

Deliverables:
- `IpRateLimiter` class with in-memory token bucket (100/min per IP, burst 20)
- Express middleware factory via `middleware()` method
- Returns 429 with `Retry-After` header before any auth/JWT processing
- LRU eviction with Map reordering to prevent memory exhaustion (max 10k entries)
- Periodic cleanup of stale buckets (2min interval, unref'd timer)
- **GPT Fix 1**: Config validation — throws on zero/negative values preventing NaN/Infinity
- **GPT Fix 2**: True LRU via delete+set on access to maintain Map insertion order
- **GPT Fix 3**: Clock-drift protection — `Math.max(0, elapsed)` prevents negative refill

### S2-T4: loa-finn Client

**File**: `packages/adapters/agent/loa-finn-client.ts`
**GPT Review**: API unavailable (curl error 56, 3 attempts)

Deliverables:
- `LoaFinnClient` class with `invoke()`, `stream()`, `getUsage()`, `healthCheck()`
- Circuit breaker via opossum (timeout 120s, errorThreshold 50%, resetTimeout 30s)
- Retry on 502/503/504: exponential backoff (1s, 2s, 4s), max 3 retries
- New JWT minted per retry (new `jti`), same `idempotencyKey` (FR-4.5)
- No auto-retry on SSE stream drop (FR-4.7)
- SSE contract enforcement (Flatline SKP-003):
  - State machine validates event ordering: `streaming → usage_received → done`
  - Bounded read buffer: 64KB max per event
  - Partial SSE frame handling across chunk boundaries
  - Zod schema validation at parse boundary for all 6 event types
- `LoaFinnError` class with `statusCode` for retryable check
- `getUsage()` handles 404 (not found) and 202 (in progress) → returns null
- `healthCheck()` with 5s timeout, returns `{ healthy, latencyMs }`

---

## Files Changed

| File | Action |
|------|--------|
| `packages/adapters/agent/lua/rate-limit.lua` | Created |
| `packages/adapters/agent/agent-rate-limiter.ts` | Created |
| `packages/adapters/agent/ip-rate-limiter.ts` | Created |
| `packages/adapters/agent/loa-finn-client.ts` | Created |
| `packages/adapters/agent/index.ts` | Modified (added rate limiter + loa-finn exports) |
| `packages/adapters/package.json` | Modified (added ioredis, @types/express deps) |

## Quality Gates

- [x] All types compile with no errors (adapters package)
- [x] GPT Review: S2-T2 APPROVED (iteration 2 — NOSCRIPT retry, safe parsing, dimension validation)
- [x] GPT Review: S2-T3 APPROVED (iteration 2 — config validation, true LRU, clock-drift protection)
- [x] GPT Review: S2-T1 skipped (API unavailable — 3 attempts)
- [x] GPT Review: S2-T4 skipped (API unavailable — 3 attempts)
- [x] All beads closed (arrakis-2fy, arrakis-184, arrakis-30s, arrakis-32m)

## GPT Review Summary

| Task | Iterations | Critical Fixes | Major Fixes |
|------|-----------|----------------|-------------|
| S2-T1 | 0 (API unavailable) | 0 | 0 |
| S2-T2 | 2 | 0 | 3 (NOSCRIPT retry, safe parsing, randomUUID import) |
| S2-T3 | 2 | 1 (config validation) | 2 (true LRU, clock-drift) |
| S2-T4 | 0 (API unavailable) | 0 | 0 |
| **Total** | — | **1 critical** | **5 major** |
