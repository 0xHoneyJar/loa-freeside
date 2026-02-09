-- Multi-Dimensional Rate Limit Script
-- Sprint S2-T1: Sliding window + token bucket, millisecond precision
--
-- Checks 4 dimensions atomically in single EVALSHA:
-- 1. Community sliding window
-- 2. User sliding window
-- 3. Channel sliding window
-- 4. User burst token bucket
--
-- @see SDD §8.1 Multi-Dimensional Rate Limit Script

-- KEYS[1] = agent:rl:community:{id}:{windowMs}
-- KEYS[2] = agent:rl:user:{wallet}:{windowMs}
-- KEYS[3] = agent:rl:channel:{id}:{windowMs}
-- KEYS[4] = agent:rl:burst:{wallet}
-- ARGV[1] = community limit
-- ARGV[2] = user limit
-- ARGV[3] = channel limit
-- ARGV[4] = burst capacity
-- ARGV[5] = burst refill rate (tokens/ms)
-- ARGV[6] = current timestamp (milliseconds)
-- ARGV[7] = request ID (unique per request, e.g. UUIDv4)
-- ARGV[8] = window size (milliseconds, e.g. 60000)

local nowMs = tonumber(ARGV[6])
local requestId = ARGV[7]
local windowMs = tonumber(ARGV[8])

-- Helper: sliding window check (millisecond precision)
-- Uses ZSET with nowMs:requestId members for uniqueness at high QPS
-- Returns: allowed, remaining, limit, retryAfterMs, resetAtMs
local function slidingWindowCheck(key, limit)
  local lim = tonumber(limit)
  -- Remove entries outside window
  redis.call('ZREMRANGEBYSCORE', key, 0, nowMs - windowMs)
  local count = redis.call('ZCARD', key)
  if count >= lim then
    -- Compute retryAfter: when the oldest entry expires from the window
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = 0
    local resetAtMs = nowMs + windowMs
    if oldest and #oldest >= 2 then
      local oldestMs = tonumber(oldest[2])
      retryAfterMs = (oldestMs + windowMs) - nowMs
      resetAtMs = oldestMs + windowMs
      if retryAfterMs < 0 then retryAfterMs = 0 end
    end
    return false, count, lim, retryAfterMs, resetAtMs
  end
  -- Use millisecond timestamp : requestId for unique member (no collisions at high QPS)
  redis.call('ZADD', key, nowMs, nowMs .. ':' .. requestId)
  -- PEXPIRE with buffer to ensure cleanup even without traffic
  redis.call('PEXPIRE', key, windowMs + 10000)
  local remaining = lim - (count + 1)
  local resetAtMs = nowMs + windowMs
  return true, remaining, lim, 0, resetAtMs
end

-- Helper: token bucket check (millisecond precision)
-- Returns: allowed, remaining, retryAfterMs
local function tokenBucketCheck(key, capacity, refillRatePerMs)
  local cap = tonumber(capacity)
  local refillRate = tonumber(refillRatePerMs)
  local data = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
  local tokens = tonumber(data[1]) or cap
  local lastRefillMs = tonumber(data[2]) or nowMs
  -- Refill tokens based on elapsed milliseconds
  local elapsedMs = nowMs - lastRefillMs
  tokens = math.min(cap, tokens + elapsedMs * refillRate)
  if tokens < 1 then
    -- Time until 1 token is available
    local deficit = 1 - tokens
    local retryAfterMs = math.ceil(deficit / refillRate)
    return false, 0, retryAfterMs
  end
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ms', nowMs)
  redis.call('PEXPIRE', key, 120000)
  return true, math.floor(tokens), 0
end

-- Check all dimensions (most restrictive first-to-fail)
local ok, remaining, limit, retryAfterMs, resetAtMs

ok, remaining, limit, retryAfterMs, resetAtMs = slidingWindowCheck(KEYS[1], ARGV[1])
if not ok then return {'community', tostring(remaining), tostring(limit), tostring(retryAfterMs), tostring(resetAtMs)} end

ok, remaining, limit, retryAfterMs, resetAtMs = slidingWindowCheck(KEYS[2], ARGV[2])
if not ok then return {'user', tostring(remaining), tostring(limit), tostring(retryAfterMs), tostring(resetAtMs)} end

ok, remaining, limit, retryAfterMs, resetAtMs = slidingWindowCheck(KEYS[3], ARGV[3])
if not ok then return {'channel', tostring(remaining), tostring(limit), tostring(retryAfterMs), tostring(resetAtMs)} end

local burstOk, burstRemaining, burstRetryMs
burstOk, burstRemaining, burstRetryMs = tokenBucketCheck(KEYS[4], ARGV[4], ARGV[5])
if not burstOk then return {'burst', '0', ARGV[4], tostring(burstRetryMs), '0'} end

-- All passed: return remaining for the most restrictive sliding window dimension
return {'ok', tostring(remaining), tostring(limit), '0', tostring(resetAtMs)}
