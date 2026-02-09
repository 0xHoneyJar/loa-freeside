-- Budget Reaper Script
-- Sprint S3-T3 + S8-T3: Clean expired reservations and reclaim reserved budget
--
-- Iterates expired members in the expiry ZSET, claims each reservation via DEL,
-- and only decrements reserved for reservations we successfully claim.
--
-- Race condition fix (S8-T3): Uses DEL return value as atomic claim signal.
-- If finalize already DEL'd the reservation key, DEL here returns 0 and we
-- skip the DECRBY for that entry. This guarantees exactly-once decrement.
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

  -- Claim: read estimated_cost, then DEL to claim the reservation.
  -- DEL returns 1 if we deleted (we won the claim), 0 if finalize already claimed it.
  local estimatedCostRaw = redis.call('HGET', reservationKey, 'estimated_cost')
  local claimed = redis.call('DEL', reservationKey)

  if claimed == 1 then
    -- We won the claim: include in totalReclaimed for DECRBY
    local estimatedCost = tonumber(estimatedCostRaw) or 0
    if estimatedCost < 0 then estimatedCost = 0 end
    estimatedCost = math.floor(estimatedCost)
    totalReclaimed = totalReclaimed + estimatedCost
  end
  -- If claimed == 0: finalize already handled this reservation, skip DECRBY

  reapedCount = reapedCount + 1
end

-- Remove all expired members from the ZSET
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, nowMs)

-- Decrement reserved counter by total reclaimed (only for reservations we claimed)
if totalReclaimed > 0 then
  redis.call('DECRBY', KEYS[1], totalReclaimed)
  -- Safety clamp: should never go negative with claim-via-DEL,
  -- but clamp as defense-in-depth
  local reserved = tonumber(redis.call('GET', KEYS[1]) or '0') or 0
  if reserved < 0 then
    redis.log(redis.LOG_WARNING, 'ACCOUNTING_DRIFT reaper drift_cents=' .. tostring(math.abs(reserved)) .. ' operation=reap')
    redis.call('SET', KEYS[1], '0')
  end
  -- Refresh TTL
  local monthlyTtlMs = 35 * 24 * 60 * 60 * 1000
  redis.call('PEXPIRE', KEYS[1], monthlyTtlMs)
end

return {'REAPED', tostring(reapedCount), tostring(totalReclaimed)}
