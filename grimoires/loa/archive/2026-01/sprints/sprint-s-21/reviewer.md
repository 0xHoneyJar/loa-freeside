# Sprint S-21: Synthesis Engine & Rate Limiting

## Implementation Report

**Sprint**: S-21
**Phase**: 9 (BullMQ + Global Token Bucket)
**Date**: 2026-01-16
**Status**: IMPLEMENTATION COMPLETE

## Overview

Sprint S-21 implements the Synthesis Engine for async Discord operations with platform-wide rate limiting. This provides a production-ready job queue for Discord API interactions with built-in protection against global bans.

## Deliverables

### S-21.1: BullMQ Queue Setup
- **File**: `packages/adapters/synthesis/engine.ts`
- BullMQ queue with configurable retry policy
- 3 retries with exponential backoff (1s base)
- Dead Letter Queue (DLQ) for failed jobs
- Job cleanup: completed (1hr), failed (24hr)

### S-21.2: Synthesis Worker
- **File**: `packages/adapters/synthesis/engine.ts`
- 5 concurrent workers per SDD §6.3.4
- 10 jobs/sec rate limiter (BullMQ limiter)
- Worker event handlers for completed/failed/error events
- Graceful shutdown with `close()`, `pause()`, `resume()`

### S-21.3: Global Token Bucket
- **File**: `packages/adapters/synthesis/token-bucket.ts`
- Redis-backed with Lua script for atomic token acquisition
- 50 tokens/sec capacity per SDD §6.3.5
- `acquireWithWait(maxWaitMs)` blocking acquisition
- `tryAcquire()` non-blocking acquisition
- Automatic refill based on elapsed time

### S-21.4: Idempotency Keys
- **File**: `packages/adapters/synthesis/engine.ts`
- 24-hour TTL in Redis
- Key prefix: `synthesis:idempotency:`
- Duplicate detection before Discord API calls
- Metrics for hits/misses

### S-21.5: Synthesis Job Types
- **File**: `packages/core/ports/synthesis-engine.ts`
- All 7 job types implemented:
  1. `create_role` - Create Discord role
  2. `delete_role` - Delete Discord role
  3. `assign_role` - Assign role to user
  4. `remove_role` - Remove role from user
  5. `create_channel` - Create Discord channel
  6. `delete_channel` - Delete Discord channel
  7. `update_permissions` - Update channel permissions
- Type-safe payload interfaces for each job type

### S-21.6: Token Bucket Metrics
- **File**: `packages/adapters/synthesis/metrics.ts`
- Prometheus metrics:
  - `arrakis_synthesis_token_bucket_exhausted_total` - Counter
  - `arrakis_synthesis_token_bucket_waits_total` - Counter
  - `arrakis_synthesis_tokens_acquired_total` - Counter
  - `arrakis_synthesis_token_bucket_current` - Gauge
- Job processing metrics:
  - `arrakis_synthesis_jobs_enqueued_total` - Counter (by type)
  - `arrakis_synthesis_jobs_completed_total` - Counter (by type)
  - `arrakis_synthesis_jobs_failed_total` - Counter (by type, reason)
  - `arrakis_synthesis_job_duration_seconds` - Histogram

### S-21.7: Synthesis Integration Tests
- **File**: `packages/adapters/synthesis/__tests__/token-bucket.test.ts`
- **File**: `packages/adapters/synthesis/__tests__/synthesis-engine.test.ts`
- 53 tests total:
  - Token bucket: 14 tests
  - Synthesis engine: 39 tests
- Test coverage:
  - Job enqueueing and retrieval
  - Batch synthesis operations
  - Idempotency key handling
  - All 7 Discord operations
  - 429 error handling
  - Metrics tracking
  - Rate limiting behavior
  - Concurrent access

### S-21.8: Discord 429 Monitoring
- **File**: `packages/adapters/synthesis/metrics.ts`
- CRITICAL metrics for ban prevention:
  - `arrakis_synthesis_discord_429_errors_total` - Counter (by endpoint, guild_id)
  - `arrakis_synthesis_discord_429_global_errors_total` - Counter (CRITICAL)
  - `arrakis_synthesis_discord_429_retry_after_seconds` - Histogram
- `trackDiscord429Error()` helper function
- Global 429 detection and separate tracking
- Retry-After header value recording

## Architecture

```
packages/
├── core/ports/
│   └── synthesis-engine.ts      # Port interface (ISynthesisEngine, IGlobalTokenBucket)
│                                # Types: SynthesisJob, SynthesisJobType, payloads
│                                # Constants: SYNTHESIS_QUEUE_CONFIG, TOKEN_BUCKET_CONFIG
│
└── adapters/synthesis/
    ├── index.ts                 # Module exports
    ├── engine.ts                # SynthesisEngine implementation
    ├── token-bucket.ts          # GlobalTokenBucket implementation
    ├── metrics.ts               # Prometheus metrics definitions
    └── __tests__/
        ├── token-bucket.test.ts     # 14 tests
        └── synthesis-engine.test.ts # 39 tests
```

## Configuration Constants

