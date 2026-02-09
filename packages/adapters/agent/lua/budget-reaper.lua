-- Budget Reaper Script
-- Sprint S3-T3: Clean expired reservations and reclaim reserved budget
--
-- Iterates expired members in the expiry ZSET, reads estimated_cost
-- from reservation hashes, deletes them, and decrements reserved counter.
--
-- @see SDD §8.4 Budget Reaper Script

-- KEYS[1] = agent:budget:reserved:{community_id}:{month}
-- KEYS[2] = agent:budget:expiry:{community_id}:{month}
-- ARGV[1] = nowMs (current timestamp in milliseconds)
-- ARGV[2] = reservationKeyPrefix = "agent:budget:reservation:{community_id}:"

local nowMs = tonumber(ARGV[1])
local reservationKeyPrefix = ARGV[2]

-- Validate inputs
if (not nowMs) or (nowMs < 0) then
  return {'INVALID_INPUT', '0', '0'}
end
if not reservationKeyPrefix then
  return {'INVALID_INPUT', '0', '0'}
end

-- Get all expired members (score <= nowMs)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], 0, nowMs)

if #expired == 0 then
  return {'REAPED', '0', '0'}
end

local totalReclaimed = 0
local reapedCount = 0

for i = 1, #expired do
  local member = expired[i]  -- format: "userId:idempotencyKey"

  -- Reconstruct reservation key from prefix + member
  local reservationKey = reservationKeyPrefix .. member

  -- Read estimated_cost from reservation hash (may already be deleted by finalize)
  local estimatedCostRaw = redis.call('HGET', reservationKey, 'estimated_cost')
  if estimatedCostRaw then
    local estimatedCost = tonumber(estimatedCostRaw) or 0
    if estimatedCost < 0 then estimatedCost = 0 end
    estimatedCost = math.floor(estimatedCost)
    totalReclaimed = totalReclaimed + estimatedCost
  end

  -- Always delete the reservation hash (DEL is safe on missing keys)
  redis.call('DEL', reservationKey)

  reapedCount = reapedCount + 1
end

-- Remove all expired members from the ZSET
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, nowMs)

-- Decrement reserved counter by total reclaimed; clamp to 0
if totalReclaimed > 0 then
  redis.call('DECRBY', KEYS[1], totalReclaimed)
  local reserved = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
  if reserved < 0 then
    redis.call('SET', KEYS[1], '0')
  end
  -- Refresh TTL
  local monthlyTtlMs = 35 * 24 * 60 * 60 * 1000
  redis.call('PEXPIRE', KEYS[1], monthlyTtlMs)
end

return {'REAPED', tostring(reapedCount), tostring(totalReclaimed)}
