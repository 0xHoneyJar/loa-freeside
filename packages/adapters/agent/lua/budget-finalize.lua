-- Budget Finalization Script (Idempotent)
-- Sprint S3-T2: Move cost from reserved→committed with idempotency marker
--
-- Handles three cases:
-- 1. Normal finalize: reservation exists → move reserved→committed
-- 2. Late finalize: reservation expired → add directly to committed
-- 3. Already finalized: finalization marker exists → return ALREADY_FINALIZED
--
-- @see SDD §8.3 Budget Finalization Script

-- KEYS[1] = agent:budget:committed:{community_id}:{month}
-- KEYS[2] = agent:budget:reserved:{community_id}:{month}
-- KEYS[3] = agent:budget:reservation:{community_id}:{user_id}:{idempotency_key}
-- KEYS[4] = agent:budget:expiry:{community_id}:{month}
-- KEYS[5] = agent:budget:finalized:{community_id}:{user_id}:{idempotency_key}
-- ARGV[1] = actualCost (cents, integer — clamped to >= 0)
-- ARGV[2] = userId:idempotencyKey (for ZREM from expiry set)

local actualCost = tonumber(ARGV[1])
local expiryMember = ARGV[2]

-- Validate inputs
if not expiryMember then
  return {'INVALID_INPUT', '0'}
end
if not actualCost then
  actualCost = 0
else
  if actualCost < 0 then actualCost = 0 end
  actualCost = math.floor(actualCost)
end

-- 1. Idempotency: check finalized marker first (SKP-002)
local alreadyFinalized = redis.call('EXISTS', KEYS[5])
if alreadyFinalized == 1 then
  return {'ALREADY_FINALIZED', '0'}
end

-- 2. Check if reservation exists (normal path) or expired (late path)
local reservationExists = redis.call('EXISTS', KEYS[3])
local monthlyTtlMs = 35 * 24 * 60 * 60 * 1000

if reservationExists == 1 then
  -- Normal finalize: read estimated cost, move reserved→committed
  local estimatedCostRaw = redis.call('HGET', KEYS[3], 'estimated_cost')
  local estimatedCost = tonumber(estimatedCostRaw) or 0
  if estimatedCost < 0 then estimatedCost = 0 end
  estimatedCost = math.floor(estimatedCost)

  -- Decrement reserved by estimated cost
  redis.call('DECRBY', KEYS[2], estimatedCost)
  -- Clamp reserved to 0 if negative
  local reserved = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
  if reserved < 0 then
    redis.call('SET', KEYS[2], '0')
    redis.call('PEXPIRE', KEYS[2], monthlyTtlMs)
  end

  -- Increment committed by actual cost
  redis.call('INCRBY', KEYS[1], actualCost)
  redis.call('PEXPIRE', KEYS[1], monthlyTtlMs)
  redis.call('PEXPIRE', KEYS[2], monthlyTtlMs)

  -- Clean up reservation hash and expiry member
  redis.call('DEL', KEYS[3])
  redis.call('ZREM', KEYS[4], expiryMember)

  -- Set finalized marker (24h TTL)
  redis.call('SET', KEYS[5], actualCost, 'PX', 24 * 60 * 60 * 1000)

  return {'FINALIZED', tostring(actualCost)}
else
  -- Late finalize: reservation expired (reaper may or may not have cleaned it)
  -- Add actual cost directly to committed
  redis.call('INCRBY', KEYS[1], actualCost)
  redis.call('PEXPIRE', KEYS[1], monthlyTtlMs)

  -- Clean up expiry member (might still be there if reaper hasn't run yet)
  redis.call('ZREM', KEYS[4], expiryMember)

  -- Set finalized marker (24h TTL)
  redis.call('SET', KEYS[5], actualCost, 'PX', 24 * 60 * 60 * 1000)

  return {'LATE_FINALIZE', tostring(actualCost)}
end
