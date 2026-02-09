-- Budget Reservation Script
-- Sprint S3-T1: Atomic two-counter check-and-reserve
--
-- Atomically checks effective spend (committed + reserved) and creates
-- a reservation if within budget. Idempotent via reservation hash check.
--
-- @see SDD §8.2 Budget Reservation Script

-- KEYS[1] = agent:budget:committed:{community_id}:{month}
-- KEYS[2] = agent:budget:reserved:{community_id}:{month}
-- KEYS[3] = agent:budget:limit:{community_id}
-- KEYS[4] = agent:budget:reservation:{community_id}:{user_id}:{idempotency_key}
-- KEYS[5] = agent:budget:expiry:{community_id}:{month}
-- ARGV[1] = estimatedCost (cents, integer)
-- ARGV[2] = userId
-- ARGV[3] = idempotencyKey
-- ARGV[4] = communityId
-- ARGV[5] = modelAlias
-- ARGV[6] = nowMs (current timestamp in milliseconds)
-- ARGV[7] = reservationTtlMs (from centralized config, Flatline IMP-002)

local estimatedCost = tonumber(ARGV[1])
local userId = ARGV[2]
local idempotencyKey = ARGV[3]
local communityId = ARGV[4]
local modelAlias = ARGV[5]
local nowMs = tonumber(ARGV[6])
local reservationTtlMs = tonumber(ARGV[7])

-- Validate numeric inputs (prevent negative cost bypass and NaN arithmetic)
if (not estimatedCost) or (estimatedCost < 0) then
  return {'INVALID_INPUT', '0', '0', '0'}
end
if (not nowMs) or (nowMs < 0) or (not reservationTtlMs) or (reservationTtlMs <= 0) then
  return {'INVALID_INPUT', '0', '0', '0'}
end

-- Idempotency check: return early if reservation already exists
local existing = redis.call('EXISTS', KEYS[4])
if existing == 1 then
  return {'ALREADY_RESERVED', '0', '0', '0'}
end

-- Read current counters
local committed = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
local reserved = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
local limit = tonumber(redis.call('GET', KEYS[3]) or '0') or 0

-- Effective spend = committed + reserved
local effectiveSpend = committed + reserved

-- Check if reservation would exceed budget
if effectiveSpend + estimatedCost > limit then
  local remaining = limit - effectiveSpend
  if remaining < 0 then remaining = 0 end
  return {'BUDGET_EXCEEDED', tostring(remaining), tostring(limit), '0'}
end

-- Reserve: increment reserved counter
redis.call('INCRBY', KEYS[2], estimatedCost)
-- Set TTL on budget counters (35 days for monthly rollover safety)
redis.call('PEXPIRE', KEYS[1], 35 * 24 * 60 * 60 * 1000)
redis.call('PEXPIRE', KEYS[2], 35 * 24 * 60 * 60 * 1000)

-- Store reservation hash with explicit fields
local expiresAtMs = nowMs + reservationTtlMs
redis.call('HMSET', KEYS[4],
  'estimated_cost', estimatedCost,
  'community_id', communityId,
  'user_id', userId,
  'idempotency_key', idempotencyKey,
  'model_alias', modelAlias,
  'created_at_ms', nowMs
)
-- Set TTL on reservation hash (reservation TTL + 60s buffer for reaper)
redis.call('PEXPIRE', KEYS[4], reservationTtlMs + 60000)

-- Add to expiry sorted set for reaper (member = userId:idempotencyKey, score = expiresAtMs)
redis.call('ZADD', KEYS[5], expiresAtMs, userId .. ':' .. idempotencyKey)
redis.call('PEXPIRE', KEYS[5], 35 * 24 * 60 * 60 * 1000)

-- Calculate remaining and check warning threshold (80%)
local newEffective = effectiveSpend + estimatedCost
local remaining = limit - newEffective
if remaining < 0 then remaining = 0 end
local warningFlag = '0'
if limit > 0 and (newEffective / limit) >= 0.80 then
  warningFlag = '1'
end

return {'RESERVED', tostring(remaining), tostring(limit), warningFlag}