### Queue Configuration (SYNTHESIS_QUEUE_CONFIG)
| Setting | Value | Purpose |
|---------|-------|---------|
| QUEUE_NAME | `discord-synthesis` | BullMQ queue name |
| MAX_ATTEMPTS | 3 | Retry count |
| BACKOFF_BASE_MS | 1000 | Exponential backoff base |
| CONCURRENCY | 5 | Parallel workers |
| RATE_LIMIT_MAX | 10 | Jobs per duration |
| RATE_LIMIT_DURATION | 1000 | Duration in ms |

### Token Bucket Configuration (TOKEN_BUCKET_CONFIG)
| Setting | Value | Purpose |
|---------|-------|---------|
| REDIS_KEY | `synthesis:token_bucket` | Redis key |
| MAX_TOKENS | 50 | Bucket capacity |
| REFILL_RATE | 50 | Tokens/second |
| DEFAULT_MAX_WAIT_MS | 5000 | acquireWithWait timeout |
| POLL_INTERVAL_MS | 100 | Wait polling interval |

### Idempotency Configuration (IDEMPOTENCY_CONFIG)
| Setting | Value | Purpose |
|---------|-------|---------|
| KEY_PREFIX | `synthesis:idempotency:` | Redis key prefix |
| TTL_SECONDS | 86400 | 24-hour TTL |

## Lua Script for Atomic Token Acquisition

The token bucket uses a Lua script for atomic operations:

```lua
local key = KEYS[1]
local maxTokens = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Get current state
local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1]) or maxTokens
local lastRefill = tonumber(data[2]) or now

-- Refill based on elapsed time
local elapsed = (now - lastRefill) / 1000
local tokensToAdd = elapsed * refillRate
tokens = math.min(maxTokens, tokens + tokensToAdd)

-- Try to acquire
if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', now)
  return 1  -- Success
else
  redis.call('HSET', key, 'lastRefill', now)
  return 0  -- No tokens available
end
```

## Test Results

```
 ✓ synthesis/__tests__/synthesis-engine.test.ts  (39 tests) 100ms
 ✓ synthesis/__tests__/token-bucket.test.ts  (14 tests) 268ms

 Test Files  2 passed (2)
      Tests  53 passed (53)
```

## SDD Alignment

| SDD Section | Requirement | Implementation |
|-------------|-------------|----------------|
| §6.3.4 | BullMQ with 3 retries | ✅ `MAX_ATTEMPTS: 3` |
| §6.3.4 | 5 concurrent workers | ✅ `CONCURRENCY: 5` |
| §6.3.4 | 10 jobs/sec limiter | ✅ `RATE_LIMIT_MAX: 10` |
| §6.3.5 | 50 tokens/sec bucket | ✅ `MAX_TOKENS: 50, REFILL_RATE: 50` |
| §6.3.5 | acquireWithWait() blocking | ✅ Implemented with polling |
| §6.3.5 | Idempotency keys 24h TTL | ✅ `TTL_SECONDS: 86400` |

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| S-21.1: BullMQ queue (3 retries, backoff, DLQ) | ✅ PASS |
| S-21.2: 5 concurrent workers, 10/sec limiter | ✅ PASS |
| S-21.3: 50 tokens/sec, acquireWithWait() | ✅ PASS |
| S-21.4: Idempotency 24h TTL | ✅ PASS |
| S-21.5: All 7 synthesis job types | ✅ PASS |
| S-21.6: Prometheus token bucket metrics | ✅ PASS |
| S-21.7: All synthesis operations tested | ✅ PASS (53 tests) |
| S-21.8: Discord 429 monitoring | ✅ PASS |

## Files Modified/Created

### New Files
- `packages/core/ports/synthesis-engine.ts` - Port interface (~450 lines)
- `packages/adapters/synthesis/index.ts` - Module exports
- `packages/adapters/synthesis/engine.ts` - SynthesisEngine (~640 lines)
- `packages/adapters/synthesis/token-bucket.ts` - GlobalTokenBucket (~200 lines)
- `packages/adapters/synthesis/metrics.ts` - Prometheus metrics (~300 lines)
- `packages/adapters/synthesis/__tests__/token-bucket.test.ts` - 14 tests
- `packages/adapters/synthesis/__tests__/synthesis-engine.test.ts` - 39 tests

### Modified Files
- `packages/core/ports/index.ts` - Added synthesis-engine export
- `packages/adapters/package.json` - Added synthesis export path

## Notes for Senior Lead Review

1. **Discord REST Client Interface**: The `DiscordRestClient` interface is defined for dependency injection. The actual Discord.js REST implementation will be provided at runtime.

2. **BullMQ Abstraction**: Queue and Worker interfaces are abstracted via `QueueFactory` for testability. Production will inject real BullMQ instances.

3. **Redis Abstraction**: Both the token bucket and idempotency checks use a `RedisClient` interface for DI.

4. **Global 429 Monitoring**: The `discord429GlobalErrors` metric is marked CRITICAL. Any non-zero value should trigger immediate alerts as global 429s can lead to Discord banning the bot.

5. **Token Bucket Atomicity**: The Lua script ensures atomic token acquisition even under high concurrency. This prevents race conditions that could lead to exceeding rate limits.

---

**Ready for Senior Lead Review**
